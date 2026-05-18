# Denizen — Scripts Toolchain

> `scripts/` is the asset pipeline — the offline workshop that turns raw
> sprite sheets into the catalogs and manifests the game reads at runtime.
> This doc separates the scripts you actually run from the
> archaeological ones that linger as exploration scratch.

`scripts/` is **not** part of the runtime. The game server (`server.js`)
never invokes these. They run on your developer machine, write JSON +
PNG artifacts into the repo, and the game picks those up.

## TL;DR — pipeline a contributor actually runs

For a fresh asset import (e.g. dropping in a new LimeZu sheet pack):

```bash
# 1. Slice every sheet into per-sprite PNGs
pwsh scripts/extract_all_sheets.ps1

# 2. Build the canonical catalog
python scripts/build_master_catalog.py

# 3. (Optional) AI-label any sprites that ended up with bad/missing tags
python scripts/label_sprites_ai.py

# 4. Generate visual reference montages (contact sheets) for QA
python scripts/make_sprite_mosaics.py

# 5. Build the browser-side singles manifest for the asset browser UI
node scripts/build_singles_manifest.js
```

Everything else in `scripts/` is either secondary, one-shot, or archaeological.

## Pipeline overview

```
   raw sheets (assets/*.png)
            │
            ▼
   extract_all_sheets.ps1  ──┐ orchestrator
   extract_sheet_objects.py  ┘ background removal + bounding box → per-sprite PNGs
            │
            ▼
   slice_sheet_scanner.py   (grid variant of the above, for grid-aligned sheets)
            │
            ▼
   build_master_catalog.py  ──▶ assets-catalog.json + assets-catalog.scanned.json
            │
            ├── label_sprites_ai.py        (AI labels via a vision model)
            ├── autolabel_from_path.py     (heuristic labels from filename)
            └── patch_catalog_labels.py    (manual fixes to specific entries)
            │
            ▼
   build_ui_catalog.py      ──▶ ui-windows.json   (filtered subset for in-game UI)
            │
            ▼
   make_sprite_mosaics.py   ──▶ montage_*.png + montage_*.map.json  (visual reference)
            │
            ▼
   build_singles_manifest.js  ──▶ data/singles-manifest.json  (browser UI manifest)
```

## What each script actually does

### Sprite extraction (essential)

| Script | Purpose |
|---|---|
| **`extract_all_sheets.ps1`** | PowerShell orchestrator — walks the `assets/` directory and calls `extract_sheet_objects.py` on every sheet. The right entry point for a bulk import. |
| **`extract_sheet_objects.py`** | Auto-extracts sprites from a sheet via background removal + connected-component bounding boxes. Writes one PNG per sprite into a singles directory. Works on irregular-layout sheets. |
| **`slice_sheet_scanner.py`** | Grid-aware variant of the above for sheets that *are* on a regular grid (32px / 48px tiles). Faster and more accurate when the grid is consistent. |

### Catalog building (essential)

| Script | Purpose |
|---|---|
| **`build_master_catalog.py`** | Reads every single-sprite PNG, builds the master catalog (`assets-catalog.json`) with one entry per sprite. Each entry has filename, dimensions, semantic labels (direction, variant, anim_state, entity_type), and source sheet. **This is the file the game reads at runtime.** |
| **`build_ui_catalog.py`** | Filters the master catalog down to UI-only sprites (windows, dialog frames, etc.) and writes `ui-windows.json`. |
| **`build_singles_manifest.js`** | Node utility: scans the singles directory, writes a thin JSON manifest the browser-side asset browser (`asset-browser.html`) consumes. Run after the catalog so the manifest matches. |

### Labeling (often needed)

| Script | Purpose |
|---|---|
| **`label_sprites_ai.py`** | Sends each sprite to a vision model and stores the returned labels. Use when filename heuristics aren't enough (e.g. third-party packs with unhelpful names like `tile_0042.png`). |
| **`autolabel_from_path.py`** | Heuristic fallback: parses labels out of filenames + folder structure. Cheap, no API calls, often "good enough." |
| **`patch_catalog_labels.py`** | Apply manual corrections to specific entries — useful when an AI label is wrong but everything else is fine. |
| **`auto_tag_objects.py`** | Assigns higher-level tags (`furniture`, `decor`, `prop`, `tile`) on top of the AI/heuristic labels. |

### Visual reference (good for QA)

| Script | Purpose |
|---|---|
| **`make_sprite_mosaics.py`** | Generates `montage_*.png` contact sheets — one big image showing every sprite of a given category. Pair with `montage_*.map.json` which maps mosaic pixel coords back to sprite IDs. |
| **`make-montage.js`** | Node variant — same idea, used when you want a single montage from a JSON-described set. |

### Cleanup / data hygiene

| Script | Purpose |
|---|---|
| **`cleanup_bad_names.py`** | Renames sprites whose filenames contain invalid characters or duplicates. |
| **`detect_bad_crops.py`** | Flags sprites whose bounding boxes look wrong (likely failures from `extract_sheet_objects`). |

### Archaeological / one-shot (don't run these by default)

These exist for historical reasons. If you're confused why they're here:
they were used once to bootstrap the catalog and stayed in case the same
problem comes back. Skim before deleting.

- `crop-tile.js` — manual single-tile cropper
- `match-tile.js`, `match_tile.py`, `reference_match.py` — template-match
  algorithms for finding "this sprite looks like that one"
- `pick-office-props.js`, `pick_*.png`, `pick2_*.png` — manual picker UI
- `match_*.png`, `match_chair_tx4_ty8.png`, `match_monitor_tx4_ty28.png`
  — outputs from earlier match runs
- `chair_crop*.png`, `chair_try_*.png` — chair-extraction experiments
- `export_aseprite_prefabs.ps1` — Aseprite-specific export (only useful
  if you're building prefabs in Aseprite)
- `export_catalog_sprites.js` — re-exports a subset of the catalog to PNG
- `add_mo_singles_to_catalog.py`, `add_all_mo_sizes_to_catalog.py` — bulk
  population helpers from the initial import
- `scan-sprites.js` — early scanner, superseded by `extract_sheet_objects`
- `*.scan.json`, `*.grid32.json`, `*.grid48.json`, `*.scan16.json`,
  `*.scan32.json`, `*.scan48.json` — output dumps from past scans
- `montage_*.png` / `montage_*.map.json` — past montages, regenerated by
  `make_sprite_mosaics.py`

## Languages + dependencies

| Lang | Why | Install |
|---|---|---|
| Python 3 | Most extraction + cataloging scripts | `pip install pillow numpy` (basic), plus `requests` if you use AI labeling |
| Node.js | A few JS-only utilities (catalog + manifest builders, montage maker) | `npm install` inside `scripts/` reads `scripts/package.json` |
| PowerShell | Two orchestrators (`extract_all_sheets.ps1`, `export_aseprite_prefabs.ps1`) | Pre-installed on Windows; `pwsh` on Linux/macOS |

`scripts/package.json` + `scripts/node_modules/` exist for the Node side.
Run `npm install` from inside `scripts/` if you're going to run any of
the `.js` scripts.

## Adding a new script

1. Put it in `scripts/`. Pick the language that fits — Python for image
   manipulation, Node for JSON/catalog work, PowerShell only for
   filesystem orchestration that's already PowerShell-y.
2. **Document the inputs and outputs at the top of the file** in a
   comment block. The existing scripts mostly do this; new ones should.
3. If it's part of the canonical pipeline, add it to the **TL;DR**
   section at the top of this doc.
4. If it's a one-shot exploration, add it to the **archaeological**
   section so future readers know not to run it by default.

## See also

- [TOOLS_GUIDE.md](../TOOLS_GUIDE.md) — the in-browser tools (Sprite
  Cutter, Catalog Explorer, Asset Browser) that consume the artifacts
  these scripts produce
- [ENGINE_AND_SPRITES.md](../ENGINE_AND_SPRITES.md) — Phaser scene
  lifecycle + sprite sheet formats, i.e. how the catalog gets used at
  runtime
- [CATALOG_OVERVIEW.md](../CATALOG_OVERVIEW.md) — what the LimeZu pack
  contains, before this pipeline runs
- [CATALOG_CONVENTIONS.md](../CATALOG_CONVENTIONS.md) — the field
  vocabulary the catalog uses
