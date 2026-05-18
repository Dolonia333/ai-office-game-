'use strict';
/**
 * Tests for the keyword-based sentiment classifier and the peer mood
 * tag it feeds into renderContextBlock via recordSelfMessage →
 * lastMood.
 *
 * Pure logic — no server, no browser, no LLM.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classify } = require('../src/sentiment.js');
const { WorldState } = require('../src/world-state.js');

describe('sentiment.classify', () => {
  it('detects frustration', () => {
    assert.equal(classify("I'm so frustrated with this"), 'frustrated');
  });

  it('detects happiness', () => {
    assert.equal(classify('Great work, I love it!'), 'happy');
  });

  it('detects excitement', () => {
    assert.equal(classify("LFG, can't wait to ship it"), 'excited');
  });

  it('detects tiredness', () => {
    assert.equal(classify('I am exhausted, long day, need coffee'), 'tired');
  });

  it('detects anxiety', () => {
    assert.equal(classify("I'm worried this is going to break"), 'anxious');
  });

  it('returns null for neutral text', () => {
    assert.equal(classify('hmm'), null);
    assert.equal(classify('the meeting is at 3pm'), null);
  });

  it('returns null for empty / non-string input', () => {
    assert.equal(classify(''), null);
    assert.equal(classify(null), null);
    assert.equal(classify(undefined), null);
    assert.equal(classify(42), null);
  });

  it('picks the higher-hit-count mood when multiple match', () => {
    // Three frustration words vs one happy word → frustrated wins.
    const text = 'frustrated and annoyed and stuck but thanks for trying';
    assert.equal(classify(text), 'frustrated');
  });

  it('breaks ties deterministically by PRIORITY order', () => {
    // 'frustrated' (1 hit) vs 'happy' (1 hit) → frustrated wins
    // because it comes first in PRIORITY.
    const text = 'I am frustrated but also glad we tried';
    assert.equal(classify(text), 'frustrated');
  });

  it('is case-insensitive', () => {
    assert.equal(classify('I AM FRUSTRATED'), 'frustrated');
    assert.equal(classify('Frustrated.'), 'frustrated');
  });

  it('matches whole-word keywords, not substrings', () => {
    // "scared" shouldn't fire on "scarecrow". The classifier uses word
    // boundaries for plain-alphanumeric keywords.
    assert.equal(classify('the scarecrow stood in the field'), null);
  });
});

describe('recordSelfMessage → lastMood + peer tag in renderContextBlock', () => {
  it('stamps lastMood on the speaking NPC when text is moody', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.recordSelfMessage('Alex', "I'm so frustrated with this build");
    assert.ok(ws.npcs.Alex.lastMood);
    assert.equal(ws.npcs.Alex.lastMood.value, 'frustrated');
    assert.ok(typeof ws.npcs.Alex.lastMood.ts === 'number');
  });

  it('does NOT stamp lastMood on neutral text', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.recordSelfMessage('Alex', 'meeting moved to 3pm');
    assert.equal(ws.npcs.Alex.lastMood, undefined);
  });

  it('keeps the previous mood when a later neutral message arrives', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 } });
    ws.recordSelfMessage('Alex', "I'm exhausted");
    assert.equal(ws.npcs.Alex.lastMood.value, 'tired');
    ws.recordSelfMessage('Alex', 'see you at 3');
    // Still tired — null classification does not overwrite.
    assert.equal(ws.npcs.Alex.lastMood.value, 'tired');
  });

  it('peer with fresh lastMood appears tagged in renderContextBlock', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', { position: { x: 110, y: 100 }, room: 'open_office', state: 'working' });
    ws.recordSelfMessage('Josh', 'this is so frustrating, nothing works');
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /Josh \(.*frustrated/);
  });

  it('peer with stale lastMood (>10 min) does NOT appear tagged', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', {
      position: { x: 110, y: 100 },
      room: 'open_office',
      state: 'working',
      lastMood: { value: 'frustrated', ts: Date.now() - 11 * 60 * 1000 },
    });
    const block = ws.renderContextBlock('Alex');
    // Josh still shows up nearby, but without the frustrated tag.
    assert.match(block, /Josh \(/);
    assert.doesNotMatch(block, /frustrated/);
  });

  it('does NOT surface self mood in the prompt (peer-only signal)', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.recordSelfMessage('Alex', "I'm so frustrated");
    const block = ws.renderContextBlock('Alex');
    // The self block shouldn't echo the NPC's own mood back at them.
    // (They know what they've been saying.)
    assert.doesNotMatch(block, /frustrated/);
  });
});
