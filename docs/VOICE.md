# Denizen — Voice (ElevenLabs TTS)

> Real voices for the 16 NPCs, gated by the presence flag so the office
> stays silent when you're not at the keyboard. The browser never sees
> your API key — all calls to ElevenLabs go through the server.

## Architecture

```
                       presence is FALSE
                       ───────────────►   (silent — speech bubbles only)
        NPC speaks
            │           presence is TRUE
            ▼           ───────────────►
   ┌────────────────┐                    ┌────────────────────────┐
   │ player-chat.js │  DenizenSpeak()    │ src/voice-gate.js       │
   │ (or any        │  ───────────────►  │  - gate on zionPresent  │
   │  speak path)   │                    │  - call DenizenVoice…   │
   └────────────────┘                    └───────────┬────────────┘
                                                     │
                                  if no provider:    │
                                  SpeechSynthesis    ▼
                                                ┌────────────────────────┐
                                                │ src/elevenlabs-provider │
                                                │ (auto-installed if      │
                                                │ /api/tts/health = ok)   │
                                                └───────────┬────────────┘
                                                            │  fetch /api/tts
                                                            ▼
                                                ┌────────────────────────┐
                                                │ server.js              │
                                                │  POST /api/tts         │
                                                │   ↓ proxies to         │
                                                │ src/elevenlabs-tts.js  │
                                                │   xi-api-key header    │
                                                └───────────┬────────────┘
                                                            ▼
                                              api.elevenlabs.io  →  audio/mpeg
                                                            │
                                          stream MP3 bytes  ▼
                                                ┌────────────────────────┐
                                                │ browser: new Audio(blob)│
                                                │ .play()                 │
                                                └─────────────────────────┘
```

## Setup — three steps

### 1. Get an ElevenLabs API key

https://elevenlabs.io → Profile → API Keys. Free tier gives you 10k characters/month, more than enough to hear all 16 NPCs talk.

### 2. Make the key available to the server

The server resolves the key in this order. Pick whichever is convenient:

| Source | How |
|---|---|
| `ELEVENLABS_API_KEY` env var | `$env:ELEVENLABS_API_KEY = "<key>"` (PowerShell) |
| `XI_API_KEY` env var | Same, but using ElevenLabs' internal name |
| `~/.openclaw/.env` | Add `ELEVENLABS_API_KEY=<key>` to that file (one line, no spaces) |

The OpenClaw `.env` fallback exists because users frequently configure ElevenLabs once for OpenClaw and expect Denizen to pick up the same key. Same key, two tools.

**Never paste the key into source code, commits, chat, or anywhere a transcript could be backed up.**

### 3. Restart the server

```bash
npm start
```

Look for this line in the boot log:

```
ElevenLabs TTS: ✅ configured (key from env); POST http://localhost:8080/api/tts  body: {npcName,text}
```

If you see *"not configured"* instead, the resolver couldn't find the key — re-check the env var was set in the same shell you ran `npm start` from.

### 4. Activate voice in the browser

Voice is gated by `zionPresent`. Press **Alt+V** in the browser, or run:

```js
window.DenizenSetPresence(true);
```

You should see:

```
[ElevenLabs] active (key from env, 16 NPC voices)
```

…in the browser console. The next time any NPC speaks, you'll hear them.

## Verifying without the browser

`scripts/tts-smoke.js` is a standalone CLI smoke test:

```bash
node scripts/tts-smoke.js                              # default text + voice
node scripts/tts-smoke.js "Welcome to the office"      # custom text
node scripts/tts-smoke.js "Hi" --npc Abby              # use Abby's voice
node scripts/tts-smoke.js "Hi" --voice <voiceId>       # override voice
node scripts/tts-smoke.js --help
```

Writes `out/test-tts.mp3` and prints the file size + elapsed ms. If it fails, the error message tells you exactly what's wrong — bad key, bad voice ID, no quota, network — so you don't have to guess.

## Per-NPC voices

`data/voice-map.json` maps NPC display names to ElevenLabs voice IDs:

```jsonc
{
  "default": { "voiceId": "EXAVITQu4vr4xnSDxMaL", "modelId": "eleven_turbo_v2_5" },
  "npcs": {
    "Abby":   { "voiceId": "EXAVITQu4vr4xnSDxMaL" },
    "Alex":   { "voiceId": "29vD33N1CtxCmqQRPOHJ" },
    "Bob":    { "voiceId": "5Q0t7uMcjvnagumLfvZi" },
    "...":    "..."
  }
}
```

The defaults use ElevenLabs' public voice library so they work out of the box. To change them:

- Pick a voice from https://elevenlabs.io/app/voice-library and copy its ID.
- Edit `data/voice-map.json` — restart not needed for the map itself, the
  server reads it on every request? No — actually it's loaded once at
  startup. Restart after editing.
- Per-NPC `modelId` overrides the default model. Useful when you want
  Roki on `eleven_multilingual_v2` but Abby on the cheaper turbo model.

You can clone your own voice in ElevenLabs (paid plan) and drop its ID in here too — no code changes.

## Endpoints

### `GET /api/tts/health`

Cheap probe. Reports whether the server is configured **and where** the key was found, but never the key value.

```jsonc
{
  "configured": true,
  "source": "env" | ".env-file",
  "defaultVoiceId": "EXAVITQu4vr4xnSDxMaL",
  "defaultModelId": "eleven_turbo_v2_5",
  "voiceMapEntries": 16
}
```

The browser hits this on boot to decide whether to install the
ElevenLabs provider or stay with `SpeechSynthesis`.

### `POST /api/tts`

```
POST /api/tts
Content-Type: application/json

{ "npcName": "Abby", "text": "Hello" }
```

| Field | Default | Meaning |
|---|---|---|
| `text` | required | What to say (clipped at 4000 chars) |
| `npcName` | — | If set, picks the NPC's voice from `voice-map.json` |
| `voiceId` | from map / default | Explicit ElevenLabs voice ID override |
| `modelId` | from map / default | Explicit model override |

Returns `audio/mpeg` (streamed). On failure, returns JSON `{error}` with a 4xx/5xx status. The error includes the upstream ElevenLabs detail so you can tell apart "bad key" vs "bad voice" vs "out of quota".

## Plugging in a different TTS

The voice gate is provider-agnostic. To swap ElevenLabs for any other TTS, set `window.DenizenVoiceProvider` to your own function:

```js
window.DenizenVoiceProvider = async (npcName, text) => {
  const r = await fetch('/api/my-tts', { method: 'POST', body: JSON.stringify({ npcName, text }) });
  const blob = await r.blob();
  new Audio(URL.createObjectURL(blob)).play();
};
```

The presence gate (`zionPresent`) still applies — your provider only gets called when the human is at the keyboard.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Boot log says "not configured" but env var is set | Env var set in different shell than the one running `npm start` | Set it in the SAME shell, or use `~/.openclaw/.env` |
| `POST /api/tts` returns 502 with `HTTP 401: invalid_api_key` | Key was rotated / typo | Update env var or `~/.openclaw/.env` |
| Returns 502 with `HTTP 401: quota_exceeded` | Free tier is out of characters | Upgrade or wait until reset |
| Returns 502 with `HTTP 422: voice_id ... not found` | Voice ID wrong | Pick a real one from your library |
| Browser console: `audio.play() blocked` | Browser autoplay policy | Click the page once to "unlock" audio |
| Hear browser SpeechSynthesis instead of ElevenLabs | Provider didn't install (health check failed) | Look in browser console for `[ElevenLabs]` line — it'll tell you why |
| Hear nothing at all | `zionPresent` is false | Press Alt+V or run `DenizenSetPresence(true)` |

## Privacy

- The API key is server-side only. The browser never sees it.
- All audio fetches go to your local server, which proxies to `api.elevenlabs.io` over HTTPS.
- Audio blobs are revoked from `URL.createObjectURL` on `ended` so they don't accumulate over a long session.
- The health endpoint reports the key's *source* (`env` vs `.env-file`) but never its value.

## See also

- [WORLD-STATE.md](WORLD-STATE.md) — the presence flag + voice gate live here
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SETUP.md](SETUP.md) — env var reference table includes ElevenLabs
