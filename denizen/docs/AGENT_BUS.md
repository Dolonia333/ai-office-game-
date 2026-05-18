# Denizen — Agent Bus

> Pub/sub for direct NPC↔NPC messaging. Lives next to (not inside) the
> CofounderAgent: the CTO still gives top-down direction, but peer
> chatter no longer needs to round-trip through Abby.

Source: [`src/agent-bus.js`](../src/agent-bus.js). Wired into
[`NpcBrainManager`](../src/npc-brains.js) on init so every loaded NPC has
an inbox.

## When to use it vs. CofounderAgent

| Pattern | Use |
|---|---|
| Boss → reports cascade ("everyone go to standup") | **CofounderAgent**. It owns the office-wide narrative loop. |
| Peer → peer ("Alex tells Josh the API is down") | **AgentBus**. No reason to wake the CTO. |
| External system → one NPC (n8n posts a task to Oscar) | **AgentBus** via `POST /api/agent-bus`. |
| Broadcast world-state change (threat, task, presence) | **WorldState** `change` event — see [WORLD-STATE.md](WORLD-STATE.md). |

Rule of thumb: if the message is *addressed to a specific NPC*, use the
bus. If it's *something the office should know about*, use WorldState.

## API

```js
const agentBus = require('./src/agent-bus');

// Publish — addressed to exactly one recipient by display name.
agentBus.publish('Alex', {
  from: 'Abby',
  text: 'Review the auth PR',
  kind: 'speak',         // optional: 'speak' | 'collaborate' | 'report' | 'meeting' | ...
  meta: { /* anything */ },
});

// Subscribe — returns an unsubscribe function.
const off = agentBus.subscribe('Alex', (msg) => { /* msg has { id, to, from, kind, text, meta, ts } */ });
off();

// Wildcard — see every message that crosses the bus.
agentBus.subscribe('*', (msg) => { /* logging / UI mirror / tests */ });

// Reset (tests only).
agentBus.reset();
```

## Default-deny addressing

`publish('Alex', …)` does **not** fan out to every NPC that's listening
on the bus — only handlers attached to `'Alex'` (and any `'*'` wildcards)
see it. This is by design: agent-to-agent messages must be one-to-one,
because the recipient is supposed to react on their next think cycle as
if they got a real DM.

If you want broadcast semantics, send N publishes, or push an event into
WorldState instead.

## Buffering for offline subscribers

If you publish before anyone subscribes to that recipient, the message
is buffered in memory (cap 100 per recipient — newest wins). The first
subscriber drains the buffer synchronously in arrival order.

```js
agentBus.publish('Alex', { text: 'message-1' });   // buffered (no listener yet)
agentBus.publish('Alex', { text: 'message-2' });   // buffered

agentBus.subscribe('Alex', (m) => console.log(m.text));
// → "message-1"
// → "message-2"
```

This matters because NpcBrainManager subscribes once at init, but the
order of init steps vs. early publishes shouldn't matter. With the
buffer, it doesn't.

The wildcard channel (`'*'`) does **not** get the historical buffer —
it would be unbounded. Wildcards only see messages published after
they subscribe.

## Per-NPC inbox (NpcBrainManager)

Every loaded NPC has a private inbox managed by NpcBrainManager. On each
`think()` cycle, up to 6 messages are drained from the inbox and
prepended to the system prompt:

```markdown
## Direct Messages To You (since last think)
- from Abby: Review the auth PR
- from Bouncer: scan_probe from 192.168.1.50 — heads up
```

The NPC then reasons about those messages alongside the rest of its
context (goals, plan, theory of mind, world state) and decides what to
do next. If it chooses to reply by `talk`-ing to a peer, that reply also
goes back onto the bus, completing the loop.

Source: `_drainInbox()` in [`src/npc-brains.js`](../src/npc-brains.js).

## Message envelope

Every published message gets wrapped:

```js
{
  id:   1,                // monotonic, per-process
  to:   'Alex',           // recipient
  from: 'Abby',           // sender (default 'system')
  kind: 'speak',          // default 'speak'
  text: 'Review the PR',  // required
  meta: {},               // freeform
  ts:   1700000000000,    // server epoch ms
}
```

The id is monotonic per process — useful for ordering in logs but **do
not persist it as a database key.** It resets when the server restarts.

## HTTP entry point

```
POST /api/agent-bus
Content-Type: application/json

{ "to": "Alex", "from": "n8n", "text": "Deploy ran clean", "kind": "speak" }
```

Useful from external systems that want to poke a specific NPC without
opening a WebSocket connection. Validates `to` and `text`; on success
returns the wrapped message envelope.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `publish` returns `null` | Missing `to` or `text`, or `text` is not a string | Validate before calling |
| Subscriber throws and stops working | Bus catches the throw, logs `[AgentBus] subscriber error for "Alex"`, keeps going | Look at the next `[AgentBus]` warn line — your handler crashed, fix it |
| NPC never sees a message | Recipient name typo. Names are case-sensitive (`'Alex'`, not `'alex'`) | The wildcard `'*'` channel still saw it — use it for debug logging |
| Process memory grows | Subscriber count is unbounded if you forget to call the unsubscribe fn | Always store the return value of `subscribe()` and call it on cleanup |

## Implementation notes

- Built on Node's `EventEmitter`, with two namespaced channels:
  - `to:<recipient>` for addressed messages
  - `*` for the wildcard mirror
- `setMaxListeners(64)` so you can subscribe all 16 NPCs + a few
  wildcards without Node warning you about a listener leak.
- The bus is a **singleton** — every subsystem imports the same
  instance. There's also a named export `AgentBus` (the class) for
  tests that need an isolated instance.

## Tests

[`tests/agent-bus.test.js`](../tests/agent-bus.test.js) covers 11
behaviours: ordered drain, late publish, default-deny isolation,
wildcard mirroring, validation rejects, error containment, buffer cap,
unsubscribe, envelope shape. All passing in `npm test`.

## See also

- [WORLD-STATE.md](WORLD-STATE.md) — the broadcast layer (the bus
  handles addressed messages; WorldState handles facts that everyone
  should know)
- [AI-SYSTEM.md](AI-SYSTEM.md) — how the bus feeds into the NPC
  think loop
