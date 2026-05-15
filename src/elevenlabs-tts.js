'use strict';
/**
 * ElevenLabs TTS — server-side bridge.
 *
 * Reads an API key from (in order):
 *   1. process.env.ELEVENLABS_API_KEY
 *   2. process.env.XI_API_KEY                       (ElevenLabs' internal name)
 *   3. ~/.openclaw/.env  KEY=VALUE  (ELEVENLABS_API_KEY or XI_API_KEY)
 *
 * The OpenClaw fallback exists because users frequently configure their
 * ElevenLabs key once, in OpenClaw's `.env`, and expect every local tool
 * to find it. We never persist or echo the key — the only thing we do
 * with it is set the `xi-api-key` request header on outbound calls to
 * ElevenLabs.
 *
 * The synthesize() function streams MP3 bytes back from ElevenLabs to
 * the caller's response object. Server-side buffering would balloon
 * memory if many NPCs spoke at once; piping keeps this O(1) per request.
 */

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ELEVENLABS_HOST = 'api.elevenlabs.io';
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah" — a sane default
const REQUEST_TIMEOUT_MS = 20000;

// Cached for the lifetime of the process. Looking it up once at module
// load means we don't re-read the OpenClaw .env on every request.
let _cachedKey = null;
let _cachedKeySource = null;

/**
 * Tries to find an ElevenLabs API key. Returns { key, source } or null.
 * The `source` field is a short label ('env', '.env-file') so logs and
 * the /api/tts/health endpoint can tell the operator where the key was
 * picked up from without ever revealing the value.
 */
function _resolveKey() {
  if (_cachedKey !== null) return { key: _cachedKey, source: _cachedKeySource };

  const fromEnv = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (fromEnv) {
    _cachedKey = fromEnv;
    _cachedKeySource = 'env';
    return { key: _cachedKey, source: _cachedKeySource };
  }

  // Fall back to ~/.openclaw/.env. Parsed manually because we don't want
  // to add a `dotenv` dependency just for this single optional integration.
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return null;
  const envFile = path.join(home, '.openclaw', '.env');
  let raw;
  try { raw = fs.readFileSync(envFile, 'utf8'); }
  catch (_) { return null; }

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    if (k !== 'ELEVENLABS_API_KEY' && k !== 'XI_API_KEY') continue;
    let v = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present (KEY="value" or KEY='value').
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) {
      _cachedKey = v;
      _cachedKeySource = '.env-file';
      return { key: _cachedKey, source: _cachedKeySource };
    }
  }
  return null;
}

/** Re-read the key on next call. Used in tests. */
function _resetKeyCache() { _cachedKey = null; _cachedKeySource = null; }

/**
 * Public: is the integration usable?
 * @returns {{ configured: boolean, source?: string, defaultVoiceId?: string, defaultModelId?: string }}
 */
function status() {
  const r = _resolveKey();
  if (!r) return { configured: false };
  return {
    configured: true,
    source: r.source,
    defaultVoiceId: DEFAULT_VOICE_ID,
    defaultModelId: DEFAULT_MODEL_ID,
  };
}

/**
 * Synthesize speech and stream the MP3 bytes through `res`. Caller is
 * responsible for setting their own response headers BEFORE calling this
 * if they want to (we set Content-Type: audio/mpeg ourselves before the
 * first byte streams).
 *
 * @param {Object} opts
 * @param {string} opts.text                 — what to say (clipped at 4000 chars)
 * @param {string} [opts.voiceId]            — ElevenLabs voice ID
 * @param {string} [opts.modelId]            — ElevenLabs model ID
 * @param {Object} [opts.voiceSettings]      — { stability, similarity_boost, style, use_speaker_boost }
 * @param {http.ServerResponse} res          — pipe target
 * @returns {Promise<void>} resolves on stream end, rejects on error
 */
function synthesize({ text, voiceId, modelId, voiceSettings } = {}, res) {
  return new Promise((resolve, reject) => {
    const r = _resolveKey();
    if (!r) {
      reject(new Error('ElevenLabs not configured: set ELEVENLABS_API_KEY or add it to ~/.openclaw/.env'));
      return;
    }
    const safeText = String(text || '').slice(0, 4000);
    if (!safeText.trim()) {
      reject(new Error('text is required'));
      return;
    }
    const voice = voiceId || DEFAULT_VOICE_ID;
    const model = modelId || DEFAULT_MODEL_ID;

    const body = JSON.stringify({
      text: safeText,
      model_id: model,
      voice_settings: voiceSettings || {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.15,
        use_speaker_boost: true,
      },
    });

    const req = https.request({
      method: 'POST',
      host: ELEVENLABS_HOST,
      path: `/v1/text-to-speech/${encodeURIComponent(voice)}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'audio/mpeg',
        'xi-api-key': r.key,
        'User-Agent': 'Denizen/1.0',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (upstream) => {
      if (upstream.statusCode !== 200) {
        // Drain the error body so we can include it in the rejection.
        let errBody = '';
        upstream.on('data', (c) => { errBody += c.toString(); });
        upstream.on('end', () => {
          reject(new Error(`ElevenLabs HTTP ${upstream.statusCode}: ${errBody.slice(0, 400)}`));
        });
        return;
      }
      // Set headers on our response (if not already set) and pipe.
      try {
        if (!res.headersSent) {
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'no-store',
          });
        }
      } catch (_) { /* response already closed */ }
      upstream.on('error', reject);
      upstream.on('end', resolve);
      upstream.pipe(res);
    });
    req.on('timeout', () => { req.destroy(new Error('elevenlabs request timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Save audio to a file. Used by the smoke CLI (scripts/test-tts.js).
 * Same opts as synthesize() but pipes to a real fs WriteStream — no
 * shim, because `pipe()` requires a full Writable surface area
 * (`.once`, `.emit`, etc.) that we shouldn't try to fake.
 */
function synthesizeToFile(opts, outPath) {
  return new Promise((resolve, reject) => {
    const r = _resolveKey();
    if (!r) {
      reject(new Error('ElevenLabs not configured: set ELEVENLABS_API_KEY or add it to ~/.openclaw/.env'));
      return;
    }
    const safeText = String(opts.text || '').slice(0, 4000);
    if (!safeText.trim()) { reject(new Error('text is required')); return; }
    const voice = opts.voiceId || DEFAULT_VOICE_ID;
    const model = opts.modelId || DEFAULT_MODEL_ID;

    const body = JSON.stringify({
      text: safeText,
      model_id: model,
      voice_settings: opts.voiceSettings || {
        stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true,
      },
    });

    const fileStream = fs.createWriteStream(outPath);
    fileStream.on('error', reject);
    fileStream.on('finish', () => resolve(outPath));

    const req = https.request({
      method: 'POST',
      host: ELEVENLABS_HOST,
      path: `/v1/text-to-speech/${encodeURIComponent(voice)}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'audio/mpeg',
        'xi-api-key': r.key,
        'User-Agent': 'Denizen/1.0',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (upstream) => {
      if (upstream.statusCode !== 200) {
        let errBody = '';
        upstream.on('data', (c) => { errBody += c.toString(); });
        upstream.on('end', () => {
          fileStream.destroy();
          try { fs.unlinkSync(outPath); } catch (_) {}
          reject(new Error(`ElevenLabs HTTP ${upstream.statusCode}: ${errBody.slice(0, 400)}`));
        });
        return;
      }
      upstream.pipe(fileStream);
    });
    req.on('timeout', () => { req.destroy(new Error('elevenlabs request timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  status,
  synthesize,
  synthesizeToFile,
  _resetKeyCache,
  DEFAULT_VOICE_ID,
  DEFAULT_MODEL_ID,
};
