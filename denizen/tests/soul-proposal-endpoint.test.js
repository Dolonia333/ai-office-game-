'use strict';
/**
 * Integration test for the SOUL.md self-revision proposal endpoints
 * (Roadmap Stage 3 step 2): /api/soul-proposal, /api/soul-proposals,
 * /api/soul-proposal/approve.
 *
 * Same boot pattern as place-furniture-endpoint.test.js: spawn the real
 * server.js on a random port with a temp HOME so user config can't leak
 * in. The proposals file lives next to server.js (data/soul-proposals.json)
 * so we tag every test proposal with a TEST_ prefixed npcName and strip
 * those out in teardown — matches the place-furniture cleanup style.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let serverProc;
let baseUrl;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-soul-test-'));

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

function validProposalBody(npcName, over = {}) {
  return {
    npcName,
    proposal: Object.assign({
      addToSoul: 'I review PRs more than I plan sprints.',
      dropFromSoul: null,
      summary: 'Reflection: my behavior favors review over planning.',
      confidence: 0.7,
    }, over),
    reflectionInput: 'mocked memory excerpt for the test',
  };
}

async function post(url, body) {
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(url) {
  const res = await fetch(`${baseUrl}${url}`);
  return { status: res.status, body: await res.json() };
}

before(async () => {
  const port = 9900 + Math.floor(Math.random() * 90);
  baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOME: tmpHome, USERPROFILE: tmpHome };
  env.LM_STUDIO_URL = 'http://127.0.0.1:1'; // unreachable on purpose
  // Per-process proposals file so parallel test files can't lose-update
  // each other's writes (the read-modify-write isn't atomic).
  env.SOUL_PROPOSALS_PATH = path.join(tmpHome, 'soul-proposals.json');

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
  // The test process wrote proposals to a per-process file inside tmpHome
  // (env.SOUL_PROPOSALS_PATH). The real data/soul-proposals.json was
  // never touched, so no global cleanup is needed.
});

describe('POST /api/soul-proposal — happy path + validation', () => {
  it('accepts a valid proposal and returns an id', async () => {
    const r = await post('/api/soul-proposal', validProposalBody('TEST_Happy'));
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(typeof r.body.id === 'string' && r.body.id.length > 0);
  });

  it('rejects out-of-range confidence', async () => {
    const r = await post('/api/soul-proposal', validProposalBody('TEST_BadConfidence', { confidence: 2 }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /confidence/);
  });

  it('rejects when summary is missing', async () => {
    const r = await post('/api/soul-proposal', validProposalBody('TEST_NoSummary', { summary: undefined }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /summary/);
  });

  it('rejects a no-op proposal (both null)', async () => {
    const r = await post('/api/soul-proposal', validProposalBody('TEST_NoOp', {
      addToSoul: null,
      dropFromSoul: null,
    }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no-op/);
  });

  it('rejects missing npcName', async () => {
    const r = await post('/api/soul-proposal', {
      proposal: validProposalBody('X').proposal,
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /npcName/);
  });
});

describe('POST /api/soul-proposal — daily cap', () => {
  it('returns 429 on the 2nd proposal from the same NPC on the same day', async () => {
    // First proposal — fresh npcName so we don't trip a prior test.
    const r1 = await post('/api/soul-proposal', validProposalBody('TEST_DailyCap'));
    assert.equal(r1.status, 200);
    const r2 = await post('/api/soul-proposal', validProposalBody('TEST_DailyCap', {
      addToSoul: 'second attempt should be blocked',
    }));
    assert.equal(r2.status, 429);
    assert.equal(r2.body.cap, 1);
  });
});

describe('GET /api/soul-proposals', () => {
  it('returns proposals including ones we just posted', async () => {
    const post1 = await post('/api/soul-proposal', validProposalBody('TEST_Listable'));
    assert.equal(post1.status, 200);

    const r = await get('/api/soul-proposals');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.proposals));
    const found = r.body.proposals.find(p => p.id === post1.body.id);
    assert.ok(found, 'just-posted proposal should be present');
    assert.equal(found.status, 'pending');
    assert.equal(found.npcName, 'TEST_Listable');
  });

  it('filters by ?npc=Name', async () => {
    const p1 = await post('/api/soul-proposal', validProposalBody('TEST_FilterA'));
    assert.equal(p1.status, 200);
    const p2 = await post('/api/soul-proposal', validProposalBody('TEST_FilterB'));
    assert.equal(p2.status, 200);

    const r = await get('/api/soul-proposals?npc=TEST_FilterA');
    assert.equal(r.status, 200);
    assert.ok(r.body.proposals.length >= 1);
    for (const p of r.body.proposals) {
      assert.equal(p.npcName, 'TEST_FilterA');
    }
  });
});

describe('POST /api/soul-proposal/approve', () => {
  it('marks an existing proposal as approved (without touching SOUL.md)', async () => {
    const created = await post('/api/soul-proposal', validProposalBody('TEST_Approve'));
    assert.equal(created.status, 200);
    const id = created.body.id;

    const r = await post('/api/soul-proposal/approve', { id, decision: 'approved', note: 'looks good' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.proposal.status, 'approved');
    assert.equal(r.body.proposal.review.decision, 'approved');
    assert.equal(r.body.proposal.review.note, 'looks good');
  });

  it('marks an existing proposal as rejected', async () => {
    const created = await post('/api/soul-proposal', validProposalBody('TEST_Reject'));
    assert.equal(created.status, 200);
    const id = created.body.id;

    const r = await post('/api/soul-proposal/approve', { id, decision: 'rejected' });
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.status, 'rejected');
  });

  it('returns 400 on an invalid decision', async () => {
    const created = await post('/api/soul-proposal', validProposalBody('TEST_BadDecision'));
    assert.equal(created.status, 200);
    const r = await post('/api/soul-proposal/approve', { id: created.body.id, decision: 'maybe' });
    assert.equal(r.status, 400);
  });

  it('returns 404 for an unknown id', async () => {
    const r = await post('/api/soul-proposal/approve', { id: 'proposal_does_not_exist', decision: 'approved' });
    assert.equal(r.status, 404);
  });
});
