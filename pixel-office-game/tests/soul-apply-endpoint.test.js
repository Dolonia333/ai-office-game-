'use strict';
/**
 * Integration test for the SOUL.md self-revision *apply* endpoint
 * (Roadmap Stage 3 steps 3 + 4): /api/soul-proposal/apply.
 *
 * Boots the real server.js on a random port. Each apply test uses a
 * *temporary* NPC folder (`npcs/test_apply_*`) seeded with a minimal
 * SOUL.md so we never mutate real dev SOULs and never trip the
 * 1/NPC/UTC-day cap across tests running in parallel with the
 * proposal-endpoint test file. The temp folders are removed in
 * after(). TEST_-prefixed proposals are stripped from
 * `data/soul-proposals.json` in teardown to match the
 * proposal-endpoint cleanup pattern.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let serverProc;
let baseUrl;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-soul-apply-test-'));
const NPCS_DIR = path.join(__dirname, '..', 'npcs');

// Distinct display names per happy-path test so the per-NPC daily cap
// doesn't block subsequent tests. The server's _resolveNpcFolder lowercases
// unknown names and strips non-word chars — so "TEST_HappyApply" lands in
// folder "test_happyapply". We create the folders + SOUL.md ourselves.
const TEST_NPC_DISPLAY = 'TEST_HappyApply';
const IDEMPOTENT_NPC_DISPLAY = 'TEST_IdempotentApply';
const WARN_NPC_DISPLAY = 'TEST_WarnApply';

function _expectedFolder(display) {
  return String(display).toLowerCase().replace(/[^a-z0-9_]/g, '_');
}
function _soulPathFor(display) {
  return path.join(NPCS_DIR, _expectedFolder(display), 'SOUL.md');
}
function _historyPathFor(display) {
  return path.join(NPCS_DIR, _expectedFolder(display), 'SOUL.history.md');
}

const SOUL_PATH = _soulPathFor(TEST_NPC_DISPLAY);
const HISTORY_PATH = _historyPathFor(TEST_NPC_DISPLAY);
const IDEMPOTENT_SOUL_PATH = _soulPathFor(IDEMPOTENT_NPC_DISPLAY);
const WARN_SOUL_PATH = _soulPathFor(WARN_NPC_DISPLAY);

const TEMP_NPC_FOLDERS = [
  _expectedFolder(TEST_NPC_DISPLAY),
  _expectedFolder(IDEMPOTENT_NPC_DISPLAY),
  _expectedFolder(WARN_NPC_DISPLAY),
];

function _seedTempNpc(display) {
  const folder = path.join(NPCS_DIR, _expectedFolder(display));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'SOUL.md'),
    `# ${display}\n\n## Personality\nA temporary test soul.\n`,
    'utf8',
  );
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

async function post(url, body) {
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Submit a proposal *and* approve it so it's in the apply-ready state.
// Uses a unique npcName per call (TEST_-prefixed) to avoid the
// 1/NPC/UTC-day cap and to keep cleanup easy — except for the file-mutation
// test, which deliberately uses the real NPC name.
async function createAndApproveProposal(npcName, over = {}) {
  const proposal = Object.assign({
    addToSoul: 'I review PRs more than I plan sprints.',
    dropFromSoul: null,
    summary: 'review > planning',
    confidence: 0.7,
  }, over);
  const created = await post('/api/soul-proposal', {
    npcName, proposal, reflectionInput: 'test memory',
  });
  assert.equal(created.status, 200, `create failed: ${JSON.stringify(created.body)}`);
  const id = created.body.id;
  const approved = await post('/api/soul-proposal/approve', { id, decision: 'approved' });
  assert.equal(approved.status, 200, `approve failed: ${JSON.stringify(approved.body)}`);
  return id;
}

before(async () => {
  // Seed temp NPC folders before the server boots. The server doesn't
  // need to know about them — _resolveNpcFolder falls back to the
  // lowercased display name and the apply endpoint just reads from
  // disk, so a freshly-created folder works fine.
  _seedTempNpc(TEST_NPC_DISPLAY);
  _seedTempNpc(IDEMPOTENT_NPC_DISPLAY);
  _seedTempNpc(WARN_NPC_DISPLAY);

  const port = 9700 + Math.floor(Math.random() * 90);
  baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOME: tmpHome, USERPROFILE: tmpHome };
  env.LM_STUDIO_URL = 'http://127.0.0.1:1';
  // Each test process gets its own proposals file so parallel test files
  // can't lost-update each other's writes.
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

  // Remove the temp NPC folders we created in before(). SOUL.md and
  // SOUL.history.md (if it landed) go with the folder.
  for (const folder of TEMP_NPC_FOLDERS) {
    try { fs.rmSync(path.join(NPCS_DIR, folder), { recursive: true, force: true }); } catch (_) {}
  }
  // The test process wrote proposals to a per-process file inside tmpHome
  // (env.SOUL_PROPOSALS_PATH), so the real data/soul-proposals.json was
  // never touched. No cleanup needed there.
});

describe('POST /api/soul-proposal/apply — validation', () => {
  it('returns 400 when id is missing', async () => {
    const r = await post('/api/soul-proposal/apply', {});
    assert.equal(r.status, 400);
    assert.match(r.body.error, /id is required/);
  });

  it('returns 404 for an unknown proposal id', async () => {
    const r = await post('/api/soul-proposal/apply', { id: 'proposal_does_not_exist' });
    assert.equal(r.status, 404);
  });

  it('refuses to apply a pending (not-yet-approved) proposal', async () => {
    // Create only — do NOT approve.
    const created = await post('/api/soul-proposal', {
      npcName: 'TEST_ApplyPending',
      proposal: {
        addToSoul: 'x',
        dropFromSoul: null,
        summary: 's',
        confidence: 0.5,
      },
    });
    assert.equal(created.status, 200);

    const r = await post('/api/soul-proposal/apply', { id: created.body.id });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /approved/);
  });

  it('refuses to apply a rejected proposal', async () => {
    const created = await post('/api/soul-proposal', {
      npcName: 'TEST_ApplyRejected',
      proposal: { addToSoul: 'x', dropFromSoul: null, summary: 's', confidence: 0.5 },
    });
    assert.equal(created.status, 200);
    await post('/api/soul-proposal/approve', { id: created.body.id, decision: 'rejected' });

    const r = await post('/api/soul-proposal/apply', { id: created.body.id });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /approved/);
  });

  it('returns 404 when the target SOUL.md does not exist', async () => {
    const id = await createAndApproveProposal('TEST_NoSoulFile');
    const r = await post('/api/soul-proposal/apply', { id });
    assert.equal(r.status, 404);
    assert.match(r.body.error, /SOUL\.md not found/);
  });
});

describe('POST /api/soul-proposal/apply — happy path', () => {
  // Each happy-path test uses a fresh real NPC so we don't trip the
  // 1/NPC/UTC-day cap (we can't reset the cap from outside without
  // racing other tests that also touch the shared proposals file).
  it('mutates the target SOUL.md and creates SOUL.history.md', async () => {
    const id = await createAndApproveProposal(TEST_NPC_DISPLAY, {
      addToSoul: 'I find apply-test joy.',
      dropFromSoul: null,
      summary: 'apply test',
      confidence: 0.9,
    });

    const r = await post('/api/soul-proposal/apply', { id });
    assert.equal(r.status, 200, `apply failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.proposal.status, 'applied');
    assert.ok(r.body.proposal.applied);
    assert.ok(r.body.proposal.applied.at);
    assert.match(r.body.proposal.applied.soulPath, /SOUL\.md$/);

    const newSoul = fs.readFileSync(SOUL_PATH, 'utf8');
    assert.match(newSoul, /I find apply-test joy\./);
    assert.match(newSoul, new RegExp(`<!-- applied \\d{4}-\\d{2}-\\d{2} from proposal:${id} -->`));

    assert.ok(fs.existsSync(HISTORY_PATH), 'SOUL.history.md should exist after apply');
    const history = fs.readFileSync(HISTORY_PATH, 'utf8');
    assert.match(history, new RegExp(`proposal:${id}`));
    assert.match(history, new RegExp(`- by: ${TEST_NPC_DISPLAY}`));
  });

  it('re-applying the same id is idempotent (returns alreadyApplied)', async () => {
    const id = await createAndApproveProposal(IDEMPOTENT_NPC_DISPLAY, {
      addToSoul: 'I will not be duplicated.',
      dropFromSoul: null,
      summary: 'idempotency',
      confidence: 0.6,
    });
    const first = await post('/api/soul-proposal/apply', { id });
    assert.equal(first.status, 200, `apply failed: ${JSON.stringify(first.body)}`);
    assert.equal(first.body.proposal.status, 'applied');

    const soulAfterFirst = fs.readFileSync(IDEMPOTENT_SOUL_PATH, 'utf8');

    const second = await post('/api/soul-proposal/apply', { id });
    assert.equal(second.status, 200);
    assert.equal(second.body.alreadyApplied, true);

    const soulAfterSecond = fs.readFileSync(IDEMPOTENT_SOUL_PATH, 'utf8');
    // SOUL.md should NOT have been mutated twice.
    assert.equal(soulAfterFirst, soulAfterSecond, 're-apply must not append twice');
  });

  it('records a warning when dropFromSoul text is not present in SOUL.md', async () => {
    const id = await createAndApproveProposal(WARN_NPC_DISPLAY, {
      addToSoul: 'still added.',
      dropFromSoul: 'this exact phrase does not appear in the soul',
      summary: 'warn path',
      confidence: 0.5,
    });

    const r = await post('/api/soul-proposal/apply', { id });
    assert.equal(r.status, 200, `apply failed: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.proposal.applied.warnings));
    assert.equal(r.body.proposal.applied.warnings.length, 1);
    assert.match(r.body.proposal.applied.warnings[0], /dropFromSoul/);

    // Add still happens.
    const newSoul = fs.readFileSync(WARN_SOUL_PATH, 'utf8');
    assert.match(newSoul, /still added\./);
  });
});
