# How These Objects Are Built

This document explains the **technical structure** of tiles and sprites in your asset packs so we slice and use them correctly. It covers engine conventions and how LimeZu’s packs map to them.

---

## 1. Tile size by engine

| Engine        | Official tile size | Our LimeZu packs (in use) |
|---------------|--------------------|----------------------------|
| **RPG Maker MV**  | 48×48              | 32×32 (Floors A2, Walls A4, Tileset_100_MV) |
| **RPG Maker VX Ace** | 32×32           | 32×32 (A5, B–C–D–E sheets) |
| **RPG Maker XP**   | 32×32 (map tiles) | 32×32 (1_Generic, 2_LivingRoom, etc.) |

So in **our catalog**, every tileset is treated as a **32×32 grid** unless noted (e.g. character sheets).

---

## 2. RPG Maker MV – how tilesets are built

### 2.1 Set A (lower layer: floors, walls)

- **One tile = 48×48** in the official editor. Autotiles are built from **24×24 “mini-tiles”**: the editor takes 4 corners (top-left, top-right, bottom-left, bottom-right) from the autotile pattern and assembles them into one 48×48 tile based on neighbors.
- **A1**: Animated water/lava etc. (768×576, special blocks).
- **A2**: Floors/terrain. 768×576. Each “autotile” is a **pattern of 6 tiles** (or 4 in Area type). The editor uses the **24×24** quarters inside these to draw borders automatically.
- **A3**: Building look (768×384), 8×4 tiles.
- **A4**: **Walls**. 768×720. “8 tiles horizontally and 3 vertically” using autotile basic + group pattern. Walls get shadows when placed next to certain other parts.
- **A5**: Normal (non-autotile) tiles, 384×768, **8×16** arrangement.

So in **vanilla MV**, A2 and A4 are **autotiles**: you don’t use them as a simple 48×48 grid; the editor **composes** each displayed tile from 24×24 pieces. When we use **LimeZu’s** `Floors_TILESET_A2_.png` and `Walls_TILESET_A4_.png` as **32×32 grids**, we’re treating them as **simple tilesets** (each 32×32 cell = one tile). That matches how we’ve set up `tilesheets-config.json` and gives correct indexing for our game.

### 2.2 Sets B, C, D, E (upper layer: objects)

- **Size:** 768×768 in the editor = **16×16 tiles** of **48×48** each.
- **Rule:** Top-left tile of Set B is “empty” (nothing drawn).
- No autotile logic: each cell is one tile. Used for furniture, props, decorations.

LimeZu’s **MV** interior files (e.g. in `Theme_Sorter_MV`) and **Tileset_100_MV.png** we use are **32×32** per tile, so our grid (e.g. 8 or 16 tiles per row) is chosen to match the image width.

---

## 3. RPG Maker VX Ace – how tilesets are built

- **Tile size:** **32×32** for everything.
- **A1–A4:** Autotiles (terrain, similar idea to MV but 32×32).
- **A5:** “Regular” static tiles, same priority as A, but not a full autotile sheet. Often used for extra walls/floors.
- **B, C, D, E:** Regular 32×32 tiles (objects, furniture). No autotile; simple grid.

So every **VX Ace** sheet we use (A5_Walls_Floors, B-C-D-E_Generic_01, B-C-D-E_Living_Room_01, etc.) is a **32×32 grid**. Row/column count depends on the image (e.g. 8 or 16 per row in our config).

---

## 4. RPG Maker XP – how tilesets and characters are built

### 4.1 Map tiles (e.g. 1_Generic, 2_LivingRoom)

- **32×32** per tile. Laid out in a grid (we use 8 columns in config). No autotile in the same sense as MV; they’re used as fixed tiles.

### 4.2 Character sprites (e.g. Adam.png)

- **Per-frame size:** **32×48** pixels (width × height).
- **Layout:** **4 columns × 4 rows** = 16 frames total.
  - **Row 0:** Facing **down** (frames 0–3).
  - **Row 1:** Facing **left** (frames 4–7).
  - **Row 2:** Facing **right** (frames 8–11).
  - **Row 3:** Facing **up** (frames 12–15).
- **Animation:** Each row = 4 frames of a walk cycle (stand, step, stand, step).
- **Full sheet:** 4×32 = 128 px wide, 4×48 = 192 px tall → **128×192**.

So when we use the **XP** character sheet in the game, we load it with `frameWidth: 32`, `frameHeight: 48` and use frame indices 0–3 (down), 4–7 (left), 8–11 (right), 12–15 (up). The extracted strips (e.g. Adam_walk_down_16x32.png) are **cropped/resized** versions of this for use at 16×32 in other contexts.

---

## 5. Indexing: how we go from “sheet” to “tile”

- **Row-major order:** Tile index `i` = column + row × tilesPerRow.  
  Column = `i % tilesPerRow`, row = `i / tilesPerRow` (integer division).
- **Pixel position** of tile `i`:  
  `x = (i % tilesPerRow) * tileWidth`,  
  `y = (i / tilesPerRow) * tileHeight`.
- **tilesheets-config.json** defines per-sheet: `tileWidth`, `tileHeight`, `tilesPerRow`, and for each category a range `fromIndex`–`toIndex`.  
  **build_tiles_catalog.py** then generates one catalog entry per index with these coordinates and the category/tags.

So “how the object is built” for our purposes = **one 32×32 (or 32×48) rectangle per index**, with no autotile assembly. Autotile behavior would require extra logic in the map editor or game; we’re only cataloguing and placing **single-cell** tiles.

---

## 6. Special file names (RPG Maker)

- **! at start** (e.g. `!$Bathtub.png`): Event/object sprite; **no 6px upward shift**, not made semi-transparent by bush. Used for doors, chests, animated objects.
- **$ at start**: Single character per file (one sprite per file).
- **Characters (img/characters)** in MV: Default **48×48** per cell, 4 directions × 3 patterns = 12 patterns, arranged in a fixed order; size is derived from 1/12 of width and 1/8 of height. LimeZu’s **free** character strips (e.g. Adam_idle_anim_16x16.png) are **16×32** horizontal strips (4 frames) for use outside the default MV character grid.

---

## 7. Summary table – “how it’s built”

| Asset type        | Engine | Cell size   | Layout / structure |
|-------------------|--------|------------|--------------------|
| Floors A2         | MV     | 32×32 (our) | Grid; official MV uses 48×48 autotile (24×24 quarters). |
| Walls A4          | MV     | 32×32 (our) | Grid; official MV uses 48×48 autotile. |
| Interiors B–E (MV) | MV    | 32×32      | Simple grid (Theme_Sorter_MV, Tileset_100_MV). |
| A5 / B–E (VX Ace) | VX Ace | 32×32      | Simple grid (A5_Walls_Floors, B-C-D-E_*). |
| XP map tiles      | XP     | 32×32      | Simple grid (1_Generic, 2_LivingRoom, …). |
| XP character      | XP     | 32×48      | 4×4: rows = down/left/right/up, cols = 4 walk frames. |
| Free character strips | —   | 16×32      | Horizontal strip, 4 frames (idle/run). |

This is the **technical** basis for the catalog: every object we list is either a **32×32 tile** (or 32×48 for XP characters), with a known grid and index so we can slice and place it correctly.
