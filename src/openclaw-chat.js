/**
 * OpenClaw UI Panel
 * Press C to toggle the full OpenClaw UI embedded in the game via iframe.
 * Proxied through the game server to bypass iframe restrictions.
 * Injects CSS overrides to hide nav/topbar and make chat fill the panel.
 */

class OpenClawChat {
  constructor(bridge) {
    this.bridge = bridge;
    this.visible = false;
    this._panel = null;
    this._iframe = null;
    this._injected = false;
    this._sessionsOpen = false;
    // Use the proxy path on the same origin so iframe works
    this._uiUrl = '/openclaw/?token=test-token-12345';
    this._buildUI();
  }

  toggle() {
    this.visible = !this.visible;
    this._panel.style.display = this.visible ? 'flex' : 'none';
    if (this.visible && !this._iframe.src) {
      // Patch localStorage BEFORE loading the iframe so the UI starts with history closed
      this._patchSettings();
      this._iframe.src = this._uiUrl;
    }
  }

  /** Patch OpenClaw UI settings in localStorage before iframe loads */
  _patchSettings() {
    try {
      const KEY = 'openclaw.control.settings.v1';
      const raw = localStorage.getItem(KEY);
      const settings = raw ? JSON.parse(raw) : {};
      settings.chatHistoryOpen = false;
      settings.navCollapsed = true;
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (e) { /* ignore */ }
  }

  /** Toggle the sessions/conversations sidebar inside the iframe */
  toggleSessions() {
    this._sessionsOpen = !this._sessionsOpen;
    try {
      const doc = this._iframe?.contentDocument;
      if (!doc) return;
      const chatLayout = doc.querySelector('.chat-layout');
      if (chatLayout) {
        chatLayout.classList.toggle('game-show-sessions', this._sessionsOpen);
      }
    } catch (e) {
      console.warn('[OpenClawChat] toggleSessions error:', e);
    }
    const btn = this._panel.querySelector('#openclaw-ui-sessions');
    if (btn) btn.classList.toggle('active', this._sessionsOpen);
  }

  /** Start a new chat session inside the iframe */
  newSession() {
    const iframeWin = this._iframe?.contentWindow;
    if (!iframeWin) return;
    // Find the app element and trigger /new
    const app = iframeWin.document.querySelector('openclaw-app');
    if (app && app.state) {
      app.state.handleSendChat('/new', { restoreDraft: true });
    }
  }

  /** Inject CSS overrides into the iframe to hide nav/topbar for game embed */
  _injectIframeStyles() {
    if (this._injected) return;
    const doc = this._iframe?.contentDocument;
    if (!doc || !doc.head) return;

    const style = doc.createElement('style');
    style.id = 'game-embed-overrides';
    style.textContent = `
      /* ── Hide topbar and nav for game embed ── */
      .topbar { display: none !important; }
      .nav { display: none !important; }

      /* ── Make shell single-column, content fills all space ── */
      .shell {
        display: flex !important;
        flex-direction: column !important;
        height: 100vh !important;
      }

      /* ── Content fills remaining space ── */
      .content {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        padding: 0 !important;
        gap: 0 !important;
        overflow: hidden !important;
      }

      /* ── Hide content header (page title) ── */
      .content-header {
        display: none !important;
      }

      /* ── Chat layout fills space, flex column for thread + compose ── */
      .chat-layout {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        position: relative !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }

      /* Split container takes remaining space */
      .chat-split-container {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }
      .chat-main {
        height: 100% !important;
        overflow: hidden !important;
      }
      .chat-thread {
        overflow-y: auto !important;
        max-height: 100% !important;
      }

      /* ── Sessions sidebar as overlay, hidden by default ── */
      .chat-session-sidebar {
        position: absolute !important;
        left: 0; top: 0; bottom: 0;
        width: 300px !important;
        z-index: 100;
        background: var(--bg, #0f172a) !important;
        box-shadow: 4px 0 16px rgba(0,0,0,0.6);
        transform: translateX(-100%) !important;
        transition: transform 0.25s ease !important;
      }
      .chat-layout.game-show-sessions .chat-session-sidebar {
        transform: translateX(0) !important;
      }

      /* Backdrop when sessions open */
      .chat-layout.game-show-sessions::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 99;
        background: rgba(0,0,0,0.3);
      }

      /* Hide the edge swipe zone (we use our own toggle button) */
      .chat-history-edge {
        display: none !important;
      }

      /* ── Chat card fills available space ── */
      .card.chat {
        border: none !important;
        border-radius: 0 !important;
        flex: 1;
        min-height: 0;
      }

      /* ── Compact compose area pinned at bottom ── */
      .chat-compose {
        flex-shrink: 0 !important;
        padding: 8px !important;
        position: relative !important;
        background: var(--bg, #0f172a) !important;
      }
      .chat-compose__row {
        gap: 6px !important;
      }
      .chat-compose textarea {
        font-size: 13px !important;
        min-height: 36px !important;
        max-height: 120px !important;
      }

      /* ── Hide voice/upload buttons to save space ── */
      .chat-compose__tools {
        display: none !important;
      }

      /* ── Compact message bubbles ── */
      .chat-thread {
        padding: 8px !important;
      }
    `;
    doc.head.appendChild(style);
    this._injected = true;
  }

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      #openclaw-ui-panel {
        position: fixed;
        right: 0;
        top: 0;
        width: 420px;
        height: 100vh;
        background: #0f172a;
        border-left: 2px solid #334155;
        display: none;
        flex-direction: column;
        z-index: 100000;
        box-shadow: -4px 0 24px rgba(0,0,0,0.5);
      }
      #openclaw-ui-header {
        padding: 6px 12px;
        background: #1e293b;
        border-bottom: 1px solid #334155;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        flex-shrink: 0;
      }
      #openclaw-ui-header .title {
        color: #4ade80;
        font-weight: bold;
      }
      #openclaw-ui-header .actions {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      #openclaw-ui-header button {
        background: none;
        border: 1px solid #475569;
        color: #94a3b8;
        cursor: pointer;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 3px;
        font-family: inherit;
      }
      #openclaw-ui-header button:hover { color: #e2e8f0; border-color: #64748b; }
      #openclaw-ui-header button.active {
        color: #4ade80;
        border-color: #4ade80;
        background: rgba(74, 222, 128, 0.1);
      }
      .close-btn { border: none !important; font-size: 18px !important; padding: 0 4px !important; }
      .close-btn:hover { color: #f87171 !important; }
      #openclaw-ui-iframe {
        flex: 1;
        border: none;
        background: #020617;
        width: 100%;
        min-height: 0;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'openclaw-ui-panel';
    panel.innerHTML = `
      <div id="openclaw-ui-header">
        <span class="title">OpenClaw</span>
        <div class="actions">
          <button id="openclaw-ui-sessions" title="Toggle sessions">Sessions</button>
          <button id="openclaw-ui-new" title="New chat">+ New</button>
          <button id="openclaw-ui-newtab" title="Open in new tab">Pop Out</button>
          <button id="openclaw-ui-close" class="close-btn" title="Close panel">&times;</button>
        </div>
      </div>
      <iframe id="openclaw-ui-iframe"></iframe>
    `;
    document.body.appendChild(panel);

    this._panel = panel;
    this._iframe = panel.querySelector('#openclaw-ui-iframe');

    // Inject styles once iframe loads
    this._iframe.addEventListener('load', () => {
      // Small delay to let the Lit app render
      setTimeout(() => this._injectIframeStyles(), 300);
      // Retry in case it wasn't ready
      setTimeout(() => this._injectIframeStyles(), 1000);
    });

    panel.querySelector('#openclaw-ui-close').addEventListener('click', () => this.toggle());
    panel.querySelector('#openclaw-ui-sessions').addEventListener('click', () => this.toggleSessions());
    panel.querySelector('#openclaw-ui-new').addEventListener('click', () => this.newSession());
    panel.querySelector('#openclaw-ui-newtab').addEventListener('click', () => {
      window.open('http://localhost:18789/?token=test-token-12345', '_blank');
    });

    // Block game input while interacting with the panel
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
}

window.OpenClawChat = OpenClawChat;
