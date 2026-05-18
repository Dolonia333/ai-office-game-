# Denizen — Capability Proposals

> Stage 4 step 1 of the [self-advancement roadmap](ROADMAP_SELF_ADVANCEMENT.md).
> NPCs can propose new *actions* (verbs) that don't exist yet. Proposals
> go to an **operator-review queue** — they do not become available
> instantly. The actual implementation of an approved verb is
> deliberately deferred (steps 2-4 of Stage 4) and remains explicit
> future work.

## TL;DR

| Surface | Trigger | What happens |
|---|---|---|
| **`[ACTION:requestCapability:verbName:description]`** | NPC emits it in a think response | Posted to `/api/request-capability`. Validated, budget-checked, appended to `data/capability-proposals.json` with `status: "pending"`. NPC also gets an `idea` emote. |
| **`POST /api/request-capability`** | NPC dispatch (or curl) | Body `{ by, verbName, description }`. Validates `verbName` against `/^[a-z][a-zA-Z0-9]{0,30}$/`, requires `description` between 10 and 400 chars. Per-NPC daily budget of **1** request (`system` / `operator` exempt). Returns `{ ok, proposal }`. |
| **`GET /api/capability-proposals[?status=pending\|approved\|rejected]`** | Operator review UI (future) | Returns `{ proposals: [...] }`. Optional `status` filter. |
| **`POST /api/capability-proposal/approve`** | Operator decision | Body `{ id, decision: 'approved'\|'rejected', note? }`. Flips `status` + sets `review` in place. **Does NOT implement the verb.** |
| **`worldState.pushEvent('proposed-capability', ...)`** | Each successful POST | Surfaces the proposal in the diag panel's event feed. |
| **`src/capability-proposal.js`** | `require()` from server + tests | `validateProposal({verbName, description})` + `serializeProposal({by, verbName, description})`. Pure logic, no IO. |

## The request flow

```
NPC think loop
    │
    ▼   "[ACTION:requestCapability:whiteboardDraw:Render text on the whiteboard...]"
agent-office-manager.case 'requestCapability'
    │
    ▼   POST /api/request-capability { by: "Roki", verbName, description }
server.js → capabilityProposal.validateProposal → budget check
    │
    ▼   append to data/capability-proposals.json
    │   worldState.pushEvent('proposed-capability', ...)
    │   { ok: true, proposal }
    ▼
(operator reviews via future UI; today: tail the JSON file)
    │
    ▼   POST /api/capability-proposal/approve { id, decision: 'approved'|'rejected', note? }
    │
    ▼   status flips, review block recorded.
    ▼
(operator, by hand, writes the verb's implementation in
 src/agent-actions.js and restarts the server)
```

## Validation rules

| Field | Constraint |
|---|---|
| `verbName` | `/^[a-z][a-zA-Z0-9]{0,30}$/` — camelCase, starts with a lowercase letter, 1-31 chars, no separators. Tight because the name becomes a JavaScript method identifier and an `[ACTION:verbName:...]` token in the NPC prompt. |
| `description` | Between **10** and **400** chars. The lower bound is deliberate: a verb proposal without a real description is worthless to an operator. |

Both rules live in `src/capability-proposal.js` as `VERB_NAME_RE`,
`MIN_DESCRIPTION_LEN`, and `MAX_DESCRIPTION_LEN`, exported so the
endpoint and tests stay in lockstep.

## Per-NPC daily request budget

**Tighter than the animation budget (2/day) — only 1 capability
request per NPC per UTC-local-server day.**

Rationale:

- An animation proposal can be served by image-gen or simple
  composition: cheap in operator time.
- A capability proposal, if approved, implies a **real code change**
  in `src/agent-actions.js`, plus a server restart. The minimum unit
  of work is much higher.
- We want NPCs to be picky. A 1/day cap forces them to save the slot
  for proposals they actually believe in, rather than burning the
  budget on whims.

Exemptions:

- `system` and `operator` are exempt (manual fixtures / scripted seeds).
- Response on exceed: HTTP 429 with `{ error, requestedToday }`.

Implemented in `server.js` via `_checkCapabilityBudget` /
`_consumeCapabilityBudget`, modelled on the animation-budget pattern.

## Files touched

- `src/capability-proposal.js` — new module. Pure logic:
  `validateProposal`, `serializeProposal`, plus the regex + length
  constants.
- `server.js` — three new endpoints: `/api/request-capability` (POST),
  `/api/capability-proposals` (GET), `/api/capability-proposal/approve`
  (POST). New `_checkCapabilityBudget` / `_consumeCapabilityBudget`
  helpers. `capabilityProposal` required at the top of the file.
- `src/agent-office-manager.js` — new `case 'requestCapability'` in
  the NPC-action switch. POSTs to the endpoint, emotes on success.
- `src/npc-brains.js` — added `requestCapability` bullet to the
  per-role action vocabulary, with the example and 1/day cap noted.
- `tests/capability-proposal.test.js` — pure-logic tests (validator,
  serializer, exports).
- `tests/request-capability-endpoint.test.js` — integration tests
  (happy path, validation rejections, budget, GET listing + status
  filter, approve/reject flow). Boots the real server on a random port
  and cleans up `TEST_*` rows on exit.
- `docs/CAPABILITY_PROPOSALS.md` — this file.
- `docs/ROADMAP_SELF_ADVANCEMENT.md` — marked Stage 4 step 1 as
  shipped; steps 2-4 explicitly remain future work.
- `README.md` — added a row to the Related Documentation table.
- `data/capability-proposals.json` — created lazily on first POST.

## What this is NOT

- **Not auto-implementation.** The endpoint persists a *proposal*.
  Approving the proposal flips `status` to `approved` and records a
  review note — it does NOT generate code, register a verb, or
  attempt to extend `src/agent-actions.js`. An operator still has to
  open the file, write the action, restart the server.
- **Not LLM-assisted code generation.** Stage 4 step 4 hypothesises a
  pipeline that feeds an approved spec to a code-gen model and runs
  the result through PR review. That pipeline is out of scope here.
  No model is called.
- **Not an operator review UI.** `GET /api/capability-proposals[?status=...]`
  is the contract. A future task will build the actual review panel
  against it; today the operator tails the JSON file.
- **Not action-registration runtime.** Even if a proposal is approved,
  nothing watches `data/capability-proposals.json` for status changes
  and tries to wire up a new dispatcher case. Approval is a label, not
  a deployment.
- **Not animation-extension.** `requestAnimation` (Stage 2) handles
  sprite animations; this stage handles *behavior* verbs. Different
  approval rationale, different review checklist.

## Why the approval gate is non-negotiable

The roadmap calls out the same risk as Stage 3's identity-drift: an
NPC self-extending its own capability set is a tail risk. Even with
valid intentions, an unreviewed "I need a `deleteAllOtherNpcs` verb"
proposal cannot be allowed to land. The proposal queue is
intentionally a write-only channel from the NPC side; only an
operator can mark a proposal as approved, and *only* a developer
(possibly the same person) can ship the actual code.

## See also

- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) — full
  staged plan, including Stage 4 steps 2-4 (operator review, manual
  implementation, LLM-assisted) that remain future work.
- [ANIMATION_FORGE.md](ANIMATION_FORGE.md) — Stage 2 (sprite
  animation queue), the structural parallel.
- [SOUL_REFLECTION.md](SOUL_REFLECTION.md) — Stage 3 (SOUL.md
  self-revision queue), the other approval-gated proposal queue.
- [ACTIONS.md](ACTIONS.md) — current NPC action vocabulary.
- [AWARENESS.md](AWARENESS.md) — context block where the
  `proposed-capability` event appears in the diag panel feed.
