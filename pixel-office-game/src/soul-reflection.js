'use strict';

/**
 * Soul Reflection — Roadmap Stage 3 (steps 1-2)
 *
 * Pure logic for the daily SOUL.md self-revision pipeline. NPCs reflect
 * on their last 24h of memory and propose ONE edit to their SOUL.md.
 *
 * IMPORTANT: nothing here writes to SOUL.md. The output is a *proposal*
 * that lands in `data/soul-proposals.json` via the server endpoint and
 * waits for explicit operator approval. Auto-application is deferred
 * (see docs/ROADMAP_SELF_ADVANCEMENT.md Stage 3 step 3) because the
 * "identity drift" risk in the roadmap is the whole reason this stage
 * exists with a review gate.
 *
 * This module is required by:
 *   - server.js (POST /api/soul-proposal validation + persistence)
 *   - src/npc-brains.js (reflectOnDay method that builds the prompt)
 *   - tests/soul-reflection.test.js
 */

const SUMMARY_MAX_LEN = 200;
const FIELD_MAX_LEN = 400;

/**
 * Build the reflection prompt the NPC's LLM sees. Asks for a single
 * JSON object matching the proposal schema.
 *
 * The prompt deliberately frames the ask as "you may propose nothing
 * (both nulls = no-op)" so the LLM doesn't feel pressured to manufacture
 * edits when none are warranted — bland-competence drift is the failure
 * mode we're actively trying to avoid.
 */
function buildReflectionPrompt({ npcName, soul, recentMemories } = {}) {
  const name = String(npcName || 'this NPC');
  const soulText = String(soul || '(SOUL.md not loaded)').slice(0, 2000);

  let memoryBlock;
  if (Array.isArray(recentMemories)) {
    memoryBlock = recentMemories.length
      ? recentMemories.map(line => `- ${String(line).slice(0, 240)}`).join('\n')
      : '(no recent memories)';
  } else if (typeof recentMemories === 'string' && recentMemories.trim()) {
    memoryBlock = recentMemories.slice(0, 4000);
  } else {
    memoryBlock = '(no recent memories)';
  }

  return [
    `You are ${name}. Reflect honestly on your behavior over the last in-game day.`,
    '',
    '## Your current SOUL.md',
    soulText,
    '',
    '## Your recent memories (last ~50 entries)',
    memoryBlock,
    '',
    '## Your task',
    `Compare what your SOUL.md says about you to what you actually did. If something in your SOUL.md no longer matches your behavior, or if a new trait clearly emerged, propose ONE small edit. It is completely fine — and often correct — to propose NO edit at all (both fields null).`,
    '',
    'Respond with EXACTLY ONE JSON object, no other text:',
    '{',
    '  "addToSoul": "a single short line to ADD to SOUL.md, or null",',
    '  "dropFromSoul": "an existing line in SOUL.md that no longer fits, or null",',
    '  "summary": "1 sentence summarising the behavioral observation (max 200 chars)",',
    '  "confidence": 0.0 to 1.0 — how sure are you this edit is worth making',
    '}',
    '',
    'Rules:',
    '- Do NOT delete your personality quirks just to sound more competent. Quirks ARE you.',
    '- Do NOT propose sweeping rewrites. One short line max per field.',
    '- If you are unsure, set both addToSoul and dropFromSoul to null and use a low confidence.',
    '- Your edit will be reviewed by a human before it is applied.',
  ].join('\n');
}

function _isStringOrNull(v) {
  return v === null || typeof v === 'string';
}

/**
 * Validate the parsed proposal object from the LLM.
 * Returns { ok: true } when valid, { ok: false, error: '...' } otherwise.
 *
 * Rejects:
 *   - non-object input
 *   - missing/non-string summary, summary >200 chars
 *   - confidence missing / not a finite number / outside [0, 1]
 *   - both addToSoul AND dropFromSoul null/empty (it's a no-op proposal —
 *     no reason to persist it and clutter the review queue)
 *   - either field non-string-non-null (e.g. an object)
 *   - either field longer than 400 chars
 */
function validateProposal(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'proposal must be an object' };
  }

  if (!_isStringOrNull(obj.addToSoul)) {
    return { ok: false, error: 'addToSoul must be a string or null' };
  }
  if (!_isStringOrNull(obj.dropFromSoul)) {
    return { ok: false, error: 'dropFromSoul must be a string or null' };
  }

  const addText = typeof obj.addToSoul === 'string' ? obj.addToSoul.trim() : '';
  const dropText = typeof obj.dropFromSoul === 'string' ? obj.dropFromSoul.trim() : '';

  if (!addText && !dropText) {
    return { ok: false, error: 'proposal is a no-op (both addToSoul and dropFromSoul are empty)' };
  }
  if (addText.length > FIELD_MAX_LEN) {
    return { ok: false, error: `addToSoul exceeds ${FIELD_MAX_LEN} chars` };
  }
  if (dropText.length > FIELD_MAX_LEN) {
    return { ok: false, error: `dropFromSoul exceeds ${FIELD_MAX_LEN} chars` };
  }

  if (typeof obj.summary !== 'string' || !obj.summary.trim()) {
    return { ok: false, error: 'summary is required (1 sentence)' };
  }
  if (obj.summary.length > SUMMARY_MAX_LEN) {
    return { ok: false, error: `summary exceeds ${SUMMARY_MAX_LEN} chars` };
  }

  if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) {
    return { ok: false, error: 'confidence must be a finite number' };
  }
  if (obj.confidence < 0 || obj.confidence > 1) {
    return { ok: false, error: 'confidence must be in [0, 1]' };
  }

  return { ok: true };
}

/**
 * Build the JSON-serializable proposal record stored in
 * `data/soul-proposals.json`. Adds an id, ISO timestamp, the NPC name,
 * status='pending', and (optionally) a redacted snippet of the
 * reflection input that produced it so the operator can see what the
 * NPC was looking at when it made the suggestion.
 *
 * Callers that need a deterministic id (tests) can pass `idOverride`.
 */
function serializeProposal({ npcName, proposal, reflectionInput, idOverride } = {}) {
  const id = idOverride || `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const reflectionPreview = reflectionInput
    ? String(reflectionInput).slice(0, 800)
    : null;

  return {
    id,
    npcName: String(npcName || '').slice(0, 40),
    createdAt,
    status: 'pending',
    proposal: {
      addToSoul: proposal && typeof proposal.addToSoul === 'string' ? proposal.addToSoul : null,
      dropFromSoul: proposal && typeof proposal.dropFromSoul === 'string' ? proposal.dropFromSoul : null,
      summary: proposal && typeof proposal.summary === 'string' ? proposal.summary : '',
      confidence: proposal && typeof proposal.confidence === 'number' ? proposal.confidence : 0,
    },
    reflectionPreview,
    review: null, // populated when an operator approves/rejects
  };
}

module.exports = {
  buildReflectionPrompt,
  validateProposal,
  serializeProposal,
  SUMMARY_MAX_LEN,
  FIELD_MAX_LEN,
};
