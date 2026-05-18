const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const SecurityMonitorServer = require('./security-monitor-server');
const CofounderAgent = require('./src/cofounder-agent');
const NpcBrainManager = require('./src/npc-brains');
const worldState = require('./src/world-state');
const agentBus = require('./src/agent-bus');
const ExternalSink = require('./src/external-sink');
const elevenLabs = require('./src/elevenlabs-tts');
const animationForge = require('./src/animation-forge');

// Voice map (per-NPC ElevenLabs voice IDs). Loaded once at startup;
// edit data/voice-map.json + restart to change. Missing file → empty map
// → every NPC uses the default voice.
let _voiceMap = { default: {}, npcs: {} };
try {
  _voiceMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'voice-map.json'), 'utf8'));
} catch (_) { /* optional */ }

const PORT = process.env.PORT || 8080;
const STT_MAX_AUDIO_BYTES = 12 * 1024 * 1024; // 12MB hard cap

function _resolveSttConfig() {
  const apiKey = process.env.OPENAI_WHISPER_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_WHISPER_MODEL || 'whisper-1';
  const baseUrl = (process.env.OPENAI_WHISPER_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const source = process.env.OPENAI_WHISPER_API_KEY
    ? 'OPENAI_WHISPER_API_KEY'
    : (process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : null);
  return {
    configured: !!apiKey,
    apiKey,
    model,
    baseUrl,
    source,
  };
}

function _readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error(`payload too large (>${limitBytes} bytes)`));
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`invalid JSON: ${err.message}`));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function _buildMultipartForm(parts) {
  const boundary = `----denizen-${crypto.randomBytes(12).toString('hex')}`;
  const bodyParts = [];

  for (const part of parts) {
    const header = [];
    header.push(`--${boundary}`);
    if (part.filename) {
      header.push(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`);
      header.push(`Content-Type: ${part.contentType || 'application/octet-stream'}`);
      bodyParts.push(Buffer.from(`${header.join('\r\n')}\r\n\r\n`, 'utf8'));
      bodyParts.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value || ''), 'utf8'));
      bodyParts.push(Buffer.from('\r\n', 'utf8'));
    } else {
      header.push(`Content-Disposition: form-data; name="${part.name}"`);
      bodyParts.push(Buffer.from(`${header.join('\r\n')}\r\n\r\n${String(part.value || '')}\r\n`, 'utf8'));
    }
  }

  bodyParts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    boundary,
    body: Buffer.concat(bodyParts),
  };
}

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Server] Unhandled rejection (kept alive):', err?.message || err);
});
// Serve from the project directory — all assets are now in assets/
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

const OPENCLAW_HOST = '127.0.0.1';
const OPENCLAW_PORT = 18789;

// --- Security Monitor ---
const securityMonitor = new SecurityMonitorServer({
  watchDirs: [
    path.resolve(__dirname),  // watch the game directory
  ],
  failedLoginThreshold: 3,
  portScanThreshold: 10,
  apiRateLimit: 100,
});
// Mirror threat events into the live WorldState so NPC brains and the UI
// share a single source of truth for "what's currently bad in the office".
if (typeof securityMonitor.setWorldState === 'function') {
  securityMonitor.setWorldState(worldState);
}
securityMonitor.start();

// --- Cofounder Agent (CTO AI brain) ---
const npcBrains = new NpcBrainManager();
const cofounderAgent = new CofounderAgent();
cofounderAgent.npcBrains = npcBrains; // Give the director access to individual NPC brains

// --- Furniture-placement whitelist + per-NPC daily budget ---
// The whitelist is shared between /api/place-furniture and the prompt
// hint in src/npc-brains.js. Edit both together if you ever expand it.
// Daily budget keeps a chatty NPC from spamming the office with couches.
const ALLOWED_PREFABS = new Set([
  'desk_small', 'desk_2x2', 'office_chair', 'monitor',
  'plant_small', 'plant_large', 'whiteboard', 'bookshelf',
  'coffee_machine', 'water_cooler', 'couch', 'rug',
  'standing_desk', 'phone_booth', 'meeting_table',
]);
const PLACEMENT_BUDGET_PER_DAY = 3;
const _placementBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _budgetKey(by) {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${by}|${ymd}`;
}
function _checkPlacementBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, placedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const placedToday = _placementBudget.get(k) || 0;
  return {
    allowed: placedToday < PLACEMENT_BUDGET_PER_DAY,
    placedToday,
    cap: PLACEMENT_BUDGET_PER_DAY,
  };
}
function _consumePlacementBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _placementBudget.set(k, (_placementBudget.get(k) || 0) + 1);
}

// --- Per-NPC daily animation request budget ---
// Same shape as the placement budget, lower cap. Animation requests are
// heavier review work for the operator (each one might trigger image-
// generation cost) so we want NPCs to be picky about asking.
const ANIMATION_BUDGET_PER_DAY = 2;
const _animationBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _checkAnimationBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, requestedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const requestedToday = _animationBudget.get(k) || 0;
  return {
    allowed: requestedToday < ANIMATION_BUDGET_PER_DAY,
    requestedToday,
    cap: ANIMATION_BUDGET_PER_DAY,
  };
}
function _consumeAnimationBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _animationBudget.set(k, (_animationBudget.get(k) || 0) + 1);
}

// Recent NPC-brain errors, surfaced through GET /api/health so the client
// diagnostic widget can show them without the user opening the terminal.
global._npcRecentErrors = global._npcRecentErrors || [];
function _recordNpcError(message) {
  const entry = { ts: Date.now(), message: String(message).slice(0, 400) };
  global._npcRecentErrors.push(entry);
  if (global._npcRecentErrors.length > 20) {
    global._npcRecentErrors = global._npcRecentErrors.slice(-20);
  }
}

// Counters so the diag panel can show "did this even arrive at the
// server?" When the user reports 'no response' but the server saw zero
// player_chat messages, that's a clear client-side issue — not a brain
// failure. Without this we'd be guessing.
global._npcStats = global._npcStats || {
  playerChatReceived: 0, playerChatSucceeded: 0, playerChatFailed: 0,
  npcConvReceived: 0,    npcConvSucceeded: 0,    npcConvFailed: 0,
  lastPlayerChatAt: null, lastNpcConvAt: null,
};

// --- External sinks (Supabase / n8n outbound webhooks) ---
// Forwards filtered worldState change events to whatever HTTP endpoints
// the operator has configured via env vars. No-op when no env vars are set.
const externalSink = new ExternalSink({ worldState });
externalSink.attach();

// --- WorldState change broadcast (throttled) ---
// Whenever any subsystem mutates the world, queue a delta for every
// connected /agent-ws client. Without throttling, a busy moment (e.g. a
// tshark burst + every NPC thinking on the same tick) can fire dozens of
// `change` events in <50ms, each cutting its own JSON.stringify and ws.send
// per client. Coalesce into 500ms windows: the latest snapshot wins per
// `kind`, and a single combined frame goes out at most twice per second.
//
// `presence` is special-cased: that flag is human-toggled and the UI must
// feel instant, so we bypass the throttle for it. `threat` is also passed
// through because a robber spawning >500ms after the bubble fires looks
// wrong; the rest (npc state churn, task ticks, event-feed entries) absorb
// the latency just fine.
const WS_BROADCAST_INTERVAL_MS = 500;
const IMMEDIATE_KINDS = new Set(['presence', 'threat', 'threat-cleared']);

let _pendingChanges = new Map(); // kind -> { kind, payload, ts }
let _broadcastTimer = null;
let _agentBusBuffer = [];        // collected agent-bus messages

function _broadcastFrame() {
  _broadcastTimer = null;
  const changes = Array.from(_pendingChanges.values());
  const busMessages = _agentBusBuffer;
  _pendingChanges = new Map();
  _agentBusBuffer = [];
  if (changes.length === 0 && busMessages.length === 0) return;

  // One JSON.stringify, one ws.send per client per tick — irrespective of
  // how many mutations happened during the window.
  const frame = JSON.stringify({
    type: 'world_state_batch',
    changes,
    busMessages,
    ts: Date.now(),
  });
  cofounderAgent.wsClients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(frame); } catch (_) { /* drop */ }
    }
  });
}

function _scheduleBroadcast() {
  if (_broadcastTimer) return;
  _broadcastTimer = setTimeout(_broadcastFrame, WS_BROADCAST_INTERVAL_MS);
}

function _sendImmediate(payload) {
  const data = JSON.stringify(payload);
  cofounderAgent.wsClients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(data); } catch (_) {}
    }
  });
}

worldState.on('change', ({ kind, payload }) => {
  const entry = { kind, payload, ts: Date.now() };
  if (IMMEDIATE_KINDS.has(kind)) {
    _sendImmediate({ type: 'world_state', ...entry });
    return;
  }
  // Latest write wins per kind for the next window.
  _pendingChanges.set(kind, entry);
  _scheduleBroadcast();
});

// --- Agent bus mirror (also throttled in the same window) ---
agentBus.subscribe('*', (msg) => {
  _agentBusBuffer.push(msg);
  // Cap the buffer in case something pathological happens.
  if (_agentBusBuffer.length > 60) _agentBusBuffer.splice(0, _agentBusBuffer.length - 60);
  _scheduleBroadcast();
});

function safeDecodePath(url) {
  try {
    return decodeURIComponent(url.split('?')[0]);
  } catch (err) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  let urlPath = safeDecodePath(req.url);
  const fullUrl = req.url;

  if (!urlPath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  // --- Security: check every request for suspicious patterns ---
  securityMonitor.checkHttpRequest(req);

  // Proxy /openclaw/* to the OpenClaw gateway, stripping iframe-blocking headers
  if (fullUrl.startsWith('/openclaw')) {
    const targetPath = fullUrl.replace(/^\/openclaw/, '') || '/';
    const proxyOpts = {
      hostname: OPENCLAW_HOST,
      port: OPENCLAW_PORT,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `${OPENCLAW_HOST}:${OPENCLAW_PORT}` },
    };
    const proxyReq = http.request(proxyOpts, (proxyRes) => {
      // Strip headers that block iframe embedding
      const headers = { ...proxyRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end('OpenClaw proxy error: ' + err.message);
    });
    req.pipe(proxyReq);
    return;
  }

  // --- Layout save/load API ---
  const layoutDir = path.join(ROOT, 'layouts');
  const layoutFile = path.join(layoutDir, 'office-layout.json');

  if (urlPath === '/api/layout' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body); // validate JSON
        fs.mkdirSync(layoutDir, { recursive: true });
        fs.writeFileSync(layoutFile, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (urlPath === '/api/layout' && req.method === 'GET') {
    fs.readFile(layoutFile, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No saved layout' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // --- NPC-facing "place a single piece of furniture" endpoint ---
  // The NPC brain's placeFurniture action POSTs here. We append the
  // item to office-layout.json (read-modify-write), broadcast a
  // worldState event so everyone notices, and return the new item.
  // Validation is strict: a small whitelist of prefab kinds and bounds.
  //
  // Body shape: { by: "Abby", prefabId: "desk_small", x: 320, y: 240, reason?: "..." }
  if (urlPath === '/api/place-furniture' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const prefabId = String(p.prefabId || '').slice(0, 80);
      const x = parseInt(p.x, 10);
      const y = parseInt(p.y, 10);
      const reason = p.reason ? String(p.reason).slice(0, 200) : null;

      // Whitelist + bounds. Keep this short — expanding it should be a
      // deliberate change, not a wide-open "NPC can spawn anything" API.
      if (!ALLOWED_PREFABS.has(prefabId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `prefabId not in whitelist: ${prefabId}`, allowed: [...ALLOWED_PREFABS] }));
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 16 || y < 16 || x > 1264 || y > 704) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'x/y out of bounds (must fit inside 1280×720 with 16px margin)' }));
        return;
      }

      // Per-NPC daily budget — keep a single NPC from bulldozing the
      // office. system/operator (the empty/'system' caller) is exempt
      // so manual fixtures still work.
      const budgetCheck = _checkPlacementBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily placement budget (${budgetCheck.cap}). Try again tomorrow.`,
          placedToday: budgetCheck.placedToday,
        }));
        return;
      }

      // Read-modify-write the layout file. The structure of office-layout.json
      // is { items: [...] } — we just append.
      let layout = { items: [] };
      try {
        const raw = fs.readFileSync(layoutFile, 'utf8');
        layout = JSON.parse(raw);
        if (!Array.isArray(layout.items)) layout.items = [];
      } catch (_) {
        fs.mkdirSync(layoutDir, { recursive: true });
      }
      const instanceId = `npc_${prefabId}_${Date.now()}`;
      const item = { instanceId, prefabId, x, y, placedBy: by, placedAt: Date.now(), reason };
      layout.items.push(item);
      try {
        fs.writeFileSync(layoutFile, JSON.stringify(layout, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist layout: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumePlacementBudget(by);

      // Surface as a worldState event so NPCs notice ("Abby placed a couch")
      // and the diag panel logs it.
      try {
        worldState.pushEvent('shipped', `${by} placed ${prefabId} at (${x},${y})${reason ? ' — ' + reason : ''}`);
      } catch (_) {}

      // Broadcast LIVE so the browser can instantiate the sprite without
      // waiting for a page reload. The client subscribes to
      // 'furniture_placed' and pushes the new item into _interactables.
      _sendImmediate({ type: 'furniture_placed', item, by });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, item }));
    });
    return;
  }

  // --- Remove a single piece of NPC-placed furniture ---
  // Body: { by: "Abby", instanceId: "npc_couch_169..." }
  // Only items whose instanceId starts with "npc_" can be removed —
  // hand-placed scene furniture is read-only. NPCs can remove their
  // own placements or each other's; we surface who removed what in
  // the world-state event feed so any griefing is visible.
  if (urlPath === '/api/remove-furniture' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const instanceId = String(p.instanceId || '');
      if (!instanceId.startsWith('npc_')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'instanceId must start with "npc_" (only NPC-placed furniture is removable)' }));
        return;
      }

      let layout = { items: [] };
      try {
        const raw = fs.readFileSync(layoutFile, 'utf8');
        layout = JSON.parse(raw);
        if (!Array.isArray(layout.items)) layout.items = [];
      } catch (_) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no layout file' }));
        return;
      }
      const idx = layout.items.findIndex(it => it.instanceId === instanceId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `instanceId not found: ${instanceId}` }));
        return;
      }
      const removed = layout.items.splice(idx, 1)[0];
      try {
        fs.writeFileSync(layoutFile, JSON.stringify(layout, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist layout: ' + err.message }));
        return;
      }
      try {
        worldState.pushEvent('shipped', `${by} removed ${removed.prefabId} (placed by ${removed.placedBy})`);
      } catch (_) {}
      _sendImmediate({ type: 'furniture_removed', instanceId, by });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removed }));
    });
    return;
  }

  // --- NPC-facing "request a new animation" endpoint ---
  // Stage 2 of the self-advancement roadmap. NPCs propose a new
  // animation by name + short description; the proposal goes into a
  // pending queue and an operator decides whether to actually generate
  // / register it. This endpoint does NOT generate sprite frames —
  // that's a separate (and currently stubbed) generator pipeline. See
  // docs/ANIMATION_FORGE.md.
  //
  // Body shape: { by: "Roki", animName: "meditate", description: "sitting cross-legged" }
  const animationProposalsFile = path.join(ROOT, 'data', 'animation-proposals.json');

  if (urlPath === '/api/request-animation' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const animName = String(p.animName || '').slice(0, 80);
      const description = String(p.description || '').slice(0, 400);

      // Shared validator — keeps the endpoint and animation-forge in lockstep.
      const v = animationForge.validateProposal({ animName, description });
      if (!v.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: v.error }));
        return;
      }

      // Daily budget — lower than the placement budget because each
      // proposal is heavier review work for the operator.
      const budgetCheck = _checkAnimationBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily animation-request budget (${budgetCheck.cap}). Try again tomorrow.`,
          requestedToday: budgetCheck.requestedToday,
        }));
        return;
      }

      // Read-modify-write the proposals file. Shape: { proposals: [...] }.
      let store = { proposals: [] };
      try {
        const raw = fs.readFileSync(animationProposalsFile, 'utf8');
        store = JSON.parse(raw);
        if (!Array.isArray(store.proposals)) store.proposals = [];
      } catch (_) {
        try { fs.mkdirSync(path.dirname(animationProposalsFile), { recursive: true }); } catch (__) {}
      }
      const id = `anim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const proposal = {
        id,
        by,
        animName,
        description,
        proposedAt: Date.now(),
        status: 'pending',
      };
      store.proposals.push(proposal);
      try {
        fs.writeFileSync(animationProposalsFile, JSON.stringify(store, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumeAnimationBudget(by);

      // Surface as a worldState event so the diag panel sees the
      // proposal arrive. NPCs may also notice — at minimum the operator
      // gets a breadcrumb.
      try {
        worldState.pushEvent('proposed-animation',
          `${by} proposed animation "${animName}": ${description}`);
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal }));
    });
    return;
  }

  // --- Operator-facing list of pending animation proposals ---
  // Used by a future operator review UI. Returns the raw JSON; an empty
  // file is treated as `{ proposals: [] }`.
  if (urlPath === '/api/animation-proposals' && req.method === 'GET') {
    let store = { proposals: [] };
    try {
      const raw = fs.readFileSync(animationProposalsFile, 'utf8');
      store = JSON.parse(raw);
      if (!Array.isArray(store.proposals)) store.proposals = [];
    } catch (_) { /* file may not exist yet */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store));
    return;
  }

  // --- World-state snapshot (read-only) ---
  // Useful for debugging and for the n8n/Supabase integration to know what
  // the office "looks like" before posting an update.
  if (urlPath === '/api/world-state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(worldState.snapshot()));
    return;
  }

  // --- Presence flag (Zion at the keyboard) ---
  // GET returns the current value; POST { present: bool } toggles it.
  // The voice gate in the browser reads this on every speech bubble — when
  // false, bubbles still render but no audio fires.
  if (urlPath === '/api/presence' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ zionPresent: worldState.zionPresent }));
    return;
  }
  if (urlPath === '/api/presence' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const next = worldState.setPresence(!!payload.present);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, zionPresent: next }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Assistant profile: persistent user/project memory + autonomy policy ---
  if (urlPath === '/api/assistant-profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(npcBrains.getAssistantProfile()));
    return;
  }

  if (urlPath === '/api/assistant-profile' && req.method === 'POST') {
    (async () => {
      const patch = await _readJsonBody(req, 2 * 1024 * 1024);
      const updated = npcBrains.updateAssistantProfile(patch || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile: updated }));
    })().catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- Task webhook (n8n / Supabase / external workflows post here) ---
  // Body shape: { id, source?, title, status?, assignee?, detail?, foreground? }
  // We upsert into worldState; the change event then fans out to the browser
  // and the next NPC think cycle picks it up via the Current State block.
  if (urlPath === '/api/task-update' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const task = JSON.parse(body || '{}');
        if (!task || typeof task !== 'object' || !task.id || !task.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'task requires { id, title }' }));
          return;
        }
        const foreground = !!task.foreground;
        const merged = worldState.upsertTask({
          id: String(task.id),
          source: task.source || 'external',
          title: String(task.title).slice(0, 200),
          status: task.status || 'queued',
          assignee: task.assignee || null,
          detail: task.detail ? String(task.detail).slice(0, 400) : null,
        }, { foreground });
        // Also surface as an office event so NPCs notice immediately.
        worldState.pushEvent('task', `${merged.status}: ${merged.title}${merged.assignee ? ' → ' + merged.assignee : ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, task: merged }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Agent-bus publish (let external systems poke a specific NPC) ---
  // POST body: { to, from?, text, kind? }
  if (urlPath === '/api/agent-bus' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const msg = agentBus.publish(payload.to, {
          from: payload.from || 'external',
          text: String(payload.text || '').slice(0, 600),
          kind: payload.kind || 'speak',
        });
        if (!msg) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'requires { to, text }' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, msg }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Office health (one-shot diagnostic the client polls every few seconds) ---
  // Reports: WS clients connected, LM Studio reachability, which providers
  // are configured (names only — never keys), recent provider errors, and
  // last successful think+chat timestamps. Designed to answer the question
  // "why isn't the NPC responding when I talk to it?" without the user
  // needing terminal access.
  if (urlPath === '/api/health' && req.method === 'GET') {
    (async () => {
      // LIVENESS, NOT JUST REACHABILITY.
      //
      // Earlier the health probe lied because LM Studio's single-threaded
      // HTTP server queues incoming requests behind the chat completions
      // that are already running. When 16 NPCs are autonomously thinking
      // back-to-back at full GPU saturation, even a cheap GET /v1/models
      // can wait 4-8 seconds before LM Studio gets to it. A 5s probe
      // timeout fires first → probe reports "unreachable" → user thinks
      // LM Studio is down even though it's actively processing requests.
      //
      // The truth source is whether the brain is actually completing
      // requests, which we already track in _npcStats. If a brain call
      // succeeded in the last 30 seconds, LM Studio is alive — period.
      // Run the probe ONLY as a fallback when we have no recent brain
      // activity to vouch for it.
      const lmCfg = npcBrains.providers?.lmstudio || {};
      const lmStudioUrl = lmCfg.baseUrl || process.env.LM_STUDIO_URL || 'http://localhost:1234';
      const lmHeaders = {};
      if (lmCfg.apiKey) lmHeaders.Authorization = `Bearer ${lmCfg.apiKey}`;

      // Truth source for "is LM Studio alive": ANY successful provider
      // call counts. Captured inside _callLocal so it covers autonomous
      // think() loops too (which never go through the WS handlers and
      // therefore weren't reflected by the WS-only counters).
      const stats = global._npcStats || {};
      const lastBrainOk = Math.max(
        stats.lastProviderOkAt || 0,
        stats.lastNpcConvAt || 0,
        stats.lastPlayerChatAt && stats.playerChatSucceeded > 0 ? stats.lastPlayerChatAt : 0,
      );
      const now = Date.now();
      const recentBrainOk = lastBrainOk && (now - lastBrainOk) < 30000;

      let lmStudioStatus = {
        reachable: false,
        url: lmStudioUrl,
        error: null,
        model: lmCfg.model || null,
        livenessSource: null,
      };

      if (recentBrainOk) {
        // Don't even bother probing — we have proof LM Studio is alive.
        const ago = Math.round((now - lastBrainOk) / 1000);
        lmStudioStatus.reachable = true;
        lmStudioStatus.livenessSource = `brain call succeeded ${ago}s ago`;
      } else {
        // No recent activity — fall back to direct probe with a longer
        // timeout that tolerates a saturated GPU. Try 3 paths; accept a
        // 401/403 as "server is up, just auth-blocked."
        const probes = ['/v1/models', '/api/v0/models', '/'];
        const errors = [];
        for (const path of probes) {
          try {
            const probe = await fetch(`${lmStudioUrl}${path}`, {
              method: 'GET',
              headers: lmHeaders,
              signal: AbortSignal.timeout(15000),
            });
            if (probe.ok || probe.status === 401 || probe.status === 403) {
              lmStudioStatus.reachable = true;
              lmStudioStatus.probedPath = path;
              lmStudioStatus.livenessSource = `probe ${path} ok`;
              if (!probe.ok) lmStudioStatus.warning = `${path} HTTP ${probe.status} (auth issue, but server is up)`;
              break;
            }
            errors.push(`${path}: HTTP ${probe.status}`);
          } catch (err) {
            errors.push(`${path}: ${err?.message || String(err)}`);
          }
        }
        if (!lmStudioStatus.reachable) {
          lmStudioStatus.error = errors.join('; ');
        }
      }

      const providers = Object.entries(npcBrains.providers || {})
        .filter(([k]) => k !== 'demo')
        .map(([name, cfg]) => ({ name, type: cfg.type, model: cfg.model || null }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        ts: Date.now(),
        lmStudio: lmStudioStatus,
        providers,
        demoMode: !!npcBrains._demoMode,
        wsClients: {
          agent: cofounderAgent.wsClients.size,
          security: securityMonitor.clients?.size || 0,
        },
        stats: global._npcStats,
        recentErrors: (global._npcRecentErrors || []).slice(-5),
      }));
    })().catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- TTS health (cheap probe — does this server have ElevenLabs configured?) ---
  // The client uses this to decide whether to wire the ElevenLabs voice
  // provider. Returns the key SOURCE but never the value.
  if (urlPath === '/api/tts/health' && req.method === 'GET') {
    const status = elevenLabs.status();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...status,
      voiceMapEntries: Object.keys(_voiceMap.npcs || {}).length,
    }));
    return;
  }

  // --- STT health (server-side fallback transcription capability) ---
  // Client uses this when browser SpeechRecognition is missing (Brave/Simple Browser).
  if (urlPath === '/api/stt/health' && req.method === 'GET') {
    const stt = _resolveSttConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      configured: stt.configured,
      provider: 'openai-whisper',
      model: stt.model,
      source: stt.source,
      maxAudioBytes: STT_MAX_AUDIO_BYTES,
    }));
    return;
  }

  // --- STT: transcribe uploaded audio ---
  // POST body: { audioBase64, mimeType?, lang? }
  // Returns: { text }
  if (urlPath === '/api/stt' && req.method === 'POST') {
    (async () => {
      const stt = _resolveSttConfig();
      if (!stt.configured) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'STT not configured. Set OPENAI_WHISPER_API_KEY or OPENAI_API_KEY on the server.',
        }));
        return;
      }

      const payload = await _readJsonBody(req, 32 * 1024 * 1024);
      const audioBase64 = String(payload.audioBase64 || '').trim();
      const mimeType = String(payload.mimeType || 'audio/webm').trim();
      const language = String(payload.lang || '').trim();

      if (!audioBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audioBase64 is required' }));
        return;
      }

      let audio;
      try {
        audio = Buffer.from(audioBase64, 'base64');
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audioBase64 is not valid base64' }));
        return;
      }

      if (!audio.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audio payload is empty' }));
        return;
      }
      if (audio.length > STT_MAX_AUDIO_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `audio too large (${audio.length} bytes)` }));
        return;
      }

      const ext = mimeType.includes('wav') ? 'wav'
        : mimeType.includes('mp4') ? 'm4a'
          : mimeType.includes('mpeg') ? 'mp3'
            : 'webm';

      const fields = [
        { name: 'model', value: stt.model },
        { name: 'response_format', value: 'json' },
        {
          name: 'file',
          filename: `denizen-stt.${ext}`,
          contentType: mimeType || 'audio/webm',
          value: audio,
        },
      ];
      if (language) {
        fields.push({ name: 'language', value: language });
      }

      const mp = _buildMultipartForm(fields);
      const upstream = await fetch(`${stt.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stt.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${mp.boundary}`,
        },
        body: mp.body,
        signal: AbortSignal.timeout(45000),
      });

      const raw = await upstream.text();
      if (!upstream.ok) {
        let detail = raw;
        try {
          const j = JSON.parse(raw);
          detail = j?.error?.message || j?.message || raw;
        } catch (_) {}
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `STT upstream error: ${detail}` }));
        return;
      }

      let text = '';
      try {
        const j = JSON.parse(raw);
        text = String(j?.text || '').trim();
      } catch (_) {
        text = String(raw || '').trim();
      }

      if (!text) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: '', warning: 'empty transcript' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    });
    return;
  }

  // --- TTS: synthesize speech for an NPC and stream MP3 back ---
  // POST body: { npcName?, text, voiceId?, modelId? }
  // The voice gate (browser) calls this; we proxy to ElevenLabs server-side
  // so the API key never touches the browser. NPC name maps via voice-map.json.
  if (urlPath === '/api/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const text = String(payload.text || '').slice(0, 4000);
      if (!text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }
      const npcEntry = (payload.npcName && _voiceMap.npcs?.[payload.npcName]) || {};
      const voiceId = payload.voiceId || npcEntry.voiceId || _voiceMap.default?.voiceId;
      const modelId = payload.modelId || npcEntry.modelId || _voiceMap.default?.modelId;

      try {
        await elevenLabs.synthesize({ text, voiceId, modelId }, res);
        // Streaming complete; nothing else to send.
      } catch (err) {
        // Headers may or may not be sent depending on whether the failure
        // happened before or after upstream returned 200. Guard both paths.
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          try { res.end(); } catch (_) {}
        }
      }
    });
    return;
  }

  // --- LLM-backed city plan ---
  // POST body: { prompt, seed?, gridW?, gridH?, provider? }
  // Reuses NpcBrainManager's provider clients so we don't reimplement
  // five HTTP integrations. The model is asked for a JSON-only response;
  // we parse, validate shape, and fall back to the heuristic on any
  // failure (no LLM, malformed JSON, missing zones field). The planner
  // module itself calls into this endpoint when CITY_PLAN_PROVIDER is set
  // — see src/city/planner.js.
  if (urlPath === '/api/llm-city-plan' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const prompt = String(payload.prompt || '').slice(0, 1000);
      const seed = String(payload.seed || 'city-plan').slice(0, 80);
      const gridW = Math.max(1, Math.min(20, parseInt(payload.gridW, 10) || 5));
      const gridH = Math.max(1, Math.min(20, parseInt(payload.gridH, 10) || 3));

      // Pick a provider. Order: explicit body.provider → env → first available.
      const providerKey = payload.provider
        || process.env.CITY_PLAN_PROVIDER
        || ['claude', 'grok', 'gemini', 'kimi', 'lmstudio'].find(k => npcBrains.providers[k]);
      const providerConfig = providerKey ? npcBrains.providers[providerKey] : null;

      const heuristic = () => {
        // .cjs extension forces CommonJS even though src/city/ is an ESM
        // folder (package.json type:module). Keep the lazy require here so
        // boot stays fast.
        const { planCityZones } = require('./src/city/planner-heuristic.cjs');
        const plan = planCityZones({ prompt, seed, gridW, gridH });
        return { ...plan, source: 'heuristic' };
      };

      if (!providerConfig || providerConfig.type === 'demo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(heuristic()));
        return;
      }

      const system = [
        'You are a city planner. Given a free-form prompt and a grid size W x H, return ONE JSON object and NOTHING ELSE.',
        'Shape: { "zones": [ { "zone": "downtown"|"residential"|"industrial"|"park", "rect": { "x": int, "y": int, "w": int, "h": int } }, ... ] }.',
        'Constraints: 0 <= x < W, 0 <= y < H, x+w <= W, y+h <= H, no zones may overlap, every cell must be covered.',
        'No prose. No markdown. Just the JSON object.',
      ].join('\n');
      const userMsg = `Prompt: ${prompt || '(none — invent a coherent small city)'}\nW=${gridW} H=${gridH}\nReturn the JSON now.`;

      try {
        const raw = await npcBrains._callProvider(providerConfig, system,
          [{ role: 'user', content: userMsg }],
          { maxTokens: 800, sliceLen: 1200, temperature: 0.5 });
        const match = String(raw || '').match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : null;
        if (!parsed || !Array.isArray(parsed.zones)) {
          throw new Error('LLM did not return { zones: [] }');
        }
        // Light validation — clamp every rect into bounds; drop bad entries.
        const clean = parsed.zones
          .filter(z => z && z.rect && typeof z.zone === 'string')
          .map(z => ({
            zone: z.zone,
            rect: {
              x: Math.max(0, Math.min(gridW - 1, parseInt(z.rect.x, 10) || 0)),
              y: Math.max(0, Math.min(gridH - 1, parseInt(z.rect.y, 10) || 0)),
              w: Math.max(1, parseInt(z.rect.w, 10) || 1),
              h: Math.max(1, parseInt(z.rect.h, 10) || 1),
            },
          }));
        if (clean.length === 0) throw new Error('All LLM zones invalid');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ seed, gridW, gridH, zones: clean, source: providerKey }));
      } catch (err) {
        console.warn(`[CityPlan] LLM failed (${err.message}) — falling back to heuristic`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(heuristic()));
      }
    });
    return;
  }

  // --- Full city generation (planner → chunk → optional interior) as JSON ---
  // Query: ?seed=…&prompt=…&width=…&height=…&roadStride=…&chunkX=…&chunkY=…
  // Returns the same data the in-game phaserAdapter consumes — useful for
  // a debug overlay (?debug=city) and for headless snapshot tests.
  // Implementation uses dynamic import() because city/* are ES modules.
  if (urlPath === '/api/generate-city' && req.method === 'GET') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const seed = params.get('seed') || 'office-demo';
    const prompt = params.get('prompt') || '';
    const width = Math.max(8, Math.min(256, parseInt(params.get('width'), 10) || 48));
    const height = Math.max(8, Math.min(256, parseInt(params.get('height'), 10) || 48));
    const roadStride = Math.max(2, Math.min(32, parseInt(params.get('roadStride'), 10) || 8));
    const chunkX = parseInt(params.get('chunkX'), 10) || 0;
    const chunkY = parseInt(params.get('chunkY'), 10) || 0;

    (async () => {
      try {
        // Dynamic ESM import — these modules use `import/export`.
        const cityMod = await import('./src/city/cityGenerator.js');
        const interiorMod = await import('./src/city/interiorGenerator.js');
        const plannerMod = await import('./src/city/planner.js');

        // Plan (LLM if available, heuristic otherwise — planner module
        // honors CITY_PLAN_PROVIDER + the /api/llm-city-plan endpoint when
        // running in the browser; on the server we just call the local
        // heuristic to keep this endpoint sync-cheap for snapshots).
        const plan = plannerMod.planCityZones({ seed, prompt, gridW: 4, gridH: 3 });
        const chunk = cityMod.generateCityChunk({ seed, chunkX, chunkY, width, height, roadStride });
        const interior = chunk.buildings && chunk.buildings[0]
          ? interiorMod.generateOfficeInterior({
              seed: `${seed}:${chunk.buildings[0].id}`,
              buildingId: chunk.buildings[0].id,
              width: 24,
              height: 16,
            })
          : null;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plan, chunk, sampleInterior: interior }));
      } catch (err) {
        console.warn('[GenerateCity] failed:', err?.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    })();
    return;
  }

  // --- Security test endpoint: simulate threats for testing ---
  if (urlPath === '/security-test') {
    const category = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('type') || 'network_scan';
    const severity = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('severity') || 'medium';
    const detail = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('detail') || `Test ${category} threat`;

    securityMonitor._emitThreat({
      category,
      severity,
      source: 'test',
      target: 'test-target',
      detail,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: `Simulated ${category} threat` }));
    return;
  }

  // Default to the game's index.html
  if (urlPath === '/' || urlPath === '/pixel-office-game/' || urlPath === '/pixel-office-game') {
    urlPath = '/index.html';
  }
  // Backwards-compat: this project was once served from a parent folder
  // with index.html using <base href="/pixel-office-game/">. The base
  // tag is gone, but stripping the legacy prefix keeps old bookmarks
  // and external links working. Safe to remove eventually.
  if (urlPath.startsWith('/pixel-office-game/')) {
    urlPath = urlPath.replace('/pixel-office-game', '');
  }
  const filePath = path.resolve(ROOT, `.${urlPath}`);
  const relativePath = path.relative(ROOT, filePath);

  // Prevent directory traversal above ROOT
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    // This itself is a threat!
    securityMonitor._emitThreat({
      category: 'file_access',
      severity: 'high',
      source: req.socket?.remoteAddress || 'unknown',
      target: urlPath,
      detail: `Directory traversal blocked: ${urlPath.slice(0, 60)}`,
    });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- WebSocket Servers (using 'ws' package) ---

// Security Monitor WebSocket
const securityWss = new WebSocketServer({ noServer: true });
securityWss.on('connection', (ws) => {
  console.log('[SecurityMonitor] WS client connected');
  securityMonitor.addClient(ws);
  ws.on('close', () => {
    console.log('[SecurityMonitor] WS client disconnected');
    securityMonitor.clients?.delete(ws);
  });
  ws.on('error', () => {
    securityMonitor.clients?.delete(ws);
  });
});

// Agent Office WebSocket
const agentWss = new WebSocketServer({ noServer: true });
agentWss.on('connection', (ws) => {
  console.log(`[CofounderAgent] WS client connected (${cofounderAgent.wsClients.size + 1} total)`);
  cofounderAgent.addClient(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'npc_conversation') {
        // Resolve the NPC name case-insensitively — cofounder dispatch and
        // LM Studio replies sometimes return lowercased or title-cased names.
        let resolvedName = null;
        if (typeof msg.npcName === 'string' && msg.npcName) {
          if (npcBrains.brains[msg.npcName]) {
            resolvedName = msg.npcName;
          } else {
            const lower = msg.npcName.toLowerCase();
            resolvedName = Object.keys(npcBrains.brains).find(n => n.toLowerCase() === lower) || null;
          }
        }
        if (!resolvedName) {
          // Throttle warning — cofounder dispatch floods this otherwise.
          const now = Date.now();
          if (!global._lastUnknownNpcWarn || now - global._lastUnknownNpcWarn > 30000) {
            console.warn(`[AgentWS] npc_conversation: unknown npcName "${msg.npcName}" (further warnings throttled 30s)`);
            global._lastUnknownNpcWarn = now;
          }
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'npc_response',
              npcName: typeof msg.npcName === 'string' && msg.npcName ? msg.npcName : 'Unknown',
              fromName: typeof msg.fromName === 'string' ? msg.fromName : '',
              text: '(No reply right now.)',
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            }));
          }
          return;
        }
        // Normalize the name going forward so downstream code looks up the right brain.
        msg.npcName = resolvedName;
        if (typeof msg.text !== 'string' || !msg.text.trim()) {
          console.warn('[AgentWS] npc_conversation: invalid text payload');
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'npc_response',
              npcName: msg.npcName,
              fromName: msg.fromName,
              text: '(No reply right now.)',
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            }));
          }
          return;
        }
        // Route to individual NPC brain for a personalized response
        global._npcStats.npcConvReceived++;
        global._npcStats.lastNpcConvAt = Date.now();
        npcBrains.getResponse(msg.npcName, msg.fromName, msg.text, msg.context || {})
          .then(response => {
            global._npcStats.npcConvSucceeded++;
            const reply = JSON.stringify({
              type: 'npc_response',
              npcName: msg.npcName,
              fromName: msg.fromName,
              text: response,
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            });
            if (ws.readyState === 1) ws.send(reply);
            // Save significant conversations to MEMORY.md
            npcBrains.saveMemory(msg.npcName, `${msg.fromName} said: "${msg.text}" — I replied: "${response}"`);
          })
          .catch(err => {
            global._npcStats.npcConvFailed++;
            const errMsg = String(err?.message ?? err);
            console.warn('[NpcBrains] Response error:', errMsg);
            _recordNpcError(`getResponse(${msg.npcName} ← ${msg.fromName}): ${errMsg}`);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'npc_response',
                npcName: msg.npcName,
                fromName: msg.fromName,
                text: '(No reply right now.)',
                turn: typeof msg.turn === 'number' ? msg.turn : 1,
              }));
            }
          });
      } else if (msg.type === 'npc_think') {
        // NPC is asking "what should I do next?"
        npcBrains.think(msg.npcName, msg.context || {})
          .then(decision => {
            // Send the main decision
            const reply = JSON.stringify({
              type: 'npc_decision',
              npcName: msg.npcName,
              decision,
            });
            if (ws.readyState === 1) ws.send(reply);

            // Send cascade decisions (leader decisions rippling down to reports)
            const cascades = decision._cascades || [];
            delete decision._cascades; // Clean up before sending
            cascades.forEach((cascade, idx) => {
              // Stagger cascades so they don't all fire at once
              setTimeout(() => {
                const cascadeReply = JSON.stringify({
                  type: 'npc_cascade',
                  npcName: cascade.npcName,
                  fromName: cascade.fromName,
                  message: cascade.message,
                });
                if (ws.readyState === 1) ws.send(cascadeReply);
              }, (idx + 1) * 3000);
            });
          })
          .catch(err => console.warn('[NpcBrains] Think error:', err.message));
      } else if (msg.type === 'player_chat') {
        // CEO (player) is talking directly to an NPC
        const npcName = msg.npcName;
        if (!npcName || !npcBrains.brains[npcName]) {
          console.warn('[AgentWS] player_chat: unknown or missing npcName');
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: typeof msg.npcName === 'string' && msg.npcName ? msg.npcName : 'Unknown',
              text: 'That person isn\'t in the office right now.',
              delegation: null,
              actions: [],
            }));
          }
          return;
        }
        if (typeof msg.text !== 'string' || !msg.text.trim()) {
          console.warn('[AgentWS] player_chat: invalid text payload');
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: npcName,
              text: 'I did not catch that. Try again?',
              delegation: null,
              actions: [],
            }));
          }
          return;
        }
        console.log(`[PlayerChat] CEO → ${npcName}: "${msg.text}"`);
        global._npcStats.playerChatReceived++;
        global._npcStats.lastPlayerChatAt = Date.now();
        npcBrains.getPlayerResponse(npcName, msg.text)
          .then(result => {
            // If the brain returned nothing usable, treat it as an
            // error so the client sees WHY instead of an empty bubble.
            const text = (result && typeof result.text === 'string') ? result.text.trim() : '';
            if (!text) {
              const errMsg = `${npcName}'s brain returned no text (provider may be down — check /api/health)`;
              _recordNpcError(errMsg);
              global._npcStats.playerChatFailed++;
              const reply = JSON.stringify({
                type: 'player_chat_response',
                npcName,
                text: '(no reply — provider error, see diagnostics)',
                error: errMsg,
                delegation: null, actions: [],
              });
              if (ws.readyState === 1) ws.send(reply);
              return;
            }
            global._npcStats.playerChatSucceeded++;
            const reply = JSON.stringify({
              type: 'player_chat_response',
              npcName, text,
              delegation: result.delegation || null,
              actions: result.actions || [],
            });
            if (ws.readyState === 1) ws.send(reply);
            npcBrains.saveMemory(npcName, `CEO said: "${msg.text}" — I replied: "${text}"${result.delegation ? ` [delegated to ${result.delegation.delegateTo}]` : ''}`);
          })
          .catch(err => {
            const errMsg = String(err?.message ?? err);
            console.warn('[PlayerChat] Response error:', errMsg);
            _recordNpcError(`getPlayerResponse(${npcName}): ${errMsg}`);
            global._npcStats.playerChatFailed++;
            const fallback = JSON.stringify({
              type: 'player_chat_response',
              npcName,
              text: 'Got it, I\'ll look into that.',
              error: errMsg,
              delegation: null, actions: [],
            });
            if (ws.readyState === 1) ws.send(fallback);
          });
      } else if (msg.type === 'npc_introduce') {
        // Tour stop: Lucy is presenting NPC X to the player. Ask X's
        // brain to compose a one-line introduction in their own voice.
        // Reuses the npc_conversation reply pipeline so the bubble +
        // voice paths work without new wiring.
        let introName = msg.npcName;
        if (typeof introName === 'string' && introName && !npcBrains.brains[introName]) {
          const lower = introName.toLowerCase();
          introName = Object.keys(npcBrains.brains).find(n => n.toLowerCase() === lower) || introName;
        }
        if (introName && npcBrains.brains[introName]) {
          npcBrains.getResponse(introName, 'Lucy', String(msg.context || 'Introduce yourself briefly to the CEO.'), {})
            .then(response => {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'npc_response',
                  npcName: introName,
                  fromName: 'Lucy',
                  text: response,
                  turn: 1,
                }));
              }
            })
            .catch(err => {
              console.warn('[Tour] introduction error:', err?.message || err);
            });
        }
      } else if (msg.type === 'npc_addressed') {
        // Conversation focus: the client tells us "NPC X was just spoken
        // to by Y". Mirror into worldState so X's next think() sees the
        // 'lastAddressed' field and acknowledges them before doing
        // something else.
        if (msg.target && worldState && typeof worldState.updateNpc === 'function') {
          worldState.updateNpc(msg.target, {
            lastAddressed: { by: msg.from || 'someone', text: msg.text || '', at: msg.ts || Date.now() },
          });
        }
      } else if (msg.type === 'player_idle') {
        // Receptionist tour: the client tells us "the player has been
        // idle for N ms". Mirror into worldState so Lucy's brain (or a
        // scheduler) can decide to offer them a tour.
        if (worldState) {
          worldState.environment = worldState.environment || {};
          worldState.environment.playerIdleMs = msg.idleMs || 0;
          worldState.environment.playerPosition = msg.position || null;
          worldState._emit('environment', worldState.environment);
        }
      } else {
        cofounderAgent.handleClientMessage(msg);
      }
    } catch (err) {
      console.warn('[AgentWS] Failed to parse client message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[CofounderAgent] WS client disconnected (${cofounderAgent.wsClients.size - 1} remaining)`);
    cofounderAgent.removeClient(ws);
  });
  ws.on('error', () => {
    cofounderAgent.removeClient(ws);
  });
});

// Route WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/security-ws') {
    securityWss.handleUpgrade(req, socket, head, (ws) => {
      securityWss.emit('connection', ws, req);
    });
    return;
  }

  if (req.url === '/agent-ws') {
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit('connection', ws, req);
    });
    return;
  }

  // OpenClaw WebSocket proxy
  const target = net.createConnection(OPENCLAW_PORT, OPENCLAW_HOST, () => {
    const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    target.write(reqLine + headers + '\r\n\r\n');
    if (head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  target.on('error', (err) => {
    console.warn('[WS Proxy] Error:', err.message);
    socket.destroy();
  });
  socket.on('error', () => target.destroy());
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Security Monitor active — WebSocket at ws://localhost:${PORT}/security-ws`);
  console.log(`Agent Office WebSocket at ws://localhost:${PORT}/agent-ws`);
  console.log(`Test threats: http://localhost:${PORT}/security-test?type=file_access&severity=high&detail=Someone+reading+passwords`);
  console.log(`World-state snapshot: GET http://localhost:${PORT}/api/world-state`);
  console.log(`Task webhook (n8n etc): POST http://localhost:${PORT}/api/task-update  body: {id,title,status?,assignee?}`);
  console.log(`Presence toggle (voice gate): POST http://localhost:${PORT}/api/presence  body: {present:true|false}`);
  const ttsStatus = elevenLabs.status();
  if (ttsStatus.configured) {
    console.log(`ElevenLabs TTS: ✅ configured (key from ${ttsStatus.source}); POST http://localhost:${PORT}/api/tts  body: {npcName,text}`);
  } else {
    console.log(`ElevenLabs TTS: not configured. Set ELEVENLABS_API_KEY (or add to ~/.openclaw/.env) and restart to enable.`);
  }

  // Start the cofounder agent's autonomous thinking loop
  cofounderAgent.start();
});

// Graceful shutdown — stop the security monitor's intervals and child
// processes (tshark, journalctl polling) so the process exits cleanly
// instead of hanging on the event loop. Idempotent across signals.
let _shuttingDown = false;
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down`);
  try { securityMonitor.stop?.(); } catch (e) { console.warn('[Server] securityMonitor.stop:', e?.message); }
  try { cofounderAgent.stop?.(); } catch (_) {}
  try { externalSink.detach(); } catch (_) {}
  try {
    if (_broadcastTimer) clearTimeout(_broadcastTimer);
  } catch (_) {}
  // Give in-flight requests up to 3s, then exit.
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
