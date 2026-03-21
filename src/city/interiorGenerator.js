import { makeRng } from '../world/rng.js';

/**
 * Simple office interior layout generator.
 * Returns an object with:
 * - rooms: array of { id, type, rect }
 * - furniture: array of { prefabId, x, y, roomId, meta }
 */

export function generateOfficeInterior({
  seed = 'default',
  buildingId = 'office_0',
  width = 24,
  height = 16,
} = {}) {
  const rng = makeRng(`${seed}:int:${buildingId}`);

  const rooms = [];
  const furniture = [];

  // Single room: open-plan bullpen.
  const bullpen = {
    id: 'bullpen',
    type: 'bullpen',
    rect: { x: 0, y: 0, w: width, h: height },
  };
  rooms.push(bullpen);

  // Margins for walls/corridors.
  const marginX = 2;
  const marginY = 2;

  // Place rows of desk clusters.
  const clusterSpacingX = 6; // in tiles (desk_cluster_2x2 = 2x2 tiles at 32px)
  const rowSpacingY = 4;

  let rowY = marginY + 2;
  let clusterIndex = 0;

  while (rowY + 2 < height - marginY) {
    let clusterX = marginX;
    while (clusterX + 4 < width - marginX) {
      const roomId = bullpen.id;
      const baseX = clusterX * 32 + 32; // approx bottom-center
      const baseY = rowY * 32 + 32;

      const clusterId = `desk_cluster_${clusterIndex++}`;
      furniture.push({
        prefabId: 'desk_cluster_2x2',
        x: baseX,
        y: baseY,
        roomId,
        meta: { clusterId },
      });

      // Derive chair and PC positions using approximate offsets that match anchors.
      const chairOffsetY = 26;
      const chairSpacingX = 64;
      const pcOffsetY = -12;

      furniture.push({
        prefabId: 'office_chair',
        x: baseX - chairSpacingX / 4,
        y: baseY + chairOffsetY,
        roomId,
        meta: { clusterId, anchor: 'chair_1' },
      });
      furniture.push({
        prefabId: 'office_chair',
        x: baseX + chairSpacingX / 4,
        y: baseY + chairOffsetY,
        roomId,
        meta: { clusterId, anchor: 'chair_2' },
      });
      furniture.push({
        prefabId: 'pc_monitor',
        x: baseX - chairSpacingX / 4,
        y: baseY + pcOffsetY,
        roomId,
        meta: { clusterId, anchor: 'pc_1' },
      });
      furniture.push({
        prefabId: 'pc_monitor',
        x: baseX + chairSpacingX / 4,
        y: baseY + pcOffsetY,
        roomId,
        meta: { clusterId, anchor: 'pc_2' },
      });

      clusterX += clusterSpacingX;
    }
    rowY += rowSpacingY;
  }

  // Add some plants along walls.
  for (let x = marginX + 1; x < width - marginX; x += 5) {
    if (rng.chance(0.5)) {
      furniture.push({
        prefabId: 'plant_pot',
        x: x * 32,
        y: (marginY + 1) * 32,
        roomId: bullpen.id,
        meta: {},
      });
    }
  }

  return {
    buildingId,
    seed: rng.seedString,
    width,
    height,
    rooms,
    furniture,
  };
}

