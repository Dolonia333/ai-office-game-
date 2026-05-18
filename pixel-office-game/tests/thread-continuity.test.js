'use strict';
/**
 * Tests for the conversation thread continuity signal.
 *
 *   topicCount(from, to, text, { windowMs })
 *
 * Counts how many times this NPC has raised the same topic with the
 * same peer inside the window. "Same topic" = first 3 content words
 * after lowercasing, stripping punctuation, and dropping stop words.
 *
 * renderContextBlock surfaces a "Thread with X" line when count >= 3.
 *
 * Pure logic — no server, no browser, no LLM.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { WorldState, _topicFingerprint } = require('../src/world-state.js');

describe('_topicFingerprint', () => {
  it('drops stop words and keeps first 3 content tokens', () => {
    assert.equal(_topicFingerprint('the mockups are ready'), 'mockups ready');
    assert.equal(_topicFingerprint('Are the mockups ready yet'), 'mockups ready yet');
  });

  it('lowercases and strips punctuation', () => {
    assert.equal(_topicFingerprint('Mockups, ready??'), 'mockups ready');
  });

  it('returns empty string for stop-words-only input', () => {
    assert.equal(_topicFingerprint('is it a the'), '');
  });

  it('returns empty string for null/undefined/empty', () => {
    assert.equal(_topicFingerprint(null), '');
    assert.equal(_topicFingerprint(undefined), '');
    assert.equal(_topicFingerprint(''), '');
  });
});

describe('topicCount', () => {
  it('returns 0 with no exchanges', () => {
    const ws = new WorldState();
    assert.equal(ws.topicCount('Alex', 'Josh', 'mockups ready'), 0);
  });

  it('counts repeated same-topic messages from from→to', () => {
    const ws = new WorldState();
    ws.recordExchange('Alex', 'Josh', 'are the mockups ready?');
    ws.recordExchange('Josh', 'Alex', 'not yet');
    ws.recordExchange('Alex', 'Josh', 'mockups ready yet?');
    ws.recordExchange('Josh', 'Alex', 'tomorrow');
    ws.recordExchange('Alex', 'Josh', 'the mockups ready?');
    assert.equal(ws.topicCount('Alex', 'Josh', 'mockups ready'), 3);
  });

  it('different topics do NOT accumulate', () => {
    const ws = new WorldState();
    ws.recordExchange('Alex', 'Josh', 'mockups ready?');
    ws.recordExchange('Alex', 'Josh', 'lunch plans?');
    ws.recordExchange('Alex', 'Josh', 'standup at 3?');
    assert.equal(ws.topicCount('Alex', 'Josh', 'mockups ready'), 1);
    assert.equal(ws.topicCount('Alex', 'Josh', 'lunch plans'), 1);
  });

  it('stop words do not contribute — "the mockups" matches "mockups please"', () => {
    const ws = new WorldState();
    ws.recordExchange('Alex', 'Josh', 'the mockups');
    ws.recordExchange('Alex', 'Josh', 'mockups please');
    assert.equal(ws.topicCount('Alex', 'Josh', 'mockups'), 2);
  });

  it('direction matters — peer replies do not count toward my thread', () => {
    const ws = new WorldState();
    ws.recordExchange('Alex', 'Josh', 'mockups ready?');
    ws.recordExchange('Josh', 'Alex', 'mockups soon');
    ws.recordExchange('Josh', 'Alex', 'mockups by friday');
    // Alex has raised "mockups" once; Josh's outbound messages don't count for Alex.
    assert.equal(ws.topicCount('Alex', 'Josh', 'mockups'), 1);
    // Josh has raised it twice.
    assert.equal(ws.topicCount('Josh', 'Alex', 'mockups'), 2);
  });

  it('respects the window — old messages drop out', () => {
    const ws = new WorldState();
    // Force three old entries directly into the ring with stale ts.
    ws.recentExchanges.set('Alex|Josh', [
      { from: 'Alex', text: 'mockups ready?', ts: Date.now() - 26 * 60 * 60 * 1000 },
      { from: 'Alex', text: 'mockups ready?', ts: Date.now() - 25 * 60 * 60 * 1000 },
      { from: 'Alex', text: 'mockups ready?', ts: Date.now() - 1000 },
    ]);
    assert.equal(ws.topicCount('Alex', 'Josh', 'mockups ready'), 1);
  });

  it('returns 0 for self / missing args', () => {
    const ws = new WorldState();
    ws.recordExchange('Alex', 'Josh', 'mockups ready');
    assert.equal(ws.topicCount('Alex', 'Alex', 'mockups'), 0);
    assert.equal(ws.topicCount('', 'Josh', 'mockups'), 0);
    assert.equal(ws.topicCount('Alex', 'Josh', ''), 0);
  });
});

describe('renderContextBlock — thread continuity surface', () => {
  it('surfaces the "Thread with X" line when count >= 3', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', { position: { x: 500, y: 100 }, room: 'open_office' });
    ws.recordExchange('Alex', 'Josh', 'are the mockups ready?');
    ws.recordExchange('Alex', 'Josh', 'mockups ready yet?');
    ws.recordExchange('Alex', 'Josh', 'the mockups ready?');
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /Thread with Josh/);
    assert.match(block, /mockups ready/);
    assert.match(block, /3x today/);
    assert.match(block, /escalate, drop it, or shift topic/);
  });

  it('does NOT surface a thread line under the 3-count threshold', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', { position: { x: 500, y: 100 }, room: 'open_office' });
    ws.recordExchange('Alex', 'Josh', 'mockups ready?');
    ws.recordExchange('Alex', 'Josh', 'mockups ready?');
    const block = ws.renderContextBlock('Alex');
    assert.doesNotMatch(block, /Thread with/);
  });

  it('caps at one thread per think — picks the highest count', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', { position: { x: 500, y: 100 }, room: 'open_office' });
    ws.updateNpc('Bob',  { position: { x: 600, y: 100 }, room: 'open_office' });
    // Alex has raised "mockups" 3x with Josh ...
    ws.recordExchange('Alex', 'Josh', 'mockups ready?');
    ws.recordExchange('Alex', 'Josh', 'mockups ready?');
    ws.recordExchange('Alex', 'Josh', 'mockups ready?');
    // ... and "deploy" 4x with Bob.
    ws.recordExchange('Alex', 'Bob', 'deploy ready?');
    ws.recordExchange('Alex', 'Bob', 'deploy ready?');
    ws.recordExchange('Alex', 'Bob', 'deploy ready?');
    ws.recordExchange('Alex', 'Bob', 'deploy ready?');
    const block = ws.renderContextBlock('Alex');
    const threadLines = block.split('\n').filter(l => /Thread with/.test(l));
    assert.equal(threadLines.length, 1);
    assert.match(threadLines[0], /Thread with Bob/);
    assert.match(threadLines[0], /4x today/);
  });
});
