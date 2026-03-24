# Setup Guide

Complete setup instructions for the AI Office Game, including all AI provider configurations.

## Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** (included with Node.js)
- A web browser (Chrome, Firefox, Edge)

## Step 1: Install Dependencies

```bash
cd pixel-office-game
npm install
```

This installs the `ws` package (WebSocket library) — the only dependency.

## Step 2: Configure AI Providers

Create (or edit) the OpenClaw config file:

- **Windows:** `%USERPROFILE%\.openclaw\openclaw.json`
- **Mac/Linux:** `~/.openclaw/openclaw.json`

### Full Configuration Example

```json
{
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "sk-ant-api03-YOUR-KEY-HERE"
      },
      "google": {
        "apiKey": "AIzaSy-YOUR-KEY-HERE"
      },
      "xai": {
        "apiKey": "xai-YOUR-KEY-HERE"
      },
      "moonshot": {
        "apiKey": "sk-YOUR-KEY-HERE",
        "baseUrl": "https://api.moonshot.cn"
      }
    }
  }
}
```

### Which Providers Are Needed?

| Provider | NPCs Using It | Required? |
|----------|---------------|-----------|
| **Anthropic (Claude)** | Abby (CTO), Jenny (Developer), Lucy (Receptionist) + CTO brain + fallback for all | Highly recommended |
| **XAI (Grok)** | Alex (Developer) | Optional |
| **Google (Gemini)** | None by default | Optional |
| **Moonshot (Kimi)** | None by default | Optional |
| **LM Studio** | Bob (Researcher), Dan (IT Support) | No API key needed — just run LM Studio |

### Minimal Setup Options

**Option A: LM Studio only (free, local)**
- No config file needed
- Only Bob and Dan will respond; others use canned fallbacks
- Install [LM Studio](https://lmstudio.ai/), load a model, start server on port 1234

**Option B: Claude only**
- Set just the `anthropic` key in the config
- Abby, Jenny, Lucy respond via Claude; Alex falls back to Claude too
- Bob and Dan use canned responses (unless LM Studio is also running)

**Option C: Full setup**
- Set all provider keys + run LM Studio
- Every NPC responds with its designated AI provider

## Step 3: Set Up LM Studio (Optional)

1. Download [LM Studio](https://lmstudio.ai/) and install it
2. Open LM Studio and download a model:
   - Recommended: `dolphin3.0-llama3.1-8b` (or any chat model)
   - Smaller alternative: `phi-3-mini` for lower-end hardware
3. Click **Local Server** in LM Studio's sidebar
4. Load your model and click **Start Server**
5. Verify it's running: the server should be on `http://localhost:1234`

The game will automatically connect to LM Studio for Bob and Dan.

## Step 4: Start the Server

```bash
cd pixel-office-game
node server.js
```

You should see output like:

```
[SecurityMonitor] Starting security monitors...
[SecurityMonitor] All monitors active
[NpcBrains] Loaded providers: claude, gemini, grok, kimi, lmstudio
[NpcBrains] Abby (CTO) -> claude
[NpcBrains] Alex (Developer) -> grok
[NpcBrains] Bob (Researcher) -> lmstudio
[NpcBrains] Jenny (Developer) -> claude
[NpcBrains] Dan (IT Support) -> lmstudio
[NpcBrains] Lucy (Receptionist) -> claude
[CofounderAgent] API key loaded from OpenClaw config
Server running at http://localhost:8080
Security Monitor active — WebSocket at ws://localhost:8080/security-ws
Agent Office WebSocket at ws://localhost:8080/agent-ws
[CofounderAgent] Starting autonomous thinking loop
```

## Step 5: Open the Game

Navigate to **http://localhost:8080** in your browser.

You should see the pixel art office with NPCs walking around. If the CTO brain is connected (Anthropic key set), NPCs will start moving and interacting autonomously within 5-15 seconds.

## OpenClaw Gateway (Optional)

For full AI agent workflow visualization:

1. Install [OpenClaw](https://github.com/nichochar/openclaw)
2. Start the gateway on port 18789
3. The game auto-connects via `src/gateway-bridge.js`
4. Press `C` in-game to open the embedded chat panel

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP/WebSocket server port |

No other environment variables are used. All configuration is via `~/.openclaw/openclaw.json`.

## Network Ports

| Port | Service | Required? |
|------|---------|-----------|
| `8080` | Game server (HTTP + WebSocket) | Yes |
| `1234` | LM Studio local API | Only for Bob/Dan NPCs |
| `18789` | OpenClaw gateway | Only for full agent integration |
