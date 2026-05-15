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

  // Translate cryptic SpeechRecognition error codes into something a user
  // can actually act on. Returns { short, hint } — short is the badge
  // label, hint is the longer explanation shown below it.
  function explainError(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return {
          short: '🚫 mic blocked',
          hint: 'Click the 🔒 icon in the address bar → Site settings → set Microphone to Allow → reload.',
        };
      case 'audio-capture':
        return {
          short: '🎙 no mic',
          hint: 'No microphone detected. Check OS sound settings → input devices.',
        };
      case 'network':
        return {
          short: '🌐 network',
          hint: 'Chrome\'s SpeechRecognition uses Google\'s cloud STT and needs internet.',
        };
      case 'no-speech':
        return {
          short: '🔇 no speech',
          hint: 'I didn\'t hear anything. Click to talk and speak right away.',
        };
      case 'aborted':
        return { short: 'cancelled', hint: null };
      case 'language-not-supported':
        return {
          short: 'lang unsupported',
          hint: `Locale "${lang}" not supported. Try window.DenizenVoiceInput.setLang("en-US").`,
        };
      case 'bad-grammar':
        return { short: 'bad grammar', hint: null };
      default:
        return {
          short: `error: ${code || 'unknown'}`,
          hint: 'Open the browser console (F12) for the full stack.',
        };
    }
  }

  // ---- Build the floating UI ----
  function buildUI() {
    if (micButton) return;

    micButton = document.createElement('button');
    micButton.id = 'denizen-mic-button';
    micButton.title = `Click to start/stop. Or hold ${hotkey} on the keyboard.`;
    micButton.textContent = '🎤';
    Object.assign(micButton.style, {
      position: 'fixed', bottom: '14px', right: '14px', zIndex: 9998,
      width: '52px', height: '52px', borderRadius: '50%',
      background: '#0f172a', color: '#cfe7ff', border: '2px solid #355',
      cursor: 'pointer', font: '22px monospace', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      transition: 'background 120ms, border-color 120ms, transform 80ms',
    });
    // CLICK-TO-TOGGLE (not push-to-hold from the button). Press-and-hold
    // off the button was the worst UX bug — drift the cursor off the
    // 46-pixel target while speaking and it stopped mid-sentence. Click
    // once to start; click again to stop. Hold the keyboard hotkey for
    // push-to-talk if you prefer that.
    micButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (listening) stop(); else start();
    });
    document.body.appendChild(micButton);

    statusBadge = document.createElement('div');
    statusBadge.id = 'denizen-mic-status';
    Object.assign(statusBadge.style, {
      position: 'fixed', bottom: '76px', right: '14px', zIndex: 9998,
      background: 'rgba(0,0,0,0.92)', color: '#cfe7ff',
      font: '11px monospace', padding: '6px 10px', border: '1px solid #355',
      borderRadius: '6px', display: 'none', maxWidth: '340px',
      textAlign: 'left', lineHeight: '1.4', whiteSpace: 'normal',
    });
    document.body.appendChild(statusBadge);
  }

  // Tracks the current "error sticky" state so onend doesn't immediately
  // wipe a useful error message a quarter-second later.
  let _errorSticky = false;

  function setMicState(state, text, opts = {}) {
    if (!micButton) return;
    if (state === 'listening') {
      micButton.style.background = '#7f1d1d';
      micButton.style.borderColor = '#fca5a5';
    } else if (state === 'busy') {
      micButton.style.background = '#1e3a8a';
      micButton.style.borderColor = '#93c5fd';
    } else if (state === 'error') {
      micButton.style.background = '#7c2d12';
      micButton.style.borderColor = '#fdba74';
    } else {
      micButton.style.background = '#0f172a';
      micButton.style.borderColor = '#355';
    }
    _errorSticky = (state === 'error') && opts.sticky;
    if (statusBadge) {
      if (text) {
        statusBadge.innerHTML = text; // allow simple formatting from explainError
        statusBadge.style.display = 'block';
      } else if (!_errorSticky) {
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
      const code = ev?.error || 'unknown';
      console.warn('[VoiceInput] recognition error:', code);
      const { short, hint } = explainError(code);
      const msg = hint
        ? `<b>${short}</b><br><span style="opacity:0.85">${hint}</span>`
        : `<b>${short}</b>`;
      // Sticky for blocking errors so the user has time to read; transient
      // for 'no-speech' / 'aborted' which are just "try again".
      const sticky = code === 'not-allowed' || code === 'service-not-allowed'
        || code === 'audio-capture' || code === 'network'
        || code === 'language-not-supported';
      setMicState('error', msg, { sticky });
      if (!sticky) {
        setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 3500);
      }
      listening = false;
    };

    recognition.onend = () => {
      listening = false;
      if (lastFinal && autosubmit) {
        deliver(lastFinal);
      }
      // Keep the badge visible briefly so user sees what was sent — but
      // don't stomp a sticky error message if one is up.
      setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 1500);
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
      setMicState('listening', 'listening… (click again or release the key to stop)');
    } catch (err) {
      // Most common: InvalidStateError when the previous session hasn't
      // fully ended yet (rapid click). Just swallow it — the next click
      // will work fine.
      console.warn('[VoiceInput] start failed:', err?.message || err);
      if (/InvalidStateError|already started/i.test(err?.message || '')) {
        setMicState('busy', 'cleaning up previous session… click again in a moment');
        setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 1500);
      } else {
        const msg = `<b>start failed</b><br><span style="opacity:0.85">${err?.message || 'unknown'}</span>`;
        setMicState('error', msg, { sticky: true });
      }
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
