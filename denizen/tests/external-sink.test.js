'use strict';
/**
 * Tests for ExternalSink — webhook dispatch, kind filtering, and the
 * back-off-after-N-failures behavior. We use a local http.Server so we
 * don't depend on Supabase / n8n being reachable.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const ExternalSink = require('../src/external-sink.js');
const { WorldState } = require('../src/world-state.js');

let mockServer;
let mockUrl;
let received;

before(() => {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ method: req.method, path: req.url, auth: req.headers.authorization || null, body });
        if (req.url === '/fail') {
          res.writeHead(500); res.end('nope');
        } else {
          res.writeHead(200); res.end('ok');
        }
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      const { port } = mockServer.address();
      mockUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => new Promise((r) => mockServer.close(r)));

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

describe('ExternalSink — forwarding', () => {
  it('does nothing when no env vars are set', () => {
    const ws = new WorldState();
    const sink = new ExternalSink({ worldState: ws, env: {} });
    sink.attach();
    ws.pushEvent('shipped', 'test'); // would have fired
    sink.detach();
    // No assertion of HTTP — just confirm no throw and no listener leak.
    assert.equal(ws.listenerCount('change'), 0);
  });

  it('POSTs to SUPABASE_WEBHOOK_URL with the auth header and body envelope', async () => {
    received = [];
    const ws = new WorldState();
    const sink = new ExternalSink({
      worldState: ws,
      env: { SUPABASE_WEBHOOK_URL: mockUrl + '/sb', SUPABASE_WEBHOOK_KEY: 'sk_test' },
    });
    sink.attach();
    ws.pushEvent('shipped', 'Edward finished login');
    await wait(200);
    sink.detach();
    assert.equal(received.length, 1);
    assert.equal(received[0].path, '/sb');
    assert.equal(received[0].auth, 'Bearer sk_test');
    const parsed = JSON.parse(received[0].body);
    assert.equal(parsed.source, 'denizen');
    assert.equal(parsed.kind, 'event');
    assert.equal(parsed.payload.text, 'Edward finished login');
  });

  it('respects EXTERNAL_SINK_KINDS filter', async () => {
    received = [];
    const ws = new WorldState();
    const sink = new ExternalSink({
      worldState: ws,
      env: {
        SUPABASE_WEBHOOK_URL: mockUrl + '/filtered',
        EXTERNAL_SINK_KINDS: 'task,threat', // events should NOT forward
      },
    });
    sink.attach();
    ws.pushEvent('shipped', 'should not forward');
    ws.upsertTask({ id: 'x', title: 'should forward' });
    await wait(200);
    sink.detach();
    assert.equal(received.length, 1);
    assert.equal(JSON.parse(received[0].body).kind, 'task');
  });

  it('disables a sink after 5 consecutive failures', async () => {
    received = [];
    const ws = new WorldState();
    const sink = new ExternalSink({
      worldState: ws,
      env: { SUPABASE_WEBHOOK_URL: mockUrl + '/fail' },
    });
    sink.attach();
    // Sequence with awaits so the failure counter increments BEFORE the
    // next request fires — otherwise async fire-and-forget queues all 7
    // before the first response lands. In production this is fine; for
    // the test we just want to verify the disable threshold trips and
    // subsequent events don't fire any more requests.
    for (let i = 0; i < 5; i++) {
      ws.pushEvent('shipped', 'x' + i);
      await wait(60);
    }
    assert.equal(sink.sinks[0].disabled, true);
    const before = received.length;
    // Events fired after disable should NOT produce new requests.
    ws.pushEvent('shipped', 'after-disable-1');
    ws.pushEvent('shipped', 'after-disable-2');
    await wait(100);
    sink.detach();
    assert.equal(received.length, before, 'no new requests after disable');
  });

  it('forwards to both SUPABASE and N8N when both configured', async () => {
    received = [];
    const ws = new WorldState();
    const sink = new ExternalSink({
      worldState: ws,
      env: {
        SUPABASE_WEBHOOK_URL: mockUrl + '/sb',
        N8N_WEBHOOK_URL: mockUrl + '/n8n',
      },
    });
    sink.attach();
    ws.pushEvent('shipped', 'fanout test');
    await wait(200);
    sink.detach();
    const paths = received.map(r => r.path).sort();
    assert.deepEqual(paths, ['/n8n', '/sb']);
  });
});
