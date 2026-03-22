const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SecurityMonitorServer = require('./security-monitor-server');

const PORT = process.env.PORT || 8080;
// Serve from the parent directory so ../pixel game stuff/ paths resolve correctly
const ROOT = path.resolve(__dirname, '..');

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
securityMonitor.start();

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  const fullUrl = req.url;

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
  if (urlPath === '/') urlPath = '/pixel-office-game/index.html';
  const filePath = path.join(ROOT, urlPath);

  // Prevent directory traversal above ROOT
  if (!filePath.startsWith(ROOT)) {
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

// WebSocket upgrade handler — route security-ws to monitor, everything else to OpenClaw
server.on('upgrade', (req, socket, head) => {
  // Security monitor WebSocket
  if (req.url === '/security-ws') {
    // Minimal WebSocket handshake
    const key = req.headers['sec-websocket-key'];
    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC085B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      '\r\n'
    );

    // Create a minimal WebSocket wrapper
    const ws = createMinimalWS(socket);
    securityMonitor.addClient(ws);
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

/**
 * Minimal WebSocket frame encoder/decoder for the security monitor
 * (avoids requiring the 'ws' npm package)
 */
function createMinimalWS(socket) {
  const ws = {
    readyState: 1, // OPEN
    send(data) {
      if (ws.readyState !== 1) return;
      const payload = Buffer.from(data, 'utf8');
      const frame = encodeWSFrame(payload);
      try {
        socket.write(frame);
      } catch (e) {
        ws.readyState = 3;
      }
    },
    close() {
      ws.readyState = 2;
      try { socket.end(); } catch (e) {}
      ws.readyState = 3;
    },
    _onCloseCallbacks: [],
    on(event, cb) {
      if (event === 'close') ws._onCloseCallbacks.push(cb);
    },
  };

  // Handle incoming frames (for future bidirectional communication)
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const result = decodeWSFrame(buffer);
      if (!result) break;
      buffer = buffer.slice(result.totalLength);

      if (result.opcode === 0x08) {
        // Close frame
        ws.readyState = 3;
        ws._onCloseCallbacks.forEach(cb => cb());
        socket.end();
        return;
      }
      if (result.opcode === 0x09) {
        // Ping → Pong
        const pong = encodeWSFrame(result.payload, 0x0a);
        socket.write(pong);
      }
      // Text frames (0x01) could be handled here for bidirectional comms
    }
  });

  socket.on('close', () => {
    ws.readyState = 3;
    ws._onCloseCallbacks.forEach(cb => cb());
  });

  socket.on('error', () => {
    ws.readyState = 3;
  });

  return ws;
}

function encodeWSFrame(payload, opcode = 0x01) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN + opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWSFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  const maskSize = masked ? 4 : 0;
  const totalLength = offset + maskSize + payloadLen;
  if (buffer.length < totalLength) return null;

  let payload;
  if (masked) {
    const mask = buffer.slice(offset, offset + 4);
    payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = buffer[offset + 4 + i] ^ mask[i % 4];
    }
  } else {
    payload = buffer.slice(offset, offset + payloadLen);
  }

  return { opcode, payload, totalLength };
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Security Monitor active — WebSocket at ws://localhost:${PORT}/security-ws`);
  console.log(`Test threats: http://localhost:${PORT}/security-test?type=file_access&severity=high&detail=Someone+reading+passwords`);
});
