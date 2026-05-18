# Denizen — Actions and Office Manager

> The "verbs" of Denizen. NPC brains decide WHAT to do; this layer
> decides HOW. Whenever you see `actions.speak(npcKey, text)` in the
> codebase, that call lands here.

Two files, tightly coupled:

- **`src/agent-actions.js`** (1183 lines) — concrete action
  implementations: walk to a chair, sit down, type at a desk, show a
  speech bubble, call out to a peer.
- **`src/agent-office-manager.js`** (1626 lines) — coordinator. Owns
  the WebSocket to the server, dispatches cofounder commands to the
  right NPC, brokers meetings, manages the per-NPC turn queue.

The split is deliberate: `agent-actions.js` knows nothing about LLMs or
WebSockets — it's pure scene manipulation. `agent-office-manager.js`
knows nothing about sprite Y-coordinates — it's pure orchestration.
That's why you can unit-test the manager without booting Phaser.

## Action vocabulary

Every action takes `npcKey` (a sprite texture key like `xp_alex`) as
the first argument. They're all idempotent in the sense that calling
the same action while one is already in progress will queue or
no-op rather than crash.

| Action | Signature | What it does |
|---|---|---|
| `walkTo` | `(npcKey, x, y)` | A* route to (x,y). Auto-recovers from blocked cells via the stuck counter. |
| `speak` | `(npcKey, text, durationMs)` | Speech bubble above NPC. Duration `0` means persist until next `speak`. Always also calls `window.DenizenSpeak()` so voice plays when presence is on. |
| `speakTo` | `(npcKey, targetKey, text)` | Walk to `targetKey`, then `speak()` once arrived. Cofounder uses this for one-on-one conversations. |
| `useComputer` | `(npcKey, deskId)` | Walk to the chair attached to `deskId`, sit, play typing animation. The "default" working state. |
| `standUp` | `(npcKey)` | Reverse of sit. Restores depth + Y so the sprite isn't stuck behind the chair. |
| `goToBreakroom` | `(npcKey)` | Walk to a random spot in the breakroom; play idle anim. |
| `goToRoom` | `(npcKey, roomKey)` | Generic walk-to-room — `open_office`, `manager_office`, `conference`, `breakroom`, `reception`, `storage`. |
| `joinMeeting` | `(npcKey)` | Walk to the next free chair in the conference room and sit. Increments `_standingMeetingNpcs` if all chairs are taken (NPC stands at the table). |
| `callMeeting` | (manager only — see below) | Calls `joinMeeting()` for every attendee in parallel. Sets `worldState.setMeeting({active:true, attendees})`. |
| `checkBookshelf` | `(npcKey, shelfId)` | Walk to a bookshelf, play "searching" animation. |
| `reportToCEO` | `(npcKey)` | Walk to the player. Used after delegation chains finish ("here's what Bob found"). |
| `emote` | `(npcKey, type)` | Display a small emoji bubble (`!`, `?`, `💡`, `❗`, …). Lighter than `speak`. |
| `think` | `(npcKey, text)` | Show a **thought-cloud** bubble (not a speech bubble). Backs the `thinkAloud` brain action — internal monologue that does NOT pin nearby NPCs and does NOT trigger TTS. See [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md). |

### Brain-driven action tags

Actions above are the JS API the manager calls. Below are the `[ACTION:*]` tags
the NPC's LLM brain emits in its response — the manager parses them and routes
to the right JS call (or proposal queue endpoint).

| Tag | Routes to | Notes |
|---|---|---|
| `[ACTION:useComputer]` | `useComputer` | Sit at assigned desk. |
| `[ACTION:goToBreakroom]` | `goToBreakroom` | — |
| `[ACTION:goToRoom:<key>]` | `goToRoom` | `open_office` / `conference` / `breakroom` / `manager_office` / `storage` / `reception` |
| `[ACTION:speakTo:<name>:<msg>]` | `speakTo` + reply pipeline | Triggers **conversation focus** on the recipient — they get pinned ~8s and their next think prompt sees `lastAddressed`. See [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md). |
| `[ACTION:callMeeting:<n1,n2,n3>]` | `callMeeting` | — |
| `[ACTION:checkBookshelf]` | `checkBookshelf` | — |
| `[ACTION:standUp]` | `standUp` | — |
| `[ACTION:thinkAloud:<text>]` | `think` (thought bubble) | Silent internal monologue. No pin, no TTS, no peer-side wakeup. |
| `[ACTION:placeFurniture:<prefab>:<x>:<y>:<reason>]` | `POST /api/place-furniture` → `furniture_placed` WS broadcast → live sprite spawn | 15-prefab whitelist + bounds check. 3/NPC/day budget. See roadmap Stage 1. |
| `[ACTION:removeFurniture:<instanceId>]` | `POST /api/remove-furniture` → `furniture_removed` broadcast | Only `npc_*` instanceIds; scene furniture is read-only. |
| `[ACTION:requestAnimation:<animName>:<description>]` | `POST /api/request-animation` (proposal queue, no live spawn) | Operator-gated; 2/NPC/day. See [ANIMATION_FORGE.md](ANIMATION_FORGE.md). |
| `[ACTION:requestCapability:<verbName>:<description>]` | `POST /api/request-capability` (proposal queue) | Operator-gated; 1/NPC/day. See [CAPABILITY_PROPOSALS.md](CAPABILITY_PROPOSALS.md). |
| `[DELEGATE:<name>:<reason>]` | Inter-NPC delegation routing | — |

### Side effects every action shares

- **Pathfinding kicks in automatically.** No manual route handoff —
  `walkTo` and friends call `_pathFollower.navigateTo(x, y)` and the
  follower advances each frame in the scene's `update()` loop.
- **Animation state machine.** Each action sets the right `walk_*` /
  `idle_*` / `sit_*` animation key. The scene's `update()` later
  guards against redundant `setFrame()` calls so idle NPCs don't burn
  CPU.
- **Depth flag.** Every action that moves a sprite sets the scene's
  `_depthDirty = true` so the Y-sort runs once on the next frame.

## How the cofounder reaches an action

```
NpcBrains.think('Alex')   →   { action: 'speakTo', target: 'Josh', message: 'PR ready' }
        │
        ▼   (sent over /agent-ws as type:'npc_decision')
AgentOfficeManager.handleClientMessage(decision)
        │
        ▼   normalize name + look up sprite
this.actions.speakTo('xp_alex', 'xp_josh', 'PR ready')
        │
        ▼
NpcPathFollower.navigateTo(joshX, joshY)
        │  (each frame, scene.update())
        ▼
on arrival → actions.speak('xp_alex', 'PR ready', 4000)
        │
        ▼
window.DenizenSpeak('Alex', 'PR ready')   ← voice gate fires
```

`agent-office-manager.js` owns the case statements that route
`{ action: 'X' }` to `this.actions.X(...)`. Every action declared in
`AgentActions` must have a corresponding case in the manager — adding a
new action is a two-file change.

## Meetings — the special case

Meetings are the most complex thing in this layer because they require
coordinating multiple NPCs converging on a fixed location, sitting, and
returning to work afterwards.

```js
// Cofounder issues:
this.actions.callMeeting('Abby', { attendees: ['Alex', 'Marcus', 'Sarah'] });
```

Internally:

1. Manager (line 1284) marks the conference room as in-use, writes
   `worldState.setMeeting({active:true, attendees:[Abby, Alex, Marcus, Sarah]})`.
2. For each attendee, calls `actions.joinMeeting(npcKey)`. Each
   attendee runs A* to the next free chair.
3. While walking, attendees can't take other actions (manager guards
   their `taskState`).
4. After 30s (or when the cofounder issues a "meeting end" command),
   each attendee `standUp()`s and returns to their assigned desk.
5. `worldState.setMeeting({active:false})` fires.

The manager's `_standingMeetingNpcs` set tracks who's standing because
all the chairs are taken — those NPCs cluster around the table. The
positioning math is in `_findChairNearMeeting()`.

## Turn queue

The manager has a per-NPC turn queue (`this._turnQueues[npcKey]`) that
serializes actions for the same NPC. Without it, two near-simultaneous
LLM decisions for Alex (one from his own think loop, one from a
cascade) would both fire `walkTo`, the second would stomp the first,
and Alex would oscillate.

Queue rule: an action can only run if the previous action for that NPC
has either resolved (`onArrive` fired, `onSpeakDone` fired) or been
explicitly cancelled. Cofounder commands jump the queue if marked
`urgent: true` (currently used only for meetings and `reportToCEO`).

## Demo mode

When `manager._demoMode = true`, the per-NPC turn queue stops accepting
new entries from the brain loop — only the demo script can issue
actions. This is what lets `?demo=tour` and `?demo=investor` keep their
timing without random LLM decisions interfering.

## Adding a new action

1. **Add the implementation** in `agent-actions.js`. Follow the pattern
   of an existing action (`speak` is the simplest model).
2. **Add the dispatch case** in `agent-office-manager.js` —
   `_handleNpcDecision` (around line 1284) is the main switch.
3. **Add the action name to the cofounder's prompt** in
   `src/cofounder-agent.js` (`_getSystemPrompt`, around line 107) so
   the CTO knows it can be invoked.
4. **Add a JSON-schema description** in `src/npc-brains.js` (the
   `think()` system prompt, in the `### Actions you can take`
   section).
5. Optional: if the action mutates worldState, call the appropriate
   `worldState.update*()` method so the UI + n8n + voice gate all see
   it.

## Cross-references

- [AI-SYSTEM.md](AI-SYSTEM.md) — the brain that produces decisions
- [SCENE.md](SCENE.md) — where actions actually render
- [PATHFINDING.md](PATHFINDING.md) — what `walkTo` calls into
- [WORLD-STATE.md](WORLD-STATE.md) — the singleton actions write into
