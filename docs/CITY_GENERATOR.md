# Denizen — City Generator

> Status: **wired end-to-end to two HTTP endpoints + a debug overlay.**
> The main office scene still uses the hand-laid layout — replacing that
> is a deliberate later step (see "Hooking the city generator into the
> running game" below) — but you can drive the full pipeline today
> through `/api/generate-city`, watch it via `?debug=city`, and the LLM
> hook in `planner.js` is connected to NpcBrainManager's existing
> provider clients (Claude / Grok / Gemini / Kimi / LM Studio).

The city generator turns a seed (and optionally a text prompt) into a
deterministic city layout — orthogonal road grid, named building lots,
optional interior layouts — and then rendered onto a Phaser scene through
a thin adapter. Every step is pure and side-effect-free until the very
last Phaser call, so the same seed always produces the same city.

## Files at a glance

```
src/city/
├── cityTypes.js                 — data shapes + makeEmptyLayer()
├── cityGenerator.js             — generateCityChunk(): roads + lots
├── interiorGenerator.js         — generateOfficeInterior(): a single bullpen layout
├── planner.js                   — planCityZones(): coarse zoning, LLM-pluggable
├── RoomAssembly.js              — class that renders room templates to a scene
├── RoomAssemblyIntegration.js   — Phaser preload + lifecycle glue for RoomAssembly
├── RoomBuilder.js               — alternative renderer (validates modular groups)
└── phaserAdapter.js             — pure data → Phaser sprites translation
```

All eight files are **ES modules** (`import` / `export`). The rest of the
codebase is CommonJS — keep that in mind if you wire these into
`server.js` directly, you'll need `import()` (dynamic import) or a small
ESM ↔ CJS shim.

## The pipeline

```
                              ┌───────────────────────────┐
                              │   planner.js              │
                              │   planCityZones()         │  ◄── seed (+ optional prompt)
                              │                           │
                              │   "downtown center,       │
                              │    residential edges,     │
                              │    parks scattered"       │
                              └──────────────┬────────────┘
                                             │ zones[]: {zone, rect}
                                             ▼
                              ┌───────────────────────────┐
                              │   cityGenerator.js        │
                              │   generateCityChunk()     │  ◄── chunkX, chunkY, w, h, roadStride
                              │                           │
                              │   roads on grid +         │
                              │   buildings/parks in lots │
                              └──────────────┬────────────┘
                                             │ CityChunk {layers, buildings}
                                             ▼
                              ┌───────────────────────────┐
                              │   interiorGenerator.js    │  (optional, per building)
                              │   generateOfficeInterior()│
                              │                           │
                              │   desks, chairs,          │
                              │   monitors, plants        │
                              └──────────────┬────────────┘
                                             │ Interior {layers, prefabs}
                                             ▼
                              ┌───────────────────────────┐
                              │   phaserAdapter.js        │
                              │   renderCityChunkPhaser() │  ◄── scene, tilesetKeys
                              │   renderInteriorPhaser()  │
                              │                           │
                              │   pure data → sprites     │
                              └───────────────────────────┘
```

Three things to internalize:

1. **The planner is the only LLM-pluggable step.** The other modules are
   fully deterministic and run in microseconds.
2. **Chunks are independent.** `generateCityChunk({chunkX, chunkY, ...})`
   doesn't need its neighbors. You can stream chunks in as the camera
   moves and they'll line up at the seams because road positions are a
   pure function of (seed, chunkX, chunkY).
3. **The adapter is the only Phaser-coupled module.** Everything else
   could be rendered to Three.js, a server-side PNG, or a JSON dump for
   tests.

## planner.js — synchronous heuristic + async LLM

Two exports:

```js
import { planCityZones, planCityZonesLLM } from './src/city/planner.js';

// Synchronous. Always available. Deterministic on (seed, prompt).
const offline = planCityZones({ prompt: 'coastal tech city', seed: 'demo', gridW: 5, gridH: 3 });
// → { seed, gridW, gridH, zones: [...], source: 'heuristic' }

// Async. Hits the server's /api/llm-city-plan endpoint which routes
// the prompt through NpcBrainManager's existing provider clients.
// Falls back to the heuristic on ANY failure — endpoint unreachable,
// LLM unavailable, malformed JSON. The returned object tags `source`
// so callers can tell what they actually got.
const online = await planCityZonesLLM({
  prompt: 'coastal tech city with rich downtown and poor suburbs',
  seed:   'demo',
  gridW:  5,
  gridH:  3,
  provider: 'claude',   // optional: claude | grok | gemini | kimi | lmstudio
});
// → { ..., source: 'claude' }   if the LLM succeeded
// → { ..., source: 'heuristic (LLM unavailable: <reason>)' } on fallback
```

The synchronous version matches a CJS twin at `planner-heuristic.cjs` —
same algorithm, same seeded RNG. The server uses the `.cjs` version for
the heuristic fallback so it doesn't pay a dynamic-import cost per
request. If you change one, change both.

### How the LLM hook works

`/api/llm-city-plan` in `server.js`:

1. Picks a provider in this order:
   - Explicit `body.provider` (if set)
   - `CITY_PLAN_PROVIDER` env var
   - First available from `claude → grok → gemini → kimi → lmstudio`
2. Calls `npcBrains._callProvider(providerConfig, system, messages, opts)` —
   the same code path NPC chat uses, so all five providers work without
   reimplementing HTTP clients.
3. The system prompt forces a JSON-only response of shape `{ "zones": [...] }`.
4. Validates + clamps every zone rect into bounds before returning.
5. **On any failure**, calls the heuristic and returns that with `source`
   tagged so the client knows.

System prompt sent to the LLM:

```
You are a city planner. Given a free-form prompt and a grid size W x H,
return ONE JSON object and NOTHING ELSE.
Shape: { "zones": [ { "zone": "downtown"|"residential"|"industrial"|"park",
  "rect": { "x": int, "y": int, "w": int, "h": int } }, ... ] }.
Constraints: 0 <= x < W, 0 <= y < H, x+w <= W, y+h <= H,
no zones may overlap, every cell must be covered.
No prose. No markdown. Just the JSON object.
```

## cityGenerator.js — roads + lots

```js
import { generateCityChunk } from './src/city/cityGenerator.js';

const chunk = generateCityChunk({
  seed:       'demo-city',
  chunkX:     0,
  chunkY:     0,
  width:      48,        // tiles
  height:     48,
  roadStride: 8,         // road every N tiles
});
// → { id, x, y, layers: { ground, roads, buildings }, buildings: [{ id, kind, rect, tag }] }
```

- Roads land on a deterministic grid (stride configurable).
- Lots between roads get filled with `office`, `park`, or `apartment`
  buildings, picked from the exterior catalog.
- The output is plain data: each layer is a 2D array of `TileRef`s, each
  building is `{ id, kind, rect, tag }`.

Imports `makeEmptyLayer` from `cityTypes.js` and `makeRng` from
`../world/rng.js`. Reads `exteriors.json` (the exterior tile catalog).

## interiorGenerator.js — one building's inside

```js
import { generateOfficeInterior } from './src/city/interiorGenerator.js';

const interior = generateOfficeInterior({
  seed:       'demo-city:building-7',
  buildingId: 'building-7',
  width:      24,
  height:     16,
});
// → { buildingId, layers: { floor, walls }, prefabs: [{ id, x, y, kind }] }
```

Produces a single bullpen layout: rows of desks with attached chairs,
monitors, plants, wall plants. Tile-based (32px), suitable for stitching
into a Phaser scene through the adapter below.

To diversify interiors, swap or extend this file — the city generator
doesn't care which interior layout you pick as long as the prefab list it
returns matches the schema (`{id, x, y, kind, …}`).

## phaserAdapter.js — pure data → sprites

```js
import { renderCityChunkPhaser, renderInteriorPhaser } from './src/city/phaserAdapter.js';

renderCityChunkPhaser(scene, chunk, {
  ground:    'exterior_ground',
  roads:     'exterior_roads',
  buildings: 'exterior_buildings',
});

renderInteriorPhaser(scene, interior, prefabSprites);
```

Pure adapter — no game logic. The data layer doesn't know about Phaser;
the adapter doesn't know about generation. You can render the same
`chunk` to multiple scenes, or render none at all (for tests, take a
snapshot, diff JSON).

## RoomAssembly / RoomAssemblyIntegration / RoomBuilder

A second rendering path, distinct from the chunk/interior pipeline above.
Reads two JSON files:

- `sprite-assembly-system.json` — defines sprite groups (e.g. "desk1 +
  chair1 + monitor1 = workstation")
- `room-templates.json` — named room templates (`"open_office"`,
  `"meeting_room"`, …) composed of those groups

`RoomAssembly` validates the sprite registry against the template,
checks that every modular group is complete (no missing pieces),
sorts sprites by z-layer, and renders them with the right origins and
offsets.

`RoomAssemblyIntegration` is the Phaser glue: a `preload()` for the JSON
files, a factory for the assembly instance, and `renderRoomByName(name)`.

`RoomBuilder` is an alternative implementation of the same idea — earlier
draft, kept around for reference. `RoomBuilder.js:194` has a `TODO`
marker (`// TODO: Implement lookup in sprite-assembly-system.json`) — if
you adopt RoomBuilder over RoomAssembly, that's the gap.

## HTTP endpoints

Two GET/POST endpoints expose the full pipeline without touching the
Phaser scene. Useful for debugging, headless snapshots, and the n8n
integration story.

### `GET /api/generate-city`

Runs `planCityZones → generateCityChunk → generateOfficeInterior` for the
first building, returns the lot as plain JSON.

```
GET /api/generate-city?seed=demo&width=64&height=48&roadStride=12
```

| Param | Default | Range | Meaning |
|---|---|---|---|
| `seed` | `office-demo` | string | Determinism key |
| `prompt` | `` | string | Forwarded to the planner |
| `width` | 48 | 8..256 | Chunk width in tiles |
| `height` | 48 | 8..256 | Chunk height in tiles |
| `roadStride` | 8 | 2..32 | Tile spacing between roads |
| `chunkX`, `chunkY` | 0, 0 | int | Chunk coordinates |

Response shape:

```jsonc
{
  "plan": { "seed", "gridW", "gridH", "zones": [...], "source": "heuristic" },
  "chunk": { "width", "height", "layers": [...], "buildings": [...] },
  "sampleInterior": { "buildingId", "layers", "prefabs": [...] } | null
}
```

### `POST /api/llm-city-plan`

Returns just the planner output, with the LLM hook engaged (see above).

```
POST /api/llm-city-plan
Content-Type: application/json

{ "prompt": "tiny suburb with a single industrial block",
  "seed":   "neighborhood-7",
  "gridW":  4, "gridH": 3,
  "provider": "claude" }      // optional — pick a specific provider
```

## Debug overlay (browser)

`src/city-debug.js` is a small in-game HUD that fetches a fresh city from
`/api/generate-city` and renders it into a hidden canvas overlay. Two
ways to open it:

```
http://localhost:8080/?debug=city          # auto-shows on load
```

```js
// from the browser console at any time:
window.DenizenCityDebug.show();
window.DenizenCityDebug.refresh('any-seed-string');
```

The overlay shows the plan source (heuristic/claude/grok/…), zone
distribution, building count, and a top-down render of roads + buildings.
**It does not modify the running office.** It's a verification view for
the pipeline.

## Hooking the city generator into the running game

Today the office is hand-laid out in `office-scene.js` from
`office-layout.json` plus the procedural [room generator](../src/RoomGenerator.js)
(a separate, older system). To replace that with the city generator:

1. **Pick an entry point in `office-scene.js`** — early in `create()`,
   before furniture is placed.
2. **Generate**:
   ```js
   const { generateCityChunk }   = await import('./src/city/cityGenerator.js');
   const { renderCityChunkPhaser } = await import('./src/city/phaserAdapter.js');
   const chunk = generateCityChunk({ seed: 'office', chunkX: 0, chunkY: 0, width: 48, height: 48, roadStride: 8 });
   renderCityChunkPhaser(this, chunk, { ground: 'tiles_ground', roads: 'tiles_roads', buildings: 'tiles_buildings' });
   ```
   (Use dynamic `import()` because the rest of `office-scene.js` is
   loaded as a classic script.)
3. **Pick one building, generate its interior, render that:**
   ```js
   const building = chunk.buildings.find(b => b.kind === 'office');
   const { generateOfficeInterior } = await import('./src/city/interiorGenerator.js');
   const { renderInteriorPhaser }   = await import('./src/city/phaserAdapter.js');
   const interior = generateOfficeInterior({ seed: 'office', buildingId: building.id, width: 24, height: 16 });
   renderInteriorPhaser(this, interior, this._prefabSprites);
   ```
4. **NPCs use the world-state singleton already.** Their positions live
   in `worldState.npcs[name].position` (see
   [WORLD-STATE.md](WORLD-STATE.md)). When you generate a new layout,
   write the new desk positions into `worldState` and the next NPC
   `think()` cycle will see them via `## Current State (live)`.

The pieces are all here. The integration is a deliberate next step.

## See also

- [WORLD_ENGINE.md](WORLD_ENGINE.md) — `src/world/` (seeded RNG + recipes
  + furnisher), which `cityGenerator` and `planner` both depend on
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SCRIPTS.md](SCRIPTS.md) — sprite catalog tooling that feeds the
  exterior + interior tilesets
