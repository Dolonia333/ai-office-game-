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
      console.warn('[NpcBrains] Failed to load providers:', err.message);
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
      const provider = providerMatch?.[1] || 'claude';
      const role = roleMatch?.[1]?.trim() || 'Employee';

      const providerConfig = this.providers[provider] || this.providers.claude;
      if (!providerConfig) continue;

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
    try {
      const folder = this._nameToFolder[npcName] || npcName.toLowerCase();
      const memPath = path.join(__dirname, '..', 'npcs', folder, 'MEMORY.md');
      const timestamp = new Date().toISOString().slice(0, 16);
      fs.appendFileSync(memPath, `\n- [${timestamp}] ${entry}`);
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
      // Last resort: canned response
      const canned = [
        'Got it, on it!', 'Sure thing.', 'Working on that.',
        'Sounds good.', 'Let me check.', 'Almost done.',
      ];
      return canned[Math.floor(Math.random() * canned.length)];
    }
  }

  /**
   * Call an AI provider API
   */
  _callProvider(config, systemPrompt, messages) {
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
}

module.exports = NpcBrainManager;
