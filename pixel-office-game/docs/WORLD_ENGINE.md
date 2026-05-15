# Denizen — World Engine

> Status: **partially wired.** The seeded RNG (`rng.js`) is used by every
> generator in the codebase. The world layout + furnisher pipeline runs
> end-to-end if you call it from a test harness, but the main game scene
> still uses the older hand-tuned layout. This doc explains what's there.

`src/world/` is the lower layer that `src/city/` builds on top of. It
owns three things:

1. A **deterministic seeded RNG** — every other generator gets its
   randomness from here so the same seed always produces the same output.
2. A **world layout generator** — non-overlapping room placement with
   L-shaped corridors connecting them. Engine-agnostic.
3. A **recipe-driven furnisher** — turns the empty rooms into furnished
   spaces (desks, decor, utilities) by looking up scene recipes.

## Files at a glance

```
src/world/
├── rng.js                       — seeded RNG (xfnv1a hash + mulberry32 PRNG)
├── recipes.js                   — built-in scene recipes (bullpen, reception, …)
├── generator.js                 — generateWorld(): rooms + corridors + zones
├── roomFurnisherRuntime.js      — furnishWorld(): apply a recipe to a room
├── roomFurnisher.js             — older draft of the furnisher, kept for reference
├── renderer.js                  — renderWorld(): basic floor/zone Phaser render
├── animRegistry.js              — character animations (4-dir walk/idle)
└── debug.js                     — drawWorldDebug(): outline overlay + stats HUD
```

All ES modules. The main game is CommonJS — if you wire any of these into
`server.js`, use dynamic `import()`.

## Pipeline

```
                      ┌─────────────────────────┐
        seed string ──▶│  rng.js                 │
                      │  makeRng(seedString)    │  ─►  { float, int, pick, chance }
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │  generator.js           │
                      │  generateWorld({...})   │  ─►  World {
                      │   - room placement      │         rooms[],
                      │   - L corridors         │         corridors[],
                      │   - zone tagging        │         zones[],
                      │   - spawn points        │         spawn,
                      └────────────┬────────────┘         …
                                   │                    }
                  (recipes mode)   │
                                   ▼
                      ┌─────────────────────────┐
                      │  recipes.js +           │
                      │  roomFurnisherRuntime   │  ─►  world.placements[]
                      │   - pickRecipeForRoom   │       {prefabId, x, y, kind, …}
                      │   - furnishWorld()      │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │  renderer.js            │
                      │  renderWorld(scene, …)  │  ─►  Phaser tileSprites
                      │   + animRegistry        │
                      │   + debug.js (optional) │
                      └─────────────────────────┘
```

## rng.js — deterministic everything

The cornerstone. Same seed → identical output every time.

```js
import { makeRng } from './src/world/rng.js';

const rng = makeRng('office-demo');
rng.float();              // 0..1
rng.int(1, 10);           // inclusive
rng.pick(['a', 'b', 'c']);
rng.chance(0.3);          // boolean, 30% true
rng.seed;                 // the uint32 used internally
rng.seedString;           // the original string
```

Internals are two named exports:

- `hashStringToUint32(str)` — xfnv1a hash, used to seed the PRNG from a
  string.
- `mulberry32(seed)` — fast PRNG factory; returns a `float()` function.

Pure utility, zero dependencies. Used by `cityGenerator`,
`interiorGenerator`, `planner`, `generator`, and the recipe picker — so
**every procedural decision in the codebase ultimately routes through
this one file.**

## generator.js — async generateWorld()

```js
import { generateWorld } from './src/world/generator.js';

const world = await generateWorld({
  seed: 'office-demo',
  prefabs: prefabIndex,        // optional: { byKind, byId } for the furnisher
  config: {
    roomCount:        6,
    corridorWidth:    4,        // tiles
    roomPadding:      2,        // tiles between rooms
    layoutMode:       'recipes', // 'generic' | 'recipes'
    defaultTheme:     'office',
    defaultRoomType:  'bullpen',
  },
});
// → { seed, rooms:[], corridors:[], zones:[], spawn, placements? }
```

What it does, in order:

1. **Place N rooms** using a greedy nearest-neighbor approach with
   non-overlap checks and padding. Rooms are axis-aligned rectangles.
2. **Build an MST** (minimum spanning tree) over the room centers to
   decide which rooms must connect.
3. **Carve L-shaped corridors** along the MST edges, `corridorWidth`
   tiles wide.
4. **Tag zones** — special zones (clinic, lobby, street) get tagged so
   the renderer can colour them differently.
5. **Pick spawn points** — one canonical spawn plus per-room anchors.
6. **(Optional) furnish** — if `layoutMode === 'recipes'`, calls
   `furnishWorld()` which adds a `placements[]` array of prefabs.

Engine-agnostic. The output is pure JSON. You can serialize it, diff it,
test it, or pass it to any renderer.

## recipes.js — built-in scene recipes

A hardcoded recipe index. Each recipe describes the **shape** of a room
type — where the desks go, where the wall decor lives, how the reception
desk is oriented:

```js
import { buildRecipeIndex, pickRecipeForRoom } from './src/world/recipes.js';

const index = buildRecipeIndex();
// → { byId: Map<recipeId, recipe>, byThemeType: Map<"office:bullpen", recipe> }

const recipe = pickRecipeForRoom(rng, index, 'office', 'bullpen');
```

Built-in recipes today: `bullpen`, `reception`, `small_office`,
`reference_office`, `target_office`. To add a new room layout, add an
entry to the inlined JSON inside `recipes.js`. (The data is inlined
rather than imported because browser ES modules can't `import` JSON
without import-assertions, which are still inconsistent across browsers.)

A recipe defines section shapes — `deskRows`, `wallDecor`, `utilities`,
`receptionDesk`, `deskArea`, `sideFurniture`, `decor`, `waitingArea` —
each with tile-relative coordinates and prefab kinds. The furnisher
converts those tile coords to world pixel coords at render time.

## roomFurnisherRuntime.js — apply a recipe

```js
import { furnishRoom, furnishWorld } from './src/world/roomFurnisherRuntime.js';

furnishWorld(world);                 // furnishes every room (uses room.recipeId)
// or:
furnishRoom(world, world.rooms[0]);  // furnishes just one
```

For each room, it reads the recipe and walks through every section
(`deskRows`, `wallDecor`, etc.), converting tile coordinates to world
pixel coordinates and pushing entries into `world.placements`:

```jsonc
{
  "prefabId": "desk_2x2",
  "x":        128,
  "y":        96,
  "kind":     "desk",
  "attachTo": null,
  "anchor":   "topleft"
}
```

Those placements are what `renderer.js` (or your own renderer) actually
draws.

`roomFurnisher.js` (without `Runtime` in the name) is an older draft
that tried to use JSON import assertions. It's kept for reference but
unused — `roomFurnisherRuntime.js` is what `generator.js` imports.

## renderer.js — basic Phaser render

```js
import { renderWorld } from './src/world/renderer.js';

renderWorld(scene, world, {
  base:    'floor_tile',
  corridor:'corridor_tile',
  clinic:  'clinic_floor',
  street:  'street_tile',
});
```

Lays down `tileSprite`s for each room, corridor, and zone at sensible
depths. No collision logic (yet). For furniture, the caller is expected
to read `world.placements` and instantiate prefab sprites separately —
this is intentional, because prefab handling is project-specific.

## animRegistry.js — character animations

```js
import { registerCharacterAnimations, getAnimKey } from './src/world/animRegistry.js';

registerCharacterAnimations(scene, 'xp_abby');
// Now Phaser knows: xp_abby:idle_down, xp_abby:walk_down, etc.

sprite.anims.play(getAnimKey('xp_abby', 'walk_down'));
```

Assumes a 4×4 XP-style sprite sheet (4 directions × 4 frames each). The
factory creates idle + walk anims for each direction. Hardcoded layout —
if your sheets are laid out differently, fork this file.

## debug.js — overlay

```js
import { drawWorldDebug } from './src/world/debug.js';

drawWorldDebug(scene, world); // draws room rects, corridor outlines, stats HUD
```

Pure visualization. Useful when you're iterating on a new generator and
want to see what it placed before you spend time on art.

## End-to-end example

```js
import { makeRng }        from './src/world/rng.js';
import { generateWorld }  from './src/world/generator.js';
import { renderWorld }    from './src/world/renderer.js';
import { drawWorldDebug } from './src/world/debug.js';
import { registerCharacterAnimations, getAnimKey } from './src/world/animRegistry.js';

// In your Phaser scene:
async create() {
  // 1. Build the world (deterministic for a given seed)
  const world = await generateWorld({
    seed:    'office-demo',
    prefabs: this.prefabIndex,
    config:  { roomCount: 6, corridorWidth: 4, layoutMode: 'recipes',
               defaultTheme: 'office', defaultRoomType: 'bullpen' },
  });

  // 2. Render floor + corridors
  renderWorld(this, world, { base: 'floor', corridor: 'corridor' });

  // 3. Instantiate prefabs from world.placements
  for (const p of (world.placements || [])) {
    const sprite = this.add.sprite(p.x, p.y, p.prefabId);
    sprite.setOrigin(0, 0);
  }

  // 4. Wire animations for one character + place them at the spawn
  registerCharacterAnimations(this, 'xp_abby');
  const abby = this.add.sprite(world.spawn.x, world.spawn.y, 'xp_abby');
  abby.anims.play(getAnimKey('xp_abby', 'idle_down'));

  // 5. (Dev only) overlay outlines so you can see what got placed
  if (this.physics.world.drawDebug) drawWorldDebug(this, world);
}
```

## See also

- [CITY_GENERATOR.md](CITY_GENERATOR.md) — `src/city/` builds on top of
  `src/world/rng.js` for its determinism
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [WORLD-STATE.md](WORLD-STATE.md) — once the world is rendered, NPC
  state for it lives in the WorldState singleton
