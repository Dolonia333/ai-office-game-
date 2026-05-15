'use strict';
/**
 * OpenClaw Dispatch — classify a player utterance and route it.
 *
 * Two questions:
 *   1. Is this an action request ("deploy v2 to staging") or casual chat
 *      ("hey Abby, how's it going")?
 *   2. If action, send it to OpenClaw to actually run a tool. If chat,
 *      let the existing NPC brain answer.
 *
 * The classifier is pure: text in, `'action' | 'chat'` out, plus a few
 * derived hints (urgency, suggested target). Tested in isolation.
 *
 * The dispatcher is browser-only — it knows about
 * `window.__DenizenGatewayBridge` and `window.__DenizenPlayerChat`. It
 * uses the existing gateway-bridge.request() infrastructure to send
 * over WebSocket. The actual gateway method name is configurable
 * because OpenClaw's chat-send protocol may differ between versions —
 * defaults to 'chat.send', overridable via window.DenizenOpenClawChatMethod.
 */

// =====================================================================
// Pure classifier (CJS)
// =====================================================================

// Verbs that strongly suggest "do this now" rather than conversation.
const ACTION_VERBS = new Set([
  // Software / shell
  'deploy', 'ship', 'release', 'build', 'compile', 'install', 'restart',
  'run', 'execute', 'start', 'stop', 'kill', 'pause', 'resume',
  'fix', 'patch', 'rollback', 'revert',
  'create', 'make', 'generate', 'scaffold', 'init',
  'delete', 'remove', 'rm', 'drop',
  'rename', 'move', 'mv', 'copy', 'cp',
  'open', 'close',
  // Source control
  'commit', 'push', 'pull', 'merge', 'rebase', 'cherry-pick', 'branch',
  // Data / IO
  'read', 'write', 'save', 'load', 'fetch', 'download', 'upload',
  'search', 'find', 'lookup', 'query', 'list', 'show',
  // Comms
  'send', 'email', 'post', 'tweet', 'dm', 'message', 'notify', 'alert',
  // Web
  'browse', 'navigate', 'screenshot', 'scrape',
  // Generic ops
  'check', 'verify', 'test', 'review', 'audit', 'monitor',
  'schedule', 'cron', 'cancel', 'reschedule',
]);

// Tool/skill keywords that mark a sentence as action-y even without a verb.
const TOOL_KEYWORDS = [
  /\bgithub\b/i, /\bgit\b/i, /\bpull request\b/i, /\bpr\b/i, /\bissue\b/i,
  /\bsupabase\b/i, /\bdatabase\b/i, /\bsql\b/i, /\bschema\b/i,
  /\bbrowser\b/i, /\bnavigate\b/i, /\bscreenshot\b/i,
  /\bdeploy\b/i, /\bstaging\b/i, /\bproduction\b/i, /\bprod\b/i,
  /\bbash\b/i, /\bshell\b/i, /\bterminal\b/i, /\bcommand\b/i,
  /\bn8n\b/i, /\bworkflow\b/i, /\bpipeline\b/i, /\bci\b/i,
  /\bweather\b/i, /\bspotify\b/i,
];

// Markers that strongly indicate CHAT (override action heuristics).
const CHAT_MARKERS = [
  /\bhow are you\b/i, /\bhow's it going\b/i, /\bgood morning\b/i,
  /\bgood afternoon\b/i, /\bgood evening\b/i, /\bhello\b/i, /\bhi\b/i,
  /\bthanks\b/i, /\bthank you\b/i, /\bnice\b/i, /\bcool\b/i,
  /\bwhat do you think\b/i, /\bdo you think\b/i,
];

// Explicit prefix overrides.
const FORCE_ACTION_PREFIX = /^\s*\/(do|run|exec|action)\b\s*/i;
const FORCE_CHAT_PREFIX   = /^\s*\/(say|chat|talk)\b\s*/i;

/**
 * Classify a player utterance.
 *
 * @param {string} text
 * @returns {{ kind: 'action'|'chat', confidence: number,
 *             stripped: string, urgent: boolean, reason: string }}
 *
 * `stripped` is the input with any /command prefix removed — what you
 * should actually send to the destination.
 */
function classify(text) {
  const raw = String(text || '');
  if (!raw.trim()) {
    return { kind: 'chat', confidence: 0, stripped: '', urgent: false, reason: 'empty' };
  }

  // Explicit overrides first.
  if (FORCE_ACTION_PREFIX.test(raw)) {
    return { kind: 'action', confidence: 1.0, stripped: raw.replace(FORCE_ACTION_PREFIX, ''), urgent: false, reason: '/do prefix' };
  }
  if (FORCE_CHAT_PREFIX.test(raw)) {
    return { kind: 'chat', confidence: 1.0, stripped: raw.replace(FORCE_CHAT_PREFIX, ''), urgent: false, reason: '/say prefix' };
  }

  const text2 = raw.trim();
  const lower = text2.toLowerCase();
  const stripped = text2;

  // Question marks lean toward chat unless the verb is unmistakably an action.
  const isQuestion = /[?]\s*$/.test(text2);

  // Chat markers are sticky.
  for (const re of CHAT_MARKERS) {
    if (re.test(text2)) {
      return { kind: 'chat', confidence: 0.85, stripped, urgent: false, reason: `chat marker: ${re}` };
    }
  }

  // Imperative-form check: first word is an action verb.
  const firstWord = (lower.match(/^[a-z][a-z'-]*/i) || [''])[0];
  const isImperativeStart = ACTION_VERBS.has(firstWord);

  // Tool keyword presence.
  let toolHits = 0;
  for (const re of TOOL_KEYWORDS) if (re.test(text2)) toolHits++;

  // "please <verb>" pattern.
  const polite = /^(please|hey|can you|could you|would you|will you)\s+([a-z][a-z'-]*)/i.exec(text2);
  const politeVerb = polite ? polite[2].toLowerCase() : '';
  const isPoliteImperative = polite && ACTION_VERBS.has(politeVerb);

  // Urgent flag.
  const urgent = /\b(now|asap|right now|immediately|urgently|stat)\b/i.test(text2);

  // Decision.
  let kind = 'chat';
  let confidence = 0.5;
  let reason = 'default';

  if (isImperativeStart) {
    kind = 'action';
    confidence = isQuestion ? 0.65 : 0.9;
    reason = `imperative verb: ${firstWord}`;
  } else if (isPoliteImperative) {
    kind = 'action';
    confidence = isQuestion ? 0.6 : 0.85;
    reason = `polite imperative: ${politeVerb}`;
  } else if (toolHits >= 2) {
    kind = 'action';
    confidence = 0.75;
    reason = `${toolHits} tool keywords`;
  } else if (toolHits === 1 && !isQuestion) {
    kind = 'action';
    confidence = 0.6;
    reason = '1 tool keyword';
  } else {
    kind = 'chat';
    confidence = isQuestion ? 0.85 : 0.7;
    reason = isQuestion ? 'question form' : 'no action signal';
  }

  return { kind, confidence, stripped, urgent, reason };
}

const _api = {
  classify,
  ACTION_VERBS,
  TOOL_KEYWORDS,
  CHAT_MARKERS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _api;
}

// =====================================================================
// Browser dispatcher (skipped under Node — gated on `window`)
// =====================================================================

if (typeof window !== 'undefined') {

  const DEFAULT_GATEWAY_METHOD = 'chat.send';

  async function sendToGateway(text, opts = {}) {
    const bridge = window.__DenizenGatewayBridge;
    if (!bridge || !bridge.connected) {
      return { ok: false, error: 'gateway not connected', via: 'gateway' };
    }
    const method = window.DenizenOpenClawChatMethod || DEFAULT_GATEWAY_METHOD;
    try {
      const res = await bridge.request(method, {
        text,
        urgent: !!opts.urgent,
        source: 'denizen-player',
      });
      return { ok: true, response: res, via: 'gateway' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), via: 'gateway' };
    }
  }

  async function sendToHttpProxy(text, opts = {}) {
    // Fallback path — POST to the OpenClaw HTTP proxy.
    // Endpoint is overridable via window.DenizenOpenClawChatPath (defaults to /openclaw/api/chat).
    const path = window.DenizenOpenClawChatPath || '/openclaw/api/chat';
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, urgent: !!opts.urgent, source: 'denizen-player' }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, via: 'http' };
      let body = null;
      try { body = await res.json(); } catch (_) { body = await res.text(); }
      return { ok: true, response: body, via: 'http' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), via: 'http' };
    }
  }

  /**
   * Dispatch a player utterance.
   * 1. Classify.
   * 2. If action: try gateway → then HTTP fallback. Surface result.
   * 3. If chat: forward to PlayerChat.sendMessage (existing path).
   * Returns { kind, ok, via, error?, classification }
   */
  async function dispatch(text, opts = {}) {
    const c = classify(text);
    const out = { ...c };

    if (c.kind === 'chat') {
      if (window.__DenizenPlayerChat?.sendMessage) {
        try { window.__DenizenPlayerChat.sendMessage(c.stripped); }
        catch (err) { out.ok = false; out.error = err?.message; return out; }
        out.ok = true; out.via = 'player-chat';
        return out;
      }
      out.ok = false; out.error = 'no PlayerChat available'; return out;
    }

    // Action — gateway first
    let r = await sendToGateway(c.stripped, { urgent: c.urgent });
    if (r.ok) return { ...out, ...r };

    // Fall back to HTTP
    const r2 = await sendToHttpProxy(c.stripped, { urgent: c.urgent });
    if (r2.ok) return { ...out, ...r2, gatewayError: r.error };

    // Both failed — emit a visible error in the chat log AND fall back to chat.
    if (window.__DenizenPlayerChat?.sendMessage) {
      try { window.__DenizenPlayerChat.sendMessage(c.stripped); }
      catch (_) {}
      return { ...out, ok: false, via: 'fallback-chat',
               error: `gateway: ${r.error}; http: ${r2.error}` };
    }
    return { ...out, ok: false, error: `gateway: ${r.error}; http: ${r2.error}` };
  }

  window.DenizenOpenClawDispatch = { classify, dispatch, sendToGateway, sendToHttpProxy };
}
