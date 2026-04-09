# Contributing to Dolonia (AI Office Game)

Thanks for your interest in contributing! This guide will help you get set up and understand how we work.

## Getting Started

```bash
git clone https://github.com/Dolonia333/ai-office-game-.git
cd ai-office-game-
npm install
npm start
```

The game runs at `http://localhost:8080`. No API keys needed — it falls back to demo mode automatically.

## Project Structure

```
pixel-office-game/
├── server.js              # HTTP + WebSocket server
├── office-scene.js        # Main Phaser 3 game scene (client)
├── index.html             # Entry point
├── src/
│   ├── npc-brains.js      # Multi-provider AI for NPC responses
│   ├── cofounder-agent.js  # Autonomous CTO agent loop
│   ├── agent-office-manager.js  # NPC coordination + meetings
│   ├── agent-actions.js    # NPC action queue (walk, sit, speak, etc.)
│   ├── pathfinding.js      # A* grid pathfinding
│   └── player-chat.js      # CEO-to-NPC chat UI (client)
├── npcs/                   # 16 NPC personality files (SOUL.md + MEMORY.md)
├── assets/                 # Sprites, tilesets, character sheets
└── security-monitor-server.js  # HTTP threat detection
```

## Branch Naming

Use these prefixes so it's clear what a branch does:

| Prefix | Use for | Example |
|--------|---------|---------|
| `fix/` | Bug fixes | `fix/chair-depth-restore` |
| `feat/` | New features | `feat/audio-system` |
| `perf/` | Performance work | `perf/y-sort-dirty-flag` |
| `docs/` | Documentation | `docs/setup-guide` |
| `test/` | Adding tests | `test/pathfinding-unit` |
| `infra/` | Deployment/tooling | `infra/dockerfile` |

## Workflow

1. **Pick an issue** — Check [open issues](https://github.com/Dolonia333/ai-office-game-/issues) for something to work on. Issues labeled `good first issue` are great starting points.

2. **Create a branch** from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b fix/your-description
   ```

3. **Make your changes** — Keep commits focused. One logical change per commit.

4. **Test locally** — Run the server, open the game, verify your change works. Check the browser console for errors.

5. **Open a PR** — Reference the issue number in your PR description (e.g., "Fixes #5"). Describe what you changed and why.

## Commit Messages

Write commit messages that explain **why**, not just what:

```
# Good
Fix NPC depth restore after sitting — origDepth was saved after modification

# Bad  
Update agent-actions.js
```

## Code Style

- No framework or bundler — vanilla JS, Phaser 3 on the client, Node.js on the server
- Use `const`/`let`, never `var`
- Prefix private methods/properties with `_`
- Server-side files use `require()` (CommonJS)
- Client-side files are loaded via `<script>` tags

## AI Provider Setup (Optional)

The game works without any API keys (demo mode). To enable real AI responses:

- **Claude**: Set `ANTHROPIC_API_KEY` env var
- **Gemini**: Set `GEMINI_API_KEY` env var  
- **Grok**: Set `XAI_API_KEY` env var
- **Kimi**: Set `KIMI_API_KEY` env var
- **LM Studio**: Run locally on default port

## Questions?

Open an issue or check the existing ones for context on ongoing work.
