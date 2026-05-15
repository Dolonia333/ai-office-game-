# CHANGELOG

## [Unreleased] — Autonomous NPC AI System (Phase 1-6)

### Why This Was Built
Denizen visualizes AI agent workflows in real-time. The NPCs represent AI agents running business tasks. For this to be a meaningful observability tool, the agents need to actually think, decide, collaborate, and learn autonomously — not just follow scripts. This set of changes replaces the scripted NPC behavior with a fully autonomous AI system powered by local LM Studio inference.

### What Was Done

#### Phase 1: Request Queue & Token Fix
**Problem:** 16 NPCs all calling LM Studio simultaneously overwhelmed the single GPU (4070 Ti Super). Every request timed out. Additionally, the `think()` function used `maxTokens: 150` but expected JSON responses of 250-400 characters, causing truncation → JSON parse failure → fallback to `{ action: 'work' }` every time.

**Fix:**
- Added sequential request queue (`_requestQueue[]` + `_processQueue()`) in `npc-brains.js` — one inference at a time, 60s timeout
- CofounderAgent routes through the same queue
- Increased `think()` to `maxTokens: 400, sliceLen: 600, temperature: 0.95`
- Increased `getResponse()` to `maxTokens: 200, sliceLen: 300`

#### Phase 2: Contextual Think Prompts
**Problem:** NPCs always chose "work" because the prompt was static and boring. The AI had no context about what was happening around it.

**Fix:**
- Rotate user prompts based on NPC state (work cycles, last decision, nearby NPCs, memory snippets)
- JSON schema moved from system prompt to user message (last thing model sees = better compliance)
- Trimmed system prompt to reduce input token count
- Added state-based nudges: "You've been working for 3 cycles, maybe take a break"

#### Phase 3: Memory-Aware Conversations
**Problem:** NPCs had generic conversations with no reference to shared history.

**Fix:**
- `getResponse()` now extracts memories relevant to the specific conversation partner
- Added `taskContext` including both NPCs' current work
- `saveMemory()` extracts `[TOPIC:tag]` entries for future retrieval

#### Phase 4: Visual Status Indicators
**Problem:** No way to see at a glance what each agent is doing (defeats the purpose of an observability tool).

**Fix:**
- Colored dots above each NPC: green=working, blue=talking, yellow=break, purple=meeting, red=error, gray=idle
- Task labels showing current work description (truncated to 25 chars)
- Updated every 500ms via `_updateStatusIndicators()`

#### Phase 5: Skill Extraction & Tracking
**Problem:** NPCs learn things in conversations but don't remember or build expertise.

**Fix:**
- `saveMemory()` detects learning keywords and appends `[SKILL:name:+1]` to MEMORY.md
- Added `_getSkillContext(npcName)` to parse and include skills in think prompts
- NPCs reference their skills when making decisions

#### Phase 6: State-Reactive CTO
**Problem:** The CTO (Abby) used 20+ hardcoded scripted scenarios that rotated randomly — felt robotic and ignored actual office state.

**Fix:**
- Replaced scripted prompts with `_buildStateReactivePrompt()` that observes real office state
- Counts idle/working/talking agents, spots opportunities
- Time-of-day awareness (morning standup, lunch breaks, afternoon reviews)
- References recent history to avoid repetition

### Bug Fixes

#### NPC Clustering at (400, 300)
**Problem:** NPCs cluster in a random spot in the middle of the office instead of using proper rooms.

**Root Causes:**
1. `office-scene.js` has `const t = ai.taskTarget || { x: 400, y: 300 }` — every NPC without a target converges here
2. The `'meeting'` action case only set status but never moved NPCs to the conference room
3. When pathfinding gives up, NPCs pretend to "work" wherever they stopped
4. Deskless NPCs sent to random center coordinates (300-800, 300-500)

**Fix:**
- Fallback coordinate now uses NPC's assigned desk position instead of hardcoded center
- `'meeting'` case now calls `joinMeeting()` and walks NPCs to conference room
- Pathfinding failure detection: if NPC is >60px from target, go to idle/wander instead of faking work
- Deskless NPCs sent to breakroom instead of random center

#### 6 NPCs Without Desks
**Problem:** Dan, Lucy, Bouncer, Marcus, Sarah, and Roki had no desk assignments because `_assignDesks()` filtered by role.

**Fix:** Removed role filter — all 16 NPCs get desk assignments.

#### Abby (CTO) Getting Stuck
**Problem:** Pathfinding to private office desk at (1188, 124) required crossing entire cluttered office. Physics collisions trapped her mid-walk.

**Fix:** Added `teleportToDesk()` — CTO teleports directly to private office on startup.

#### Token Truncation → Always "Work"
**Problem:** 90% of NPC decisions were "work" because JSON responses were truncated at 150 chars, causing parse failure and fallback.

**Fix:** Increased maxTokens to 400, sliceLen to 600.

### Architecture Decisions

- **Single GPU queue:** One inference at a time is the only viable approach for a 4070 Ti Super running Qwen2.5-14B. Parallel requests cause OOM or 60s+ timeouts.
- **Temperature 0.95:** Higher temperature produces varied decisions (break, talk, collaborate) instead of always choosing the "safe" work action.
- **Think interval 45-75s:** Balances responsiveness with queue sustainability for 16 NPCs.
- **Teleport for CTO:** Pathfinding across complex layouts is unreliable for the longest paths. Teleport is pragmatic.
- **Status dots as core feature:** Denizen IS observability. Visual indicators of agent state are the product, not decoration.

### Files Changed
| File | What Changed |
|------|-------------|
| `src/npc-brains.js` | Request queue, token limits, contextual prompts, skill extraction, memory-aware responses |
| `src/cofounder-agent.js` | State-reactive prompt, shared queue routing, error threshold |
| `src/agent-office-manager.js` | Status indicators, desk assignment for all, meeting/break movement, task labels |
| `src/agent-actions.js` | `teleportToDesk()`, collision body shrink during walks |
| `src/pathfinding.js` | Increased reroute limit (5) and stuck threshold (8s) |
| `office-scene.js` | Fallback position fix, pathfinding failure detection, _lastTarget reset |
| `npcs/*/MEMORY.md` | Accumulated NPC memories with topic tags and skill entries |
