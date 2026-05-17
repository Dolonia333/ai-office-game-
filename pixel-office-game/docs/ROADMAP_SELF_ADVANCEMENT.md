# Denizen — Roadmap: NPCs That Build, Animate, and Self-Advance

> Vision: NPCs gradually extend their own capabilities — adding furniture
> to the office, creating sprite animations for actions that don't have
> them yet, and reflecting on their own behavior to revise their soul
> files. This doc is the staged plan toward that endpoint.

Not a build target for any single sprint. Each stage is meaningful on
its own and can ship independently.

## What just shipped (stage 0)

- **Awareness layer expanded** — room topology, convoy detection, desk
  geography, busy state, room occupancy, per-peer last-contact,
  self-repetition. See [AWARENESS.md](AWARENESS.md).
- **`placeFurniture` action** — NPCs can call
  `[ACTION:placeFurniture:prefabId:x:y:reason]`. The server validates
  against a whitelist, persists to `data/layouts/office-layout.json`,
  emits an event. On next page load the new item appears in the office.
  *Limitation:* no live spawn yet — requires reload. Live spawn is
  stage 1.

## Stage 1 — Live office mutation (1-2 days)

Goal: when an NPC places a desk, the desk appears immediately, and other
NPCs notice in their next think.

Concrete steps:

1. **Broadcast a `furniture.placed` event** over `/agent-ws` from
   `POST /api/place-furniture`. The client subscribes and instantiates
   the new sprite immediately.
2. **Adapter to the live furniture map** — `office-scene.js` adds the
   sprite to its `_interactables` array; the next `_sendOfficeState`
   cycle picks it up; `worldState` mirrors it.
3. **Undo / remove action** — `[ACTION:removeFurniture:instanceId]` for
   when an NPC regrets a placement or a different NPC reorganizes.
4. **Per-NPC placement budget** — cap each NPC to N placements per day
   so no one bulldozes the office.

## Stage 2 — Custom sprite animations (1 week)

Goal: when an NPC does something that has no existing animation
(meditating, gardening, sketching), it can request a new animation
sprite sheet for itself.

Concrete steps:

1. **`[ACTION:requestAnimation:animName:description]`** — NPC asks
   for a new animation. The request goes to a queue.
2. **Server-side generator** — `src/animation-forge.js` builds a sprite
   sheet from the description. Three increasingly powerful options:
   - **Composition** (today, cheap): pick existing frames and layer/
     tint them. E.g. "Roki reading at desk" = existing sit-down frame
     + book overlay. No new pixel art generated.
   - **AI-generated PNG** (hosted): call an image model (DALL·E,
     Stable Diffusion, or a Replicate endpoint) with a constrained
     prompt template that produces a 4-frame strip at a fixed style.
     Save to `assets/generated/<animName>.png`. Cost: a few cents per
     animation.
   - **Local SD pipeline** (offline): run ComfyUI or AUTOMATIC1111
     locally with a LoRA tuned on the LimeZu Modern Office style.
     Zero external API cost but heavier setup.
3. **Registry** — `data/generated-animations.json` lists what's been
   created, with metadata (who requested it, when, prompt). The Phaser
   anim factory reads this on boot.
4. **Approval gate** — for the AI-gen variants, surface new animations
   in the diag panel for the operator to approve before they're
   registered globally. Prevents unwanted visual drift.

## Stage 3 — SOUL.md self-revision (longer)

Goal: NPCs reflect on their own behavior daily and propose edits to
their own personality/role to better match what they've actually been
doing well or struggling with.

Concrete steps:

1. **Daily reflection pass** — once per in-game day, each NPC runs a
   *reflection* prompt with their last 24h of memory entries. Output:
   a structured `proposedSoulEdit` with:
   - `addToSoul: "I'm more comfortable with code review than I am with planning."`
   - `dropFromSoul: "I get anxious in meetings."` (if behavior contradicts it)
   - `summary: "..."`
   - `confidence: 0.7`
2. **`/api/soul-proposals` endpoint** — collects pending edits. They do
   NOT auto-apply; the operator reviews in a UI similar to a code-review
   diff.
3. **Application** — accepted edits get appended to `npcs/<name>/SOUL.md`
   with a date stamp and the reflection that produced them. The NPC's
   next think cycle reads the updated personality.
4. **Versioning** — `npcs/<name>/SOUL.history.md` records the diff so
   you can see how each NPC's identity drifted over time.

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
