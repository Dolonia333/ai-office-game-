# Denizen — SOUL.md Self-Revision (Reflection, Proposal Queue, Apply, History)

> Roadmap Stage 3, **steps 1-4**. NPCs reflect on their last 24h and
> propose ONE edit to their own SOUL.md. Proposals are persisted to a
> queue and wait for explicit operator approval. After approval, an
> explicit `apply` call writes the edit to disk and appends to
> `SOUL.history.md`. **No SOUL.md is ever mutated automatically — every
> write requires an approved proposal and an explicit apply call.** The
> approval gate is non-negotiable.

## TL;DR

| Piece | Where | What it does |
|---|---|---|
| `buildReflectionPrompt({...})` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Builds the reflection prompt: NPC's SOUL.md + last ~50 memories + JSON schema ask. |
| `validateProposal(obj)` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Pure validator. Rejects no-ops, bad confidence, missing/oversized summary, wrong-typed fields. |
| `serializeProposal({...})` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Wraps the LLM output as `{ id, npcName, createdAt, status:'pending', proposal, reflectionPreview, review:null }`. |
| `POST /api/soul-proposal` | `server.js` | Validates + persists to `data/soul-proposals.json`. Emits `pushEvent('proposed-soul-edit', ...)`. 1/NPC/day cap (429 when exceeded). 50-total cap (oldest dropped). |
| `GET /api/soul-proposals[?npc=Name]` | `server.js` | Returns the persisted queue. Lazy-creates the file. |
| `POST /api/soul-proposal/approve` | `server.js` | Marks a proposal `approved` or `rejected` in place. **Does NOT touch SOUL.md.** |
| `applyProposalToSoul({...})` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Pure. Takes current SOUL.md text + a proposal record. Returns `{ next, warnings }`. No file IO. |
| `serializeHistoryEntry({...})` | [`src/soul-reflection.js`](../src/soul-reflection.js) | Pure. Produces the markdown entry appended to `SOUL.history.md`. |
| `POST /api/soul-proposal/apply` | `server.js` | Writes an *approved* proposal to `npcs/<name>/SOUL.md`, appends to `SOUL.history.md`, flips `status` to `applied`, emits `applied-soul-edit`, refreshes the soul cache via `npcBrains.reloadSoul`. Idempotent. |
| `npcBrains.reflectOnDay(npcName, opts?)` | [`src/npc-brains.js`](../src/npc-brains.js) | End-to-end: builds the prompt, calls the NPC's provider, parses + validates, POSTs to the local server. **Not on any timer.** Call from the diag panel, an admin endpoint, or a future cron. |
| `npcBrains.reloadSoul(npcName)` | [`src/npc-brains.js`](../src/npc-brains.js) | Re-reads `npcs/<folder>/SOUL.md` and refreshes the cached personality so the next `think()` cycle sees the new text without a server restart. |

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
   `SOUL.md` write requires a *separate* explicit call to
   `/api/soul-proposal/apply { id }` — the two-step approve-then-apply
   shape is deliberate: it makes the file mutation a distinct, auditable
   action that can't happen as a side-effect of an unrelated approval
   click in a future UI.

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
| Total queue size | 50 | The queue is for review, not history. Oldest dropped on overflow. The full audit history lives in `SOUL.history.md` once an `apply` lands. |
| `summary` length | 200 chars | One sentence. |
| `addToSoul` / `dropFromSoul` length | 400 chars | One short line per the prompt instructions. |

## Application flow

The full lifecycle of a SOUL.md edit is a deliberate four-step pipeline,
each step a separate explicit call:

1. **Propose.** `npcBrains.reflectOnDay('Abby')` (or any external caller)
   POSTs to `/api/soul-proposal`. The proposal lands in
   `data/soul-proposals.json` with `status: 'pending'` and a
   `proposed-soul-edit` event fires.
2. **Approve.** An operator (or future review UI) POSTs to
   `/api/soul-proposal/approve { id, decision: 'approved', note? }`. The
   proposal flips to `status: 'approved'` with a `review` block. SOUL.md
   is **not** touched.
3. **Apply.** A separate explicit call to
   `/api/soul-proposal/apply { id }` does the actual write:
   - `proposal.addToSoul` is appended to `npcs/<folder>/SOUL.md` as a
     new paragraph, prefixed with a marker comment
     `<!-- applied YYYY-MM-DD from proposal:<id> -->` so the provenance
     is visible inline.
   - `proposal.dropFromSoul` removes the *first* line containing that
     substring. If no line matches, a warning is logged and recorded in
     `proposal.applied.warnings` — the apply still succeeds (operator
     already approved; a missing drop usually means the wording shifted
     slightly).
   - A structured entry is appended to `npcs/<folder>/SOUL.history.md`
     (the file is lazy-created with a `# <Name> — SOUL.md Revision
     History` header).
   - The proposal record is updated to `status: 'applied'` with an
     `applied: { at, soulPath, historyPath, warnings }` receipt.
   - `applied-soul-edit` fires on the worldState event feed.
   - `npcBrains.reloadSoul(name)` refreshes the cached personality so
     the next `think()` cycle sees the new text without a server
     restart (SOUL.md is otherwise cached at boot in
     `brain.personality`).
4. **Idempotency.** Re-POSTing `/apply` with the same id returns 200
   with `alreadyApplied: true` and the original receipt. Pending or
   rejected proposals are refused (400). Unknown ids are 404.

### Example `SOUL.history.md` entry

```markdown
# Abby — SOUL.md Revision History

## 2026-05-18T02:30:00.000Z — proposal:proposal_1779068861261_9o1loc
- by: Abby
- summary: Reflection: my behavior favors review over planning.
- confidence: 0.65
- addToSoul: "I review PRs more than I plan sprints."
- dropFromSoul: null
- approvedAt: 2026-05-18T02:11:00.000Z
- appliedAt: 2026-05-18T02:30:00.000Z
```

### Warnings: missing dropFromSoul text

If the LLM proposes a `dropFromSoul` whose text doesn't match any line
in the current SOUL.md (common when the wording has drifted slightly
between proposal time and apply time), the apply does NOT abort. It:

- still appends the `addToSoul` paragraph if present,
- still flips the proposal to `applied`,
- records the warning on `proposal.applied.warnings` (and logs it to
  stderr).

The operator already approved this proposal — the right behavior is to
land the addition the operator signed off on and surface the dropped-
drop as an audit note, not to silently roll the whole thing back.

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

- `src/soul-reflection.js` — pure logic: prompt builder, validator,
  serializer, `applyProposalToSoul`, `serializeHistoryEntry`. No fs, no http.
- `src/npc-brains.js` — `reflectOnDay(npcName, opts?)` runs the full
  reflection pipeline through the NPC's existing provider; `reloadSoul
  (npcName)` re-reads SOUL.md and refreshes the cached personality after
  an apply.
- `server.js` — four endpoints (`POST /api/soul-proposal`, `GET
  /api/soul-proposals`, `POST /api/soul-proposal/approve`, `POST
  /api/soul-proposal/apply`), plus the small file-IO helpers
  (`_readSoulProposalsFile`, `_writeSoulProposalsFile`, `_ymdToday`,
  `_countProposalsToday`, `_resolveNpcFolder`).
- `data/soul-proposals.json` — **not** pre-committed. The endpoint
  lazy-creates it on the first successful POST.
- `npcs/<folder>/SOUL.history.md` — **not** pre-committed. Lazy-created
  the first time an apply lands for that NPC.
- `tests/soul-reflection.test.js` — pure logic (now also covers
  `applyProposalToSoul` + `serializeHistoryEntry`).
- `tests/soul-proposal-endpoint.test.js` — integration. Boots the real
  server on a random port, asserts cap behaviour + filter + approve.
  Cleans up `TEST_`-prefixed proposals in teardown.
- `tests/soul-apply-endpoint.test.js` — integration. Snapshots a real
  NPC's SOUL.md + SOUL.history.md before each test and restores them
  afterwards; covers validation (pending/rejected refused, missing file
  404), happy path, idempotency, and the warning-path for missing
  dropFromSoul text.

## What is NOT in scope

- **Auto-applying** proposals on approve. Apply is always a separate
  explicit call to `/api/soul-proposal/apply` — the two-step shape is
  deliberate and keeps the file mutation distinct and auditable.
- **Operator review UI** (diff view, approve/reject/apply buttons).
  Mentioned in the roadmap as the gate this stage is waiting on. The
  endpoints are ready for it; the UI is a separate piece.
- **Automatically firing `reflectOnDay` on a timer or in-game-day tick.**
  Deliberately omitted. The scheduling decision lives with the operator,
  not the code, until the approval UI is in place.
- **Cross-NPC reflection / negotiation.** Roadmap Stage 5.

## See also

- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) — the staged
  plan, including the identity-drift risk callout.
- [AI-SYSTEM.md](AI-SYSTEM.md) — how `think()` works (`reflectOnDay`
  is the same machinery with a different prompt).
- [SOCIAL_BEHAVIOR.md](SOCIAL_BEHAVIOR.md) — the layer that just
  shipped; this doc follows its style.
