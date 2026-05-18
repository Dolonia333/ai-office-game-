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

describe('fatigue tracking (time-at-desk + last-break)', () => {
  it('recordDeskStart is idempotent — does not reset on repeat calls', () => {
    const ws = new WorldState();
    ws.recordDeskStart('Alex');
    const t1 = ws.npcs.Alex.deskSittingSince;
    // Wait a tick, call again — should NOT reset the timer.
    ws.npcs.Alex.deskSittingSince = t1 - 1000;
    ws.recordDeskStart('Alex');
    assert.equal(ws.npcs.Alex.deskSittingSince, t1 - 1000);
  });

  it('recordBreak clears the desk timer and stamps lastBreakAt', () => {
    const ws = new WorldState();
    ws.recordDeskStart('Alex');
    assert.ok(ws.npcs.Alex.deskSittingSince);
    ws.recordBreak('Alex');
    assert.equal(ws.npcs.Alex.deskSittingSince, null);
    assert.ok(ws.npcs.Alex.lastBreakAt);
  });

  it('minutesAtDesk + minutesSinceBreak return null when unset', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', {});
    assert.equal(ws.minutesAtDesk('Alex'), null);
    assert.equal(ws.minutesSinceBreak('Alex'), null);
  });

  it('surfaces self-fatigue prompt line once at desk >= 45 min', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    // Pretend Alex sat down 50 minutes ago.
    ws.npcs.Alex.deskSittingSince = Date.now() - 50 * 60 * 1000;
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /You've been at your desk for 50 minutes/);
  });

  it('does NOT surface fatigue line under the 45-min threshold', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.npcs.Alex.deskSittingSince = Date.now() - 10 * 60 * 1000;
    const block = ws.renderContextBlock('Alex');
    assert.doesNotMatch(block, /at your desk for/);
  });

  it('tags visible peers as "tired" when they have been at-desk >= 60 min', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', { position: { x: 110, y: 100 }, room: 'open_office' });
    ws.npcs.Josh.deskSittingSince = Date.now() - 75 * 60 * 1000;
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /Josh \(.*tired \(75m at desk\)/);
  });
});

describe('cross-NPC stuck-loop detection', () => {
  it('returns null below minRepeats', () => {
    const ws = new WorldState();
    ws.recordExchange('Alex', 'Josh', 'any updates?');
    ws.recordExchange('Josh', 'Alex', 'not yet');
    assert.equal(ws.stuckLoop('Alex', 'Josh'), null);
  });

  it('flags a 3-message repeat regardless of direction', () => {
    const ws = new WorldState();
    ws.recordExchange('Alex', 'Josh', 'any updates on the bug?');
    ws.recordExchange('Josh', 'Alex', 'not yet, still looking');
    ws.recordExchange('Alex', 'Josh', 'any updates on the bug?');
    ws.recordExchange('Josh', 'Alex', 'not yet, still looking');
    ws.recordExchange('Alex', 'Josh', 'any updates on the bug?');
    const loop = ws.stuckLoop('Alex', 'Josh');
    assert.ok(loop);
    assert.equal(loop.count, 3);
    assert.match(loop.sample, /any updates/);
  });

  it('symmetric on the pair-key (order does not matter)', () => {
    const ws = new WorldState();
    for (let i = 0; i < 4; i++) ws.recordExchange('Alex', 'Josh', 'ping');
    const a = ws.stuckLoop('Alex', 'Josh');
    const b = ws.stuckLoop('Josh', 'Alex');
    assert.ok(a && b);
    assert.equal(a.count, b.count);
  });

  it('renderContextBlock surfaces the stuck-loop line', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', { position: { x: 110, y: 100 }, room: 'open_office' });
    for (let i = 0; i < 3; i++) ws.recordExchange('Alex', 'Josh', 'mockups ready yet?');
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /Stuck loop with Josh/);
    assert.match(block, /mockups ready yet/);
    assert.match(block, /escalate, change topic, or stop checking in/);
  });

  it('caps exchange rings per pair', () => {
    const ws = new WorldState();
    ws._caps.exchangesPerPair = 3;
    for (let i = 0; i < 10; i++) ws.recordExchange('Alex', 'Josh', 'msg ' + i);
    assert.equal(ws.recentExchanges.get('Alex|Josh').length, 3);
  });
});
