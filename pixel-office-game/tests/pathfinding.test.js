'use strict';
/**
 * Tests for the pathfinding system (OfficePathfinder + NpcPathFollower).
 * Uses Node.js built-in test runner (node:test) — no extra dependencies.
 * pathfinding.js exports via window.* globals, so we shim window before loading.
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Shim browser globals required by pathfinding.js
global.window = global.window || {};

// Load the module — it assigns OfficePathfinder and NpcPathFollower to window
require('../src/pathfinding.js');

const OfficePathfinder = global.window.OfficePathfinder;
const NpcPathFollower  = global.window.NpcPathFollower;

// ---------------------------------------------------------------------------
// OfficePathfinder
// ---------------------------------------------------------------------------

describe('OfficePathfinder', () => {
  let pf;

  beforeEach(() => {
    // 320 × 240 px world, 16 px cells → 20 × 15 grid
    pf = new OfficePathfinder(320, 240, 16);
  });

  it('constructor computes correct grid dimensions', () => {
    assert.equal(pf.cols, 20);
    assert.equal(pf.rows, 15);
    assert.equal(pf.grid.length, 20 * 15);
  });

  it('fresh grid is entirely walkable', () => {
    for (let i = 0; i < pf.grid.length; i++) {
      assert.equal(pf.grid[i], 0);
    }
  });

  it('toGrid converts pixel coords to grid coords', () => {
    assert.deepEqual(pf.toGrid(0,  0),  { x: 0, y: 0 });
    assert.deepEqual(pf.toGrid(16, 16), { x: 1, y: 1 });
    assert.deepEqual(pf.toGrid(24, 32), { x: 1, y: 2 }); // floor(24/16)=1, floor(32/16)=2
  });

  it('toPixel returns the centre of a grid cell', () => {
    assert.deepEqual(pf.toPixel(0, 0), { x: 8,  y: 8  });
    assert.deepEqual(pf.toPixel(1, 1), { x: 24, y: 24 });
    assert.deepEqual(pf.toPixel(2, 3), { x: 40, y: 56 });
  });

  it('toGrid → toPixel round-trip lands in the same cell', () => {
    const worldX = 72, worldY = 88;
    const g = pf.toGrid(worldX, worldY);
    const p = pf.toPixel(g.x, g.y);
    // The pixel centre must map back to the same grid cell
    assert.deepEqual(pf.toGrid(p.x, p.y), g);
  });

  it('isWalkable returns true for cells inside unobstructed grid', () => {
    assert.equal(pf.isWalkable(5, 5), true);
    assert.equal(pf.isWalkable(10, 7), true);
  });

  it('isWalkable returns false for out-of-bounds coords', () => {
    assert.equal(pf.isWalkable(-1, 0), false);
    assert.equal(pf.isWalkable(0, -1), false);
    assert.equal(pf.isWalkable(20, 0), false);  // cols = 20 → index 20 is OOB
    assert.equal(pf.isWalkable(0, 15), false);  // rows = 15 → index 15 is OOB
  });

  it('isWalkable returns false for a manually blocked cell', () => {
    pf.grid[5 * pf.cols + 5] = 1; // block cell (5, 5)
    assert.equal(pf.isWalkable(5, 5), false);
  });

  it('findPath returns an array of waypoints in an empty grid', () => {
    const path = pf.findPath(24, 24, 200, 200);
    assert.notEqual(path, null);
    assert.ok(Array.isArray(path));
    assert.ok(path.length > 0);
    for (const wp of path) {
      assert.ok('x' in wp);
      assert.ok('y' in wp);
      assert.ok(wp.x >= 0);
      assert.ok(wp.y >= 0);
    }
  });

  it('findPath returns empty array when start equals destination', () => {
    const path = pf.findPath(48, 48, 48, 48);
    assert.deepEqual(path, []);
  });

  it('findPath returns null when destination is completely blocked', () => {
    pf.grid.fill(1);
    const path = pf.findPath(24, 24, 200, 200);
    assert.equal(path, null);
  });
});

// ---------------------------------------------------------------------------
// NpcPathFollower
// ---------------------------------------------------------------------------

describe('NpcPathFollower', () => {
  let pf;

  function makeNpc(x = 48, y = 48) {
    return {
      x,
      y,
      body: { velocity: { x: 0, y: 0 }, setVelocity: () => {} },
      ai: { facing: 'down', moving: false },
    };
  }

  beforeEach(() => {
    pf = new OfficePathfinder(320, 240, 16);
  });

  it('constructor initialises _stuckCount to 0', () => {
    const npc = makeNpc();
    const follower = new NpcPathFollower(npc, pf);
    assert.equal(follower._stuckCount, 0);
  });

  it('constructor initialises waypoints to null', () => {
    const npc = makeNpc();
    const follower = new NpcPathFollower(npc, pf);
    assert.equal(follower.waypoints, null);
  });

  it('navigateTo finds a path in an empty grid', () => {
    const npc = makeNpc(48, 48);
    const follower = new NpcPathFollower(npc, pf);
    const found = follower.navigateTo(200, 200);
    assert.equal(found, true);
    assert.notEqual(follower.waypoints, null);
    assert.ok(follower.waypoints.length > 0);
  });

  it('navigateTo returns false when all cells are blocked', () => {
    pf.grid.fill(1);
    const npc = makeNpc(48, 48);
    const follower = new NpcPathFollower(npc, pf);
    const found = follower.navigateTo(200, 200);
    assert.equal(found, false);
    assert.equal(follower.waypoints, null);
  });
});
