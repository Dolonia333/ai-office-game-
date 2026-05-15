# Denizen — NPC Intelligence System

The AI layer that makes 16 NPCs feel like autonomous agents instead of scripted sprites. This document covers the server-side brain in [`src/npc-brains.js`](../src/npc-brains.js) and the director in [`src/cofounder-agent.js`](../src/cofounder-agent.js).

## The mental model

Every NPC is an agent with:

1. **Identity** — a personality from `npcs/<name>/SOUL.md` (loaded once at startup, immutable).
2. **Memory** — an append-only `npcs/<name>/MEMORY.md` file, capped at 200 lines.
3. **State** — per-NPC server-side maps tracking goals, plans, relationships, think cycles, last decision, and current task.
4. **A brain** — one LLM provider (usually LM Studio locally) that runs `think()` and `getResponse()` on demand.

Every 45-75 seconds, each NPC's brain is called with the full context (SOUL + relevant memory + current state + the whole office's state) and asked: *what do you do next?* The reply is a single JSON object that the game then enacts.

The goal of this document is to explain exactly what's inside that JSON, why each field is there, and what the brain reads before generating it.

## Data structures

### Per-NPC state (in `NpcBrainManager`)

```js
this.brains[name] = {
  provider,          // "lmstudio" usually, else "claude"/"gemini"/"grok"/"kimi"
  role,              // e.g. "Senior Developer — team lead"
  personality,       // full SOUL.md content
  longTermMemory,    // full MEMORY.md content (reloaded after each save)
  providerConfig,    // base URL, api key, model
  fallbackConfig,    // null — no paid API fallback, canned responses only
};

this.memories[name] = [];           // last 50 {from, text} messages
this._thinkCycles[name] = 0;        // consecutive work cycles for fatigue hint
this._lastDecisions[name] = {...};  // most recent decision object
this._taskProgress[name] = {task, phase, startedAt};

// Intelligence layer (added in the latest upgrade)
this._npcGoals[name] = {goal, createdAt, progress};
this._dailyPlans[name] = {date, priorities, createdAt, goalReference};
this._npcRelationships[name] = {[otherName]: {interactions, lastAt}};
this._eventFeed = [{kind, text, at}];    // office-wide, last 12 events
this._sharedTasks = [{task, postedBy, at, claimedBy}];
```

## `think()` — the main decision loop

Location: [`src/npc-brains.js`](../src/npc-brains.js) — `think(npcName, officeContext)`.

Called by the server when it receives an `npc_think` message. Returns a decision JSON.

### The system prompt (what the LLM sees)

Assembled in order, each section only shown if it has content:

1. `personality` — full SOUL.md. Sets character voice and role.
2. `## Hierarchy Rules` — who the NPC reports to / manages, tied to the `_hierarchy` org chart.
3. `## Your Teams` — team memberships derived from hierarchy.
4. `## Your Long-Term Goal` — role-seeded goal from `_getGoalContext()`. Persists across think cycles.
5. `## Today's Priorities` — 3 role-driven priorities from `getDailyPlan()`, regenerated once per calendar day.
6. `## Skills & Growth` — aggregated `[SKILL:*:+1]` tags from memory (top 8).
7. `## Your Coworkers` — coworker awareness list.
8. `## What Others Are Doing` — theory of mind: 4 other NPCs' most recent action + current task.
9. `## Recent Office Events` — last 4 broadcast events (meetings called, work shipped, people stuck).
10. `## Open Tasks (anyone can claim)` — unclaimed items from the shared task board.
11. `## Your Memories` — last 1200 chars of MEMORY.md, sanitized.
12. `## Recent Conversations` — last 10 `{from, text}` messages.
13. `## Task Continuity` — last decision + current task.
14. `## Current Office State` — description passed in from the client (who's where, what just happened).
15. `## Nearby` — 5 closest furniture items with distance.
16. `## Your Natural Hangout` — role-based room affinity (Abby→manager office, Lucy→reception, etc.).
17. `## Energy Level` — fatigue hint after 2+ consecutive work cycles.
18. Hierarchy enforcement reminders, think-about prompts, action-balance weighting.

### The user prompt

A short contextual nudge (e.g. "You've been working non-stop for 4 cycles") plus the JSON schema the model must fill in:

```json
{
  "reasoning": "1-2 sentences tracing: state, what matters, why this action",
  "plan": "one-line projected next 2 steps",
  "thought": "internal monologue (one sentence)",
  "action": "talk|work|collaborate|break|check|meeting|report|read|visit|coffee|wander",
  "target": "NPC name or null",
  "location": "desk|breakroom|conference|storage|manager_office|reception|open_office|null",
  "message": "what you say out loud (under 120 chars)",
  "taskPhase": "starting|continuing|finished|none",
  "save": "brief note for your memory",
  "outcome": "ok|stuck|blocked|success|null"
}
```

Settings: `max_tokens=400`, `temperature=0.95`, `top_p` default. Qwen2.5-14B at these settings reliably returns valid JSON with full reasoning chains.

### Post-processing

After parse, the think handler:

1. Updates think-cycle counter (reset on any non-"work" action).
2. Saves `_lastDecisions[npc]` for continuity next cycle.
3. Updates `_taskProgress` based on `taskPhase` (`starting` opens a task, `finished` closes it, `continuing` rolls forward).
4. Auto-redirects a finished task's action to `report` and targets the manager.
5. Appends `save` to MEMORY.md with enrichment: `[STARTING|CONTINUING|FINISHED]` + `[OUTCOME:*]` + `(spoke to X, my report)` relationship tag.
6. Records the interaction in `_npcRelationships`.
7. Increments `_npcGoals[npc].progress` on task finish.
8. Broadcasts office events: meetings called, work shipped successfully, blockers reported.
9. Cascades decisions down to reports if the NPC is a manager.

### Memory capped at 200 lines

`saveMemory()` trims oldest 50 lines once the file hits 200. Topic tags (`[TOPIC:auth-refactor]`) and skill tags (`[SKILL:react:+1]`) are auto-extracted from the save text using regexes. This keeps memory files searchable without an index.

## `getResponse()` — conversation replies

Same provider, same memory, different prompt. Used when another NPC speaks to this one.

### The system prompt

1. `personality` (SOUL.md).
2. `## Past interactions with <fromName>` — MEMORY.md lines filtered to only those mentioning the speaker.
3. `## Recent memories` — last 5 lines regardless.
4. `## Your Coworkers`.
5. "You're in a pixel office game. You're having a conversation at work. Role: …"
6. Current task context (theirs and yours) if either has an active task.

### Conversation memory

`this.memories[npcName]` is an in-memory array of the last 50 `{from, text}` objects. Every incoming message is pushed, every response is pushed. This becomes the `messages` array sent to the LLM — so each NPC has a genuine conversation context, not a single-turn prompt.

### Reply-back loop

Client-side ([`agent-office-manager.js`](../src/agent-office-manager.js), case `npc_response`):

1. Responder arrives at speaker, bubble shown.
2. If `turn < MAX_CHAT_TURNS (4)`, after 1800ms the responder walks back to the original speaker with their just-generated line — and the original speaker is now asked to reply.
3. Continues until turn cap hits or either side says "no reply".

Cap raised from 2 → 4 in the latest upgrade. Conversations now actually develop (assertion → pushback → adjustment → close) instead of being one-shot exchanges.

## `CofounderAgent` — the director

Location: [`src/cofounder-agent.js`](../src/cofounder-agent.js).

A separate agent running every 15-30s. Think of it as the CTO puppeteer — it doesn't *belong* to any NPC, it choreographs the whole office. Its decisions emit `agent_command` broadcasts that the game client enacts.

### State-reactive prompt

Not a fixed script. `_buildStateReactivePrompt()` observes:

- Idle vs working vs talking counts
- Spotlight on a random agent
- **Recent office events** from the shared event feed (`meeting`, `shipped`, `blocker`)
- **Stuck/blocked agents** flagged as priority
- Time-of-day suggestions (morning→standup, lunch→breaks, afternoon→code review)
- Last 2 turns of its own conversation history

The prompt ends with: *"As CTO, decide what should happen next. If anyone is stuck/blocked, address that first."*

### Output shape

JSON array of 2-4 commands, each like:

```json
{"action": "speakTo", "agentId": "Abby", "params": {"target": "Alex", "text": "How's the sprint?"}}
```

Supported actions include `speakTo`, `speak`, `useComputer`, `walkTo`, `goToBreakroom`, `goToRoom`, `callMeeting`, `joinMeeting`, `reportToCEO`, `emote`.

Truncated-JSON salvage: if the response hits the max_tokens ceiling mid-array, `_salvageTruncatedArray()` extracts all complete objects up to the truncation point.

### Circuit breaker

After 5 consecutive errors, the CTO switches to a pre-scripted demo loop (a rotation of 20 canned command sets). This keeps the office visually alive even during LM Studio outages.

## Goal and plan generation

### Goals (per NPC, persistent)

`_getGoalContext(npcName)` returns the NPC's long-term goal. Seeded on first call from a role→goal table (e.g. Abby's CTO role → "Keep the team unblocked and shipping steadily"). Stored in-memory for the session. Surfaced in the think prompt as `## Your Long-Term Goal`.

### Daily plans (per NPC, per calendar day)

`getDailyPlan(npcName)` returns today's three priorities. Regenerated at midnight (on first think of the new date). Currently role-seeded from a static table; future work is to have the LLM regenerate these at the start of the day based on recent memory + goal progress.

### Skill tracking

`saveMemory()` detects learning keywords (`learned`, `taught`, `figured out`, `picked up`, …) and auto-appends a `[SKILL:<topic>:+1]` tag. `_getSkillContext()` aggregates these and shows the top 8 with their cumulative count in the prompt.

## Theory of mind

`_getTheoryOfMind(npcName, limit=4)` returns short descriptions of what 4 other NPCs just did:

```
- Alex: just chose "talk" (working on "finish auth")
- Molly: just chose "work" (working on "regression suite")
- Rob: just chose "break"
- Bouncer: just chose "wander"
```

This dramatically improves coordination — when Abby thinks, she can see Alex is already talking (don't interrupt), Molly is deep in regression (maybe follow up later), Rob is on break (natural moment to pop by the break room).

## Event feed and shared tasks

Two office-wide data streams visible to every NPC's brain:

### Event feed — `_eventFeed`

Auto-populated from notable `think()` decisions:

- `meeting` — when an NPC picks `action=meeting`
- `shipped` — when `taskPhase=finished` and `outcome=success`
- `blocker` — when `outcome` is `stuck` or `blocked`

Capped at 12, last 4 surfaced in the prompt. The CofounderAgent also reads this to react to what's actually happening.

### Shared task board — `_sharedTasks`

`addSharedTask(task, postedBy)` lets any NPC (or the CTO, or external code) post a task. Unclaimed tasks appear in every NPC's think prompt as `## Open Tasks (anyone can claim)`. Claimed tasks don't show up anymore. Useful for "help wanted" signals and for unblocking stuck agents.

## Memory tags — the little things that make it searchable

Every time `saveMemory()` runs, up to three extra lines are appended:

1. **Outcome-enriched save** — prefix `[OUTCOME:ok|stuck|blocked|success]` if the outcome field was set.
2. **Topic tag** — regex-extracted. Matches on `about X`, `on X`, `regarding X`, `working on X`, `fixing X`, etc. Gets truncated and slugged: `[TOPIC:auth-refactor]`.
3. **Skill tag** — only if the save text contains a learning verb. Extracted topic after `about|at|in|with|regarding` → `[SKILL:react:+1]`.

Aggregation queries (used in the think prompt) simply grep the memory file for `[TAG:]` patterns. No database, no indexer, no format migration cost.

## Relationships (social graph)

`_recordRelationship(fromName, toName)` — called every think cycle when a decision has a target. Stores `{interactions, lastAt}` per ordered pair. Currently surfaced indirectly (via the Coworkers section). Future work: use it to weight theory-of-mind toward NPCs the actor interacts with most, and to enable a "who does X know best" query for the CofounderAgent.

## GPU budget

The whole intelligence layer fits in one queue:

- All 16 NPC brains + 1 CofounderAgent share a single request queue to LM Studio.
- `_callLocal()` processes one at a time — GPU can only run one inference anyway.
- Circuit breaker: 5 failures in a row → 30s cooldown. Queued requests reject fast so they don't pile up and time out individually.
- Typical steady-state queue depth: 2-4 requests.
- If the provider is unhealthy, individual NPCs fall back to canned responses (for conversations) or return an `error` action (for think), and the game keeps moving.

## Recent changes (what the last commits did)

### `0f0ccd2` feat(ai): NPCs get long-term goals, daily plans, theory of mind, outcomes

Added the persistent intelligence state maps, the new prompt sections (goals, plans, ToM, events, task board), the chain-of-thought schema (`reasoning`, `plan`, `outcome`), outcome tagging in `saveMemory`, and the state-reactive CofounderAgent. Raised the chat reply-back turn cap from 2 to 4.

### `3306687` feat(map): NPCs actually use the whole office

Expanded action vocabulary (`read`, `visit`, `coffee`, `wander`), role-based room affinity, nearby furniture context, ambient wander, role routines (receptionist rotation, security patrol), reception visitor spawning.

### `1526a85` feat(nav): overhaul NPC navigation

A* soft-cost halo, separation steering, target snap, finer 8px grid, stuck detection, speaker slot cap. Fixes pile-ups and wall-stuck NPCs.

## Tuning knobs

| What | Where | Current value |
|---|---|---|
| Think interval | `npc-agent-controller.js` (client) | 45-75s |
| Think max tokens | `npc-brains.js` `think()` | 400 |
| Think temperature | `npc-brains.js` `think()` | 0.95 |
| Response max tokens | `npc-brains.js` `getResponse()` | 200 |
| Chat reply-back cap | `agent-office-manager.js` `MAX_CHAT_TURNS` | 4 |
| CofounderAgent interval | `cofounder-agent.js` `scheduleNextThink` | 15-30s |
| CofounderAgent max tokens | `cofounder-agent.js` | 1024 |
| Memory file cap | `npc-brains.js` `saveMemory` | 200 lines |
| Cooldown on provider failure | `npc-brains.js` `_processQueue` | 30s after 5 failures |

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — how this fits into the whole stack
- [SECURITY.md](SECURITY.md) — the threat visualization layer (independent of this AI layer)
- [SETUP.md](SETUP.md) — runtime setup
