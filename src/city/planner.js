// Lightweight planning layer that turns a text prompt or simple options
// into a structured JSON "city plan" consumed by the deterministic
// generators.
//
// Two entry points:
//   planCityZones()       — synchronous, pure heuristic. Always available.
//   planCityZonesLLM()    — async, prefers the server's /api/llm-city-plan
//                          endpoint (which proxies to a real provider via
//                          NpcBrainManager) and falls back to the heuristic
//                          on failure.
//
// Use `planCityZones` for tests and offline determinism. Use
// `planCityZonesLLM` from the browser when you want an actual LLM to do
// the zoning.

import { makeRng } from '../world/rng.js';

/**
 * @typedef {Object} CityZoneRect
 * @property {string} zone - 'downtown' | 'residential' | 'industrial' | 'park'
 * @property {{ x: number, y: number, w: number, h: number }} rect
 */

/**
 * @typedef {Object} CityPlan
 * @property {string} seed
 * @property {number} gridW
 * @property {number} gridH
 * @property {CityZoneRect[]} zones
 * @property {string} [source]  - 'heuristic' | 'claude' | 'grok' | …
 */

/**
 * Synchronous heuristic. Same algorithm as the CJS twin at
 * `planner-heuristic.js` — given the same seed string, both produce
 * byte-identical plans. Keep them in sync if you change the heuristic.
 *
 * @param {Object} opts
 * @param {string} [opts.prompt]
 * @param {string} [opts.seed]
 * @param {number} [opts.gridW]
 * @param {number} [opts.gridH]
 * @returns {CityPlan}
 */
export function planCityZones({ prompt = '', seed = 'city-plan', gridW = 5, gridH = 3 } = {}) {
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
    source: 'heuristic',
  };
}

/**
 * LLM-aware planner. Hits the server endpoint that knows how to talk to
 * Anthropic / xAI / Google / LM Studio. On any failure — endpoint
 * unreachable, malformed JSON, validation reject — we silently fall
 * back to the heuristic so nothing higher in the pipeline ever crashes.
 *
 * The endpoint URL is overridable for tests via `endpoint:` opt.
 *
 * @param {Object} opts
 * @param {string} [opts.prompt]
 * @param {string} [opts.seed]
 * @param {number} [opts.gridW]
 * @param {number} [opts.gridH]
 * @param {string} [opts.provider]   - 'claude' | 'grok' | 'gemini' | 'kimi' | 'lmstudio'
 * @param {string} [opts.endpoint]   - default '/api/llm-city-plan'
 * @returns {Promise<CityPlan>}
 */
export async function planCityZonesLLM(opts = {}) {
  const endpoint = opts.endpoint || '/api/llm-city-plan';
  try {
    if (typeof fetch !== 'function') throw new Error('no fetch in this runtime');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: opts.prompt || '',
        seed: opts.seed || 'city-plan',
        gridW: opts.gridW || 5,
        gridH: opts.gridH || 3,
        provider: opts.provider,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.zones) || json.zones.length === 0) {
      throw new Error('endpoint returned no zones');
    }
    return json;
  } catch (err) {
    // Tag the source so callers can see why they got heuristic output.
    const fallback = planCityZones(opts);
    fallback.source = `heuristic (LLM unavailable: ${err.message || err})`;
    return fallback;
  }
}
