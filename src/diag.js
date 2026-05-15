/**
 * Diag — small live diagnostics widget bottom-left.
 *
 * Polls /api/health every 5s and surfaces:
 *   - LM Studio reachability (the #1 reason NPCs walk over but don't respond)
 *   - Provider count + names
 *   - Recent provider errors (capped at 5, with timestamps)
 *   - WebSocket connection state
 *
 * Click the chip to expand into a fuller panel. The whole thing exists
 * because debugging the voice loop previously required the user to look
 * at the server terminal — which non-technical users don't have.
 *
 * Toggle visibility via:
 *   ?diag=1   in the URL (auto-show on load)
 *   window.DenizenDiag.show() / hide() / toggle()
 *   The chip itself is always rendered; the expanded panel toggles.
 */
(function () {
  'use strict';

  const POLL_MS = 5000;
  const HEALTH_URL = '/api/health';

  let chip = null;
  let panel = null;
  let lastSnapshot = null;
  let panelOpen = false;

  // ---- UI ----
  function buildUI() {
    if (chip) return;

    chip = document.createElement('button');
    chip.id = 'denizen-diag-chip';
    chip.type = 'button';
    Object.assign(chip.style, {
      position: 'fixed', bottom: '14px', left: '14px', zIndex: 9997,
      background: '#0f172a', color: '#cfe7ff',
      border: '1px solid #355', borderRadius: '14px',
      padding: '4px 10px', font: '11px monospace',
      cursor: 'pointer', maxWidth: '300px',
    });
    chip.title = 'Click to expand office diagnostics';
    chip.textContent = '⋯ diag';
    chip.addEventListener('click', togglePanel);
    document.body.appendChild(chip);

    panel = document.createElement('div');
    panel.id = 'denizen-diag-panel';
    Object.assign(panel.style, {
      position: 'fixed', bottom: '46px', left: '14px', zIndex: 9997,
      background: 'rgba(2,6,23,0.96)', color: '#cfe7ff',
      border: '1px solid #355', borderRadius: '6px',
      padding: '10px 12px', font: '11px monospace', lineHeight: '1.5',
      maxWidth: '420px', display: 'none', whiteSpace: 'pre-wrap',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
    });
    document.body.appendChild(panel);
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    if (panel) panel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) renderPanel();
  }

  function setChip(state, label) {
    if (!chip) return;
    const styles = {
      green:  { bg: '#064e3b', border: '#34d399' },
      yellow: { bg: '#713f12', border: '#facc15' },
      red:    { bg: '#7f1d1d', border: '#fca5a5' },
      gray:   { bg: '#0f172a', border: '#355'    },
    };
    const s = styles[state] || styles.gray;
    chip.style.background = s.bg;
    chip.style.borderColor = s.border;
    chip.textContent = label;
  }

  function renderChip(snap) {
    if (!snap) { setChip('gray', '⋯ no health'); return; }
    const lm = snap.lmStudio || {};
    const remoteProviders = (snap.providers || []).filter(p => p.type !== 'lmstudio');
    const haveAnyBrain = lm.reachable || remoteProviders.length > 0;
    const recent = (snap.recentErrors || []);
    if (!haveAnyBrain) {
      setChip('red', '🔴 no brain — start LM Studio');
    } else if (recent.length > 0) {
      setChip('yellow', `⚠️ ${recent.length} recent error${recent.length === 1 ? '' : 's'}`);
    } else if (lm.reachable) {
      setChip('green', '🟢 office healthy');
    } else {
      setChip('green', `🟢 ${remoteProviders.length} provider${remoteProviders.length === 1 ? '' : 's'} ready`);
    }
  }

  function renderPanel() {
    if (!panel) return;
    const snap = lastSnapshot;
    if (!snap) {
      panel.textContent = '(fetching /api/health…)';
      return;
    }
    const lm = snap.lmStudio || {};
    const lines = [];
    lines.push('━━━ OFFICE DIAGNOSTICS ━━━');
    lines.push('');
    lines.push(`LM Studio:  ${lm.reachable ? '🟢 reachable' : '🔴 unreachable'}`);
    lines.push(`   url:    ${lm.url || '(unset)'}`);
    if (lm.model) lines.push(`   model:  ${lm.model}`);
    if (lm.probedPath) lines.push(`   probed: ${lm.probedPath}`);
    if (lm.warning) lines.push(`   ⚠️ ${lm.warning}`);
    if (lm.error) lines.push(`   error:  ${lm.error}`);
    if (!lm.reachable) {
      lines.push('   fix:    open LM Studio → load a model → Developer → Start Server');
    }
    lines.push('');
    lines.push(`Providers:  ${(snap.providers || []).length} configured${snap.demoMode ? ' (demo mode)' : ''}`);
    for (const p of (snap.providers || [])) {
      lines.push(`   ${p.type === 'lmstudio' ? '🖥' : '☁'} ${p.name} (${p.model || p.type})`);
    }
    lines.push('');
    lines.push(`WS clients: agent=${snap.wsClients?.agent ?? '?'}, security=${snap.wsClients?.security ?? '?'}`);
    lines.push('');
    const st = snap.stats || {};
    lines.push('Brain calls (since server start):');
    lines.push(`   player chat: ${st.playerChatReceived || 0} received, ${st.playerChatSucceeded || 0} ok, ${st.playerChatFailed || 0} failed`);
    lines.push(`   npc ↔ npc:   ${st.npcConvReceived || 0} received, ${st.npcConvSucceeded || 0} ok, ${st.npcConvFailed || 0} failed`);
    if (st.lastPlayerChatAt) {
      const ago = Math.round((Date.now() - st.lastPlayerChatAt) / 1000);
      lines.push(`   last player message: ${ago}s ago`);
    } else {
      lines.push(`   last player message: never (no /player_chat msg has reached the server)`);
    }
    lines.push('');
    const errs = snap.recentErrors || [];
    if (errs.length === 0) {
      lines.push('Recent errors: (none — looking good)');
    } else {
      lines.push(`Recent errors (${errs.length}):`);
      for (const e of errs.slice(-5)) {
        const when = new Date(e.ts).toLocaleTimeString();
        lines.push(`   [${when}] ${e.message}`);
      }
    }
    lines.push('');
    lines.push(`(updated ${new Date(snap.ts).toLocaleTimeString()} — re-polling every ${POLL_MS / 1000}s)`);
    panel.textContent = lines.join('\n');
  }

  // ---- Polling ----
  async function pollOnce() {
    try {
      const res = await fetch(HEALTH_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastSnapshot = await res.json();
    } catch (err) {
      lastSnapshot = {
        ts: Date.now(),
        lmStudio: { reachable: false, url: '?', error: err?.message || String(err) },
        providers: [],
        wsClients: {}, recentErrors: [{ ts: Date.now(), message: `health fetch failed: ${err?.message || err}` }],
      };
    }
    renderChip(lastSnapshot);
    if (panelOpen) renderPanel();
  }

  function init() {
    buildUI();
    pollOnce();
    setInterval(pollOnce, POLL_MS);
    try {
      const auto = new URL(window.location.href).searchParams.get('diag');
      if (auto === '1' || auto === 'open') {
        panelOpen = true;
        if (panel) panel.style.display = 'block';
        renderPanel();
      }
    } catch (_) {}
    console.log('[Diag] live office diagnostics ready (bottom-left chip)');
  }

  window.DenizenDiag = {
    show() { panelOpen = true; if (panel) panel.style.display = 'block'; renderPanel(); },
    hide() { panelOpen = false; if (panel) panel.style.display = 'none'; },
    toggle: togglePanel,
    snapshot: () => lastSnapshot,
    refresh: pollOnce,
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
