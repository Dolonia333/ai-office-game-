const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const SecurityMonitorServer = require('./security-monitor-server');
const CofounderAgent = require('./src/cofounder-agent');
const NpcBrainManager = require('./src/npc-brains');
const worldState = require('./src/world-state');
const agentBus = require('./src/agent-bus');

const PORT = process.env.PORT || 8080;

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

// --- WorldState change broadcast ---
// Whenever any subsystem mutates the world, push a delta to every connected
// /agent-ws client. The client merges this into its local mirror and the
// browser UI (status bar, voice gate, threat banner) reacts in one place.
worldState.on('change', ({ kind, payload }) => {
  const data = JSON.stringify({ type: 'world_state', kind, payload, ts: Date.now() });
  cofounderAgent.wsClients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(data); } catch (_) { /* drop */ }
    }
  });
});

// --- Agent bus mirror ---
// Every direct NPC↔NPC message also gets fanned out to /agent-ws so the
// client can render the speech bubble even when the CTO didn't broker it.
agentBus.subscribe('*', (msg) => {
  const data = JSON.stringify({ type: 'agent_bus', msg });
  cofounderAgent.wsClients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(data); } catch (_) {}
    }
  });
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
  // Strip /pixel-office-game/ prefix since ROOT is now the project directory
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
        npcBrains.getResponse(msg.npcName, msg.fromName, msg.text, msg.context || {})
          .then(response => {
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
            console.warn('[NpcBrains] Response error:', String(err?.message ?? err));
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
        npcBrains.getPlayerResponse(npcName, msg.text)
          .then(result => {
            const reply = JSON.stringify({
              type: 'player_chat_response',
              npcName: npcName,
              text: result.text,
              delegation: result.delegation || null,
              actions: result.actions || [],
            });
            if (ws.readyState === 1) ws.send(reply);
            // Save to memory
            npcBrains.saveMemory(npcName, `CEO said: "${msg.text}" — I replied: "${result.text}"${result.delegation ? ` [delegated to ${result.delegation.delegateTo}]` : ''}`);
          })
          .catch(err => {
            console.warn('[PlayerChat] Response error:', String(err?.message ?? err));
            const fallback = JSON.stringify({
              type: 'player_chat_response',
              npcName: npcName,
              text: 'Got it, I\'ll look into that.',
              delegation: null,
              actions: [],
            });
            if (ws.readyState === 1) ws.send(fallback);
          });
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
  // Give in-flight requests up to 3s, then exit.
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
