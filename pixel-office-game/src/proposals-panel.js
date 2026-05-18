/**
 * Proposals Panel — operator review UI for the proposal queues.
 *
 * Surfaces the unified GET /api/proposals feed (animation + SOUL +
 * capability) as cards with approve / reject buttons. Renders as a
 * fixed-position panel anchored bottom-right, with its own chip so the
 * operator can spot pending work without opening the existing diag
 * panel.
 *
 * Why a separate panel and not a tab inside diag.js?
 *   The diag panel is plain-text monospace by design (it's the "is the
 *   server alive" view). Proposal cards need click targets, expanded
 *   detail, kind badges. Mixing those in would force a rewrite of the
 *   diag widget for a different concern. Two adjacent chips keep each
 *   panel focused.
 *
 * Endpoints used:
 *   GET  /api/proposals?status=pending|approved|rejected|applied|all
 *   POST /api/<kind>-proposal/approve   { id, decision: 'approved'|'rejected' }
 *   POST /api/soul-proposal/apply       { id }      (feature-detected; may 404)
 *
 * Toggle:
 *   ?proposals=1  in the URL (auto-open)
 *   window.DenizenProposals.show() / hide() / toggle() / refresh()
 */
(function () {
  'use strict';

  const POLL_MS = 30000;
  const PROPOSALS_URL = '/api/proposals';
  const DISPLAY_CAP = 30;

  const KIND_COLORS = {
    animation: { bg: '#3b0764', border: '#a78bfa', label: '#ddd6fe' }, // purple
    soul:      { bg: '#082f49', border: '#7dd3fc', label: '#bae6fd' }, // blue
    capability:{ bg: '#7c2d12', border: '#fdba74', label: '#fed7aa' }, // orange
  };

  let chip = null;
  let panel = null;
  let panelOpen = false;
  let statusFilter = 'pending';
  let lastFeed = { proposals: [], total: 0 };
  let pollTimer = null;
  let soulApplyAvailable = null; // null = unknown, true/false after probe
  let expandedIds = new Set();

  function relativeTime(ms) {
    if (!ms || !Number.isFinite(ms)) return '?';
    const diff = Date.now() - ms;
    if (diff < 0) return 'in the future';
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function htmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Endpoint probe for the optional SOUL apply endpoint ----
  // The brief notes /api/soul-proposal/apply may or may not exist on
  // master (parallel agent). HEAD-probe once; if 404 or any error, hide
  // the Apply button entirely.
  async function probeSoulApply() {
    if (soulApplyAvailable !== null) return soulApplyAvailable;
    try {
      // POST with an obviously-bogus id. If the endpoint exists it'll
      // 400/404 on the id; if it doesn't exist server returns 404 on the
      // route. We treat "any response we can parse" as "endpoint exists"
      // EXCEPT when the JSON 404 looks like a plain route miss.
      const res = await fetch('/api/soul-proposal/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '__probe__' }),
      });
      // If the route doesn't exist, our server's catch-all responds with
      // a non-JSON 404. If it does exist, even a "proposal not found"
      // returns JSON. Distinguish by content-type + status.
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (res.status === 404 && !ctype.includes('json')) {
        soulApplyAvailable = false;
      } else {
        soulApplyAvailable = true;
      }
    } catch (_) {
      soulApplyAvailable = false;
    }
    return soulApplyAvailable;
  }

  // ---- UI scaffolding ----
  function buildUI() {
    if (chip) return;

    chip = document.createElement('button');
    chip.id = 'denizen-proposals-chip';
    chip.type = 'button';
    Object.assign(chip.style, {
      position: 'fixed', bottom: '14px', right: '14px', zIndex: 9997,
      background: '#0f172a', color: '#cfe7ff',
      border: '1px solid #355', borderRadius: '14px',
      padding: '4px 10px', font: '11px monospace',
      cursor: 'pointer', maxWidth: '300px',
    });
    chip.title = 'Click to review NPC proposals';
    chip.textContent = '📋 proposals';
    chip.addEventListener('click', togglePanel);
    document.body.appendChild(chip);

    panel = document.createElement('div');
    panel.id = 'denizen-proposals-panel';
    Object.assign(panel.style, {
      position: 'fixed', bottom: '46px', right: '14px', zIndex: 9997,
      background: 'rgba(2,6,23,0.96)', color: '#cfe7ff',
      border: '1px solid #355', borderRadius: '6px',
      padding: '10px 12px', font: '11px monospace', lineHeight: '1.4',
      width: '440px', maxHeight: '70vh', overflowY: 'auto',
      display: 'none',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
    });
    document.body.appendChild(panel);
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    if (panel) panel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) {
      refresh();
    }
  }

  function setChipState(pendingCount) {
    if (!chip) return;
    if (pendingCount > 0) {
      chip.style.background = '#713f12';
      chip.style.borderColor = '#facc15';
      chip.textContent = `📋 ${pendingCount} pending`;
    } else {
      chip.style.background = '#0f172a';
      chip.style.borderColor = '#355';
      chip.textContent = '📋 proposals';
    }
  }

  // ---- Data fetch + render ----
  async function fetchFeed(status) {
    try {
      const url = `${PROPOSALS_URL}?status=${encodeURIComponent(status)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      lastFeed = {
        proposals: Array.isArray(json.proposals) ? json.proposals : [],
        total: Number(json.total) || (Array.isArray(json.proposals) ? json.proposals.length : 0),
      };
    } catch (err) {
      lastFeed = { proposals: [], total: 0, error: err.message || String(err) };
    }
  }

  // Pending count is what drives the chip color — fetch it on every
  // refresh in addition to whatever filter the user has open, so the
  // chip stays accurate regardless of which tab is selected.
  async function fetchPendingCount() {
    if (statusFilter === 'pending') {
      return lastFeed.proposals.filter(p => p.status === 'pending').length;
    }
    try {
      const res = await fetch(`${PROPOSALS_URL}?status=pending`, { cache: 'no-store' });
      if (!res.ok) return 0;
      const json = await res.json();
      const arr = Array.isArray(json.proposals) ? json.proposals : [];
      return arr.length;
    } catch (_) {
      return 0;
    }
  }

  async function refresh() {
    await fetchFeed(statusFilter);
    const pendingCount = await fetchPendingCount();
    setChipState(pendingCount);
    if (panelOpen) renderPanel();
  }

  function renderPanel() {
    if (!panel) return;

    const filterButtons = ['all', 'pending', 'approved', 'rejected', 'applied'].map(s => {
      const active = s === statusFilter;
      const bg = active ? '#1e3a8a' : '#1e293b';
      const border = active ? '#60a5fa' : '#334155';
      return `<button data-filter="${s}" style="background:${bg};color:#cfe7ff;border:1px solid ${border};border-radius:3px;padding:2px 8px;font:10px monospace;cursor:pointer;margin-right:4px;">${s}</button>`;
    }).join('');

    const refreshBtn = `<button data-action="refresh" style="background:#1e293b;color:#cfe7ff;border:1px solid #334155;border-radius:3px;padding:2px 8px;font:10px monospace;cursor:pointer;float:right;">refresh</button>`;

    const header = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #355;padding-bottom:6px;margin-bottom:8px;">
        <strong style="color:#f1f5f9;">PROPOSALS REVIEW</strong>
        ${refreshBtn}
      </div>
      <div style="margin-bottom:8px;">${filterButtons}</div>
    `;

    const all = lastFeed.proposals || [];
    const truncated = all.length > DISPLAY_CAP;
    const shown = all.slice(0, DISPLAY_CAP);

    let body = '';
    if (lastFeed.error) {
      body = `<div style="color:#fca5a5;padding:8px 0;">error: ${htmlEscape(lastFeed.error)}</div>`;
    } else if (shown.length === 0) {
      body = `<div style="color:#94a3b8;padding:8px 0;font-style:italic;">no ${htmlEscape(statusFilter)} proposals</div>`;
    } else {
      body = shown.map(renderCard).join('');
    }

    let footer = '';
    if (truncated) {
      footer = `<div style="color:#fbbf24;padding:8px 0 0;font-style:italic;">showing ${DISPLAY_CAP} of ${all.length} — refine filter</div>`;
    } else if (shown.length > 0) {
      footer = `<div style="color:#64748b;padding:8px 0 0;">${shown.length} shown · auto-refresh ${POLL_MS / 1000}s</div>`;
    }

    panel.innerHTML = header + body + footer;

    // Wire up filter buttons.
    panel.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        statusFilter = btn.getAttribute('data-filter');
        refresh();
      });
    });
    panel.querySelectorAll('button[data-action="refresh"]').forEach(btn => {
      btn.addEventListener('click', refresh);
    });

    // Wire up per-card actions.
    panel.querySelectorAll('[data-card]').forEach(card => {
      const id = card.getAttribute('data-card');
      const kind = card.getAttribute('data-kind');
      card.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const act = btn.getAttribute('data-act');
          if (act === 'approve') decide(kind, id, 'approved');
          else if (act === 'reject') decide(kind, id, 'rejected');
          else if (act === 'apply') applySoul(id);
          else if (act === 'toggle') {
            if (expandedIds.has(id)) expandedIds.delete(id);
            else expandedIds.add(id);
            renderPanel();
          }
        });
      });
    });
  }

  function renderCard(p) {
    const colors = KIND_COLORS[p.kind] || { bg: '#1e293b', border: '#475569', label: '#cbd5e1' };
    const expanded = expandedIds.has(p.id);
    const ts = relativeTime(p.ts);
    const statusColor = ({
      pending: '#fbbf24',
      approved: '#34d399',
      rejected: '#f87171',
      applied: '#a78bfa',
    })[p.status] || '#94a3b8';

    const actions = [];
    if (p.status === 'pending') {
      actions.push(`<button data-act="approve" style="background:#065f46;color:#d1fae5;border:1px solid #34d399;border-radius:3px;padding:2px 8px;font:10px monospace;cursor:pointer;margin-right:4px;">approve</button>`);
      actions.push(`<button data-act="reject" style="background:#7f1d1d;color:#fecaca;border:1px solid #f87171;border-radius:3px;padding:2px 8px;font:10px monospace;cursor:pointer;margin-right:4px;">reject</button>`);
    }
    if (p.kind === 'soul' && p.status === 'approved' && soulApplyAvailable) {
      actions.push(`<button data-act="apply" style="background:#3b0764;color:#ede9fe;border:1px solid #a78bfa;border-radius:3px;padding:2px 8px;font:10px monospace;cursor:pointer;margin-right:4px;">apply</button>`);
    }
    actions.push(`<button data-act="toggle" style="background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:3px;padding:2px 8px;font:10px monospace;cursor:pointer;">${expanded ? 'hide' : 'details'}</button>`);

    let detail = '';
    if (expanded) {
      const json = htmlEscape(JSON.stringify(p.raw, null, 2));
      detail = `<pre style="background:#020617;color:#cbd5e1;border:1px solid #334155;border-radius:3px;padding:6px;margin:6px 0 0;font:10px monospace;white-space:pre-wrap;overflow-x:auto;max-height:200px;overflow-y:auto;">${json}</pre>`;
    }

    return `
      <div data-card="${htmlEscape(p.id)}" data-kind="${htmlEscape(p.kind)}" style="border:1px solid #334155;border-radius:4px;padding:8px;margin-bottom:8px;background:rgba(15,23,42,0.6);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="background:${colors.bg};color:${colors.label};border:1px solid ${colors.border};border-radius:3px;padding:1px 6px;font:10px monospace;">${htmlEscape(p.kind)}</span>
          <span style="color:#f1f5f9;flex:1;">${htmlEscape(p.by || '?')}</span>
          <span style="color:${statusColor};font:10px monospace;">${htmlEscape(p.status || '?')}</span>
          <span style="color:#64748b;font:10px monospace;">${htmlEscape(ts)}</span>
        </div>
        <div style="color:#e2e8f0;margin-bottom:6px;">${htmlEscape(p.summary || '(no summary)')}</div>
        <div>${actions.join('')}</div>
        ${detail}
      </div>
    `;
  }

  // ---- Actions ----
  async function decide(kind, id, decision) {
    try {
      const res = await fetch(`/api/${encodeURIComponent(kind)}-proposal/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[Proposals] ${kind} ${decision} failed: HTTP ${res.status} ${text}`);
        flash(`${decision} failed: HTTP ${res.status}`, true);
        return;
      }
      flash(`${kind} ${decision}`, false);
    } catch (err) {
      console.warn(`[Proposals] ${kind} ${decision} threw:`, err);
      flash(`${decision} threw: ${err.message || err}`, true);
    }
    await refresh();
  }

  async function applySoul(id) {
    if (!soulApplyAvailable) {
      flash('apply endpoint not available', true);
      return;
    }
    try {
      const res = await fetch('/api/soul-proposal/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[Proposals] soul apply failed: HTTP ${res.status} ${text}`);
        flash(`apply failed: HTTP ${res.status}`, true);
        return;
      }
      flash('soul applied', false);
    } catch (err) {
      flash(`apply threw: ${err.message || err}`, true);
    }
    await refresh();
  }

  function flash(msg, isError) {
    if (!chip) return;
    const prevText = chip.textContent;
    const prevBg = chip.style.background;
    const prevBorder = chip.style.borderColor;
    chip.textContent = (isError ? '⚠ ' : '✓ ') + msg;
    chip.style.background = isError ? '#7f1d1d' : '#065f46';
    chip.style.borderColor = isError ? '#fca5a5' : '#34d399';
    setTimeout(() => {
      chip.textContent = prevText;
      chip.style.background = prevBg;
      chip.style.borderColor = prevBorder;
    }, 2000);
  }

  // ---- Lifecycle ----
  async function init() {
    buildUI();
    await probeSoulApply();
    await refresh();
    pollTimer = setInterval(refresh, POLL_MS);

    try {
      const auto = new URL(window.location.href).searchParams.get('proposals');
      if (auto === '1' || auto === 'open') {
        panelOpen = true;
        if (panel) panel.style.display = 'block';
        renderPanel();
      }
    } catch (_) {}
    console.log('[Proposals] operator review panel ready (bottom-right chip)');
  }

  window.DenizenProposals = {
    show() { panelOpen = true; if (panel) panel.style.display = 'block'; renderPanel(); },
    hide() { panelOpen = false; if (panel) panel.style.display = 'none'; },
    toggle: togglePanel,
    refresh,
    setFilter(s) { statusFilter = String(s || 'pending'); refresh(); },
    feed: () => lastFeed,
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
