#!/usr/bin/env node
'use strict';
/**
 * ElevenLabs TTS smoke test.
 *
 * Reads ELEVENLABS_API_KEY from process.env or ~/.openclaw/.env (same
 * resolver the server uses), synthesizes a short clip, writes it to
 * out/test-tts.mp3, and prints any error directly so you know whether
 * the key, voice, or model id is the problem.
 *
 * Usage:
 *   node scripts/tts-smoke.js                 # uses default text + voice
 *   node scripts/tts-smoke.js "hello world"
 *   node scripts/tts-smoke.js "hi" --voice 21m00Tcm4TlvDq8ikWAM
 *   node scripts/tts-smoke.js "hi" --npc Abby     # use voice from voice-map.json
 *   node scripts/tts-smoke.js --help
 *
 * Exit code 0 on success, 1 on failure.
 */

const path = require('node:path');
const fs = require('node:fs');

const elevenLabs = require(path.join(__dirname, '..', 'src', 'elevenlabs-tts.js'));

function parseArgs(argv) {
  const out = { text: null, voiceId: null, modelId: null, npc: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; }
    else if (a === '--voice') out.voiceId = argv[++i];
    else if (a === '--model') out.modelId = argv[++i];
    else if (a === '--npc') out.npc = argv[++i];
    else if (a.startsWith('--')) { /* ignore unknown */ }
    else positional.push(a);
  }
  if (positional.length) out.text = positional.join(' ');
  return out;
}

function help() {
  console.log(`Usage:
  node scripts/tts-smoke.js                                  # default text + voice
  node scripts/tts-smoke.js "your text here"
  node scripts/tts-smoke.js "hi" --voice <voiceId>
  node scripts/tts-smoke.js "hi" --model eleven_turbo_v2_5
  node scripts/tts-smoke.js "hi" --npc Abby                  # uses voice-map.json

Reads the API key from:
  1. process.env.ELEVENLABS_API_KEY (or XI_API_KEY)
  2. ~/.openclaw/.env`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); return; }

  const status = elevenLabs.status();
  if (!status.configured) {
    console.error('✗ ElevenLabs is not configured.');
    console.error('  Looked at: process.env.ELEVENLABS_API_KEY, process.env.XI_API_KEY, ~/.openclaw/.env');
    console.error('  Set ELEVENLABS_API_KEY in your shell and try again.');
    process.exit(1);
  }
  console.log(`✓ Key found in ${status.source}`);
  console.log(`  default voice: ${status.defaultVoiceId}`);
  console.log(`  default model: ${status.defaultModelId}`);

  // Resolve --npc against voice-map.json
  let voiceId = args.voiceId;
  let modelId = args.modelId;
  if (args.npc) {
    try {
      const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'voice-map.json'), 'utf8'));
      const e = map.npcs?.[args.npc];
      if (!e) { console.error(`✗ unknown NPC "${args.npc}" in voice-map.json`); process.exit(1); }
      voiceId = voiceId || e.voiceId || map.default?.voiceId;
      modelId = modelId || e.modelId || map.default?.modelId;
      console.log(`  using voice for ${args.npc}: ${voiceId}`);
    } catch (err) {
      console.error('✗ could not read data/voice-map.json: ' + err.message);
      process.exit(1);
    }
  }

  const text = args.text || 'Hello from Denizen. Voice gate test successful.';
  const outDir = path.join(__dirname, '..', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'test-tts.mp3');

  console.log(`→ synthesizing ${text.length} chars`);
  const t0 = Date.now();
  try {
    await elevenLabs.synthesizeToFile({ text, voiceId, modelId }, outPath);
    const ms = Date.now() - t0;
    const bytes = fs.statSync(outPath).size;
    console.log(`✓ wrote ${outPath} (${bytes} bytes, ${ms} ms)`);
    console.log(`  play it: start ${outPath}   (or open in any audio player)`);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    if (/401|invalid|unauthorized/i.test(err.message)) {
      console.error('  Hint: check the key (was it rotated? does the account have credits?)');
    } else if (/voice/i.test(err.message)) {
      console.error('  Hint: voice ID rejected — pick one from your ElevenLabs library');
    } else if (/model/i.test(err.message)) {
      console.error('  Hint: model ID rejected — try eleven_turbo_v2_5 or eleven_multilingual_v2');
    }
    process.exit(1);
  }
}

if (require.main === module) main();
