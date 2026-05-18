'use strict';
/**
 * AgentBus — pub/sub for direct NPC-to-NPC messaging.
 *
 * Before this, every NPC interaction had to be brokered by the CofounderAgent
 * (the CTO). That was fine for top-down direction but wrong for peer chatter
 * — Alex telling Josh "the API is down" should not require Abby to relay it.
 *
 * The bus is a tiny in-memory message queue keyed by recipient name. Anyone
 * with a reference to it can publish; subscribers receive every message
 * targeted at them. Wildcard subscribers (`subscribe('*', ...)`) see
 * everything — useful for the WebSocket bridge that mirrors agent-to-agent
 * traffic to the browser.
 *
 * Why not reuse Node's EventEmitter directly? We want:
 *   - default-deny addressing (a 'speak' to "Alex" should NOT fan out to
 *     every other NPC the way EventEmitter('speak') would)
 *   - automatic per-message id + timestamp for tracing
 *   - back-pressure protection (cap per-recipient queue depth so a paused
 *     subscriber can't OOM the process)
 */

const EventEmitter = require('node:events');

class AgentBus extends EventEmitter {
  constructor({ maxQueuePerRecipient = 100 } = {}) {
    super();
    this.setMaxListeners(64);
    this._maxQueue = maxQueuePerRecipient;

    /** Pending messages buffered per recipient before any subscriber attaches. */
    this._buffer = new Map(); // recipient -> Message[]

    /** Counter for unique message ids. */
    this._seq = 0;
  }

  /**
   * Publish a message to a specific recipient (NPC display name).
   * If no subscriber is attached yet, the message is buffered up to
   * `maxQueuePerRecipient`; the first subscriber drains the buffer.
   *
   * @param {string} to        recipient NPC name
   * @param {{from?:string,text:string,meta?:object,kind?:string}} payload
   * @returns {object|null} the wrapped message, or null on validation failure
   */
  publish(to, payload) {
    if (!to || typeof to !== 'string') return null;
    if (!payload || typeof payload.text !== 'string') return null;

    const msg = {
      id: ++this._seq,
      to,
      from: payload.from || 'system',
      kind: payload.kind || 'speak',
      text: payload.text,
      meta: payload.meta || {},
      ts: Date.now(),
    };

    const subs = this.listenerCount(`to:${to}`);
    if (subs > 0) {
      this.emit(`to:${to}`, msg);
    } else {
      // Buffer until someone subscribes.
      if (!this._buffer.has(to)) this._buffer.set(to, []);
      const q = this._buffer.get(to);
      q.push(msg);
      if (q.length > this._maxQueue) q.splice(0, q.length - this._maxQueue);
    }

    // Wildcard listeners always receive everything — used for logging,
    // WebSocket mirroring, and tests.
    this.emit('*', msg);
    return msg;
  }

  /**
   * Subscribe to messages addressed to one recipient, or to '*' for all.
   * On first subscribe, any buffered messages for that recipient are
   * delivered synchronously in arrival order.
   *
   * @param {string} recipient
   * @param {(msg:object)=>void} handler
   * @returns {()=>void} unsubscribe function
   */
  subscribe(recipient, handler) {
    if (typeof handler !== 'function') return () => {};
    const eventName = recipient === '*' ? '*' : `to:${recipient}`;

    const safeHandler = (msg) => {
      try { handler(msg); }
      catch (err) {
        console.warn(`[AgentBus] subscriber error for "${recipient}":`, err?.message || err);
      }
    };
    this.on(eventName, safeHandler);

    // Drain buffer (only for a specific recipient — wildcard does not get
    // the historical buffer because it could be huge).
    if (recipient !== '*' && this._buffer.has(recipient)) {
      const drained = this._buffer.get(recipient);
      this._buffer.delete(recipient);
      for (const msg of drained) safeHandler(msg);
    }

    return () => this.off(eventName, safeHandler);
  }

  /** Drop everything — used in tests to keep state isolated. */
  reset() {
    this.removeAllListeners();
    this._buffer.clear();
    this._seq = 0;
  }
}

// Singleton, like world-state.
const agentBus = new AgentBus();
module.exports = agentBus;
module.exports.AgentBus = AgentBus;
