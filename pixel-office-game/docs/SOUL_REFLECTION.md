# Denizen — SOUL.md Self-Revision (Reflection + Proposal Queue)

> Roadmap Stage 3, **steps 1-2 only**. NPCs reflect on their last 24h
> and propose ONE edit to their own SOUL.md. Proposals are persisted
> to a queue and wait for explicit operator approval. **Nothing in this
> system writes to SOUL.md.** The approval gate is non-negotiable.

## TL;DR

| Piece | Where | What it does |
|---|---|---|
| `buildReflectionPrompt({...})` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Builds the reflection prompt: NPC's SOUL.md + last ~50 memories + JSON schema ask. |
| `validateProposal(obj)` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Pure validator. Rejects no-ops, bad confidence, missing/oversized summary, wrong-typed fields. |
| `serializeProposal({...})` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Wraps the LLM output as `{ id, npcName, createdAt, status:'pending', proposal, reflectionPreview, review:null }`. |
| `POST /api/soul-proposal` | `server.js` | Validates + persists to `data/soul-proposals.json`. Emits `pushEvent('proposed-soul-edit', ...)`. 1/NPC/day cap (429 when exceeded). 50-total cap (oldest dropped). |
| `GET /api/soul-proposals[?npc=Name]` | `server.js` | Returns the persisted queue. Lazy-creates the file. |
| `POST /api/soul-proposal/approve` | `server.js` | Marks a proposal `approved` or `rejected` in place. **Does NOT touch SOUL.md.** |
| `npcBrains.reflectOnDay(npcName, opts?)` | [`src/npc-brains.js`](../src/npc-brains.js) | End-to-end: builds the prompt, calls the NPC's provider, parses + validates, POSTs to the local server. **Not on any timer.** Call from the diag panel, an admin endpoint, or a future cron. |

## Identity drift risk (why the approval gate is non-negotiable)

Straight from [`ROADMAP_SELF_ADVANCEMENT.md`](ROADMAP_SELF_ADVANCEMENT.md):

> Without the approval gate, NPCs might gradually delete their personality
> quirks ("I'm anxious") in favor of bland competence ("I'm efficient at
> my tasks"). The approval gate is non-negotiable for this stage. We're
> not trying to make 16 indistinguishable productivity bots.

Two design choices encode this directly:

1. The reflection prompt explicitly tells the NPC that proposing nothing
   (`addToSoul: null` AND `dropFromSoul: null`) is a valid, often correct
   answer. The validator then rejects that as a no-op so we don't even
   persist it — keeps the review queue tight and removes the implicit
   pressure to "produce something."
2. There is no automatic application path. `/api/soul-proposal/approve`
   only flips `status` and records the operator's note. The actual
   `SOUL.md` write + diff history are roadmap step 3 + 4, deliberately
   shipped after an operator UI exists to review proposals before they
   land.

## Data shape

A persisted proposal record in `data/soul-proposals.json`:

```json
{
  "id": "proposal_1779068861261_9o1loc",
  "npcName": "Abby",
  "createdAt": "2026-05-18T01:47:41.261Z",
  "status": "pending",
  "proposal": {
    "addToSoul": "I review PRs more than I plan sprints.",
    "dropFromSoul": null,
    "summary": "Reflection: my behavior favors review over planning.",
    "confidence": 0.65
  },
  "reflectionPreview": "memory line a\nmemory line b\n...",
  "review": null
}
```

After an `/api/soul-proposal/approve` call, `status` becomes `approved`
or `rejected` and `review` is populated:

```json
"review": {
  "decision": "approved",
  "note": "looks good — small, accurate observation",
  "reviewedAt": "2026-05-18T02:11:00.000Z"
}
```

## Caps

| Cap | Value | Why |
|---|---|---|
| Proposals per NPC per UTC day | 1 | Reflection is supposed to be *daily*. More than once is the model rationalising. |
| Total queue size | 50 | The queue is for review, not history. Oldest dropped on overflow. The full audit history lives in step 4 (deferred). |
| `summary` length | 200 chars | One sentence. |
| `addToSoul` / `dropFromSoul` length | 400 chars | One short line per the prompt instructions. |

## Calling `reflectOnDay`

`reflectOnDay` is **never auto-fired**. There's no `setInterval` and no
cron hook. It exists so the operator can trigger it manually from a diag
endpoint or a deliberately scheduled cron once the operator-review UI
exists. Example (from a future diag handler):

```js
const result = await npcBrains.reflectOnDay('Abby');
// result: { ok, proposal, submitted, status?, body? } or { ok:false, error }
```

Options:

- `submitUrl` — defaults to `http://127.0.0.1:${PORT}/api/soul-proposal`.
  Pass `null` to skip the HTTP call and just return the validated
  proposal (useful for previewing in a UI before committing it to the
  queue).
- `port` — overrides the port lookup if your env is non-standard.

## Files touched

- `src/soul-reflection.js` — new. Pure logic: prompt builder, validator,
  serializer. No fs, no http.
- `src/npc-brains.js` — new method `reflectOnDay(npcName, opts?)`. Reuses
  the existing `_callProvider` path so it gets the same queueing /
  fallback / per-NPC routing as `think()`.
- `server.js` — three new endpoints (`POST /api/soul-proposal`, `GET
  /api/soul-proposals`, `POST /api/soul-proposal/approve`), plus the
  small file-IO helpers (`_readSoulProposalsFile`,
  `_writeSoulProposalsFile`, `_ymdToday`, `_countProposalsToday`).
- `data/soul-proposals.json` — **not** pre-committed. The endpoint
  lazy-creates it on the first successful POST.
- `tests/soul-reflection.test.js` — pure logic.
- `tests/soul-proposal-endpoint.test.js` — integration. Boots the real
  server on a random port, asserts cap behaviour + filter + approve.
  Cleans up `TEST_`-prefixed proposals in teardown.

## What is NOT in scope

- **Auto-applying** approved proposals to `SOUL.md`. Roadmap step 3.
- **Operator review UI** (diff view, approve/reject buttons). Mentioned
  in the roadmap as the gate this stage is waiting on. The endpoints are
  ready for it; the UI is a separate piece.
- **`SOUL.history.md` per-NPC version log.** Roadmap step 4. Once
  application lands, the history file becomes the immutable audit trail.
- **Automatically firing `reflectOnDay` on a timer or in-game-day tick.**
  Deliberately omitted. The scheduling decision lives with the operator,
  not the code, until the approval UI is in place.
- **Cross-NPC reflection / negotiation.** Roadmap Stage 5.

## See also

- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) — the staged
  plan, including the identity-drift risk callout and the explicit
  deferral of steps 3 + 4.
- [AI-SYSTEM.md](AI-SYSTEM.md) — how `think()` works (`reflectOnDay`
  is the same machinery with a different prompt).
- [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md) — the layer that just
  shipped; this doc follows its style.
