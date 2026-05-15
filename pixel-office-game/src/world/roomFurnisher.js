// Room furnisher: turns a world room + scene recipe into concrete object placements.
// This module is engine-agnostic; it only outputs logical placements that
// the Phaser scene can later translate into sprites via furniture catalogs.

import openplanRecipe from '../../data/scene_recipes_modern_office_openplan_bullpen.json' assert { type: 'json' };
import receptionRecipe from '../../data/scene_recipes_modern_office_reception.json' assert { type: 'json' };

const recipeById = new Map([
  [openplanRecipe.id, openplanRecipe],
  [receptionRecipe.id, receptionRecipe]
]);

/**
 * Convert tile coordinates inside a recipe into world pixel coordinates
 * relative to a room rect.
 */
function roomTileToWorld(room, tileSize, tx, ty) {
  const x = room.x + tx * tileSize;
  const y = room.y + ty * tileSize;
  return { x, y };
}

/**
 * Furnish a single room: returns an array of logical objects:
 * { id, prefabId, x, y, theme, roomId, tags? }
 */
export function furnishRoom(world, room) {
  if (!room.recipeId) return [];
  const recipe = recipeById.get(room.recipeId);
  if (!recipe || !recipe.layout) return [];

  const tileSize = recipe.tileSize || world.tileSize || 16;
  const objects = [];

  const pushObj = (prefabId, x, y, extras = {}) => {
    objects.push({
      id: `${room.id}:${prefabId}:${objects.length}`,
      prefabId,
      x,
      y,
      theme: recipe.theme || room.theme || 'modern_office',
      roomId: room.id,
      ...extras
    });
  };

  // Desk rows for open-plan style layouts
  if (Array.isArray(recipe.layout.deskRows)) {
    for (const row of recipe.layout.deskRows) {
      const start = row.start || { x: 0, y: 0 };
      const spacing = row.spacing || { x: 1, y: 0 };
      const count = row.count || 1;
      for (let i = 0; i < count; i++) {
        const tx = start.x + i * spacing.x;
        const ty = start.y + i * spacing.y;
        const worldPos = roomTileToWorld(room, tileSize, tx, ty);
        // main desk cluster
        pushObj('desk_cluster_2x2', worldPos.x, worldPos.y, { kind: 'surface_cluster' });

        // attachments (chairs, monitors, plants) using desk anchors
        const attach = row.attach || {};
        if (attach.chair) {
          pushObj(attach.chair.prefab, worldPos.x, worldPos.y, {
            kind: 'seat',
            attachTo: 'desk_cluster_2x2',
            anchor: attach.chair.anchor || 'chair_1'
          });
        }
        if (attach.monitor) {
          pushObj(attach.monitor.prefab, worldPos.x, worldPos.y, {
            kind: 'device',
            attachTo: 'desk_cluster_2x2',
            anchor: attach.monitor.anchor || 'pc_1'
          });
        }
        if (attach.plant) {
          // simple frequency gate; a real implementation would use RNG
          pushObj(attach.plant.prefab, worldPos.x, worldPos.y, {
            kind: 'decor',
            attachTo: 'desk_cluster_2x2',
            anchor: attach.plant.anchor || 'pc_2'
          });
        }
      }
    }
  }

  // Wall decor (whiteboards, logos) along room edges
  if (Array.isArray(recipe.layout.wallDecor)) {
    for (const wd of recipe.layout.wallDecor) {
      const repeat = wd.repeat ?? 1;
      for (let i = 0; i < repeat; i++) {
        const side = wd.side || 'top';
        const off = wd.offsetTiles || { x: 0, y: 0 };
        let tx = off.x || 0;
        let ty = off.y || 0;
        if (side === 'top') {
          ty = 1;
        } else if (side === 'bottom') {
          ty = (recipe.size?.h ?? 10) - 1;
        } else if (side === 'left') {
          tx = 1;
        } else if (side === 'right') {
          tx = (recipe.size?.w ?? 10) - 1;
        }
        const worldPos = roomTileToWorld(room, tileSize, tx, ty);
        pushObj(wd.prefab, worldPos.x, worldPos.y, { kind: 'wall_decor' });
      }
    }
  }

  // Utilities (water dispenser, printer etc.)
  if (Array.isArray(recipe.layout.utilities)) {
    for (const u of recipe.layout.utilities) {
      const p = u.pos || { x: 0, y: 0 };
      const worldPos = roomTileToWorld(room, tileSize, p.x, p.y);
      pushObj(u.prefab, worldPos.x, worldPos.y, { kind: 'utility' });
    }
  }

  // Reception / waiting-area specifics (from reception recipe)
  if (recipe.layout.receptionDesk) {
    const r = recipe.layout.receptionDesk;
    if (r.counter) {
      const c = r.counter;
      const start = c.start || { x: 0, y: 0 };
      const length = c.lengthTiles || 4;
      const worldStart = roomTileToWorld(room, tileSize, start.x, start.y);
      pushObj(c.prefab, worldStart.x, worldStart.y, {
        kind: 'counter',
        lengthTiles: length
      });
    }
    if (Array.isArray(r.frontChairs)) {
      for (const cfg of r.frontChairs) {
        const start = cfg.start || { x: 0, y: 0 };
        const spacing = cfg.spacing || { x: 1, y: 0 };
        const count = cfg.count || 1;
        for (let i = 0; i < count; i++) {
          const tx = start.x + i * spacing.x;
          const ty = start.y + i * spacing.y;
          const worldPos = roomTileToWorld(room, tileSize, tx, ty);
          pushObj(cfg.prefab, worldPos.x, worldPos.y, {
            kind: 'seat',
            facing: cfg.facing || 'up'
          });
        }
      }
    }
  }

  if (recipe.layout.waitingArea) {
    const wa = recipe.layout.waitingArea;
    if (Array.isArray(wa.seats)) {
      for (const cfg of wa.seats) {
        const start = cfg.start || { x: 0, y: 0 };
        const spacing = cfg.spacing || { x: 1, y: 0 };
        const count = cfg.count || 1;
        for (let i = 0; i < count; i++) {
          const tx = start.x + i * spacing.x;
          const ty = start.y + i * spacing.y;
          const worldPos = roomTileToWorld(room, tileSize, tx, ty);
          pushObj(cfg.prefab, worldPos.x, worldPos.y, {
            kind: 'seat',
            facing: cfg.facing || 'up'
          });
        }
      }
    }
    if (Array.isArray(wa.tables)) {
      for (const t of wa.tables) {
        const p = t.pos || { x: 0, y: 0 };
        const worldPos = roomTileToWorld(room, tileSize, p.x, p.y);
        const tableId = `${t.prefab}_${objects.length}`;
        pushObj(t.prefab, worldPos.x, worldPos.y, { kind: 'table', logicalId: tableId });
        if (Array.isArray(t.attach)) {
          for (const a of t.attach) {
            pushObj(a.prefab, worldPos.x, worldPos.y, {
              kind: 'decor',
              attachTo: tableId,
              offset: a.offsetPixels || { x: 0, y: 0 }
            });
          }
        }
      }
    }
  }

  return objects;
}

/**
 * Furnish all rooms in a world that have recipeId set.
 * Returns an array that can be merged into world.objects.
 */
export function furnishWorld(world) {
  const out = [];
  for (const room of world.rooms || []) {
    out.push(...furnishRoom(world, room));
  }
  return out;
}

