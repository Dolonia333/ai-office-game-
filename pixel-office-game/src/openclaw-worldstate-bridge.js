/**
 * OpenClaw → WorldState Bridge (browser).
 *
 * Subscribes to the existing GatewayBridge (the OpenClaw WebSocket
 * client that the original NpcAgentController also listens to) and
 * translates every event into the new layers shipped in Phases 2–5:
 *
 *   - WorldState `backgroundTasks`  (POST /api/task-update)
 *   - WorldState `recentEvents`     (POST /api/task-update fires this transitively)
 *   - AgentBus                       (POST /api/agent-bus)
 *   - Voice                          (window.DenizenSpeak — gated on presence)
 *
 * IMPORTANT: this runs PARALLEL to the existing NpcAgentController.
 * That controller continues to drive sprite movement + speech bubbles.
 * This bridge handles voice + worldState + tasks — the new surface area.
 * Both share the same GatewayBridge events; their outputs don't overlap.
 *
 * Persistence: agentId→npc assignments are saved to localStorage so a
 * reload doesn't shuffle who plays which agent. Wipe the
 * `denizen.openclaw.mapping` key in DevTools to reset.
 */
(function () {
  'use strict';

  // The translator is loaded via <script>; pull the symbols off `window`.
  // (We don't bundle, and keeping it global lets test harnesses load it
  // through `require()` server-side without patching the browser file.)
  const T = window.OpenClawTranslator;
  if (!T) {
    console.warn('[OpenClawBridge] openclaw-translator.js not loaded — worldstate bridge disabled');
    return;
  }

  const STORAGE_KEY = 'denizen.openclaw.mapping';
  const MAP_URL = '/data/openclaw-agent-map.json';

  let mapping = new Map();
  let availableNpcs = [];
  let npcRoles = {};
  const toolState = new Map();
  let attached = false;

  // -- mapping load / save -------------------------------------------------

  function loadMappingFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    } catch (_) {
      return new Map();
    }
  }

  function saveMappingToStorage() {
    try {
      const obj = {};
      for (const [k, v] of mapping.entries()) obj[k] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (_) { /* private mode etc */ }
  }

  async function loadConfig() {
    try {
      const res = await fetch(MAP_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const cfg = await res.json();
      // Defaults from the file are layered UNDER what's in localStorage.
      const defaults = cfg.default || {};
      const fromStorage = loadMappingFromStorage();
      mapping = new Map(Object.entries(defaults));
      for (const [k, v] of fromStorage.entries()) mapping.set(k, v);
      npcRoles = cfg.npcRoles || {};
    } catch (_) {
      mapping = loadMappingFromStorage();
    }
  }

  // -- intent execution ----------------------------------------------------

  async function postJson(path, body) {
    try {
      await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network blip — log once, don't spam.
      console.warn(`[OpenClawBridge] POST ${path} failed:`, err?.message || err);
    }
  }

  function executeIntent(intent) {
    if (!intent || !intent.kind) return;
    switch (intent.kind) {
      case 'task-update':
        postJson('/api/task-update', intent.body);
        break;
      case 'agent-bus':
        postJson('/api/agent-bus', intent.body);
        break;
      case 'speak':
        if (typeof window.DenizenSpeak === 'function') {
          // Voice gate enforces presence; we never speak when presence is off.
          try { window.DenizenSpeak(intent.npc, intent.text); }
          catch (_) {}
        }
        break;
      case 'event':
        // No public POST endpoint for raw events yet — most callers just
        // use task-update with status. Fold in here if needed later.
        break;
      default:
        break;
    }
  }

  function refreshAvailableNpcs() {
    // Read from the live scene if it's around, otherwise fall back to the
    // npc-roster names. The roster is the canonical 16; the scene's npcs
    // array is what's actually loaded right now (may exclude any disabled).
    if (window.__DenizenScene && Array.isArray(window.__DenizenScene.npcs)) {
      availableNpcs = window.__DenizenScene.npcs
        .map(n => n.texture?.key)
        .filter(Boolean)
        // texture key is e.g. 'xp_alex' — translator wants display names
        .map(k => k.replace(/^xp_/, '').replace(/^./, c => c.toUpperCase()));
    } else if (window.DenizenNpcRoster) {
      availableNpcs = [...window.DenizenNpcRoster.displayNames];
    }
    // De-duplicate; keep the first occurrence (rotation order).
    availableNpcs = [...new Set(availableNpcs)];
  }

  // -- gateway wiring ------------------------------------------------------

  function attachToGateway() {
    if (attached) return;
    const bridge = window.__DenizenGatewayBridge;
    if (!bridge || typeof bridge.addEventListener !== 'function') return;

    const handler = (event) => (evt) => {
      const intents = T.translateEvent({
        event,
        payload: evt.detail,
        mapping,
        availableNpcs,
        npcRoles,
        toolState,
      });
      // Persist any new agent→NPC assignments the translator made.
      if (intents.length > 0) saveMappingToStorage();
      for (const i of intents) executeIntent(i);
    };

    bridge.addEventListener('agent', handler('agent'));
    bridge.addEventListener('chat', handler('chat'));
    bridge.addEventListener('presence', handler('presence'));
    bridge.addEventListener('gateway-event', (evt) => {
      // Catch-all — translator inspects payload.stream/data
      const intents = T.translateEvent({
        event: evt.detail?.event,
        payload: evt.detail?.payload,
        mapping,
        availableNpcs,
        npcRoles,
        toolState,
      });
      if (intents.length > 0) saveMappingToStorage();
      for (const i of intents) executeIntent(i);
    });

    attached = true;
    console.log('[OpenClawBridge] worldstate bridge attached');
  }

  async function init() {
    await loadConfig();
    refreshAvailableNpcs();

    // The gateway bridge is created by office-scene.js after the scene boots.
    // Poll until it appears, then attach. Stops polling once attached.
    const interval = setInterval(() => {
      refreshAvailableNpcs();
      if (window.__DenizenGatewayBridge) {
        attachToGateway();
        if (attached) clearInterval(interval);
      }
    }, 500);

    // Stop trying after 60s — the user just isn't using OpenClaw.
    setTimeout(() => clearInterval(interval), 60000);
  }

  // Surface a debug API.
  window.DenizenOpenClawBridge = {
    get mapping() { return Object.fromEntries(mapping); },
    reset() { mapping = new Map(); try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} },
    refresh: refreshAvailableNpcs,
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
