# AI Office Game

A pixel art office simulation where AI-powered NPCs work autonomously in a virtual office. Each NPC has its own AI brain (Claude, Grok, Gemini, Kimi, or LM Studio), personality, and role. A CTO agent (Claude) directs the team in real-time, assigning tasks, calling meetings, and coordinating work — all visualized as a top-down RPG.

Built with **Phaser 3** using the [LimeZu Modern Office](https://limezu.itch.io/) asset pack.

![Game Preview](assets/ref_Hu4Gzs.png)

## Features

- **16 AI-powered NPCs** — each with a unique personality, role, and AI provider
- **Zero-config demo mode** — works out of the box without any API keys; NPCs use smart scripted responses
- **Autonomous CTO** — Claude-powered director that thinks every 15-30s and commands the team (falls back to demo loop if API unavailable)
- **Multi-provider AI** — NPCs use Claude, Grok, Gemini, Kimi, or LM Studio (local)
- **Player chat system** — press `Enter` to talk to NPCs; they walk over, respond, and execute tasks
- **A* pathfinding** — NPCs navigate around furniture using grid-based pathfinding with stuck detection
- **Security monitor** — live threat detection dashboard (file access, network scans, injection attempts)
- **Meeting system** — call meetings, NPCs walk to conference room, sit in chairs, discuss, return to work
- **OpenClaw integration** — connect to the OpenClaw gateway for full AI agent workflows

## Quick Start

### Prerequisites

- **Node.js** 18+
- **npm** (comes with Node.js)

### Install and Run

```bash
git clone https://github.com/Dolonia333/ai-office-game-.git
cd ai-office-game-
npm install
node server.js
```

Open **http://localhost:8080** in your browser.

> **Port conflict?** If port 8080 is in use, kill the process first:
> ```powershell
> # Windows PowerShell
> Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force
> node server.js
> ```

## Configuration

### API Keys

The game reads API keys from `~/.openclaw/openclaw.json` (or `%USERPROFILE%\.openclaw\openclaw.json` on Windows).

```json
{
  "models": {
    "providers": {
      "anthropic": { "apiKey": "sk-ant-api03-..." },
      "google": { "apiKey": "AIza..." },
      "xai": { "apiKey": "xai-..." },
      "moonshot": { "apiKey": "sk-...", "baseUrl": "https://api.moonshot.cn" }
    }
  }
}
```

### LM Studio (Local AI)

Bob (Researcher) and Dan (IT Support) use **LM Studio** by default — no API key needed.

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load a model (default expects `dolphin3.0-llama3.1-8b`)
3. Start the local server on port 1234 (LM Studio default)
4. The game connects automatically to `http://localhost:1234`

### NPC AI Provider Mapping

| NPC | Role | AI Provider | Model |
|-----|------|-------------|-------|
| **Abby** | CTO | Claude (Anthropic) | claude-3-haiku |
| **Alex** | Senior Developer | Grok (XAI) | grok-3-mini |
| **Bob** | Researcher | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Jenny** | Code Review | Claude (Anthropic) | claude-3-haiku |
| **Dan** | IT Support | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Lucy** | Receptionist | Claude (Anthropic) | claude-3-haiku |
| **Bouncer** | Security Guard | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Marcus** | Project Manager | Claude (Anthropic) | claude-3-haiku |
| **Sarah** | Product Manager | Claude (Anthropic) | claude-3-haiku |
| **Edward** | Backend Developer | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Josh** | Frontend Developer | Grok (XAI) | grok-3-mini |
| **Molly** | QA Engineer | Claude (Anthropic) | claude-3-haiku |
| **Oscar** | DevOps Engineer | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Pier** | Data Engineer | LM Studio (local) | dolphin3.0-llama3.1-8b |
| **Rob** | UI/UX Designer | Claude (Anthropic) | claude-3-haiku |
| **Roki** | Intern | Grok (XAI) | grok-3-mini |

> NPCs fall back to Claude if their primary provider fails, then to smart scripted responses if all providers fail.

### Zero-Config Demo Mode (No API Keys Needed)

The game works immediately after cloning — no API keys required. In demo mode:
- All 16 NPCs load and respond with context-aware scripted responses
- The CTO agent runs pre-scripted office behaviors (standups, code reviews, meetings)
- Smart fallback infers actions from player messages (e.g. "fix the bug" triggers coding behavior)
- If API keys are configured but fail (e.g. exhausted credits), the system auto-falls back to demo mode

## Controls

| Key | Action |
|-----|--------|
| `W` / `Arrow Up` | Move up |
| `A` / `Arrow Left` | Move left |
| `S` / `Arrow Down` | Move down |
| `D` / `Arrow Right` | Move right |
| `Enter` | Open chat — talk to NPCs (say their name or face them) |
| `Esc` | Close chat panel |
| `F` | Sit in nearby chair |
| `E` | Toggle furniture editor mode |
| `C` | Toggle OpenClaw chat panel |

### OpenClaw Panel

| Button | Action |
|--------|--------|
| **Sessions** | Browse, switch, or delete chat sessions |
| **+ New** | Start a new chat session |
| **Pop Out** | Open OpenClaw UI in a new browser tab |
| **x** | Close the panel |

## Architecture

```
Browser (Phaser 3)                    Server (Node.js :8080)              External
+---------------------+              +------------------------+          +-----------------+
| office-scene.js     |  /agent-ws   | CofounderAgent         |  HTTPS   | Anthropic API   |
| agent-office-mgr.js |<------------>| (Claude CTO brain)     |--------->| (Claude)        |
| npc-agent-ctrl.js   |              |                        |          +-----------------+
|                     | /security-ws | NpcBrainManager        |  HTTPS   | XAI API         |
| security-monitor.js |<------------>| (per-NPC AI brains)    |--------->| (Grok)          |
|                     |              |                        |          +-----------------+
| gateway-bridge.js   |  (proxy)     | SecurityMonitorServer  |  HTTP    | LM Studio       |
| openclaw-chat.js    |<------------>| (threat detection)     |--------->| (localhost:1234) |
+---------------------+              |                        |          +-----------------+
                                      | Static file server     |
                                      | /openclaw/* proxy      |--------->| OpenClaw GW     |
                                      +------------------------+          | (localhost:18789)|
                                                                          +-----------------+
```

### WebSocket Endpoints

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `ws://localhost:8080/agent-ws` | JSON messages | CTO commands, NPC conversations, office state updates |
| `ws://localhost:8080/security-ws` | JSON events | Real-time security threat broadcasts |
| `ws://localhost:8080/*` (other) | Proxy | Forwarded to OpenClaw gateway at `localhost:18789` |

### Key Source Files

| File | Purpose |
|------|---------|
| `server.js` | HTTP server, WebSocket routing, OpenClaw proxy, security monitoring |
| `office-scene.js` | Main Phaser 3 scene — rendering, NPCs, player, furniture, walls |
| `src/cofounder-agent.js` | CTO AI brain — autonomous thinking loop, command generation |
| `src/npc-brains.js` | Multi-provider NPC brains — loads soul files, manages memory |
| `npcs/*/SOUL.md` | NPC identity files — personality, values, provider, role |
| `npcs/*/MEMORY.md` | NPC persistent memory — conversations saved across sessions |
| `src/agent-office-manager.js` | Coordinates AI agents, manages office workflow |
| `src/agent-actions.js` | Command executor for agent tasks |
| `src/npc-agent-controller.js` | Maps agent events to NPC behaviors (walk, sit, speak) |
| `src/gateway-bridge.js` | WebSocket client connecting to OpenClaw gateway (protocol v3) |
| `src/openclaw-chat.js` | Embedded OpenClaw UI panel (iframe, session management) |
| `src/security-monitor.js` | Client-side security dashboard (receives threats from server) |
| `security-monitor-server.js` | Server-side threat detection (file, network, API, system) |
| `src/player-chat.js` | CEO-to-NPC chat system (targeting, walk-over, delegation) |
| `src/demo-scene.js` | Investor demo cutscene (20-second scripted sequence) |
| `src/pathfinding.js` | A* pathfinding for NPC movement |
| `src/robber-controller.js` | Optional robber NPC visualization |
| `src/RoomAssembly.js` | Phaser integration for room layouts — catalog lookup, texture cropping, Y-sort |
| `src/RoomBuilder.js` | Low-level sprite rendering with modular group validation |
| `data/sheet_registry.json` | Canonical map of sheet IDs → file paths + grid sizes |
| `data/master_furniture_catalog.json` | Auto-generated merge of all furniture_catalog_*.json files |
| `index.html` | Entry point — loads Phaser 3.80 + all game scripts |

### Data Files

| File | Purpose |
|------|---------|
| `data/furniture_catalog_openplan.json` | Furniture definitions and placement coordinates |
| `data/definitions.json` | Object definitions (desks, chairs, monitors, plants, etc.) |
| `data/sheet_registry.json` | Sprite sheet registry for tilesets |
| `assets-catalog.json` | Asset catalog for the sprite system |

## AI Systems

### Cofounder Agent (CTO Brain)

The `CofounderAgent` is an autonomous AI director powered by Claude that:

1. **Thinks every 15-30 seconds** — evaluates office state and decides next actions
2. **Generates commands** — sends JSON command arrays to control NPCs:
   ```json
   [
     { "action": "speakTo", "agentId": "Abby", "params": { "target": "Alex", "text": "How is the API?" } },
     { "action": "walkTo", "agentId": "Bob", "params": { "x": 400, "y": 200 } },
     { "action": "callMeeting", "agentId": "Abby", "params": { "attendees": ["Alex", "Bob"] } }
   ]
   ```
3. **Responds to the player** — type messages as the CEO and the CTO will react
4. **Maintains conversation history** — up to 20 messages for context

### NPC Soul Files (OpenClaw Architecture)

Each NPC's identity is defined in plain markdown files — following the [OpenClaw](https://github.com/nichochar/openclaw) "soul file" pattern pioneered by Erik Steinberger. Instead of hardcoding personalities into the code, each NPC **reads itself into existence** from `.md` files at startup.

```
npcs/
  abby/
    SOUL.md      # Who she is — personality, values, tone, boundaries
    MEMORY.md    # What she remembers — persists across sessions
  alex/
    SOUL.md
    MEMORY.md
  bob/ jenny/ dan/ lucy/ bouncer/ marcus/ sarah/
  edward/ josh/ molly/ oscar/ pier/ rob/ roki/
    ...
```

**Why this matters:**

- **Edit a file, change who the NPC is.** No code changes needed. Open `npcs/abby/SOUL.md` in any text editor, change her personality, restart — she's different.
- **Portable.** Copy the `npcs/` folder to any machine, the characters exist there instantly.
- **Version controllable.** Git tracks how each NPC's identity evolves over time.
- **Model agnostic.** The same soul files work with Claude, Grok, Gemini, LM Studio — any LLM that can read text.
- **Local-first.** Your NPC data never leaves your machine unless you push it.

**How it works:**

1. `NpcBrainManager` (in `src/npc-brains.js`) reads each NPC's `SOUL.md` at startup
2. The full markdown content becomes the NPC's system prompt — the AI reads the soul and embodies it
3. `## Provider` and `## Role` sections are parsed to determine which AI backend powers the NPC
4. `MEMORY.md` is appended to the system prompt so the NPC remembers past conversations
5. After significant conversations, memories are automatically written back to `MEMORY.md`

**The soul file IS the NPC.** The AI model doesn't change. But the NPC has persistent identity, consistent personality, and long-term memory — all from plain text files.

### NPC Brains (Runtime)

Each NPC has an individual AI brain managed by `src/npc-brains.js`:

- **Soul-driven prompts** — personality loaded from `SOUL.md`, not hardcoded
- **Persistent memory** — conversations saved to `MEMORY.md`, survives restarts
- **Conversation context** — each NPC remembers recent interactions (up to 20 messages per session)
- **Multi-provider support** — different NPCs can use different AI backends
- **Fallback chain** — Primary provider -> Claude -> Smart scripted fallback (infers actions from message context)

### Meeting System

NPCs use the **conference room** for group discussions and smaller desk areas for 1-on-1s:

- **`callMeeting`** — CTO (or anyone) calls a meeting with specified attendees. All walk to the conference room and sit at spread-out chairs.
- **`joinMeeting`** — Single NPC joins an existing meeting. Chair assignment maximizes distance from occupied seats.
- **Staggered speech** — When multiple NPCs speak in the same area, conversations are queued with 3.5s delays so speech bubbles don't overlap.
- **Meeting flow:** Announce -> Attendees walk -> Sit -> Discussion (speakTo exchanges) -> Stand up -> Return to work

### Security Monitor

The `SecurityMonitorServer` provides real-time threat detection:

| Threat Category | What It Detects |
|----------------|-----------------|
| `brute_force` | Failed login attempts (Windows Event Log / auth.log) |
| `file_access` | Access to sensitive files (.env, .pem, .key, passwords) |
| `network_scan` | Port scanning patterns (same IP, many connections) |
| `shell_exec` | Dangerous shell command execution |
| `api_abuse` | API rate limit violations |
| `process_spawn` | Suspicious process creation |
| `data_breach` | Data exfiltration attempts |

Test it: `http://localhost:8080/security-test?type=file_access&severity=high&detail=Test+threat`

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

## OpenClaw Integration

For full AI agent workflows (not just NPC conversations), connect to an [OpenClaw](https://github.com/nichochar/openclaw) gateway:

1. Install and start OpenClaw on port 18789
2. Start the game server: `node server.js`
3. Open `http://localhost:8080`
4. The game automatically connects via `src/gateway-bridge.js`
5. Press `C` to open the embedded chat panel
6. Send messages — watch NPCs react to agent activity

The server proxies `/openclaw/*` requests to the gateway, stripping iframe-blocking headers.

## Character Sprites

The player character uses `Dolo.png` — a 768x64 sprite sheet generated with [Character Generator 2.0](https://www.graymatterstudios.net/) (LimeZu-compatible).

- **Frame size:** 32x64 pixels
- **24 frames:** 6 per direction (RIGHT, UP, LEFT, DOWN)
- **Idle frame:** 3rd pose (index 2) of each direction group
- **Walk animation:** All 6 frames per direction at 10fps

All 16 NPCs use individual XP-style character sheets at 32x48 per frame (4x4 grid: 4 directions, 4 frames each).

## Office Furniture System

Furniture is placed using a catalog-driven system:

- **Object definitions** in `data/definitions.json` define sprite sources, sizes, and types
- **Placement catalog** in `data/furniture_catalog_openplan.json` defines positions and room assignments
- **Sprite sources:** Individual PNG files from the LimeZu Modern Office pack (`assets/modern_office_singles_16/`)
- **Tilesets:** Wall and floor tiles from the MV tileset PNGs

## Asset Pack

Uses the [LimeZu Modern Office Revamped](https://limezu.itch.io/) asset pack. All required assets are bundled in the `assets/` directory:

- `assets/Walls_TILESET_A4.png` — Wall tiles
- `assets/Floors_TILESET_A2.png` — Floor tiles
- `assets/Modern_Office_Black_Shadow_32x32.png` — Main furniture spritesheet
- `assets/Room_Builder_Office_32x32.png` — Floor and wall builder tiles
- `assets/modern_office_singles_16/*.png` — Individual furniture sprites (350+ items)
- `assets/*.png` — Player character (Dolo) + 16 NPC character sheets

## Development Tools

All tools are browser-based — open them at `http://localhost:8080/<tool>.html` while the server is running. See [TOOLS_GUIDE.md](TOOLS_GUIDE.md) for step-by-step instructions on every tool.

| Tool | Purpose |
|------|---------|
| `sprite-cutter.html` | **Main pipeline tool** — load a sheet PNG, draw a snap-to-32px selection, name it, save to list, export catalog JSON |
| `catalog-explorer.html` | Browse all catalog files, schemas, pipeline diagram, and auto-detected issues |
| `asset-browser.html` | Thumbnail grid of every LimeZu asset pack — find sprites visually |
| `tile-labeler.html` | Label individual floor/wall tiles in MV A2/A4/BCDE tilesets |
| `sprite-labeler.html` | Review and fix object ID assignments on character/NPC sprites |
| `singles-viewer.html` | Browse pre-sliced single-sprite PNGs (IDs 1–339) by ID or filename |
| `verify-sprites.html` | Render every catalog entry live — confirms crops and coordinates |

### Sprite → Catalog Pipeline

```
Find sprite (Asset Browser)
  → Cut it (Sprite Cutter: load PNG, drag selection, name, save)
  → Export JSON (Sprite Cutter: Export All JSON → sprite_cuts.json)
  → Paste into data/furniture_catalog_openplan.json
  → Verify (verify-sprites.html)
  → Rebuild master: python scripts/build_master_catalog.py
  → Place in game via room-templates.json
```

## Troubleshooting

### Server won't start (EADDRINUSE)

Port 8080 is already in use. Kill the existing process:

```powershell
# Windows
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force
node server.js
```

```bash
# Linux/Mac
kill $(lsof -t -i:8080)
node server.js
```

### WebSocket errors (404 on /agent-ws or /security-ws)

Make sure you're running the server from the project directory:

```bash
cd ai-office-game-
node server.js
```

### NPCs don't respond / blank speech bubbles

- Check that API keys are set in `~/.openclaw/openclaw.json`
- For LM Studio NPCs (Bob, Dan): ensure LM Studio is running with a model on port 1234
- Check the terminal for `[NpcBrains]` error messages

### Game shows black screen

- Hard refresh the browser (`Ctrl+Shift+R`)
- Check browser console for JavaScript errors
- Ensure the server is running (check terminal output)

### OpenClaw chat panel doesn't load

- OpenClaw gateway must be running on `localhost:18789`
- The server proxies `/openclaw/*` — check terminal for proxy errors

## Related Documentation

| Document | Contents |
|----------|----------|
| [TOOLS_GUIDE.md](TOOLS_GUIDE.md) | **All browser tools** — step-by-step usage for Sprite Cutter, Catalog Explorer, Asset Browser, and every other dev tool |
| [ENGINE_AND_SPRITES.md](ENGINE_AND_SPRITES.md) | **How it all works** — Phaser scene lifecycle, sprite sheet formats, catalog schema, how a JSON entry becomes a game sprite |
| [SYSTEM_SUMMARY.md](SYSTEM_SUMMARY.md) | Room Assembly system — sprite inventory, validation, templates |
| [ROOM_ASSEMBLY_GUIDE.md](ROOM_ASSEMBLY_GUIDE.md) | Implementation guide for room layouts |
| [ASSEMBLY.md](ASSEMBLY.md) | Sprite assembly blueprint (16px grid rules, pivot points) |
| [HOW_OBJECTS_ARE_BUILT.md](HOW_OBJECTS_ARE_BUILT.md) | Tile/sprite structure by engine (MV, VX Ace, XP) |
| [CATALOG_OVERVIEW.md](CATALOG_OVERVIEW.md) | Asset pack contents (LimeZu Modern Office) |
| [CATALOG_CONVENTIONS.md](CATALOG_CONVENTIONS.md) | Catalog field reference — type vocabulary, anchors, interact_distance |

## License

Game code: MIT

Art assets: [LimeZu Modern Office](https://limezu.itch.io/) — see their license terms.
Character sprites: Generated with [Character Generator 2.0](https://www.graymatterstudios.net/).
