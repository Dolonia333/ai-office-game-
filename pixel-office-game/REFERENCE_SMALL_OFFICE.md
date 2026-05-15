## Small Office Reference – Asset Checklist

This document tracks one **small private office** layout we will recreate
using LimeZu Modern Office / Modern Interiors assets.

### Visual elements (by semantic type)

- **Floor**
  - Type: `floor`
  - Semantic: `office_floor_light` (same palette family as open-plan)
- **Walls**
  - Type: `wall`
  - Semantic: `office_wall_plain`
- **Desk**
  - Type: `surface_cluster` (2×1 desk cluster)
  - Catalog: `desk_cluster_2x2` (from `data/interiors.json`)
- **Chair**
  - Type: `seat`
  - Catalog: `office_chair` (from `data/interiors.json`)
- **PC / Monitor**
  - Type: `decor`, interactive
  - Catalog: `pc_monitor` (from `data/interiors.json`)
- **Bookshelf**
  - Type: `furniture`
  - Catalog: `bookshelf` (from `data/interiors.json`)
- **Printer**
  - Type: `furniture`
  - Catalog: `printer` (from `data/interiors.json`)
- **Plant**
  - Type: `decor`
  - Catalog: `plant_pot` (from `data/interiors.json`)

### Mapping to sheets and recipe (summary)

Using `data/interiors.json`:

- `desk_cluster_2x2`
  - Sheet: `mi_office_generic` → `xp_generic_sheet`
  - Rect: `{ x: 0, y: 0, w: 64, h: 64 }`
- `office_chair`
  - Sheet: `mi_office_generic` → `xp_generic_sheet`
  - Rect: `{ x: 128, y: 256, w: 32, h: 32 }`
- `pc_monitor`
  - Sheet: `mi_office_generic` → `xp_generic_sheet`
  - Rect: `{ x: 128, y: 896, w: 32, h: 32 }`
- `plant_pot`
  - Sheet: `mi_office_living` → `xp_livingroom_sheet`
  - Rect: `{ x: 0, y: 256, w: 32, h: 64 }`
- `bookshelf`
  - Sheet: `mi_office_living` → `xp_livingroom_sheet`
  - Rect: `{ x: 96, y: 576, w: 96, h: 96 }`
- `printer`
  - Sheet: `mi_office_generic` → `xp_generic_sheet`
  - Rect: `{ x: 224, y: 576, w: 64, h: 64 }`

### Mapping into scene recipe

In `data/scene_recipes_modern_office_small_office.json`:

- `desk_cluster_2x2` is placed at **room tile** `{ x: 10, y: 7 }` inside `layout.deskArea.desk`.
- `office_chair` is attached via `layout.deskArea.chair` with `anchor: "chair_1"`.
- `pc_monitor` is attached via `layout.deskArea.pc` with `anchor: "pc_1"`.
- `bookshelf` appears in `layout.sideFurniture` at `{ x: 15, y: 4 }`.
- `printer` appears in `layout.sideFurniture` at `{ x: 5, y: 9 }`.
- `plant_pot` appears in `layout.decor` at `{ x: 4, y: 5 }`.

The generator (`src/world/generator.js`) uses this recipe when you pass
`?seed=small1&layout=small_office`, and the furnisher
(`src/world/roomFurnisherRuntime.js`) converts these tile positions into
world-space coordinates for Phaser to render.


