# Denizen — Room Generator

> Procedural single-room layouts (a bullpen, a meeting room, a
> breakroom) built from the furniture catalog. Older than `src/world/`
> and `src/city/` — this is the system the existing office actually
> uses, while the world/city generators are the in-progress next layer.

Source: [`src/RoomGenerator.js`](../src/RoomGenerator.js).
Companion renderer: [`src/RoomAssembly.js`](../src/RoomAssembly.js)
(class that turns generator output into Phaser sprites — see
[CITY_GENERATOR.md](CITY_GENERATOR.md) for the assembly path).

## What it does

Given a `spec` like `{ purpose, occupants }`, the generator:

1. Picks a sensible room size based on purpose + occupants.
2. Picks a deterministic furniture layout for that purpose.
3. Returns an `items[]` array — `{ sprite_id, x, y, modular_group, … }`
   per object — that `RoomAssembly` then renders.

```js
import { RoomGenerator } from './src/RoomGenerator.js';

const gen = new RoomGenerator(catalogData);    // catalogData = data/furniture_catalog_openplan.json
const template = gen.generate({
  purpose: 'workspace',
  occupants: 6,
  width: 480,           // optional override; otherwise auto-sized
  height: 320,
});
// → { description: 'Generated workspace room (480x320, 6 occupants)',
//     items: [{ sprite_id, x, y, … }, … ] }
```

## Six built-in archetypes

| Purpose | What it places | Notes |
|---|---|---|
| `workspace` | Workstation rows (desk + chair + monitor + decor), partitions between groups | The bullpen. `occupants` controls desk count. |
| `conference` | Long table, chairs around it, optional whiteboard | `occupants` is rounded up to ≥4. |
| `breakroom` | Couches, coffee machine, vending, tables | Fixed layout — no `occupants` knob. |
| `manager_office` | Single big desk, chair, bookshelves, decor | Single-occupant. |
| `reception` | Reception desk, waiting area chairs, plants | The lobby look. |
| `storage` | Shelves + boxes lining the walls | The IT room. |

Anything not on this list falls back to `workspace` with a warning logged.

The actual placement logic lives in `placeWorkstations`,
`placeConferenceLayout`, `placeBreakroomLayout`, etc. — one function per
archetype, all in the same file. They all take the same signature
`(items, palette, grid, …)` so adding a new archetype is one new
function plus one `case` in `RoomGenerator.generate()`.

## How placement avoids overlaps

`OccupancyGrid` (line 75) is a 2D array of booleans at 16-px resolution.
Every placement function:

1. Asks the grid `canFit(x, y, w, h)` before placing.
2. After placing, calls `mark(x, y, w, h)` so subsequent placements
   skip the cells.

Decor (`addDecorPass`, line 614) runs last and only fills empty cells
along walls — so plants and wall art never block walking paths.

## Palette: how it picks specific sprites

`buildPalette(catalogObjects)` (line 25) groups every catalog entry by
type into named pools:

- `palette.desks` — every `type:'desk'`
- `palette.chairs` — every `type:'chair'`
- `palette.frontChairs` — chairs that face up (used at desks)
- `palette.deskSetups` — pre-composed monitor/keyboard arrangements
- `palette.decor` — plants, art, small props
- …and several more

Each placement function picks from the relevant pool, sometimes with
size constraints (`palette.desks.filter(d => d.w <= 128)`). This is
what lets the same generator produce a "small office" or a
"reference office" depending on the catalog passed in.

## Auto-sizing

If you don't pass `width`/`height` in the spec, `_autoSize()` picks a
size based on purpose + occupants:

```
workspace:       384 + (occupants × 64) wide × 256–384 tall
conference:      384 × 320 (fixed for ≤6, scales for larger)
breakroom:       384 × 288
manager_office:  256 × 192
reception:       384 × 320
storage:         320 × 256
```

These are tunable — they're just numbers in `_autoSize()`. If a
generated room looks cramped, bump the multiplier.

## Direct registration with RoomAssembly

```js
const template = gen.generateAndRegister(assembly, spec, 'my_room');
// internally: gen.generate(spec) + assembly.registerTemplate(name, template)
```

After this, `assembly.renderRoomByName('my_room', { x, y })` paints the
room into a Phaser scene.

## Determinism

The placement logic uses a private `_idCounter` for sprite ids, but the
choice of *which* sprite from each pool is currently random
(`Math.random` via `pick()` at line ~12). To make rooms deterministic
across runs, replace `pick(arr)` with a seeded RNG (see
[`src/world/rng.js`](../src/world/rng.js)) — the rest of the file is
already deterministic given the input catalog.

This is one of the gaps between RoomGenerator and the newer
`src/world/` engine: the latter is fully seeded, this one is not.

## Tests

[`tests/room-generator.test.mjs`](../tests/room-generator.test.mjs)
covers construction, palette grouping, every archetype, auto-sizing,
and item-id uniqueness.

## When to use this vs `src/world/` vs `src/city/`

| Use this when… | Use world/city when… |
|---|---|
| You want a single hand-tuned room. | You want a whole multi-room building. |
| The existing office layout is what you're working in. | You're prototyping a new building from a seed. |
| You need pixel-perfect placement of existing catalog items. | You need deterministic layouts for replay. |

The three systems coexist. `RoomGenerator` is what `office-scene.js`
actually uses today; the world/city generators are wired but not yet
the production code path.

## Cross-references

- [SCENE.md](SCENE.md) — where the generated rooms get rendered
- [CITY_GENERATOR.md](CITY_GENERATOR.md) — multi-room generator that
  composes interior generators of its own
- [WORLD_ENGINE.md](WORLD_ENGINE.md) — the seeded RNG + recipe layer
- [SCRIPTS.md](SCRIPTS.md) — the asset pipeline that produces the
  catalogs RoomGenerator consumes
