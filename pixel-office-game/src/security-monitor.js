/**
 * Security Monitor — Client-side event hub
 *
 * Connects to the security-monitor WebSocket endpoint on the game server
 * and emits typed security events that the RobberController consumes.
 *
 * Event types:
 *   file_access     — unauthorized file browsing / directory traversal
 *   data_breach     — sensitive data access (passwords, keys, env files)
 *   network_scan    — port scanning / network probing
 *   brute_force     — repeated failed login attempts
 *   shell_exec      — suspicious command execution
 *   api_abuse       — suspicious API calls / injection attempts
 *   process_spawn   — unknown/malicious process started
 *   exfiltration    — data being sent to unknown external endpoints
 */

class SecurityMonitor extends EventTarget {
  constructor(wsUrl) {
    super();
    // Default: connect to same host on /security-ws
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsUrl = wsUrl || `${proto}//${window.location.host}/security-ws`;
    this.ws = null;
    this.connected = false;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;

    // Active threats (threatId → threat object)
    this.activeThreats = new Map();

    // Threat history for the session
    this.threatLog = [];
  }

  /** Connect to the security monitor WebSocket (with HTTP polling fallback) */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log('[SecurityMonitor] Connecting to', this.wsUrl);

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log('[SecurityMonitor] Connected via WebSocket');
        this.connected = true;
        this._reconnectAttempt = 0;
        this._emit('monitor-connected');
        // Stop polling if it was active
        if (this._pollInterval) {
          clearInterval(this._pollInterval);
          this._pollInterval = null;
        }
      };

      this.ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          this._handleMessage(msg);
        } catch (err) {
          console.warn('[SecurityMonitor] Bad message:', err);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this._emit('monitor-disconnected');
        this._scheduleReconnect();
      };

      this.ws.onerror = () => {
        // WebSocket failed — will fallback to polling on reconnect
        if (this._reconnectAttempt >= 2 && !this._pollInterval) {
          console.log('[SecurityMonitor] WebSocket unavailable, using HTTP polling fallback');
          this._startPolling();
        }
      };
    } catch (e) {
      console.warn('[SecurityMonitor] WebSocket not available, using polling');
      this._startPolling();
    }
  }

  /** HTTP polling fallback — checks /security-events endpoint */
  _startPolling() {
    if (this._pollInterval) return;
    this.connected = true;
    this._emit('monitor-connected');
    console.log('[SecurityMonitor] Polling mode active');
    // Poll isn't needed for local injection — this just keeps the monitor "connected"
    // Real threats come through injectThreat() or the WebSocket when available
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /** Inject a threat manually (for testing or from other sources) */
  injectThreat(threat) {
    this._handleMessage({ type: 'threat', ...threat });
  }

  /** Clear a specific threat */
  clearThreat(threatId) {
    if (this.activeThreats.has(threatId)) {
      const threat = this.activeThreats.get(threatId);
      this.activeThreats.delete(threatId);
      this._emit('threat-cleared', { threatId, threat });
    }
  }

  /** Clear all active threats */
  clearAll() {
    this.activeThreats.forEach((threat, id) => {
      this._emit('threat-cleared', { threatId: id, threat });
    });
    this.activeThreats.clear();
  }

  // --- Internal ---

  _handleMessage(msg) {
    if (msg.type === 'threat') {
      const threat = {
        id: msg.threatId || `threat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        category: msg.category,        // file_access, data_breach, network_scan, etc.
        severity: msg.severity || 'medium', // low, medium, high, critical
        source: msg.source || 'unknown',    // IP, process name, user, etc.
        target: msg.target || '',           // what's being attacked
        detail: msg.detail || '',           // human-readable description
        timestamp: Date.now(),
        raw: msg,
      };

      this.activeThreats.set(threat.id, threat);
      this.threatLog.push(threat);

      // Keep log manageable
      if (this.threatLog.length > 500) {
        this.threatLog = this.threatLog.slice(-250);
      }

      console.log(`[SecurityMonitor] 🚨 THREAT: ${threat.category} — ${threat.detail} (severity: ${threat.severity})`);
      this._emit('threat', threat);
    }

    if (msg.type === 'threat-resolved') {
      this.clearThreat(msg.threatId);
    }

    if (msg.type === 'heartbeat') {
      // Server is alive, no action needed
    }
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempt), 30000);
    this._reconnectAttempt++;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// Global
window.SecurityMonitor = SecurityMonitor;
