# Sprite Assembly Blueprint (for Cursor & humans)

Use this when adding or editing sprite sheets (Gym, Living Room, Bedroom, etc.) so objects are assembled correctly without guessing coordinates.

---

## 1. Visual Anchor rules

- **The 16px rule:** Every object is composed of **16×16 pixel blocks**. Base grid = 16px. Sheet cells may be 32×32 (2×2 base blocks).
- **Compound objects:** Items like the **large bookshelf**, **treadmill**, or **punching bag** are **compound objects**. Do **not** treat them as individual tiles. Define them as a **single entity** with width/height in base tiles (e.g. Bookshelf = 3 wide × 3 tall = 48×48 px).
- **Base-point alignment:** When placing an object, the **Y coordinate is the bottom** of the object. Use `pivot: "bottom"` (origin at bottom-center) so tall items (fireplace, gym rack, tent) sit on the floor.
- **Transparent padding:** Many sprites have empty space at the **top** of their 16×16 box for layering. **Do not crop this out**, or furniture will float. Slice the full cell; use `render_offset` for decor that sits on surfaces.

---

## 2. Flat vs tall

- **Flat:** Blue mats, rugs, small items → often 1×1 or 2×2 base tiles. Can use `pivot: "center"` if symmetric.
- **Tall:** Bookshelves, punching bags, weight racks, treadmills → multi-tile height. Always use `pivot: "bottom"` and define full **w** × **h** in `data/definitions.json` (and `data/object-defs.json` when you add the sheet).

---

## 3. Attachment system (Living Room / decor on surfaces)

- **Surface** = furniture that can hold decor: table, sofa, desk, counter.
- **Decor** = items that sit *on* a surface: fruit bowl, pillows, lamp, computer.
- Rule: If an object is typed as **`decor`** and has **`attachToSurface: true`**, it should snap to the **center of the nearest Surface** with a **-4px Y-offset** (or use explicit `render_offset` when placing in layout).
- In code: when placing from `map-layout.json`, decor with a `surfaceId` or “nearest surface” logic can use that offset so bowls/pillows sit on tables.

---

## 4. Z-index (draw order)

- **Y-sorting:** Every frame, set the depth of **all sprites** (player, NPCs, furniture, decor) based on **bottom_y** (the Y of their “feet” or base). The further **down** on the screen, the **higher** the render depth (drawn in front).
- Implementation: see `office-scene.js` → `update()`: the scene collects **all sprites**, sorts by **bottom_y**, then assigns `depth = 10 + index`.
- Order of layers: **floor (0)** → **furniture (e.g. 1.5)** → **decor (e.g. 2)** → characters sorted by Y on top.

---

## 5. Where to put what

| Location        | Purpose                                      | What to tell Cursor |
|----------------|-----------------------------------------------|---------------------|
| **assets/**    | Raw PNGs (if you mirror them here)            | Keep as read-only.  |
| **data/definitions.json** | Sizes (e.g. Treadmill = 64×48), types, pivot | Update when adding a new sheet. |
| **data/object-defs.json** | Per-sheet object defs (topLeftIndex, w, h, type, render_offset, pivot) | Use for assembly. |
| **office-scene.js** | Main “assembler” + Y-sorting                 | Use Y-sorting for all objects and characters. |

---

## 6. Scanner script (auto-slice)

To avoid manual coordinate entry, run either scanner on a PNG:

- **Node script (recommended):** `scripts/scan-sprites.js` (uses `pngjs`, already installed under `scripts/`)\n+  - Run from `pixel-office-game/scripts/`:\n+    - `node scan-sprites.js \"..\\..\\pixel game stuff\\...\\RPG_MAKER_XP\\8_Gym.png\" --grid 16 --minAlpha 10 --json`\n+  - Output: merged compound-object bounding boxes in 16px grid units + pixel rects.\n+- **Python script:** `scripts/slice_sheet_scanner.py`
- **Input:** Path to sprite sheet (e.g. `8_Gym.png`, `2_LivingRoom.png`).
- **Output:** Suggested **compound objects** (non-transparent clusters in 16×16 grid), e.g. “punching bag = 16×48” (one tall object) instead of three separate 16×16 tiles.
- Use the script output to fill `data/definitions.json` and then `data/object-defs.json` with correct **w** × **h** and pivot.

---

## Quick reference for Cursor

When editing sprite assembly:

1. **16px base grid;** compound objects = one entity with **w** × **h** in base tiles.
2. **Y = bottom** of object; use **pivot: "bottom"** for tall objects.
3. **Don’t crop** transparent padding at top of cells; use **render_offset** for decor on surfaces.
4. **Decor** on tables/sofas: **-4px Y** (or `render_offset.y: -4`) and **attachToSurface** in definitions.
5. **Z-index:** Y-sort by **bottom_y** every frame (already in `office-scene.js`).
6. Sizes and types live in **data/definitions.json**; per-sheet assembly in **data/object-defs.json**.

---

## 7. Large objects with “walk‑inside” (e.g. military tents, 4051.gif)

For **large objects like tents**, do **not** use a full-body collision box. If the collision covers the whole sprite, the character cannot walk into the entrance.

- **Rule:** The **collision box** should be a **small rectangle at the very back** of the object (e.g. back wall of the tent), so the character can walk “into” the front opening.
- In code: when adding physics bodies for such objects, set the body size/offset so it only blocks the back portion, not the entrance.
