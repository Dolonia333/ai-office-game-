'use strict';
/**
 * Tests for the CJS city planner heuristic.
 *
 * The ESM version (`src/city/planner.js`) shares the same algorithm; we
 * test the CJS variant because Node's built-in test runner doesn't load
 * ESM cleanly across all Node versions in CI.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { planCityZones, makeRng } = require('../src/city/planner-heuristic.cjs');

describe('planner-heuristic — shape', () => {
  it('returns the expected envelope', () => {
    const plan = planCityZones({ seed: 'demo', gridW: 4, gridH: 3 });
    assert.equal(plan.gridW, 4);
    assert.equal(plan.gridH, 3);
    assert.equal(typeof plan.seed, 'string');
    assert.ok(Array.isArray(plan.zones));
  });

  it('produces exactly gridW * gridH zones (one per cell)', () => {
    const plan = planCityZones({ seed: 's', gridW: 5, gridH: 4 });
    assert.equal(plan.zones.length, 20);
  });

  it('every zone has a recognized type and valid rect', () => {
    const plan = planCityZones({ seed: 's', gridW: 5, gridH: 3 });
    const allowed = new Set(['downtown', 'residential', 'industrial', 'park']);
    for (const z of plan.zones) {
      assert.ok(allowed.has(z.zone), `zone "${z.zone}" not in allowlist`);
      assert.ok(z.rect && Number.isInteger(z.rect.x) && Number.isInteger(z.rect.y));
      assert.ok(z.rect.w >= 1 && z.rect.h >= 1);
    }
  });
});

describe('planner-heuristic — determinism', () => {
  it('same seed + same prompt → identical plan', () => {
    const a = planCityZones({ seed: 'X', prompt: 'p', gridW: 4, gridH: 3 });
    const b = planCityZones({ seed: 'X', prompt: 'p', gridW: 4, gridH: 3 });
    assert.deepEqual(a, b);
  });

  it('different prompt with same seed → different plan', () => {
    const a = planCityZones({ seed: 'X', prompt: 'one', gridW: 4, gridH: 3 });
    const b = planCityZones({ seed: 'X', prompt: 'two', gridW: 4, gridH: 3 });
    assert.notDeepEqual(a.zones, b.zones);
  });
});

describe('planner-heuristic — RNG', () => {
  it('makeRng float() stays in [0, 1)', () => {
    const rng = makeRng('seed-x');
    for (let i = 0; i < 200; i++) {
      const v = rng.float();
      assert.ok(v >= 0 && v < 1, `float ${v} out of range`);
    }
  });

  it('int(lo, hi) is inclusive on both ends', () => {
    const rng = makeRng('seed-y');
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(rng.int(1, 3));
    assert.ok(seen.has(1) && seen.has(2) && seen.has(3));
    for (const v of seen) assert.ok(v >= 1 && v <= 3);
  });

  it('pick returns an element of the array', () => {
    const rng = makeRng('seed-z');
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 50; i++) {
      assert.ok(arr.includes(rng.pick(arr)));
    }
  });
});

describe('planner-heuristic — layout intent', () => {
  it('middle column tends toward downtown', () => {
    const plan = planCityZones({ seed: 's', gridW: 5, gridH: 5 });
    const mid = Math.floor(plan.gridW / 2);
    const midCells = plan.zones.filter(z => z.rect.x === mid);
    const downtownInMid = midCells.filter(z => z.zone === 'downtown' || z.zone === 'park').length;
    // Most of the middle column should be downtown (parks may occasionally land here).
    assert.ok(downtownInMid >= midCells.length - 1, 'middle column not downtown-leaning');
  });
});
