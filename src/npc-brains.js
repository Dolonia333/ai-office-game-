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
        model: 'dolphin3.0-llama3.1-8b',
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

      // Parse provider and role from SOUL.md sections (CRLF-safe for Windows checkouts)
      const providerMatch = soul.match(/## Provider\r?\n(\w+)/);
      const roleMatch = soul.match(/## Role\r?\n(.+)/);
      const provider = providerMatch?.[1] || 'claude';
      const role = roleMatch?.[1]?.trim() || 'Employee';

      const providerConfig = this.providers[provider] || this.providers.claude || this.providers.demo;

      this.brains[name] = {
        provider,
        role,
        personality: soul,  // Full SOUL.md content IS the personality
        longTermMemory,
        providerConfig,
        fallbackConfig: this.providers.claude,
      };
      this.memories[name] = [];

      const fallback = provider !== 'claude' && !this.providers[provider] ? ' (fallback: claude)' : '';
      console.log(`[NpcBrains] ${name} (${role}) -> ${provider}${fallback} [SOUL.md loaded]`);
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
    const folder = this._nameToFolder[npcName];
    if (!folder) {
      console.warn(`[NpcBrains] saveMemory: no folder mapping for "${npcName}"`);
      return;
    }
    try {
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
Keep responses SHORT (under 40 characters). Be natural, like a real coworker. Reference past conversations when relevant.
${context.description || ''}

Respond in character as ${npcName}. Just the dialogue text, nothing else.`;

    // Add to memory (sanitize to prevent JSON encoding issues)
    this.memories[npcName].push({ from: fromName, text: this._sanitize(message) });
    if (this.memories[npcName].length > 20) {
      this.memories[npcName] = this.memories[npcName].slice(-20);
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
   * Call an AI provider API
   */
  _callProvider(config, systemPrompt, messages) {
    if (!config || config.type === 'demo') {
      // Demo mode — return null so fallback logic kicks in
      return Promise.reject(new Error('Demo mode — no API configured'));
    }
    if (config.type === 'anthropic') {
      return this._callAnthropic(config, systemPrompt, messages);
    } else if (config.type === 'google') {
      return this._callGoogle(config, systemPrompt, messages);
    } else if (config.type === 'openai') {
      return this._callOpenAI(config, systemPrompt, messages);
    } else if (config.type === 'lmstudio') {
      return this._callLocal(config, systemPrompt, messages);
    }
    return Promise.reject(new Error('Unknown provider type'));
  }

  _callAnthropic(config, systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: config.model,
        max_tokens: 100,
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
            resolve((p.content?.[0]?.text || '').trim().slice(0, 60));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  _callGoogle(config, systemPrompt, messages) {
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
        generationConfig: { maxOutputTokens: 60 },
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
            resolve(text.trim().slice(0, 60));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
      req.write(body);
      req.end();
    });
  }

  _callOpenAI(config, systemPrompt, messages) {
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
        max_tokens: 60,
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
            resolve((p.choices?.[0]?.message?.content || '').trim().slice(0, 60));
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
  _callLocal(config, systemPrompt, messages) {
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
        max_tokens: 60,
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
            resolve((p.choices?.[0]?.message?.content || '').trim().slice(0, 60));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('LM Studio timeout')));
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
   * Parse [DELEGATE:Name:reason] — reason may contain colons; only the first ':' splits name from reason.
   * @returns {{ delegateTo: string, reason: string, fullMatch: string } | null}
   */
  _parseDelegateTag(text) {
    const m = text.match(/\[DELEGATE:([^\]]+)\]/);
    if (!m) return null;
    const inner = m[1].trim();
    const colon = inner.indexOf(':');
    if (colon === -1) return null;
    const delegateTo = inner.slice(0, colon).trim();
    const reason = inner.slice(colon + 1).trim();
    if (!delegateTo) return null;
    return { delegateTo, reason, fullMatch: m[0] };
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
      ? `\n\n## Your Memories\n${this._sanitize(rawMemory.slice(-800))}`
      : '';

    const coworkerContext = this._getCoworkerContext(npcName, 'CEO');

    // Build role-specific action list
    const roleActions = this._getRoleActions(npcName, h);

    const systemPrompt = `${brain.personality}${memorySection}

## Your Coworkers
${coworkerContext}

## Your Role & What You Can Do
You are ${npcName}, ${h?.title || brain.role}. The CEO (your ultimate boss) is talking to you directly.
${h?.reportsTo === 'CEO' ? 'You report directly to the CEO.' : `You report to ${h?.reportsTo}.`}
${h?.manages?.length > 0 ? `You manage: ${h.manages.join(', ')}.` : ''}

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

## Rules
- When the CEO asks you to DO something, always include an [ACTION:...] or [DELEGATE:...] tag.
- When just chatting/answering a question, no tag needed.
- You can chain multiple actions: "On it! [ACTION:speakTo:Josh:CEO wants the homepage fixed] [DELEGATE:Josh:frontend task]"
- Keep your spoken text under 60 characters. Be natural and professional.
- Respond in character as ${npcName}. Dialogue text first, then tags at the end.`;

    // Add to memory
    this.memories[npcName].push({ from: 'CEO', text: this._sanitize(message) });
    if (this.memories[npcName].length > 20) {
      this.memories[npcName] = this.memories[npcName].slice(-20);
    }

    const messages = this.memories[npcName].map(m => ({
      role: m.from === npcName ? 'assistant' : 'user',
      content: m.from === npcName ? m.text : `${m.from} says: "${m.text}"`,
    }));

    let responseText;
    try {
      responseText = await this._callProvider(brain.providerConfig, systemPrompt, messages);
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
          responseText = await this._callProvider(brain.fallbackConfig, systemPrompt, messages);
        } catch (e2) {
          responseText = null;
        }
      }
      // If all providers failed, use smart fallback that infers actions from the message
      if (!responseText) {
        responseText = this._smartFallback(npcName, message, h);
      }
    }

    if (typeof responseText !== 'string') {
      responseText = this._smartFallback(npcName, message, h);
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

    // Parse delegation tag [DELEGATE:Name:reason] (reason may include ':')
    let delegation = null;
    const parsedDelegate = this._parseDelegateTag(responseText);
    if (parsedDelegate) {
      const { delegateTo, reason, fullMatch } = parsedDelegate;
      if (this._hierarchy[delegateTo]) {
        delegation = { delegateTo, reason, originalMessage: message };
      } else {
        console.warn(`[NpcBrains] ${npcName} tried to delegate to unknown target: "${delegateTo}" — ignoring`);
      }
      responseText = responseText.replace(fullMatch, '').replace(/\s+$/, '').trim();
    }

    // If the AI responded but didn't include any actions or delegation,
    // and the player's message looks like a task request, inject smart fallback actions
    if (actions.length === 0 && !delegation) {
      // Use \\b on short tokens that are substrings of common chat ("going", etc.)
      const isTaskRequest = /fix|build|code|\bgo\b|check|test|deploy|research|call|meet|talk|tell|ask|schedule|design|review|run|look|find|make|create|set up|update|push|ship/i.test(message);
      if (isTaskRequest) {
        const fallbackText = this._smartFallback(npcName, message, h);
        // Extract actions from the fallback text
        const fbActionRegex = /\[ACTION:([^\]]+)\]/g;
        let fbMatch;
        while ((fbMatch = fbActionRegex.exec(fallbackText)) !== null) {
          const parts = fbMatch[1].split(':');
          actions.push({ action: parts[0].trim(), params: parts.slice(1).map(p => p.trim()) });
        }
        const fbDel = this._parseDelegateTag(fallbackText);
        if (fbDel && this._hierarchy[fbDel.delegateTo]) {
          delegation = { delegateTo: fbDel.delegateTo, reason: fbDel.reason, originalMessage: message };
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
