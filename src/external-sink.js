'use strict';
/**
 * ExternalSink — forwards interesting world-state events to one or more
 * outbound HTTP webhooks (Supabase Edge Functions, n8n, Discord, anything
 * that takes a POST).
 *
 * Why this lives outside server.js:
 *   - server.js is already long enough; this is self-contained.
 *   - The fan-out logic needs back-pressure, retries, and per-sink filters,
 *     which deserve their own surface.
 *   - Tests can stub the http request without spinning up an HTTP server.
 *
 * Configuration (env vars — pick any subset):
 *   SUPABASE_WEBHOOK_URL   POST destination, e.g. https://abc.supabase.co/functions/v1/denizen-events
 *   SUPABASE_WEBHOOK_KEY   Sent as Authorization: Bearer <key>
 *   N8N_WEBHOOK_URL        Same shape, but n8n
 *   N8N_WEBHOOK_KEY        Sent as Authorization: Bearer <key>
 *   EXTERNAL_SINK_KINDS    Comma-sep filter, default "task,threat,event,environment"
 *                           (npc state churn is excluded by default — too noisy)
 *   EXTERNAL_SINK_TIMEOUT  ms, default 4000
 *
 * Payload shape sent to each webhook:
 *   { source: "denizen", kind, payload, ts }
 *
 * Failure handling: failures log a single warning and back off — we do NOT
 * crash the host server. A run of consecutive failures (>5) for one sink
 * silently disables it until process restart, to avoid hammering a dead
 * webhook every 500ms.
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const DEFAULT_KINDS = new Set(['task', 'threat', 'threat-cleared', 'event', 'environment', 'presence']);
const FAIL_DISABLE_THRESHOLD = 5;

class ExternalSink {
  constructor({ worldState, env = process.env } = {}) {
    this.worldState = worldState;
    this.env = env;
    this.sinks = this._loadSinks();
    this.kindFilter = this._parseKindFilter(env.EXTERNAL_SINK_KINDS);
    this.timeoutMs = parseInt(env.EXTERNAL_SINK_TIMEOUT, 10) || 4000;
    this._bound = null;
  }

  _loadSinks() {
    const out = [];
    if (this.env.SUPABASE_WEBHOOK_URL) {
      out.push({
        name: 'supabase',
        url: this.env.SUPABASE_WEBHOOK_URL,
        authHeader: this.env.SUPABASE_WEBHOOK_KEY ? `Bearer ${this.env.SUPABASE_WEBHOOK_KEY}` : null,
        failCount: 0,
        disabled: false,
      });
    }
    if (this.env.N8N_WEBHOOK_URL) {
      out.push({
        name: 'n8n',
        url: this.env.N8N_WEBHOOK_URL,
        authHeader: this.env.N8N_WEBHOOK_KEY ? `Bearer ${this.env.N8N_WEBHOOK_KEY}` : null,
        failCount: 0,
        disabled: false,
      });
    }
    return out;
  }

  _parseKindFilter(raw) {
    if (!raw) return DEFAULT_KINDS;
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  }

  /** Subscribe to worldState changes. Idempotent. */
  attach() {
    if (this._bound || !this.worldState) return;
    if (this.sinks.length === 0) return; // no env vars set; nothing to do
    this._bound = ({ kind, payload }) => this._dispatch(kind, payload);
    this.worldState.on('change', this._bound);
    console.log(`[ExternalSink] attached. sinks=${this.sinks.map(s => s.name).join(',')} kinds=${[...this.kindFilter].join(',')}`);
  }

  /** Detach (test helper / graceful shutdown). */
  detach() {
    if (!this._bound || !this.worldState) return;
    this.worldState.off('change', this._bound);
    this._bound = null;
  }

  _dispatch(kind, payload) {
    if (!this.kindFilter.has(kind)) return;
    const body = JSON.stringify({ source: 'denizen', kind, payload, ts: Date.now() });
    for (const sink of this.sinks) {
      if (sink.disabled) continue;
      this._post(sink, body).catch(() => { /* errors already logged */ });
    }
  }

  _post(sink, body) {
    return new Promise((resolve) => {
      let parsed;
      try { parsed = new URL(sink.url); } catch (err) {
        sink.disabled = true;
        console.warn(`[ExternalSink] ${sink.name}: invalid URL, disabling`);
        return resolve();
      }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Denizen/1.0',
          ...(sink.authHeader ? { Authorization: sink.authHeader } : {}),
        },
        timeout: this.timeoutMs,
      }, (res) => {
        // Drain the response so the socket can be reused.
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          sink.failCount = 0;
        } else {
          this._noteFailure(sink, `HTTP ${res.statusCode}`);
        }
        resolve();
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', (err) => {
        this._noteFailure(sink, err.message);
        resolve();
      });
      req.write(body);
      req.end();
    });
  }

  _noteFailure(sink, reason) {
    sink.failCount = (sink.failCount || 0) + 1;
    if (sink.failCount === 1 || sink.failCount % 10 === 0) {
      console.warn(`[ExternalSink] ${sink.name} failed (${sink.failCount}x): ${reason}`);
    }
    if (sink.failCount >= FAIL_DISABLE_THRESHOLD) {
      sink.disabled = true;
      console.warn(`[ExternalSink] ${sink.name} disabled after ${sink.failCount} consecutive failures (restart to retry)`);
    }
  }
}

module.exports = ExternalSink;
