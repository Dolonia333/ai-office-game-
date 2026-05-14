'use strict';
/**
 * Integration test for /api/generate-city.
 *
 * Boots the real server on a random port (no LM Studio / Anthropic
 * required — the heuristic path is what we assert on) and hits the
 * endpoint with curl-equivalent fetches. The companion `/api/llm-city-plan`
 * endpoint is exercised end-to-end manually in smoke tests; here we focus
 * on the deterministic generate-city flow because asserting fallback
 * behaviour requires controlling the absence of API keys which is fragile
 * across dev machines.
 *
 * Windows note: spawning Node child procs and killing them via SIGTERM is
 * unreliable, so the after() hook uses taskkill (Windows) or SIGKILL
 * (POSIX) and never waits longer than 3s for cleanup.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let serverProc;
let baseUrl;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-city-test-'));

function waitForServer(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (async function poll() {
      try {
        const res = await fetch(url + '/api/world-state', { cache: 'no-store' });
        if (res.ok) return resolve();
      } catch (_) { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error('server never came up'));
      setTimeout(poll, 200);
    })();
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }
}

before(async () => {
  const port = 9000 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;

  const env = { ...process.env, PORT: String(port), HOME: tmpHome, USERPROFILE: tmpHome };
  delete env.CITY_PLAN_PROVIDER;
  delete env.SUPABASE_WEBHOOK_URL;
  delete env.N8N_WEBHOOK_URL;
  // Point LM Studio at a port that's definitely not listening. The
  // bundle always registers an lmstudio provider regardless of HOME, so
  // without this the /api/llm-city-plan handler tries to hit a real
  // LM Studio and hangs the test runner. With this, the request errors
  // immediately and the endpoint falls back to the heuristic — which is
  // exactly the path we're asserting on.
  env.LM_STUDIO_URL = 'http://127.0.0.1:1';

  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(__dirname, '..'),
  });
  // Drain stdio so the pipes don't fill and block the child.
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});

  await waitForServer(baseUrl);
});

after(() => {
  // No promise: synchronous best-effort cleanup. The test runner has
  // already finished asserting; we don't need to wait for the child to
  // confirm death.
  if (serverProc && !serverProc.killed) killProcessTree(serverProc.pid);
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
});

describe('/api/generate-city', () => {
  it('returns plan + chunk for a small grid', async () => {
    const res = await fetch(`${baseUrl}/api/generate-city?seed=t&width=24&height=16&roadStride=6`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.plan, 'plan present');
    assert.ok(Array.isArray(data.plan.zones));
    assert.ok(data.chunk, 'chunk present');
    assert.equal(data.chunk.width, 24);
    assert.equal(data.chunk.height, 16);
    assert.ok(Array.isArray(data.chunk.layers));
  });

  it('larger chunk produces buildings + interior', async () => {
    const res = await fetch(`${baseUrl}/api/generate-city?seed=t&width=64&height=48&roadStride=12`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.chunk.buildings) && data.chunk.buildings.length > 0, 'buildings');
    assert.ok(data.sampleInterior, 'sampleInterior');
    assert.equal(data.sampleInterior.buildingId, data.chunk.buildings[0].id);
  });

  it('same seed → identical plan (determinism)', async () => {
    const u = `${baseUrl}/api/generate-city?seed=identity&width=24&height=16`;
    const [a, b] = await Promise.all([fetch(u).then(r => r.json()), fetch(u).then(r => r.json())]);
    assert.deepEqual(a.plan, b.plan);
  });

  it('clamps absurd dimensions', async () => {
    const res = await fetch(`${baseUrl}/api/generate-city?seed=t&width=99999&height=-5&roadStride=1`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.chunk.width <= 256);
    assert.ok(data.chunk.height >= 8);
  });

  it('falls back to heuristic on /api/llm-city-plan when no provider is configured', async () => {
    const res = await fetch(`${baseUrl}/api/llm-city-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'tiny test city', seed: 's', gridW: 4, gridH: 3 }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.gridW, 4);
    assert.equal(data.gridH, 3);
    assert.equal(data.zones.length, 12);
    // Source should be 'heuristic' — the test boots server with a clean
    // HOME so NpcBrainManager has no openclaw.json and falls back.
    assert.equal(data.source, 'heuristic');
  });
});
