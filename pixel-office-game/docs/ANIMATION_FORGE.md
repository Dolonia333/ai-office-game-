# Denizen — Animation Forge

> Stage 2 (phase 1) of the [self-advancement roadmap](ROADMAP_SELF_ADVANCEMENT.md).
> NPCs can request new animations for actions that don't have sprite
> support yet. Requests go to an **operator-review queue** — they do not
> appear in the office instantly. The actual sprite generation backends
> (composition / hosted AI / local SD) are scaffolded but not wired.

## TL;DR

| Surface | Trigger | What happens |
|---|---|---|
| **`[ACTION:requestAnimation:animName:description]`** | NPC emits it in a think response | Posted to `/api/request-animation`. Validated, budget-checked, appended to `data/animation-proposals.json` with `status: "pending"`. NPC also gets an `idea` emote. |
| **`POST /api/request-animation`** | NPC dispatch (or curl) | Body `{ by, animName, description }`. Validates `animName` against `/^[a-z][a-z0-9_]{0,30}$/`, caps `description` at 200 chars. Per-NPC daily budget of **2** requests (`system` / `operator` exempt). Returns `{ ok, proposal }`. |
| **`GET /api/animation-proposals`** | Operator review UI (future) | Returns the contents of `data/animation-proposals.json` (`{ proposals: [...] }`). |
| **`worldState.pushEvent('proposed-animation', ...)`** | Each successful POST | Surfaces the proposal in the diag panel's event feed. |
| **`src/animation-forge.js`** | `require()` from server / generators | `validateProposal({animName, description})` + `composeFromExistingFrames({baseEmote, tint, label})`. Pure logic, no IO. |

## The request flow

```
NPC think loop
    │
    ▼   "[ACTION:requestAnimation:meditate:sitting cross-legged]"
agent-office-manager.case 'requestAnimation'
    │
    ▼   POST /api/request-animation { by: "Roki", animName, description }
server.js → animationForge.validateProposal → budget check
    │
    ▼   append to data/animation-proposals.json
    │   worldState.pushEvent('proposed-animation', ...)
    │   { ok: true, proposal }
    ▼
(operator reviews via future UI; today: tail the JSON file)
```

## Three generator variants (only one stubbed)

Documented in the JSDoc at the top of `src/animation-forge.js`. Quick
recap:

1. **Composition** — `composeFromExistingFrames(...)` returns a spec
   describing how to layer an existing emote with a tint + label. No
   new pixel art. Today this returns the spec; the renderer that
   consumes it isn't wired yet.
2. **AI-generated PNG (future, hosted)** — DALL·E / Stable Diffusion /
   Replicate. Saves a 4-frame strip to `assets/generated/<animName>.png`.
   Costs a few cents per request.
3. **Local Stable Diffusion (future, offline)** — ComfyUI / A1111 with a
   LoRA tuned on LimeZu Modern Office style. Zero external cost,
   heavier setup.

All three variants share the same proposal queue and the same
operator-approval gate. The validator and base spec are the only pieces
that exist today.

## Per-NPC daily request budget

Lower than the placement budget (3/day) because each animation proposal
is heavier review work for the operator.

- **Cap:** 2 requests per NPC per UTC-local-server day.
- **Exempt:** `system`, `operator` (manual fixtures / scripted seeds).
- **Response on exceed:** HTTP 429 with `{ error, requestedToday }`.

Implemented in `server.js` via `_checkAnimationBudget` / `_consumeAnimationBudget`,
modelled on the placement-budget pattern.

## Validation rules

| Field | Constraint |
|---|---|
| `animName` | `/^[a-z][a-z0-9_]{0,30}$/` — lowercase snake_case, starts with a letter, ≤ 31 chars. Tight because it becomes a file path and Phaser anim key. |
| `description` | Non-empty, ≤ 200 chars. |

Both rules live in `src/animation-forge.js` as `ANIM_NAME_RE` and
`MAX_DESCRIPTION_LEN`, exported so the endpoint and tests stay in lockstep.

## Files touched

- `src/animation-forge.js` — new module. Pure logic: `validateProposal`,
  `composeFromExistingFrames`, plus the validation constants.
- `server.js` — new endpoints `/api/request-animation` (POST) and
  `/api/animation-proposals` (GET). New `_checkAnimationBudget` /
  `_consumeAnimationBudget` helpers. `animationForge` required at the
  top of the file.
- `src/agent-office-manager.js` — new `case 'requestAnimation'` in the
  NPC-action switch. POSTs to the endpoint, emotes on success.
- `src/npc-brains.js` — added `requestAnimation` bullet to the CEO-chat
  action vocabulary, with example + 2/day cap mentioned.
- `tests/animation-forge.test.js` — pure-logic tests (validator,
  composition spec, exports).
- `tests/request-animation-endpoint.test.js` — integration tests
  (happy path, validation rejections, budget, GET listing). Boots the
  real server on a random port and cleans up `TEST_*` rows on exit.
- `docs/ANIMATION_FORGE.md` — this file.
- `docs/ROADMAP_SELF_ADVANCEMENT.md` — marked phase 1 (request queue)
  as shipped.
- `README.md` — added a row to the Related Documentation table.
- `data/animation-proposals.json` — created lazily on first POST.

## What this is NOT

- **Not auto-spawn.** Approving a proposal is an explicit operator
  action. There is no path today from "NPC requested it" to "sprite
  shows up in the office." That's deliberate — the whole point of the
  approval gate is to prevent visual drift.
- **Not AI image generation.** The hosted / local SD variants are
  documented in `src/animation-forge.js` JSDoc but not wired. No API
  keys, no `assets/generated/` directory, no Replicate/ComfyUI calls.
- **Not an operator review UI.** `GET /api/animation-proposals` is the
  contract. A future task will build the actual review panel against
  it; today the operator reads the JSON file.
- **Not a Phaser animation registrar.** Even the composition spec is
  not consumed by the renderer yet. The spec exists so the API surface
  is stable before the renderer plugs in.
- **Not capability-extension.** Stage 4 of the roadmap covers
  `requestCapability` (proposing new verbs). This stage is just sprite
  animations, which is far less risky.

## See also

- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) — full
  staged plan, including the AI-gen / local-SD generators that are
  still future work.
- [ACTIONS.md](ACTIONS.md) — current NPC action vocabulary.
- [AWARENESS.md](AWARENESS.md) — context block where the
  `proposed-animation` event appears in the diag panel feed.
