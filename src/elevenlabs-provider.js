/**
 * ElevenLabs Voice Provider — client-side wiring.
 *
 * Loaded after `voice-gate.js`. On boot it asks the server "do you have
 * ElevenLabs configured?" via /api/tts/health. If yes, it installs
 * itself as `window.DenizenVoiceProvider`, replacing the default
 * SpeechSynthesis fallback. The voice gate (which is gated on
 * `zionPresent`) then routes every NPC speech through ElevenLabs.
 *
 * Behaviour:
 *   - One Audio object per call, so overlapping NPC lines don't queue
 *     into a single channel — multiple NPCs can speak at once.
 *   - Per-NPC URL.createObjectURL is revoked on `ended` to avoid
 *     leaking blob URLs over a long session.
 *   - On HTTP failure, falls back to SpeechSynthesis for THAT call only
 *     (so a transient ElevenLabs outage doesn't silence the office).
 *   - All audio is gated by window.DenizenPresence.zionPresent — the
 *     voice gate already enforces this; we double-check here as belt-
 *     and-suspenders so a misconfigured caller can't make us speak when
 *     presence is off.
 */
(function () {
  'use strict';

  const HEALTH_URL = '/api/tts/health';
  const TTS_URL = '/api/tts';

  // Speech-synthesis fallback identical to voice-gate.js's default. We
  // keep a copy here so we don't need to import anything from that file.
  function speechSynthesisFallback(npcName, text) {
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    let hash = 0;
    for (let i = 0; i < (npcName || '').length; i++) hash = (hash * 31 + npcName.charCodeAt(i)) >>> 0;
    utter.pitch = 0.85 + ((hash % 30) / 100);
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  }

  async function elevenLabsProvider(npcName, text) {
    if (!window.DenizenPresence?.zionPresent) return; // belt + suspenders gate
    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcName, text }),
      });
      if (!res.ok) {
        // Bubble up the server's error message into the console; fall back
        // to SpeechSynthesis so this single line still gets spoken.
        let detail = '';
        try { detail = (await res.json()).error || ''; } catch (_) {}
        console.warn(`[ElevenLabs] /api/tts ${res.status} ${detail} — using SpeechSynthesis`);
        speechSynthesisFallback(npcName, text);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      audio.play().catch((err) => {
        // Browsers block autoplay until a user gesture has happened — if
        // we hit that, surface it so the user knows what to do (click
        // anywhere on the page once).
        console.warn(`[ElevenLabs] audio.play() blocked: ${err?.message || err}. Click the page once to unlock audio.`);
      });
    } catch (err) {
      console.warn(`[ElevenLabs] ${err?.message || err} — using SpeechSynthesis`);
      speechSynthesisFallback(npcName, text);
    }
  }

  async function init() {
    let health;
    try {
      const res = await fetch(HEALTH_URL, { cache: 'no-store' });
      if (!res.ok) return; // server doesn't have the endpoint — older build
      health = await res.json();
    } catch (_) {
      return; // server unreachable; default SpeechSynthesis stays in place
    }
    if (!health || !health.configured) {
      console.log('[ElevenLabs] not configured on the server — staying with SpeechSynthesis');
      return;
    }
    window.DenizenVoiceProvider = elevenLabsProvider;
    console.log(`[ElevenLabs] active (key from ${health.source}, ${health.voiceMapEntries || 0} NPC voices)`);
  }

  // Wait for the page to be interactive enough that fetch will work.
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
