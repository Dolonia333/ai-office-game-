'use strict';
/**
 * Tests for the WorldState singleton and its subscriber pattern.
 * Uses a fresh class instance per suite via `new WorldState()` so the
 * singleton state from other tests/modules can't leak in.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { WorldState } = require('../src/world-state.js');

describe('WorldState — presence', () => {
  it('defaults to false and toggles on setPresence', () => {
    const ws = new WorldState();
    assert.equal(ws.zionPresent, false);
    assert.equal(ws.setPresence(true), true);
    assert.equal(ws.zionPresent, true);
    assert.equal(ws.setPresence(false), false);
  });

  it('emits a presence event when value flips', () => {
    const ws = new WorldState();
    let seen = null;
    ws.on('presence', (p) => { seen = p; });
    ws.setPresence(true);
    assert.deepEqual(seen, { zionPresent: true });
  });

  it('does not emit when setPresence is called with same value', () => {
    const ws = new WorldState();
    ws.setPresence(true);
    let count = 0;
    ws.on('presence', () => count++);
    ws.setPresence(true);
    assert.equal(count, 0);
  });
});

describe('WorldState — npc state', () => {
  it('updateNpc merges patch and stamps updatedAt', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex', { state: 'working', position: { x: 100, y: 200 } });
    const a = ws.getNpc('Alex');
    assert.equal(a.state, 'working');
    assert.deepEqual(a.position, { x: 100, y: 200 });
    assert.ok(a.updatedAt);

    ws.updateNpc('Alex', { lastAction: 'reviewed PR' });
    const b = ws.getNpc('Alex');
    assert.equal(b.state, 'working');                 // preserved
    assert.equal(b.lastAction, 'reviewed PR');        // added
    assert.deepEqual(b.position, { x: 100, y: 200 }); // preserved
  });

  it('npcsNear returns NPCs sorted by distance', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex',  { position: { x: 0, y: 0 } });
    ws.updateNpc('Josh',  { position: { x: 50, y: 0 } });
    ws.updateNpc('Edward',{ position: { x: 200, y: 0 } });
    ws.updateNpc('Bob',   { position: { x: 25, y: 0 } });
    const near = ws.npcsNear(0, 0, 100);
    assert.deepEqual(near, ['Alex', 'Bob', 'Josh']); // Edward beyond radius
  });

  it('getNpc returns null for unknown NPC', () => {
    const ws = new WorldState();
    assert.equal(ws.getNpc('Ghost'), null);
  });
});

describe('WorldState — threats', () => {
  it('pushThreat adds to head and caps the list', () => {
    const ws = new WorldState();
    for (let i = 0; i < 12; i++) ws.pushThreat({ category: 'scan_probe', source: '1.1.1.' + i });
    assert.equal(ws.activeThreats.length, 8); // default cap
    assert.equal(ws.activeThreats[0].source, '1.1.1.11'); // newest first
  });

  it('clearThreat removes matching entry', () => {
    const ws = new WorldState();
    ws.pushThreat({ category: 'brute_force', source: '1.2.3.4', detail: 'x' });
    ws.pushThreat({ category: 'scan_probe', source: '5.6.7.8', detail: 'y' });
    ws.clearThreat('scan_probe', '5.6.7.8');
    assert.equal(ws.activeThreats.length, 1);
    assert.equal(ws.activeThreats[0].category, 'brute_force');
  });
});

describe('WorldState — tasks', () => {
  it('upsertTask adds new and merges existing', () => {
    const ws = new WorldState();
    ws.upsertTask({ id: 't1', title: 'Build login', source: 'n8n' });
    ws.upsertTask({ id: 't1', status: 'running', assignee: 'Edward' });
    assert.equal(ws.backgroundTasks.length, 1);
    assert.equal(ws.backgroundTasks[0].title, 'Build login');
    assert.equal(ws.backgroundTasks[0].status, 'running');
    assert.equal(ws.backgroundTasks[0].assignee, 'Edward');
  });

  it('foreground=true puts task in foregroundTasks', () => {
    const ws = new WorldState();
    ws.upsertTask({ id: 'f1', title: 'visible' }, { foreground: true });
    assert.equal(ws.foregroundTasks.length, 1);
    assert.equal(ws.backgroundTasks.length, 0);
  });

  it('removeTask drops by id from either list', () => {
    const ws = new WorldState();
    ws.upsertTask({ id: 'a', title: 'A' });
    ws.upsertTask({ id: 'b', title: 'B' }, { foreground: true });
    ws.removeTask('a');
    ws.removeTask('b');
    assert.equal(ws.backgroundTasks.length, 0);
    assert.equal(ws.foregroundTasks.length, 0);
  });
});

describe('WorldState — renderContextBlock', () => {
  it('mentions self state, neighbors, threats, meeting', () => {
    const ws = new WorldState();
    ws.updateNpc('Alex',  { state: 'working', room: 'open_office', position: { x: 0, y: 0 }, lastAction: 'reviewed PR', currentTask: 'fixing bug' });
    ws.updateNpc('Josh',  { state: 'walking', position: { x: 50, y: 0 }, currentTask: 'fixing CSS' });
    ws.pushThreat({ category: 'scan_probe', severity: 'high', source: '1.1.1.1', detail: 'nmap' });
    ws.setMeeting({ active: true, attendees: ['Abby', 'Marcus'] });
    const block = ws.renderContextBlock('Alex');
    assert.match(block, /You are: working in open_office/);
    assert.match(block, /reviewed PR/);
    assert.match(block, /Nearby: Josh/);
    assert.match(block, /Active threats: 1/);
    assert.match(block, /Meeting in progress: Abby, Marcus/);
  });

  it('returns empty string when nothing is known', () => {
    const ws = new WorldState();
    assert.equal(ws.renderContextBlock('Nobody'), '');
  });
});

describe('WorldState — change events', () => {
  it('change fires for any mutation with the snapshot', () => {
    const ws = new WorldState();
    let last = null;
    ws.on('change', (e) => { last = e; });
    ws.updateNpc('Alex', { state: 'idle' });
    assert.equal(last.kind, 'npc');
    assert.ok(last.snapshot.npcs.Alex);
    ws.pushEvent('shipped', 'finished feature');
    assert.equal(last.kind, 'event');
    assert.equal(last.snapshot.recentEvents[0].text, 'finished feature');
  });
});
