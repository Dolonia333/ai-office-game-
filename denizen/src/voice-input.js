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
  const supportsSpeechRecognition = !!SR;

  function createServerSttProvider() {
    if (!navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return null;
    }

    let recorder = null;
    let stream = null;
    let chunks = [];
    let active = false;
    let health = null;

    const stopTracks = () => {
      try { stream?.getTracks?.().forEach(t => t.stop()); } catch (_) {}
      stream = null;
    };

    async function ensureHealth() {
      if (health) return health;
      try {
        const res = await fetch('/api/stt/health', { cache: 'no-store' });
        health = res.ok ? await res.json() : { configured: false };
      } catch (_) {
        health = { configured: false };
      }
      return health;
    }

    async function blobToBase64(blob) {
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const out = String(fr.result || '');
          const comma = out.indexOf(',');
          resolve(comma >= 0 ? out.slice(comma + 1) : out);
        };
        fr.onerror = () => reject(fr.error || new Error('failed to read blob'));
        fr.readAsDataURL(blob);
      });
    }

    return {
      async start(deliver, setStatus) {
        if (active) return;
        const h = await ensureHealth();
        if (!h?.configured) {
          setStatus(
            'error',
            '<b>🎤 server STT not configured</b><br><span style="opacity:0.85">Set OPENAI_WHISPER_API_KEY (or OPENAI_API_KEY) for /api/stt.</span>',
            { sticky: true },
          );
          throw new Error('server stt not configured');
        }

        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

        recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (ev) => {
          if (ev?.data?.size > 0) chunks.push(ev.data);
        };
        recorder.onerror = (ev) => {
          setStatus('error', `<b>🎤 recorder error</b><br><span style="opacity:0.85">${ev?.error?.message || 'unknown'}</span>`, { sticky: true });
          active = false;
          stopTracks();
        };
        recorder.onstop = async () => {
          active = false;
          const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
          chunks = [];
          stopTracks();

          if (!blob.size) {
            setStatus('error', '<b>🔇 no speech</b><br><span style="opacity:0.85">No audio was captured.</span>');
            return;
          }

          try {
            setStatus('busy', 'transcribing (server STT)…');
            const audioBase64 = await blobToBase64(blob);
            const res = await fetch('/api/stt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64,
                mimeType: blob.type || recorder?.mimeType || 'audio/webm',
                lang,
              }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(json?.error || `HTTP ${res.status}`);
            }
            const text = String(json?.text || '').trim();
            if (!text) {
              setStatus('error', '<b>🔇 no speech</b><br><span style="opacity:0.85">No transcript returned.</span>');
              return;
            }
            setStatus('busy', `→ ${text}`);
            deliver(text);
          } catch (err) {
            setStatus('error', `<b>🌐 STT failed</b><br><span style="opacity:0.85">${err?.message || String(err)}</span>`, { sticky: true });
          }
        };

        recorder.start(250);
        active = true;
        setStatus('listening', 'recording… (release key or click again to stop)');
      },

      stop() {
        if (!active) return;
        try {
          recorder?.stop();
        } catch (_) {
          active = false;
          stopTracks();
        }
      },
    };
  }

  // Brave detection — Brave ships `webkitSpeechRecognition` but the
  // underlying Google STT call is blocked (privacy), so the native path
  // always errors with `network`. Pre-emptively use the server provider
  // so the first mic press actually transcribes instead of erroring.
  // navigator.brave.isBrave() returns a promise; resolve sync if possible.
  let _braveDetected = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.brave && typeof navigator.brave.isBrave === 'function') {
      // Fire-and-forget — if we get true back, install the provider for
      // subsequent presses. The first attempt may still hit native and
      // auto-swap via the error path below.
      navigator.brave.isBrave().then((isBrave) => {
        if (isBrave && !providerOverride) {
          const p = createServerSttProvider();
          if (p) {
            providerOverride = p;
            _braveDetected = true;
            console.log('[VoiceInput] Brave detected — using server STT provider (Whisper via /api/stt)');
          }
        }
      }).catch(() => { /* not brave, or detection failed; native path stays */ });
    }
  } catch (_) { /* best-effort */ }

  if (!supportsSpeechRecognition) {
    console.log('[VoiceInput] SpeechRecognition not available — trying server STT fallback');
    providerOverride = createServerSttProvider();
    if (!providerOverride) {
      const explainUnsupported = () => {
        const bits = [];
        if (!window.isSecureContext) {
          bits.push('This page is not a secure context. Use http://localhost:8080 or https.');
        }
        bits.push('SpeechRecognition unavailable and MediaRecorder fallback is not supported in this browser.');
        return bits.join(' ');
      };
      const renderUnsupportedBadge = () => {
        const badge = document.createElement('div');
        badge.id = 'denizen-mic-status';
        Object.assign(badge.style, {
          position: 'fixed', bottom: '14px', right: '14px', zIndex: 9998,
          background: 'rgba(0,0,0,0.92)', color: '#fdba74',
          font: '11px monospace', padding: '8px 10px', border: '1px solid #7c2d12',
          borderRadius: '6px', maxWidth: '360px', lineHeight: '1.4',
        });
        badge.textContent = `🎤 unavailable: ${explainUnsupported()}`;
        document.body.appendChild(badge);
      };
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', renderUnsupportedBadge);
      } else {
        renderUnsupportedBadge();
      }
    }
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
      // If the user clicked the mic, they obviously want the voice loop
      // active end-to-end. Auto-enable presence (the voice gate) the
      // first time so they don't sit there wondering why NPCs answer
      // silently. They can still Alt+V it off if they want.
      if (typeof window.DenizenSetPresence === 'function' && !window.DenizenPresence?.zionPresent) {
        try { window.DenizenSetPresence(true); } catch (_) {}
      }
      if (listening) stop(); else start();
    });
    document.body.appendChild(micButton);

    // Presence indicator — small chip above the mic showing 🔊 on / 🔇 off.
    // Click to toggle. Mirrored from window.DenizenPresence by voice-gate.js.
    const presenceChip = document.createElement('button');
    presenceChip.id = 'denizen-presence-chip';
    presenceChip.type = 'button';
    Object.assign(presenceChip.style, {
      position: 'fixed', bottom: '76px', right: '74px', zIndex: 9998,
      background: '#0f172a', color: '#cfe7ff', border: '1px solid #355',
      borderRadius: '14px', padding: '3px 9px', font: '11px monospace',
      cursor: 'pointer', display: 'none',
    });
    presenceChip.title = 'Voice output on/off (also toggle with Alt+V)';
    presenceChip.addEventListener('click', () => {
      if (typeof window.DenizenTogglePresence === 'function') window.DenizenTogglePresence();
    });
    document.body.appendChild(presenceChip);

    function refreshPresenceChip() {
      const on = !!window.DenizenPresence?.zionPresent;
      presenceChip.textContent = on ? '🔊 voice ON' : '🔇 voice OFF';
      presenceChip.style.background = on ? '#064e3b' : '#0f172a';
      presenceChip.style.borderColor = on ? '#34d399' : '#355';
      presenceChip.style.display = 'block';
    }
    // Poll cheaply — presence flips rarely and from many places (Alt+V,
    // /api/presence POST, voice-gate hotkey). One global isn't reliably
    // visible via property descriptors, so a 500ms poll is the simplest
    // correct approach.
    setInterval(refreshPresenceChip, 500);
    refreshPresenceChip();

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
  let _starting = false;

  async function ensureMicPermission() {
    if (!navigator?.mediaDevices?.getUserMedia) return true;
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch (err) {
      const name = err?.name || '';
      const blocked = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      const noMic = name === 'NotFoundError' || name === 'DevicesNotFoundError';
      if (blocked) {
        const { short, hint } = explainError('not-allowed');
        setMicState('error', `<b>${short}</b><br><span style="opacity:0.85">${hint}</span>`, { sticky: true });
      } else if (noMic) {
        const { short, hint } = explainError('audio-capture');
        setMicState('error', `<b>${short}</b><br><span style="opacity:0.85">${hint}</span>`, { sticky: true });
      } else {
        setMicState('error', `<b>🎤 mic preflight failed</b><br><span style="opacity:0.85">${err?.message || String(err)}</span>`, { sticky: true });
      }
      throw err;
    } finally {
      try { stream?.getTracks?.().forEach(t => t.stop()); } catch (_) {}
    }
  }

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
    if (!supportsSpeechRecognition) return null;
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

      // Auto-fallback: `network` (Brave blocks Google STT) and
      // `service-not-allowed` (some Chromium forks / locked-down enterprise
      // policy) both mean "native SR is structurally broken in this
      // browser". Try to swap in the server provider transparently so the
      // user's next mic press uses Whisper instead of erroring again.
      const isNativeBroken = (code === 'network' || code === 'service-not-allowed');
      if (isNativeBroken && !providerOverride) {
        const p = createServerSttProvider();
        if (p) {
          providerOverride = p;
          console.log('[VoiceInput] native SR error "' + code + '" — switching to server STT (Whisper via /api/stt)');
          setMicState(
            'idle',
            '<b>🔄 switched to server STT</b><br><span style="opacity:0.85">Browser native voice failed (' + code + '). Hold ' + hotkey + ' again to try Whisper.</span>',
            { sticky: false },
          );
          setTimeout(() => { if (!_errorSticky) setMicState('idle', ''); }, 6000);
          listening = false;
          return;
        }
      }

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

  async function start() {
    if (listening || _starting) return;
    _starting = true;
    if (providerOverride) {
      // External provider takes over (e.g. Whisper-via-server).
      try { await providerOverride.start(deliver, setMicState); listening = true; }
      catch (err) { console.warn('[VoiceInput] provider.start failed:', err?.message || err); }
      _starting = false;
      return;
    }
    try {
      await ensureMicPermission();
      const r = ensureRecognition();
      if (!r) {
        throw new Error('SpeechRecognition unavailable in this browser');
      }
      r.start();
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
    } finally {
      _starting = false;
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

    // PlayerChat exposes itself to globals once instantiated. Auto-open
    // the panel so the user can SEE "[NPC] is coming over…" /
    // "(no response)" / "No NPC found to talk to." system messages —
    // otherwise the only feedback is the speech bubble above an NPC
    // that might be off-screen, which the user reasonably interprets
    // as "nothing happened."
    if (window.__DenizenPlayerChat && typeof window.__DenizenPlayerChat.sendMessage === 'function') {
      try {
        // Auto-open the panel if it has an open() method and isn't already visible.
        const pc = window.__DenizenPlayerChat;
        if (!pc._visible && typeof pc.open === 'function') {
          try { pc.open(); } catch (_) {}
        }
        pc.sendMessage(text);
      } catch (err) {
        console.warn('[VoiceInput] sendMessage failed:', err?.message || err);
      }
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
    supported: supportsSpeechRecognition || !!providerOverride,
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
