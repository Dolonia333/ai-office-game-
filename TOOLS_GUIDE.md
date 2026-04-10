# Tools Guide

A reference for every browser tool in this repo — what it does, how to open it, and how to use it.

---

## How to Run Any Tool

All tools are plain HTML files served by the game server. Start the server, then open the tool in your browser:

```bash
node server.js            # starts on http://localhost:8080
```

Then navigate to e.g. `http://localhost:8080/sprite-cutter.html`.

No build step required. All tools work offline once the server is running.

---

## Tools at a Glance

| Tool | URL | Purpose |
|------|-----|---------|
| [Sprite Cutter](#sprite-cutter) | `/sprite-cutter.html` | Cut named sprites from a sheet, export catalog JSON |
| [Catalog Explorer](#catalog-explorer) | `/catalog-explorer.html` | Browse all catalog files, schemas, flow diagrams |
| [Asset Browser](#asset-browser) | `/asset-browser.html` | Thumbnail grid of every LimeZu asset pack |
| [Tile Labeler](#tile-labeler) | `/tile-labeler.html` | Label individual floor/wall tiles in MV tilesets |
| [Sprite Labeler](#sprite-labeler) | `/sprite-labeler.html` | Review and fix object IDs on character sprites |
| [Singles Viewer](#singles-viewer) | `/singles-viewer.html` | Browse extracted single-sprite PNGs (IDs 1–339) |
| [Verify Sprites](#verify-sprites) | `/verify-sprites.html` | Confirm every catalog entry actually renders correctly |

---

## Sprite Cutter

**File:** `sprite-cutter.html`

The main tool for turning a raw sprite sheet into named catalog entries. You draw a box around a sprite, name it, save it to a list, then export everything as catalog JSON.

### Opening a Sheet

1. Click **Load Sheet** (top toolbar) → browser file picker → select any `.png`
2. The sheet fills the left canvas panel at the current zoom level
3. Sheet dimensions appear in the top bar

You can also drag and drop a PNG onto the canvas.

### Drawing a Selection

- **Click and drag** on the canvas to draw a selection rectangle
- By default the selection **snaps to 32px grid** — edges lock to multiples of 32
- Hold **Shift** while dragging for **freeform** (no snap)
- The red selection box shows the current cut; pixel coordinates appear in the right panel

### Right Panel

| Element | What it shows |
|---------|---------------|
| **Preview 1×** | The cut at native pixel size |
| **Preview 2×** | The cut doubled (easier to inspect) |
| **Coordinates** | `x, y, w × h` of the current selection |
| **JSON block** | Ready-to-paste catalog entry for this cut |
| **Name input** | What to call this sprite in the catalog |

### Saving a Cut

1. Type a name in the **Name** field (e.g. `desk_pod`, `chair_blue`)
2. Press **Enter** or click **Save**
3. The cut appears in the **Saved Cuts** list at the bottom right with a mini preview

Saved cuts persist in `localStorage` — closing and reopening the browser keeps your list.

### Saved Cuts List

Each saved entry shows:
- 32×32 mini-preview canvas
- Name + coordinates
- **✕** button to delete it
- Click the row to **recall** that cut (jumps the sheet scroll to it, restores the selection box)

### Importing Existing Catalog

Click **Import from Catalog** to load all sprite-based entries from `data/furniture_catalog_openplan.json` into the saved list. Useful for reviewing or re-cutting entries.

### Exporting to JSON

Click **Export All JSON** — downloads `sprite_cuts.json` with this structure:

```json
{
  "desk_pod": {
    "sheet": "mo_black_shadow_32",
    "x": 64,
    "y": 0,
    "w": 128,
    "h": 96,
    "origin": "bottom",
    "depth": 1.5,
    "display_w": 128,
    "display_h": 96,
    "type": "furniture"
  }
}
```

Paste these entries into `data/furniture_catalog_openplan.json` under the `"objects"` key.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `Enter` | Save current cut (if a selection exists) |
| `Shift` + drag | Freeform selection (bypasses grid snap) |

### Grid Snap Settings

- **Snap to 32px** checkbox (toolbar) — on by default
- **Show Grid** checkbox — overlays a 32px grid on the sheet (helps align cuts)
- **Zoom** slider — 1× to 4×

---

## Catalog Explorer

**File:** `catalog-explorer.html`

A read-only browser for all catalog data. Use it to inspect schemas, check for issues, and understand the data pipeline.

### Tabs

| Tab | Content |
|-----|---------|
| **Overview** | Summary cards: pack count, object count, type breakdown |
| **Schemas** | Field-by-field reference for each catalog format |
| **Objects** | Searchable grid of every catalog entry |
| **Issues** | Auto-detected problems (missing fields, bad coords, etc.) |
| **Pipeline** | Flow diagram of the sheet → slice → catalog → game path |

Use the **search box** in the Objects tab to filter by name, type, or sheet ID.

---

## Asset Browser

**File:** `asset-browser.html`

Thumbnail grid of every image in the LimeZu asset packs. Use it to find a sprite visually without opening a massive sheet file.

### How to Use

1. Use the **Pack** dropdown to filter by LimeZu folder (Modern Office, Modern Interiors, etc.)
2. Click any thumbnail to see the full file path and pack metadata in the right sidebar
3. Copy the path to use as a source in the Sprite Cutter or catalog

---

## Tile Labeler

**File:** `tile-labeler.html`

For RPG Maker MV floor and wall tilesets (the `A2`, `A4`, `B/C/D/E` sheets). Click a tile cell to assign it a label like `floor_wood` or `wall_concrete`.

### Workflow

1. Choose the tileset from the **dropdown** (MV A2 Floors, A4 Walls, or BCDE sheet 2)
2. The sheet renders at the selected grid size (usually 48px for MV)
3. Click any cell → type a name in the right panel → press Save
4. Click **Export JSON** → downloads `{ tilesetId, tileSize, labels: { "x,y": "name" } }`

---

## Sprite Labeler

**File:** `sprite-labeler.html`

For reviewing and fixing object ID assignments on character/NPC sprite sheets. Useful after running an auto-slicer that may have produced wrong names.

### Workflow

1. Load a character sheet (XP-format: 128×192, 4 columns × 4 rows of 32×48 frames)
2. Each frame gets an auto-assigned ID; click to override with a correct label
3. Export updated labels as JSON

---

## Singles Viewer

**File:** `singles-viewer.html`

Browse extracted single-sprite PNGs. These are the pre-sliced outputs from `extract_adam_xp_strips.py` and similar tools — each file is one character frame or one object tile.

### How to Use

- Sprites display in a grid with their numeric ID (1–339)
- Hover a card to see file path and pixel dimensions
- Use the search box to filter by ID range or filename fragment
- Use when you know an item's ID but want to see what it looks like without opening the full sheet

---

## Verify Sprites

**File:** `verify-sprites.html`

Opens every catalog entry and renders the actual crop from the sheet. Use this after editing a catalog file to confirm nothing is off.

### Tabs

| Tab | Content |
|-----|---------|
| **Openplan** | All entries from `furniture_catalog_openplan.json` |
| **Interiors prefabs** | All entries from the interiors catalog |

Each card shows the live-rendered sprite at its stored `(x, y, w, h)`. Red border = image failed to load. Blank/wrong image = bad coordinates.

**Links in the page**: wrong labels → [Sprite Labeler](sprite-labeler.html) · wrong tile IDs → [Tile Labeler](tile-labeler.html)

---

## End-to-End Workflow: Sheet → Catalog → Game

```
1. Find the sprite
   └─ Asset Browser → locate the PNG, note the sheet name

2. Cut the sprite
   └─ Sprite Cutter → load PNG, draw selection, name it, save

3. Export JSON
   └─ Sprite Cutter → Export All JSON → downloads sprite_cuts.json

4. Paste into catalog
   └─ Open data/furniture_catalog_openplan.json
   └─ Paste entries under "objects": { ... }
   └─ Add fields: type, action, theme (see CATALOG_CONVENTIONS.md)

5. Verify
   └─ verify-sprites.html → confirm crops render correctly

6. Add to master catalog (optional)
   └─ python scripts/build_master_catalog.py
   └─ Merges all furniture_catalog_*.json → data/master_furniture_catalog.json

7. Place in game
   └─ office-scene.js → furniture placement array (or drag-drop via room builder)
   └─ RoomAssembly.js reads master catalog, renders sprites at given world coords
```
