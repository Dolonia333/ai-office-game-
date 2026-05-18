'use strict';
/**
 * animation-forge.js — Stage 2 (request queue) of the
 * [Self-Advancement Roadmap](../docs/ROADMAP_SELF_ADVANCEMENT.md).
 *
 * Pure logic module shared by:
 *   - The `/api/request-animation` endpoint (validates incoming proposals).
 *   - Whatever generator backend ends up producing the actual sprite sheet
 *     once an operator approves a proposal.
 *
 * # Three planned generator variants
 *
 * Only the first is stubbed today. The other two are roadmap items — this
 * file exists so the API surface is stable before the heavy backends land.
 *
 *   1. **Composition (today, cheap)** — `composeFromExistingFrames(...)`
 *      picks one of the existing emote sprites and returns a spec
 *      describing how to layer / tint it. No new pixel art is generated;
 *      the Phaser anim factory is expected to interpret the spec on boot.
 *      This is the "good enough for ambient texture" tier — sufficient
 *      for things like "Roki reading at desk" (existing sit frame +
 *      book overlay tinted slightly differently).
 *
 *   2. **AI-generated PNG (future, hosted)** — calls an image model
 *      (DALL·E / Stable Diffusion / Replicate) with a constrained prompt
 *      template producing a 4-frame strip at the LimeZu Modern Office
 *      pixel style. Saves the PNG to `assets/generated/<animName>.png`
 *      and registers it in `data/generated-animations.json`. Costs a few
 *      cents per request; behind an operator approval gate so we don't
 *      get visual drift.
 *
 *   3. **Local Stable Diffusion (future, offline)** — runs ComfyUI or
 *      AUTOMATIC1111 against a LoRA trained on the LimeZu asset pack.
 *      Zero external API cost but heavier local setup. Same approval
 *      gate, same output path.
 *
 * # What this module does NOT do
 *
 *   - It does NOT auto-register approved animations into Phaser. That's
 *     the renderer's job once the approval UI exists.
 *   - It does NOT call any external image API. Hosted / local SD are
 *     stubs.
 *   - It does NOT persist proposals. The endpoint owns the JSON file;
 *     this module is pure logic.
 *
 * # Cross-references
 *
 *   - [docs/ANIMATION_FORGE.md](../docs/ANIMATION_FORGE.md) — operator-
 *     facing overview, what's shipped vs. roadmap.
 *   - [docs/ROADMAP_SELF_ADVANCEMENT.md](../docs/ROADMAP_SELF_ADVANCEMENT.md)
 *     — Stage 2 in context of the broader self-advancement roadmap.
 */

// Mirrors the regex in the /api/request-animation handler. Lowercase
// snake_case, starts with a letter, max 31 chars total. Tight because
// these names end up as file paths (`assets/generated/<animName>.png`)
// and Phaser animation keys.
const ANIM_NAME_RE = /^[a-z][a-z0-9_]{0,30}$/;
const MAX_DESCRIPTION_LEN = 200;

// Whitelisted existing-emote bases the composition variant can layer on
// top of. Kept narrow on purpose — composition isn't "generate any
// animation," it's "tint/label an existing emote so the NPC looks like
// they're doing the new thing." Add to this list as new base emotes
// land in the sprite registry.
const COMPOSITION_BASES = new Set([
  'idle', 'sit', 'walk', 'type', 'wave', 'look_around', 'celebrate',
]);

/**
 * Validate a `requestAnimation` proposal. Pure function, no IO.
 *
 * @param {{ animName?: string, description?: string }} input
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateProposal(input) {
  const animName = (input && input.animName) || '';
  const description = (input && input.description) || '';
  if (typeof animName !== 'string' || !ANIM_NAME_RE.test(animName)) {
    return {
      ok: false,
      error: 'animName must match /^[a-z][a-z0-9_]{0,30}$/ (lowercase snake_case, 1-31 chars, starts with a letter)',
    };
  }
  if (typeof description !== 'string' || description.length === 0) {
    return { ok: false, error: 'description is required' };
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
 * Composition variant — returns a *spec* describing how to build an
 * animation by layering an existing emote frame with a tint and label.
 *
 * No pixels are generated here. The spec is the contract the renderer
 * (or a future generator backend) will consume. Returning a plain JS
 * object keeps this module trivially testable and serialisable.
 *
 * Today the spec just describes the inputs; once the Phaser anim
 * factory grows a `createCompositionAnim(spec)` method, it will read
 * these fields directly.
 *
 * @param {{ baseEmote?: string, tint?: string|number, label?: string }} input
 * @returns {{ kind: 'composition', baseEmote: string, tint: string|number|null, label: string|null }
 *           | { kind: 'error', error: string }}
 */
function composeFromExistingFrames(input) {
  const baseEmote = (input && input.baseEmote) || '';
  const tint = input && input.tint != null ? input.tint : null;
  const label = input && input.label != null ? String(input.label).slice(0, 60) : null;
  if (!COMPOSITION_BASES.has(baseEmote)) {
    return {
      kind: 'error',
      error: `unknown baseEmote: ${baseEmote || '(empty)'}. Allowed: ${[...COMPOSITION_BASES].join(', ')}`,
    };
  }
  return { kind: 'composition', baseEmote, tint, label };
}

module.exports = {
  validateProposal,
  composeFromExistingFrames,
  // Exported so tests + the endpoint can stay in sync.
  ANIM_NAME_RE,
  MAX_DESCRIPTION_LEN,
  COMPOSITION_BASES,
};
