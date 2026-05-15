'use strict';

/**
 * Single source of truth for office NPCs: soul folder, display name, Phaser texture key, asset filename.
 * Loaded in Node (npc-brains) and in the browser before agent-office-manager, player-chat, office-scene.
 */

const NPC_ROSTER_ENTRIES = [
  { folder: 'abby', display: 'Abby', textureKey: 'xp_abby', assetName: 'Abby' },
  { folder: 'alex', display: 'Alex', textureKey: 'xp_alex', assetName: 'Alex' },
  { folder: 'bob', display: 'Bob', textureKey: 'xp_bob', assetName: 'Bob' },
  { folder: 'jenny', display: 'Jenny', textureKey: 'xp_jenny', assetName: 'Jenny' },
  { folder: 'dan', display: 'Dan', textureKey: 'xp_dan', assetName: 'Dan' },
  { folder: 'lucy', display: 'Lucy', textureKey: 'xp_lucy', assetName: 'Lucy' },
  { folder: 'bouncer', display: 'Bouncer', textureKey: 'xp_bouncer', assetName: 'Bouncer' },
  { folder: 'conference_man', display: 'Marcus', textureKey: 'xp_conference_man', assetName: 'Conference_man' },
  { folder: 'conference_woman', display: 'Sarah', textureKey: 'xp_conference_woman', assetName: 'Conference_woman' },
  { folder: 'edward', display: 'Edward', textureKey: 'xp_edward', assetName: 'Edward' },
  { folder: 'josh', display: 'Josh', textureKey: 'xp_josh', assetName: 'Josh' },
  { folder: 'molly', display: 'Molly', textureKey: 'xp_molly', assetName: 'Molly' },
  { folder: 'oscar', display: 'Oscar', textureKey: 'xp_oscar', assetName: 'Oscar' },
  { folder: 'pier', display: 'Pier', textureKey: 'xp_pier', assetName: 'Pier' },
  { folder: 'rob', display: 'Rob', textureKey: 'xp_rob', assetName: 'Rob' },
  { folder: 'roki', display: 'Roki', textureKey: 'xp_roki', assetName: 'Roki' },
];

const nameToKey = Object.fromEntries(
  NPC_ROSTER_ENTRIES.map((e) => [e.display.toLowerCase(), e.textureKey])
);
const keyToDisplay = Object.fromEntries(
  NPC_ROSTER_ENTRIES.map((e) => [e.textureKey, e.display])
);
const displayNames = NPC_ROSTER_ENTRIES.map((e) => e.display);
const assetNames = NPC_ROSTER_ENTRIES.map((e) => e.assetName);

const DenizenNpcRoster = {
  entries: NPC_ROSTER_ENTRIES,
  nameToKey,
  keyToDisplay,
  displayNames,
  assetNames,
};

if (typeof globalThis !== 'undefined') {
  globalThis.DenizenNpcRoster = DenizenNpcRoster;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DenizenNpcRoster;
}
