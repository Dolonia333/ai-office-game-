// Room furnisher: turns a world room + scene recipe into concrete object placements.
// Engine-agnostic: only outputs logical placements; Phaser code turns these into sprites.

import { buildRecipeIndex } from './recipes.js';

const recipeIndex = buildRecipeIndex();
const recipeById = recipeIndex.byId;

function roomTileToWorld(room, tileSize, tx, ty) {
  const x = room.x + tx * tileSize;
  const y = room.y + ty * tileSize;
  return { x, y };
}

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

  // Desk rows (open-plan bullpen)
  if (Array.isArray(recipe.layout.deskRows)) {
    for (const row of recipe.layout.deskRows) {
      const start = row.start || { x: 0, y: 0 };
      const spacing = row.spacing || { x: 1, y: 0 };
      const count = row.count || 1;
      for (let i = 0; i < count; i++) {
        const tx = start.x + i * spacing.x;
        const ty = start.y + i * spacing.y;
        const worldPos = roomTileToWorld(room, tileSize, tx, ty);
        pushObj('desk_cluster_2x2', worldPos.x, worldPos.y, { kind: 'surface_cluster' });

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
          pushObj(attach.plant.prefab, worldPos.x, worldPos.y, {
            kind: 'decor',
            attachTo: 'desk_cluster_2x2',
            anchor: attach.plant.anchor || 'pc_2'
          });
        }
      }
    }
  }

  // Wall decor
  if (Array.isArray(recipe.layout.wallDecor)) {
    for (const wd of recipe.layout.wallDecor) {
      const repeat = wd.repeat ?? 1;
      for (let i = 0; i < repeat; i++) {
        const side = wd.side || 'top';
        const off = wd.offsetTiles || { x: 0, y: 0 };
        let tx = off.x || 0;
        let ty = off.y || 0;
        if (side === 'top') ty = 1;
        else if (side === 'bottom') ty = (recipe.size?.h ?? 10) - 1;
        else if (side === 'left') tx = 1;
        else if (side === 'right') tx = (recipe.size?.w ?? 10) - 1;
        const worldPos = roomTileToWorld(room, tileSize, tx, ty);
        pushObj(wd.prefab, worldPos.x, worldPos.y, { kind: 'wall_decor' });
      }
    }
  }

  // Utilities
  if (Array.isArray(recipe.layout.utilities)) {
    for (const u of recipe.layout.utilities) {
      const p = u.pos || { x: 0, y: 0 };
      const worldPos = roomTileToWorld(room, tileSize, p.x, p.y);
      pushObj(u.prefab, worldPos.x, worldPos.y, { kind: 'utility' });
    }
  }

  // Reception-specific layout
  if (recipe.layout.receptionDesk) {
    const r = recipe.layout.receptionDesk;
    if (r.counter) {
      const c = r.counter;
      const start = c.start || { x: 0, y: 0 };
      const worldStart = roomTileToWorld(room, tileSize, start.x, start.y);
      pushObj(c.prefab, worldStart.x, worldStart.y, { kind: 'counter', lengthTiles: c.lengthTiles || 4 });
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

  // Small office desk area (single desk + attached chair + PC)
  if (recipe.layout.deskArea) {
    const da = recipe.layout.deskArea;
    if (da.desk && da.desk.prefab && da.desk.pos) {
      const worldPos = roomTileToWorld(room, tileSize, da.desk.pos.x, da.desk.pos.y);
      pushObj(da.desk.prefab, worldPos.x, worldPos.y, { kind: 'surface_cluster' });

      if (da.chair && da.chair.prefab) {
        pushObj(da.chair.prefab, worldPos.x, worldPos.y, {
          kind: 'seat',
          attachTo: da.desk.prefab,
          anchor: da.chair.anchor || 'chair_1'
        });
      }
      if (da.pc && da.pc.prefab) {
        pushObj(da.pc.prefab, worldPos.x, worldPos.y, {
          kind: 'device',
          attachTo: da.desk.prefab,
          anchor: da.pc.anchor || 'pc_1'
        });
      }
    }
  }

  // Small office side furniture
  if (Array.isArray(recipe.layout.sideFurniture)) {
    for (const f of recipe.layout.sideFurniture) {
      const p = f.pos || { x: 0, y: 0 };
      const worldPos = roomTileToWorld(room, tileSize, p.x, p.y);
      pushObj(f.prefab, worldPos.x, worldPos.y, { kind: 'furniture' });
    }
  }

  // Small office decor
  if (Array.isArray(recipe.layout.decor)) {
    for (const d of recipe.layout.decor) {
      const p = d.pos || { x: 0, y: 0 };
      const worldPos = roomTileToWorld(room, tileSize, p.x, p.y);
      pushObj(d.prefab, worldPos.x, worldPos.y, { kind: 'decor' });
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

export function furnishWorld(world) {
  const out = [];
  for (const room of world.rooms || []) {
    out.push(...furnishRoom(world, room));
  }
  return out;
}

