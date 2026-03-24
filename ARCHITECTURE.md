# Architecture

Technical architecture of the AI Office Game — how the systems connect and communicate.

## System Overview

The game has four major subsystems:

1. **Game Client** (Phaser 3, browser) — rendering, player input, NPC animation
2. **Game Server** (Node.js) — static files, WebSocket routing, AI orchestration
3. **AI Backends** (external APIs + local) — Claude, Grok, Gemini, LM Studio
4. **OpenClaw Gateway** (optional) — full AI agent workflow engine

## Data Flow

```
                    ┌─────────────────────────────────────────┐
                    │           Game Server (port 8080)        │
                    │                                          │
                    │  ┌──────────────┐  ┌─────────────────┐  │
User clicks NPC ──> │  │ HTTP Server   │  │ CofounderAgent  │──│──> Anthropic API (Claude)
                    │  │ Static files  │  │ (CTO brain)     │  │
Browser ──────────> │  │ /openclaw/*   │  │ Thinks every    │  │
                    │  │ proxy         │  │ 15-30 seconds   │  │
                    │  └──────────────┘  └─────────────────┘  │
                    │                                          │
                    │  ┌──────────────┐  ┌─────────────────┐  │
  /agent-ws ──────> │  │ Agent WS     │  │ NpcBrainManager │──│──> Claude / Grok / Gemini
                    │  │ Server       │  │ (6 NPC brains)  │──│──> LM Studio (localhost:1234)
                    │  └──────────────┘  └─────────────────┘  │
                    │                                          │
                    │  ┌──────────────┐  ┌─────────────────┐  │
  /security-ws ──>  │  │ Security WS  │  │ SecurityMonitor │  │
                    │  │ Server       │  │ (threat detect) │  │
                    │  └──────────────┘  └─────────────────┘  │
                    │                                          │
                    │  ┌──────────────┐                        │
  Other WS ──────>  │  │ Gateway      │──────────────────────>│──> OpenClaw (port 18789)
                    │  │ WS Proxy     │                        │
                    │  └──────────────┘                        │
                    └─────────────────────────────────────────┘
```

## WebSocket Protocol

### /agent-ws — Agent Office Channel

**Client -> Server messages:**

```json
// NPC conversation request (player talks to an NPC)
{
  "type": "npc_conversation",
  "npcName": "Bob",
  "fromName": "Player",
  "text": "What are you working on?",
  "context": {}
}

// Office state update (periodic sync)
{
  "type": "office_state",
  "agents": [...],
  "furniture": [...],
  "tasks": [...],
  "time": "2024-01-01T00:00:00Z"
}

// CEO speaks to the CTO
{
  "type": "ceo_speak",
  "text": "Focus on the API project"
}

// Task completion notification
{
  "type": "task_complete",
  "taskId": "task-123"
}
```

**Server -> Client messages:**

```json
// NPC conversation response
{
  "type": "npc_response",
  "npcName": "Bob",
  "fromName": "Player",
  "text": "I'm researching database options."
}

// CTO command batch (from CofounderAgent)
{
  "type": "agent_commands",
  "commands": [
    { "action": "walkTo", "agentId": "Bob", "params": { "x": 400, "y": 200 } },
    { "action": "speakTo", "agentId": "Abby", "params": { "target": "Alex", "text": "Status?" } },
    { "action": "callMeeting", "agentId": "Abby", "params": { "attendees": ["Alex", "Bob"] } }
  ]
}
```

**Available CTO commands:**

| Action | Parameters | Effect |
|--------|-----------|--------|
| `walkTo` | `{ x, y }` | NPC walks to coordinates |
| `speakTo` | `{ target, text }` | NPC speaks to another NPC |
| `callMeeting` | `{ attendees }` | NPCs gather in meeting room |
| `assignTask` | `{ task, description }` | NPC starts working on a task |
| `returnToDesk` | none | NPC returns to assigned desk |

### /security-ws — Security Monitor Channel

**Server -> Client messages (broadcasts):**

```json
{
  "type": "threat",
  "category": "file_access",
  "severity": "high",
  "source": "192.168.1.100",
  "target": "/etc/passwd",
  "detail": "Sensitive file access attempt",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

```json
{
  "type": "threat_resolved",
  "category": "file_access",
  "timestamp": "2024-01-01T00:00:30.000Z"
}
```

**Severity levels:** `low`, `medium`, `high`, `critical`

## AI Provider Integration

### Request Flow

```
Player clicks NPC
       │
       ▼
Browser sends WebSocket message to /agent-ws
       │
       ▼
Server routes to NpcBrainManager.getResponse()
       │
       ▼
Look up NPC's provider (Claude/Grok/LM Studio/etc.)
       │
       ├── Anthropic: HTTPS POST to api.anthropic.com/v1/messages
       ├── Google: HTTPS POST to generativelanguage.googleapis.com
       ├── XAI: HTTPS POST to api.x.ai/v1/chat/completions
       ├── Moonshot: HTTPS POST to api.moonshot.cn/v1/chat/completions
       └── LM Studio: HTTP POST to localhost:1234/v1/chat/completions
       │
       ▼
Response sent back via WebSocket as npc_response
       │
       ▼
Browser shows speech bubble on NPC
```

### Provider API Formats

| Provider | API Format | Auth Method |
|----------|-----------|-------------|
| Anthropic (Claude) | Anthropic Messages API | `x-api-key` header |
| Google (Gemini) | Gemini GenerativeContent API | `key` query param |
| XAI (Grok) | OpenAI-compatible | `Bearer` token |
| Moonshot (Kimi) | OpenAI-compatible | `Bearer` token |
| LM Studio | OpenAI-compatible | `Bearer lm-studio` (dummy) |

### Fallback Chain

```
Primary Provider (assigned per NPC)
       │ fails
       ▼
Claude (Anthropic) as universal fallback
       │ fails
       ▼
Canned response ("I'm busy right now")
```

## Security Monitor Architecture

```
SecurityMonitorServer
       │
       ├── System Monitor (10s interval)
       │   ├── Windows: Event Log ID 4625 (failed logins)
       │   └── Linux: /var/log/auth.log parsing
       │
       ├── Network Monitor (5s interval)
       │   ├── netstat / ss
       │   └── Port scan detection (same IP, many ports)
       │
       ├── File Watcher (fs.watch)
       │   └── Watches for .env, .pem, .key, password files
       │
       ├── HTTP Request Checker (per-request)
       │   ├── SQL injection patterns
       │   ├── XSS patterns
       │   ├── Path traversal
       │   └── Suspicious user agents
       │
       └── Agent Event Checker
           └── Validates tool calls for dangerous operations
```

**Deduplication:** Same category + source within 5 seconds is suppressed.
**Auto-resolve:** Threats expire after 30 seconds if not re-triggered.

## Game Client Architecture

### Module Loading Order (index.html)

```
1. Phaser 3.80 (CDN)
2. ESM city/world modules (generator, renderer, debug, rng)
3. gateway-bridge.js        — OpenClaw WebSocket client
4. npc-agent-controller.js  — Event-to-NPC behavior mapping
5. openclaw-chat.js         — Embedded UI panel
6. pathfinding.js           — A* pathfinding
7. agent-actions.js         — Command executor
8. agent-office-manager.js  — Office workflow coordinator
9. security-monitor.js      — Threat dashboard (client-side)
10. robber-controller.js    — Optional robber NPC
11. office-scene.js         — Main Phaser scene (creates everything)
```

### Phaser Scene Lifecycle

```
office-scene.js
       │
       ├── preload()
       │   ├── Load tilesets (walls, floors, furniture)
       │   ├── Load character spritesheets (Dolo, NPCs)
       │   └── Load JSON catalogs
       │
       ├── create()
       │   ├── Build office floor and walls
       │   ├── Place furniture from catalog
       │   ├── Create player + NPCs
       │   ├── Initialize AgentOfficeManager (connects /agent-ws)
       │   ├── Initialize SecurityMonitor (connects /security-ws)
       │   ├── Initialize GatewayBridge (connects to OpenClaw)
       │   └── Set up keyboard input
       │
       └── update(time, delta)
           ├── Player movement
           ├── NPC pathfinding + animation
           ├── Speech bubble updates
           └── Camera follow
```

## File Structure

```
pixel-office-game/
├── server.js                    # Main server (HTTP + WebSocket)
├── security-monitor-server.js   # Threat detection engine
├── index.html                   # Game entry point
├── office-scene.js              # Main Phaser scene
├── package.json                 # Dependencies (ws)
│
├── src/
│   ├── cofounder-agent.js       # CTO AI brain (Claude, autonomous loop)
│   ├── npc-brains.js            # Multi-provider NPC personalities
│   ├── agent-office-manager.js  # Office workflow coordinator
│   ├── agent-actions.js         # Command executor
│   ├── npc-agent-controller.js  # Event-to-NPC behavior mapping
│   ├── gateway-bridge.js        # OpenClaw WebSocket client
│   ├── openclaw-chat.js         # Embedded chat UI panel
│   ├── security-monitor.js      # Client-side threat dashboard
│   ├── pathfinding.js           # A* pathfinding
│   ├── robber-controller.js     # Robber NPC visualization
│   ├── RoomAssembly.js          # Room layout system
│   ├── RoomBuilder.js           # Sprite rendering
│   └── city/                    # Procedural office generator (ESM)
│
├── data/
│   ├── furniture_catalog_openplan.json
│   ├── definitions.json
│   ├── sheet_registry.json
│   └── ... (25+ JSON catalogs)
│
├── assets/
│   ├── modern_office_singles_16/  # 350+ individual sprites
│   ├── Modern_Office_MV_*.png     # Tilesets
│   ├── Dolo.png                   # Player sprite
│   └── *.png                      # NPC sprites (Abby, Alex, etc.)
│
├── scripts/                     # Build/dev utilities
│
└── docs/                        # Additional documentation
    ├── SYSTEM_SUMMARY.md
    ├── ROOM_ASSEMBLY_GUIDE.md
    ├── ASSEMBLY.md
    └── ...
```
