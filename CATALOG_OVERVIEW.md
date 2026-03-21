# Pixel Game Assets — Catalog Overview

This document explains **what is in each sprite package** and **how things are built** so you and OpenClaw can use the catalog correctly. All paths are relative to:

`pixel game stuff / pixel game assets and stuff /`

---

## 1. Root folder layout

| Folder / file | Purpose |
|---------------|--------|
| **Modern_Interiors_RPG_Maker_Version** | LimeZu **full paid** interior pack (floors, walls, furniture, characters, MV + VX Ace + XP). |
| **Modern_Interiors_Free_v2.2** | LimeZu **free** interior sample (~1% of full): characters, small interior tiles, room builders. |
| **Modern_Exteriors_RPG_Maker_MV_v42.3** | LimeZu **exteriors** for RPG Maker MV: streets, buildings, cars, animations. |
| **modernexteriors-win** | Modern Exteriors in **16×16** layout (complete tileset, animated objects). |
| **modernuserinterface-win** | LimeZu **UI** pack: windows, buttons, portraits, 16×16 / 32×32 / 48×48. |
| **Character Generator 2.0 Setup.exe** | Tool to generate character sprites (outputs go into your project). |
| **Portrait_Generator_Setup.exe** | Tool to generate portraits (outputs usable as UI assets). |
| Various **.zip** | Original downloads; unzipped content is in the folders above. |

---

## 2. Modern Interiors (full) — how it’s built

**Path:** `Modern_Interiors_RPG_Maker_Version / Modern_Interiors_RPG_Maker_Version /`

LimeZu’s README says: *“Modern Interiors is a massive asset, take your time to explore it.”* It’s split by **engine**.

### 2.1 RPG_MAKER_MV (32×32 tiles, primary for our game)

- **Walls and floors (autotile-style)**  
  - `Floors_TILESET_A2_.png`, `Floors_2_TILESET_A2_.png` → use in **Tilesets A2** (floors).  
  - `Walls_TILESET_A4_.png`, `Walls_2_TILESET_A4_.png` → use in **Tilesets A4** (walls).  
  - **Import manual:** Import into Resource Manager → img/tilesets; assign to Database → Tilesets (A2 for floors, A4 for walls).

- **Interiors (furniture, rooms)**  
  - `Interiors / Theme_Sorter_MV /` → many **themed tilesets**, e.g.:
    - `Generic_01.png`, `Generic_02.png`, `Generic_03.png`
    - `Living_Room_01.png`, `Kitchen_01.png`, `Bathroom_01.png`, `Bedroom_01_Revamped.png`
    - `Basement_01.png`, `Classroom_and_Library_01.png`, `Hospital_01.png`, etc.  
  - These are meant for **Tilesets B, C, D, E** in RPG Maker (objects, not autotiles).

- **Characters**  
  - `Characters /` → single-character spritesheets (e.g. for Events).  
  - `Characters / MV_Character_Generator /` → subfolders: MV_Accessories, MV_Bodies, MV_Eyes, MV_Hairstyles, MV_Outfits (for the generator tool).

- **Animated objects**  
  - `Animated_Objects /` → e.g. `!$Bathtub.png` (event-sized animated sprites).

- **Others**  
  - `Others / Tilesets /` → extra tilesets (e.g. `Tileset_100_MV.png` used in our catalog).

So in **MV**:
- **A2** = floors, **A4** = walls, **B–E** = interior tiles (furniture, props).
- Everything in Theme_Sorter_MV is **32×32** tiles in a grid.

### 2.2 RPG_MAKER_VX_ACE (WIP) — 32×32

- **Path:** `RPG_MAKER_VX_ACE (WIP) / Theme_Sorter_VX_ACE /`
- **Files:**  
  - **A5** = walls/floors: `A5_Walls_Floors.png`, `A5_Walls_Floors_2.png`  
  - **B–C–D–E** = themed interiors: e.g. `B-C-D-E_Generic_01.png`, `B-C-D-E_Living_Room_01.png`, `B-C-D-E_Basement_01.png`, `B-C-D-E_Art.png`, Kitchen, Bedroom, Halloween, Jail, etc.
- Same idea as MV: **A5** for terrain/walls, **B–E** for objects. We already use several of these in `tilesheets-config.json`.

### 2.3 RPG_MAKER_XP — 32×32

- **Path:** `RPG_MAKER_XP /`
- **Tilesets:**  
  - `0_Everything.png`, `0_Everything_2.png`  
  - `1_Generic.png`, `2_LivingRoom.png`, `3_Bathroom.png`, `4_Bedroom.png`, … up to `16_Grocery_store.png` (and `7_Art_32x32.png`, etc.).  
  - Themed names: Kitchen, Classroom, Music_and_sport, Gym, Fishing, Birthday_party, Halloween, Christmas, etc.
- **Characters:**  
  - `Characters /` → e.g. `Adam.png`, `Alex.png`, `Bob.png`, … and the pre-extracted strips `Adam_walk_down_16x32.png`, etc.
- XP uses a **different character cell size** (e.g. 32×48 or 48×32 in sheets); our game uses the XP character sheet for the player.

---

## 3. Modern Interiors FREE — what’s in it

**Path:** `Modern_Interiors_Free_v2.2 / Modern tiles_Free /`

- **README:** Free version has ~1% of the full asset.
- **Characters_free/**  
  - 16×16 strips: e.g. `Adam_idle_anim_16x16.png`, `Adam_run_16x16.png`, `Alex_idle_anim_16x16.png` (we use these for NPC idle and previously for player).  
  - Same for Amelia, Bob, etc. (idle, run, phone, sit variants).
- **Interiors_free/**  
  - 16×16, 32×32, 48×48: `Interiors_free_*.png`, `Room_Builder_free_*.png`.
- **free_overview.png** — reference image.  
- **Old/** — legacy tilesets and character sizes (16/32/48).

So the **free** pack is good for: small character strips (idle/run), a few interior tiles, and room builders; the **full** pack is needed for the big themed tilesets we catalog.

---

## 4. Modern Exteriors — what’s in it

**Path (MV):** `Modern_Exteriors_RPG_Maker_MV_v42.3 / Modern_Exteriors_RPG_Maker_MV /`

- **Floors/walls:** `A2_Floors_MV_TILESET*.png`, `A4_Walls_MV_TILESET.png`
- **Tilesets:** `Tileset_1_MV.png` … `Tileset_172_MV.png`, plus vehicles: `Tileset_Cars_MV.png`, `Tileset_Buses_1_MV.png`, `Tileset_Fire_Truck_1_MV.png`, etc.
- **Animations:** `Animations/` — e.g. `!$Box_1.png`, `!$Condo_door_1.png`, `!$Fountains.png`, `!$Street_Lamp.png`
- **Characters:** e.g. `Characters/MV_Graveyard_Zombies_Skeleton.png`

**Path (16×16):** `modernexteriors-win / Modern_Exteriors_16x16/`  
- Complete tileset, animated objects (e.g. Fire_Station_Door, animated gifs).  
- Different resolution (16×16) from MV 32×32.

Use exteriors for **outside** areas (streets, buildings, cars); use **interiors** for offices/rooms.

---

## 5. Modern User Interface

**Path:** `modernuserinterface-win /`

- **READ_ME:** “Thanks for downloading the Modern UI asset pack!”
- **16x16, 32x32, 48x48** — UI elements at three scales (windows, buttons, frames, etc.).
- **Portrait_Generator_ase** — likely Aseprite or portrait-related assets.

Use for: dialog windows, buttons, HUD, menus. We reference this in `assets-catalog.json` (e.g. window_frame_basic, button_blue) for future UI.

---

## 6. How the catalog fits in

- **tilesheets-config.json**  
  Defines **which PNGs** are tilesheets and how to slice them:
  - `tileWidth`, `tileHeight`, `tilesPerRow`
  - One or more **categories** per sheet (e.g. `floor_office_wood`, `wall_interior`, `vxace_living_room_plants`), each with `fromIndex`, `toIndex`, and `tags`.

- **build_tiles_catalog.py**  
  Reads `tilesheets-config.json`, and for every tile in every category writes one entry to **tiles-catalog.json** with:
  - `sheetId`, `sheetPath`, `tileIndex`, `x`, `y`, `tileWidth`, `tileHeight`, `category`, `tags`.

- **tiles-catalog.json**  
  The **per-tile** catalog: every listed tile has exact coordinates and a category so the game (or OpenClaw) can say “place a tile with category X” or “get all tiles with tag Y”.

- **assets-catalog.scanned.json** (if present)  
  From `build_assets_catalog.py`: a **file-level** list of every PNG under the asset root (by pack/folder). Use it to discover new sheets to add to `tilesheets-config.json`.

So:
- **Discovery** = scan folders / read this overview / use assets-catalog.scanned.json.
- **Slicing** = add or edit sheets in tilesheets-config.json (and categories).
- **Usage** = run `build_tiles_catalog.py`, then the game or scripts read tiles-catalog.json by category/tags.

---

## 7. Sheets currently in tilesheets-config (quick reference)

| sheet id | path (relative to asset root) | categories |
|----------|-------------------------------|------------|
| modern_interiors_floors_a2 | .../RPG_MAKER_MV/Floors_TILESET_A2_.png | floor_office_wood |
| modern_interiors_walls_a4 | .../RPG_MAKER_MV/Walls_TILESET_A4_.png | wall_interior |
| modern_interiors_furniture_100 | .../RPG_MAKER_MV/Tileset_100_MV.png | furniture_generic |
| vxace_generic_bcde_01 | .../Theme_Sorter_VX_ACE/B-C-D-E_Generic_01.png | vxace_generic_doors, windows, curtains, misc |
| vxace_living_room_bcde_01 | .../Theme_Sorter_VX_ACE/B-C-D-E_Living_Room_01.png | vxace_living_room_plants, shelves, rugs, misc |
| vxace_a5_walls_floors | .../Theme_Sorter_VX_ACE/A5_Walls_Floors.png | vxace_a5_walls_floors_all |
| vxace_basement_bcde_01 | .../Theme_Sorter_VX_ACE/B-C-D-E_Basement_01.png | vxace_basement_all |
| xp_generic_01 | .../RPG_MAKER_XP/1_Generic.png | xp_generic_all |
| xp_living_room_02 | .../RPG_MAKER_XP/2_LivingRoom.png | xp_living_room_all |

After you run `python pixel-office-game/build_tiles_catalog.py`, **tiles-catalog.json** contains one entry per tile in these sheets, with coordinates and labels. To add more sheets (e.g. more XP themes or MV Theme_Sorter_MV files), add a block to `tilesheets-config.json` and run the script again.

---

## 8. Naming conventions (how things are built)

- **A2 / A4 / A5** = autotile-style layers (floors, walls). Usually one big image, many 32×32 cells.
- **B, C, D, E** = object/furniture layers in RPG Maker; each file is one themed set (e.g. Living_Room, Generic, Basement).
- **Theme_Sorter_MV** vs **Theme_Sorter_VX_ACE** = same themes, different engine folder; we use VX Ace paths in the config because we already wired those.
- **Characters** = character sprites (single file per character or per animation strip). XP has both full sheets (e.g. Adam.png) and pre-cut strips (Adam_walk_down_16x32.png).
- **Tileset_100_MV.png** etc. = numbered interior tilesets in MV (furniture, props).

If you add a new sheet, use **tilesheets-config.json** to give it an `id`, `path`, grid size, and at least one category; then regenerate the catalog. This overview should be enough to understand what’s in each sprite package and how to keep building a good catalog.
