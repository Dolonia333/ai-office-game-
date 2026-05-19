'use strict';
/**
 * Unit tests for the proximity-audio volume / mute logic.
 *
 * The module reads `window.__DenizenScene.player`, `scene.npcs`, and
 * `window.DenizenNpcRoster`. We stub all of those on globalThis so the
 * module can be required from Node's test runner without a browser.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Mini DOM shim: just enough so the script's `(function () { ... })()`
// IIFE can finish without throwing. The module guards on `typeof window`
// so we install a minimal one and let it self-attach.
function loadModule() {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }
  delete require.cache[require.resolve('../src/proximity-audio.js')];
  return require('../src/proximity-audio.js');
}

function setupScene({ playerXY, npcs, facingVx, facingVy }) {
  globalThis.window.DenizenNpcRoster = {
    keyToDisplay: Object.fromEntries(npcs.map((n) => [n.key, n.name])),
  };
  globalThis.window.__DenizenScene = {
    player: {
      x: playerXY.x,
      y: playerXY.y,
      body: { velocity: { x: facingVx || 0, y: facingVy || 0 } },
    },
    npcs: npcs.map((n) => ({
      texture: { key: n.key },
      x: n.x,
      y: n.y,
    })),
  };
}

describe('proximity-audio.computeVolumeForNpc', () => {
  beforeEach(() => {
    // Ensure window exists, then clear per-case state. The module
    // self-attaches to whatever `window` is at require time.
    if (typeof globalThis.window === 'undefined') {
      globalThis.window = globalThis;
    }
    delete globalThis.window.__DenizenScene;
    delete globalThis.window.DenizenNpcRoster;
    delete globalThis.window.DenizenProximityAudio;
    delete globalThis.window.DenizenProximityConfig;
  });

  it('returns full volume when scene is unavailable (early boot)', () => {
    const m = loadModule();
    const { volume, muted } = m.computeVolumeForNpc('Lucy');
    assert.equal(muted, false);
    assert.equal(volume, 1);
  });

  it('returns full volume when NPC is within fullVolumeRadius and player is facing them', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 100, y: 100 },
      npcs: [{ key: 'xp_lucy', name: 'Lucy', x: 150, y: 100 }],
      facingVx: 30, facingVy: 0, // moving toward Lucy
    });
    const { volume, muted } = m.computeVolumeForNpc('Lucy');
    assert.equal(muted, false);
    assert.equal(volume, 1);
  });

  it('falls off to minVolume past whisperRadius', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 0, y: 0 },
      npcs: [{ key: 'xp_lucy', name: 'Lucy', x: 800, y: 0 }],
      facingVx: 30, facingVy: 0,
    });
    const { volume } = m.computeVolumeForNpc('Lucy');
    assert.ok(volume <= 0.15, `expected near-min but got ${volume}`);
    assert.ok(volume >= 0, `expected non-negative but got ${volume}`);
  });

  it('interpolates between full and whisper radius', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 0, y: 0 },
      // halfway between 90 (full) and 320 (whisper)
      npcs: [{ key: 'xp_lucy', name: 'Lucy', x: 205, y: 0 }],
      facingVx: 30, facingVy: 0,
    });
    const { volume } = m.computeVolumeForNpc('Lucy');
    assert.ok(volume < 1 && volume > 0.2, `expected mid-range but got ${volume}`);
  });

  it('halves volume when player is facing away from the NPC', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 0, y: 0 },
      npcs: [{ key: 'xp_lucy', name: 'Lucy', x: 200, y: 0 }],
      facingVx: -30, facingVy: 0, // moving AWAY from Lucy
    });
    const facingAway = m.computeVolumeForNpc('Lucy').volume;

    setupScene({
      playerXY: { x: 0, y: 0 },
      npcs: [{ key: 'xp_lucy', name: 'Lucy', x: 200, y: 0 }],
      facingVx: 30, facingVy: 0, // moving TOWARD Lucy
    });
    const facingToward = m.computeVolumeForNpc('Lucy').volume;

    assert.ok(facingAway < facingToward, `expected facing-away < facing-toward (${facingAway} vs ${facingToward})`);
  });

  it('mutes every NPC except the active conversation partner', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 0, y: 0 },
      npcs: [
        { key: 'xp_lucy', name: 'Lucy', x: 30, y: 0 },
        { key: 'xp_alex', name: 'Alex', x: 30, y: 30 },
      ],
      facingVx: 30, facingVy: 0,
    });
    m.setActiveConvoNpc('Lucy');
    const lucy = m.computeVolumeForNpc('Lucy');
    const alex = m.computeVolumeForNpc('Alex');
    assert.equal(lucy.muted, false);
    assert.equal(alex.muted, true);
    assert.match(alex.reason, /mid-chat with Lucy/);
  });

  it('active convo decays after its TTL', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 0, y: 0 },
      npcs: [{ key: 'xp_alex', name: 'Alex', x: 30, y: 0 }],
      facingVx: 30, facingVy: 0,
    });
    m.setActiveConvoNpc('Lucy', 5);   // very short TTL
    return new Promise((resolve) => {
      setTimeout(() => {
        const alex = m.computeVolumeForNpc('Alex');
        assert.equal(alex.muted, false, 'should be unmuted after TTL');
        resolve();
      }, 20);
    });
  });

  it('explicit null clears the active convo', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 0, y: 0 },
      npcs: [{ key: 'xp_alex', name: 'Alex', x: 30, y: 0 }],
      facingVx: 30, facingVy: 0,
    });
    m.setActiveConvoNpc('Lucy');
    assert.equal(m.computeVolumeForNpc('Alex').muted, true);
    m.setActiveConvoNpc(null);
    assert.equal(m.computeVolumeForNpc('Alex').muted, false);
  });

  it('falls back to medium volume for unknown NPCs (robbers, off-screen visitors)', () => {
    const m = loadModule();
    setupScene({
      playerXY: { x: 0, y: 0 },
      npcs: [],
      facingVx: 30, facingVy: 0,
    });
    const { volume, muted, reason } = m.computeVolumeForNpc('robber_xyz');
    assert.equal(muted, false);
    assert.equal(volume, 0.5);
    assert.match(reason, /no-sprite/);
  });
});

describe('proximity-audio.acquireSpeakerSlot', () => {
  beforeEach(() => {
    if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
    delete globalThis.window.__DenizenScene;
    delete globalThis.window.DenizenNpcRoster;
    delete globalThis.window.DenizenProximityAudio;
    delete globalThis.window.DenizenProximityConfig;
  });

  it('first speaker gets the slot; second gets dropped while first holds it', () => {
    const m = loadModule();
    assert.equal(m.acquireSpeakerSlot('Lucy', 'Hello there'), true);
    assert.equal(m.acquireSpeakerSlot('Edward', 'I have an update'), false);
    assert.equal(m.getSlotHolder(), 'Lucy');
  });

  it('release frees the slot for the next speaker', () => {
    const m = loadModule();
    m.acquireSpeakerSlot('Lucy', 'short');
    m.releaseSpeakerSlot('Lucy');
    assert.equal(m.getSlotHolder(), null);
    assert.equal(m.acquireSpeakerSlot('Edward', 'longer line'), true);
  });

  it('a late release from a previous speaker does not steal the new slot', () => {
    const m = loadModule();
    m.acquireSpeakerSlot('Lucy', 'first');
    m.releaseSpeakerSlot('Lucy');
    m.acquireSpeakerSlot('Edward', 'second');
    // Lucy's audio finishes late and fires an onended → release('Lucy')
    m.releaseSpeakerSlot('Lucy'); // should be a no-op
    assert.equal(m.getSlotHolder(), 'Edward');
  });

  it('active-convo partner can steal the slot (player priority)', () => {
    const m = loadModule();
    m.acquireSpeakerSlot('Edward', 'I am rambling');
    m.setActiveConvoNpc('Lucy');
    // Lucy is the player's chat partner — should preempt Edward.
    assert.equal(m.acquireSpeakerSlot('Lucy', 'Sorry, you were asking?'), true);
    assert.equal(m.getSlotHolder(), 'Lucy');
  });

  it('slot auto-expires roughly proportional to text length', async () => {
    const m = loadModule();
    // Cheat by pretending we acquired a slot for a 1-char string, which
    // clamps to 800ms minimum. We jam the holder, wait > 800ms, then
    // assert it's free again.
    m.acquireSpeakerSlot('Lucy', 'a');
    await new Promise((r) => setTimeout(r, 850));
    assert.equal(m.getSlotHolder(), null, 'slot should auto-expire after the estimated duration');
  });
});

describe('proximity-audio file shape', () => {
  it('has the right module surface and graceful fallbacks', () => {
    const file = fs.readFileSync(path.join(__dirname, '..', 'src', 'proximity-audio.js'), 'utf8');
    assert.match(file, /computeVolumeForNpc/);
    assert.match(file, /setActiveConvoNpc/);
    assert.match(file, /getActiveConvoNpc/);
    // Must guard against missing scene.
    assert.match(file, /no-scene/);
  });
});
