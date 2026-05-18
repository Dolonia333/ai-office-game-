// Adapter that turns CityChunk / InteriorLayout data into Phaser 3 tile layers.

/**
 * @param {Phaser.Scene} scene
 * @param {import('./cityTypes.js').CityChunk} chunk
 * @param {Object} tilesetKeys - map from tileset id (exteriors.json) to loaded Phaser texture key
 * @returns {Phaser.GameObjects.Group[]} layers
 */
export function renderCityChunkPhaser(scene, chunk, tilesetKeys) {
  const groups = [];
  const tileSize = 16;

  chunk.layers.forEach((layer) => {
    const g = scene.add.group();
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const ref = layer.grid[y][x];
        if (!ref) continue;
        const texKey = tilesetKeys[ref.tileset];
        if (!texKey) continue;
        const img = scene.add.image(
          chunk.x * tileSize + x * tileSize + tileSize / 2,
          chunk.y * tileSize + y * tileSize + tileSize / 2,
          texKey,
        );
        img.setOrigin(0.5, 0.5);
        // For now we assume tilesets are already sliced appropriately;
        // a more advanced version would use SpriteSheets + setFrame(tileIndex).
        g.add(img);
      }
    }
    groups.push(g);
  });
  return groups;
}

/**
 * @param {Phaser.Scene} scene
 * @param {Object} interior - data from generateOfficeInterior
 * @param {Object} prefabSprites - map prefabId -> factory({ x, y, meta }) that creates Phaser objects
 * @returns {Phaser.GameObjects.Group} group
 */
export function renderInteriorPhaser(scene, interior, prefabSprites) {
  const g = scene.add.group();
  interior.furniture.forEach((f) => {
    const factory = prefabSprites[f.prefabId];
    if (!factory) return;
    const obj = factory({ scene, x: f.x, y: f.y, meta: f.meta || {}, roomId: f.roomId });
    if (obj) g.add(obj);
  });
  return g;
}

