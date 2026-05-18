'use strict';
/**
 * Integration test for the unified /api/proposals aggregate read +
 * /api/animation-proposal/approve.
 *
 * Boots the real server on a random port, seeds one animation proposal
 * and one SOUL proposal via the existing POST endpoints, then verifies:
 *   - GET /api/proposals returns both, kind-tagged
 *   - default ?status=pending filter
 *   - status=all returns approved + pending
 *   - kind=animation returns only animations
 *   - kind=animation,soul returns both
 *   - the hard cap of 100 is enforced (we synthesize a >100-row file)
 *   - capability-proposals.json is absent → endpoint skips it gracefully
 *   - POST /api/animation-proposal/approve flips status
 *
 * All seeded rows use a TEST_ prefix so the `after` hook can strip them
 * out of data/animation-proposals.json + data/soul-proposals.json
 * without leaving runtime drift behind.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let serverProc;
let baseUrl;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-proposals-test-'));

const ANIM_FILE = path.join(__dirname, '..', 'data', 'animation-proposals.json');
const SOUL_FILE = path.join(__dirname, '..', 'data', 'soul-proposals.json');
const CAP_FILE = path.join(__dirname, '..', 'data', 'capability-proposals.json');

function readProposalsFile(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (!Array.isArray(j.proposals)) j.proposals = [];
    return j;
  } catch (_) {
    return { proposals: [] };
  }
}

function writeProposalsFile(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function stripTestRows(file) {
  if (!fs.existsSync(file)) return;
  const j = readProposalsFile(file);
  j.proposals = j.proposals.filter(p => {
    if (!p) return false;
    const owner = String(p.by || p.npcName || '');
    const id = String(p.id || '');
    return !(owner.startsWith('TEST_') || id.startsWith('TEST_'));
  });
  writeProposalsFile(file, j);
}

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
  const port = 9300 + Math.floor(Math.random() * 600);
  baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOME: tmpHome, USERPROFILE: tmpHome };
  env.LM_STUDIO_URL = 'http://127.0.0.1:1';

  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(__dirname, '..'),
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});

  await waitForServer(baseUrl);

  // Make sure no leftover TEST_ rows from a previous bad run skew our
  // counts. The after hook will run the same cleanup.
  stripTestRows(ANIM_FILE);
  stripTestRows(SOUL_FILE);
  if (fs.existsSync(CAP_FILE)) {
    stripTestRows(CAP_FILE);
  }
});

after(() => {
  if (serverProc && !serverProc.killed) killProcessTree(serverProc.pid);
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}

  stripTestRows(ANIM_FILE);
  stripTestRows(SOUL_FILE);
  if (fs.existsSync(CAP_FILE)) {
    stripTestRows(CAP_FILE);
    // If we left the file empty (i.e. nothing besides our test seeds
    // was ever in it), unlink it. We only ever create this file inside
    // the test; the real capability endpoint that lands later is free
    // to lazy-create it on first POST the same way SOUL does.
    try {
      const remaining = readProposalsFile(CAP_FILE);
      if (Array.isArray(remaining.proposals) && remaining.proposals.length === 0) {
        fs.unlinkSync(CAP_FILE);
      }
    } catch (_) { /* best effort */ }
  }
});

async function seedAnimation(by, animName, description = 'desk_typing') {
  const res = await fetch(`${baseUrl}/api/request-animation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ by, animName, description }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function seedSoul(npcName) {
  const res = await fetch(`${baseUrl}/api/soul-proposal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      npcName,
      proposal: {
        addToSoul: 'I write more tests than I sleep.',
        dropFromSoul: null,
        summary: 'aggregate-endpoint integration test seed',
        confidence: 0.5,
      },
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

describe('GET /api/proposals — basic shape + filters', () => {
  it('returns both seeded animation and soul proposals, kind-tagged', async () => {
    const aResp = await seedAnimation('TEST_AggA', 'test_anim_a', 'desk typing');
    assert.equal(aResp.status, 200, JSON.stringify(aResp.body));
    const sResp = await seedSoul('TEST_AggS');
    assert.equal(sResp.status, 200, JSON.stringify(sResp.body));

    const res = await fetch(`${baseUrl}/api/proposals?status=pending`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.proposals), 'proposals must be an array');

    const ours = json.proposals.filter(p => {
      const owner = (p.by || '') + '';
      return owner.startsWith('TEST_Agg') || (p.kind === 'animation' && owner === 'TEST_AggA') || (p.kind === 'soul' && owner === 'TEST_AggS');
    });
    const kinds = new Set(ours.map(p => p.kind));
    assert.ok(kinds.has('animation'), 'should contain an animation kind');
    assert.ok(kinds.has('soul'), 'should contain a soul kind');

    // Each entry has the expected shape.
    for (const p of ours) {
      assert.ok(p.id, 'id is required');
      assert.ok(p.kind, 'kind is required');
      assert.ok(typeof p.summary === 'string', 'summary string');
      assert.ok(p.status, 'status string');
      assert.ok('raw' in p, 'raw envelope');
    }
  });

  it('sorts newest-first by timestamp', async () => {
    const res = await fetch(`${baseUrl}/api/proposals?status=all`);
    const json = await res.json();
    const timestamps = json.proposals.map(p => Number(p.ts) || 0);
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(timestamps[i - 1] >= timestamps[i], `not sorted desc at index ${i}`);
    }
  });

  it('?status=pending is the default and excludes approved', async () => {
    // Approve one of the animation proposals we already created.
    const all = await (await fetch(`${baseUrl}/api/proposals?status=pending`)).json();
    const target = all.proposals.find(p => p.kind === 'animation' && /^TEST_Agg/.test(p.by));
    assert.ok(target, 'expected seeded TEST_Agg animation to be present');

    const approveRes = await fetch(`${baseUrl}/api/animation-proposal/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: target.id, decision: 'approved' }),
    });
    assert.equal(approveRes.status, 200, await approveRes.text());

    // The approved one should no longer appear in pending (default).
    const pendingRes = await fetch(`${baseUrl}/api/proposals`);
    const pendingJson = await pendingRes.json();
    const stillPending = pendingJson.proposals.find(p => p.id === target.id);
    assert.equal(stillPending, undefined);

    // But ?status=approved should include it.
    const approvedRes = await fetch(`${baseUrl}/api/proposals?status=approved`);
    const approvedJson = await approvedRes.json();
    assert.ok(approvedJson.proposals.some(p => p.id === target.id));
  });

  it('?kind=animation returns only animations', async () => {
    const res = await fetch(`${baseUrl}/api/proposals?status=all&kind=animation`);
    const json = await res.json();
    assert.ok(json.proposals.length > 0);
    for (const p of json.proposals) {
      assert.equal(p.kind, 'animation');
    }
  });

  it('?kind=animation,soul returns both kinds', async () => {
    const res = await fetch(`${baseUrl}/api/proposals?status=all&kind=animation,soul`);
    const json = await res.json();
    const kinds = new Set(json.proposals.map(p => p.kind));
    assert.ok(kinds.has('animation'));
    assert.ok(kinds.has('soul'));
    // Should not contain capability even if file exists (filter says no).
    assert.ok(!kinds.has('capability'));
  });

  it('hard-caps response at 100 entries even when more exist', async () => {
    // Seed 105 synthetic animation rows directly into the file. We
    // bypass the endpoint because the per-NPC budget would block a real
    // 105-row run; and we're testing the GET response, not the POST
    // validator.
    const file = readProposalsFile(ANIM_FILE);
    const now = Date.now();
    for (let i = 0; i < 105; i++) {
      file.proposals.push({
        id: `TEST_cap_${now}_${i}`,
        by: `TEST_CapSeed_${i}`,
        animName: `test_cap_${i}`,
        description: 'hard cap synthesis',
        proposedAt: now + i,
        status: 'pending',
      });
    }
    writeProposalsFile(ANIM_FILE, file);

    const res = await fetch(`${baseUrl}/api/proposals?status=pending&kind=animation`);
    const json = await res.json();
    assert.ok(json.proposals.length <= 100, `expected ≤100, got ${json.proposals.length}`);
    assert.equal(json.proposals.length, 100);
    assert.equal(json.cap, 100);
    assert.equal(json.truncated, true);
  });

  it('handles a missing capability-proposals.json file gracefully', async () => {
    // Ensure the file doesn't exist by removing it if our hard-cap run
    // somehow created it (it shouldn't have).
    try { fs.unlinkSync(CAP_FILE); } catch (_) { /* fine */ }

    const res = await fetch(`${baseUrl}/api/proposals?status=all&kind=capability`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.proposals));
    assert.equal(json.proposals.length, 0);
  });

  it('picks up a capability-proposals.json file when present', async () => {
    // Create a synthetic capability proposals file the way the future
    // Stage 4 endpoint would.
    writeProposalsFile(CAP_FILE, {
      proposals: [
        {
          id: 'TEST_cap_op',
          by: 'TEST_CapOp',
          verbName: 'whiteboardDraw',
          description: 'write text on the whiteboard',
          proposedAt: Date.now(),
          status: 'pending',
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/proposals?status=pending&kind=capability`);
    const json = await res.json();
    const ours = json.proposals.find(p => p.id === 'TEST_cap_op');
    assert.ok(ours, 'capability seed should be visible');
    assert.equal(ours.kind, 'capability');
    assert.match(ours.summary, /whiteboardDraw/);
  });
});

describe('POST /api/animation-proposal/approve', () => {
  it('rejects missing id', async () => {
    const res = await fetch(`${baseUrl}/api/animation-proposal/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects invalid decision', async () => {
    const res = await fetch(`${baseUrl}/api/animation-proposal/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'whatever', decision: 'maybe' }),
    });
    assert.equal(res.status, 400);
  });

  it('404s on unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/animation-proposal/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'TEST_does_not_exist', decision: 'rejected' }),
    });
    assert.equal(res.status, 404);
  });

  it('flips status to rejected and records the review', async () => {
    // Seed a fresh proposal so we know its id.
    const seed = await seedAnimation('TEST_AggReject', 'test_anim_reject', 'will be rejected');
    assert.equal(seed.status, 200);
    const id = seed.body.proposal.id;

    const res = await fetch(`${baseUrl}/api/animation-proposal/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision: 'rejected', note: 'integration test' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.proposal.status, 'rejected');
    assert.equal(body.proposal.review.decision, 'rejected');
    assert.equal(body.proposal.review.note, 'integration test');
    assert.ok(body.proposal.review.reviewedAt);
  });
});
