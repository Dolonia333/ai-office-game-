'use strict';
/**
 * WorldState — single in-memory source of truth for everything happening
 * across the office at this instant.
 *
 * Before this module existed, the same information was scattered across at
 * least five places:
 *   - cofounder-agent.js     (officeState — agents, furniture, tasks, time)
 *   - npc-brains.js          (_eventFeed, _sharedTasks, _npcRelationships)
 *   - security-monitor       (active threats)
 *   - agent-office-manager   (per-NPC live state, meeting flags)
 *   - player-chat / client   (presence flag for voice gating)
 *
 * That made it impossible to answer "what is the office doing right now?"
 * without joining state from five files. WorldState collapses it into one
 * object that every subsystem reads from and writes to via small, named
 * methods. Each mutation can also notify subscribers, which lets the
 * server broadcast a single coherent snapshot to the browser instead of
 * chasing five separate event streams.
 *
 * The object intentionally favors flatness over depth and avoids any
 * dependency on Express/HTTP/WS — it is pure data + a tiny pub-sub.
 */

const EventEmitter = require('node:events');

/**
 * @typedef {Object} NpcLiveState
 * @property {{x:number,y:number}} [position]
 * @property {string} [state]         // 'working' | 'walking' | 'meeting' | 'idle' | ...
 * @property {string} [lastAction]    // human-readable summary of the last decision
 * @property {string} [currentTask]   // what they say they are doing right now
 * @property {string} [room]          // open_office | conference | breakroom | ...
 * @property {number} [updatedAt]     // ms epoch
 */

/**
 * @typedef {Object} TaskRecord
 * @property {string} id
 * @property {string} source         // 'n8n' | 'cofounder' | 'player' | ...
 * @property {string} title
 * @property {string} [status]       // 'queued' | 'running' | 'done' | 'failed'
 * @property {string} [assignee]     // NPC display name, if any
 * @property {string} [detail]
 * @property {number} createdAt
 * @property {number} [updatedAt]
 */

/**
 * @typedef {Object} EventRecord
 * @property {string} kind           // 'meeting' | 'shipped' | 'stuck' | 'threat' | ...
 * @property {string} text
 * @property {number} ts
 */

/**
 * @typedef {Object} ThreatRecord
 * @property {string} category
 * @property {string} severity
 * @property {string} source
 * @property {string} target
 * @property {string} detail
 * @property {number} ts
 */

class WorldState extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(64); // many NPC bus subscribers + the broadcast hook

    /** Whether the human (Zion) is at the keyboard. Voice synthesis is gated on this. */
    this.zionPresent = false;

    /** @type {Object<string, NpcLiveState>} keyed by NPC display name */
    this.npcs = {};

    /** @type {ThreatRecord[]} most-recent first, capped */
    this.activeThreats = [];

    /** @type {TaskRecord[]} background jobs (n8n, batch, anything off-screen) */
    this.backgroundTasks = [];

    /** @type {TaskRecord[]} foreground tasks the user can see in-game */
    this.foregroundTasks = [];

    /** @type {EventRecord[]} last N notable office events */
    this.recentEvents = [];

    /** Environmental flags for "the room as a whole" */
    this.environment = {
      meetingInProgress: false,
      meetingAttendees: [],
      time: Date.now(),
    };

    /** Caps so a chatty subsystem can't OOM us. */
    this._caps = {
      activeThreats: 8,
      recentEvents: 12,
      backgroundTasks: 25,
      foregroundTasks: 25,
    };
  }

  // ---------------------------------------------------------------------
  // Presence
  // ---------------------------------------------------------------------

  /**
   * Toggle whether the human is present. When true, voice/audio output
   * (ElevenLabs) is allowed to play; when false, only speech bubbles
   * render. The flag is intentionally a single boolean — there is no
   * "partial" presence.
   * @param {boolean} present
   * @returns {boolean} the new value
   */
  setPresence(present) {
    const next = !!present;
    if (next === this.zionPresent) return next;
    this.zionPresent = next;
    this._emit('presence', { zionPresent: next });
    return next;
  }

  // ---------------------------------------------------------------------
  // NPC live state
  // ---------------------------------------------------------------------

  /**
   * Merge a partial update into an NPC's live state. Only the fields you
   * pass are touched — everything else is preserved. Emits 'npc' on every
   * call, even if nothing changed (callers can dedupe if they care).
   * @param {string} name
   * @param {Partial<NpcLiveState>} patch
   */
  updateNpc(name, patch) {
    if (!name || typeof name !== 'string') return;
    const cur = this.npcs[name] || {};
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    this.npcs[name] = next;
    this._emit('npc', { name, state: next });
  }

  /** Return a shallow copy so callers can't mutate internal state. */
  getNpc(name) {
    return this.npcs[name] ? { ...this.npcs[name] } : null;
  }

  /** All NPCs as a plain map, frozen against accidental mutation. */
  getAllNpcs() {
    const out = {};
    for (const k of Object.keys(this.npcs)) out[k] = { ...this.npcs[k] };
    return out;
  }

  /**
   * Find NPCs within `radius` pixels of (x, y). Used by NPCs to ask
   * "who is near me right now?" before deciding what to say.
   * @returns {string[]} display names sorted by distance
   */
  npcsNear(x, y, radius = 120) {
    const r2 = radius * radius;
    const hits = [];
    for (const [name, s] of Object.entries(this.npcs)) {
      const p = s.position;
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) hits.push({ name, d2 });
    }
    hits.sort((a, b) => a.d2 - b.d2);
    return hits.map(h => h.name);
  }

  // ---------------------------------------------------------------------
  // Threats
  // ---------------------------------------------------------------------

  pushThreat(threat) {
    if (!threat || typeof threat !== 'object') return;
    const t = { ts: Date.now(), ...threat };
    this.activeThreats.unshift(t);
    if (this.activeThreats.length > this._caps.activeThreats) {
      this.activeThreats.length = this._caps.activeThreats;
    }
    this.pushEvent('threat', `${t.category}/${t.severity}: ${t.detail || t.target || ''}`.trim());
    this._emit('threat', t);
  }

  clearThreat(category, source) {
    const before = this.activeThreats.length;
    this.activeThreats = this.activeThreats.filter(
      t => !(t.category === category && t.source === source)
    );
    if (this.activeThreats.length !== before) this._emit('threat-cleared', { category, source });
  }

  // ---------------------------------------------------------------------
  // Tasks (background = n8n etc., foreground = visible in-game)
  // ---------------------------------------------------------------------

  upsertTask(task, { foreground = false } = {}) {
    if (!task || typeof task !== 'object' || !task.id) return null;
    const list = foreground ? this.foregroundTasks : this.backgroundTasks;
    const cap = foreground ? this._caps.foregroundTasks : this._caps.backgroundTasks;
    const idx = list.findIndex(t => t.id === task.id);
    const merged = idx === -1
      ? { createdAt: Date.now(), ...task, updatedAt: Date.now() }
      : { ...list[idx], ...task, updatedAt: Date.now() };
    if (idx === -1) {
      list.unshift(merged);
      if (list.length > cap) list.length = cap;
    } else {
      list[idx] = merged;
    }
    this._emit('task', { task: merged, foreground });
    return merged;
  }

  removeTask(id) {
    const drop = (list) => {
      const idx = list.findIndex(t => t.id === id);
      if (idx === -1) return false;
      list.splice(idx, 1);
      return true;
    };
    const removedBg = drop(this.backgroundTasks);
    const removedFg = drop(this.foregroundTasks);
    if (removedBg || removedFg) this._emit('task-removed', { id });
    return removedBg || removedFg;
  }

  // ---------------------------------------------------------------------
  // Event feed (the "what just happened" stream)
  // ---------------------------------------------------------------------

  pushEvent(kind, text) {
    if (!kind || !text) return;
    const ev = { kind, text: String(text).slice(0, 240), ts: Date.now() };
    this.recentEvents.unshift(ev);
    if (this.recentEvents.length > this._caps.recentEvents) {
      this.recentEvents.length = this._caps.recentEvents;
    }
    this._emit('event', ev);
  }

  // ---------------------------------------------------------------------
  // Environment
  // ---------------------------------------------------------------------

  setMeeting({ active, attendees = [] } = {}) {
    this.environment.meetingInProgress = !!active;
    this.environment.meetingAttendees = Array.isArray(attendees) ? attendees.slice() : [];
    this.environment.time = Date.now();
    this._emit('environment', this.environment);
  }

  // ---------------------------------------------------------------------
  // Snapshot + prompt rendering
  // ---------------------------------------------------------------------

  /** JSON-safe deep clone of everything. Cheap; the object is small. */
  snapshot() {
    return {
      zionPresent: this.zionPresent,
      npcs: this.getAllNpcs(),
      activeThreats: this.activeThreats.slice(),
      backgroundTasks: this.backgroundTasks.slice(),
      foregroundTasks: this.foregroundTasks.slice(),
      recentEvents: this.recentEvents.slice(),
      environment: { ...this.environment },
    };
  }

  /**
   * Render a compact "## Current State" markdown block from the POV of
   * one NPC. Designed to be prepended to the system prompt so the LLM
   * has live awareness of itself, its neighbors, the active threats,
   * and any backgrounded work happening off-screen.
   * @param {string} npcName
   */
  renderContextBlock(npcName) {
    const me = this.npcs[npcName];
    const lines = [];
    if (me) {
      const where = me.room ? ` in ${me.room}` : '';
      lines.push(`- You are: ${me.state || 'idle'}${where}`);
      if (me.lastAction) lines.push(`- Your last action: ${me.lastAction}`);
      if (me.currentTask) lines.push(`- Current task: ${me.currentTask}`);
    }

    // Who else is around? Top 3 by distance if we know our position.
    if (me && me.position) {
      const near = this.npcsNear(me.position.x, me.position.y, 160)
        .filter(n => n !== npcName)
        .slice(0, 3);
      if (near.length) {
        const nearStrs = near.map(n => {
          const s = this.npcs[n];
          return s && s.state ? `${n} (${s.state})` : n;
        });
        lines.push(`- Nearby: ${nearStrs.join(', ')}`);
      }
    }

    // Office-wide activity — keep it short, the prompt is already long.
    const otherActive = Object.entries(this.npcs)
      .filter(([n, s]) => n !== npcName && s.currentTask)
      .slice(0, 4)
      .map(([n, s]) => `${n}: ${s.currentTask}`);
    if (otherActive.length) lines.push(`- Room activity: ${otherActive.join('; ')}`);

    if (this.activeThreats.length) {
      const t = this.activeThreats[0];
      lines.push(`- Active threats: ${this.activeThreats.length} (latest: ${t.category} ${t.severity})`);
    }

    if (this.backgroundTasks.length) {
      const running = this.backgroundTasks.filter(t => t.status === 'running').length;
      const total = this.backgroundTasks.length;
      lines.push(`- Background jobs: ${running}/${total} running`);
    }

    if (this.environment.meetingInProgress) {
      const att = this.environment.meetingAttendees.join(', ') || 'unspecified attendees';
      lines.push(`- Meeting in progress: ${att}`);
    }

    return lines.length ? lines.join('\n') : '';
  }

  // ---------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------

  /**
   * Wrap emit in a try/catch so a buggy subscriber can't crash a state
   * mutation. Also fires a generic 'change' event so a single broadcaster
   * can subscribe once and forward everything.
   */
  _emit(kind, payload) {
    try { this.emit(kind, payload); } catch (err) {
      console.warn(`[WorldState] subscriber error on "${kind}":`, err?.message || err);
    }
    try { this.emit('change', { kind, payload, snapshot: this.snapshot() }); } catch (_) {}
  }
}

// Singleton — every subsystem imports the same instance.
const worldState = new WorldState();
module.exports = worldState;
module.exports.WorldState = WorldState;
