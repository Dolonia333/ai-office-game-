/**
 * NPC Brain System
 * Each NPC has their own AI brain powered by a different API provider.
 * When an NPC needs to respond in conversation, their brain generates the reply.
 * Falls back to Claude if the assigned provider fails.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

class NpcBrainManager {
  constructor() {
    this.providers = {};   // provider configs loaded from openclaw.json
    this.brains = {};      // npcName -> NpcBrain instance
    this.memories = {};    // npcName -> conversation history array
    this._thinkCycles = {};    // npcName -> consecutive work cycles count
    this._lastDecisions = {};  // npcName -> last decision object
    this._taskProgress = {};   // npcName -> { task, phase, startedAt }
    this._pendingCascades = []; // queued cascade decisions to send downstream

    this._loadProviders();
    this._initBrains();
  }

  _loadProviders() {
    try {
      const configPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.openclaw', 'openclaw.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const p = config?.models?.providers || {};

      // Map each provider to a simple config
      if (p.anthropic?.apiKey) {
        this.providers.claude = {
          baseUrl: 'https://api.anthropic.com',
          apiKey: p.anthropic.apiKey,
          model: 'claude-3-haiku-20240307',
          type: 'anthropic',
        };
      }
      if (p.google?.apiKey) {
        this.providers.gemini = {
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: p.google.apiKey,
          model: 'gemini-2.0-flash',
          type: 'google',
        };
      }
      if (p.xai?.apiKey) {
        this.providers.grok = {
          baseUrl: 'https://api.x.ai',
          apiKey: p.xai.apiKey,
          model: 'grok-3-mini-beta',
          type: 'openai',
        };
      }
      if (p.moonshot?.apiKey) {
        this.providers.kimi = {
          baseUrl: p.moonshot.baseUrl || 'https://api.moonshot.cn',
          apiKey: p.moonshot.apiKey,
          model: 'moonshot-v1-8k',
          type: 'openai',
        };
      }

      // LM Studio — always available (no API key needed), local OpenAI-compatible API
      this.providers.lmstudio = {
        baseUrl: 'http://localhost:1234',
        apiKey: 'lm-studio',
        model: process.env.LM_STUDIO_MODEL || 'qwen2.5-14b-instruct-1m',
        type: 'lmstudio',
      };

      console.log(`[NpcBrains] Loaded providers: ${Object.keys(this.providers).join(', ')}`);
    } catch (err) {
      console.warn('[NpcBrains] No openclaw.json found — running in demo mode (no API keys needed)');
    }

    // Always register a 'demo' provider as ultimate fallback
    // This ensures NPCs load even with zero API keys configured
    if (!this.providers.demo) {
      this.providers.demo = { type: 'demo', baseUrl: null, apiKey: null, model: null };
    }
    const remoteCount = Object.keys(this.providers).filter(k => k !== 'demo' && k !== 'lmstudio').length;
    this._demoMode = remoteCount === 0; // demo mode only when zero remote providers configured
    if (this._demoMode) {
      console.log('[NpcBrains] Demo mode active — NPCs use smart scripted responses (no API keys required)');
    }
  }

  _initBrains() {
    // Load NPC identities from soul files (OpenClaw pattern)
    const npcsDir = path.join(__dirname, '..', 'npcs');
    // folder name -> display name mapping (for sprite names that differ from character names)
    const npcEntries = [
      { folder: 'abby', display: 'Abby' },
      { folder: 'alex', display: 'Alex' },
      { folder: 'bob', display: 'Bob' },
      { folder: 'jenny', display: 'Jenny' },
      { folder: 'dan', display: 'Dan' },
      { folder: 'lucy', display: 'Lucy' },
      { folder: 'bouncer', display: 'Bouncer' },
      { folder: 'conference_man', display: 'Marcus' },
      { folder: 'conference_woman', display: 'Sarah' },
      { folder: 'edward', display: 'Edward' },
      { folder: 'josh', display: 'Josh' },
      { folder: 'molly', display: 'Molly' },
      { folder: 'oscar', display: 'Oscar' },
      { folder: 'pier', display: 'Pier' },
      { folder: 'rob', display: 'Rob' },
      { folder: 'roki', display: 'Roki' },
    ];

    for (const { folder, display } of npcEntries) {
      const name = display;
      const soulPath = path.join(npcsDir, folder, 'SOUL.md');
      const memoryPath = path.join(npcsDir, folder, 'MEMORY.md');

      let soul = '', longTermMemory = '';
      try { soul = fs.readFileSync(soulPath, 'utf-8'); } catch (_) {}
      try { longTermMemory = fs.readFileSync(memoryPath, 'utf-8'); } catch (_) {}

      // Parse provider and role from SOUL.md sections
      const providerMatch = soul.match(/## Provider\n(\w+)/);
      const roleMatch = soul.match(/## Role\n(.+)/);
      const provider = providerMatch?.[1] || 'lmstudio';
      const role = roleMatch?.[1]?.trim() || 'Employee';

      const providerConfig = this.providers[provider] || this.providers.lmstudio || this.providers.demo;

      this.brains[name] = {
        provider,
        role,
        personality: soul,  // Full SOUL.md content IS the personality
        longTermMemory,
        providerConfig,
        fallbackConfig: null, // No paid API fallback — go straight to canned responses
      };
      this.memories[name] = [];

      console.log(`[NpcBrains] ${name} (${role}) -> ${provider} [SOUL.md loaded]`);
    }
  }

  /**
   * Save a memory entry to an NPC's MEMORY.md file (persistent across sessions)
   */
  // Display name -> folder name mapping
  _nameToFolder = {
    'Abby': 'abby', 'Alex': 'alex', 'Bob': 'bob', 'Jenny': 'jenny',
    'Dan': 'dan', 'Lucy': 'lucy', 'Bouncer': 'bouncer',
    'Marcus': 'conference_man', 'Sarah': 'conference_woman',
    'Edward': 'edward', 'Josh': 'josh', 'Molly': 'molly',
    'Oscar': 'oscar', 'Pier': 'pier', 'Rob': 'rob', 'Roki': 'roki',
  };

  saveMemory(npcName, entry) {
    const brain = this.brains[npcName];
    if (!brain) return;
    try {
      const folder = this._nameToFolder[npcName] || npcName.toLowerCase();
      const memPath = path.join(__dirname, '..', 'npcs', folder, 'MEMORY.md');
      const timestamp = new Date().toISOString().slice(0, 16);
      const newLine = `\n- [${timestamp}] ${entry}`;

      // Cap memory file at 200 lines to prevent unbounded growth
      let existing = '';
      try { existing = fs.readFileSync(memPath, 'utf-8'); } catch (_) {}
      const lines = existing.split('\n').filter(l => l.trim());
      if (lines.length >= 200) {
        // Trim oldest 50 entries, keeping the most recent 150
        const trimmed = lines.slice(lines.length - 150);
        fs.writeFileSync(memPath, trimmed.join('\n') + newLine);
      } else {
        fs.appendFileSync(memPath, newLine);
      }

      brain.longTermMemory = fs.readFileSync(memPath, 'utf-8');
    } catch (err) {
      console.warn(`[NpcBrains] Failed to save memory for ${npcName}:`, err.message);
    }
  }

  /**
   * Generate a response for an NPC in a conversation.
   * @param {string} npcName - The NPC responding (e.g., "Alex")
   * @param {string} fromName - Who's talking to them (e.g., "Abby")
   * @param {string} message - What was said to them
   * @param {object} context - Office context (who's where, what's happening)
   * @returns {Promise<string>} The NPC's response text
   */
  // Strip characters that break JSON surrogate pair encoding (emojis, etc.)
  _sanitize(str) {
    return str.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, '');
  }

  async getResponse(npcName, fromName, message, context = {}) {
    const brain = this.brains[npcName];
    if (!brain) return `(${npcName} nods)`;

    const rawMemory = brain.longTermMemory || '';
    const memorySection = rawMemory.length > 50
      ? `\n\n## Your Memories\n${this._sanitize(rawMemory.slice(-800))}`
      : '';

    // Build coworker awareness — who this NPC knows and their relationships
    const coworkerContext = this._getCoworkerContext(npcName, fromName);

    const systemPrompt = `${brain.personality}${memorySection}

## Your Coworkers
${coworkerContext}

You are in a pixel art office game. You're having a conversation at work.
Your role: ${brain.role}. You know your coworkers, remember past conversations, and understand how you can help each other get things done.
Keep responses conversational (under 120 characters). Be natural, like a real coworker. Reference past conversations when relevant.
${context.description || ''}

Respond in character as ${npcName}. Just the dialogue text, nothing else.`;

    // Add to memory (sanitize to prevent JSON encoding issues)
    this.memories[npcName].push({ from: fromName, text: this._sanitize(message) });
    if (this.memories[npcName].length > 50) {
      this.memories[npcName] = this.memories[npcName].slice(-50);
    }

    // Build conversation from memory
    const messages = this.memories[npcName].map(m => ({
      role: m.from === npcName ? 'assistant' : 'user',
      content: m.from === npcName ? m.text : `${m.from} says: "${m.text}"`,
    }));

    try {
      const response = await this._callProvider(brain.providerConfig, systemPrompt, messages);
      // Store response in memory
      this.memories[npcName].push({ from: npcName, text: response });
      return response;
    } catch (err) {
      // Throttle error logging — only log once per NPC per 60 seconds
      const now = Date.now();
      const lastErr = this._lastErrorLog?.[npcName] || 0;
      if (now - lastErr > 60000) {
        console.warn(`[NpcBrains] ${npcName}'s provider failed: ${err.message.slice(0, 80)}`);
        if (!this._lastErrorLog) this._lastErrorLog = {};
        this._lastErrorLog[npcName] = now;
      }
      // Try fallback
      if (brain.fallbackConfig && brain.fallbackConfig !== brain.providerConfig) {
        try {
          const response = await this._callProvider(brain.fallbackConfig, systemPrompt, messages);
          this.memories[npcName].push({ from: npcName, text: response });
          return response;
        } catch (e2) {
          console.warn(`[NpcBrains] ${npcName} fallback also failed: ${e2.message}`);
        }
      }
      // Last resort: context-aware canned response
      const response = this._cannedResponse(npcName, fromName, message);
      this.memories[npcName].push({ from: npcName, text: response });
      return response;
    }
  }

  /**
   * Autonomous NPC thinking — decides what to do next based on role, memory, and office state.
   * Returns a JSON action the NPC wants to take, plus _cascades for leaders.
   */
  async think(npcName, officeContext = {}) {
    const brain = this.brains[npcName];
    if (!brain) return { action: 'idle' };

    const rawMemory = brain.longTermMemory || '';
    const recentMemory = rawMemory.length > 100
      ? this._sanitize(rawMemory.slice(-1200))
      : '';

    const coworkerContext = this._getCoworkerContext(npcName, '');
    const hierarchyRules = this._getHierarchyRules(npcName);
    const teamContext = this._getTeamContext(npcName);
    const h = this._hierarchy[npcName];

    const recentConversations = (this.memories[npcName] || []).slice(-10)
      .map(m => m.from + ': "' + m.text + '"')
      .join('\n');

    // Track think cycles for fatigue/variety hints
    const cycles = this._thinkCycles[npcName] || 0;
    const lastDecision = this._lastDecisions[npcName] || null;
    const taskProg = this._taskProgress[npcName] || null;

    // Build continuity context
    var continuitySection = '';
    if (lastDecision) {
      continuitySection += 'Your LAST decision was: action="' + (lastDecision.action || '?') + '"';
      if (lastDecision.target) continuitySection += ', talking to ' + lastDecision.target;
      if (lastDecision.thought) continuitySection += '. You were thinking: "' + lastDecision.thought + '"';
      continuitySection += '\n';
    }
    if (taskProg) {
      continuitySection += 'Current task: "' + taskProg.task + '" (phase: ' + taskProg.phase + ', started ' + taskProg.startedAt + ').\n';
    }

    // Emotional state / fatigue hints
    var fatigueHint = '';
    if (cycles >= 4) {
      fatigueHint = 'You have been working for ' + cycles + ' consecutive cycles without a break. Consider taking a break, chatting with someone, or switching tasks.';
    } else if (cycles >= 2) {
      fatigueHint = 'You have been focused for a while (' + cycles + ' cycles). Maybe check in with a teammate or stretch your legs.';
    }

    // Action weighting hint to prevent all NPCs just "working"
    var actionWeightHint = '';
    if (h && h.manages.length > 0) {
      actionWeightHint = 'As a manager, spend ~40% TALKING (check-ins, delegating, updates), ~20% COLLABORATING, ~20% WORKING, ~10% MEETINGS, ~10% BREAKS. Do NOT just sit at your desk every cycle.';
    } else if (h && h.reportsTo !== 'CEO') {
      actionWeightHint = 'Balance your time: ~40% WORKING, ~25% TALKING (updates, asking for help), ~15% COLLABORATING, ~10% BREAKS, ~10% CHECK/MEETING.';
    }

    var managesStr = (h && h.manages.length > 0) ? h.manages.join(', ') : 'nobody';
    var reportsToStr = h ? h.reportsTo : 'your boss';

    const systemPrompt = brain.personality + '\n\n' +
      '## Hierarchy Rules\n' + hierarchyRules + '\n\n' +
      '## Your Teams\n' + (teamContext || 'No team assignments.') + '\n\n' +
      '## Your Coworkers\n' + coworkerContext + '\n\n' +
      '## Your Memories\n' + (recentMemory || 'No memories yet.') + '\n\n' +
      '## Recent Conversations\n' + (recentConversations || 'None yet today.') + '\n\n' +
      '## Task Continuity\n' + (continuitySection || 'No previous decision this session.') + '\n\n' +
      '## Current Office State\n' + (officeContext.description || 'Normal workday. Everyone is at their desks.') + '\n\n' +
      (fatigueHint ? '## Energy Level\n' + fatigueHint + '\n\n' : '') +
      'You are ' + npcName + ', ' + brain.role + ', in a pixel art office. Think about what to do RIGHT NOW.\n\n' +
      'HIERARCHY ENFORCEMENT:\n' +
      '- ONLY give tasks/orders to people you manage: ' + managesStr + '\n' +
      '- NEVER give orders to ' + reportsToStr + ' or anyone above you\n' +
      '- When you finish a task, REPORT to ' + reportsToStr + '\n' +
      '- If someone above you asks you to do something, you do it\n\n' +
      'THINK ABOUT:\n' +
      '- Your role and expertise: what are YOU uniquely good at?\n' +
      '- Past conversations: did someone ask you for something? Did you promise to follow up?\n' +
      '- Who can help YOU: if stuck, who has the expertise you need?\n' +
      '- Who needs YOUR help: is anyone working on something you know about?\n' +
      '- Task progress: are you STARTING something new, CONTINUING something, or FINISHING and reporting?\n' +
      '- Collaboration: could you solve this faster by working WITH someone?\n\n' +
      (actionWeightHint ? 'ACTION BALANCE:\n' + actionWeightHint + '\n\n' : '') +
      'BEHAVIOR GUIDE:\n' +
      '- Ask coworkers for help with things outside your expertise\n' +
      '- Offer help when you remember someone struggling with something you are good at\n' +
      '- Walk to the breakroom with someone for a casual chat about ideas\n' +
      '- Go to the conference room to whiteboard a problem together\n' +
      '- Reference SPECIFIC past conversations and follow up on them\n' +
      '- Build on previous decisions: do not repeat the same task endlessly\n' +
      '- When you FINISH a task, talk to your manager (' + reportsToStr + ') to report it\n' +
      '- Have opinions and preferences: disagree sometimes, suggest alternatives\n\n' +
      'Respond with EXACTLY ONE JSON object (no other text):\n' +
      '{\n' +
      '  "thought": "what you are thinking and WHY (1-2 sentences)",\n' +
      '  "action": "one of: work, talk, collaborate, break, check, meeting, report",\n' +
      '  "target": "NPC name if talking/collaborating/reporting, or null",\n' +
      '  "location": "desk, breakroom, conference, storage, or null (stay put)",\n' +
      '  "message": "what you would say: be specific, reference past work, ask real questions",\n' +
      '  "taskPhase": "one of: starting, continuing, finished, none",\n' +
      '  "save": "concise note: WHO you talked to, WHAT was discussed, WHAT was decided, WHAT is next"\n' +
      '}\n\n' +
      'Examples:\n' +
      '{"thought": "Josh mentioned a CSS bug yesterday. I should follow up since it blocks the launch.", "action": "talk", "target": "Josh", "location": null, "message": "Hey Josh, did you fix that CSS layout issue? I need it before we ship the dashboard.", "taskPhase": "continuing", "save": "Followed up with Josh on CSS bug. Blocks dashboard launch. Waiting for his update."}\n' +
      '{"thought": "I finished the API refactor. I need to report to Abby before moving on.", "action": "report", "target": "Abby", "location": null, "message": "Abby, the API refactor is done. All endpoints updated and tests pass. Ready for Jenny to review.", "taskPhase": "finished", "save": "FINISHED API refactor. Reported to Abby. Next: wait for Jenny code review."}\n' +
      '{"thought": "Been coding for a while. Edward and I should brainstorm over coffee.", "action": "break", "target": "Edward", "location": "breakroom", "message": "Edward, want to grab coffee? I want to bounce some API ideas off you.", "taskPhase": "none", "save": "Coffee break with Edward. Discussed API redesign. He suggested GraphQL."}\n' +
      '{"thought": "Molly found a bug in my code. Starting a fix before sprint review.", "action": "work", "target": null, "location": "desk", "message": "Fixing the validation bug Molly reported", "taskPhase": "starting", "save": "STARTED fixing validation bug from Molly QA report. Bug in form input sanitization."}';

    try {
      const response = await this._callProvider(brain.providerConfig, systemPrompt, [
        { role: 'user', content: 'What do you want to do right now? Respond with JSON only.' }
      ]);

      // Parse the JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);

        // Track think cycles (reset on non-work action)
        if (decision.action === 'work') {
          this._thinkCycles[npcName] = (this._thinkCycles[npcName] || 0) + 1;
        } else {
          this._thinkCycles[npcName] = 0;
        }

        // Save last decision for continuity
        this._lastDecisions[npcName] = {
          action: decision.action,
          target: decision.target,
          thought: decision.thought,
          timestamp: new Date().toISOString().slice(0, 16),
        };

        // Track task progress phases
        if (decision.taskPhase === 'starting' && decision.message) {
          this._taskProgress[npcName] = {
            task: decision.message.slice(0, 80),
            phase: 'in-progress',
            startedAt: new Date().toLocaleTimeString(),
          };
        } else if (decision.taskPhase === 'finished') {
          var finishedTask = this._taskProgress[npcName];
          this._taskProgress[npcName] = null;
          // Auto-report to manager when finishing a task
          if (finishedTask && !decision.target && h) {
            decision.target = h.reportsTo !== 'CEO' ? h.reportsTo : null;
            if (decision.action !== 'report') decision.action = 'report';
          }
        } else if (decision.taskPhase === 'continuing' && this._taskProgress[npcName]) {
          this._taskProgress[npcName].phase = 'continuing';
        }

        // Enhanced memory saving: include WHO, WHAT, DECIDED, NEXT
        if (decision.save) {
          var enrichedSave = decision.save;
          if (decision.taskPhase && decision.taskPhase !== 'none') {
            enrichedSave = '[' + decision.taskPhase.toUpperCase() + '] ' + enrichedSave;
          }
          if (decision.target && h) {
            var targetH = this._hierarchy[decision.target];
            if (targetH) {
              var rel = (h.manages.indexOf(decision.target) !== -1) ? 'report' :
                        (h.reportsTo === decision.target) ? 'manager' : 'peer';
              enrichedSave += ' (spoke to ' + decision.target + ', my ' + rel + ')';
            }
          }
          this.saveMemory(npcName, enrichedSave);
        }

        // Cascade decisions from leaders to their reports
        decision._cascades = [];
        if (h && h.manages.length > 0 && (decision.action === 'talk' || decision.action === 'collaborate' || decision.action === 'meeting' || decision.action === 'report')) {
          decision._cascades = this._cascadeDecision(npcName, decision);
        }

        // If action is "report", ensure it has a target (the manager)
        if (decision.action === 'report' && !decision.target && h) {
          decision.target = h.reportsTo !== 'CEO' ? h.reportsTo : null;
        }

        return decision;
      }
      return { action: 'work', thought: 'Focusing on my tasks', message: 'Working...', target: null };
    } catch (err) {
      console.warn('[NpcBrains] ' + npcName + ' think error: ' + err.message);
      return { action: 'error', thought: 'Something went wrong', message: err.message || 'API error — taking a break', target: null };
    }
  }

  /**
   * Call an AI provider API
   */
  _callProvider(config, systemPrompt, messages, opts = {}) {
    if (!config || config.type === 'demo') {
      // Demo mode — return null so fallback logic kicks in
      return Promise.reject(new Error('Demo mode — no API configured'));
    }
    if (config.type === 'anthropic') {
      return this._callAnthropic(config, systemPrompt, messages, opts);
    } else if (config.type === 'google') {
      return this._callGoogle(config, systemPrompt, messages, opts);
    } else if (config.type === 'openai') {
      return this._callOpenAI(config, systemPrompt, messages, opts);
    } else if (config.type === 'lmstudio') {
      return this._callLocal(config, systemPrompt, messages, opts);
    }
    return Promise.reject(new Error('Unknown provider type'));
  }

  _callAnthropic(config, systemPrompt, messages, opts = {}) {
    const maxTokens = opts.maxTokens || 100;
    const sliceLen = opts.sliceLen || 150;
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages.length > 0 ? messages : [{ role: 'user', content: 'Introduce yourself briefly.' }],
      });

      const url = new URL('/v1/messages', config.baseUrl);
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': config.apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message));
            resolve((p.content?.[0]?.text || '').trim().slice(0, sliceLen));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  _callGoogle(config, systemPrompt, messages, opts = {}) {
    const maxTokens = opts.maxTokens || 60;
    const sliceLen = opts.sliceLen || 150;
    return new Promise((resolve, reject) => {
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: 'Introduce yourself briefly.' }] });
      }

      const body = JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: maxTokens },
      });

      const url = new URL(
        `/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
        config.baseUrl
      );
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message));
            const text = p.candidates?.[0]?.content?.parts?.[0]?.text || '';
            resolve(text.trim().slice(0, sliceLen));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  _callOpenAI(config, systemPrompt, messages, opts = {}) {
    const maxTokens = opts.maxTokens || 150;
    const sliceLen = opts.sliceLen || 150;
    return new Promise((resolve, reject) => {
      const oaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];
      if (messages.length === 0) {
        oaiMessages.push({ role: 'user', content: 'Introduce yourself briefly.' });
      }

      const body = JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        messages: oaiMessages,
      });

      const url = new URL('/v1/chat/completions', config.baseUrl);
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message || JSON.stringify(p.error)));
            resolve((p.choices?.[0]?.message?.content || '').trim().slice(0, sliceLen));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  /**
   * Call LM Studio local API (HTTP, OpenAI-compatible)
   */
  _callLocal(config, systemPrompt, messages, opts = {}) {
    const maxTokens = opts.maxTokens || 150;
    const sliceLen = opts.sliceLen || 150;
    return new Promise((resolve, reject) => {
      const oaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];
      if (messages.length === 0) {
        oaiMessages.push({ role: 'user', content: 'Introduce yourself briefly.' });
      }

      const body = JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature: 0.8,
        messages: oaiMessages,
      });

      const url = new URL('/v1/chat/completions', config.baseUrl);
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 1234,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message || JSON.stringify(p.error)));
            resolve((p.choices?.[0]?.message?.content || '').trim().slice(0, sliceLen));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('LM Studio timeout')));
      req.write(body);
      req.end();
    });
  }

  // Org chart hierarchy — who reports to who and what they do
  _hierarchy = {
    'Abby':    { reportsTo: 'CEO', manages: ['Marcus', 'Sarah', 'Alex', 'Jenny', 'Oscar', 'Pier', 'Bob', 'Dan', 'Lucy', 'Bouncer', 'Molly', 'Rob'], title: 'CTO' },
    'Marcus':  { reportsTo: 'Abby', manages: [], title: 'Project Manager — coordinates sprints and deadlines' },
    'Sarah':   { reportsTo: 'Abby', manages: [], title: 'Product Manager — defines what gets built' },
    'Alex':    { reportsTo: 'Abby', manages: ['Josh', 'Edward', 'Roki'], title: 'Senior Developer — team lead' },
    'Josh':    { reportsTo: 'Alex', manages: [], title: 'Frontend Developer' },
    'Edward':  { reportsTo: 'Alex', manages: [], title: 'Backend Developer' },
    'Roki':    { reportsTo: 'Alex', manages: [], title: 'Intern — learning from everyone' },
    'Jenny':   { reportsTo: 'Abby', manages: [], title: 'Developer — code review gatekeeper' },
    'Molly':   { reportsTo: 'Abby', manages: [], title: 'QA Engineer — tests everything' },
    'Rob':     { reportsTo: 'Abby', manages: [], title: 'UI/UX Designer' },
    'Oscar':   { reportsTo: 'Abby', manages: [], title: 'DevOps Engineer — CI/CD and deployments' },
    'Pier':    { reportsTo: 'Abby', manages: [], title: 'Data Engineer — data pipelines' },
    'Bob':     { reportsTo: 'Abby', manages: [], title: 'Researcher — R&D' },
    'Dan':     { reportsTo: 'Abby', manages: [], title: 'IT Support — servers, networking' },
    'Lucy':    { reportsTo: 'Abby', manages: [], title: 'Receptionist — schedules, coordination' },
    'Bouncer': { reportsTo: 'Dan', manages: [], title: 'Security Guard — office security' },
  };

  _teams = {
    'Engineering': { members: ['Alex', 'Josh', 'Edward', 'Roki', 'Jenny'], domain: 'building features, fixing bugs, code review', lead: 'Alex' },
    'DevOps & Infra': { members: ['Oscar', 'Dan'], domain: 'deployments, CI/CD, servers, networking', lead: 'Oscar' },
    'Product & Design': { members: ['Sarah', 'Rob', 'Molly'], domain: 'product requirements, UI/UX design, QA testing', lead: 'Sarah' },
    'Data & Research': { members: ['Pier', 'Bob'], domain: 'data pipelines, analytics, R&D', lead: 'Pier' },
    'Operations': { members: ['Lucy', 'Bouncer', 'Dan'], domain: 'scheduling, office coordination, security', lead: 'Lucy' },
    'Leadership': { members: ['Abby', 'Marcus', 'Sarah', 'Alex'], domain: 'strategy, planning, sprint coordination', lead: 'Abby' },
  };

  _getTeamsForNpc(npcName) {
    const result = [];
    for (const [teamName, team] of Object.entries(this._teams)) {
      if (team.members.includes(npcName)) {
        result.push({ name: teamName, ...team });
      }
    }
    return result;
  }

  _getHierarchyRules(npcName) {
    const h = this._hierarchy[npcName];
    if (!h) return '';
    const lines = [];
    if (h.reportsTo === 'CEO') {
      lines.push('You report DIRECTLY to the CEO. No one in the office outranks you except the CEO.');
    } else {
      lines.push('You report to ' + h.reportsTo + '. You do NOT give orders to ' + h.reportsTo + ' or anyone above them.');
    }
    if (h.manages.length > 0) {
      lines.push('You manage: ' + h.manages.join(', ') + '. You can assign them tasks, ask for updates, and review their work.');
    } else {
      lines.push('You do not manage anyone. You receive tasks from ' + h.reportsTo + ' and collaborate with peers.');
    }
    const superiors = [];
    let current = h.reportsTo;
    while (current && current !== 'CEO' && this._hierarchy[current]) {
      superiors.push(current);
      current = this._hierarchy[current].reportsTo;
    }
    if (superiors.length > 0) {
      lines.push('Chain above you: ' + superiors.join(' -> ') + ' -> CEO. Never give orders to these people.');
    }
    return lines.join('\n');
  }

  _getTeamContext(npcName) {
    const teams = this._getTeamsForNpc(npcName);
    if (teams.length === 0) return '';
    return teams.map(function(t) {
      return 'Team "' + t.name + '": [' + t.members.join(', ') + '] - you collaborate on ' + t.domain + '. Lead: ' + t.lead + '.';
    }).join('\n');
  }

  /**
   * Cascade a decision from a leader down the hierarchy.
   * Returns an array of { npcName, fromName, message } for conversations to trigger.
   */
  _cascadeDecision(fromNpc, decision) {
    const h = this._hierarchy[fromNpc];
    if (!h || h.manages.length === 0) return [];
    const cascades = [];
    const decisionText = decision.message || decision.thought || '';
    if (!decisionText || decisionText.length < 5) return [];
    var action = decision.action || '';
    if (action === 'work' || action === 'break' || action === 'check') return [];

    var relevantReports = h.manages.filter(function(name) {
      if (decision.target && name === decision.target) return false;
      if (decisionText.toLowerCase().indexOf(name.toLowerCase()) !== -1) return true;
      return false;
    });
    // Broaden: check domain keywords if no name matches
    if (relevantReports.length === 0) {
      relevantReports = h.manages.filter(function(name) {
        if (decision.target && name === decision.target) return false;
        var rTeams = this._getTeamsForNpc(name);
        for (var i = 0; i < rTeams.length; i++) {
          var keywords = rTeams[i].domain.toLowerCase().split(/[,\s]+/);
          for (var j = 0; j < keywords.length; j++) {
            if (keywords[j].length > 3 && decisionText.toLowerCase().indexOf(keywords[j]) !== -1) return true;
          }
        }
        return false;
      }.bind(this));
    }
    var targets = relevantReports.length > 0 ? relevantReports.slice(0, 3) : h.manages.slice(0, 2);
    for (var i = 0; i < targets.length; i++) {
      var reportName = targets[i];
      cascades.push({
        npcName: reportName,
        fromName: fromNpc,
        message: fromNpc + ' says: ' + decisionText.slice(0, 120),
      });
      this.saveMemory(reportName, fromNpc + ' directed: "' + decisionText.slice(0, 100) + '"');
      // Second-level cascade
      var reportH = this._hierarchy[reportName];
      if (reportH && reportH.manages.length > 0) {
        for (var j = 0; j < Math.min(reportH.manages.length, 2); j++) {
          var subReport = reportH.manages[j];
          cascades.push({
            npcName: subReport,
            fromName: reportName,
            message: reportName + ' relayed from ' + fromNpc + ': ' + decisionText.slice(0, 100),
          });
          this.saveMemory(subReport, reportName + ' relayed from ' + fromNpc + ': "' + decisionText.slice(0, 80) + '"');
        }
      }
    }
    this.saveMemory(fromNpc, 'Cascaded decision to ' + targets.join(', ') + ': "' + decisionText.slice(0, 80) + '"');
    return cascades;
  }

  /**
   * Build coworker context for an NPC — who they work with and recent interactions
   */
  _getCoworkerContext(npcName, talkingTo) {
    const h = this._hierarchy[npcName];
    if (!h) return '';

    const lines = [];
    lines.push(`You are ${npcName}, ${h.title}. You report to ${h.reportsTo}.`);
    if (h.manages.length > 0) {
      lines.push(`You manage: ${h.manages.join(', ')}.`);
    }

    // Who is talking to you and their relationship
    const theirH = this._hierarchy[talkingTo];
    if (theirH) {
      const relationship = h.manages.includes(talkingTo) ? 'your direct report'
        : h.reportsTo === talkingTo ? 'your boss'
        : theirH.manages.includes(npcName) ? 'your manager'
        : 'your coworker';
      lines.push(`${talkingTo} (${theirH.title}) is ${relationship}.`);
    }

    // Include recent conversation partners (who have they talked to recently)
    const recentPartners = new Set();
    const mem = this.memories[npcName] || [];
    for (const m of mem.slice(-10)) {
      if (m.from !== npcName) recentPartners.add(m.from);
    }
    if (recentPartners.size > 0) {
      lines.push(`You recently talked to: ${[...recentPartners].join(', ')}.`);
    }

    return lines.join('\n');
  }

  /**
   * Get memory summary for an NPC (for context in conversations)
   */
  getMemorySummary(npcName) {
    const mem = this.memories[npcName] || [];
    if (mem.length === 0) return 'No recent conversations.';
    const recent = mem.slice(-5).map(m => `${m.from}: "${m.text}"`).join(' | ');
    return `Recent: ${recent}`;
  }

  /**
   * Generate a response for the CEO (player) talking to an NPC.
   * Includes delegation logic — NPC decides if they should handle it
   * or escalate to their superior.
   *
   * Returns { text, delegation? } where delegation is null or
   * { delegateTo, reason, originalMessage }
   */
  async getPlayerResponse(npcName, message) {
    const brain = this.brains[npcName];
    if (!brain) return { text: `(${npcName} nods)`, delegation: null };

    const h = this._hierarchy[npcName];
    const rawMemory = brain.longTermMemory || '';
    const memorySection = rawMemory.length > 50
      ? `\n\n## Your Memories (what you remember from past days)\n${this._sanitize(rawMemory.slice(-1200))}`
      : '';

    const coworkerContext = this._getCoworkerContext(npcName, 'CEO');

    // Build role-specific action list
    const roleActions = this._getRoleActions(npcName, h);

    // Build chain-of-command context
    let chainOfCommand = '';
    if (h?.reportsTo === 'CEO') {
      chainOfCommand = 'You report DIRECTLY to the CEO. You are a senior leader.';
    } else {
      const chain = [];
      let current = npcName;
      while (current && current !== 'CEO') {
        const ch = this._hierarchy[current];
        if (ch?.reportsTo) {
          chain.push(ch.reportsTo);
          current = ch.reportsTo;
        } else break;
      }
      chainOfCommand = `Your chain of command: You -> ${chain.join(' -> ')} -> CEO.`;
    }

    // Build current task context from recent memories and decisions
    const recentMem = this.memories[npcName] || [];
    const recentWork = recentMem.slice(-8).map(m => `${m.from}: "${m.text}"`).join('\n');
    const currentTaskSection = recentWork
      ? `\n## Recent Conversations (your short-term memory)\n${recentWork}`
      : '\n## Recent Conversations\nNo conversations yet today.';

    // Build team status for managers
    let teamStatus = '';
    if (h?.manages?.length > 0) {
      const statuses = h.manages.map(memberName => {
        const memberMem = this.memories[memberName] || [];
        const lastActivity = memberMem.slice(-2).map(m => m.text).join('; ');
        return `- ${memberName} (${this._hierarchy[memberName]?.title || 'employee'}): ${lastActivity || 'at their desk'}`;
      });
      teamStatus = `\n## Your Team's Current Status\n${statuses.join('\n')}`;
    }

    // Find CEO-specific past conversations in long-term memory
    const ceoMemories = rawMemory.split('\n')
      .filter(l => l.includes('CEO'))
      .slice(-5)
      .join('\n');
    const ceoHistorySection = ceoMemories
      ? `\n## Past CEO Conversations (what the CEO has told you before)\n${this._sanitize(ceoMemories)}`
      : '';

    const systemPrompt = `${brain.personality}${memorySection}${ceoHistorySection}
${currentTaskSection}
${teamStatus}

## Your Coworkers
${coworkerContext}

## Your Role & Position
You are ${npcName}, ${h?.title || brain.role}. The CEO (your ultimate boss) is talking to you directly.
${chainOfCommand}
${h?.manages?.length > 0 ? `You manage: ${h.manages.join(', ')}.` : 'You are an individual contributor (no direct reports).'}

### Actions you can take (append tags at the END of your response):
${roleActions}

### General actions ANY employee can do:
- Go work at your desk: [ACTION:useComputer]
- Go to the break room: [ACTION:goToBreakroom]
- Go to a room: [ACTION:goToRoom:open_office] or conference, breakroom, manager_office, storage, reception
- Talk to a coworker: [ACTION:speakTo:CoworkerName:message to say]
- Call a meeting with people: [ACTION:callMeeting:Name1,Name2,Name3]
- Check a bookshelf/do research: [ACTION:checkBookshelf]
- Stand up from desk: [ACTION:standUp]

### Delegation (for tasks outside your scope):
- Delegate to the right person: [DELEGATE:PersonName:reason]
  Example: "I'll get Alex on that. [DELEGATE:Alex:frontend bug needs senior dev]"

## How to Respond to the CEO
1. Show your thinking briefly — what's your take on their request? (1 short sentence)
2. Give your actual response — be specific, reference what you're working on or what you know.
3. If the CEO gives an ORDER:
   - Acknowledge it clearly
   - Explain briefly HOW you'll do it
   - If you manage people, say WHO you'll assign it to and why they're the right person
   - Always include [ACTION:...] or [DELEGATE:...] tags
4. If just chatting/answering a question, no tags needed.
5. You can chain multiple actions: "On it! [ACTION:speakTo:Josh:CEO wants the homepage fixed] [DELEGATE:Josh:frontend task]"

## Rules
- Keep your spoken text under 200 characters. The CEO deserves detailed, thoughtful responses.
- Be natural, professional, and show you understand the company hierarchy.
- Reference your current work, past conversations, and team status when relevant.
- Respond in character as ${npcName}. Dialogue text first, then tags at the end.`;

    // Add to memory
    this.memories[npcName].push({ from: 'CEO', text: this._sanitize(message) });
    if (this.memories[npcName].length > 50) {
      this.memories[npcName] = this.memories[npcName].slice(-50);
    }

    const messages = this.memories[npcName].map(m => ({
      role: m.from === npcName ? 'assistant' : 'user',
      content: m.from === npcName ? m.text : `${m.from} says: "${m.text}"`,
    }));

    // Use higher token limits for CEO conversations — they deserve detailed responses
    const playerOpts = { maxTokens: 300, sliceLen: 500 };

    let responseText;
    try {
      responseText = await this._callProvider(brain.providerConfig, systemPrompt, messages, playerOpts);
    } catch (err) {
      const now = Date.now();
      const lastErr = this._lastErrorLog?.[npcName] || 0;
      if (now - lastErr > 60000) {
        console.warn(`[NpcBrains] ${npcName} player-chat provider failed: ${err.message.slice(0, 80)}`);
        if (!this._lastErrorLog) this._lastErrorLog = {};
        this._lastErrorLog[npcName] = now;
      }
      // Try fallback provider
      if (brain.fallbackConfig && brain.fallbackConfig !== brain.providerConfig) {
        try {
          responseText = await this._callProvider(brain.fallbackConfig, systemPrompt, messages, playerOpts);
        } catch (e2) {
          responseText = null;
        }
      }
      // If all providers failed, use smart fallback that infers actions from the message
      if (!responseText) {
        responseText = this._smartFallback(npcName, message, h);
      }
    }

    // Parse action tags [ACTION:...]
    let actions = [];
    const actionRegex = /\[ACTION:([^\]]+)\]/g;
    let actionMatch;
    while ((actionMatch = actionRegex.exec(responseText)) !== null) {
      const parts = actionMatch[1].split(':');
      const actionName = parts[0].trim();
      const actionParams = parts.slice(1).map(p => p.trim());
      actions.push({ action: actionName, params: actionParams });
    }
    // Remove action tags from displayed text
    responseText = responseText.replace(/\s*\[ACTION:[^\]]+\]/g, '').trim();

    // Parse delegation tag [DELEGATE:...]
    let delegation = null;
    const delegateMatch = responseText.match(/\[DELEGATE:([^:]+):([^\]]+)\]/);
    if (delegateMatch) {
      const delegateTo = delegateMatch[1].trim();
      const reason = delegateMatch[2].trim();
      if (this._hierarchy[delegateTo]) {
        delegation = { delegateTo, reason, originalMessage: message };
      } else {
        console.warn(`[NpcBrains] ${npcName} tried to delegate to unknown target: "${delegateTo}" — ignoring`);
      }
      responseText = responseText.replace(/\s*\[DELEGATE:[^\]]+\]/, '').trim();
    }

    // If the AI responded but didn't include any actions or delegation,
    // and the player's message looks like a task request, inject smart fallback actions
    if (actions.length === 0 && !delegation) {
      const isTaskRequest = /fix|build|code|go|check|test|deploy|research|call|meet|talk|tell|ask|schedule|design|review|run|look|find|make|create|set up|update|push|ship/i.test(message);
      if (isTaskRequest) {
        const fallbackText = this._smartFallback(npcName, message, h);
        // Extract actions from the fallback text
        const fbActionRegex = /\[ACTION:([^\]]+)\]/g;
        let fbMatch;
        while ((fbMatch = fbActionRegex.exec(fallbackText)) !== null) {
          const parts = fbMatch[1].split(':');
          actions.push({ action: parts[0].trim(), params: parts.slice(1).map(p => p.trim()) });
        }
        // Extract delegation from fallback
        const fbDelegateMatch = fallbackText.match(/\[DELEGATE:([^:]+):([^\]]+)\]/);
        if (fbDelegateMatch && this._hierarchy[fbDelegateMatch[1].trim()]) {
          delegation = { delegateTo: fbDelegateMatch[1].trim(), reason: fbDelegateMatch[2].trim(), originalMessage: message };
        }
        console.log(`[NpcBrains] Smart fallback for ${npcName}: ${actions.length} actions, delegation=${delegation?.delegateTo || 'none'}`);
      }
    }

    // Store response in memory (clean text only)
    this.memories[npcName].push({ from: npcName, text: this._sanitize(responseText) });

    return { text: responseText, delegation, actions };
  }

  /**
   * Get role-specific actions an NPC knows they can perform
   */
  /**
   * Generate a context-aware canned response for NPC-to-NPC conversation.
   * Used when no AI provider is available (demo mode or all providers down).
   */
  _cannedResponse(npcName, fromName, message) {
    const h = this._hierarchy[npcName];
    const title = (h?.title || '').toLowerCase();
    const msg = message.toLowerCase();

    // Role-specific responses based on what was said
    if (/bug|fix|error|broken|crash/i.test(msg)) {
      if (/developer|frontend|backend/i.test(title)) return 'On it, checking the code now.';
      if (/qa|test/i.test(title)) return 'I\'ll write a test for that.';
      if (/devops/i.test(title)) return 'Let me check the logs.';
      return 'I\'ll flag that for the team.';
    }
    if (/deploy|ship|release|push/i.test(msg)) {
      if (/devops/i.test(title)) return 'Running the pipeline now.';
      if (/developer/i.test(title)) return 'My PR is ready to merge.';
      return 'I\'ll prep my part for release.';
    }
    if (/meeting|standup|sync/i.test(msg)) {
      return 'I\'ll be there. Let me wrap this up.';
    }
    if (/review|pr|code review/i.test(msg)) {
      if (/developer/i.test(title)) return 'I\'ll review it this afternoon.';
      return 'Sure, send it over.';
    }
    if (/design|mockup|ui|ux/i.test(msg)) {
      if (/designer/i.test(title)) return 'I have some ideas. Let me sketch it.';
      return 'Let\'s loop in Rob on the design.';
    }
    if (/research|data|analysis/i.test(msg)) {
      if (/researcher|data/i.test(title)) return 'I\'ll dig into the data.';
      return 'Good call. Let me look into it.';
    }
    if (/help|stuck|blocked/i.test(msg)) {
      if (h?.manages?.includes(fromName)) return 'Show me what you\'ve got so far.';
      return 'Sure, what do you need?';
    }
    if (/status|update|progress|how/i.test(msg)) {
      const statuses = [
        'Making good progress. Almost done.',
        'About 80% done. Wrapping up.',
        'Just finishing up the last part.',
        'On track. Should be done soon.',
      ];
      return statuses[Math.floor(Math.random() * statuses.length)];
    }
    if (/good|great|nice|thanks|awesome/i.test(msg)) {
      const thanks = ['Thanks!', 'Appreciate it.', 'Sure thing.', 'Happy to help.'];
      return thanks[Math.floor(Math.random() * thanks.length)];
    }
    if (/morning|hello|hi |hey/i.test(msg)) {
      const greets = ['Morning!', 'Hey, what\'s up?', 'Hi! Ready to go.', 'Hey there.'];
      return greets[Math.floor(Math.random() * greets.length)];
    }

    // Generic role-based responses
    const roleResponses = {
      'cto': ['Got it. I\'ll coordinate the team.', 'Let me think about the approach.', 'Good idea. Let\'s prioritize that.'],
      'project manager': ['I\'ll update the board.', 'Let me check the timeline.', 'I\'ll sync with the team.'],
      'product manager': ['That aligns with our roadmap.', 'Let me check with users.', 'Good insight.'],
      'senior developer': ['I\'ll architect a solution.', 'Let me review the codebase.', 'Solid approach.'],
      'frontend developer': ['I\'ll update the UI.', 'Working on the components.', 'Let me check the styles.'],
      'backend developer': ['I\'ll handle the API side.', 'Checking the database now.', 'Let me write the endpoint.'],
      'qa engineer': ['I\'ll test that scenario.', 'Writing test cases now.', 'Let me verify that.'],
      'devops engineer': ['I\'ll check the infra.', 'Monitoring looks good.', 'Pipeline is green.'],
      'data engineer': ['Let me run the query.', 'Checking the data pipeline.', 'I\'ll analyze that.'],
      'ui/ux designer': ['I\'ll mock that up.', 'Let me sketch some options.', 'Good UX call.'],
      'researcher': ['I\'ll look into it.', 'Interesting finding.', 'Let me check the research.'],
      'it support': ['I\'ll take a look at that.', 'Restarting the service.', 'Should be fixed now.'],
      'receptionist': ['I\'ll note that down.', 'Let me check the schedule.', 'I\'ll pass that along.'],
      'security guard': ['All clear here.', 'I\'ll keep an eye out.', 'Security check done.'],
      'intern': ['On it! Learning a lot.', 'I\'ll give it a try.', 'Can you show me how?'],
    };

    const responses = roleResponses[title] || ['Got it.', 'Sure thing.', 'Working on it.', 'Sounds good.'];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  _getRoleActions(npcName, h) {
    const title = (h?.title || '').toLowerCase();
    const lines = [];

    if (/developer|frontend|backend|senior/i.test(title)) {
      lines.push('- Write/review code at your desk: [ACTION:useComputer]');
      lines.push('- Fix a bug or build a feature: [ACTION:useComputer] (go code it)');
      lines.push('- Review someone\'s code: [ACTION:speakTo:TheirName:I\'ll review your code]');
    }
    if (/cto|manager|lead/i.test(title)) {
      lines.push('- Check on the team: [ACTION:speakTo:PersonName:Status update?]');
      lines.push('- Call a team meeting: [ACTION:callMeeting:Name1,Name2,Name3]');
      lines.push('- Assign a task to someone: [ACTION:speakTo:PersonName:task description]');
    }
    if (/qa|test/i.test(title)) {
      lines.push('- Run tests: [ACTION:useComputer]');
      lines.push('- Report a bug to a dev: [ACTION:speakTo:DevName:Found a bug in...]');
    }
    if (/devops/i.test(title)) {
      lines.push('- Check deployments/servers: [ACTION:useComputer]');
      lines.push('- Fix infrastructure: [ACTION:useComputer]');
    }
    if (/designer|ui|ux/i.test(title)) {
      lines.push('- Work on designs: [ACTION:useComputer]');
      lines.push('- Show designs to a dev: [ACTION:speakTo:DevName:Check out this design]');
    }
    if (/researcher|r&d/i.test(title)) {
      lines.push('- Do research: [ACTION:checkBookshelf]');
      lines.push('- Look things up online: [ACTION:useComputer]');
    }
    if (/receptionist/i.test(title)) {
      lines.push('- Check the schedule: [ACTION:useComputer]');
      lines.push('- Greet visitors: [ACTION:goToRoom:reception]');
      lines.push('- Page someone: [ACTION:speakTo:PersonName:CEO needs you at reception]');
    }
    if (/it support/i.test(title)) {
      lines.push('- Fix a computer issue: [ACTION:useComputer]');
      lines.push('- Check server room: [ACTION:goToRoom:storage]');
      lines.push('- Help someone with IT: [ACTION:speakTo:PersonName:Let me fix that for you]');
    }
    if (/security/i.test(title)) {
      lines.push('- Patrol the office: [ACTION:goToRoom:reception]');
      lines.push('- Check the entrance: [ACTION:goToRoom:reception]');
    }
    if (/data engineer/i.test(title)) {
      lines.push('- Work on data pipelines: [ACTION:useComputer]');
      lines.push('- Analyze data: [ACTION:useComputer]');
    }
    if (/intern/i.test(title)) {
      lines.push('- Work on assigned tasks: [ACTION:useComputer]');
      lines.push('- Ask your mentor for help: [ACTION:speakTo:Alex:Need some guidance]');
    }

    if (lines.length === 0) {
      lines.push('- Do your work: [ACTION:useComputer]');
    }

    return lines.join('\n');
  }

  /**
   * Smart fallback when all AI providers fail.
   * Parses the player's message and generates a reasonable response + actions.
   */
  _smartFallback(npcName, message, h) {
    const msg = message.toLowerCase();
    const title = (h?.title || '').toLowerCase();
    const manages = h?.manages || [];
    const reportsTo = h?.reportsTo || 'Abby';

    // All NPC names for detecting who the player wants them to talk to
    const allNames = Object.keys(this._hierarchy);

    // Find if the message mentions another NPC name
    let mentionedPerson = null;
    for (const name of allNames) {
      if (name.toLowerCase() !== npcName.toLowerCase() && msg.includes(name.toLowerCase())) {
        mentionedPerson = name;
        break;
      }
    }

    // --- Meeting requests ---
    if (/meeting|meet up|gather|huddle|standup|stand-up|sync up/i.test(msg)) {
      if (/everyone|all|whole team|everybody/i.test(msg)) {
        const team = manages.length > 0 ? manages.join(',') : 'Alex,Josh,Edward,Jenny';
        return `On it, calling a team meeting. [ACTION:callMeeting:${team}]`;
      }
      if (mentionedPerson) {
        return `Sure, I'll set up a meeting with ${mentionedPerson}. [ACTION:callMeeting:${mentionedPerson}]`;
      }
      const team = manages.length > 0 ? manages.slice(0, 4).join(',') : 'Alex,Marcus,Sarah';
      return `I'll gather the team. [ACTION:callMeeting:${team}]`;
    }

    // --- Talk to / tell / ask someone ---
    if (/talk to|tell |ask |speak to|speak with|go tell|let .* know|inform |check with|check on/i.test(msg) && mentionedPerson) {
      // Extract what to say — get text after the person's name
      const nameIdx = msg.indexOf(mentionedPerson.toLowerCase());
      let what = message.slice(nameIdx + mentionedPerson.length).trim();
      // Clean up connectors
      what = what.replace(/^(to |that |about |if |whether )/i, '').trim();
      if (!what || what.length < 3) what = 'CEO needs to talk to you';
      if (what.length > 50) what = what.slice(0, 50);
      return `Sure, I'll talk to ${mentionedPerson}. [ACTION:speakTo:${mentionedPerson}:${what}]`;
    }

    // --- Fix / build / code / work on / implement ---
    if (/fix|bug|code|build|implement|develop|program|write|deploy|push|ship|release|update/i.test(msg)) {
      // If this NPC is a developer type, they go do it
      if (/developer|frontend|backend|senior|devops|engineer/i.test(title)) {
        // If they manage people and another dev would be better suited, delegate
        if (manages.length > 0 && mentionedPerson && manages.includes(mentionedPerson)) {
          const task = message.replace(new RegExp(npcName, 'gi'), '').trim().slice(0, 50);
          return `I'll assign that to ${mentionedPerson}. [ACTION:speakTo:${mentionedPerson}:${task}]`;
        }
        return `On it, heading to my desk to work on that. [ACTION:useComputer]`;
      }
      // Non-dev: delegate to a developer
      const devTarget = manages.find(n => {
        const th = this._hierarchy[n];
        return th && /developer|frontend|backend/i.test(th.title);
      }) || (this._hierarchy['Alex'] ? 'Alex' : reportsTo);
      const task = message.replace(new RegExp(npcName, 'gi'), '').trim().slice(0, 50);
      return `That's a dev task. I'll get ${devTarget} on it. [ACTION:speakTo:${devTarget}:${task}] [DELEGATE:${devTarget}:${task}]`;
    }

    // --- Research / look into / investigate ---
    if (/research|look into|investigate|find out|analyze|study|explore|read up/i.test(msg)) {
      if (/researcher|data|r&d/i.test(title)) {
        return `I'll dig into that right away. [ACTION:checkBookshelf]`;
      }
      return `I'll research that now. [ACTION:useComputer]`;
    }

    // --- Test / QA / check / verify ---
    if (/test|qa|check|verify|validate|review|inspect/i.test(msg)) {
      if (/qa|test/i.test(title)) {
        return `Running tests on it now. [ACTION:useComputer]`;
      }
      if (this._hierarchy['Molly']) {
        return `That's QA work, I'll get Molly on it. [ACTION:speakTo:Molly:CEO wants tests on this] [DELEGATE:Molly:testing task]`;
      }
      return `I'll check on that. [ACTION:useComputer]`;
    }

    // --- Design / UI / mockup ---
    if (/design|ui|ux|mockup|wireframe|layout|prototype/i.test(msg)) {
      if (/designer|ui|ux/i.test(title)) {
        return `I'll start working on designs. [ACTION:useComputer]`;
      }
      if (this._hierarchy['Rob']) {
        return `That's a design task. I'll get Rob on it. [ACTION:speakTo:Rob:CEO wants a design for this] [DELEGATE:Rob:design task]`;
      }
    }

    // --- Go somewhere ---
    if (/go to|head to|walk to|move to|check out/i.test(msg)) {
      if (/break\s?room|kitchen|coffee|lunch/i.test(msg)) {
        return `Heading to the break room. [ACTION:goToBreakroom]`;
      }
      if (/conference|meeting room/i.test(msg)) {
        return `Going to the conference room. [ACTION:goToRoom:conference]`;
      }
      if (/reception|front desk|lobby/i.test(msg)) {
        return `Heading to reception. [ACTION:goToRoom:reception]`;
      }
      if (/server|storage|it room/i.test(msg)) {
        return `Going to check the server room. [ACTION:goToRoom:storage]`;
      }
      if (/office|desk/i.test(msg)) {
        return `Going back to my desk. [ACTION:useComputer]`;
      }
    }

    // --- Schedule / organize / coordinate ---
    if (/schedule|organize|coordinate|plan|arrange/i.test(msg)) {
      if (/receptionist/i.test(title)) {
        return `I'll check the schedule now. [ACTION:useComputer]`;
      }
      if (this._hierarchy['Lucy']) {
        return `I'll have Lucy handle scheduling. [ACTION:speakTo:Lucy:CEO needs help with scheduling] [DELEGATE:Lucy:scheduling task]`;
      }
    }

    // --- IT / server / network / computer issue ---
    if (/server|network|computer|wifi|internet|it issue|tech support|restart/i.test(msg)) {
      if (/it support|devops/i.test(title)) {
        return `I'll take a look at that. [ACTION:goToRoom:storage]`;
      }
      if (this._hierarchy['Dan']) {
        return `That's an IT issue. I'll get Dan on it. [ACTION:speakTo:Dan:CEO reported a tech issue] [DELEGATE:Dan:IT support task]`;
      }
    }

    // --- Security ---
    if (/security|patrol|guard|watch|protect|lock/i.test(msg)) {
      if (/security/i.test(title)) {
        return `On patrol, I'll check it out. [ACTION:goToRoom:reception]`;
      }
      if (this._hierarchy['Bouncer']) {
        return `I'll let Bouncer know. [ACTION:speakTo:Bouncer:CEO wants a security check] [DELEGATE:Bouncer:security task]`;
      }
    }

    // --- Delegate to someone mentioned ---
    if (mentionedPerson) {
      const task = message.replace(new RegExp(npcName, 'gi'), '').replace(new RegExp(mentionedPerson, 'gi'), '').trim().slice(0, 50) || 'handle this task';
      return `I'll pass that to ${mentionedPerson}. [ACTION:speakTo:${mentionedPerson}:${task}]`;
    }

    // --- Generic: just go work on it ---
    return `On it, heading to my desk. [ACTION:useComputer]`;
  }
}

module.exports = NpcBrainManager;
