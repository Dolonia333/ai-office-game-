'use strict';
/**
 * capability-proposal.js — Stage 4 step 1 of the
 * [Self-Advancement Roadmap](../docs/ROADMAP_SELF_ADVANCEMENT.md).
 *
 * Pure logic module shared by:
 *   - The `/api/request-capability` endpoint (validates incoming proposals).
 *   - The `/api/capability-proposals` listing endpoint.
 *   - The `/api/capability-proposal/approve` decision endpoint.
 *   - Tests for the above.
 *
 * # What this is
 *
 * NPCs propose new *actions* (verbs) they wish existed — "I need a
 * `whiteboard.draw(text)` action to write on the whiteboard." The
 * proposal lands in `data/capability-proposals.json` with
 * `status: "pending"` and an operator reviews it. Approval flips the
 * status; rejection flips the status; neither does anything else.
 *
 * # What this is deliberately NOT
 *
 * Stage 4 of the roadmap has four steps. Only **step 1 (the proposal
 * queue)** is shipped here. Steps 2-4 — operator review tooling,
 * **manual implementation** of approved verbs, and the speculative
 * **LLM-assisted code-generation** — remain explicit future work.
 *
 * The reason this matters: a capability proposal that gets approved
 * does NOT automatically register a new action in
 * `src/agent-actions.js`. An operator must:
 *
 *   1. Read the proposal.
 *   2. Decide whether the underlying primitive even exists.
 *   3. Check whether the verb duplicates an existing action.
 *   4. Make sure it's not a security footgun
 *      (no `[ACTION:deleteAllOtherNpcs]` allowed).
 *   5. Write the implementation by hand. Restart the server.
 *
 * That gate is non-negotiable. The whole point of Stage 4 — the same
 * point as the identity-drift gate in Stage 3 — is that NPCs proposing
 * new capabilities cannot be allowed to self-grant them. A
 * proposal-without-implementation queue is the *only* responsible
 * shape this can take until an operator review UI plus a vetted
 * code-gen path exists.
 *
 * This module is therefore intentionally narrow: it validates the
 * proposal shape and builds the JSON record. It does NOT implement
 * verbs, register dispatchers, or call any code-generation model.
 *
 * # Cross-references
 *
 *   - [docs/CAPABILITY_PROPOSALS.md](../docs/CAPABILITY_PROPOSALS.md)
 *     — operator-facing overview.
 *   - [docs/ROADMAP_SELF_ADVANCEMENT.md](../docs/ROADMAP_SELF_ADVANCEMENT.md)
 *     — Stage 4 in the context of the broader self-advancement plan.
 *   - [docs/ANIMATION_FORGE.md](../docs/ANIMATION_FORGE.md) — Stage 2,
 *     the structural parallel this module mirrors.
 *   - [docs/SOUL_REFLECTION.md](../docs/SOUL_REFLECTION.md) — Stage 3,
 *     the other approval-gated proposal queue.
 */

// camelCase verb name. Starts lowercase, no separators, max 31 chars.
// Tight because these names end up as JavaScript method names and
// `[ACTION:verbName:...]` tokens in the prompt; we don't want the LLM
// reinventing what counts as valid.
const VERB_NAME_RE = /^[a-z][a-zA-Z0-9]{0,30}$/;
const MIN_DESCRIPTION_LEN = 10;
const MAX_DESCRIPTION_LEN = 400;

/**
 * Validate a `requestCapability` proposal. Pure function, no IO.
 *
 * @param {{ verbName?: string, description?: string }} input
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateProposal(input) {
  const verbName = (input && input.verbName) || '';
  const description = (input && input.description) || '';

  if (typeof verbName !== 'string' || !VERB_NAME_RE.test(verbName)) {
    return {
      ok: false,
      error: 'verbName must match /^[a-z][a-zA-Z0-9]{0,30}$/ (camelCase, starts lowercase, 1-31 chars, no separators)',
    };
  }
  if (typeof description !== 'string' || description.length < MIN_DESCRIPTION_LEN) {
    return {
      ok: false,
      error: `description must be at least ${MIN_DESCRIPTION_LEN} chars (got ${description.length}) — describe what the verb actually does`,
    };
  }
  if (description.length > MAX_DESCRIPTION_LEN) {
    return {
      ok: false,
      error: `description too long (${description.length} > ${MAX_DESCRIPTION_LEN})`,
    };
  }
  return { ok: true };
}

/**
 * Build the JSON-serializable proposal record stored in
 * `data/capability-proposals.json`. Adds an id, ISO timestamp, the
 * proposer (`by`), and `status: 'pending'`.
 *
 * Callers that need a deterministic id (tests) can pass `idOverride`.
 *
 * @param {{ by?: string, verbName?: string, description?: string, idOverride?: string }} input
 */
function serializeProposal({ by, verbName, description, idOverride } = {}) {
  const id = idOverride || `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    by: String(by || '').slice(0, 40),
    verbName: String(verbName || '').slice(0, 80),
    description: String(description || '').slice(0, MAX_DESCRIPTION_LEN),
    proposedAt: Date.now(),
    status: 'pending',
    review: null, // populated when an operator approves/rejects
  };
}

module.exports = {
  validateProposal,
  serializeProposal,
  // Exported so tests + the endpoint can stay in sync.
  VERB_NAME_RE,
  MIN_DESCRIPTION_LEN,
  MAX_DESCRIPTION_LEN,
};
