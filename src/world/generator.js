import { makeRng } from './rng.js';
import { buildRecipeIndex, pickRecipeForRoom } from './recipes.js';
import { furnishWorld } from './roomFurnisherRuntime.js';

function rectsOverlap(a, b, padding = 0) {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  );
}

function centerOf(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function carveCorridor(a, b, width) {
  // L-shaped corridor between centers
  const ca = centerOf(a);
  const cb = centerOf(b);
  const mid = { x: cb.x, y: ca.y };
  const segs = [];
  const mk = (p1, p2) => {
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p1.x - p2.x) || 1;
    const h = Math.abs(p1.y - p2.y) || 1;
    // expand to corridor width
    if (w >= h) segs.push({ x, y: y - width / 2, w, h: width });
    else segs.push({ x: x - width / 2, y, w: width, h });
  };
  mk(ca, mid);
  mk(mid, cb);
  return segs;
}

export async function generateWorld({ seed = 'default', prefabs = [], config = {} } = {}) {
  const rng = makeRng(String(seed));

  const world = {
    version: 1,
    seed: rng.seedString,
    tileSize: 16,
    bounds: { w: 1280, h: 720 },
    zones: [],
    rooms: [],
    corridors: [],
    outdoor: [],
    spawns: { player: { x: 640, y: 360 }, npcs: [] },
    objects: []
  };

  const officeCfg = {
    roomCount: config.roomCount ?? 5,
    corridorWidth: config.corridorWidth ?? 96,
    roomPadding: config.roomPadding ?? 24,
    layoutMode: config.layoutMode ?? 'generic', // 'generic' | 'recipes'
    defaultTheme: config.defaultTheme ?? 'modern_office',
    defaultRoomType: config.defaultRoomType ?? 'target_office' // updated default to load target_office
  };

  // Scene recipes (if requested)
  const recipeIndex = officeCfg.layoutMode === 'recipes' ? buildRecipeIndex() : null;

  // Choose prefabs (fallback: treat each prefab as a room with its canvas size)
  const usable = prefabs.filter((p) => p && p.canvas && p.canvas.width && p.canvas.height);
  const picks = [];
  for (let i = 0; i < officeCfg.roomCount; i++) {
    if (usable.length === 0) break;
    picks.push(rng.pick(usable));
  }

  // Place rooms without overlap in a loose grid
  const placed = [];
  for (const p of picks) {
    const w = p.canvas.width;
    const h = p.canvas.height;
    let placedRoom = null;
    for (let tries = 0; tries < 200; tries++) {
      const x = rng.int(80, world.bounds.w - w - 80);
      const y = rng.int(60, world.bounds.h - h - 60);
      const r = {
        id: `room_${placed.length}`,
        prefabId: p.id,
        x,
        y,
        w,
        h,
        tags: p.tags || []
      };

      // If using recipes, assign a theme/roomType and recipeId now.
      if (recipeIndex) {
        const theme = officeCfg.defaultTheme;
        const roomType = officeCfg.defaultRoomType;
        const recipe = pickRecipeForRoom(rng, recipeIndex, theme, roomType);
        if (recipe) {
          r.theme = recipe.theme || theme;
          r.roomType = recipe.roomType || roomType;
          r.recipeId = recipe.id;
        } else {
          r.theme = theme;
          r.roomType = roomType;
        }
      }
      if (!placed.some((o) => rectsOverlap(r, o, officeCfg.roomPadding))) {
        placedRoom = r;
        break;
      }
    }
    if (placedRoom) placed.push(placedRoom);
  }

  world.rooms = placed;

  // If there were no prefabs (current case), but recipes are enabled,
  // create a single room in the middle of the world sized to a recipe
  // so that furnisher has something to work with.
  if (world.rooms.length === 0 && recipeIndex) {
    const theme = officeCfg.defaultTheme;
    const roomType = officeCfg.defaultRoomType;
    const recipe = pickRecipeForRoom(rng, recipeIndex, theme, roomType);
    if (recipe) {
      const w = (recipe.size?.w || 24) * world.tileSize;
      const h = (recipe.size?.h || 16) * world.tileSize;
      const x = (world.bounds.w - w) / 2;
      const y = (world.bounds.h - h) / 2;
      world.rooms.push({
        id: 'room_0',
        prefabId: recipe.id,
        x,
        y,
        w,
        h,
        tags: [],
        theme: recipe.theme || theme,
        roomType: recipe.roomType || roomType,
        recipeId: recipe.id
      });
    }
  }

  // Connect rooms with a simple MST-like greedy (nearest neighbor chain)
  const connected = new Set();
  const edges = [];
  if (placed.length > 1) {
    connected.add(placed[0].id);
    while (connected.size < placed.length) {
      let best = null;
      for (const a of placed) {
        if (!connected.has(a.id)) continue;
        for (const b of placed) {
          if (connected.has(b.id)) continue;
          const d = manhattan(centerOf(a), centerOf(b));
          if (!best || d < best.d) best = { a, b, d };
        }
      }
      if (!best) break;
      connected.add(best.b.id);
      edges.push({ a: best.a.id, b: best.b.id });
    }
  }

  // Carve corridors from edges
  for (const e of edges) {
    const a = placed.find((r) => r.id === e.a);
    const b = placed.find((r) => r.id === e.b);
    if (!a || !b) continue;
    world.corridors.push(...carveCorridor(a, b, officeCfg.corridorWidth));
  }

  // Outdoor chunks (coarse): a strip at bottom as "street"
  const outdoorCfg = {
    enabled: config.outdoorEnabled ?? true,
    streetHeight: config.streetHeight ?? 140
  };
  if (outdoorCfg.enabled) {
    world.outdoor.push({
      kind: 'street',
      x: 0,
      y: world.bounds.h - outdoorCfg.streetHeight,
      w: world.bounds.w,
      h: outdoorCfg.streetHeight
    });
  }

  // Spawn points: player at first corridor center or middle
  if (world.corridors.length > 0) {
    const c = world.corridors[0];
    world.spawns.player = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  }

  // NPC spawns: random in rooms/corridors
  for (let i = 0; i < 10; i++) {
    const base = rng.chance(0.6) && world.rooms.length ? rng.pick(world.rooms) : (world.corridors.length ? rng.pick(world.corridors) : null);
    if (!base) break;
    world.spawns.npcs.push({
      x: base.x + rng.int(30, Math.max(30, Math.floor(base.w - 30))),
      y: base.y + rng.int(30, Math.max(30, Math.floor(base.h - 30)))
    });
  }

  // Zones for floor coloring (renderer decides tile)
  world.zones.push({ kind: 'rooms_light', x: 0, y: 0, w: world.bounds.w, h: world.bounds.h });
  world.zones.push({ kind: 'corridor_dark', x: world.bounds.w / 2 - 500, y: world.bounds.h / 2 - 70, w: 1000, h: 140 });
  world.zones.push({ kind: 'clinic_blue', x: world.bounds.w * 0.58, y: world.bounds.h * 0.6, w: world.bounds.w * 0.4, h: world.bounds.h * 0.35 });

  // Furnish rooms using scene recipes if enabled.
  if (recipeIndex) {
    const furnishedObjects = furnishWorld(world);
    world.objects.push(...furnishedObjects);
  }

  return world;
}

