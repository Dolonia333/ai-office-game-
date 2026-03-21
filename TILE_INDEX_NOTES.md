# Tile index notes – what was wrong and how to fix it

This doc explains **why** some objects (rugs, tables, computers) weren’t building correctly and how the catalog/sprite indices relate.

---

## Horizontal banding / corrupted stripes

If a texture appears as **thin horizontal color bands** (smeared, no clear tiles), the game is sampling the PNG with the **wrong tile size**.

- **Cause:** `tilesheets-config.json` has `tileWidth`/`tileHeight` that don’t match the **actual** tile size in the PNG. Example: the file uses **48×48** tiles (RPG Maker MV default) but config says 32×32, so we read 32×32 from a 48×48 grid and get misaligned slices. (LimeZu’s MV pack may use **32×32** – if floor/walls look like muddled brick or black outlines, keep those sheets at 32×32; if you see horizontal banding, try 48×48 for that sheet.)
- **Fix:**
  1. Open the **PNG** that’s wrong (floor_tiles, wall_tiles, furniture_tiles, or living_room_tiles – see `office-scene.js` preload paths).
  2. Measure: image width ÷ number of tiles per row = tile width; image height ÷ number of rows = tile height. Many MV sheets are **48×48** (e.g. 768÷16 = 48).
  3. In `tilesheets-config.json`, set that sheet’s `tileWidth` and `tileHeight` to the real values (e.g. `48`).
  4. Re-run: `python pixel-office-game/build_tiles_catalog.py` from the multbot root.
  5. Reload the game. The scene now uses each catalog entry’s `tileWidth`/`tileHeight` when sampling, so 48×48 tiles are read correctly and scaled to 32×32 on screen.

If you added **0_Everything.png** (XP) or another sheet, add it to `tilesheets-config.json` with the **correct** tile size and `tilesPerRow` for that image, then regenerate the catalog.

---

## 1. What was wrong vs correct

### Movement
- **Before:** Character could freeze (wrong texture/frames for up/down), idle looked like “running in place” (walk animation when still).
- **Now:** Player uses full 32×48 XP sheet, single-frame idle per direction, walk frameRate 10. No code change needed for “correctness”; movement is already built the right way.

### Rugs
- **Problem:** We drew **one** 32×32 tile from the rugs category. In these packs, rugs are often **2×2** (four tiles form one rug). So you only saw one quarter.
- **Fix:** Build a **2×2 rug** from four catalog tiles (indices 128, 129, 144, 145 on `vxace_living_room_rugs`) and use a 64×64 texture. Done in `office-scene.js` with `rug_2x2`.

### Tables / desks
- **Problem:** We used the **shelves** category from the Living Room sheet for “desks,” so you got shelf graphics, not desks. Real desks (and computers) live in **Tileset_100_MV** (`furniture_generic`), and we **weren’t loading that sheet** at all.
- **Fix:** Load `furniture_tiles` (Tileset_100_MV), pick tiles from catalog category `furniture_generic`, and place them. We use **placeholder indices** (10 for desk, 20 for computer) until we map the sheet.

### Computers
- **Problem:** There is **no “computer” category** in the catalog. Computers are just some of the tiles inside `furniture_generic` (Tileset_100_MV). We never loaded the furniture sheet, so no computer could appear.
- **Fix:** Same as desks – use `furniture_generic` and a chosen tile index. In code we use index **20** as a placeholder; you should confirm the real index from the image and update `office-scene.js` (or add a `desk` / `computer` sub-range in `tilesheets-config.json` later).

---

## 2. Is it a “catalog problem” or “we don’t know where they are”?

Both.

- **Catalog:** The catalog **does** list every tile in Tileset_100_MV under `furniture_generic` (indices 0–127). So the catalog is fine for “where” in terms of (sheet, index, x, y).
- **Meaning of indices:** The catalog does **not** say “this index = desk, this index = computer.” That comes from the **art pack layout**. So we don’t yet know *which* index is a desk or computer – that’s a **mapping** problem.
- **Missing load:** We also weren’t loading the furniture sheet in the scene, so even with the right index we couldn’t draw it. That’s fixed by loading `furniture_tiles` and creating `desk_furniture` / `computer_furniture` from catalog entries.

So: **catalog** = correct positions; **game** = now loads furniture and uses placeholder indices; **you** = can open `Tileset_100_MV.png`, find the desk and computer tiles, note their grid index (row-major, 16 per row), then update the code or config.

---

## 3. How to fix wrong desk/computer sprite

1. Open the image:  
   `pixel game stuff/pixel game assets and stuff/Modern_Interiors_RPG_Maker_Version/.../RPG_MAKER_MV/Tileset_100_MV.png`
2. Grid: **16 tiles per row**, **32×32** per tile. Index `i` = column `i % 16`, row `i / 16`.
3. Find the desk and computer tiles; note their index (e.g. desk = 12, computer = 22).
4. In `office-scene.js`, change:
   - `deskFurnitureEntry = furnitureTiles.find((t) => t.tileIndex === 10)` → use your desk index.
   - `computerFurnitureEntry = furnitureTiles.find((t) => t.tileIndex === 20)` → use your computer index.

Optional later: in `tilesheets-config.json`, split `furniture_generic` into ranges with names like `furniture_desks`, `furniture_computers`, and use those categories in the scene instead of hard-coded indices.

---

## 4. Multi-tile objects (rugs, big tables)

- **Rugs:** First rug in Living Room is 2×2; we build `rug_2x2` from indices 128, 129, 144, 145. Other rugs in the sheet may be different 2×2 or 1×2; same idea: use several catalog entries and draw into one bigger texture.
- **Big tables:** If a “table” in the pack is 2×1 or 2×2, we’d do the same: multiple catalog tiles, one combined texture, place at the right position/depth.

So “not being built correctly” was either (1) drawing one tile of a multi-tile object, or (2) not loading the sheet / not knowing the right index. Both are addressed; only the exact index mapping for desk/computer is left for you to confirm from the image.
