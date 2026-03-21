# All sprites – master list

Use this to go over every sprite the game and catalogs refer to. **I have not opened every sheet image** – where I only have paths/rects, I say "catalog only" so you know I haven’t verified it visually.

---

## 0. Sprite Labeler – fix wrong labels (desk vs bookshelf, water cooler, etc.)

**Problem:** The openplan catalog has wrong rects/labels (e.g. bookshelf is a couch, water cooler wrong, printer tiling). You need to see every sprite and set the correct Catalog ID.

1. **Extract** (already done): `out/sheet_extract/modern_office_black_shadow_32.objects.json` has 199 full-object rects from the Black Shadow 32 sheet.
2. **Open the labeler:** Serve the project so the sheet and JSON load, then open **`sprite-labeler.html`** in the browser.
   - From `multbot`: `npx serve .` then open `http://localhost:3000/pixel-office-game/sprite-labeler.html`
   - Or from `pixel-office-game`: `npx serve .` then open `http://localhost:3000/sprite-labeler.html`
3. **Identify:** Each card shows one sprite. Set **Catalog ID** (e.g. `desk_pod`, `chair_office`, `water_cooler`, `printer`, `bookshelf`, `monitor`) and **Type** (surface, seat, decor, furniture). Leave ID blank to skip.
4. **Save:** Click **Save catalog (download JSON)**. Replace `data/furniture_catalog_openplan.json` with the downloaded file (or merge `objects` and keep your `placements`).

### Tile Labeler – floors/walls patterns (A2/A4 tilesets)

If you’re stuck on floors/walls/patterns, use **`tile-labeler.html`** (grid-based, click-to-label tiles).

- Open: **`tile-labeler.html`**
- Default tile size for RPG Maker MV tilesets: **48**
- Exports: `modern_office_mv_a2_floors__48.labels.json` / `modern_office_mv_a4_walls__48.labels.json`

---

## 1. Modern Office – openplan catalog (what reference_office uses)

**Sheet in game:** `mo_black_shadow_32`  
**File:** `Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_32x32.png`  
**Catalog:** `data/furniture_catalog_openplan.json`

| ID | Sheet rect (x, y, w, h) | Type | Notes |
|----|-------------------------|------|------|
| desk_pod | 0, 0, 64, 64 | surface | L-shaped desk (catalog only) |
| chair_office | 128, 256, 32, 32 | seat | Office chair (catalog only) |
| monitor | 128, 896, 32, 32 | decor | PC monitor, parent_offset_y -26 (catalog only) |
| desk_lamp | 32, 512, 32, 32 | decor | Lamp on desk (catalog only) |
| paper_stack | 64, 512, 32, 32 | decor | Papers on desk (catalog only) |
| chair_office_tall | 0, 256, 32, 64 | seat | Office chair (was wrongly labeled plant_pot; user confirmed) |
| plant_pot | 32, 256, 32, 64 | furniture | Potted plant (moved from 0,256; confirm (32,256) is correct) |
| whiteboard_wall | 0, 576, 96, 64 | decor | Wall whiteboard (catalog only) |
| bookshelf | 96, 576, 96, 96 | furniture | Tall shelf (catalog only) |
| water_cooler | 192, 576, 32, 64 | furniture | Water dispenser (catalog only) |
| printer | 224, 576, 64, 64 | furniture | Printer/copier (catalog only) |

---

## 2. Interiors prefabs (XP sheets – used when not reference_office)

**Catalogs:** `data/interiors.json` → points at these Phaser keys:

| Phaser key | File (under pixel game stuff) | Prefabs that use it |
|------------|-------------------------------|----------------------|
| xp_generic_sheet | Modern_Interiors…/RPG_MAKER_XP/1_Generic.png | desk_cluster_2x2, office_chair, pc_monitor, printer |
| xp_livingroom_sheet | …/RPG_MAKER_XP/2_LivingRoom.png | plant_pot, bookshelf |
| xp_bedroom_sheet | …/RPG_MAKER_XP/4_Bedroom.png | (catalog entry, not used in current recipes) |

**Prefab rects (I have not seen these sprites):**

| Prefab ID | Sheet | rect (x,y,w,h) |
|-----------|--------|----------------|
| desk_cluster_2x2 | mi_office_generic | 0, 0, 64, 64 |
| office_chair | mi_office_generic | 128, 256, 32, 32 |
| pc_monitor | mi_office_generic | 128, 896, 32, 32 |
| plant_pot | mi_office_living | 0, 256, 32, 64 |
| bookshelf | mi_office_living | 96, 576, 96, 96 |
| printer | mi_office_generic | 224, 576, 64, 64 |

---

## 3. Modern Office – auto-extracted (full objects, no fragments)

**Source:** Script `extract_sheet_objects.py` + `auto_tag_objects.py`.  
**I have not viewed the sheet pixels** – only the generated JSON and montage PNGs.

| Catalog file | Sheet file | Object count | Visual index |
|--------------|------------|--------------|--------------|
| catalog_modern_office_16.auto.json | Modern_Office_16x16.png | 182 | out/sheet_extract/modern_office_16.montage.png |
| catalog_modern_office_32.auto.json | Modern_Office_32x32.png | 194 | out/sheet_extract/modern_office_32.montage.png |
| catalog_modern_office_48.auto.json | Modern_Office_48x48.png | 195 | out/sheet_extract/modern_office_48.montage.png |

Each object has: `rect`, `grid`, `type` (prop/furniture/tall_storage/etc.), `placement.layer`.  
IDs look like: `modern_office_32__g6_0__3x4`.

---

## 4. Tiles (floors / walls)

**Catalog:** `tiles-catalog.json` (from build script).  
**Images:** `floor_tiles`, `wall_tiles`, `vxace_a5_tiles` (Floors/Walls from Modern Interiors RPG Maker MV / VX Ace).  
Used for: floor_single, wall_single, corridor_single, clinic_single.  
**I have not seen** the tile images; only that we pick by category (e.g. floor_office_wood, wall_interior).

---

## 5. Characters

**Player:** `player_xp` → Adam.png (32×48 per frame, 4×4 grid).  
**NPCs:** 16 spritesheets – `xp_abby`, `xp_alex`, `xp_bob`, … (same folder, 32×48).  
**I have not seen** the character PNGs; only that they’re loaded and used for player + NPCs.

---

## 6. Reference screenshot – things we name but may not have a sprite for yet

From `REFERENCE_OFFICE_INVENTORY.md`. These are **named** in the reference; we may or may not have a catalog rect that matches.

- lobby_floor_light, office_floor_dark  
- outer_walls_white, inner_partition_white, back_wall_brick, door_frame  
- waiting_chairs_blue_row, lobby_side_chairs_grey  
- desk_cluster_upper_left, office_chair_orange, desk_cluster_upper_right, office_chair_grey  
- counter_coffee_station, bookshelf_office, printer_cabinet, side_table_pedestal  
- water_cooler_blue, vending_fridge_unit, coffee_machine_stack  
- poster_pop_art_three_faces, wall_screen_large, wall_charts_graphs  
- plants_floor_large, plants_small_pots, desk_clutter_paper, pc_monitors  
- worker_bald_suit  

**Mapping status:**  
- Some are mapped in `reference_office_matches.json` to auto-catalog IDs (e.g. water_cooler, coffee_station).  
- Many are **not** yet mapped to a specific (sheet, x, y, w, h).  
- reference_office layout currently uses only: desk_pod, chair_office, monitor, plant_pot, bookshelf, printer (from openplan catalog).

---

## How to confirm and open everything

### 1. Export every catalog sprite as PNGs (open in a folder)

From `pixel-office-game` (with Node and `pngjs` installed in `scripts/`):

```bash
node scripts/export_catalog_sprites.js --catalog openplan --out out/verify_sprites
```

This writes one PNG per openplan object to `out/verify_sprites/openplan/` (e.g. `desk_pod.png`, `chair_office.png`). Open that folder in Explorer/Finder to confirm each sprite.

To export all auto-extracted sprites too:

```bash
node scripts/export_catalog_sprites.js --catalog all --out out/verify_sprites
```

Then open `out/verify_sprites/openplan/`, `out/verify_sprites/modern_office_32/`, etc.

### 2. Open the verification page in the browser

Serve the project from the **repo root** (e.g. `python -m http.server 8000` from `multbot`), then open:

**http://127.0.0.1:8000/pixel-office-game/verify-sprites.html**

That page loads the openplan and interiors catalogs and the sheet images, then draws each sprite in a grid with its **ID** and **(x,y) w×h**. Use it to confirm that the rect we have is the sprite you expect. If the sheet images don’t load (404), the server root is wrong: it must be the folder that contains both `pixel-office-game` and `pixel game stuff`.

---

## Summary

- **In-game for reference_office:** 10 openplan objects (desk, chair, monitor, lamp, paper, plant, whiteboard, bookshelf, water_cooler, printer) from **mo_black_shadow_32** at the rects above.  
- **Interiors prefabs:** 6 prefabs from XP Generic/Living (used for small_office, openplan, reception when not reference_office).  
- **Auto-extracted:** 182 + 194 + 195 objects from Modern Office 16/32/48 – full sprites, browsable in the montage PNGs.  
- **Tiles and characters:** Loaded and used; I don’t have a per-tile/per-frame list here.  
- **Reference inventory:** Many named items; only a subset have a verified sprite mapping. To “go over” them properly we’d open the reference image and each sheet (or montage) and say for each: “this reference thing = this sprite at (sheet, x, y, w, h).”
