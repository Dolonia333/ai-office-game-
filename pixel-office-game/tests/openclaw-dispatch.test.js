'use strict';
/**
 * Tests for the OpenClaw dispatch classifier.
 *
 * Pure: text in, classification out. The browser-side dispatcher (which
 * actually POSTs / opens WebSockets) is not tested here — it's a thin
 * runner over this classifier and is tested manually in the browser.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classify } = require('../src/openclaw-dispatch.js');

describe('classify — empty / trivial', () => {
  it('empty → chat with confidence 0', () => {
    const c = classify('');
    assert.equal(c.kind, 'chat');
    assert.equal(c.confidence, 0);
  });
  it('whitespace only → chat', () => {
    assert.equal(classify('   ').kind, 'chat');
  });
  it('null / undefined → chat without throwing', () => {
    assert.equal(classify(null).kind, 'chat');
    assert.equal(classify(undefined).kind, 'chat');
  });
});

describe('classify — explicit prefixes', () => {
  it('/do prefix forces action', () => {
    const c = classify('/do refresh the cache');
    assert.equal(c.kind, 'action');
    assert.equal(c.confidence, 1);
    assert.equal(c.stripped, 'refresh the cache');
  });
  it('/run prefix forces action', () => {
    assert.equal(classify('/run github_create_pr').kind, 'action');
  });
  it('/say prefix forces chat', () => {
    const c = classify('/say deploy is the most fun');
    assert.equal(c.kind, 'chat');
    assert.equal(c.stripped, 'deploy is the most fun');
  });
});

describe('classify — chat markers', () => {
  it('greeting → chat', () => {
    assert.equal(classify('hello Abby').kind, 'chat');
    assert.equal(classify('hi everyone').kind, 'chat');
  });
  it('thanks → chat', () => {
    assert.equal(classify('thanks for the help').kind, 'chat');
    assert.equal(classify('thank you so much').kind, 'chat');
  });
  it('"how are you" → chat even when an action verb appears', () => {
    assert.equal(classify("how are you, ready to deploy?").kind, 'chat');
  });
});

describe('classify — imperative verbs', () => {
  it('"deploy v2 to staging" → action', () => {
    const c = classify('deploy v2 to staging');
    assert.equal(c.kind, 'action');
    assert.match(c.reason, /imperative/);
  });
  it('"build the project" → action', () => {
    assert.equal(classify('build the project').kind, 'action');
  });
  it('"run the tests" → action', () => {
    assert.equal(classify('run the tests').kind, 'action');
  });
  it('"check the logs" → action', () => {
    assert.equal(classify('check the logs').kind, 'action');
  });
});

describe('classify — polite imperatives', () => {
  it('"please deploy v2" → action', () => {
    const c = classify('please deploy v2');
    assert.equal(c.kind, 'action');
    assert.match(c.reason, /polite/);
  });
  it('"can you run the tests" → action (despite question form)', () => {
    const c = classify('can you run the tests?');
    assert.equal(c.kind, 'action');
  });
  it('"could you fix the auth bug" → action', () => {
    assert.equal(classify('could you fix the auth bug').kind, 'action');
  });
});

describe('classify — tool keyword presence', () => {
  it('two tool keywords → action even without imperative verb', () => {
    const c = classify('the github pull request needs another reviewer');
    assert.equal(c.kind, 'action');
    assert.match(c.reason, /tool keywords/);
  });
  it('one tool keyword + statement → action', () => {
    assert.equal(classify('this needs a database migration').kind, 'action');
  });
  it('one tool keyword + question → chat', () => {
    assert.equal(classify('does this need a database migration?').kind, 'chat');
  });
});

describe('classify — questions', () => {
  it('plain question → chat', () => {
    assert.equal(classify('what should we do next?').kind, 'chat');
  });
  it('"what is X" question → chat', () => {
    assert.equal(classify('what is the deploy schedule?').kind, 'chat');
  });
});

describe('classify — urgency', () => {
  it('"deploy now" sets urgent', () => {
    const c = classify('deploy v2 to staging right now');
    assert.equal(c.kind, 'action');
    assert.equal(c.urgent, true);
  });
  it('"deploy v2 asap" sets urgent', () => {
    assert.equal(classify('deploy v2 asap').urgent, true);
  });
  it('non-urgent action does not set urgent', () => {
    assert.equal(classify('deploy v2 to staging').urgent, false);
  });
});

describe('classify — stripped output', () => {
  it('stripped equals input when no prefix', () => {
    const c = classify('deploy v2');
    assert.equal(c.stripped, 'deploy v2');
  });
  it('stripped removes /do prefix and trims', () => {
    const c = classify('/do   deploy v2');
    assert.equal(c.stripped, 'deploy v2');
  });
});

describe('classify — confidence shape', () => {
  it('returns a number between 0 and 1', () => {
    for (const s of ['hi', 'deploy v2', 'thanks', '/run x', 'whatever']) {
      const c = classify(s);
      assert.ok(typeof c.confidence === 'number');
      assert.ok(c.confidence >= 0 && c.confidence <= 1, `${s} → ${c.confidence}`);
    }
  });
});
