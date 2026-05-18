# Denizen — Roadmap: NPCs That Build, Animate, and Self-Advance

> Vision: NPCs gradually extend their own capabilities — adding furniture
> to the office, creating sprite animations for actions that don't have
> them yet, and reflecting on their own behavior to revise their soul
> files. This doc is the staged plan toward that endpoint.

Not a build target for any single sprint. Each stage is meaningful on
its own and can ship independently.

## What just shipped (stages 0 + 1 + 3 steps 1-4)

- **Awareness layer expanded** — room topology, convoy detection, desk
  geography, busy state, room occupancy, per-peer last-contact,
  self-repetition. See [AWARENESS.md](AWARENESS.md).
- **Social-behavior layer** — conversation focus (peer + player),
  receptionist tour, office manners block, think-aloud bubbles,
  fatigue tracking, cross-NPC stuck-loop detection. See
  [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md).
- **`placeFurniture` with live spawn (Stage 1)** — NPCs call
  `[ACTION:placeFurniture:prefabId:x:y:reason]`. The server validates
  against a whitelist + bounds, persists to
  `layouts/office-layout.json`, emits a `furniture_placed` broadcast
  on `/agent-ws`. The client subscribes and spawns the sprite live via
  `window.DenizenLiveFurniture.spawn` — no reload required. The new
  entry lands in `_interactables`, the next `_sendOfficeState` cycle
  mirrors it into `worldState`, and other NPCs see it on their next
  think.
- **`removeFurniture` action (Stage 1)** —
  `[ACTION:removeFurniture:instanceId]`. Only items whose
  `instanceId` starts with `npc_` are removable; hand-placed scene
  furniture is read-only. Removal also broadcasts live so the sprite
  disappears immediately.
- **Per-NPC daily placement budget (Stage 1)** — capped at 3
  placements per NPC per day. `system` and `operator` callers are
  exempt. Returns HTTP 429 with `placedToday` when exceeded.
- **`requestAnimation` proposal queue (Stage 2, phase 1)** — NPCs
  call `[ACTION:requestAnimation:animName:description]`. The server
  validates against `/^[a-z][a-z0-9_]{0,30}$/` + 200-char description
  cap, enforces a per-NPC daily budget of 2 (system/operator exempt),
  persists to `data/animation-proposals.json` with `status: "pending"`,
  and emits a `proposed-animation` worldState event. `GET /api/animation-proposals`
  returns the queue. The actual sprite generation backends are still
  future work. See [ANIMATION_FORGE.md](ANIMATION_FORGE.md).
- **SOUL.md reflection + proposal queue (Stage 3 steps 1-2)** —
  `src/soul-reflection.js` builds the reflection prompt and validates
  proposals. `npcBrains.reflectOnDay(name)` runs the prompt through the
  NPC's existing LLM and POSTs the validated `{ addToSoul,
  dropFromSoul, summary, confidence }` to `/api/soul-proposal`. Cap:
  1 proposal/NPC/UTC-day, 50 total. `/api/soul-proposals[?npc=Name]`
  reads the queue. `/api/soul-proposal/approve` flips `status` —
  **never** writes to SOUL.md. Full details in
  [SOUL_REFLECTION.md](SOUL_REFLECTION.md).
- **SOUL.md application + version history (Stage 3 steps 3-4)** —
  `/api/soul-proposal/apply` consumes an *approved* proposal id, writes
  the edit into `npcs/<name>/SOUL.md` (with a dated `<!-- applied ...
  from proposal:<id> -->` marker on the appended paragraph), appends a
  structured entry to `npcs/<name>/SOUL.history.md` (lazy-created), and
  flips the proposal to `status: 'applied'`. Re-applying the same id is
  idempotent. The endpoint refuses anything that isn't already approved
  — the operator gate stays in front. `npcBrains.reloadSoul(name)` is
  called right after the write so the next `think()` sees the new
  personality without a restart. Emits `applied-soul-edit` on the
  worldState event feed.

## Stage 2 — Custom sprite animations (1 week)

Goal: when an NPC does something that has no existing animation
(meditating, gardening, sketching), it can request a new animation
sprite sheet for itself.

Concrete steps:

1. **`[ACTION:requestAnimation:animName:description]`** — NPC asks
   for a new animation. The request goes to a queue. **(Shipped — see
   [ANIMATION_FORGE.md](ANIMATION_FORGE.md).)**
2. **Server-side generator** — `src/animation-forge.js` builds a sprite
   sheet from the description. Three increasingly powerful options:
   - **Composition** (today, cheap): pick existing frames and layer/
     tint them. E.g. "Roki reading at desk" = existing sit-down frame
     + book overlay. No new pixel art generated. **(API surface stubbed
     in `composeFromExistingFrames`; renderer not yet wired.)**
   - **AI-generated PNG** (hosted): call an image model (DALL·E,
     Stable Diffusion, or a Replicate endpoint) with a constrained
     prompt template that produces a 4-frame strip at a fixed style.
     Save to `assets/generated/<animName>.png`. Cost: a few cents per
     animation. **(Future — needs API key + cost controls.)**
   - **Local SD pipeline** (offline): run ComfyUI or AUTOMATIC1111
     locally with a LoRA tuned on the LimeZu Modern Office style.
     Zero external API cost but heavier setup. **(Future.)**
3. **Registry** — `data/generated-animations.json` lists what's been
   created, with metadata (who requested it, when, prompt). The Phaser
   anim factory reads this on boot. **(Future — proposals live in
   `data/animation-proposals.json` today; the approved/generated
   registry is a separate file once generators land.)**
4. **Approval gate** — for the AI-gen variants, surface new animations
   in the diag panel for the operator to approve before they're
   registered globally. Prevents unwanted visual drift. **(Future —
   `GET /api/animation-proposals` is the contract a future review UI
   will consume.)**

## Stage 3 — SOUL.md self-revision (longer)

Goal: NPCs reflect on their own behavior daily and propose edits to
their own personality/role to better match what they've actually been
doing well or struggling with.

Concrete steps:

1. **Daily reflection pass — SHIPPED** — `src/soul-reflection.js`
   builds the reflection prompt, `npcBrains.reflectOnDay(npcName)` runs
   it through the NPC's existing LLM provider, parses + validates the
   `{ addToSoul, dropFromSoul, summary, confidence }` JSON. Not on a
   timer — operator calls it manually (diag panel / cron once an
   approval UI exists). See [SOUL_REFLECTION.md](SOUL_REFLECTION.md).
2. **`/api/soul-proposal{,s,/approve}` endpoints — SHIPPED** — three
   endpoints persist pending edits to `data/soul-proposals.json`
   (lazy-created). Caps: 1 proposal/NPC/UTC-day (429 when exceeded),
   50 total (oldest dropped). `proposed-soul-edit` is pushed onto the
   worldState event feed. Approve / reject sets `status` in place;
   neither writes to SOUL.md.
3. **Application — SHIPPED.** `POST /api/soul-proposal/apply { id }`
   takes an *approved* proposal and writes `proposal.addToSoul` to the
   target `npcs/<name>/SOUL.md` (prefixed with a dated
   `<!-- applied YYYY-MM-DD from proposal:<id> -->` marker), removes
   the first line matching `proposal.dropFromSoul` (warning, not error,
   if not found), flips the proposal to `status: 'applied'`, emits
   `applied-soul-edit`, and refreshes the in-memory soul cache via
   `npcBrains.reloadSoul`. Pending or rejected proposals are refused
   (400); the operator approval gate stays in front of every write.
4. **Versioning — SHIPPED.** `npcs/<name>/SOUL.history.md` is appended
   (lazy-created) with a structured entry per application:
   `## <ISO> — proposal:<id>` followed by `by`, `summary`, `confidence`,
   `addToSoul`, `dropFromSoul`, `approvedAt`, `appliedAt`. Provides the
   immutable audit trail.

### Risk: identity drift

Without the approval gate, NPCs might gradually delete their personality
quirks ("I'm anxious") in favor of bland competence ("I'm efficient at
my tasks"). The approval gate is non-negotiable for this stage. We're
not trying to make 16 indistinguishable productivity bots.

## Stage 4 — Capability self-extension (research)

Goal: NPCs can request new *actions* (verbs) that don't exist yet,
similar to how they can request animations.

Concrete steps:

1. **`[ACTION:requestCapability:verbName:description]`** — NPC says
   "I need a `whiteboard.draw(text)` action to write on the
   whiteboard." Goes to a proposal queue.
2. **Operator review** — proposed actions get evaluated against:
   - Does it duplicate an existing action?
   - Is the underlying primitive available? (E.g. can we actually
     render text on a whiteboard sprite?)
   - Is it safe? (No `[ACTION:deleteAllOtherNpcs]` allowed.)
3. **Manual implementation** — once approved, you implement the action
   in `src/agent-actions.js` and the verb becomes available in every
   NPC's prompt the next restart.
4. **Eventually: LLM-assisted implementation** — feed the proposed verb
   spec to a code-gen model that writes the implementation, which then
   goes through the existing PR review flow (CI tests must pass).
   This is genuinely advanced AI engineering territory.

## Stage 5 — Cross-NPC negotiation (open research)

Goal: NPCs negotiate office layout / capabilities / sprint scope among
themselves, not just one-direction "I propose, operator approves."

Examples:

- **Alex and Edward** both want their desks closer to the whiteboard.
  They negotiate; one proposes a swap; the other counter-proposes; they
  reach consensus and submit a single `placeFurniture` + swap.
- **Sarah** proposes calling daily standups *only* if there's been a
  blocker in the last 24h. **Marcus** counter-proposes weekly
  standups. They debate; the result modifies `worldState.environment`
  to record the new meeting cadence policy.

This is the most interesting stage long-term but the least
well-scoped. Don't start until stages 1-4 are real.

## What I don't recommend

**Do not** let NPCs:

- Modify each other's SOUL.md (breaks identity boundaries)
- Spawn new NPCs (capacity / coherence collapse)
- Modify the office structure outside the placeFurniture whitelist
  (security)
- Self-grant new LLM API keys (operator-level decision)
- Edit their own MEMORY.md beyond appending normally (rewriting
  history is the start of unreliable narrators)

These are *deliberately not on the roadmap*. The vision is NPCs that
grow within their roles, not NPCs that bootstrap themselves into a
distributed self-modifying system.

## See also

- [AWARENESS.md](AWARENESS.md) — what NPCs currently know
- [AI-SYSTEM.md](AI-SYSTEM.md) — the think loop they extend
- [ACTIONS.md](ACTIONS.md) — current action vocabulary
- [WORLD-STATE.md](WORLD-STATE.md) — the singleton everything mutates
