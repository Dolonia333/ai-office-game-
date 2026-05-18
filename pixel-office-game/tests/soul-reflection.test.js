'use strict';
/**
 * Pure logic tests for src/soul-reflection.js (Roadmap Stage 3 step 1).
 * No server boot, no fs writes — just unit-level assertions on the
 * prompt builder, validator, and serializer.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReflectionPrompt,
  validateProposal,
  serializeProposal,
  applyProposalToSoul,
  serializeHistoryEntry,
  SUMMARY_MAX_LEN,
  FIELD_MAX_LEN,
} = require('../src/soul-reflection');

describe('soul-reflection.buildReflectionPrompt', () => {
  it('includes the NPC name and memory excerpts', () => {
    const out = buildReflectionPrompt({
      npcName: 'Abby',
      soul: '# Abby\n## Personality\nConfident, decisive.',
      recentMemories: [
        '[2026-05-16T10:00] Reviewed PR for Alex.',
        '[2026-05-16T11:30] Got anxious in the standup.',
      ],
    });
    assert.match(out, /Abby/, 'prompt should mention the NPC by name');
    assert.match(out, /Reviewed PR for Alex/, 'prompt should embed memory line 1');
    assert.match(out, /anxious in the standup/, 'prompt should embed memory line 2');
    assert.match(out, /Confident, decisive\./, 'prompt should embed SOUL.md');
    assert.match(out, /JSON/, 'prompt should describe the JSON schema');
    assert.match(out, /addToSoul/, 'prompt should reference the addToSoul field');
    assert.match(out, /dropFromSoul/, 'prompt should reference the dropFromSoul field');
    assert.match(out, /confidence/, 'prompt should reference confidence');
  });

  it('handles a string memory blob (not just an array)', () => {
    const out = buildReflectionPrompt({
      npcName: 'Bob',
      soul: '# Bob',
      recentMemories: 'first thing\nsecond thing\nthird thing',
    });
    assert.match(out, /first thing/);
    assert.match(out, /second thing/);
  });

  it('renders a placeholder when there are no memories', () => {
    const out = buildReflectionPrompt({
      npcName: 'Lucy',
      soul: '# Lucy',
      recentMemories: [],
    });
    assert.match(out, /no recent memories/i);
  });

  it('does not throw when called with an empty args object', () => {
    const out = buildReflectionPrompt({});
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0);
  });
});

describe('soul-reflection.validateProposal', () => {
  function mk(over = {}) {
    return Object.assign({
      addToSoul: 'I prefer code review to planning.',
      dropFromSoul: null,
      summary: 'Behavior shows preference for code review.',
      confidence: 0.7,
    }, over);
  }

  it('accepts a well-formed proposal', () => {
    const r = validateProposal(mk());
    assert.equal(r.ok, true);
  });

  it('rejects non-object input', () => {
    assert.equal(validateProposal(null).ok, false);
    assert.equal(validateProposal(undefined).ok, false);
    assert.equal(validateProposal('hello').ok, false);
    assert.equal(validateProposal(42).ok, false);
    assert.equal(validateProposal([]).ok, false);
  });

  it('rejects when both addToSoul and dropFromSoul are null/empty', () => {
    const r = validateProposal(mk({ addToSoul: null, dropFromSoul: null }));
    assert.equal(r.ok, false);
    assert.match(r.error, /no-op/);

    const r2 = validateProposal(mk({ addToSoul: '   ', dropFromSoul: '' }));
    assert.equal(r2.ok, false);
  });

  it('accepts a drop-only proposal', () => {
    const r = validateProposal(mk({ addToSoul: null, dropFromSoul: 'I get anxious in meetings.' }));
    assert.equal(r.ok, true);
  });

  it('rejects out-of-range confidence', () => {
    assert.equal(validateProposal(mk({ confidence: -0.1 })).ok, false);
    assert.equal(validateProposal(mk({ confidence: 1.1 })).ok, false);
    assert.equal(validateProposal(mk({ confidence: NaN })).ok, false);
    assert.equal(validateProposal(mk({ confidence: Infinity })).ok, false);
    assert.equal(validateProposal(mk({ confidence: 'high' })).ok, false);
  });

  it('rejects missing or empty summary', () => {
    assert.equal(validateProposal(mk({ summary: undefined })).ok, false);
    assert.equal(validateProposal(mk({ summary: '' })).ok, false);
    assert.equal(validateProposal(mk({ summary: '   ' })).ok, false);
    assert.equal(validateProposal(mk({ summary: 12 })).ok, false);
  });

  it('rejects summary longer than the cap', () => {
    const big = 'x'.repeat(SUMMARY_MAX_LEN + 1);
    const r = validateProposal(mk({ summary: big }));
    assert.equal(r.ok, false);
    assert.match(r.error, /summary/);
  });

  it('rejects addToSoul/dropFromSoul of wrong type', () => {
    assert.equal(validateProposal(mk({ addToSoul: { x: 1 } })).ok, false);
    assert.equal(validateProposal(mk({ dropFromSoul: 12 })).ok, false);
  });

  it('rejects fields longer than the field cap', () => {
    const big = 'y'.repeat(FIELD_MAX_LEN + 1);
    assert.equal(validateProposal(mk({ addToSoul: big })).ok, false);
    assert.equal(validateProposal(mk({ addToSoul: null, dropFromSoul: big })).ok, false);
  });
});

describe('soul-reflection.serializeProposal', () => {
  it('produces a record with id, timestamp, status=pending', () => {
    const rec = serializeProposal({
      npcName: 'Abby',
      proposal: {
        addToSoul: 'I prefer reviewing PRs to running standups.',
        dropFromSoul: null,
        summary: 'Behavior favors review over facilitation.',
        confidence: 0.65,
      },
      reflectionInput: 'memory line a\nmemory line b',
    });

    assert.ok(rec.id, 'record should have an id');
    assert.match(rec.id, /proposal_/);
    assert.equal(rec.npcName, 'Abby');
    assert.equal(rec.status, 'pending');
    assert.ok(rec.createdAt, 'record should have createdAt');
    assert.match(rec.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(rec.review, null, 'review starts as null');
    assert.equal(rec.proposal.confidence, 0.65);
    assert.equal(rec.proposal.addToSoul, 'I prefer reviewing PRs to running standups.');
    assert.equal(rec.proposal.dropFromSoul, null);
    assert.match(rec.reflectionPreview, /memory line a/);
  });

  it('respects idOverride for deterministic tests', () => {
    const rec = serializeProposal({
      npcName: 'Bob',
      proposal: { addToSoul: 'x', dropFromSoul: null, summary: 's', confidence: 0.5 },
      idOverride: 'proposal_fixed_id',
    });
    assert.equal(rec.id, 'proposal_fixed_id');
  });

  it('truncates a long reflectionInput preview', () => {
    const big = 'a'.repeat(5000);
    const rec = serializeProposal({
      npcName: 'Bob',
      proposal: { addToSoul: 'x', dropFromSoul: null, summary: 's', confidence: 0.5 },
      reflectionInput: big,
    });
    assert.ok(rec.reflectionPreview.length <= 800);
  });

  it('coerces missing fields safely', () => {
    const rec = serializeProposal({
      npcName: 'Lucy',
      proposal: { summary: 'something', confidence: 0.4 },
    });
    assert.equal(rec.proposal.addToSoul, null);
    assert.equal(rec.proposal.dropFromSoul, null);
    assert.equal(rec.proposal.summary, 'something');
    assert.equal(rec.reflectionPreview, null);
  });
});

describe('soul-reflection.applyProposalToSoul', () => {
  const baseSoul = [
    '# Abby — CTO',
    '',
    '## Personality',
    'Calm, decisive, anxious in standups.',
    '',
    '## Values',
    '- Ship every Friday.',
    '- Trust the team.',
    '',
  ].join('\n');

  function mkRecord(proposalOver = {}, id = 'proposal_test_1') {
    return {
      id,
      npcName: 'Abby',
      status: 'approved',
      proposal: Object.assign({
        addToSoul: 'I review PRs more than I plan sprints.',
        dropFromSoul: null,
        summary: 'review > planning',
        confidence: 0.7,
      }, proposalOver),
    };
  }

  it('appends addToSoul as a new paragraph with a dated marker comment', () => {
    const { next, warnings } = applyProposalToSoul({
      soulText: baseSoul,
      proposal: mkRecord(),
    });
    assert.equal(warnings.length, 0);
    assert.match(next, /I review PRs more than I plan sprints\./);
    assert.match(next, /<!-- applied \d{4}-\d{2}-\d{2} from proposal:proposal_test_1 -->/);
    // Old content preserved.
    assert.match(next, /Ship every Friday\./);
    // Ends with a single trailing newline (no extra whitespace).
    assert.ok(next.endsWith('\n'));
    assert.ok(!next.endsWith('\n\n'));
  });

  it('removes the matching dropFromSoul line', () => {
    const { next, warnings } = applyProposalToSoul({
      soulText: baseSoul,
      proposal: mkRecord({
        addToSoul: null,
        dropFromSoul: 'Ship every Friday',
      }),
    });
    assert.equal(warnings.length, 0);
    assert.ok(!/Ship every Friday/.test(next), 'drop line should be gone');
    // Other content preserved.
    assert.match(next, /Calm, decisive/);
    assert.match(next, /Trust the team/);
  });

  it('returns a warning when dropFromSoul text is not found', () => {
    const { next, warnings } = applyProposalToSoul({
      soulText: baseSoul,
      proposal: mkRecord({
        addToSoul: 'something new',
        dropFromSoul: 'this line does not exist anywhere',
      }),
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /dropFromSoul/);
    // Add still happens even if drop fails.
    assert.match(next, /something new/);
  });

  it('only removes the FIRST matching line', () => {
    const soul = 'A\nrepeating line\nB\nrepeating line\nC\n';
    const { next } = applyProposalToSoul({
      soulText: soul,
      proposal: mkRecord({
        addToSoul: null,
        dropFromSoul: 'repeating line',
      }),
    });
    const matches = next.match(/repeating line/g) || [];
    assert.equal(matches.length, 1);
  });

  it('handles both add and drop in one apply', () => {
    const { next, warnings } = applyProposalToSoul({
      soulText: baseSoul,
      proposal: mkRecord({
        addToSoul: 'I delegate sprint planning to Alex.',
        dropFromSoul: 'Ship every Friday',
      }),
    });
    assert.equal(warnings.length, 0);
    assert.ok(!/Ship every Friday/.test(next));
    assert.match(next, /I delegate sprint planning to Alex\./);
  });
});

describe('soul-reflection.serializeHistoryEntry', () => {
  it('produces a markdown entry with all expected fields', () => {
    const entry = serializeHistoryEntry({
      proposal: {
        id: 'proposal_history_1',
        npcName: 'Abby',
        proposal: {
          addToSoul: 'I delegate planning.',
          dropFromSoul: 'anxious in standups',
          summary: 'shifted role.',
          confidence: 0.8,
        },
        review: { reviewedAt: '2026-05-18T01:00:00.000Z' },
      },
      applied: { at: '2026-05-18T02:00:00.000Z' },
    });
    assert.match(entry, /## 2026-05-18T02:00:00\.000Z — proposal:proposal_history_1/);
    assert.match(entry, /- by: Abby/);
    assert.match(entry, /- summary: shifted role\./);
    assert.match(entry, /- confidence: 0\.8/);
    assert.match(entry, /- addToSoul: "I delegate planning\."/);
    assert.match(entry, /- dropFromSoul: "anxious in standups"/);
    assert.match(entry, /- approvedAt: 2026-05-18T01:00:00\.000Z/);
    assert.match(entry, /- appliedAt: 2026-05-18T02:00:00\.000Z/);
  });

  it('renders null fields as literal "null"', () => {
    const entry = serializeHistoryEntry({
      proposal: {
        id: 'p_null',
        npcName: 'Bob',
        proposal: {
          addToSoul: 'something',
          dropFromSoul: null,
          summary: 's',
          confidence: 0.5,
        },
      },
      applied: { at: '2026-05-18T00:00:00.000Z' },
    });
    assert.match(entry, /- dropFromSoul: null/);
  });
});
