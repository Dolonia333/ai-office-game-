'use strict';
/**
 * Pure-logic tests for src/animation-forge.js. No HTTP, no filesystem.
 * Covers:
 *   - validateProposal accepts valid input
 *   - validateProposal rejects malformed animName (uppercase, leading digit,
 *     punctuation, too long)
 *   - validateProposal rejects empty / overlong description
 *   - composeFromExistingFrames returns the expected spec for a known base
 *   - composeFromExistingFrames returns an error for an unknown base
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const forge = require('../src/animation-forge');

describe('animation-forge.validateProposal', () => {
  it('accepts a valid name + description', () => {
    const r = forge.validateProposal({ animName: 'meditate', description: 'sitting cross-legged' });
    assert.deepEqual(r, { ok: true });
  });

  it('accepts underscores, digits, and snake_case', () => {
    const r = forge.validateProposal({ animName: 'sketch_idea_2', description: 'pondering with notepad' });
    assert.equal(r.ok, true);
  });

  it('rejects uppercase letters', () => {
    const r = forge.validateProposal({ animName: 'Meditate', description: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /animName/);
  });

  it('rejects names starting with a digit', () => {
    const r = forge.validateProposal({ animName: '2meditate', description: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /animName/);
  });

  it('rejects names with punctuation / hyphens', () => {
    const r = forge.validateProposal({ animName: 'medi-tate', description: 'x' });
    assert.equal(r.ok, false);
  });

  it('rejects names longer than 31 chars', () => {
    const r = forge.validateProposal({
      animName: 'a'.repeat(32),
      description: 'x',
    });
    assert.equal(r.ok, false);
  });

  it('rejects empty description', () => {
    const r = forge.validateProposal({ animName: 'meditate', description: '' });
    assert.equal(r.ok, false);
    assert.match(r.error, /description/);
  });

  it('rejects description longer than 200 chars', () => {
    const r = forge.validateProposal({
      animName: 'meditate',
      description: 'a'.repeat(201),
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /too long/);
  });

  it('rejects missing input gracefully', () => {
    const r = forge.validateProposal();
    assert.equal(r.ok, false);
  });
});

describe('animation-forge.composeFromExistingFrames', () => {
  it('returns a composition spec for a known base emote', () => {
    const spec = forge.composeFromExistingFrames({ baseEmote: 'sit', tint: 0x88ccff, label: 'reading' });
    assert.equal(spec.kind, 'composition');
    assert.equal(spec.baseEmote, 'sit');
    assert.equal(spec.tint, 0x88ccff);
    assert.equal(spec.label, 'reading');
  });

  it('passes tint and label through as null when not provided', () => {
    const spec = forge.composeFromExistingFrames({ baseEmote: 'idle' });
    assert.equal(spec.kind, 'composition');
    assert.equal(spec.baseEmote, 'idle');
    assert.equal(spec.tint, null);
    assert.equal(spec.label, null);
  });

  it('truncates label to 60 chars', () => {
    const spec = forge.composeFromExistingFrames({ baseEmote: 'idle', label: 'x'.repeat(120) });
    assert.equal(spec.label.length, 60);
  });

  it('returns an error spec for unknown baseEmote', () => {
    const spec = forge.composeFromExistingFrames({ baseEmote: 'unknown_pose' });
    assert.equal(spec.kind, 'error');
    assert.match(spec.error, /baseEmote/);
  });

  it('handles missing input gracefully', () => {
    const spec = forge.composeFromExistingFrames();
    assert.equal(spec.kind, 'error');
  });
});

describe('animation-forge exports', () => {
  it('exposes the validation constants so the endpoint can stay in sync', () => {
    assert.ok(forge.ANIM_NAME_RE instanceof RegExp);
    assert.equal(typeof forge.MAX_DESCRIPTION_LEN, 'number');
    assert.ok(forge.COMPOSITION_BASES instanceof Set);
    assert.ok(forge.COMPOSITION_BASES.has('sit'));
  });
});
