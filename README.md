# AI Office Game

A pixel art office game that visualizes AI agent workflows as an RPG. Watch your AI agents work like office employees — walking to desks, typing, researching, and collaborating — all driven by real AI activity from [OpenClaw](https://github.com/nichochar/openclaw).

Built with **Phaser 3** using the [LimeZu Modern Office](https://limezu.itch.io/) asset pack.

![Game Preview](assets/ref_Hu4Gzs.png)

## What It Does

- **NPCs represent AI agents** — each NPC is bound to an AI agent running in OpenClaw
- **Real-time visualization** — when an agent starts a task, its NPC walks to a desk; when it finishes, it returns to the breakroom
- **Speech bubbles** — NPCs show what the agent is doing (writing text, using tools, errors)
- **Embedded OpenClaw UI** — press `C` to open the full OpenClaw chat panel inside the game
- **Multiple sessions** — create, switch, and manage chat sessions from within the game

## Architecture

```
+------------------+       WebSocket        +------------------+
|   Pixel Office   | <-------------------->  |  OpenClaw Gateway |
|   (Phaser 3)     |    port 18789          |  (Node.js)       |
|                  |                         |                  |
|  - office-scene  |    HTTP + WS Proxy      |  - AI Agents     |
|  - NPC controller| <-- server.js:8080 -->  |  - Skills        |
|  - Gateway bridge|                         |  - Channels      |
|  - Chat panel    |                         |  - Cron jobs     |
+------------------+                         +------------------+
```

### Key Files

| File | Purpose |
|------|---------|
| `office-scene.js` | Main Phaser scene — office rendering, NPCs, player, furniture, walls |
| `server.js` | Game server with HTTP + WebSocket reverse proxy to OpenClaw |
| `src/gateway-bridge.js` | WebSocket client connecting to OpenClaw gateway (protocol v3) |
| `src/npc-agent-controller.js` | Maps agent events to NPC behaviors (walk, sit, speech bubbles) |
| `src/openclaw-chat.js` | Embedded OpenClaw UI panel with session management |
| `index.html` | Entry point, loads Phaser 3.80 + all game scripts |

### Data Files

| File | Purpose |
|------|---------|
| `data/furniture_catalog_openplan.json` | Furniture definitions and placement coordinates |
| `data/definitions.json` | Object definitions (desks, chairs, monitors, plants, etc.) |
| `data/sheet_registry.json` | Sprite sheet registry for tilesets |
| `assets-catalog.json` | Asset catalog for the sprite system |

## Setup

### Prerequisites

- **Node.js** 18+
- **OpenClaw** running on `ws://localhost:18789` (optional — game works without it, just no AI integration)

### Quick Start

```bash
# Clone the repo
git clone https://github.com/Dolonia333/ai-office-game-.git
cd ai-office-game-

# Start the game server
node server.js

# Open in browser
# http://localhost:8080
```

### With OpenClaw Integration

1. Install and start [OpenClaw](https://github.com/nichochar/openclaw) on port 18789
2. Start the game server: `node server.js`
3. Open `http://localhost:8080`
4. The game automatically connects to the gateway
5. Press `C` to open the OpenClaw chat panel
6. Send messages — watch NPCs react to agent activity

## Controls

| Key | Action |
|-----|--------|
| `W` / `Arrow Up` | Move up |
| `A` / `Arrow Left` | Move left |
| `S` / `Arrow Down` | Move down |
| `D` / `Arrow Right` | Move right |
| `C` | Toggle OpenClaw chat panel |

### OpenClaw Panel Buttons

| Button | Action |
|--------|--------|
| **Sessions** | Toggle session list overlay — browse, switch, delete conversations |
| **+ New** | Start a new chat session |
| **Pop Out** | Open OpenClaw UI in a new browser tab |
| **x** | Close the panel |

## How Agent-NPC Mapping Works

The `NpcAgentController` listens for gateway events and drives NPC behavior:

| Agent Event | NPC Behavior |
|------------|--------------|
| Agent starts a task | NPC walks to a desk, shows "Working..." |
| Agent writes text | NPC sits at desk, speech bubble shows text |
| Agent uses a tool | NPC at desk, bubble shows tool name |
| Agent finishes | NPC walks back to breakroom, shows "Done!" |
| Agent errors | NPC shows "Error!", returns to idle after 3s |
| Chat streaming | NPC shows "Typing..." |

### State-to-Area Mapping

| Agent State | Office Area |
|------------|-------------|
| `idle` | Breakroom (bottom-left) |
| `writing` | Desk (main office) |
| `researching` | Desk |
| `executing` | Desk |
| `syncing` | Desk |
| `error` | Desk |

## Server Architecture

The game server (`server.js`) serves three roles:

1. **Static file server** — serves the game files on port 8080
2. **HTTP reverse proxy** — proxies `/openclaw/*` to the OpenClaw gateway, stripping `X-Frame-Options` and `Content-Security-Policy` headers so the UI works in an iframe
3. **WebSocket proxy** — forwards WebSocket upgrade requests to the gateway so the embedded UI's real-time features work

## Character Sprites

The player character uses `Dolo.png` — a 768x64 sprite sheet generated with [Character Generator 2.0](https://www.graymatterstudios.net/) (LimeZu-compatible).

- **Frame size:** 32x64 pixels
- **24 frames:** 6 per direction (RIGHT, UP, LEFT, DOWN)
- **Idle frame:** 3rd pose (index 2) of each direction group
- **Walk animation:** All 6 frames per direction at 10fps

NPCs use `dolonia.png` with the same frame layout.

## Office Furniture System

Furniture is placed using a catalog-driven system:

- **Object definitions** in `data/definitions.json` define sprite sources, sizes, and types
- **Placement catalog** in `data/furniture_catalog_openplan.json` defines positions and room assignments
- **Sprite sources:** Individual PNG files from the LimeZu Modern Office pack (`assets/modern_office_singles_16/`)
- **Tilesets:** Wall and floor tiles from the MV tileset PNGs

## Asset Pack

Uses the [LimeZu Modern Office Revamped](https://limezu.itch.io/) asset pack (not included — purchase separately):

- `Modern_Office_MV_Walls_TILESET_A4.png` — Wall tiles
- `Modern_Office_MV_Floors_TILESET_A2.png` — Floor tiles
- `Modern_Office_MV_2_TILESETS_B-C-D-E.png` — Furniture tileset
- `Modern_Office_MV_3_TILESETS_B-C-D-E.png` — Additional furniture
- `modern_office_singles_16/*.png` — Individual furniture sprites (350+ items)

## Tools

The repo includes several development tools:

| Tool | Purpose |
|------|---------|
| `asset-browser.html` | Browse and search all sprites in the asset catalog |
| `catalog-explorer.html` | Explore furniture catalog with visual previews |
| `singles-viewer.html` | View individual sprite files with metadata |
| `sprite-cutter.html` | Cut sprites from tilesheets |
| `sprite-labeler.html` | Label and categorize sprites |
| `tile-labeler.html` | Label tile types |
| `verify-sprites.html` | Verify sprite rendering |

## License

Game code: MIT

Art assets: [LimeZu Modern Office](https://limezu.itch.io/) — see their license terms.
Character sprites: Generated with [Character Generator 2.0](https://www.graymatterstudios.net/).
