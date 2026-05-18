/**
 * SFX — ambient + event-driven sound effects, gated by presence.
 *
 * Loads `/data/sfx-map.json` (or `assets-catalog`-style remote map),
 * listens to the same /agent-ws frames the rest of the client uses,
 * and plays small audio clips on the right events.
 *
 * Design points worth knowing:
 *   - **Missing files are silent.** The map can ship before the audio
 *     assets exist. If `assets/audio/threat_high.ogg` isn't on disk,
 *     `audio.play()` rejects and we swallow it — no console spam.
 *   - **Gated on `window.DenizenPresence.zionPresent`** just like the
 *     voice gate. Same toggle (Alt+V) controls both.
 *   - **Throttled per-event** so a noisy moment (5 threats in 1s) plays
 *     the SFX once, not five times.
 *   - **Ambient loop** auto-starts on the first user gesture (browser
 *     autoplay policies require it). Volume + fade configurable.
 *
 * To add a new event sound:
 *   1. Drop the file into assets/audio/.
 *   2. Add an entry under `events` in `data/sfx-map.json`.
 *   3. Reload — no code changes.
 */
(function () {
  'use strict';

  const SFX_MAP_URL = '/data/sfx-map.json';
  const ASSETS_BASE = '/assets/audio/';
  const THROTTLE_MS = 350;

  let map = null;
  let ambient = null;
  let started = false;
  const lastFiredAt = new Map(); // key → ts

  function gateOpen() {
    return !!(window.DenizenPresence && window.DenizenPresence.zionPresent);
  }

  // Single-use cache so we don't re-fetch the same .ogg over and over.
  const audioCache = new Map();
  function getAudio(file, volume = 0.6) {
    const key = file + '@' + volume;
    let a = audioCache.get(key);
    if (a) {
      // Re-clone so overlapping fires don't get cut off.
      const clone = a.cloneNode();
      clone.volume = volume;
      return clone;
    }
    a = new Audio(ASSETS_BASE + file);
    a.volume = volume;
    audioCache.set(key, a);
    return a;
  }

  function play(file, volume) {
    if (!file) return;
    if (!gateOpen()) return;
    try {
      getAudio(file, volume).play().catch(() => { /* missing file or autoplay block — silent */ });
    } catch (_) { /* sealed environments */ }
  }

  function throttledPlay(eventKey, file, volume) {
    const now = Date.now();
    const last = lastFiredAt.get(eventKey) || 0;
    if (now - last < THROTTLE_MS) return;
    lastFiredAt.set(eventKey, now);
    play(file, volume);
  }

  function startAmbient() {
    if (!map?.ambient?.loop || ambient) return;
    if (!gateOpen()) return;
    const file = map.ambient.loop;
    const targetVol = typeof map.ambient.volume === 'number' ? map.ambient.volume : 0.18;
    const fade = typeof map.ambient.fadeInMs === 'number' ? map.ambient.fadeInMs : 0;

    const a = new Audio(ASSETS_BASE + file);
    a.loop = true;
    a.volume = fade > 0 ? 0 : targetVol;
    a.play().then(() => {
      ambient = a;
      if (fade > 0) {
        const steps = 20;
        let i = 0;
        const t = setInterval(() => {
          i++;
          a.volume = (i / steps) * targetVol;
          if (i >= steps) clearInterval(t);
        }, fade / steps);
      }
    }).catch(() => { /* autoplay blocked — try again on next user gesture */ });
  }

  function stopAmbient() {
    if (!ambient) return;
    try { ambient.pause(); } catch (_) {}
    ambient = null;
  }

  // ----- worldState event router -----
  function handleWorldStateChange(kind, payload) {
    if (!map?.events) return;
    const ev = map.events[kind];
    if (!ev) return;

    // Presence is a special case — value=true/false picks a sub-entry.
    if (kind === 'presence') {
      const variant = ev[String(!!payload?.zionPresent)];
      if (variant?.file) play(variant.file, variant.volume);
      // Also start/stop the ambient loop.
      if (payload?.zionPresent) startAmbient(); else stopAmbient();
      return;
    }

    // Severity-keyed events (e.g. threat).
    if (payload?.severity && ev[payload.severity]?.file) {
      throttledPlay(`${kind}:${payload.severity}`, ev[payload.severity].file, ev[payload.severity].volume);
      return;
    }

    // Plain { file, volume } entry.
    if (ev.file) throttledPlay(kind, ev.file, ev.volume);
  }

  function handleAgentBus(msg) {
    // No SFX for bus messages by default — they fire often. The voice
    // gate already covers them. Hook here if you want one.
  }

  // ----- Wire to the existing /agent-ws connection -----
  function watchWs() {
    let attached = null;
    setInterval(() => {
      const ws = window.__DenizenAgentWs;
      if (ws && ws !== attached) {
        attached = ws;
        ws.addEventListener('message', (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (_) { return; }
          if (m.type === 'world_state' && m.kind) {
            handleWorldStateChange(m.kind, m.payload);
          } else if (m.type === 'world_state_batch' && Array.isArray(m.changes)) {
            for (const c of m.changes) handleWorldStateChange(c.kind, c.payload);
          } else if (m.type === 'agent_bus' && m.msg) {
            handleAgentBus(m.msg);
          } else if (m.type === 'player_chat_response') {
            const ev2 = map?.events?.player_chat_response;
            if (ev2?.file) play(ev2.file, ev2.volume);
          }
        });
      }
    }, 1000);
  }

  // ----- Boot -----
  async function init() {
    try {
      const res = await fetch(SFX_MAP_URL, { cache: 'no-store' });
      if (!res.ok) return;
      map = await res.json();
    } catch (_) { return; /* SFX optional */ }

    started = true;
    watchWs();

    // Try to start ambient on the first user gesture (autoplay-safe).
    const onFirstGesture = () => {
      if (gateOpen()) startAmbient();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    window.addEventListener('keydown', onFirstGesture, { once: true });

    // If presence flips later, we want ambient to react in real time.
    // The world_state 'presence' event already does this, but watch for
    // the user toggling it from a console call too.
    let lastPresence = window.DenizenPresence?.zionPresent;
    setInterval(() => {
      const cur = window.DenizenPresence?.zionPresent;
      if (cur === lastPresence) return;
      lastPresence = cur;
      if (cur) startAmbient(); else stopAmbient();
    }, 500);

    console.log('[SFX] ready (events:', Object.keys(map.events || {}).join(','), ')');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
