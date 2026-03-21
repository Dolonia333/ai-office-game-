// Lightweight planning layer that turns a text prompt or simple options
// into a structured JSON \"city plan\" consumed by the deterministic generators.

import { makeRng } from '../world/rng.js';

/**
 * @typedef {Object} CityZoneRect
 * @property {string} zone - e.g. 'downtown' | 'residential' | 'industrial' | 'park'
 * @property {{ x: number, y: number, w: number, h: number }} rect
 */

/**
 * Generate a coarse city plan from a prompt string.
 *
 * This is where an external LLM could plug in: instead of using the simple
 * rule-based heuristic below, you can call an API and return its JSON.
 *
 * @param {Object} opts
 * @param {string} [opts.prompt]  - description, e.g. 'coastal tech city with rich downtown and poor suburbs'
 * @param {string} [opts.seed]
 * @param {number} [opts.gridW]   - how many chunks horizontally
 * @param {number} [opts.gridH]   - how many chunks vertically
 * @returns {{ seed: string, gridW: number, gridH: number, zones: CityZoneRect[] }}
 */
export function planCityZones({ prompt = '', seed = 'city-plan', gridW = 5, gridH = 3 } = {}) {
  const rng = makeRng(`${seed}:${prompt}`);

  const zones = [];

  // Simple heuristic: central column is downtown, edges are residential/industrial,
  // random parks sprinkled in.
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

/**
 * Example of how an external LLM could be integrated:
 *
 * async function planCityWithLLM(prompt) {
 *   const response = await fetch('/api/llm-city-plan', { method: 'POST', body: JSON.stringify({ prompt }) });
 *   const json = await response.json();
 *   // Expected shape: { zones: [{ zone, rect: {x,y,w,h} }, ...] }
 *   return json;
 * }
 */

