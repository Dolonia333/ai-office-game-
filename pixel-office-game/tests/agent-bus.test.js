'use strict';
/**
 * Tests for AgentBus — pub/sub correctness, buffering for offline
 * recipients, and wildcard mirroring.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { AgentBus } = require('../src/agent-bus.js');

describe('AgentBus — basic addressing', () => {
  it('publish-then-subscribe drains the buffer in order', () => {
    const bus = new AgentBus();
    bus.publish('Alex', { from: 'Abby', text: 'first' });
    bus.publish('Alex', { from: 'Abby', text: 'second' });
    const got = [];
    bus.subscribe('Alex', (m) => got.push(m.text));
    assert.deepEqual(got, ['first', 'second']);
  });

  it('subscribe-first then publish delivers immediately', () => {
    const bus = new AgentBus();
    const got = [];
    bus.subscribe('Alex', (m) => got.push(m.text));
    bus.publish('Alex', { text: 'hi' });
    assert.deepEqual(got, ['hi']);
  });

  it('messages addressed to one recipient do not fan out to others', () => {
    const bus = new AgentBus();
    const alex = [];
    const josh = [];
    bus.subscribe('Alex', (m) => alex.push(m.text));
    bus.subscribe('Josh', (m) => josh.push(m.text));
    bus.publish('Alex', { text: 'for-alex' });
    assert.deepEqual(alex, ['for-alex']);
    assert.deepEqual(josh, []);
  });

  it('wildcard subscribers see every published message', () => {
    const bus = new AgentBus();
    const seen = [];
    bus.subscribe('*', (m) => seen.push(`${m.to}:${m.text}`));
    bus.publish('Alex', { text: 'a' });
    bus.publish('Josh', { text: 'b' });
    assert.deepEqual(seen, ['Alex:a', 'Josh:b']);
  });
});

describe('AgentBus — validation + safety', () => {
  it('publish returns null for missing recipient or text', () => {
    const bus = new AgentBus();
    assert.equal(bus.publish('', { text: 'x' }), null);
    assert.equal(bus.publish('Alex', {}), null);
    assert.equal(bus.publish('Alex', { text: 123 }), null);
  });

  it('subscriber errors do not crash the publisher', () => {
    const bus = new AgentBus();
    bus.subscribe('Alex', () => { throw new Error('boom'); });
    // Should not throw:
    assert.doesNotThrow(() => bus.publish('Alex', { text: 'hi' }));
  });

  it('buffer is capped per recipient', () => {
    const bus = new AgentBus({ maxQueuePerRecipient: 3 });
    for (let i = 0; i < 10; i++) bus.publish('Alex', { text: `m${i}` });
    const got = [];
    bus.subscribe('Alex', (m) => got.push(m.text));
    assert.equal(got.length, 3);
    assert.deepEqual(got, ['m7', 'm8', 'm9']); // newest 3 retained
  });

  it('unsubscribe stops further delivery', () => {
    const bus = new AgentBus();
    const got = [];
    const unsub = bus.subscribe('Alex', (m) => got.push(m.text));
    bus.publish('Alex', { text: 'a' });
    unsub();
    bus.publish('Alex', { text: 'b' });
    assert.deepEqual(got, ['a']);
  });
});

describe('AgentBus — message envelope', () => {
  it('attaches id, ts, and defaults', () => {
    const bus = new AgentBus();
    let msg = null;
    bus.subscribe('Alex', (m) => { msg = m; });
    bus.publish('Alex', { text: 'hi' });
    assert.equal(msg.to, 'Alex');
    assert.equal(msg.from, 'system');
    assert.equal(msg.kind, 'speak');
    assert.equal(typeof msg.id, 'number');
    assert.ok(msg.ts > 0);
  });
});
