## Catalog Conventions

This document summarizes the shared schema used by the semantic catalogs:

- `data/interiors.json`
- `data/exteriors.json`
- `data/furniture_catalog*.json`
- `data/scene_recipes_*.json`

The goal is that generators and renderers can reason about **what** something is
without hard-coding pixel coordinates or sheet layouts.

### Common semantic fields

- **type**: high‑level role for gameplay / placement
  - `ground` – ground / floor tiles
  - `wall` – vertical wall segments or facades
  - `surface` – tables, desks, counters that hold decor
  - `surface_cluster` – multi‑desk clusters (e.g. 2x2 desk pods)
  - `furniture` – large furniture that can block movement
  - `seat` – chairs, benches, beds (things the player can sit/sleep on)
  - `decor` – non‑blocking decorative items (plants, lamps, monitors)
  - `object` – misc props that don’t fit the above but are interactive

- **theme**: loose grouping by pack / visual theme
  - Examples: `modern_office`, `modern_interiors`, `modern_exteriors`, `hospital`, `gym`.

- **style**: optional, for palette / variant control
  - Examples: `light`, `dark`, `wood`, `concrete`, `corporate`, `residential`.

- **action**: optional interaction hint for the player/NPC
  - `use_it` – generic “use” (computers, machines, switches)
  - `use_computer` – specific to PCs / laptops
  - `seat` – sit on this object
  - `sleep` – sleep / rest

- **anchors**: local anchor points used for attaching other prefabs or decor
  - In interiors: named points inside a prefab (e.g. `chair_1`, `pc_1`).
  - In furniture catalogs: implied by object size; decor uses `parentInstanceId`
    plus `parent_offset_y` for vertical offset.

- **interact_distance**: optional radius (in pixels) for interaction checks.

- **snap_offset**: optional `{ x, y }` offset applied when snapping the player
  into position (e.g. sitting on a seat, lying on a bed).

### Interiors catalog (`data/interiors.json`)

- `sheets` section:
  - `imageKey`: Phaser texture key for the sheet.
  - `tileSize`: base tile size in pixels (usually 32).
  - `theme` (optional): e.g. `modern_interiors`.

- `prefabs` entries:
  - Required: `sheet`, `rect { x,y,w,h }`, `origin`, `type`.
  - Optional: `theme`, `style`, `action`, `anchors`, `interact_distance`, `snapTo`, `offsetY`.

### Exteriors catalog (`data/exteriors.json`)

- `tilesets` entries:
  - Required: `imageKey`, `tileSize`.
  - Recommended: `type` (`ground`, `wall`, `object`) and `theme` (`modern_exteriors`).

- `categories` entries:
  - Group tile refs by semantic role (e.g. `road_straight`, `pavement`, `building_facade_office`).
  - Each entry may include `orientation` / `kind` hints but **always** includes `tileset` + `tileIndex`.

### Furniture catalogs (`data/furniture_catalog*.json`)

- `info`:
  - `slice_margin_px`: optional padding when slicing from sheet.
  - `origin`: convention for placement (`Place (x,y) = bottom-center of sprite`).

- `objects` entries:
  - Required: `sheet`, `x`, `y`, `w`, `h`, `origin`, `type`.
  - Recommended: `theme`, `style`, `action`, `depth`.
  - Optional: `parent_offset_y`, `interact_distance`, `snap_offset`.

- `placements`:
  - Furniture: `{ id, instanceId, x, y }`.
  - Decor attached to parents: add `parentInstanceId` and optional `parent_offset_y`.

### Scene recipes (`data/scene_recipes_*.json`)

- Top‑level:
  - `id`, `theme`, `roomType`, `tileSize`, `size { w, h }`.
  - `palette`: semantic floor/wall/carpet IDs (e.g. `office_floor_light`).

- `prefabs`:
  - Just references to semantic IDs from the catalogs (`id`, `from`, `kind`, optional `action`).

- `layout`:
  - Recipe‑specific structure (desk rows, reception counters, waiting areas, etc.)
    expressed in **tile coordinates** relative to the room.

- `spawnPoints`:
  - `player` tile position and optional `npcs` with roles.

