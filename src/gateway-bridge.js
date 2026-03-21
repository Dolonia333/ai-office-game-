/**
 * OpenClaw Gateway Bridge
 * Connects the pixel office game to OpenClaw's WebSocket gateway
 * so AI agent events can drive NPC behavior in the game.
 */

const GATEWAY_URL = 'ws://localhost:18789';
const PROTOCOL_VERSION = 3;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

class GatewayBridge extends EventTarget {
  constructor(url = GATEWAY_URL) {
    super();
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.helloOk = null;
    this._reqId = 0;
    this._pendingRequests = new Map();
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._seq = 0;
  }

  /** Connect to the gateway */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log('[GatewayBridge] Connecting to', this.url);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[GatewayBridge] WebSocket open, sending connect handshake...');
      this._reconnectAttempt = 0;
      this._sendConnect();
    };

    this.ws.onmessage = (evt) => {
      try {
        const frame = JSON.parse(evt.data);
        this._handleFrame(frame);
      } catch (err) {
        console.warn('[GatewayBridge] Failed to parse frame:', err);
      }
    };

    this.ws.onclose = (evt) => {
      console.log('[GatewayBridge] WebSocket closed:', evt.code, evt.reason);
      this.connected = false;
      this._emit('disconnected', { code: evt.code, reason: evt.reason });
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('[GatewayBridge] WebSocket error:', err);
    };
  }

  /** Disconnect and stop reconnecting */
  disconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /** Send a request frame and return a promise for the response */
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = `bridge-${++this._reqId}`;
      const frame = { type: 'req', id, method, params };
      this._pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(frame));
    });
  }

  // --- Internal ---

  _sendConnect() {
    const params = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: 'webchat-ui',
        displayName: 'Pixel Office Game',
        version: '1.0.0',
        platform: 'browser',
        mode: 'webchat',
      },
      caps: [],
      auth: {
        token: 'test-token-12345',
      },
    };

    this.request('connect', params)
      .then((helloOk) => {
        console.log('[GatewayBridge] Connected! Server:', helloOk.server?.version);
        this.connected = true;
        this.helloOk = helloOk;
        this._emit('connected', helloOk);
      })
      .catch((err) => {
        console.error('[GatewayBridge] Connect handshake failed:', err);
      });
  }

  _handleFrame(frame) {
    // Response to a request
    if (frame.type === 'res') {
      const pending = this._pendingRequests.get(frame.id);
      if (pending) {
        this._pendingRequests.delete(frame.id);
        if (frame.error) {
          pending.reject(frame.error);
        } else {
          pending.resolve(frame.payload ?? frame);
        }
      }
      return;
    }

    // hello-ok is also a response to connect
    if (frame.type === 'hello-ok') {
      const pending = this._pendingRequests.get(frame._reqId);
      if (pending) {
        this._pendingRequests.delete(frame._reqId);
        pending.resolve(frame);
      }
      return;
    }

    // Event frame from gateway
    if (frame.type === 'event') {
      if (frame.seq != null) {
        this._seq = frame.seq;
      }
      this._handleEvent(frame.event, frame.payload);
      return;
    }

    // connect.challenge — re-send connect with nonce
    if (frame.event === 'connect.challenge') {
      console.log('[GatewayBridge] Received connect challenge');
      this._sendConnect();
      return;
    }
  }

  _handleEvent(eventName, payload) {
    // Emit typed events for the NPC controller to consume
    this._emit(eventName, payload);

    // Also emit a catch-all for debugging
    this._emit('gateway-event', { event: eventName, payload });
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt),
      RECONNECT_MAX_MS
    );
    this._reconnectAttempt++;
    console.log(`[GatewayBridge] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// Export as global for use by office-scene.js
window.GatewayBridge = GatewayBridge;
