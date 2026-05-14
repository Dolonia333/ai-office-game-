# Denizen — World State, Agent Bus, Voice Gate

> The "missing link" layer. Before this existed, every subsystem owned its
> own slice of state and there was no way to ask a single question like
> "what is the office doing right now?"

## What's new

| Module | Purpose |
|---|---|
| [`src/world-state.js`](../src/world-state.js) | Single in-memory object every subsystem reads from / writes to |
| [`src/agent-bus.js`](../src/agent-bus.js) | Pub/sub for direct NPC↔NPC messages — no CTO brokering |
| [`src/voice-gate.js`](../src/voice-gate.js) | Browser-side presence flag + pluggable TTS (default: SpeechSynthesis) |
| `/api/world-state`, `/api/presence`, `/api/task-update`, `/api/agent-bus` | HTTP entry points |

The architecture in one diagram:

```
                          ┌──────────────────────────┐
                          │     WorldState (singleton)│
                          │  zionPresent              │
                          │  npcs[name] = {...}       │
                          │  activeThreats[]          │
                          │  backgroundTasks[]        │
                          │  foregroundTasks[]        │
                          │  recentEvents[]           │
                          │  environment.meeting…     │
                          └─────────▲──────┬─────────┘
                                    │      │
              writes ────────┬──────┼──────┼──────┬──── reads
                             │      │      │      │
                  ┌──────────▼─┐ ┌──▼──┐ ┌─▼──┐ ┌─▼─────────────┐
                  │ Cofounder  │ │ NPC │ │Sec │ │  HTTP / n8n    │
                  │ (positions)│ │ ↑↓  │ │mon │ │  /api/task-…   │
                  └────────────┘ │     │ └────┘ └────────────────┘
                                 │     │
                                 │     │   broadcast on every change
                                 │     │   ──► /agent-ws (browser)
                                 │     │
                                 ▼     ▲
                       ┌─────────────────────┐
                       │   AgentBus          │
                       │  publish(to, msg)   │
                       │  subscribe(name, …) │
                       └─────────────────────┘
```

---

## WorldState

Singleton at `src/world-state.js`. Tiny EventEmitter under the hood.

### Shape

```js
{
  zionPresent: false,                 // voice gate
  npcs: {                             // keyed by display name
    Alex: { position:{x,y}, state:'working', lastAction:'...', currentTask:'...', room:'open_office', updatedAt: 0 }
  },
  activeThreats: [{ category, severity, source, target, detail, ts }],
  backgroundTasks: [{ id, source, title, status, assignee, detail, createdAt, updatedAt }],
  foregroundTasks: [...],
  recentEvents: [{ kind, text, ts }],
  environment: { meetingInProgress, meetingAttendees:[], time }
}
```

### API

```js
const worldState = require('./src/world-state');

worldState.setPresence(true);                    // voice gate ON
worldState.updateNpc('Alex', { state: 'walking', position: { x: 100, y: 200 } });
worldState.npcsNear(100, 200, 120);              // ['Alex', 'Josh']  (sorted by distance)
worldState.pushThreat({ category: 'scan_probe', severity: 'high', source: '1.2.3.4', detail: 'nmap' });
worldState.upsertTask({ id: 'job-42', title: 'Build login', status: 'running' });
worldState.pushEvent('shipped', 'Edward finished login flow');
worldState.setMeeting({ active: true, attendees: ['Abby', 'Marcus'] });
worldState.snapshot();                           // JSON-safe deep copy of everything
worldState.renderContextBlock('Alex');           // markdown for the NPC system prompt
worldState.on('change', ({kind, payload, snapshot}) => { /* fan-out */ });
```

### Caps (so a chatty subsystem can't OOM us)

- `activeThreats`: 8
- `recentEvents`: 12
- `backgroundTasks`/`foregroundTasks`: 25 each

Tune in the constructor.

---

## AgentBus

Pub/sub for direct NPC↔NPC messages. Sits next to (not inside) the
CofounderAgent: the CTO still gives top-down direction, but peer chatter
no longer needs to round-trip through Abby.

```js
const agentBus = require('./src/agent-bus');

agentBus.subscribe('Alex', (msg) => console.log(msg)); // returns unsubscribe()
agentBus.publish('Alex', { from: 'Abby', text: 'Review this PR', kind: 'speak' });
agentBus.subscribe('*', (msg) => /* mirror to UI */);
```

### Behaviour worth knowing

- **Default-deny addressing.** A `publish('Alex', …)` does NOT fan out to
  every NPC. Use `subscribe('*', …)` only for logging/UI mirroring.
- **Buffered for offline subscribers.** If you publish before anyone
  subscribes, the first subscriber drains the buffer (capped at 100/recipient).
- **Subscriber errors are caught.** A buggy handler can't crash the
  publisher — the bus logs and moves on.
- **Wired into NpcBrainManager automatically.** Every loaded NPC has an
  inbox; the next `think()` cycle drains up to 6 messages and renders them
  as `## Direct Messages To You (since last think)` in the system prompt.

---

## Voice Gate

`src/voice-gate.js` runs in the browser. It owns three things:

1. **`window.DenizenPresence`** — `{ zionPresent: bool }`, mirrored from server.
2. **`window.DenizenSpeak(npcName, text)`** — fire-and-forget audio. No-op
   when `zionPresent` is false. By default uses the browser's
   `SpeechSynthesis` API with a per-NPC pitch jitter so different
   characters sound different.
3. **Hotkey `Alt+V`** to toggle presence without leaving the page.

### Plugging in ElevenLabs (or any other TTS)

Set a single global before `voice-gate.js` runs (or any time after):

```js
window.DenizenVoiceProvider = async (npcName, text) => {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npcName, text }),
  });
  const blob = await r.blob();
  new Audio(URL.createObjectURL(blob)).play();
};
```

The gate then calls your provider whenever an NPC speaks — but only when
`zionPresent` is true. Bubbles always render either way.

---

## HTTP endpoints

All return JSON. Errors are HTTP 4xx with `{ error }`.

| Method | Path | Body | Effect |
|---|---|---|---|
| `GET`  | `/api/world-state`  | — | Full snapshot |
| `GET`  | `/api/presence`     | — | `{ zionPresent }` |
| `POST` | `/api/presence`     | `{ present: bool }` | Toggle |
| `POST` | `/api/task-update`  | `{ id, title, status?, assignee?, detail?, source?, foreground? }` | Upsert into `backgroundTasks` (or `foregroundTasks` if `foreground:true`); emits a `task` event |
| `POST` | `/api/agent-bus`    | `{ to, from?, text, kind? }` | Inject a message addressed to one NPC |

### Example: n8n → Denizen

In your n8n workflow add an HTTP Request node:

```
URL:    http://denizen.lan:8080/api/task-update
Method: POST
Body:   {
  "id":       "{{$json.workflow_run_id}}",
  "title":    "{{$json.workflow_name}}",
  "status":   "running",
  "assignee": "Oscar",
  "source":   "n8n"
}
```

The next NPC think cycle picks it up via the Current State block; Oscar
spots his name in the assignee field and walks to his desk.

---

## How the client mirrors all of this

Server side, every `worldState.on('change', …)` and every `agentBus.subscribe('*', …)`
fans out a JSON message to every connected `/agent-ws` client:

```jsonc
{ "type": "world_state", "kind": "presence", "payload": { "zionPresent": true }, "ts": 0 }
{ "type": "world_state", "kind": "task",     "payload": { "task": {...}, "foreground": false } }
{ "type": "world_state", "kind": "threat",   "payload": { ... } }
{ "type": "agent_bus",   "msg": { "to": "Alex", "from": "Abby", "text": "..." } }
```

`src/agent-office-manager.js` already attaches the WebSocket to
`window.__DenizenAgentWs`, so any module — `voice-gate.js`,
`openclaw-chat.js`, your own — can listen on the same connection without
opening a second one.

---

## Live context block in NPC prompts

Every `npc-brains.think()` call prepends a small live-context section to
the system prompt:

```markdown
## Current State (live)
- You are: working in open_office
- Your last action: reviewed PR from Josh
- Current task: fixing login bug
- Nearby: Josh (walking), Bob (idle)
- Room activity: Marcus: meeting prep; Abby: 1:1 with Sarah
- Active threats: 1 (latest: scan_probe high)
- Background jobs: 3/5 running
```

Plus, if any peers messaged the NPC via the bus since the last cycle:

```markdown
## Direct Messages To You (since last think)
- from Abby: PR ready for review
- from Bouncer: scan_probe from 192.168.1.50
```

This is what gives NPCs **live awareness** — they no longer plan from a
stale snapshot of the office; they plan from what is happening right now.

---

## Testing

```bash
npm test
```

61 tests including:

- `tests/world-state.test.js` — presence, npc state, threats, tasks, render block, change events
- `tests/agent-bus.test.js` — addressing, buffering, wildcard, validation, unsubscribe
- (existing 38) — pathfinding, npc-brains, npc-roster, room-generator

End-to-end smoke (no LM Studio required):

```bash
PORT=8090 npm start &
curl -X POST -H 'Content-Type: application/json' \
  -d '{"present":true}' http://localhost:8090/api/presence
curl -X POST -H 'Content-Type: application/json' \
  -d '{"id":"job-42","title":"Build login","status":"running","assignee":"Edward","source":"n8n"}' \
  http://localhost:8090/api/task-update
curl http://localhost:8090/api/world-state | jq
```

---

## See also

- [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/AI-SYSTEM.md](AI-SYSTEM.md)
- [docs/SECURITY.md](SECURITY.md)
- [docs/SETUP.md](SETUP.md)
