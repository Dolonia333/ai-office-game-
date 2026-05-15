# Engine and Sprites

How the game works under the hood — the Phaser 3 scene lifecycle, how sprite sheets are organized, how the catalog pipeline works, and how a JSON entry becomes a visible object on screen.

---

## Stack Overview

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Server | Node.js 22 + `ws` | Serves static files on port 8080, routes WebSocket messages to AI backends |
| Client | Phaser 3.80 (browser) | Rendering, input, NPC animation — no build step, no transpile |
| AI backends | Claude / Grok / Gemini / LM Studio | NPC brains, CTO agent, security monitor |
| Data | JSON files in `data/` | Catalogs, room templates, sheet registry |

No bundler. Every file is loaded directly. Open `http://localhost:8080` to run the game.

---

## Phaser Scene Lifecycle

The main scene is `office-scene.js`. Phaser calls three methods in order:

### 1. `preload()`

Loads all assets before anything is drawn:

```
tiles_catalog              → tiles-catalog.json
furniture_catalog_openplan → data/furniture_catalog_openplan.json
master_furniture_catalog   → data/master_furniture_catalog.json
room-templates.json
sprite sheets              → load.spritesheet() calls for each PNG
NPC character sheets       → load.spritesheet() per character
```

Phaser queues all these; the browser fetches them in parallel. Nothing in `create()` runs until every asset resolves.

### 2. `create()`

Runs once when all assets are loaded. Does the actual scene setup:

1. Reads JSON catalogs from `this.cache.json.get('...')`
2. Builds floor and wall tile sprites
3. Instantiates `RoomAssembly` and calls `assembly.initialize(catalogData, roomTemplates, masterData)`
4. Calls `assembly.renderRoom(templateName, originX, originY)` to place all furniture
5. Creates player avatar and NPCs with their Phaser animation configs
6. Wires up input handlers (keyboard, click-to-walk)
7. Opens WebSocket to `/agent-ws`

### 3. `update(delta)`

Runs every frame (~60fps):

- Moves player toward click target (pathfinding)
- Steps NPC brain timers
- **Y-sort**: all sprites (player + NPCs + furniture marked as sortable) are sorted by their `bottom_y` coordinate; `setDepth()` is called only when `_depthDirty` is true, keeping it cheap
- Sends periodic `office_state` WebSocket messages to the server

---

## Sprite Sheet Formats

### Object / Furniture Sheets

The primary sheet is `Modern_Office_Black_Shadow.png` (called `mo_black_shadow_32` in the catalog).

- Grid size: **32×32 px** per cell
- Multi-cell objects: a desk might be `128×96` (4 wide × 3 tall cells)
- Catalog stores pixel coordinates `(x, y, w, h)` — **not** tile indices
- Origin: `"bottom"` — the anchor point is the bottom-center of the sprite. This means when you give a world Y position you are specifying the floor contact point.

### Character / NPC Sheets

XP-style format (RPG Maker XP):

```
Sheet size: 128 × 192 px
Frame size: 32 × 48 px
Layout:     4 columns × 4 rows = 16 frames

Row 0 (top):    walking DOWN  — frames left→right
Row 1:          walking LEFT
Row 2:          walking RIGHT
Row 3 (bottom): walking UP
```

Each row has 4 animation frames. Phaser `load.spritesheet()` slices the sheet into 16 individual frames (frameWidth: 32, frameHeight: 48). Animations are defined like:

```js
this.anims.create({
  key: 'walk_down',
  frames: this.anims.generateFrameNumbers('character_key', { start: 0, end: 3 }),
  frameRate: 8, repeat: -1
});
```

### MV / VX Tileset Sheets

Floor and wall tiles from the RPG Maker MV packs use **48×48 px** cells. The `tile-labeler.html` tool maps individual cells to name labels.

---

## The Sprite Registry (`data/sheet_registry.json`)

Canonical map of every sheet used in the game:

```json
{
  "mo_black_shadow_32": {
    "file": "assets/modern-office/Modern_Office_Black_Shadow.png",
    "grid": 32
  },
  "mo_32": {
    "file": "assets/modern-office/Modern_Office_Shadowless.png",
    "grid": 32
  }
}
```

The `"sheet"` field in every catalog entry refers to one of these IDs. `RoomAssembly` uses this to know which loaded texture to crop.

---

## The Catalog System

### Files and their roles

| File | Contents |
|------|---------|
| `data/furniture_catalog_openplan.json` | Primary catalog — 48+ verified sprite cuts for the open-plan office |
| `data/furniture_catalog_promo.json` | Promo layout objects |
| `data/furniture_catalog.json` | Older / general furniture entries |
| `data/master_furniture_catalog.json` | Auto-generated merge of all three above |
| `tiles-catalog.json` | Grid-sliced individual tile entries |
| `assets-catalog.json` | Top-level pack registry (folder → pack metadata) |

### Catalog Entry Schema

Each object entry in the `"objects"` map:

```json
"desk_pod": {
  "sheet":     "mo_black_shadow_32",   // sheet registry ID
  "x":         64,                     // left edge, pixels from sheet origin
  "y":         0,                      // top edge, pixels from sheet origin
  "w":         128,                    // crop width in pixels
  "h":         96,                     // crop height in pixels
  "origin":    "bottom",               // anchor: "bottom" | "center" | "top"
  "depth":     1.5,                    // default Phaser draw depth
  "display_w": 128,                    // rendered width (can differ from w for scaling)
  "display_h": 96,
  "type":      "surface",              // see type vocabulary below
  "action":    "use_computer",         // interaction verb
  "_note":     "Long tan horizontal desk"
}
```

### Type Vocabulary

| Type | Meaning |
|------|---------|
| `ground` | Floor decoration / rug |
| `wall` | Wall segment or panel |
| `surface` | Furniture you can interact with (desk, counter) |
| `surface_cluster` | A group of surfaces treated as one unit |
| `furniture` | General furniture, no interaction |
| `seat` | Chair or sofa |
| `decor` | Decorative item — often placed on a surface |
| `object` | Generic interactive prop |

See `CATALOG_CONVENTIONS.md` for the full field reference including `theme`, `style`, `anchors`, `interact_distance`, and `snap_offset`.

---

## How a Catalog Entry Becomes a Sprite on Screen

### Step 1 — `RoomAssembly.initialize()`

Called in `create()` after JSON is loaded from cache:

```js
const assembly = new RoomAssembly(this); // this = Phaser scene
assembly.initialize(catalogData, roomTemplatesData, masterData);
```

Stores the `objects` map in `assembly.catalog`. Also registers the master catalog as a fallback.

### Step 2 — `RoomAssembly.renderRoom(templateName, originX, originY)`

Reads `room-templates.json` for the named template. Each template has a list of placement items:

```json
{
  "id": "desk_pod",
  "x": 200,
  "y": 300,
  "z_index": 1.5
}
```

For each item, calls `_getDef(id)` to look up the catalog entry, then `_ensureTexture(id, def)` to create a Phaser canvas texture cropped from the sheet.

### Step 3 — `_ensureTexture()`

```js
// Sheet-based entry
const texKey = `asm_${catalogId}`;
const canvasTex = this.scene.textures.createCanvas(texKey, def.w, def.h);
canvasTex.context.drawImage(
  sheetElement,   // the HTMLImageElement loaded by Phaser
  def.x, def.y,  // source crop
  def.w, def.h,
  0, 0,           // destination
  def.w, def.h
);
canvasTex.refresh();
```

Phaser then has a standalone texture for this catalog ID.

### Step 4 — Sprite creation

```js
const sprite = this.scene.add.image(worldX, worldY, texKey);
sprite.setOrigin(0.5, 1);   // bottom-center
sprite.setDepth(depth);
```

`worldX/worldY` come from the template coordinates plus `(originX, originY)` offset.

### Step 5 — Y-Sorting (every frame)

In `update()`, when `_depthDirty` is true:

```
collect all renderable sprites (player, NPCs, furniture with y-sort enabled)
sort by sprite.y + sprite.height  (bottom edge)
assign depth = 10 + sortIndex
_depthDirty = false
```

Objects lower on screen (larger Y) get higher depth values and are drawn in front — giving natural isometric-style layering.

---

## The Pipeline: Raw Sheet → In-Game Object

```
 LimeZu PNG sheet
       │
       ▼
 sprite-cutter.html
 • Draw selection box (snaps to 32px grid)
 • Name the cut (e.g. "desk_pod")
 • Save to list → Export All JSON
       │
       ▼
 sprite_cuts.json (downloaded)
 • { "desk_pod": { sheet, x, y, w, h, origin, type, ... } }
       │
       ▼
 data/furniture_catalog_openplan.json
 • Paste under "objects": { ... }
 • Add action, theme, style fields as needed
       │
       ▼
 python scripts/build_master_catalog.py
 • Merges all furniture_catalog_*.json
 • Outputs data/master_furniture_catalog.json
       │
       ▼
 room-templates.json
 • Add placement: { "id": "desk_pod", "x": 300, "y": 200 }
       │
       ▼
 Phaser preload() → loads JSON + sheet PNG
 Phaser create()  → RoomAssembly.renderRoom()
                  → _ensureTexture() crops sheet
                  → add.image() places sprite
       │
       ▼
 Sprite visible in game, Y-sorted with other objects
```

---

## WebSocket and AI Brains

The server exposes three WebSocket endpoints:

| Path | Purpose |
|------|---------|
| `/agent-ws` | NPC conversation + CTO agent commands |
| `/security-ws` | Security monitor threat detection |
| Gateway WS | Proxied to OpenClaw port 18789 |

When the player clicks an NPC, the client sends:

```json
{ "type": "npc_conversation", "npcName": "Bob", "text": "What are you working on?" }
```

The server routes to `NpcBrainManager` which calls the relevant AI backend (Claude / Grok / Gemini / LM Studio) and sends back:

```json
{ "type": "npc_response", "npcName": "Bob", "text": "I'm researching database options." }
```

The `CofounderAgent` (CTO brain) thinks every 15–30 seconds and can issue batched commands:

```json
{ "type": "agent_commands", "commands": [
  { "action": "walkTo", "agentId": "Bob", "params": { "x": 400, "y": 200 } },
  { "action": "speakTo", "agentId": "Abby", "params": { "target": "Alex", "text": "Status?" } }
]}
```

See `ARCHITECTURE.md` for the full WebSocket protocol reference.
