# Denizen — Office Scene Navigation Map

> `office-scene.js` is the largest file in the project (3079 lines). This
> doc is a **map**, not a manual: it tells you what lives where so you
> can find the section you need without scrolling. Specific tuning notes
> live alongside the code in JSDoc.

The file defines one class: `OfficeScene extends Phaser.Scene`. It runs
in the browser. Every frame, every sprite, every input event flows
through it. The structure follows Phaser's three-phase lifecycle —
`preload()` to load assets, `create()` to build the world, `update()` to
react every tick.

## Top-level structure

```
office-scene.js
├── preload()                                     line 6
│   ├── Loading screen UI (HTML overlay)          line 7
│   └── Preload singles from master catalog       line 142
│
├── create()                                      line 180
│   ├── Tile layer setup (walls, floors, trim)    line 216–345
│   ├── Procedural interior demo (early exit)     line 346
│   ├── Room Assembly mode (alt path)             line 390–727
│   ├── Office layout (rooms + corridors)         line 828
│   ├── Player + NPC sprite registration          line 941
│   │     - Dolo (player) sheet                   line 941
│   │     - Dolo phone anims                      line 969
│   │     - Dolo sit anims                        line 992
│   │     - Robber sheet (same layout)            line 1037
│   │     - Player instantiation                  line 1063
│   │     - 16 NPC spawns                         line 1080
│   ├── Furniture catalog loader                  line 1169
│   ├── World clock + HUD                         line 1408
│   ├── Task model stubs                          line 1446
│   ├── OpenClaw Gateway bridge                   line 1450
│   ├── AgentOfficeManager wiring                 line 1470
│   ├── Player chat system                        line 1482
│   ├── Demo mode dispatcher (?demo=…)            line 1511–1529
│   ├── Pathfinding system                        line 1530
│   └── Security monitor + robber controller      line 1547
│
└── update(time, delta)                           line 1806
    ├── Depth sort (dirty-flag gated)             line 1818–1834
    ├── Player input + movement                   line 1900–
    ├── Sit prompt ('Press F' near chair)         line 2027
    ├── Talk prompt ('[Enter] Talk' near NPC)     line 2057
    └── NPC AI tick                               line 2078
```

## What each phase actually does

### `preload()` — line 6

Runs once before anything else. Loads sprite sheets, catalog JSON, and
shows a loading screen overlay (HTML, not Phaser, so it appears
instantly while Phaser is still booting). The bulk of the file isn't
here — most preloading is delegated to the universal furniture loader
(line 1169 inside `create()`) which reads the master catalog and
preloads only what the current layout needs.

### `create()` — line 180

This is where the office gets built. It runs once after `preload()` and
before the first `update()` tick.

The work happens in roughly this order:

1. **Tile layers** for walls, floors, wall trim. Three different paths
   coexist because the project supports three rendering modes:
   - Default: `office-layout.json` (hand-laid)
   - Procedural: early-exit at line 346 if the layout JSON requests it
   - Room Assembly: line 390 — uses `RoomAssembly.js` templates
2. **Sprite sheets** for the player (Dolo) and the 16 NPCs are
   registered with their per-character animation sets. Each NPC uses
   the same XP layout (4 directions × 4 frames idle + walk).
3. **Player + NPC instances** are added to the scene. Players get a
   physics body; NPCs get an `ai` block that the AgentOfficeManager
   later fills in.
4. **Furniture catalog** is loaded and every catalog entry that the
   current layout references gets instantiated as a sprite with the
   right anchor + depth.
5. **World clock + HUD** updater (line 1418) is a `setInterval` that
   advances the in-game clock and updates the on-screen time.
6. **AgentOfficeManager** (line 1470) is the bridge between the scene
   and `src/agent-office-manager.js`. After this, the cofounder + NPC
   brains can drive the world.
7. **Demo dispatcher** (line 1511) reads `?demo=…` from the URL and
   triggers `DemoScene.start()` (`?demo=investor`) or
   `DemoScene.startTour()` (`?demo=tour`).
8. **Pathfinding** (line 1530) bootstraps `NpcPathFollower` for every
   NPC.
9. **Security monitor** (line 1547) opens the `/security-ws`
   connection and wires the robber controller.

### `update(time, delta)` — line 1806

Runs every frame. The order matters:

1. **Depth sort** — only re-sorts when the dirty flag is set. The flag
   gets set by movement (player or NPC) and by some sit/stand
   transitions. Without the dirty flag, sorting all sprites every frame
   was the biggest CPU cost in the scene.
2. **Player input** — reads keys, updates velocity, sets the facing
   direction, sets the dirty flag if the player moved.
3. **Sit/talk prompts** — small contextual UI that appears when the
   player is next to an interactable.
4. **NPC AI tick** — for each NPC, asks `_pathFollower.tick()` to
   advance along its route, applies separation forces, plays the right
   walk/idle animation, sets the dirty flag if it moved.

## Cross-references

- **NPC brains** — see [AI-SYSTEM.md](AI-SYSTEM.md). `office-scene.js`
  doesn't make decisions; it executes the actions chosen by the brain.
- **Actions** — see [ACTIONS.md](ACTIONS.md). The `actions.speak()`,
  `actions.walkTo()`, etc. that the scene calls are defined in
  `src/agent-actions.js`.
- **Pathfinding** — see [PATHFINDING.md](PATHFINDING.md). The
  `NpcPathFollower` instances the scene wires up at line 1530 are the
  per-NPC route engines.
- **Cofounder** — `agent-office-manager.js` is the bridge. The scene
  owns sprites; the manager owns the LLM loop; they meet at
  `this._agentManager.actions.…`.
- **Voice / SFX** — `voice-gate.js`, `elevenlabs-provider.js`, `sfx.js`
  all listen on `window.__DenizenAgentWs` (the WebSocket the scene
  exposes via `agent-office-manager.js`). The scene itself is
  audio-agnostic.

## When to edit `office-scene.js`

- ✅ **Add a new sprite type** — register the sheet in `create()` near
  line 941 (player) or 1037 (robber), then instantiate in the relevant
  section.
- ✅ **Change layout** — edit `office-layout.json` (no code change). If
  you need new tile placement logic, it goes in the layout block around
  line 828.
- ✅ **Add a new HUD element** — line 1408 area.
- ❌ **Change NPC behaviour** — go to `src/npc-brains.js` instead. This
  scene only renders.
- ❌ **Change action semantics** — `src/agent-actions.js`.
- ❌ **Change pathfinding** — `src/pathfinding.js`.

The scene is intentionally large because Phaser scenes own a lot of
state. Splitting it would mean exposing internal sprite references
across module boundaries — every refactor attempt to date has made the
flow harder to follow. Better to navigate the long file with this map
than to fragment it.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — system-level topology
- [ACTIONS.md](ACTIONS.md) — what `actions.X()` calls do
- [PATHFINDING.md](PATHFINDING.md) — A* + stuck recovery
- [ROOM_GENERATOR.md](ROOM_GENERATOR.md) — alternate layout generator
