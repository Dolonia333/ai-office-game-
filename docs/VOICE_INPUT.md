# Denizen — Voice Input + OpenClaw Dispatch

> Closes the voice loop. Hold a key, talk, NPC hears you, NPC speaks
> back, **and if what you said is an action request, OpenClaw runs it
> for real**. Browser-only. No API keys for STT (uses the built-in
> SpeechRecognition); pluggable to Whisper or any other engine.

Two new modules + one extension to an existing one:

| File | Purpose |
|---|---|
| [`src/voice-input.js`](../src/voice-input.js) | Push-to-talk STT. Hold `\` (backslash) or click the mic button. Drops the transcript into the player-chat pipeline. |
| [`src/openclaw-dispatch.js`](../src/openclaw-dispatch.js) | Pure classifier + browser dispatcher. Decides if your message is an *action request* and routes it to OpenClaw via the gateway. |
| [`src/gateway-bridge.js`](../src/gateway-bridge.js) | New `sendChat(text, opts)` helper on the existing OpenClaw bridge. |

## The voice loop

```
   You hold \                              You release \
       │                                        │
       ▼                                        ▼
   ┌────────────────────────────┐
   │ webkitSpeechRecognition     │ → final transcript
   │ src/voice-input.js          │
   └─────────────┬──────────────┘
                 │
                 ▼
   ┌────────────────────────────┐
   │ window.__DenizenPlayerChat  │ — adds to chat log + classifies
   │ src/player-chat.js          │
   └─────────────┬──────────────┘
                 │
       ┌─────────┴──────────────┐
       │                        │
       ▼                        ▼
 (always)                 (if classified as 'action')
 NPC brain reply          window.DenizenOpenClawDispatch
 (existing flow)              .sendToGateway()
       │                        │
       │                        ▼
       │              gateway-bridge.sendChat()
       │              → OpenClaw runs the tool
       │                        │
       │                        ▼ (events come back)
       │              src/openclaw-worldstate-bridge.js
       │              → NPC walks + speaks the actual outcome
       │
       └──────────► Voice via ElevenLabs (gated on zionPresent)
```

The chat path and the action path are **both fired** for action-classified messages — so you get a fast local conversational reply *and* the real work happens in OpenClaw.

## Voice input

### Activate

Hold backslash (`\`) anywhere on the page that isn't a text input. Or click the floating 🎤 button bottom-right.

```
Mic state colors:
  dark blue / gray   = idle
  red                = listening (mic open)
  blue               = transcribing / busy
```

A tooltip-style status bar above the button shows interim transcript ("… looking for…") then the final ("→ deploy v2 to staging") before submitting.

### Behaviour

- **Push-to-talk only.** No always-on mic. The hotkey suppresses on `repeat=true` so holding doesn't re-trigger; first-down starts, key-up stops.
- **Won't fire while you're typing.** If `document.activeElement` is an `<input>`, `<textarea>`, or contentEditable element, the hotkey is ignored.
- **Single utterance per push.** `recognition.continuous = false`. Push, talk, release.
- **Interim results render live.** You see what the recognizer thinks you're saying as you speak.
- **Auto-submit on final.** `setAutosubmit(false)` to disable and inspect the transcript before sending.

### Tuning at runtime

```js
window.DenizenVoiceInput.setHotkey('`');           // backtick instead of backslash
window.DenizenVoiceInput.setLang('en-GB');         // British English recognizer
window.DenizenVoiceInput.setAutosubmit(false);     // require explicit submit

// Plug in a different STT engine entirely (e.g. Whisper via your server):
window.DenizenVoiceInput.setProvider({
  start(deliver, setStatus) {
    // open a MediaRecorder, POST chunks to /api/whisper, call deliver(transcript)
    setStatus('listening', 'recording…');
  },
  stop() { /* close stream */ },
});
```

### Browser support

`SpeechRecognition` (or `webkitSpeechRecognition`) is what powers it. As of writing, Chrome/Edge fully support it; Safari has partial support; Firefox requires a flag.

If the API isn't present, the module logs `[VoiceInput] SpeechRecognition not available` and the mic button is never created. The script doesn't fail; everything else continues to work. The pluggable provider hook (above) is the path to support those browsers via a server-side STT.

## OpenClaw dispatch

Routes player utterances based on intent classification.

### Classification

`classify(text)` returns:

```jsonc
{
  "kind":       "action" | "chat",
  "confidence": 0.0..1.0,
  "stripped":   "the text minus any /command prefix",
  "urgent":     true if "now" / "asap" / "immediately" appears,
  "reason":     "imperative verb: deploy" | "1 tool keyword" | …
}
```

How it decides:

1. **Explicit prefixes win.** `/do`, `/run`, `/exec`, `/action` → force action. `/say`, `/chat`, `/talk` → force chat.
2. **Chat markers are sticky.** "hello", "thanks", "how are you", "what do you think" → chat, even if action verbs appear.
3. **Imperative-form verbs at the start** ("deploy", "run", "fix", "deploy", 50+ verbs) → action.
4. **Polite imperatives** ("please deploy", "can you run", "could you fix") → action even when phrased as a question.
5. **Tool keywords** (github, supabase, deploy, terminal, n8n, …):
   - 2+ tool keywords anywhere → action
   - 1 tool keyword + statement → action
   - 1 tool keyword + question → chat (probably asking about something, not requesting)
6. **Plain question** → chat.

The full action verb list, tool keyword regexes, and chat-marker patterns are exported from the module — read the source if you need to add or remove entries.

### Examples

| Input | Classified as | Reason |
|---|---|---|
| `"deploy v2 to staging"` | action | imperative verb |
| `"please deploy v2"` | action | polite imperative |
| `"can you run the tests?"` | action | polite imperative (overrides question) |
| `"hello Abby"` | chat | greeting |
| `"thanks for the help"` | chat | thanks marker |
| `"what should we do?"` | chat | question |
| `"the github PR needs review"` | action | 2 tool keywords |
| `"does this need a database migration?"` | chat | 1 keyword + question |
| `"deploy v2 right now"` | action + urgent | imperative + urgency |
| `"/do whatever"` | action | explicit prefix |
| `"/say deploy is the most fun"` | chat | explicit prefix |

### Outbound dispatch

Action-classified messages get sent to OpenClaw via two paths, in order:

1. **WebSocket gateway** (`gateway-bridge.sendChat`) — calls
   `bridge.request('chat.send', { text, urgent, source })`. The method
   name is `chat.send` by default; override for forked OpenClaw builds:
   ```js
   window.DenizenOpenClawChatMethod = 'agent.run';   // or whatever
   ```

2. **HTTP fallback** — `POST /openclaw/api/chat` (proxied through the
   server). Override the path:
   ```js
   window.DenizenOpenClawChatPath = '/openclaw/api/v2/chat';
   ```

If both fail, the message still goes to the local NPC brain so you get *some* response — and the chat log surfaces the error so you know dispatch failed.

### Direct usage from the console

```js
// Just classify, don't send
window.DenizenOpenClawDispatch.classify("deploy v2 to staging");

// Classify AND dispatch
await window.DenizenOpenClawDispatch.dispatch("deploy v2 to staging");
// → { kind: 'action', ok: true, via: 'gateway', response: {...} }

// Force a specific path
await window.DenizenOpenClawDispatch.sendToGateway("hello");
await window.DenizenOpenClawDispatch.sendToHttpProxy("hello");
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Mic button doesn't appear | `SpeechRecognition` not in this browser | Use Chrome/Edge, or plug a custom provider via `setProvider()` |
| Hotkey ignored | Cursor is in a text input | Click outside the input first |
| Recognition error: `not-allowed` | Mic permission denied | Click 🔒 in the address bar → enable microphone |
| Recognition error: `no-speech` | No audio detected for several seconds | Talk closer to the mic, or check the OS input device |
| Action sent but no NPC reaction | OpenClaw not running or `chat.send` method name wrong | Check `[GatewayBridge]` logs; override `window.DenizenOpenClawChatMethod` |
| "OpenClaw dispatch failed: gateway not connected" | Gateway WebSocket not up | Start OpenClaw: `openclaw gateway --port 18789` |
| Action goes to OpenClaw but no NPC speaks the result | The inbound bridge isn't running | Check `[OpenClawBridge]` is `attached` in console; reload if needed |

## Testing

[`tests/openclaw-dispatch.test.js`](../tests/openclaw-dispatch.test.js) — 27 cases covering:

- Empty / whitespace / null input
- Explicit prefix overrides (`/do`, `/run`, `/say`)
- Chat markers (greetings, thanks, "how are you")
- Imperative verbs at sentence start
- Polite imperatives (with question marks)
- Tool keyword counting (1 vs 2+, statement vs question)
- Plain questions
- Urgency flag detection ("now", "asap", "immediately")
- Stripped output (trims and removes prefixes)
- Confidence is a number in [0, 1]

Pure Node — no DOM, no fetch. The browser dispatcher is a thin wrapper and tested manually.

## What this unlocks

Combined with the existing voice gate + OpenClaw inbound bridge, you now have:

> **Voice in → real action out.** Hold backslash, say "deploy v2 to staging," release. The chat log shows your transcript. OpenClaw gets the request. Oscar (because GitHub/deploy hint to DevOps) walks to a desk. ElevenLabs speaks "Deploying to staging" in his voice. The task chip appears in worldState. When OpenClaw finishes the deploy, the chip flips to `done`, the chime fires, Oscar speaks the result.

That's the demo. The architecture for it has existed since Phase 4–5; this commit closes the input side.

## See also

- [VOICE.md](VOICE.md) — TTS output (the OTHER half of the loop)
- [OPENCLAW_INTEGRATION.md](OPENCLAW_INTEGRATION.md) — inbound bridge
- [WORLD-STATE.md](WORLD-STATE.md) — presence + the singleton both sides write to
- [ACTIONS.md](ACTIONS.md) — sprite-level action vocabulary
