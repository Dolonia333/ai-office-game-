'use strict';
/**
 * Integration test for /api/request-animation + /api/animation-proposals.
 *
 * Boots the real server on a random port with a temp HOME so config
 * lookups don't read the dev user's openclaw.json. Mirrors the pattern
 * in place-furniture-endpoint.test.js — including the post-test cleanup
 * that strips our test rows out of data/animation-proposals.json so the
 * dev tree stays clean.
 *
 * Asserts:
 *   - happy-path POST persists the proposal and returns it
 *   - malformed animName returns 400
 *   - per-NPC daily budget (2) → 3rd call returns 429
 *   - 'system' caller is exempt from the budget
 *   - GET returns the current proposals list including the new one
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let serverProc;
let baseUrl;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-animreq-test-'));

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
  const port = 9900 + Math.floor(Math.random() * 80);
  baseUrl = `http://127.0.0.1:${port}`;
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

  // Roll back our test proposals so we don't pollute the dev data file.
  // The "system caller is exempt" test posts with by:'system', so we
  // also strip rows whose animName starts with our sys_anim_ prefix.
  const propPath = path.join(__dirname, '..', 'data', 'animation-proposals.json');
  try {
    const raw = fs.readFileSync(propPath, 'utf8');
    const store = JSON.parse(raw);
    if (Array.isArray(store.proposals)) {
      store.proposals = store.proposals.filter(p =>
        !String(p.by || '').startsWith('TEST_') &&
        !String(p.animName || '').startsWith('sys_anim_')
      );
      fs.writeFileSync(propPath, JSON.stringify(store, null, 2), 'utf8');
    }
  } catch (_) { /* best-effort */ }
});

async function request(by, animName, description) {
  const res = await fetch(`${baseUrl}/api/request-animation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ by, animName, description }),
  });
  return { status: res.status, body: await res.json() };
}

describe('/api/request-animation happy path', () => {
  it('persists the proposal and returns it', async () => {
    const r = await request('TEST_Happy', 'meditate', 'sitting cross-legged with eyes closed');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.proposal.by, 'TEST_Happy');
    assert.equal(r.body.proposal.animName, 'meditate');
    assert.equal(r.body.proposal.description, 'sitting cross-legged with eyes closed');
    assert.equal(r.body.proposal.status, 'pending');
    assert.ok(typeof r.body.proposal.id === 'string' && r.body.proposal.id.startsWith('anim_'));
    assert.ok(typeof r.body.proposal.proposedAt === 'number');
  });
});

describe('/api/request-animation validation', () => {
  it('rejects bad animName (uppercase)', async () => {
    const r = await request('TEST_BadName', 'Meditate', 'x');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /animName/);
  });

  it('rejects bad animName (punctuation)', async () => {
    const r = await request('TEST_BadName2', 'medi-tate', 'x');
    assert.equal(r.status, 400);
  });

  it('rejects overlong description', async () => {
    const r = await request('TEST_LongDesc', 'meditate', 'a'.repeat(201));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /too long/);
  });

  it('rejects empty description', async () => {
    const r = await request('TEST_Empty', 'meditate', '');
    assert.equal(r.status, 400);
  });
});

describe('/api/request-animation daily budget', () => {
  it('TEST_Budget can request 2 then is rejected on the 3rd', async () => {
    const r1 = await request('TEST_Budget', 'meditate', 'first');
    const r2 = await request('TEST_Budget', 'sketch', 'second');
    const r3 = await request('TEST_Budget', 'garden', 'third');
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    assert.match(r3.body.error, /daily animation-request budget/);
    assert.equal(r3.body.requestedToday, 2);
  });

  it('system caller is exempt', async () => {
    // 4 requests as 'system' should all succeed.
    for (let i = 0; i < 4; i++) {
      const r = await request('system', `sys_anim_${i}`, `system seed ${i}`);
      assert.equal(r.status, 200);
    }
  });
});

describe('/api/animation-proposals', () => {
  it('returns the current proposals list', async () => {
    // Add a marker proposal first so we know what to look for.
    const marker = await request('TEST_Listed', 'listed_anim', 'marker proposal');
    assert.equal(marker.status, 200);

    const res = await fetch(`${baseUrl}/api/animation-proposals`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.proposals));
    const found = body.proposals.find(p => p.id === marker.body.proposal.id);
    assert.ok(found, 'marker proposal should appear in the GET listing');
    assert.equal(found.animName, 'listed_anim');
  });
});
