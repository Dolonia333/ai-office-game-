'use strict';
/**
 * Tests for the ElevenLabs server module.
 *
 * We don't call ElevenLabs in CI. Instead we override the module's
 * outbound call by monkey-patching `https.request` to a local mock
 * server, then assert on the headers, body, and stream behaviour the
 * real call would have produced.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');

// Reset the cached key BEFORE requiring the module so test-time env vars
// take effect. Saving original values so the after hook can restore.
const _origEnvKey = process.env.ELEVENLABS_API_KEY;
const _origXi = process.env.XI_API_KEY;
const _origHome = process.env.HOME;
const _origUser = process.env.USERPROFILE;

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-tts-test-'));
fs.mkdirSync(path.join(tmpHome, '.openclaw'), { recursive: true });
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
delete process.env.ELEVENLABS_API_KEY;
delete process.env.XI_API_KEY;

const elevenLabs = require('../src/elevenlabs-tts.js');

// ---------------------------------------------------------------------
// Mock ElevenLabs upstream — a local http.Server we'll redirect to via
// monkey-patching https.request.
// ---------------------------------------------------------------------

let mockServer;
let mockUrl;
let received;
let nextResponse = { status: 200, body: 'FAKE-MP3-BYTES', headers: { 'content-type': 'audio/mpeg' } };

before(() => new Promise((resolve) => {
  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = {
        method: req.method,
        path: req.url,
        headers: req.headers,
        body,
      };
      res.writeHead(nextResponse.status, nextResponse.headers || {});
      res.end(nextResponse.body);
    });
  });
  mockServer.listen(0, '127.0.0.1', () => {
    mockUrl = `http://127.0.0.1:${mockServer.address().port}`;
    // Redirect every https.request the module makes to our local
    // http.request. We swap the protocol module by intercepting the
    // single function the source file uses.
    const realHttpsRequest = https.request;
    https.request = (opts, cb) => {
      const port = mockServer.address().port;
      return http.request({
        ...opts,
        host: '127.0.0.1', hostname: '127.0.0.1',
        port,
        protocol: 'http:',
      }, cb);
    };
    // Save for after-hook restore.
    https._realRequest = realHttpsRequest;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  if (https._realRequest) https.request = https._realRequest;
  if (_origEnvKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = _origEnvKey;
  if (_origXi === undefined) delete process.env.XI_API_KEY; else process.env.XI_API_KEY = _origXi;
  if (_origHome === undefined) delete process.env.HOME; else process.env.HOME = _origHome;
  if (_origUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = _origUser;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  mockServer.close(resolve);
}));

// Tiny writable that captures bytes for assertions.
function bufferingResponse() {
  const chunks = [];
  const w = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
  w.headersSent = false;
  w.writeHead = function () { w.headersSent = true; };
  w.getBuffer = () => Buffer.concat(chunks);
  return w;
}

// ---------------------------------------------------------------------

describe('ElevenLabs TTS — key resolution', () => {
  it('reports unconfigured when no env vars and no .env file', () => {
    elevenLabs._resetKeyCache();
    // Make sure neither env var is set, and remove the .env file if it exists.
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.XI_API_KEY;
    try { fs.unlinkSync(path.join(tmpHome, '.openclaw', '.env')); } catch (_) {}
    assert.equal(elevenLabs.status().configured, false);
  });

  it('finds key in process.env.ELEVENLABS_API_KEY', () => {
    elevenLabs._resetKeyCache();
    process.env.ELEVENLABS_API_KEY = 'sk_envvar';
    const s = elevenLabs.status();
    assert.equal(s.configured, true);
    assert.equal(s.source, 'env');
    delete process.env.ELEVENLABS_API_KEY;
  });

  it('finds key in process.env.XI_API_KEY (alias)', () => {
    elevenLabs._resetKeyCache();
    process.env.XI_API_KEY = 'sk_xi';
    assert.equal(elevenLabs.status().source, 'env');
    delete process.env.XI_API_KEY;
  });

  it('falls back to ~/.openclaw/.env', () => {
    elevenLabs._resetKeyCache();
    fs.writeFileSync(
      path.join(tmpHome, '.openclaw', '.env'),
      '# comment\nELEVENLABS_API_KEY="sk_fromfile"\nOTHER=ignored\n'
    );
    const s = elevenLabs.status();
    assert.equal(s.configured, true);
    assert.equal(s.source, '.env-file');
  });

  it('strips surrounding quotes from .env values', () => {
    elevenLabs._resetKeyCache();
    fs.writeFileSync(path.join(tmpHome, '.openclaw', '.env'), "ELEVENLABS_API_KEY='sk_quoted'\n");
    assert.equal(elevenLabs.status().configured, true);
  });
});

describe('ElevenLabs TTS — synthesize()', () => {
  before(() => {
    elevenLabs._resetKeyCache();
    process.env.ELEVENLABS_API_KEY = 'sk_for_synth_tests';
  });
  after(() => { delete process.env.ELEVENLABS_API_KEY; elevenLabs._resetKeyCache(); });

  it('sends xi-api-key header and correct body', async () => {
    nextResponse = { status: 200, body: Buffer.from([0xff, 0xfb, 0xaa]), headers: { 'content-type': 'audio/mpeg' } };
    received = null;
    const buf = bufferingResponse();
    await elevenLabs.synthesize({ text: 'hello world', voiceId: 'voiceX', modelId: 'eleven_test' }, buf);
    assert.equal(received.method, 'POST');
    assert.equal(received.path, '/v1/text-to-speech/voiceX');
    assert.equal(received.headers['xi-api-key'], 'sk_for_synth_tests');
    assert.equal(received.headers['accept'], 'audio/mpeg');
    const body = JSON.parse(received.body);
    assert.equal(body.text, 'hello world');
    assert.equal(body.model_id, 'eleven_test');
    assert.ok(body.voice_settings);
  });

  it('streams audio bytes back to the response', async () => {
    nextResponse = { status: 200, body: Buffer.from('PRETEND-MP3'), headers: { 'content-type': 'audio/mpeg' } };
    const buf = bufferingResponse();
    await elevenLabs.synthesize({ text: 'x' }, buf);
    assert.ok(buf.headersSent, 'should set headers before piping');
    assert.equal(buf.getBuffer().toString(), 'PRETEND-MP3');
  });

  it('rejects when text is missing', async () => {
    const buf = bufferingResponse();
    await assert.rejects(() => elevenLabs.synthesize({ text: '' }, buf), /text is required/);
  });

  it('surfaces the upstream error body on non-200', async () => {
    nextResponse = { status: 401, body: '{"detail":"bad key"}', headers: { 'content-type': 'application/json' } };
    const buf = bufferingResponse();
    await assert.rejects(
      () => elevenLabs.synthesize({ text: 'x' }, buf),
      /HTTP 401.*bad key/,
    );
  });

  it('rejects when no key is configured', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    try { fs.unlinkSync(path.join(tmpHome, '.openclaw', '.env')); } catch (_) {}
    elevenLabs._resetKeyCache();
    const buf = bufferingResponse();
    await assert.rejects(() => elevenLabs.synthesize({ text: 'x' }, buf), /not configured/);
    process.env.ELEVENLABS_API_KEY = 'sk_for_synth_tests'; // restore for the next test
    elevenLabs._resetKeyCache();
  });
});

describe('ElevenLabs TTS — synthesizeToFile()', () => {
  before(() => {
    elevenLabs._resetKeyCache();
    process.env.ELEVENLABS_API_KEY = 'sk_for_file_tests';
  });
  after(() => { delete process.env.ELEVENLABS_API_KEY; elevenLabs._resetKeyCache(); });

  it('writes the MP3 bytes to disk', async () => {
    nextResponse = { status: 200, body: Buffer.from('FAKEMP3FAKEMP3'), headers: { 'content-type': 'audio/mpeg' } };
    const out = path.join(tmpHome, 'file-test.mp3');
    await elevenLabs.synthesizeToFile({ text: 'hello' }, out);
    assert.equal(fs.readFileSync(out).toString(), 'FAKEMP3FAKEMP3');
  });
});
