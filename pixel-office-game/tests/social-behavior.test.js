'use strict';
/**
 * Tests for the social layer added on top of awareness:
 *   - lastAddressed conversation focus surfaces in renderContextBlock
 *   - lastAddressed expires after 30 seconds
 *   - playerPosition + idleMs surfaces with the right "may need help" tag
 *   - playerPosition alone (no idle threshold) still surfaces presence
 *
 * Pure logic — no browser, no server, no LM.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { WorldState } = require('../src/world-state.js');

describe('conversation focus (lastAddressed)', () => {
  it('surfaces the speaker, the message, and the acknowledge cue', () => {
    const ws = new WorldState();
    ws.updateNpc('Bob', {
      position: { x: 100, y: 100 },
      room: 'open_office',
      lastAddressed: { by: 'Alex', text: 'Hey Bob, got a minute?', at: Date.now() },
    });
    const block = ws.renderContextBlock('Bob');
    assert.match(block, /Alex just spoke to you/);
    assert.match(block, /Hey Bob, got a minute/);
    assert.match(block, /Acknowledge them before doing anything else/);
  });

  it('does NOT surface stale lastAddressed (>30s old)', () => {
    const ws = new WorldState();
    ws.updateNpc('Bob', {
      position: { x: 100, y: 100 },
      room: 'open_office',
      lastAddressed: { by: 'Alex', text: 'Old message', at: Date.now() - 45000 },
    });
    const block = ws.renderContextBlock('Bob');
    assert.doesNotMatch(block, /just spoke to you/);
    assert.doesNotMatch(block, /Old message/);
  });

  it('truncates very long addressed text to keep the prompt cheap', () => {
    const ws = new WorldState();
    const longText = 'x'.repeat(500);
    ws.updateNpc('Bob', {
      lastAddressed: { by: 'Alex', text: longText, at: Date.now() },
    });
    const block = ws.renderContextBlock('Bob');
    // Should not include the full 500 chars; the renderer caps at 120.
    const match = block.match(/"(x+)"/);
    assert.ok(match);
    assert.ok(match[1].length <= 120);
  });
});

describe('player presence awareness', () => {
  it('surfaces player position when set, regardless of voice presence', () => {
    const ws = new WorldState();
    ws.updateNpc('Lucy', { position: { x: 400, y: 400 }, room: 'reception' });
    ws.environment.playerPosition = { x: 500, y: 410, room: 'reception' };
    ws.environment.playerIdleMs = 5000;
    const block = ws.renderContextBlock('Lucy');
    assert.match(block, /Player presence:/);
    assert.match(block, /reception/);
    // Idle 5s < 30s threshold → no "may need help" tag.
    assert.doesNotMatch(block, /may need help/);
  });

  it('adds "may need help" once player has been idle longer than 30s', () => {
    const ws = new WorldState();
    ws.updateNpc('Lucy', { position: { x: 400, y: 400 }, room: 'reception' });
    ws.environment.playerPosition = { x: 500, y: 410, room: 'open_office' };
    ws.environment.playerIdleMs = 60000;
    const block = ws.renderContextBlock('Lucy');
    assert.match(block, /Player presence:.*idle 60s — may need help/);
  });

  it('omits player presence entirely when playerPosition is null', () => {
    const ws = new WorldState();
    ws.updateNpc('Lucy', { position: { x: 400, y: 400 } });
    const block = ws.renderContextBlock('Lucy');
    assert.doesNotMatch(block, /Player presence/);
  });
});
