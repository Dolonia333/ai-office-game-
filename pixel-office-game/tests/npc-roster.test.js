'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const roster = require('../src/npc-roster.js');

describe('npc-roster', () => {
  it('has 16 NPCs aligned with office cast', () => {
    assert.equal(roster.entries.length, 16);
  });

  it('maps display names to texture keys (Marcus / Sarah)', () => {
    assert.equal(roster.nameToKey.marcus, 'xp_conference_man');
    assert.equal(roster.nameToKey.sarah, 'xp_conference_woman');
  });

  it('maps texture keys to display names', () => {
    assert.equal(roster.keyToDisplay.xp_conference_man, 'Marcus');
    assert.equal(roster.keyToDisplay.xp_abby, 'Abby');
  });

  it('asset names match Phaser preload filenames', () => {
    assert.ok(roster.assetNames.includes('Conference_man'));
    assert.ok(roster.assetNames.includes('Abby'));
  });
});
