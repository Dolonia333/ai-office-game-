/**
 * Voice Gate — client-side presence + speech wiring.
 *
 * Loaded in the browser. Exposes two globals that other UI code reaches for
 * when it wants to speak audibly:
 *
 *   window.DenizenPresence.zionPresent  — boolean, mirrored from server
 *   window.DenizenSpeak(npcName, text)  — fire-and-forget audio playback
 *
 * The server is the source of truth for presence: this module keeps the
 * local mirror in sync via the existing /agent-ws WebSocket (`world_state`
 * messages with kind === 'presence') and exposes a hotkey + console helper
 * for toggling without leaving the page.
 *
 * Audio playback is intentionally pluggable. By default the gate calls the
 * browser's native SpeechSynthesis API so things work without any config.
 * To use ElevenLabs (or any other TTS), assign a custom function:
 *
 *   window.DenizenVoiceProvider = async (npcName, text) => {
 *     const r = await fetch('/api/tts', { method: 'POST', body: JSON.stringify({ npcName, text }) });
 *     const blob = await r.blob();
 *     new Audio(URL.createObjectURL(blob)).play();
 *   };
 *
 * Keeping the swap point this small means the server stays neutral about
 * which TTS backend is in use — the only thing the gate cares about is
 * "are we allowed to make noise right now?"
 */

(function () {
  'use strict';

  const presence = { zionPresent: false };
  const ALT_V_KEY = 'v';
  const HOTKEY_HINT = 'Alt+V toggles voice/presence (or POST /api/presence {present:true})';

  // ---- Presence: hydrate from the server, then keep in sync ----
  async function hydratePresence() {
    try {
      const res = await fetch('/api/presence', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      presence.zionPresent = !!json.zionPresent;
    } catch (_) { /* offline tolerated */ }
  }

  async function setPresence(next) {
    try {
      await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ present: !!next }),
      });
      presence.zionPresent = !!next; // optimistic; server will confirm via WS
    } catch (err) {
      console.warn('[VoiceGate] setPresence failed:', err?.message || err);
    }
  }

  function togglePresence() { return setPresence(!presence.zionPresent); }

  // ---- Audio: native SpeechSynthesis as a sane default ----
  function defaultVoiceProvider(npcName, text) {
    if (!('speechSynthesis' in window)) return;
    // Proximity gate — gracefully degrades to full volume if the
    // proximity-audio module isn't loaded.
    const proximity = (window.DenizenProximityAudio && window.DenizenProximityAudio.computeVolumeForNpc)
      ? window.DenizenProximityAudio.computeVolumeForNpc(npcName)
      : { volume: 1, muted: false };
    if (proximity.muted) return;
    const utter = new SpeechSynthesisUtterance(text);
    // Tiny per-NPC pitch jitter so different characters don't all sound
    // identical. Real TTS providers will override this entirely.
    let hash = 0;
    for (let i = 0; i < (npcName || '').length; i++) hash = (hash * 31 + npcName.charCodeAt(i)) >>> 0;
    utter.pitch = 0.85 + ((hash % 30) / 100); // 0.85..1.14
    utter.rate = 1.05;
    utter.volume = proximity.volume;
    window.speechSynthesis.speak(utter);
  }

  function speak(npcName, text) {
    if (!presence.zionPresent) return;        // gate
    if (!text || typeof text !== 'string') return;
    const provider = window.DenizenVoiceProvider || defaultVoiceProvider;
    try { provider(npcName || 'NPC', text); }
    catch (err) { console.warn('[VoiceGate] provider error:', err?.message || err); }
  }

  // ---- Hotkey ----
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === ALT_V_KEY || e.key === ALT_V_KEY.toUpperCase())) {
      e.preventDefault();
      togglePresence().then(() => console.log(`[VoiceGate] zionPresent = ${presence.zionPresent}`));
    }
  });

  // ---- WebSocket sync ----
  // Hook into the existing /agent-ws connection if/when it appears. We
  // don't open our own socket — the office scene already manages one.
  function watchAgentWs() {
    let lastWs = null;
    setInterval(() => {
      const ws = window.__DenizenAgentWs;
      if (ws && ws !== lastWs) {
        lastWs = ws;
        ws.addEventListener('message', (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'world_state' && msg.kind === 'presence' && msg.payload) {
              presence.zionPresent = !!msg.payload.zionPresent;
            }
          } catch (_) {}
        });
      }
    }, 1000);
  }

  // ---- Export ----
  window.DenizenPresence = presence;
  window.DenizenSpeak = speak;
  window.DenizenSetPresence = setPresence;
  window.DenizenTogglePresence = togglePresence;

  hydratePresence();
  watchAgentWs();

  console.log(`[VoiceGate] ready. ${HOTKEY_HINT}`);
})();
