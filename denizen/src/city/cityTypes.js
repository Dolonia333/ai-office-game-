// Basic engine-agnostic data types for the city generator.

/**
 * @typedef {Object} TileRef
 * @property {string} tileset - id from data/exteriors.json tilesets
 * @property {number} tileIndex - index into tileset grid
 */

/**
 * @typedef {Object} TileLayer
 * @property {string} id
 * @property {number} width
 * @property {number} height
 * @property {TileRef[][]} grid
 */

/**
 * @typedef {Object} CityChunk
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {TileLayer[]} layers
 * @property {Object[]} buildings
 * @property {Object} metadata
 */

/**
 * @typedef {Object} Building
 * @property {string} id
 * @property {string} type
 * @property {{ x: number, y: number, w: number, h: number }} footprint
 * @property {{ x: number, y: number }} entrance
 */

export function makeEmptyLayer(id, width, height) {
  /** @type {TileLayer} */
  const layer = {
    id,
    width,
    height,
    grid: [],
  };
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push(null);
    }
    layer.grid.push(row);
  }
  return layer;
}

