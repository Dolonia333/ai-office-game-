/**
 * Pathfinding System for Pixel Office Game
 * Builds a walkability grid from the scene's obstacles and uses A* to navigate NPCs.
 */

class OfficePathfinder {
  /**
   * @param {number} worldW - World width in pixels
   * @param {number} worldH - World height in pixels
   * @param {number} cellSize - Grid cell size in pixels (default 8 for finer navigation)
   */
  constructor(worldW, worldH, cellSize = 8) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldW / cellSize);
    this.rows = Math.ceil(worldH / cellSize);

    // Grid: 0 = walkable, 1 = blocked
    this.grid = new Uint8Array(this.cols * this.rows);
    // Soft-cost layer — added to A* g-score for cells adjacent to obstacles.
    // Encourages paths through open space instead of hugging walls/corners.
    this.softCost = new Float32Array(this.cols * this.rows);
  }

  /**
   * Build the walkability grid from the scene's obstacles, walls, and furniture.
   * Call this once after all walls/furniture are placed, or when layout changes.
   * @param {object} scene - The Phaser scene (OfficeScene)
   */
  buildFromScene(scene) {
    // Reset grid — everything walkable
    this.grid.fill(0);
    if (this.softCost) this.softCost.fill(0);

    const cs = this.cellSize;

    // Block world edges (2-cell border)
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        if (x < 2 || x >= this.cols - 2 || y < 2 || y >= this.rows - 2) {
          this.grid[y * this.cols + x] = 1;
        }
      }
    }

    // Block all obstacle rectangles (walls, furniture collision boxes)
    if (Array.isArray(scene._obstacles)) {
      scene._obstacles.forEach(obs => {
        if (!obs || !obs.body) return;
        const bx = obs.body.x || obs.x;
        const by = obs.body.y || obs.y;
        const bw = obs.body.width || obs.displayWidth || 32;
        const bh = obs.body.height || obs.displayHeight || 32;
        this._blockRect(bx, by, bw, bh);
      });
    }

    // Block large furniture sprites that aren't in _obstacles but should still be avoided
    if (Array.isArray(scene._interactables)) {
      scene._interactables.forEach(item => {
        if (!item.sprite || !item.def) return;
        // Only block desks and large furniture (not seats/decor — NPCs need to reach those)
        const type = item.def.type;
        if (type === 'seat' || type === 'decor') return;
        const s = item.sprite;
        const w = s.displayWidth;
        const h = Math.min(s.displayHeight * 0.4, 24); // Only block bottom portion
        const x = s.x - w / 2;
        const y = s.y - h; // bottom-anchored
        if (w > 20) {
          this._blockRect(x, y, w, h);
        }
      });
    }

    // Compute soft-cost halo — cells adjacent to blocked get a small penalty
    // so A* prefers open-space routes instead of corner-hugging.
    this._computeSoftCost();

    console.log(`[Pathfinder] Grid built: ${this.cols}x${this.rows} (${cs}px cells), ${this._countBlocked()} blocked cells`);
  }

  /**
   * Compute per-cell soft-cost penalty based on distance to nearest blocked cell.
   * Cells one step from a wall get +0.6, two steps +0.25, three steps +0.1.
   * A* adds these to the movement cost, producing smoother routes through open space.
   */
  _computeSoftCost() {
    if (!this.softCost) return;
    this.softCost.fill(0);
    const cols = this.cols, rows = this.rows;
    const weights = [0.6, 0.25, 0.1]; // for ring-distance 1, 2, 3
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (this.grid[y * cols + x] !== 1) continue;
        // Paint halo around this blocked cell
        for (let r = 1; r <= weights.length; r++) {
          const w = weights[r - 1];
          const x0 = Math.max(0, x - r), x1 = Math.min(cols - 1, x + r);
          const y0 = Math.max(0, y - r), y1 = Math.min(rows - 1, y + r);
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              // Only perimeter of ring r
              if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
              const idx = yy * cols + xx;
              if (this.grid[idx] === 1) continue; // blocked cells don't get soft cost
              if (this.softCost[idx] < w) this.softCost[idx] = w;
            }
          }
        }
      }
    }
  }

  /**
   * Rebuild the grid — convenience alias for when layout changes.
   */
  rebuild(scene) {
    this.buildFromScene(scene);
  }

  /**
   * Find the nearest walkable pixel location to (px, py) within maxRadiusPx.
   * Spirals outward through grid cells. Returns { x, y } pixel center, or null.
   * Use this to snap speakTo / goToRoom targets onto a reachable tile.
   */
  findWalkableNear(px, py, maxRadiusPx = 48) {
    const cs = this.cellSize;
    const gx = Math.floor(px / cs);
    const gy = Math.floor(py / cs);
    const maxRing = Math.max(1, Math.ceil(maxRadiusPx / cs));
    if (this.isWalkable(gx, gy)) return this.toPixel(gx, gy);
    for (let r = 1; r <= maxRing; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = gx + dx, ny = gy + dy;
          if (this.isWalkable(nx, ny)) return this.toPixel(nx, ny);
        }
      }
    }
    return null;
  }

  /**
   * Mark a rectangle as blocked in the grid
   */
  _blockRect(px, py, pw, ph) {
    const cs = this.cellSize;
    // NPC foot hitboxes are ~10x8, so minimal padding needed.
    // Soft-cost layer handles corner-hugging; keep pad tight (3px) so NPCs
    // can still fit through doorways on the 8px grid.
    const pad = 3;
    const x0 = Math.max(0, Math.floor((px - pad) / cs));
    const y0 = Math.max(0, Math.floor((py - pad) / cs));
    const x1 = Math.min(this.cols - 1, Math.floor((px + pw + pad) / cs));
    const y1 = Math.min(this.rows - 1, Math.floor((py + ph + pad) / cs));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.grid[y * this.cols + x] = 1;
      }
    }
  }

  _countBlocked() {
    let count = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i]) count++;
    }
    return count;
  }

  /**
   * Convert pixel coordinates to grid coordinates
   */
  toGrid(px, py) {
    return {
      x: Math.floor(px / this.cellSize),
      y: Math.floor(py / this.cellSize)
    };
  }

  /**
   * Convert grid coordinates to pixel center
   */
  toPixel(gx, gy) {
    return {
      x: gx * this.cellSize + this.cellSize / 2,
      y: gy * this.cellSize + this.cellSize / 2
    };
  }

  /**
   * Check if a grid cell is walkable
   */
  isWalkable(gx, gy) {
    if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) return false;
    return this.grid[gy * this.cols + gx] === 0;
  }

  /**
   * Find a path from (startX, startY) to (endX, endY) in pixel coords.
   * Returns an array of {x, y} waypoints in pixel coords, or null if no path.
   * @param {number} startX - Start pixel X
   * @param {number} startY - Start pixel Y
   * @param {number} endX - End pixel X
   * @param {number} endY - End pixel Y
   * @returns {Array<{x:number, y:number}>|null}
   */
  findPath(startX, startY, endX, endY) {
    const start = this.toGrid(startX, startY);
    const end = this.toGrid(endX, endY);

    // Clamp to grid bounds
    start.x = Math.max(0, Math.min(this.cols - 1, start.x));
    start.y = Math.max(0, Math.min(this.rows - 1, start.y));
    end.x = Math.max(0, Math.min(this.cols - 1, end.x));
    end.y = Math.max(0, Math.min(this.rows - 1, end.y));

    // If start or end is blocked, find nearest walkable cell
    if (!this.isWalkable(start.x, start.y)) {
      const alt = this._nearestWalkable(start.x, start.y);
      if (!alt) return null;
      start.x = alt.x; start.y = alt.y;
    }
    if (!this.isWalkable(end.x, end.y)) {
      const alt = this._nearestWalkable(end.x, end.y);
      if (!alt) return null;
      end.x = alt.x; end.y = alt.y;
    }

    // Same cell? Already there.
    if (start.x === end.x && start.y === end.y) return [];

    // A* search
    const path = this._astar(start, end);
    if (!path) return null;

    // Convert grid path to pixel waypoints and simplify
    const waypoints = path.map(p => this.toPixel(p.x, p.y));
    return this._simplifyPath(waypoints);
  }

  /**
   * A* pathfinding algorithm
   */
  _astar(start, end) {
    const key = (x, y) => y * this.cols + x;
    const heuristic = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    const openSet = new MinHeap();
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();

    const startKey = key(start.x, start.y);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(start, end));
    openSet.push({ x: start.x, y: start.y, f: fScore.get(startKey) });

    // Limit iterations to prevent freezing on impossible paths.
    // Bumped for 8px grid (160×90 = 14400 cells — longer paths need more room).
    const maxIterations = 6000;
    let iterations = 0;

    // 8-directional neighbors
    const dirs = [
      { dx: 0, dy: -1, cost: 1 },  // up
      { dx: 0, dy: 1, cost: 1 },   // down
      { dx: -1, dy: 0, cost: 1 },  // left
      { dx: 1, dy: 0, cost: 1 },   // right
      { dx: -1, dy: -1, cost: 1.41 }, // diagonals
      { dx: 1, dy: -1, cost: 1.41 },
      { dx: -1, dy: 1, cost: 1.41 },
      { dx: 1, dy: 1, cost: 1.41 },
    ];

    while (openSet.size() > 0 && iterations < maxIterations) {
      iterations++;
      const current = openSet.pop();
      const ck = key(current.x, current.y);

      // Reached the goal
      if (current.x === end.x && current.y === end.y) {
        // Reconstruct path
        const path = [{ x: current.x, y: current.y }];
        let k = ck;
        while (cameFrom.has(k)) {
          k = cameFrom.get(k);
          const py = Math.floor(k / this.cols);
          const px = k % this.cols;
          path.unshift({ x: px, y: py });
        }
        return path;
      }

      for (const dir of dirs) {
        const nx = current.x + dir.dx;
        const ny = current.y + dir.dy;

        if (!this.isWalkable(nx, ny)) continue;

        // For diagonals, check that both adjacent cardinal cells are walkable
        // (prevent cutting through diagonal wall corners)
        if (dir.dx !== 0 && dir.dy !== 0) {
          if (!this.isWalkable(current.x + dir.dx, current.y) ||
              !this.isWalkable(current.x, current.y + dir.dy)) {
            continue;
          }
        }

        const nk = key(nx, ny);
        // Movement cost + soft penalty for cells near obstacles (favors open space).
        const softPenalty = this.softCost ? this.softCost[nk] : 0;
        const tentG = (gScore.get(ck) || 0) + dir.cost + softPenalty;

        if (!gScore.has(nk) || tentG < gScore.get(nk)) {
          cameFrom.set(nk, ck);
          gScore.set(nk, tentG);
          const f = tentG + heuristic({ x: nx, y: ny }, end);
          fScore.set(nk, f);
          openSet.push({ x: nx, y: ny, f });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Find the nearest walkable cell to a blocked cell
   */
  _nearestWalkable(gx, gy) {
    for (let r = 1; r < 10; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only check perimeter
          if (this.isWalkable(gx + dx, gy + dy)) {
            return { x: gx + dx, y: gy + dy };
          }
        }
      }
    }
    return null;
  }

  /**
   * Simplify path by removing collinear waypoints (ray-cast simplification).
   * Keeps corners, removes straight-line intermediate points.
   */
  _simplifyPath(waypoints) {
    if (waypoints.length <= 2) return waypoints;

    const simplified = [waypoints[0]];

    for (let i = 1; i < waypoints.length - 1; i++) {
      const prev = simplified[simplified.length - 1];
      const next = waypoints[i + 1];

      // Check if we can walk straight from prev to next without hitting a wall
      if (!this._lineOfSight(prev.x, prev.y, next.x, next.y)) {
        // Can't skip this waypoint — it's a necessary corner
        simplified.push(waypoints[i]);
      }
    }

    simplified.push(waypoints[waypoints.length - 1]);
    return simplified;
  }

  /**
   * Check if there's a clear line of sight between two pixel positions.
   * Uses Bresenham-style grid traversal.
   */
  _lineOfSight(x0, y0, x1, y1) {
    const cs = this.cellSize;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / (cs / 2);
    const stepCount = Math.ceil(steps);
    if (stepCount === 0) return true;

    for (let i = 0; i <= stepCount; i++) {
      const t = i / stepCount;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      const gx = Math.floor(px / cs);
      const gy = Math.floor(py / cs);
      if (!this.isWalkable(gx, gy)) return false;
    }
    return true;
  }
}

/**
 * NPC Path Follower — manages an NPC following a computed path
 */
class NpcPathFollower {
  /**
   * @param {object} npc - Phaser sprite with body and ai
   * @param {OfficePathfinder} pathfinder - The pathfinder instance
   */
  constructor(npc, pathfinder) {
    this.npc = npc;
    this.pathfinder = pathfinder;

    // Current path being followed
    this.waypoints = null;
    this.waypointIndex = 0;

    // Stuck detection
    this._lastPos = { x: npc.x, y: npc.y };
    this._stuckTimer = 0;
    this._stuckThreshold = 1500; // ms before considered stuck
    this._stuckCount = 0;        // consecutive stuck checks
    this._rerouting = false;
    this._rerouteCount = 0;      // how many times we've rerouted for this destination
    this._maxReroutes = 5;       // give up after this many reroutes
    this._totalStuckTime = 0;    // cumulative time stuck on this path
  }

  /**
   * Set a new destination. Computes the path and starts following.
   * @param {number} targetX - Destination pixel X
   * @param {number} targetY - Destination pixel Y
   * @returns {boolean} True if a path was found
   */
  navigateTo(targetX, targetY) {
    const path = this.pathfinder.findPath(this.npc.x, this.npc.y, targetX, targetY);

    if (path && path.length > 0) {
      this.waypoints = path;
      this.waypointIndex = 0;
      this._stuckTimer = 0;
      this._rerouting = false;
      this._rerouteCount = 0;
      this._totalStuckTime = 0;
      return true;
    }

    // No path found — just clear any existing path
    this.waypoints = null;
    this.waypointIndex = 0;
    return false;
  }

  /**
   * Check if currently navigating
   */
  isNavigating() {
    return this.waypoints !== null && this.waypointIndex < this.waypoints.length;
  }

  /**
   * Update — call each frame. Returns the velocity {vx, vy} to set, or null if arrived/no path.
   * @param {number} speed - Movement speed in pixels/sec
   * @param {number} delta - Frame delta in ms
   * @returns {{vx: number, vy: number}|null}
   */
  update(speed, delta) {
    if (!this.waypoints || this.waypointIndex >= this.waypoints.length) {
      return null; // No active path
    }

    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - this.npc.x;
    const dy = target.y - this.npc.y;
    const dist = Math.hypot(dx, dy);

    // Reached current waypoint?
    if (dist < 10) {
      this.waypointIndex++;
      this._stuckTimer = 0;
      this._lastPos = { x: this.npc.x, y: this.npc.y };
      if (this.waypointIndex >= this.waypoints.length) {
        this.waypoints = null;
        return null; // Arrived at destination
      }
      // Continue to next waypoint
      return this.update(speed, delta);
    }

    // Stuck detection: accumulate time, check position every 500ms
    this._stuckTimer += delta;
    if (this._stuckTimer >= 500) {
      const movedDist = Math.hypot(this.npc.x - this._lastPos.x, this.npc.y - this._lastPos.y);
      this._lastPos = { x: this.npc.x, y: this.npc.y };

      if (movedDist < 4) {
        this._stuckCount = (this._stuckCount || 0) + 1;
        this._totalStuckTime += 500;

        // If stuck for too long overall (8s+), give up entirely
        if (this._totalStuckTime >= 8000) {
          this.waypoints = null;
          this._stuckCount = 0;
          this._totalStuckTime = 0;
          return null;
        }

        // Stuck for 3 checks (1.5s) — nudge randomly then reroute
        if (this._stuckCount >= 3) {
          this._stuckCount = 0;
          this._rerouteCount++;

          // Too many reroutes — destination is unreachable, give up
          if (this._rerouteCount >= this._maxReroutes) {
            this.waypoints = null;
            this._rerouteCount = 0;
            this._totalStuckTime = 0;
            return null;
          }

          // Apply a small random nudge to break free before rerouting
          const nudgeAmt = 8 + Math.random() * 8;
          const nudgeAngle = Math.random() * Math.PI * 2;
          this.npc.x += Math.cos(nudgeAngle) * nudgeAmt;
          this.npc.y += Math.sin(nudgeAngle) * nudgeAmt;

          const finalTarget = this.waypoints[this.waypoints.length - 1];

          // Try skipping to the next waypoint first
          if (this.waypointIndex < this.waypoints.length - 1) {
            this.waypointIndex++;
            this._stuckTimer = 0;
            return this.update(speed, delta);
          }

          // Last resort: reroute from current position
          const rerouted = this.pathfinder.findPath(this.npc.x, this.npc.y, finalTarget.x, finalTarget.y);
          if (!rerouted || rerouted.length === 0) {
            this.waypoints = null;
            this._totalStuckTime = 0;
            return null;
          }
          this.waypoints = rerouted;
          this.waypointIndex = 0;
          this._stuckTimer = 0;
          return this.update(speed, delta);
        }
      } else {
        this._stuckCount = 0;
      }
      this._stuckTimer = 0;
    }

    // Arrival slowdown — when approaching the FINAL waypoint, scale speed
    // by dist/40 (floor 0.35). Prevents overshoot / jitter at the goal.
    let effSpeed = speed;
    if (this.waypointIndex === this.waypoints.length - 1 && dist < 40) {
      const slowFactor = Math.max(0.35, dist / 40);
      effSpeed = speed * slowFactor;
    }

    // Move toward current waypoint
    const vx = (dx / dist) * effSpeed;
    const vy = (dy / dist) * effSpeed;
    return { vx, vy };
  }

  /**
   * Stop navigation
   */
  stop() {
    this.waypoints = null;
    this.waypointIndex = 0;
  }
}

/**
 * Min-heap for A* open set (priority queue by f-score)
 */
class MinHeap {
  constructor() {
    this.data = [];
  }

  size() { return this.data.length; }

  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }

  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else break;
    }
  }

  _sinkDown(i) {
    const len = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < len && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else break;
    }
  }
}

// Export as globals for browser
window.OfficePathfinder = OfficePathfinder;
window.NpcPathFollower = NpcPathFollower;
