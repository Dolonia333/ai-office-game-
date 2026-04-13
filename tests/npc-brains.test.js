'use strict';
/**
 * Tests for NpcBrainManager — covers demo mode detection, canned responses,
 * and smart fallback action-tag generation. All tests run without real API keys.
 * Uses Node.js built-in test runner (node:test) — no extra dependencies.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const NpcBrainManager = require('../src/npc-brains.js');

// ---------------------------------------------------------------------------
// Test fixture: shared manager instance (expensive to construct due to file I/O)
// ---------------------------------------------------------------------------

let mgr;

before(() => {
  // Constructor reads openclaw.json (absent in CI → demo mode) and SOUL.md files.
  // Both failures are handled silently, so this is safe to call unconditionally.
  mgr = new NpcBrainManager();
});

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

describe('demo mode', () => {
  it('_demoMode is true when no config file is present', () => {
    // In a clean test environment there is no ~/.openclaw/openclaw.json
    // The constructor falls through to demo provider only → _demoMode must be true
    assert.equal(mgr._demoMode, true);
  });

  it('demo provider is always registered', () => {
    assert.ok('demo' in mgr.providers);
    assert.equal(mgr.providers.demo.type, 'demo');
  });
});

// ---------------------------------------------------------------------------
// _cannedResponse — keyword-based role responses
// ---------------------------------------------------------------------------

describe('_cannedResponse', () => {
  it('developer NPC returns code-action response for bug message', () => {
    // Alex is a Senior Developer
    const reply = mgr._cannedResponse('Alex', 'Player', 'there is a bug in the login flow');
    assert.match(reply, /code|check|on it/i);
  });

  it('QA NPC returns test-related response for bug message', () => {
    // Molly is QA Engineer
    const reply = mgr._cannedResponse('Molly', 'Player', 'we found a bug');
    assert.match(reply, /test/i);
  });

  it('DevOps NPC returns log/pipeline response for deploy message', () => {
    // Oscar is DevOps Engineer
    const reply = mgr._cannedResponse('Oscar', 'Player', 'deploy the new version');
    assert.match(reply, /pipeline|running/i);
  });

  it('any NPC acknowledges a meeting request', () => {
    const reply = mgr._cannedResponse('Lucy', 'Player', 'can we have a standup meeting?');
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });

  it('designer NPC returns sketch/design response for UI message', () => {
    // Rob is UI/UX Designer
    const reply = mgr._cannedResponse('Rob', 'Player', 'we need a new mockup for the UI');
    assert.match(reply, /sketch|ideas|design/i);
  });

  it('returns a string for an unknown/generic message', () => {
    const reply = mgr._cannedResponse('Bob', 'Player', 'what are you working on?');
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });
});

// ---------------------------------------------------------------------------
// _parseDelegateTag
// ---------------------------------------------------------------------------

describe('_parseDelegateTag', () => {
  it('splits name and reason on first colon only', () => {
    const p = mgr._parseDelegateTag('OK [DELEGATE:Alex:see doc: section 2]');
    assert.equal(p.delegateTo, 'Alex');
    assert.equal(p.reason, 'see doc: section 2');
    assert.equal(p.fullMatch, '[DELEGATE:Alex:see doc: section 2]');
  });

  it('allows empty reason', () => {
    const p = mgr._parseDelegateTag('[DELEGATE:Molly:]');
    assert.equal(p.delegateTo, 'Molly');
    assert.equal(p.reason, '');
  });

  it('returns null when malformed', () => {
    assert.equal(mgr._parseDelegateTag('[DELEGATE:Molly]'), null);
    assert.equal(mgr._parseDelegateTag('no tag'), null);
  });
});

// ---------------------------------------------------------------------------
// _smartFallback — action tag generation
// ---------------------------------------------------------------------------

describe('_smartFallback', () => {
  function h(npcName) {
    return mgr._hierarchy[npcName];
  }

  it('developer NPC + code task → [ACTION:useComputer]', () => {
    const reply = mgr._smartFallback('Alex', 'fix the authentication bug', h('Alex'));
    assert.ok(reply.includes('[ACTION:useComputer]'), `Expected [ACTION:useComputer] in: ${reply}`);
  });

  it('meeting request for team → [ACTION:callMeeting:...]', () => {
    const reply = mgr._smartFallback('Abby', 'call a meeting with everyone', h('Abby'));
    assert.ok(reply.includes('[ACTION:callMeeting:'), `Expected [ACTION:callMeeting: in: ${reply}`);
  });

  it('meeting with named person → includes that person in action', () => {
    const reply = mgr._smartFallback('Abby', 'set up a meeting with Alex', h('Abby'));
    assert.ok(reply.includes('[ACTION:callMeeting:Alex]'), `Expected [ACTION:callMeeting:Alex] in: ${reply}`);
  });

  it('"talk to X" → [ACTION:speakTo:X:...]', () => {
    const reply = mgr._smartFallback('Abby', 'talk to Alex about the sprint', h('Abby'));
    assert.ok(reply.includes('[ACTION:speakTo:Alex:'), `Expected [ACTION:speakTo:Alex: in: ${reply}`);
  });

  it('reply is always a non-empty string', () => {
    const reply = mgr._smartFallback('Lucy', 'what is going on?', h('Lucy'));
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Hierarchy sanity
// ---------------------------------------------------------------------------

describe('_hierarchy', () => {
  it('all 16 expected NPCs are present', () => {
    const expected = [
      'Abby', 'Marcus', 'Sarah', 'Alex', 'Josh', 'Edward',
      'Roki', 'Jenny', 'Molly', 'Rob', 'Oscar', 'Pier',
      'Bob', 'Dan', 'Lucy', 'Bouncer',
    ];
    for (const name of expected) {
      assert.ok(name in mgr._hierarchy, `Missing NPC: ${name}`);
    }
  });

  it('each hierarchy entry has required fields', () => {
    for (const [name, entry] of Object.entries(mgr._hierarchy)) {
      assert.ok('title'     in entry, `${name} missing title`);
      assert.ok('manages'   in entry, `${name} missing manages`);
      assert.ok('reportsTo' in entry, `${name} missing reportsTo`);
      assert.ok(Array.isArray(entry.manages), `${name}.manages not an array`);
    }
  });
});
