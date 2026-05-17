'use strict';
/**
 * Tests for the new awareness layer in world-state.js.
 *
 * Covers the pure pieces — room graph, occupancy, per-pair contact,
 * self-repetition detection, desk neighbor lookup, convoy detection
 * inside renderContextBlock. The intent is that adding more awareness
 * later (group movement, line-of-sight, etc.) extends this file
 * without needing the live game running.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { WorldState } = require('../src/world-state.js');

function fixture() {
  const ws = new WorldState();
  // Place 4 NPCs across two rooms with assignedDesks pointing at
  // furniture entries we'll register below.
  ws.updateNpc('Alex',  { position: { x: 100, y: 100 }, velocity: { x: 50, y: 0 }, state: 'walking', room: 'open_office', assignedDesk: 'desk1' });
  ws.updateNpc('Josh',  { position: { x: 130, y: 110 }, velocity: { x: 50, y: 0 }, state: 'walking', room: 'open_office', assignedDesk: 'desk2', busy: false });
  ws.updateNpc('Bob',   { position: { x: 600, y: 200 }, velocity: { x: 0, y: 0 },  state: 'idle',    room: 'open_office', assignedDesk: 'desk3' });
  ws.updateNpc('Abby',  { position: { x: 900, y: 400 }, velocity: { x: 0, y: 0 },  state: 'meeting', room: 'manager_office', busy: true });
  ws.setFurnitureSnapshot([
    { id: 'desk1', instanceId: 'desk1', type: 'desk', position: { x: 100, y: 100 } },
    { id: 'desk2', instanceId: 'desk2', type: 'desk', position: { x: 130, y: 100 } },
    { id: 'desk3', instanceId: 'desk3', type: 'desk', position: { x: 600, y: 200 } },
  ]);
  return ws;
}

describe('roomGraph + occupancy', () => {
  it('exposes the room adjacency graph', () => {
    const ws = new WorldState();
    assert.ok(Array.isArray(ws.roomGraph.open_office));
    assert.ok(ws.roomGraph.open_office.includes('conference'));
    assert.ok(ws.roomGraph.breakroom.includes('open_office'));
  });

  it('roomOccupancy counts NPCs per room', () => {
    const ws = fixture();
    const occ = ws.roomOccupancy();
    assert.equal(occ.open_office, 3);
    assert.equal(occ.manager_office, 1);
  });
});

describe('desk geography', () => {
  it('returns the two nearest desk neighbors', () => {
    const ws = fixture();
    const ctx = ws.getDeskContext('Alex');
    assert.ok(ctx);
    assert.equal(ctx.neighbors[0], 'Josh'); // 30px away
    assert.equal(ctx.neighbors[1], 'Bob');  // 500px away
  });

  it('returns null when the NPC has no assigned desk', () => {
    const ws = fixture();
    assert.equal(ws.getDeskContext('Abby'), null);
  });

  it('returns null when no furniture is registered', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { assignedDesk: 'desk1' });
    assert.equal(ws.getDeskContext('Alex'), null);
  });
});

describe('per-pair contact tracking', () => {
  it('records and reads back minutes since last contact', () => {
    const ws = new WorldState();
    ws.recordContact('Alex', 'Josh');
    // Should be 0 minutes (just happened); we just assert non-null/sane.
    const mins = ws.minutesSinceContact('Alex', 'Josh');
    assert.ok(mins != null && mins >= 0 && mins < 1);
  });

  it('contact is symmetric (order does not matter)', () => {
    const ws = new WorldState();
    ws.recordContact('Alex', 'Josh');
    assert.equal(ws.minutesSinceContact('Josh', 'Alex'), 0);
  });

  it('returns null for never-recorded pairs', () => {
    const ws = new WorldState();
    assert.equal(ws.minutesSinceContact('Alex', 'Josh'), null);
  });

  it('caps the map size to avoid unbounded growth', () => {
    const ws = new WorldState();
    ws._caps.lastContact = 10; // shrink for the test
    for (let i = 0; i < 30; i++) ws.recordContact('A' + i, 'B' + i);
    assert.ok(ws.lastContact.size <= 10);
  });
});

describe('self-repetition detection', () => {
  it('flags near-duplicates inside the window', () => {
    const ws = new WorldState();
    ws.recordSelfMessage('Alex', 'Hey Bob, any updates on the bias research?');
    const dup = ws.recentSimilarMessage('Alex', 'Hey Bob any updates on the bias research');
    assert.ok(dup);
    assert.match(dup.text, /bias research/);
  });

  it('does NOT flag unrelated messages', () => {
    const ws = new WorldState();
    ws.recordSelfMessage('Alex', 'Hey Bob, any updates on the bias research?');
    assert.equal(ws.recentSimilarMessage('Alex', 'Going to grab coffee'), null);
  });

  it('ring is bounded per NPC', () => {
    const ws = new WorldState();
    ws._caps.selfMessagesPerNpc = 3;
    for (let i = 0; i < 10; i++) ws.recordSelfMessage('Alex', 'msg ' + i);
    assert.equal(ws.recentSelfMessages.get('Alex').length, 3);
  });
});

describe('renderContextBlock — new awareness signals', () => {
  it('mentions adjacent rooms for the NPCs current room', () => {
    const ws = fixture();
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /Adjacent rooms: .*conference/);
  });

  it('lists desk neighbors', () => {
    const ws = fixture();
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /desk neighbors: Josh/);
  });

  it('tags nearby NPCs walking in the same direction as "walking with you"', () => {
    const ws = fixture();
    const block = ws.renderContextBlock('Alex');
    // Alex and Josh both have velocity (50, 0) and are within 160px.
    assert.match(block, /Josh \(.*walking with you/);
  });

  it('tags nearby NPCs as busy', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { position: { x: 100, y: 100 }, room: 'open_office' });
    ws.updateNpc('Josh', { position: { x: 110, y: 100 }, state: 'meeting', busy: true });
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /Josh \(.*busy/);
  });

  it('renders occupancy across rooms', () => {
    const ws = fixture();
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /Office occupancy: .*open_office:3/);
  });

  it('returns empty string for an NPC the world knows nothing about', () => {
    const ws = new WorldState();
    assert.equal(ws.renderContextBlock('Ghost'), '');
  });
});
