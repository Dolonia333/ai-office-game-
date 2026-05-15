# Denizen — Sound Effects

> Ambient office loop + event-driven cues, gated by the same presence
> flag as voice. Browser-only. Missing audio files silently skipped so
> the system ships before any audio lands.

Source: [`src/sfx.js`](../src/sfx.js).
Map: [`data/sfx-map.json`](../data/sfx-map.json).
Audio drop folder: [`assets/audio/`](../assets/audio/).

## What it does

On boot, the SFX module fetches `/data/sfx-map.json`, then listens to
the `/agent-ws` connection (the same one voice-gate.js listens to). On
relevant events it plays a sound from `assets/audio/`. Two layers:

1. **Ambient loop** — `office_ambient.ogg` plays on a loop at low
   volume while presence is on. Fades in over 2s, fades out instantly
   on presence-off.
2. **Event sounds** — short clips fired on threats, tasks, meetings,
   chat responses, presence toggle. Each one is throttled to fire at
   most every 350 ms per event-key so a noisy moment doesn't machine-
   gun the speakers.

## Setup

### 1. Drop audio files into `assets/audio/`

Match the filenames in `data/sfx-map.json` (or edit the map to use your
filenames). A `README.md` at `assets/audio/README.md` lists the default
expected files and links to free-tier sources.

If a referenced file is missing, the module silently skips it — no
console errors. So you can ship the map first, drop files in over time.

### 2. Activate presence

SFX is gated on `window.DenizenPresence.zionPresent`. Press **Alt+V** in
the browser, or:

```js
window.DenizenSetPresence(true);
```

You should hear:

- The ambient loop fade in (if `office_ambient.ogg` exists).
- Subsequent threats / tasks / chat fire their respective cues.

## Map shape

```jsonc
{
  "ambient": {
    "loop": "office_ambient.ogg",
    "volume": 0.18,
    "fadeInMs": 2000
  },
  "events": {
    "presence": {
      "true":  { "file": "presence_on.ogg",  "volume": 0.6 },
      "false": { "file": "presence_off.ogg", "volume": 0.6 }
    },
    "threat": {
      "low":      { "file": "threat_low.ogg",      "volume": 0.55 },
      "medium":   { "file": "threat_medium.ogg",   "volume": 0.65 },
      "high":     { "file": "threat_high.ogg",     "volume": 0.75 },
      "critical": { "file": "threat_critical.ogg", "volume": 0.85 }
    },
    "task":   { "file": "task_ping.ogg",   "volume": 0.45 },
    "event":  { "file": "event_chime.ogg", "volume": 0.5  },
    "meeting": {
      "start": { "file": "meeting_start.ogg", "volume": 0.55 },
      "end":   { "file": "meeting_end.ogg",   "volume": 0.45 }
    },
    "player_chat_response": { "file": "chat_ding.ogg", "volume": 0.5 }
  }
}
```

### Event key conventions

| Key | Source |
|---|---|
| `presence` | `worldState.setPresence(bool)` — payload `{ zionPresent }` |
| `threat` | `worldState.pushThreat(...)` — payload includes `{ severity }` so the map can pick a sub-entry |
| `task` | `worldState.upsertTask(...)` |
| `event` | Generic `worldState.pushEvent(kind, text)` |
| `meeting` | `worldState.setMeeting({active, ...})` — emits `start` or `end` based on the value |
| `player_chat_response` | The browser sees `{type: "player_chat_response"}` directly on the WebSocket |

You can add any new key — just match the worldState `change` event kind
or pick a custom name and emit it from your code.

## Throttling

Each event-key has its own 350 ms cooldown. So a flurry of 5 `threat`
events of severity `high` in 200 ms will only fire `threat_high.ogg`
once. Different severities don't share the cooldown — `threat:high`
and `threat:critical` are independent keys.

Throttle window is set in `THROTTLE_MS` at the top of `src/sfx.js`.

## Browser autoplay caveats

Modern browsers block `audio.play()` until the user has interacted with
the page at least once. The module handles this by:

- Hooking `pointerdown` and `keydown` listeners that fire once.
- Trying to start the ambient loop on the first one of those.
- Silently swallowing `play()` rejections from event sounds — they'll
  work fine after the gesture.

If the ambient loop never starts and no console errors appear, the user
hasn't clicked the page yet.

## Plug-and-play with the voice gate

SFX runs alongside ElevenLabs (or whatever TTS provider is wired) — they
share the same presence gate but are otherwise independent:

- Voice plays when an NPC speaks.
- SFX plays on world events.
- Ambient loop plays continuously in the background.

All three respect `zionPresent`. Toggling presence off cuts everything
at once (voice in-flight, ambient, future event sounds).

## Cross-references

- [VOICE.md](VOICE.md) — the TTS layer using the same presence gate
- [WORLD-STATE.md](WORLD-STATE.md) — the events SFX listens to
- [ARCHITECTURE.md](ARCHITECTURE.md) — overall topology
