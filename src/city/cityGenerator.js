import { makeRng } from '../world/rng.js';
import { makeEmptyLayer } from './cityTypes.js';
import exteriorsCatalog from '../../data/exteriors.json' assert { type: 'json' };

// Simple city chunk generator:
// - grid of tiles (ground, roads)
// - orthogonal roads every roadStride tiles
// - rectangular building footprints between roads

export function generateCityChunk({
  seed = 'default',
  chunkX = 0,
  chunkY = 0,
  width = 64,
  height = 64,
  roadStride = 12,
} = {}) {
  const rng = makeRng(`${seed}:${chunkX},${chunkY}`);

  /** @type {import('./cityTypes.js').CityChunk} */
  const chunk = {
    x: chunkX,
    y: chunkY,
    width,
    height,
    layers: [],
    buildings: [],
    metadata: {
      seed: rng.seedString,
    },
  };

  const ground = makeEmptyLayer('ground', width, height);
  const roads = makeEmptyLayer('roads', width, height);

  const categories = exteriorsCatalog.categories || {};
  const pickFromCat = (name) => {
    const arr = categories[name];
    if (!arr || arr.length === 0) return null;
    return rng.pick ? rng.pick(arr) : arr[0];
  };

  const grassTiles = categories.grass && categories.grass.length > 0
    ? categories.grass
    : [
        { tileset: 'modern_exteriors_a2_floors', tileIndex: 32 },
        { tileset: 'modern_exteriors_a2_floors', tileIndex: 33 },
      ];

  const pavementTile =
    pickFromCat('pavement') || { tileset: 'modern_exteriors_a2_floors', tileIndex: 16 };

  const roadStraightH =
    (categories.road_straight && categories.road_straight.find((t) => t.orientation === 'horizontal')) ||
    pickFromCat('road_straight') ||
    { tileset: 'modern_exteriors_a2_floors', tileIndex: 0 };

  const roadStraightV =
    (categories.road_straight && categories.road_straight.find((t) => t.orientation === 'vertical')) ||
    pickFromCat('road_straight') ||
    { tileset: 'modern_exteriors_a2_floors', tileIndex: 1 };

  // Fill ground with grass by default.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ground.grid[y][x] = rng.pick(grassTiles);
    }
  }

  // Place orthogonal roads on a regular grid.
  const roadCols = [];
  const roadRows = [];
  for (let x = roadStride; x < width; x += roadStride) {
    roadCols.push(x);
  }
  for (let y = roadStride; y < height; y += roadStride) {
    roadRows.push(y);
  }

  for (const x of roadCols) {
    for (let y = 0; y < height; y++) {
      roads.grid[y][x] = roadStraightV;
      // Pavement next to road
      if (x + 1 < width && !roads.grid[y][x + 1]) {
        ground.grid[y][x + 1] = pavementTile;
      }
      if (x - 1 >= 0 && !roads.grid[y][x - 1]) {
        ground.grid[y][x - 1] = pavementTile;
      }
    }
  }
  for (const y of roadRows) {
    for (let x = 0; x < width; x++) {
      roads.grid[y][x] = roadStraightH;
      if (y + 1 < height && !roads.grid[y + 1][x]) {
        ground.grid[y + 1][x] = pavementTile;
      }
      if (y - 1 >= 0 && !roads.grid[y - 1][x]) {
        ground.grid[y - 1][x] = pavementTile;
      }
    }
  }

  // Compute simple rectangular blocks between roads and fill with building footprints.
  const blocks = [];
  const xs = [0, ...roadCols, width];
  const ys = [0, ...roadRows, height];

  for (let yi = 0; yi < ys.length - 1; yi++) {
    for (let xi = 0; xi < xs.length - 1; xi++) {
      const x0 = xs[xi];
      const x1 = xs[xi + 1];
      const y0 = ys[yi];
      const y1 = ys[yi + 1];
      // shrink to leave space for roads themselves
      const bx0 = x0 + 1;
      const bx1 = x1 - 1;
      const by0 = y0 + 1;
      const by1 = y1 - 1;
      if (bx1 - bx0 <= 4 || by1 - by0 <= 4) continue;
      blocks.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 });
    }
  }

  const facadeTile =
    pickFromCat('building_facade_office') || { tileset: 'modern_exteriors_a4_walls', tileIndex: 0 };

  for (const block of blocks) {
    const { x, y, w, h } = block;
    // Randomly decide if block becomes an office or park.
    const type = rng.chance(0.7) ? 'office' : 'park';
    if (type === 'park') {
      // Sprinkle trees on ground inside park.
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          if (rng.chance(0.15)) {
            ground.grid[yy][xx] = { tileset: 'modern_exteriors_tileset_100', tileIndex: 0 };
          }
        }
      }
    } else {
      // Simple rectangular building footprint on the block.
      const inset = 1;
      const fx0 = x + inset;
      const fx1 = x + w - inset;
      const fy0 = y + inset;
      const fy1 = y + h - inset;
      if (fx1 - fx0 <= 2 || fy1 - fy0 <= 2) continue;

      // Draw a filled rectangle on a separate layer? For now, mark on ground.
      for (let yy = fy0; yy < fy1; yy++) {
        for (let xx = fx0; xx < fx1; xx++) {
          ground.grid[yy][xx] = facadeTile;
        }
      }
      const entranceX = Math.floor((fx0 + fx1) / 2);
      const entranceY = y - 1 >= 0 ? y - 1 : y + h;

      chunk.buildings.push({
        id: `b_${chunk.buildings.length}`,
        type: 'office',
        footprint: { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 },
        entrance: { x: entranceX, y: entranceY },
      });
    }
  }

  chunk.layers.push(ground, roads);
  return chunk;
}

