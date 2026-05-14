'use strict';
/**
 * CommonJS heuristic city planner.
 *
 * Why this file exists separately from `planner.js`: the rest of
 * `src/city/` is ES modules (`import` / `export`), but `server.js` is
 * CommonJS. When `/api/llm-city-plan` falls back (no LLM configured, or
 * the LLM returns garbage), the server needs a synchronous heuristic
 * without paying the cost of a dynamic ESM import on every request.
 *
 * The algorithm matches what `planner.js` does in the ESM world: same
 * zone vocabulary, same shape, same seeded RNG (xfnv1a hash + mulberry32
 * — inlined here so this file has zero dependencies). Same seed string
 * produces the same plan from either entry point.
 */

function hashStringToUint32(str) {
  // xfnv1a — same algorithm as src/world/rng.js
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return (h >>> 0);
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seedString) {
  const seed = hashStringToUint32(String(seedString));
  const float = mulberry32(seed);
  return {
    seedString: String(seedString),
    seed,
    float,
    int: (lo, hi) => Math.floor(float() * (hi - lo + 1)) + lo,
    pick: (arr) => arr[Math.floor(float() * arr.length)],
    chance: (p) => float() < p,
  };
}

/**
 * Pure heuristic. No I/O. No LLM. Deterministic on (seed, prompt).
 *
 * @param {Object} opts
 * @param {string} [opts.prompt]
 * @param {string} [opts.seed]
 * @param {number} [opts.gridW]
 * @param {number} [opts.gridH]
 * @returns {{ seed: string, gridW: number, gridH: number, zones: Array }}
 */
function planCityZones({ prompt = '', seed = 'city-plan', gridW = 5, gridH = 3 } = {}) {
  const rng = makeRng(`${seed}:${prompt}`);
  const zones = [];
  const midCol = Math.floor(gridW / 2);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let zone = 'residential';
      if (gx === midCol) {
        zone = 'downtown';
      } else if (gx === 0 || gx === gridW - 1) {
        zone = rng.chance(0.5) ? 'industrial' : 'residential';
      }
      if (rng.chance(0.12)) zone = 'park';

      zones.push({
        zone,
        rect: { x: gx, y: gy, w: 1, h: 1 },
      });
    }
  }

  return {
    seed: rng.seedString,
    gridW,
    gridH,
    zones,
  };
}

module.exports = { planCityZones, makeRng };
