/**
 * Voice Input — push-to-talk speech recognition for the player.
 *
 * Closes the "voice loop" — combined with the existing voice gate this
 * means: hold a key → talk → NPC hears you (transcript routed through
 * player-chat → NPC brain or OpenClaw dispatch) → NPC speaks back.
 *
 * Uses the browser's built-in `SpeechRecognition` (webkit prefix on
 * Chrome). No server, no API key, no privacy footprint beyond what
 * Chrome already does. Falls back gracefully on browsers without it
 * (Firefox, Safari pre-15) — the mic button just doesn't appear.
 *
 * Bindings:
 *   - Hold `\` (backslash) to talk         — primary push-to-talk
 *   - Or click the floating mic button     — accessible alternative
 *   - Release / click again to stop
 *
 * Tunable via the script tag's data-* attrs or via globals:
 *   window.DenizenVoiceInput.setHotkey('\\')          — change the hotkey
 *   window.DenizenVoiceInput.setLang('en-US')         — change recognizer locale
 *   window.DenizenVoiceInput.setAutosubmit(true)      — auto-send on final result
 *   window.DenizenVoiceInput.setProvider(fn)          — swap the STT engine
 *
 * NOTE on the hotkey choice: Space is the natural push-to-talk button
 * but the office scene uses Space for Phaser interact. Backslash is
 * unbound and right next to Enter on QWERTY.
 */
(function () {
  'use strict';

  const HOTKEY_DEFAULT = '\\';
  const LANG_DEFAULT = 'en-US';

  let hotkey = HOTKEY_DEFAULT;
  let lang = LANG_DEFAULT;
  let autosubmit = true;
  let recognition = null;
  let listening = false;
  let lastFinal = '';
  let micButton = null;
  let statusBadge = null;
  let providerOverride = null;
  let pttDown = false;

  // ---- Detect support ----
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  if (!SR) {
    console.log('[VoiceInput] SpeechRecognition not available in this browser — voice input disabled');
    // Still expose the API so callers don't crash.
    window.DenizenVoiceInput = {
      supported: false,
      isListening: () => false,
      start() {}, stop() {},
      setHotkey() {}, setLang() {}, setAutosubmit() {}, setProvider() {},
    };
    return;
  }

  // ---- Build the floating UI ----
  function buildUI() {
    if (micButton) return;

    micButton = document.createElement('button');
    micButton.id = 'denizen-mic-button';
    micButton.title = `Push to talk (hold ${hotkey} or click)`;
    micButton.textContent = '🎤';
    Object.assign(micButton.style, {
      position: 'fixed', bottom: '14px', right: '14px', zIndex: 9998,
      width: '46px', height: '46px', borderRadius: '50%',
      background: '#0f172a', color: '#cfe7ff', border: '2px solid #355',
      cursor: 'pointer', font: '20px monospace', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      transition: 'background 120ms, border-color 120ms',
    });
    micButton.addEventListener('mousedown', (e) => { e.preventDefault(); start(); });
    micButton.addEventListener('mouseup',   () => stop());
    micButton.addEventListener('mouseleave',() => stop());
    micButton.addEventListener('touchstart',(e) => { e.preventDefault(); start(); }, { passive: false });
    micButton.addEventListener('touchend',  () => stop());
    document.body.appendChild(micButton);

    statusBadge = document.createElement('div');
    statusBadge.id = 'denizen-mic-status';
    Object.assign(statusBadge.style, {
      position: 'fixed', bottom: '70px', right: '14px', zIndex: 9998,
      background: 'rgba(0,0,0,0.85)', color: '#cfe7ff',
      font: '11px monospace', padding: '4px 8px', border: '1px solid #355',
      borderRadius: '4px', display: 'none', maxWidth: '320px', textAlign: 'right',
    });
    document.body.appendChild(statusBadge);
  }

  function setMicState(state, text) {
    if (!micButton) return;
    if (state === 'listening') {
      micButton.style.background = '#7f1d1d';
      micButton.style.borderColor = '#fca5a5';
    } else if (state === 'busy') {
      micButton.style.background = '#1e3a8a';
      micButton.style.borderColor = '#93c5fd';
    } else {
      micButton.style.background = '#0f172a';
      micButton.style.borderColor = '#355';
    }
    if (statusBadge) {
      if (text) {
        statusBadge.textContent = text;
        statusBadge.style.display = 'block';
      } else {
        statusBadge.style.display = 'none';
      }
    }
  }

  // ---- Recognition lifecycle ----
  function ensureRecognition() {
    if (recognition) return recognition;
    recognition = new SR();
    recognition.continuous = false;       // single utterance per push
    recognition.interimResults = true;    // get partial transcripts as you talk
    recognition.lang = lang;

    recognition.onresult = (ev) => {
      let interim = '';
      let final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setMicState('listening', `… ${interim}`);
      if (final) {
        lastFinal = final.trim();
        setMicState('busy', `→ ${lastFinal}`);
      }
    };

    recognition.onerror = (ev) => {
      console.warn('[VoiceInput] recognition error:', ev?.error);
      setMicState('idle', `error: ${ev?.error || 'unknown'}`);
      setTimeout(() => setMicState('idle', ''), 2500);
      listening = false;
    };

    recognition.onend = () => {
      listening = false;
      if (lastFinal && autosubmit) {
        deliver(lastFinal);
      }
      // Keep the badge visible briefly so user sees what was sent
      setTimeout(() => setMicState('idle', ''), 1500);
      lastFinal = '';
    };

    return recognition;
  }

  function start() {
    if (listening) return;
    if (providerOverride) {
      // External provider takes over (e.g. Whisper-via-server).
      try { providerOverride.start(deliver, setMicState); listening = true; }
      catch (err) { console.warn('[VoiceInput] provider.start failed:', err?.message || err); }
      return;
    }
    try {
      ensureRecognition().start();
      listening = true;
      setMicState('listening', 'listening…');
    } catch (err) {
      console.warn('[VoiceInput] start failed:', err?.message || err);
      setMicState('idle', '');
    }
  }

  function stop() {
    if (!listening) return;
    if (providerOverride && typeof providerOverride.stop === 'function') {
      try { providerOverride.stop(); } catch (_) {}
    } else if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
    listening = false;
    setMicState('busy', 'transcribing…');
  }

  // ---- Deliver transcript ----
  // Path 1: route through player-chat if the chat panel is open / available.
  // Path 2: fall back to dispatching directly via the OpenClaw dispatcher
  //         if it's loaded (so voice still works when the chat UI isn't open).
  function deliver(transcript) {
    if (!transcript || !transcript.trim()) return;
    const text = transcript.trim();

    // PlayerChat exposes itself to globals once instantiated.
    if (window.__DenizenPlayerChat && typeof window.__DenizenPlayerChat.sendMessage === 'function') {
      try { window.__DenizenPlayerChat.sendMessage(text); }
      catch (err) { console.warn('[VoiceInput] sendMessage failed:', err?.message || err); }
      return;
    }

    // Fallback: dispatcher direct.
    if (window.DenizenOpenClawDispatch && typeof window.DenizenOpenClawDispatch.dispatch === 'function') {
      window.DenizenOpenClawDispatch.dispatch(text);
      return;
    }

    console.warn('[VoiceInput] no destination — neither PlayerChat nor OpenClawDispatch available');
  }

  // ---- Hotkey ----
  window.addEventListener('keydown', (e) => {
    // Don't grab the hotkey while the user is typing in an input.
    const activeIsTextInput = (() => {
      const el = document.activeElement;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    })();
    if (activeIsTextInput) return;
    if (e.key !== hotkey || e.repeat) return;
    pttDown = true;
    e.preventDefault();
    start();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key !== hotkey) return;
    if (!pttDown) return;
    pttDown = false;
    e.preventDefault();
    stop();
  });

  // ---- Boot ----
  function init() {
    buildUI();
    console.log(`[VoiceInput] ready — hold ${hotkey} or click the mic button to talk (${lang})`);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---- Public API ----
  window.DenizenVoiceInput = {
    supported: true,
    isListening: () => listening,
    start, stop,
    setHotkey(k) { if (typeof k === 'string' && k.length === 1) hotkey = k; },
    setLang(l) { lang = l; if (recognition) recognition.lang = l; },
    setAutosubmit(b) { autosubmit = !!b; },
    setProvider(provider) {
      // provider: { start(deliver, setStatus), stop?() }
      providerOverride = provider || null;
    },
    _deliver: deliver, // exposed for tests / external triggers
  };
})();
