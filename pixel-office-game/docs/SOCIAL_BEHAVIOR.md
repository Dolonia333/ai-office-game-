# Denizen — Social Behavior

> The layer that sits on top of [AWARENESS](AWARENESS.md). Once an NPC
> *knows* what's around them, this doc covers what makes them *act*
> like a coworker: stopping mid-sentence when someone speaks to them,
> the receptionist offering a tour to a lost player, basic office
> manners in the system prompt, and silent thought bubbles for
> internal monologue.

## TL;DR

| Behavior | Trigger | What happens |
|---|---|---|
| **Conversation focus** | NPC A calls `speakTo(B, msg)` | B is pinned for ~8s, faces A, and B's next think prompt contains `Acknowledge them before doing anything else`. Any walk-y action B picks is auto-converted to `talk → A`. |
| **Receptionist tour** | Player has been idle >45s | Lucy walks to the player, greets them, then walks them past 2 nearest NPCs who introduce themselves. Cooldown 5 min. |
| **Office manners** | Every think cycle | Six short rules are appended to the system prompt: don't interrupt, acknowledge greetings, brevity, etc. |
| **Think aloud** | NPC emits `[ACTION:thinkAloud:...]` | Renders as a thought-cloud bubble. Does NOT pin anyone or generate audio. |

## Conversation focus (Phase A)

Before: NPC A says "Hey Josh" and walks at Josh. Josh, mid-think,
decides to take a coffee break and walks off as A arrives. Result: A
talks to empty air.

After:

1. `agent-actions.speakTo(A, B, text)` resolves with `mode='arrived'`:
   - B's facing flips toward A.
   - B's velocity is zeroed.
   - `B.ai._addressedUntil = scene.time.now + 8000`.
   - `B.ai._addressedBy = aKey`.
   - A `npc_addressed` WS message is sent to the server.
2. Server mirrors into `worldState.npcs[B].lastAddressed = { by, text, at }`.
3. B's *next* think prompt's `## Current State (live)` block contains:
   `- Alex just spoke to you 3s ago: "...". Acknowledge them before
   doing anything else — it is rude to walk off mid-conversation.`
   (Auto-expires at 30s.)
4. If B's next decision is `work`/`break`/`wander`/`visit`/
   `collaborate` while `_addressedUntil > now`, the
   `agent-office-manager._executeNpcDecision` guard rewrites it to
   `talk → A` so B physically stays put and responds.

### Why two layers (prompt hint *and* client guard)?

Belt and suspenders. The prompt hint gives the LLM a chance to write a
contextually-good reply. The client guard catches cases where the
prompt was ignored or the response was already in flight.

## Receptionist tour (Phase B)

`agent-office-manager._sendOfficeState` ships a `player_idle` WS
message each tick with `{ idleMs, position: { x, y, room } }`. The
server mirrors into `worldState.environment.playerIdleMs` and
`playerPosition`. Every NPC then sees a `Player presence: ...` line in
their context block when the player is in the office.

A separate client-side timer (`_maybeOfferTour`, every 15s) checks:

- Lucy is not currently `task_override` or `tour_guide`.
- Last tour was >5 minutes ago.
- Player has been idle >45s.

When all three hold, `_runLucyTour` walks Lucy to a spot beside the
player, has her greet them, picks the 2 nearest NPCs, walks her to
each, and sends `npc_introduce` for each stop. Server handler routes
that to `npcBrains.getResponse(stop, 'Lucy', context)` and broadcasts
the reply as a normal `npc_response`, so bubbles + voice work without
any new wiring.

## Office manners (Phase C)

A 6-line `## Office Manners` section is appended to every NPC's system
prompt just before `## Current State (live)`. Intentionally short —
the LLM only needs the gist:

```
- If someone is mid-sentence or just spoke to you, acknowledge them before walking off.
- If a peer is `busy` (meeting / walking), don't interrupt unless it's urgent.
- Greet people you haven't spoken to in a while; short small talk is fine.
- Don't repeat the same check-in question — vary your topic or wait.
- The CEO (the human player) gets a hello if they're standing near you.
- Brevity is a virtue. One short sentence usually beats three long ones.
```

Adding rules costs prompt tokens. Resist the urge to make this section
long — every bullet should match an observable bad behavior we want
gone.

## Think aloud (Phase D)

Added a new action: `[ACTION:thinkAloud:short internal thought]`.
Routed in `agent-office-manager` directly to `actions.think(npcKey, text)`,
which renders a thought-cloud bubble (not a speech bubble) over the
NPC's head. Does NOT trigger voice synthesis, does NOT pin nearby
NPCs into a conversation, does NOT count toward self-repetition.

Use cases (LLM picks naturally with the prompt hint):

- "I should follow up with Marcus..."
- "If this build fails one more time, I'm rewriting it in Go."
- "Wait, did I close the PR?"

## Files touched

- `src/world-state.js` — `renderContextBlock` surfaces `lastAddressed`
  and `playerPosition`. Independent of `zionPresent` (which is voice).
- `src/agent-actions.js` — `speakTo` `finish('arrived')` pins target
  with `_addressedUntil` and sends `npc_addressed` WS message.
- `src/agent-office-manager.js`:
  - `_executeNpcDecision` rewrites move-y actions while addressed.
  - `_sendOfficeState` sends `player_idle` with position + room.
  - `_maybeOfferTour` + `_runLucyTour` — tour scheduler + runner.
  - `case 'thinkAloud'` — action dispatch.
- `src/npc-brains.js` — `## Office Manners` block + `thinkAloud`
  action listed in the per-role action vocabulary.
- `server.js` — `npc_addressed`, `player_idle`, `npc_introduce`
  WS message handlers.

## What this is NOT

- Not a multi-party conversation manager. Two NPCs can be addressed at
  once but they don't share a "conversation room" abstraction. The
  `lastAddressed` field is per-NPC.
- Not a planner. Lucy doesn't *decide* to give a tour through her LLM;
  the tour is a scripted client-side routine triggered by idle time.
  Letting Lucy's brain decide would be a Phase B+ extension.
- Not an interruption model. NPCs can still be interrupted — the
  manners section just *encourages* not interrupting. There is no
  hard lockout.

## See also

- [AWARENESS.md](AWARENESS.md) — what NPCs know
- [AI-SYSTEM.md](AI-SYSTEM.md) — system prompt structure
- [ACTIONS.md](ACTIONS.md) — action vocabulary
- [WORLD-STATE.md](WORLD-STATE.md) — the singleton everything mutates
- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) — where this goes next
