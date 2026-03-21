# Layout: what the catalog did and how to match a reference

## What the catalog work did for you

- **Correct slicing:** Each tile is read from the PNG using that sheet’s real tile size (e.g. 48×48 for MV). That fixes banding and wrong crops so **tiles look right** when placed.
- **Known positions:** The catalog gives sheet + index + (x, y) for every tile, so we can say “place this tile here” and the game can draw it correctly.
- **Multi-tile objects:** We build things like the 2×2 rug from several catalog entries so one “object” displays fully.
- **More sheets:** Furniture sheet (Tileset_100_MV), 0_Everything, etc. are in the catalog so we have more tiles to choose from.

So the catalog fixes **how** each tile is built and **where** it is in the file. It does **not** decide **which** tile goes in **which cell** of your map or how many rooms you have.

## Why things don’t lay out like the reference yet

The reference image is a **multi-room layout** (e.g. tatami, shoji, several tables). The current scene is a **single rectangular room** with a fixed set of tiles (floor, walls, plants, rug, desk, computer). So:

- We have the **system** to place tiles correctly (catalog + correct tile size).
- We don’t yet have **layout data** that describes the reference (which tile in each cell, room boundaries, etc.).

## How to get the scene to match the reference

1. **Find the right tiles:** In the catalog (or by opening the PNGs), identify which sheet and indices are tatami, shoji, Japanese tables, etc. (e.g. `xp_everything_all`, or other XP/MV sheets).
2. **Define a layout:** Create a layout format (e.g. `office-layout.json` or a 2D grid) that says, for each cell, which catalog tile to use (sheet id + tile index, or category + index).
3. **Build from layout:** In the scene (or a small map builder), loop over that layout and place the correct catalog tile at each position, using the same sampling logic we use now (entry `tileWidth`/`tileHeight`, etc.).

Once that’s in place, the catalog is what makes each tile **render** correctly; the layout data is what **arranges** them like the reference.

## NPC size (XP vs free)

The NPC now uses the **XP** Alex sheet (32×48), same format and scale as the player, so they match in size. Other XP characters (Bob, Lucy, etc.) are in `RPG_MAKER_XP/Characters/` and can be used the same way for more NPCs.
