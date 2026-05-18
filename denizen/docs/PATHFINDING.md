# Denizen — Pathfinding

> A* on a grid + per-NPC route follower + stuck recovery. Three classes
> in 623 lines.

Source: [`src/pathfinding.js`](../src/pathfinding.js).

## The three classes

| Class | Responsibility | Lifetime |
|---|---|---|
| `OfficePathfinder` | Owns the walkability grid; runs A* searches | One per scene |
| `NpcPathFollower` | Per-NPC route advance; stuck detection; replanning | One per NPC |
| `MinHeap` | Priority queue used inside A* | Internal |

## OfficePathfinder

A flat `Uint8Array` representing the office floor at `cellSize`-pixel
resolution (default 8 px → 1280×720 world becomes 160×90 = 14,400 cells).
Cells are 0 (walkable) or 1 (blocked).

Plus a parallel `Float32Array` of "soft costs" added to A*'s g-score for
cells adjacent to obstacles. Without this, NPCs hug walls and snake
through corners; with it, they prefer open hallways.

### Building the grid

```js
const pf = new OfficePathfinder(scene.worldW, scene.worldH, 8);
pf.buildFromScene(scene);   // reads scene._obstacles + scene._npcs
```

What gets blocked:

1. World edges (2-cell border around the perimeter).
2. Every entry in `scene._obstacles` (walls, furniture with collision
   boxes). Each obstacle's bounding rect inflates the blocked region by
   1 cell on every side so NPCs don't clip corners.
3. Soft-cost halo: every cell within 2 of a blocked cell gets a
   penalty added so A* avoids hugging walls.

`buildFromScene()` is called once at scene start. If the layout changes
at runtime (you move a desk via the editor), call it again — it's fast
(~5 ms on a typical office).

### A* search

```js
const path = pathfinder.findPath(startX, startY, endX, endY);
// → [{x:120, y:50}, {x:120, y:60}, …] in world pixels
// or null if no route exists
```

- Heuristic: octile distance (because we allow diagonals).
- Tiebreaker: prefers paths with lower soft-cost (open hallways).
- Bails after 8000 explored nodes — on a 14,400-cell grid, anything
  larger than that is almost always a "blocked-off room" misconfiguration
  and exiting fast beats spinning.

The output is **world coordinates**, not grid coordinates. The caller
doesn't need to know the cell size.

## NpcPathFollower

The bridge between A* and the per-frame `update()` tick.

```js
const follower = new NpcPathFollower(npc, pathfinder, scene);
follower.navigateTo(targetX, targetY);
// later, every frame:
follower.tick(delta);
```

State the follower owns per NPC:

- `_waypoints` — the current A* path, popped from the front as the NPC
  advances.
- `_stuckCount` — how many consecutive ticks the NPC has had near-zero
  velocity while supposedly moving. Reset on every successful step.
- `_lastReplanAt` — timestamp; replans throttled to no more than once
  per 600 ms.

### Stuck recovery

The signature failure mode of grid-based NPC movement is "agent gets
wedged against a corner and oscillates." The follower handles this in
three escalating steps:

1. **Soft nudge** — at `_stuckCount === 1`, perpendicular impulse
   based on the NPC's facing direction. Often enough to slip past
   another NPC blocking the way.
2. **Replan from current position** — at `_stuckCount === 2`, throw
   away the current waypoints, run A* again from where the NPC actually
   is. Handles cases where the world changed under the NPC.
3. **Teleport to next waypoint** — at `_stuckCount >= 3`, just put the
   NPC at the next waypoint. Last resort, but visible-glitch beats
   permanent freeze.

`_stuckCount` is initialized to `0` in the constructor. (One of the
audit fixes in commit `fcdd397` — earlier code only set it inside
`tick()`, which left it `undefined` for the first stuck frame and
`undefined + 1 === NaN` broke the comparison.)

### Separation force

Inside `tick()`, the follower applies a small repulsive force away from
any other NPC within ~24 px. Without it, two NPCs targeting nearby
chairs end up squashed into the same cell. The force is intentionally
weak — strong enough to break ties, not strong enough to shove an NPC
off-route.

## MinHeap

Stock binary min-heap, keyed on the A* `f`-score. Used because
`Array.sort()` on every node insertion would be the dominant cost on
the 8000-node search budget.

## Tuning knobs

| Knob | Default | What it controls |
|---|---|---|
| `cellSize` (constructor) | 8 px | Grid resolution. Smaller = better paths, more memory. |
| `softCost` halo radius | 2 cells | How wide a "stay away from walls" zone surrounds each obstacle. |
| `pathfinder._maxExplored` | 8000 | Hard cap on A* nodes per search. |
| `follower._stuckThreshold` | 3 | Ticks before teleport. |
| `follower._replanCooldownMs` | 600 | Floor on replan frequency. |
| Separation radius | 24 px | NPCs closer than this push each other. |

All live in the file as plain constants — change in place, no config.

## Testing

[`tests/pathfinding.test.js`](../tests/pathfinding.test.js) covers:

- A* on an empty grid finds a straight line
- Blocked grid returns `null`
- Unreachable destinations return `null`
- World↔grid coordinate conversion round-trips
- `_stuckCount` initializes to 0 (regression guard for fcdd397)
- `navigateTo` populates waypoints when a path exists
- `navigateTo` returns false when no path exists

The test boots only `OfficePathfinder` + `NpcPathFollower` — no Phaser
scene. The grid is constructed manually with `pf.grid[idx] = 1` on
specific cells.

## Cross-references

- [SCENE.md](SCENE.md) — where the follower's `tick()` is called from
- [ACTIONS.md](ACTIONS.md) — `walkTo` and friends are thin wrappers
  around `follower.navigateTo()`
- [WORLD-STATE.md](WORLD-STATE.md) — NPC positions get mirrored from
  here into `worldState.npcs[name].position`
