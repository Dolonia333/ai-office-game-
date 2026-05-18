'use strict';
/**
 * Pure-logic tests for src/capability-proposal.js. No HTTP, no filesystem.
 * Covers:
 *   - validateProposal accepts valid input
 *   - validateProposal rejects malformed verbName (uppercase first letter,
 *     kebab-case, leading digit, too long)
 *   - validateProposal rejects too-short description (< 10)
 *   - validateProposal rejects overlong description (> 400)
 *   - serializeProposal returns the expected record shape
 *   - module exports include the validation constants for sync with the endpoint
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const cap = require('../src/capability-proposal');

describe('capability-proposal.validateProposal', () => {
  it('accepts a valid camelCase verb + description', () => {
    const r = cap.validateProposal({
      verbName: 'whiteboardDraw',
      description: 'Render short text on the whiteboard sprite.',
    });
    assert.deepEqual(r, { ok: true });
  });

  it('accepts an all-lowercase single-word verb', () => {
    const r = cap.validateProposal({
      verbName: 'meditate',
      description: 'Enter a focused state for several seconds.',
    });
    assert.equal(r.ok, true);
  });

  it('accepts digits after the first letter', () => {
    const r = cap.validateProposal({
      verbName: 'printDocument2',
      description: 'Send the latest report draft to the printer.',
    });
    assert.equal(r.ok, true);
  });

  it('rejects verbName starting with uppercase', () => {
    const r = cap.validateProposal({
      verbName: 'WhiteboardDraw',
      description: 'Render short text on the whiteboard sprite.',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /verbName/);
  });

  it('rejects kebab-case verbName', () => {
    const r = cap.validateProposal({
      verbName: 'whiteboard-draw',
      description: 'Render short text on the whiteboard sprite.',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /verbName/);
  });

  it('rejects snake_case verbName (underscore not allowed in this regex)', () => {
    const r = cap.validateProposal({
      verbName: 'whiteboard_draw',
      description: 'Render short text on the whiteboard sprite.',
    });
    assert.equal(r.ok, false);
  });

  it('rejects verbName starting with a digit', () => {
    const r = cap.validateProposal({
      verbName: '2draw',
      description: 'Render short text on the whiteboard sprite.',
    });
    assert.equal(r.ok, false);
  });

  it('rejects verbName longer than 31 chars', () => {
    const r = cap.validateProposal({
      verbName: 'a' + 'B'.repeat(31), // 32 total
      description: 'Render short text on the whiteboard sprite.',
    });
    assert.equal(r.ok, false);
  });

  it('rejects description shorter than 10 chars', () => {
    const r = cap.validateProposal({
      verbName: 'meditate',
      description: 'short',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /description/);
  });

  it('rejects empty description', () => {
    const r = cap.validateProposal({
      verbName: 'meditate',
      description: '',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /description/);
  });

  it('rejects description longer than 400 chars', () => {
    const r = cap.validateProposal({
      verbName: 'meditate',
      description: 'a'.repeat(401),
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /too long/);
  });

  it('rejects missing input gracefully', () => {
    const r = cap.validateProposal();
    assert.equal(r.ok, false);
  });
});

describe('capability-proposal.serializeProposal', () => {
  it('returns the expected record shape', () => {
    const before = Date.now();
    const rec = cap.serializeProposal({
      by: 'Roki',
      verbName: 'whiteboardDraw',
      description: 'Render short text on the whiteboard sprite.',
    });
    const after = Date.now();

    assert.ok(typeof rec.id === 'string' && rec.id.startsWith('cap_'),
      'id should be a string with cap_ prefix');
    assert.equal(rec.by, 'Roki');
    assert.equal(rec.verbName, 'whiteboardDraw');
    assert.equal(rec.description, 'Render short text on the whiteboard sprite.');
    assert.equal(rec.status, 'pending');
    assert.equal(rec.review, null);
    assert.ok(typeof rec.proposedAt === 'number');
    assert.ok(rec.proposedAt >= before && rec.proposedAt <= after,
      'proposedAt should be a current timestamp');
  });

  it('honours idOverride for deterministic ids in tests', () => {
    const rec = cap.serializeProposal({
      by: 'Roki',
      verbName: 'meditate',
      description: 'Enter a focused state.',
      idOverride: 'cap_fixed_id_001',
    });
    assert.equal(rec.id, 'cap_fixed_id_001');
  });

  it('coerces missing fields to safe defaults', () => {
    const rec = cap.serializeProposal({});
    assert.equal(rec.by, '');
    assert.equal(rec.verbName, '');
    assert.equal(rec.description, '');
    assert.equal(rec.status, 'pending');
  });
});

describe('capability-proposal exports', () => {
  it('exposes the validation constants so the endpoint can stay in sync', () => {
    assert.ok(cap.VERB_NAME_RE instanceof RegExp);
    assert.equal(typeof cap.MIN_DESCRIPTION_LEN, 'number');
    assert.equal(typeof cap.MAX_DESCRIPTION_LEN, 'number');
    assert.ok(cap.MIN_DESCRIPTION_LEN < cap.MAX_DESCRIPTION_LEN);
  });
});
