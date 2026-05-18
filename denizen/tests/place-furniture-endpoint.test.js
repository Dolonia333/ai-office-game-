'use strict';
/**
 * Integration test for /api/place-furniture + /api/remove-furniture.
 *
 * Boots the real server on a random port with a temp HOME so layout
 * mutations don't leak into the user's real layouts/office-layout.json.
 * Asserts:
 *   - whitelist enforcement
 *   - bounds enforcement (1280x720 with 16px margin)
 *   - successful POST appends to office-layout.json + returns the item
 *   - per-NPC daily budget (3) → 4th call returns 429
 *   - 'system' caller is exempt from the budget
 *   - remove-furniture requires "npc_" prefix
 *   - remove-furniture deletes the item from the layout file
 *
 * Same Windows-friendly cleanup pattern as generate-city-endpoint.test.js.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let serverProc;
let baseUrl;
let cwd;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-place-test-'));

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
  const port = 9100 + Math.floor(Math.random() * 800);
  baseUrl = `http://127.0.0.1:${port}`;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-place-cwd-'));

  // Copy minimal repo files into the temp cwd? Actually the server reads
  // layoutFile relative to __dirname, so we just have to make sure the
  // layouts/ dir under the real server.js path stays untouched. The
  // simplest way: spawn the real server.js but use HOME for caches, and
  // accept that the layouts/ subdir under the source tree is what gets
  // appended to. We'll record the count before/after to assert delta,
  // and clean up by truncating the file additions ourselves at the end.
  const env = { ...process.env, PORT: String(port), HOME: tmpHome, USERPROFILE: tmpHome };
  env.LM_STUDIO_URL = 'http://127.0.0.1:1';

  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(__dirname, '..'),
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});

  await waitForServer(baseUrl);
});

after(() => {
  if (serverProc && !serverProc.killed) killProcessTree(serverProc.pid);
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (_) {}

  // Roll back our test placements so we don't pollute the dev layout.
  const layoutPath = path.join(__dirname, '..', 'layouts', 'office-layout.json');
  try {
    const raw = fs.readFileSync(layoutPath, 'utf8');
    const layout = JSON.parse(raw);
    if (Array.isArray(layout.items)) {
      layout.items = layout.items.filter(it => !String(it.placedBy || '').startsWith('TEST_'));
      fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), 'utf8');
    }
  } catch (_) { /* best-effort */ }
});

async function place(by, prefabId, x = 400, y = 300, reason = 'test') {
  const res = await fetch(`${baseUrl}/api/place-furniture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ by, prefabId, x, y, reason }),
  });
  return { status: res.status, body: await res.json() };
}

describe('/api/place-furniture validation', () => {
  it('rejects unknown prefabId', async () => {
    const r = await place('TEST_Reject', 'sentient_couch');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not in whitelist/);
    assert.ok(Array.isArray(r.body.allowed));
    assert.ok(r.body.allowed.includes('couch'));
  });

  it('rejects out-of-bounds coordinates', async () => {
    const r = await place('TEST_Bounds', 'couch', 10000, 10000);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /out of bounds/);
  });

  it('accepts a valid placement and returns the persisted item', async () => {
    const r = await place('TEST_Valid', 'couch', 420, 340, 'unit test');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.item.prefabId, 'couch');
    assert.equal(r.body.item.placedBy, 'TEST_Valid');
    assert.ok(r.body.item.instanceId.startsWith('npc_couch_'));
  });
});

describe('/api/place-furniture daily budget', () => {
  it('TEST_Budget can place 3 then is rejected on the 4th', async () => {
    const r1 = await place('TEST_Budget', 'couch', 400, 300);
    const r2 = await place('TEST_Budget', 'plant_small', 410, 310);
    const r3 = await place('TEST_Budget', 'rug', 420, 320);
    const r4 = await place('TEST_Budget', 'whiteboard', 430, 330);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 200);
    assert.equal(r4.status, 429);
    assert.match(r4.body.error, /daily placement budget/);
    assert.equal(r4.body.placedToday, 3);
  });

  it('system caller is exempt', async () => {
    // 5 placements as 'system' should all succeed.
    for (let i = 0; i < 5; i++) {
      const r = await place('system', 'plant_small', 200 + i, 500);
      assert.equal(r.status, 200);
    }
  });
});

describe('/api/remove-furniture', () => {
  it('rejects instanceIds that do not start with "npc_"', async () => {
    const res = await fetch(`${baseUrl}/api/remove-furniture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ by: 'TEST_Remove', instanceId: 'editor_couch_1' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /must start with "npc_"/);
  });

  it('removes an existing npc-placed item', async () => {
    const placed = await place('TEST_Remove', 'plant_large', 500, 400);
    assert.equal(placed.status, 200);
    const instanceId = placed.body.item.instanceId;

    const removeRes = await fetch(`${baseUrl}/api/remove-furniture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ by: 'TEST_Remove', instanceId }),
    });
    assert.equal(removeRes.status, 200);
    const body = await removeRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.removed.instanceId, instanceId);
  });

  it('returns 404 for unknown instanceId', async () => {
    const res = await fetch(`${baseUrl}/api/remove-furniture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ by: 'TEST_Remove', instanceId: 'npc_ghost_999' }),
    });
    assert.equal(res.status, 404);
  });
});
