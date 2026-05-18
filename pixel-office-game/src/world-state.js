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

    /** Furniture snapshot from the client. Used for desk-neighbor lookup
     *  in renderContextBlock. Updated periodically via setFurnitureSnapshot.
     *  Each entry: { id, instanceId, type, position:{x,y}, assignedTo } */
    this.furniture = [];

    /** Room adjacency graph — hand-authored from the current office layout.
     *  Used to surface "adjacent rooms" hints in the NPC prompt so they can
     *  reason about routing (e.g. "I'll grab coffee on the way to conference").
     *  Edit if the office layout changes. */
    this.roomGraph = {
      open_office:    ['conference', 'breakroom', 'manager_office', 'reception'],
      conference:     ['open_office', 'manager_office'],
      breakroom:      ['open_office', 'reception'],
      manager_office: ['open_office', 'conference'],
      reception:      ['open_office', 'breakroom', 'storage'],
      storage:        ['reception'],
    };

    /** Per-pair last contact timestamps. Keyed as "Alex|Josh" (sorted).
     *  Updated whenever an actions.speak/speakTo fires. Surfaced in the
     *  prompt as "you haven't talked to Bob in 14m". Caps automatically
     *  at 200 pairs to avoid unbounded growth on long sessions. */
    this.lastContact = new Map();

    /** Per-NPC recent self-messages (de-dup window). Keyed by NPC name,
     *  value is a small ring of {text, ts}. Used by the self-repetition
     *  detector so NPCs notice "you already asked the same question 90s ago"
     *  instead of looping. */
    this.recentSelfMessages = new Map();

    /** Caps so a chatty subsystem can't OOM us. */
    this._caps = {
      activeThreats: 8,
      recentEvents: 12,
      backgroundTasks: 25,
      foregroundTasks: 25,
      lastContact: 200,
      selfMessagesPerNpc: 5,
    };
  }

  // ---------------------------------------------------------------------
  // Furniture (used for desk-neighbor lookup)
  // ---------------------------------------------------------------------

  /** Replace the furniture snapshot wholesale. Cheap; called ~10s by the
   *  cofounder mirror. The full list is small (few dozen items). */
  setFurnitureSnapshot(items) {
    if (Array.isArray(items)) this.furniture = items.slice();
  }

  /** Resolve an NPC's desk position + their two nearest desk neighbors
   *  (by other NPC names). Returns null if no desk is assigned or no
   *  furniture is available. */
  getDeskContext(npcName) {
    const me = this.npcs[npcName];
    if (!me?.assignedDesk || this.furniture.length === 0) return null;
    const myDesk = this.furniture.find(f =>
      (f.id === me.assignedDesk || f.instanceId === me.assignedDesk)
      && f.type === 'desk');
    if (!myDesk?.position) return null;

    // Find other NPCs' desks sorted by distance from mine.
    const others = [];
    for (const [name, state] of Object.entries(this.npcs)) {
      if (name === npcName || !state.assignedDesk) continue;
      const theirDesk = this.furniture.find(f =>
        (f.id === state.assignedDesk || f.instanceId === state.assignedDesk)
        && f.type === 'desk');
      if (!theirDesk?.position) continue;
      const dx = theirDesk.position.x - myDesk.position.x;
      const dy = theirDesk.position.y - myDesk.position.y;
      others.push({ name, d: Math.sqrt(dx * dx + dy * dy) });
    }
    others.sort((a, b) => a.d - b.d);
    return {
      myDesk,
      neighbors: others.slice(0, 2).map(o => o.name),
    };
  }

  // ---------------------------------------------------------------------
  // Per-peer last contact + self-repetition tracking
  // ---------------------------------------------------------------------

  _pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** Record that two NPCs interacted. Called from npc-brains when a
   *  decision targets a peer. */
  recordContact(from, to) {
    if (!from || !to || from === to) return;
    this.lastContact.set(this._pairKey(from, to), Date.now());
    if (this.lastContact.size > this._caps.lastContact) {
      // Drop oldest 20% to amortize cost.
      const entries = [...this.lastContact.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < Math.floor(this._caps.lastContact * 0.2); i++) {
        this.lastContact.delete(entries[i][0]);
      }
    }
  }

  /** Minutes since `npcA` and `npcB` last interacted. Returns null if
   *  they've never been recorded. */
  minutesSinceContact(npcA, npcB) {
    const ts = this.lastContact.get(this._pairKey(npcA, npcB));
    if (!ts) return null;
    return Math.round((Date.now() - ts) / 60000);
  }

  /** Record a message the NPC just generated. Used by the repetition
   *  detector to flag "you already said this 90s ago." */
  recordSelfMessage(npcName, text) {
    if (!npcName || !text) return;
    if (!this.recentSelfMessages.has(npcName)) this.recentSelfMessages.set(npcName, []);
    const ring = this.recentSelfMessages.get(npcName);
    ring.push({ text: String(text).slice(0, 200), ts: Date.now() });
    if (ring.length > this._caps.selfMessagesPerNpc) ring.shift();
  }

  /** Return a near-duplicate of `text` from this NPC's last few messages,
   *  if one exists within `windowMs`. Similarity is naive: lowercased,
   *  punctuation-stripped, first 8 words overlap. Good enough to catch
   *  the "ask the same question every 90s" loop without false positives
   *  on different-but-related messages. */
  recentSimilarMessage(npcName, text, windowMs = 5 * 60 * 1000) {
    const ring = this.recentSelfMessages.get(npcName);
    if (!ring || !ring.length) return null;
    const now = Date.now();
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
    const target = norm(text);
    if (!target) return null;
    for (const entry of ring) {
      if (now - entry.ts > windowMs) continue;
      if (norm(entry.text) === target) {
        return { text: entry.text, ageSeconds: Math.round((now - entry.ts) / 1000) };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Room occupancy (computed from current NPC positions, no storage)
  // ---------------------------------------------------------------------

  /** Returns { roomName: occupantCount } for every room with at least one NPC. */
  roomOccupancy() {
    const counts = {};
    for (const s of Object.values(this.npcs)) {
      if (s.room) counts[s.room] = (counts[s.room] || 0) + 1;
    }
    return counts;
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

      // Conversation focus — when someone just spoke to you, the LLM
      // should acknowledge before doing anything else. Window kept short
      // (30s) so it doesn't haunt every prompt forever.
      if (me.lastAddressed && (Date.now() - me.lastAddressed.at) < 30000) {
        const ago = Math.round((Date.now() - me.lastAddressed.at) / 1000);
        const txt = String(me.lastAddressed.text || '').slice(0, 120);
        lines.push(`- ${me.lastAddressed.by} just spoke to you ${ago}s ago: "${txt}". Acknowledge them before doing anything else — it is rude to walk off mid-conversation.`);
      }

      // Adjacent rooms — so the NPC can think "I'll drop by reception on
      // the way to storage" instead of treating rooms as a flat list.
      if (me.room && this.roomGraph[me.room]) {
        lines.push(`- Adjacent rooms: ${this.roomGraph[me.room].join(', ')}`);
      }

      // Desk geography — your desk + the two nearest desks' owners. So
      // engineers know who's next to them physically, which matters for
      // "tap on the shoulder" interactions.
      const desk = this.getDeskContext(npcName);
      if (desk?.neighbors?.length) {
        lines.push(`- Your desk neighbors: ${desk.neighbors.join(', ')}`);
      }
    }

    // Who else is around? Top 3 by distance with rich tags: state,
    // busy flag, convoy detection (are they moving WITH you?).
    if (me && me.position) {
      const near = this.npcsNear(me.position.x, me.position.y, 160)
        .filter(n => n !== npcName)
        .slice(0, 3);
      if (near.length) {
        const nearStrs = near.map(n => {
          const s = this.npcs[n];
          if (!s) return n;
          const tags = [];
          if (s.state) tags.push(s.state);
          // "busy" tag — peers know NOT to interrupt mid-meeting / mid-walk.
          if (s.busy) tags.push('busy');
          // Convoy detection: angle between our velocity vectors. Both
          // must be moving (|v| > 30 px/s) AND aimed within ~30° of each
          // other → "walking with you". Otherwise no movement annotation.
          if (me.velocity && s.velocity) {
            const ourMag = Math.hypot(me.velocity.x, me.velocity.y);
            const theirMag = Math.hypot(s.velocity.x, s.velocity.y);
            if (ourMag > 30 && theirMag > 30) {
              const dot = me.velocity.x * s.velocity.x + me.velocity.y * s.velocity.y;
              const cos = dot / (ourMag * theirMag);
              if (cos > 0.85) tags.push('walking with you');
              else if (cos < -0.85) tags.push('walking opposite');
            }
          }
          // Time since last interaction — only show if it's been a
          // while, to flag "you haven't checked in with them today".
          const mins = this.minutesSinceContact(npcName, n);
          if (mins != null && mins > 15) tags.push(`last spoke ${mins}m ago`);
          return tags.length ? `${n} (${tags.join(', ')})` : n;
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

    // Room occupancy — so NPCs can sense "everyone's in conference, I'm
    // alone at my desk" or "breakroom is full, maybe later." Surfaced as a
    // compact one-liner to keep prompt cost down.
    const occ = this.roomOccupancy();
    const occEntries = Object.entries(occ).filter(([, c]) => c > 0);
    if (occEntries.length) {
      const parts = occEntries
        .sort((a, b) => b[1] - a[1])
        .map(([room, c]) => `${room}:${c}`);
      lines.push(`- Office occupancy: ${parts.join(' ')}`);
    }

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

    // Player presence — when the human (Zion / "the CEO") is in the
    // office, surface their position to every NPC. The receptionist role
    // (Lucy) uses this to decide whether to walk over and offer a tour
    // after the player has been standing still for a while.
    // Note: independent of `zionPresent` (which gates voice/audio).
    if (this.environment.playerPosition) {
      const idleMs = this.environment.playerIdleMs || 0;
      const idleSec = Math.round(idleMs / 1000);
      const p = this.environment.playerPosition;
      const tags = [`at (${Math.round(p.x)}, ${Math.round(p.y)})`];
      if (p.room) tags.push(p.room);
      if (idleSec > 30) tags.push(`idle ${idleSec}s — may need help`);
      lines.push(`- Player presence: ${tags.join(', ')}`);
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
