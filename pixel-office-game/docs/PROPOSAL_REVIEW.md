# Denizen — Operator Proposal Review UI

> The browser-side review surface for every NPC proposal queue.
> Animation requests, SOUL.md edit proposals, and (when Stage 4 lands)
> capability requests all show up in one panel with approve / reject
> buttons. Backed by a new aggregate `GET /api/proposals` endpoint so
> the operator does not have to remember three separate endpoints.

## TL;DR for the operator

1. Run the game (`node server.js`). Open `http://127.0.0.1:8080` in the
   browser.
2. Look at the bottom-right of the canvas. A `📋 proposals` chip lives
   there next to the existing diag chip.
3. When the chip turns **yellow** (`📋 N pending`), there's work to
   review. Click it.
4. Each card is one NPC proposal. The badge on the left is the kind —
   **purple = animation**, **blue = SOUL edit**, **orange = capability**.
5. Decide:
   - **approve** — mark it accepted. For animations this clears the
     proposal for the (still-future) generator pipeline. For SOUL edits
     it marks the proposal `approved` but **does not** write to SOUL.md.
   - **reject** — same flow, status flips to `rejected`. The proposal
     is kept in the queue (it doesn't disappear) so you have an audit
     trail of what you said no to.
   - **apply** (SOUL only, appears only when `status === 'approved'`)
     — writes the approved edit to `npcs/<name>/SOUL.md`. **This button
     only appears if the `/api/soul-proposal/apply` endpoint exists on
     your server.** It is Stage 3 step 3 in the roadmap; if your branch
     doesn't have it the button is hidden automatically.
   - **details** — toggle the raw JSON record for the proposal. Useful
     for SOUL edits where the proposal field has more structure than
     the one-line summary fits.

The panel auto-refreshes every 30 seconds. There's also a manual
`refresh` button in the header if you want to poll immediately after
taking an action elsewhere (e.g. an NPC just reflected via a curl
call).

## Filter tabs

`all | pending | approved | rejected | applied`

- `pending` is the default — that's the review queue.
- `approved` shows accepted proposals that have not been applied yet.
  For SOUL this is the queue the (optional) `apply` button works
  against.
- `rejected` is the "what you said no to" audit log.
- `applied` only matters once Stage 3 step 3 lands and `apply` starts
  writing.

## Endpoint shape

```
GET /api/proposals?status=pending|approved|rejected|applied|all
                  &kind=animation|soul|capability    (comma-separated allowed)
```

Returns:

```json
{
  "proposals": [
    {
      "kind": "animation",
      "id": "anim_…",
      "by": "Roki",
      "status": "pending",
      "summary": "meditate — sitting cross-legged",
      "ts": 1779068861261,
      "raw": { "...full record from data/animation-proposals.json..." }
    },
    {
      "kind": "soul",
      "id": "proposal_…",
      "by": "Abby",
      "status": "approved",
      "summary": "Reflection: my behavior favors review over planning.",
      "ts": 1779068861300,
      "raw": { "...full record from data/soul-proposals.json..." }
    }
  ],
  "total": 47,
  "cap": 100,
  "truncated": false
}
```

- Sorted **newest first** by `ts`.
- Default status filter is `pending`. Pass `status=all` to see
  everything.
- Hard-capped at **100** entries. The UI then displays the first 30
  cards and shows a "showing 30 of N — refine filter" hint when there
  are more.
- The `raw` field is the unaltered record from the underlying file, so
  the UI can render a "show details" view without a second GET.
- Missing per-kind files are treated as empty. The endpoint never
  errors because `data/capability-proposals.json` doesn't exist.

## Why aggregation?

Without it the operator has to remember:

- `GET /api/animation-proposals`
- `GET /api/soul-proposals[?npc=Name]`
- `GET /api/capability-proposals` (whenever Stage 4 lands)

…and shapes diverge: animation rows use `proposedAt` (epoch ms), SOUL
rows use `createdAt` (ISO string), and they identify the proposer with
different field names (`by` vs `npcName`). The aggregate endpoint
flattens these into a single timestamp-comparable feed with a stable
`{ kind, id, by, summary, status, ts, raw }` envelope so the UI can be
one render loop.

The per-kind endpoints stay in place — they're the storage contract.
`/api/proposals` is purely a read-through.

## Approve / reject endpoints

The UI POSTs:

```
POST /api/<kind>-proposal/approve
Content-Type: application/json

{ "id": "...", "decision": "approved" | "rejected", "note": "optional" }
```

The shape is identical across animation and SOUL. (When the capability
endpoint lands in parallel work it should follow the same shape so the
UI doesn't need a special case.)

The animation approve endpoint is new in this change. It does NOT kick
off sprite generation — it just flips `status` and records the
operator's `review`. Generation is still future work
(`docs/ANIMATION_FORGE.md` walks through the three planned variants).

The SOUL apply endpoint (`POST /api/soul-proposal/apply`) is feature-
detected. The UI POSTs a probe at boot and if the server returns a
plain 404 (no JSON body) it hides the **apply** button entirely. This
keeps the panel working on master even before Stage 3 step 3 lands.

## What this is NOT

- **Not a real review tool with diffs.** SOUL proposal cards show the
  proposed `addToSoul` / `dropFromSoul` strings, but there's no
  side-by-side against the current SOUL.md. That's a feature gap a
  future Stage 3-step-3 PR should close together with the actual
  application logic.
- **Not a permission system.** Anyone with access to the browser can
  click approve. The whole game is single-user / single-operator
  today; locking down review would be premature.
- **Not multi-operator.** No conflict resolution if two operators
  approve and reject the same row from different tabs — last-write-
  wins, because the underlying file is read-modify-write.
- **Not a substitute for tailing the JSON files.** The files in
  `data/*-proposals.json` are still the source of truth and remain
  human-readable. The UI is a convenience, not a database.
- **Not an automation trigger.** Approving an animation doesn't make
  sprites appear. Approving a SOUL edit doesn't write to SOUL.md.
  Those steps are deliberately separate so an operator can change
  their mind between approve and apply.

## See also

- [ANIMATION_FORGE.md](ANIMATION_FORGE.md) — the source proposal
  queue and the deferred generator pipeline.
- [SOUL_REFLECTION.md](SOUL_REFLECTION.md) — daily reflection prompt
  + identity-drift gating + the deferred Stage 3 step 3 apply.
- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) —
  vision context: why these queues exist and where they're going.
