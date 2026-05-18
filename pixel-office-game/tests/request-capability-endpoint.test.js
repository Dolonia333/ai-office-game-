'use strict';
/**
 * Integration test for /api/request-capability, /api/capability-proposals,
 * and /api/capability-proposal/approve (Roadmap Stage 4 step 1).
 *
 * Boots the real server on a random port with a temp HOME so config
 * lookups don't read the dev user's openclaw.json. Mirrors the pattern
 * in request-animation-endpoint.test.js — including the post-test
 * cleanup that strips our test rows out of data/capability-proposals.json
 * so the dev tree stays clean.
 *
 * Asserts:
 *   - happy-path POST persists the proposal and returns it
 *   - malformed verbName returns 400
 *   - per-NPC daily budget (1) → 2nd call returns 429
 *   - 'system' caller is exempt from the budget
 *   - GET returns the proposals list
 *   - GET with ?status=approved filters correctly
 *   - POST /approve with bad decision → 400
 *   - POST /approve with unknown id → 404
 *   - POST /approve flips status correctly
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let serverProc;
let baseUrl;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-capreq-test-'));
const CAP_PROPOSALS_PATH = path.join(__dirname, '..', 'data', 'capability-proposals.json');

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
  const port = 9900 + Math.floor(Math.random() * 90);
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
  // The "system caller is exempt" test posts with by:'system', so we also
  // strip rows whose verbName starts with our sys_cap_ prefix.
  try {
    const raw = fs.readFileSync(CAP_PROPOSALS_PATH, 'utf8');
    const store = JSON.parse(raw);
    if (Array.isArray(store.proposals)) {
      store.proposals = store.proposals.filter(p =>
        !String(p.by || '').startsWith('TEST_') &&
        !String(p.verbName || '').startsWith('sysCap')
      );
      fs.writeFileSync(CAP_PROPOSALS_PATH, JSON.stringify(store, null, 2), 'utf8');
    }
  } catch (_) { /* best-effort */ }
});

async function request(by, verbName, description) {
  const res = await fetch(`${baseUrl}/api/request-capability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ by, verbName, description }),
  });
  return { status: res.status, body: await res.json() };
}

async function postApprove(body) {
  const res = await fetch(`${baseUrl}/api/capability-proposal/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getProposals(qs = '') {
  const res = await fetch(`${baseUrl}/api/capability-proposals${qs}`);
  return { status: res.status, body: await res.json() };
}

describe('/api/request-capability happy path', () => {
  it('persists the proposal and returns it', async () => {
    const r = await request('TEST_Happy', 'whiteboardDraw',
      'Render short text on the whiteboard sprite at the room I am standing in.');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.proposal.by, 'TEST_Happy');
    assert.equal(r.body.proposal.verbName, 'whiteboardDraw');
    assert.equal(r.body.proposal.status, 'pending');
    assert.ok(typeof r.body.proposal.id === 'string' && r.body.proposal.id.startsWith('cap_'));
    assert.ok(typeof r.body.proposal.proposedAt === 'number');
    assert.equal(r.body.proposal.review, null);
  });
});

describe('/api/request-capability validation', () => {
  it('rejects bad verbName (uppercase first letter)', async () => {
    const r = await request('TEST_BadName', 'WhiteboardDraw', 'A long enough description for the verb.');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /verbName/);
  });

  it('rejects bad verbName (kebab-case)', async () => {
    const r = await request('TEST_BadName2', 'whiteboard-draw', 'A long enough description for the verb.');
    assert.equal(r.status, 400);
  });

  it('rejects verbName longer than 31 chars', async () => {
    const r = await request('TEST_BadName3', 'a' + 'B'.repeat(31), 'A long enough description for the verb.');
    assert.equal(r.status, 400);
  });

  it('rejects too-short description', async () => {
    const r = await request('TEST_ShortDesc', 'meditate', 'too short');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /description/);
  });

  it('rejects overlong description', async () => {
    const r = await request('TEST_LongDesc', 'meditate', 'a'.repeat(401));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /too long/);
  });
});

describe('/api/request-capability daily budget', () => {
  it('TEST_Budget can request 1 then is rejected on the 2nd same-day request', async () => {
    const r1 = await request('TEST_Budget', 'meditate', 'Enter a focused state for several seconds.');
    const r2 = await request('TEST_Budget', 'gardening', 'Tend to the office plants during lunch.');
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 429);
    assert.match(r2.body.error, /daily capability-request budget/);
    assert.equal(r2.body.requestedToday, 1);
  });

  it('system caller is exempt', async () => {
    // 3 requests as 'system' should all succeed.
    for (let i = 0; i < 3; i++) {
      const r = await request('system', `sysCap${i}`, `system-seeded capability number ${i}.`);
      assert.equal(r.status, 200);
    }
  });
});

describe('GET /api/capability-proposals', () => {
  it('returns the current proposals list including a marker', async () => {
    const marker = await request('TEST_Listed', 'listedVerb', 'A marker proposal for the list GET test.');
    assert.equal(marker.status, 200);

    const r = await getProposals();
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.proposals));
    const found = r.body.proposals.find(p => p.id === marker.body.proposal.id);
    assert.ok(found, 'marker proposal should appear in the GET listing');
    assert.equal(found.verbName, 'listedVerb');
    assert.equal(found.status, 'pending');
  });

  it('filters by ?status=approved correctly', async () => {
    // Create one proposal and approve it; create a second and leave it pending.
    const created = await request('TEST_FilterApproved', 'approvedVerb', 'Will be approved for the filter test.');
    assert.equal(created.status, 200);
    const approve = await postApprove({ id: created.body.proposal.id, decision: 'approved' });
    assert.equal(approve.status, 200);

    const pending = await request('TEST_FilterPending', 'pendingVerb', 'Will remain pending for the filter test.');
    assert.equal(pending.status, 200);

    const r = await getProposals('?status=approved');
    assert.equal(r.status, 200);
    assert.ok(r.body.proposals.length >= 1);
    for (const p of r.body.proposals) {
      assert.equal(p.status, 'approved');
    }
    // The pending one must not appear.
    assert.ok(!r.body.proposals.find(p => p.id === pending.body.proposal.id));
    // The approved one must appear.
    assert.ok(r.body.proposals.find(p => p.id === created.body.proposal.id));
  });
});

describe('POST /api/capability-proposal/approve', () => {
  it('flips status to approved and records the review block', async () => {
    const created = await request('TEST_Approve', 'approveTarget', 'A proposal that will be approved.');
    assert.equal(created.status, 200);
    const id = created.body.proposal.id;

    const r = await postApprove({ id, decision: 'approved', note: 'looks reasonable' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.proposal.status, 'approved');
    assert.equal(r.body.proposal.review.decision, 'approved');
    assert.equal(r.body.proposal.review.note, 'looks reasonable');
    assert.ok(typeof r.body.proposal.review.reviewedAt === 'string');
  });

  it('flips status to rejected when decision is rejected', async () => {
    const created = await request('TEST_Reject', 'rejectTarget', 'A proposal that will be rejected.');
    assert.equal(created.status, 200);
    const r = await postApprove({ id: created.body.proposal.id, decision: 'rejected' });
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.status, 'rejected');
  });

  it('returns 400 on an invalid decision', async () => {
    const created = await request('TEST_BadDecision', 'badDecisionTarget', 'A proposal used for the bad-decision test.');
    assert.equal(created.status, 200);
    const r = await postApprove({ id: created.body.proposal.id, decision: 'maybe' });
    assert.equal(r.status, 400);
  });

  it('returns 404 for an unknown id', async () => {
    const r = await postApprove({ id: 'cap_does_not_exist_xyz', decision: 'approved' });
    assert.equal(r.status, 404);
  });
});
