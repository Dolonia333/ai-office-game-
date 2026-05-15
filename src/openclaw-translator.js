'use strict';
/**
 * OpenClaw Translator — pure functions that turn OpenClaw gateway events
 * into "intents" the rest of Denizen can execute.
 *
 * Why split this from the runner: it's deterministic and side-effect-free,
 * which means it can be unit-tested without DOM, fetch, WebSocket, or a
 * Phaser scene. The runner (`src/openclaw-worldstate-bridge.js`) is a
 * thin wrapper that just executes whatever intents this module returns.
 *
 * Module style: CommonJS so Node tests can `require()` it directly. The
 * browser also loads it as a classic script (it just defines globals
 * via the IIFE wrapper at the bottom — see openclaw-worldstate-bridge.js
 * for the consumer).
 */

// =====================================================================
// Tool classification — extended for the current OpenClaw skill set.
// =====================================================================

const TOOL_CLASSIFIER = {
  // Reading / lookup
  Read: 'research', Glob: 'research', Grep: 'research',
  ToolSearch: 'research', ListDir: 'research', Find: 'research',
  // Web
  WebFetch: 'web', WebSearch: 'web',
  // Editing / writing
  Edit: 'code', Write: 'code', MultiEdit: 'code', NotebookEdit: 'code',
  // Shell / process
  Bash: 'terminal', PowerShell: 'terminal', Process: 'terminal',
  // Delegation
  Task: 'delegate', Agent: 'delegate', Subagent: 'delegate',
  // Plans / todos
  ExitPlanMode: 'plan', EnterPlanMode: 'plan',
  TodoWrite: 'todo',
  // Browser / vision (newer OpenClaw skills)
  // browserclaw + visionclaw export tools under their plugin namespaces
  // — tools tend to start with browser_ or vision_ once unwrapped
};

const SKILL_KIND_HINTS = [
  // Each entry: { match: RegExp, kind, label, npcRoleHint }
  { match: /^mcp__/i,                     kind: 'delegate',  label: 'MCP call',         npcRoleHint: null },
  { match: /^browser|browserclaw/i,       kind: 'web',       label: 'Browsing',         npcRoleHint: 'researcher' },
  { match: /^vision|visionclaw|screenshot/i, kind: 'research', label: 'Looking',        npcRoleHint: 'researcher' },
  { match: /^supabase|supabase-bridge/i,  kind: 'database',  label: 'Database',         npcRoleHint: 'data engineer' },
  { match: /^github|gh_/i,                kind: 'devops',    label: 'GitHub',           npcRoleHint: 'devops' },
  { match: /^pdf/i,                       kind: 'code',      label: 'PDF',              npcRoleHint: 'designer' },
  { match: /^canvas/i,                    kind: 'code',      label: 'Canvas',           npcRoleHint: 'designer' },
  { match: /^resume/i,                    kind: 'research',  label: 'Resume',           npcRoleHint: 'pm' },
  { match: /^job/i,                       kind: 'research',  label: 'Job',              npcRoleHint: 'pm' },
  { match: /^spotify|music/i,             kind: 'idle',      label: 'Music',            npcRoleHint: null },
  { match: /^weather/i,                   kind: 'research',  label: 'Weather',          npcRoleHint: null },
  { match: /^lm-studio|lm_studio/i,       kind: 'code',      label: 'LM Studio',        npcRoleHint: 'developer' },
  { match: /^skill-creator|create-skill/i,kind: 'code',      label: 'Building skill',   npcRoleHint: 'developer' },
];

const TOOL_LABELS = {
  research: { text: 'Reading',       color: '#60a5fa' },
  web:      { text: 'Web search',    color: '#60a5fa' },
  code:     { text: 'Writing code',  color: '#4ade80' },
  terminal: { text: '$ terminal',    color: '#22d3ee' },
  delegate: { text: 'Delegating',    color: '#fbbf24' },
  plan:     { text: 'Planning',      color: '#a78bfa' },
  todo:     { text: 'Todos',         color: '#a78bfa' },
  database: { text: 'Database',      color: '#34d399' },
  devops:   { text: 'DevOps',        color: '#fb7185' },
  idle:     { text: 'Idle',          color: '#9ca3af' },
  generic:  { text: 'Working',       color: '#4ade80' },
};

/**
 * Classify a tool name into a visual kind. Order:
 *   1. Exact match against TOOL_CLASSIFIER
 *   2. SKILL_KIND_HINTS regex match
 *   3. Heuristic fallback on the tool name
 *
 * @param {string} name
 * @returns {string} kind
 */
function classifyTool(name) {
  if (!name || typeof name !== 'string') return 'generic';
  if (TOOL_CLASSIFIER[name]) return TOOL_CLASSIFIER[name];
  for (const hint of SKILL_KIND_HINTS) {
    if (hint.match.test(name)) return hint.kind;
  }
  if (/read|list|get|search|find|fetch/i.test(name)) return 'research';
  if (/write|edit|create|update|patch|save/i.test(name)) return 'code';
  if (/run|exec|bash|shell|spawn/i.test(name)) return 'terminal';
  if (/delegate|spawn|task/i.test(name)) return 'delegate';
  return 'generic';
}

/**
 * Suggest an NPC role for a tool. Used by the auto-assigner to pick a
 * coherent NPC instead of round-robin (e.g. database tools → Pier).
 * Returns null if no opinion.
 */
function suggestRoleForTool(name) {
  if (!name || typeof name !== 'string') return null;
  for (const hint of SKILL_KIND_HINTS) {
    if (hint.match.test(name) && hint.npcRoleHint) return hint.npcRoleHint;
  }
  return null;
}

function labelForTool(name) {
  const kind = classifyTool(name);
  // Prefer skill-specific labels (e.g. "GitHub" not "Working")
  for (const hint of SKILL_KIND_HINTS) {
    if (hint.match.test(name)) return { ...TOOL_LABELS[kind] || TOOL_LABELS.generic, text: hint.label };
  }
  return TOOL_LABELS[kind] || TOOL_LABELS.generic;
}

// =====================================================================
// Mapping resolver — agentId → NPC display name.
// Stateful only across one translation call; the runner persists.
// =====================================================================

/**
 * Pick or remember which NPC plays a given OpenClaw agent.
 * `mapping` is a mutable map; this function may insert into it.
 *
 * @param {string} agentId
 * @param {string} agentName       — OpenClaw's friendly name, if any
 * @param {string|null} roleHint   — from suggestRoleForTool()
 * @param {Map<string,string>} mapping  — agentId → npcName
 * @param {string[]} availableNpcs       — NPCs not yet assigned
 * @param {Object<string,string>} npcRoles  — npcName → role text
 * @returns {string|null} chosen npcName
 */
function resolveAgent(agentId, agentName, roleHint, mapping, availableNpcs, npcRoles) {
  if (!agentId) return null;
  if (mapping.has(agentId)) return mapping.get(agentId);

  // Try to honor the role hint (e.g. database tool → an NPC whose role mentions "data")
  if (roleHint && npcRoles) {
    const want = roleHint.toLowerCase();
    const idx = availableNpcs.findIndex(n => (npcRoles[n] || '').toLowerCase().includes(want));
    if (idx !== -1) {
      const match = availableNpcs.splice(idx, 1)[0]; // consume from the pool
      mapping.set(agentId, match);
      return match;
    }
  }

  // Fall back to round-robin from the available pool. Splice consumes
  // the chosen NPC so two distinct agents don't map to the same NPC
  // until the pool is exhausted. Once exhausted, fall back to reusing.
  if (availableNpcs.length > 0) {
    const chosen = availableNpcs.shift();
    mapping.set(agentId, chosen);
    return chosen;
  }
  // Last resort: pick any NPC whose name is already in mapping
  for (const v of mapping.values()) return v;
  return null;
}

// =====================================================================
// Translation — gateway event → intents.
// =====================================================================

/**
 * @typedef {Object} Intent
 * @property {string} kind      — 'task-update'|'agent-bus'|'speak'|'event'|'presence'|'threat'
 * @property {Object} body      — payload to apply
 * @property {string} [npc]     — for 'speak' intents
 */

/**
 * Translate a single gateway event into zero or more intents.
 *
 * @param {Object} input
 * @param {string} input.event              — gateway event name (rare; usually unused)
 * @param {Object} input.payload            — gateway event payload
 * @param {Map<string,string>} input.mapping — agentId → npcName, mutable
 * @param {string[]} input.availableNpcs
 * @param {Object<string,string>} input.npcRoles  — npcName → role
 * @param {Map<string,Object>} input.toolState    — toolCallId → { startedAt, name, npc }
 * @returns {Intent[]}
 */
function translateEvent({ event, payload, mapping, availableNpcs, npcRoles, toolState }) {
  if (!payload) return [];
  const intents = [];

  const agentId = payload.agentId || payload.runId || payload.sessionKey || 'default';
  const agentName = payload.agentName || payload.name || null;

  // Tool calls — the most interesting case.
  if (payload.stream === 'tool' && payload.data) {
    const toolName = payload.data.name || payload.data.tool || 'tool';
    const toolCallId = payload.data.id || payload.data.toolUseId || `${agentId}:${Date.now()}`;
    const phase = payload.data.phase || (payload.data.result !== undefined ? 'end' : 'start');
    const roleHint = suggestRoleForTool(toolName);
    const npc = resolveAgent(agentId, agentName, roleHint, mapping, availableNpcs, npcRoles);

    if (!npc) return [];

    const label = labelForTool(toolName);

    if (phase === 'start') {
      toolState.set(toolCallId, { startedAt: Date.now(), name: toolName, npc });
      intents.push({
        kind: 'task-update',
        body: {
          id: toolCallId,
          source: 'openclaw',
          title: `${label.text} — ${toolName}`,
          status: 'running',
          assignee: npc,
          detail: agentName || agentId,
          foreground: true,
        },
      });
      intents.push({
        kind: 'speak',
        npc,
        text: label.text,
      });
      intents.push({
        kind: 'event',
        body: { kind: 'tool-start', text: `${npc}: ${label.text} (${toolName})` },
      });
    } else if (phase === 'end' || phase === 'complete' || phase === 'success') {
      const prior = toolState.get(toolCallId);
      toolState.delete(toolCallId);
      intents.push({
        kind: 'task-update',
        body: {
          id: toolCallId,
          status: 'done',
          // preserve title from start if we have it
          ...(prior ? { title: `${labelForTool(prior.name).text} — ${prior.name}` } : {}),
        },
      });
      intents.push({
        kind: 'event',
        body: { kind: 'shipped', text: `${npc} finished ${prior?.name || toolName}` },
      });
    } else if (phase === 'error' || phase === 'fail' || phase === 'failure') {
      const prior = toolState.get(toolCallId);
      toolState.delete(toolCallId);
      intents.push({
        kind: 'task-update',
        body: { id: toolCallId, status: 'failed' },
      });
      intents.push({
        kind: 'event',
        body: { kind: 'blocker', text: `${npc} failed ${prior?.name || toolName}` },
      });
      intents.push({
        kind: 'speak',
        npc,
        text: `Hit an error on ${prior?.name || toolName}.`,
      });
    }
    return intents;
  }

  // Lifecycle events (agent start/end/error).
  if (payload.stream === 'lifecycle' && payload.data) {
    const phase = payload.data.phase;
    const npc = resolveAgent(agentId, agentName, null, mapping, availableNpcs, npcRoles);
    if (!npc) return intents;
    if (phase === 'start') {
      intents.push({
        kind: 'event',
        body: { kind: 'agent-start', text: `${npc} agent started${agentName ? ` (${agentName})` : ''}` },
      });
      intents.push({ kind: 'speak', npc, text: 'Starting work.' });
    } else if (phase === 'end') {
      intents.push({
        kind: 'event',
        body: { kind: 'shipped', text: `${npc} agent done` },
      });
      intents.push({ kind: 'speak', npc, text: 'All done.' });
    } else if (phase === 'error') {
      intents.push({
        kind: 'event',
        body: { kind: 'blocker', text: `${npc} agent errored` },
      });
      intents.push({ kind: 'speak', npc, text: 'Something went wrong.' });
    }
    return intents;
  }

  // Assistant-stream (LLM thought/text). Throttle and only relay finals so
  // we don't fire 50 voice clips per response.
  if (payload.stream === 'assistant' && payload.data?.text && payload.data?.final) {
    const npc = resolveAgent(agentId, agentName, null, mapping, availableNpcs, npcRoles);
    if (!npc) return intents;
    const text = String(payload.data.text).slice(0, 200);
    intents.push({ kind: 'speak', npc, text });
    intents.push({
      kind: 'event',
      body: { kind: 'agent-message', text: `${npc}: ${text.slice(0, 80)}` },
    });
    return intents;
  }

  // Inter-agent messages → publish on the agent bus.
  if (payload.stream === 'message' && payload.data) {
    const fromAgent = payload.data.fromAgentId || agentId;
    const toAgent = payload.data.toAgentId;
    if (!toAgent) return intents;
    const fromNpc = resolveAgent(fromAgent, null, null, mapping, availableNpcs, npcRoles);
    const toNpc = resolveAgent(toAgent, null, null, mapping, availableNpcs, npcRoles);
    if (!fromNpc || !toNpc) return intents;
    intents.push({
      kind: 'agent-bus',
      body: { to: toNpc, from: fromNpc, text: String(payload.data.text || '').slice(0, 600), kind: 'speak' },
    });
    return intents;
  }

  return intents;
}

const _api = {
  classifyTool,
  suggestRoleForTool,
  labelForTool,
  resolveAgent,
  translateEvent,
  TOOL_LABELS,
  SKILL_KIND_HINTS,
};

// Dual export — CJS for Node tests, global for the browser script tag.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = _api;
}
if (typeof window !== 'undefined') {
  window.OpenClawTranslator = _api;
}
