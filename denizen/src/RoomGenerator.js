/**
 * RoomGenerator.js
 *
 * Procedural room generator that uses the furniture catalog to build
 * room templates algorithmically. Output is a standard template object
 * compatible with RoomAssembly.renderRoom().
 *
 * Usage:
 *   const gen = new RoomGenerator(catalogData);
 *   const template = gen.generate({ purpose: 'workspace', occupants: 4, width: 384, height: 320 });
 *   // template = { items: [{id, x, y, instanceId, ...}, ...] }
 *   // Inject into RoomAssembly: assembly.templates['generated_xyz'] = template;
 *   // Then: assembly.renderRoom('generated_xyz', originX, originY);
 */

const CELL = 32; // grid cell size in pixels

// ─── Catalog Intelligence ────────────────────────────────────────────────

/**
 * Group catalog objects by type and build lookup indices.
 * @param {object} objects - furniture_catalog_openplan.json .objects
 * @returns {{ byType, byAction, desks, chairs, deskSetups, plants, whiteboards, all }}
 */
function buildPalette(objects) {
  const byType = {};
  const byAction = {};
  const all = {};

  for (const [id, def] of Object.entries(objects)) {
    const entry = { id, ...def };
    all[id] = entry;

    const t = def.type || 'unknown';
    if (!byType[t]) byType[t] = [];
    byType[t].push(entry);

    if (def.action) {
      if (!byAction[def.action]) byAction[def.action] = [];
      byAction[def.action].push(entry);
    }
  }

  // Convenience groups
  const desks = (byType.surface || []).filter(e => e.action === 'use_computer');
  const chairs = (byType.seat || []).filter(e => e.action === 'seat');
  const frontChairs = chairs.filter(e => /front/.test(e.id));
  const backChairs = chairs.filter(e => /back/.test(e.id));
  const sideChairs = chairs.filter(e => /side/.test(e.id));
  const deskSetups = (byType.decor || []).filter(e => e.action === 'use_computer' && /desk_setup/.test(e.id));
  const plants = (byType.decor || []).filter(e => /plant/.test(e.id));
  const whiteboards = (byType.decor || []).filter(e => /whiteboard/.test(e.id));
  const wallDecor = (byType.decor || []).filter(e =>
    /cert|cork_board|pop_art|ac_unit/.test(e.id) || (e.depth !== undefined && e.depth <= 1.3)
  );
  const sofas = (byType.furniture || []).filter(e => /sofa|corner_sofa/.test(e.id));
  const vendingMachines = (byType.furniture || []).filter(e => /vending|coffee_machine|mini_fridge|water_dispenser|coffee_barista|water_cooler/.test(e.id));
  const bookshelves = (byType.furniture || []).filter(e => /bookshelf/.test(e.id));
  const tables = (byType.furniture || []).filter(e => /table/.test(e.id));
  const partitions = byType.partition || [];
  const miscFurniture = (byType.furniture || []).filter(e =>
    /trash_can|paper_shredder|printer|stairs/.test(e.id)
  );

  return {
    byType, byAction, all,
    desks, chairs, frontChairs, backChairs, sideChairs,
    deskSetups, plants, whiteboards, wallDecor,
    sofas, vendingMachines, bookshelves, tables, partitions, miscFurniture
  };
}

// ─── Grid System ─────────────────────────────────────────────────────────

class OccupancyGrid {
  /**
   * @param {number} widthPx  - room width in pixels
   * @param {number} heightPx - room height in pixels
   */
  constructor(widthPx, heightPx) {
    this.cols = Math.ceil(widthPx / CELL);
    this.rows = Math.ceil(heightPx / CELL);
    this.widthPx = this.cols * CELL;
    this.heightPx = this.rows * CELL;
    // 0 = empty, 1 = occupied
    this.cells = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
  }

  /** Check if a rect (in pixels) fits without overlapping occupied cells. */
  canPlace(x, y, w, h) {
    const c0 = Math.floor(x / CELL);
    const r0 = Math.floor(y / CELL);
    const c1 = Math.ceil((x + w) / CELL);
    const r1 = Math.ceil((y + h) / CELL);
    if (c0 < 0 || r0 < 0 || c1 > this.cols || r1 > this.rows) return false;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (this.cells[r][c]) return false;
      }
    }
    return true;
  }

  /** Mark a rect as occupied. */
  occupy(x, y, w, h) {
    const c0 = Math.floor(x / CELL);
    const r0 = Math.floor(y / CELL);
    const c1 = Math.ceil((x + w) / CELL);
    const r1 = Math.ceil((y + h) / CELL);
    for (let r = Math.max(0, r0); r < Math.min(this.rows, r1); r++) {
      for (let c = Math.max(0, c0); c < Math.min(this.cols, c1); c++) {
        this.cells[r][c] = 1;
      }
    }
  }

  /**
   * Find first open position for an item of given pixel size.
   * Scans left-to-right, top-to-bottom at CELL intervals.
   * @param {number} w - item width px
   * @param {number} h - item height px
   * @param {number} [marginCells=0] - extra cells of margin around the item
   * @returns {{ x: number, y: number } | null}
   */
  findSpot(w, h, marginCells = 0) {
    const mPx = marginCells * CELL;
    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c <= this.cols; c++) {
        const px = c * CELL + mPx;
        const py = r * CELL + mPx;
        if (this.canPlace(px, py, w + mPx * 2, h + mPx * 2)) {
          return { x: px, y: py };
        }
      }
    }
    return null;
  }

  /**
   * Find spots along the top edge (wall-adjacent, for whiteboards/certs).
   * @param {number} w - item width px
   * @param {number} h - item height px
   * @returns {{ x: number, y: number } | null}
   */
  findWallSpot(w, h) {
    for (let c = 0; c <= this.cols; c++) {
      const px = c * CELL;
      if (this.canPlace(px, 0, w, h)) {
        return { x: px, y: 0 };
      }
    }
    return null;
  }

  /**
   * Find an empty corner region.
   * @param {number} w - item width px
   * @param {number} h - item height px
   * @returns {{ x: number, y: number } | null}
   */
  findCornerSpot(w, h) {
    // Try four corners: top-left, top-right, bottom-left, bottom-right
    const corners = [
      { x: 0, y: 0 },
      { x: this.widthPx - w, y: 0 },
      { x: 0, y: this.heightPx - h },
      { x: this.widthPx - w, y: this.heightPx - h },
    ];
    for (const pos of corners) {
      if (pos.x >= 0 && pos.y >= 0 && this.canPlace(pos.x, pos.y, w, h)) {
        return pos;
      }
    }
    return null;
  }
}

// ─── Random Helpers ──────────────────────────────────────────────────────

function pick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _idCounter = 0;
function uid(prefix) {
  return `${prefix}_${++_idCounter}`;
}

// ─── Archetype Recipes ──────────────────────────────────────────────────

/**
 * Each archetype returns a function that populates items[] given a palette, grid, and spec.
 * Items use bottom-center origin, so position (x,y) = center-bottom of the sprite.
 * But template coords are top-left relative; RoomAssembly places with setOrigin(0.5, 1).
 * We store x as the center-x offset and y as the bottom-y offset within the room.
 */

function placeWorkstations(items, palette, grid, count) {
  const DESK_GAP_Y = 64; // vertical gap between chair bottom and next desk
  const chairBehindOffset = 64; // how far behind the desk the chair sits

  // Pick desk variant pool (small desks work best for rows), sorted small→large
  const deskPool = palette.desks
    .filter(d => d.w <= 128 && d.h <= 96)
    .sort((a, b) => (a.w * a.h) - (b.w * b.h));
  if (deskPool.length === 0) return;

  const chairPool = palette.frontChairs.length > 0 ? palette.frontChairs : palette.chairs;
  const setupPool = palette.deskSetups;

  let placed = 0;
  let curY = CELL * 2; // start 2 cells from top (room for wall decor above)

  while (placed < count) {
    // How many can fit on this row?
    const desk = pick(deskPool);
    if (!desk) break;

    const deskW = desk.w;
    const deskH = desk.h;
    const slotW = Math.max(deskW, CELL * 4); // min 128px per slot for spacing

    const perRow = Math.min(count - placed, Math.floor(grid.widthPx / slotW));
    if (perRow === 0) break;

    const rowW = perRow * slotW;
    const startX = Math.floor((grid.widthPx - rowW) / 2); // center the row

    for (let i = 0; i < perRow && placed < count; i++) {
      const cx = startX + i * slotW + Math.floor(slotW / 2);
      const deskTopLeftX = cx - Math.floor(deskW / 2);
      const deskTopLeftY = curY;

      // Check grid space for desk + chair below
      if (!grid.canPlace(deskTopLeftX, deskTopLeftY, deskW, deskH + chairBehindOffset)) {
        continue;
      }

      // Place desk
      const deskChoice = pick(deskPool);
      const deskId = uid('desk');
      items.push({
        id: deskChoice.id,
        instanceId: deskId,
        x: cx,
        y: deskTopLeftY + deskH // bottom of desk
      });
      grid.occupy(deskTopLeftX, deskTopLeftY, deskChoice.w, deskChoice.h);

      // Place chair behind desk (front-facing chair below the desk)
      const chair = pick(chairPool);
      if (chair) {
        const chairX = cx;
        const chairY = deskTopLeftY + deskH + chairBehindOffset;
        items.push({
          id: chair.id,
          instanceId: uid('chair'),
          x: chairX,
          y: chairY
        });
        grid.occupy(chairX - Math.floor(chair.w / 2), deskTopLeftY + deskH, chair.w, chairBehindOffset);
      }

      // Place desk setup as decor on desk
      const setup = pick(setupPool);
      if (setup) {
        items.push({
          id: setup.id,
          instanceId: uid('setup'),
          parentInstanceId: deskId,
          x: 0,
          y: 0
        });
      }

      placed++;
    }

    curY += deskH + chairBehindOffset + DESK_GAP_Y;
    if (curY + CELL * 4 > grid.heightPx) break; // no room for another row
  }
}

function placeConferenceLayout(items, palette, grid, chairCount) {
  // Center the conference table
  const table = palette.all['conference_table'];
  if (!table) return;

  const cx = Math.floor(grid.widthPx / 2);
  const cy = Math.floor(grid.heightPx / 2);
  const tblId = uid('conf_tbl');

  items.push({
    id: 'conference_table',
    instanceId: tblId,
    x: cx,
    y: cy + Math.floor(table.h / 2)
  });
  grid.occupy(cx - Math.floor(table.w / 2), cy - Math.floor(table.h / 2), table.w, table.h);

  // Place chairs around the table
  const positions = [];
  const spacing = 80;

  // Chairs above table (back-facing, facing down at table)
  const topY = cy - Math.floor(table.h / 2) - 12;
  // Chairs below table (front-facing, facing up at table)
  const botY = cy + Math.floor(table.h / 2) + 44;
  // Side chairs
  const leftX = cx - Math.floor(table.w / 2) - 36;
  const rightX = cx + Math.floor(table.w / 2) + 36;

  const halfSeats = Math.floor(chairCount / 2);
  const topSpacing = table.w / (halfSeats + 1);
  const botSpacing = table.w / (Math.max(1, chairCount - halfSeats) + 1);

  for (let i = 0; i < halfSeats; i++) {
    const chairX = cx - Math.floor(table.w / 2) + Math.floor(topSpacing * (i + 1));
    positions.push({ x: chairX, y: topY, pool: palette.backChairs.length > 0 ? palette.backChairs : palette.chairs });
  }
  for (let i = 0; i < chairCount - halfSeats; i++) {
    const chairX = cx - Math.floor(table.w / 2) + Math.floor(botSpacing * (i + 1));
    positions.push({ x: chairX, y: botY, pool: palette.frontChairs.length > 0 ? palette.frontChairs : palette.chairs });
  }

  // If 6+ chairs, add side chairs
  if (chairCount >= 6 && palette.sideChairs.length >= 2) {
    const sideLeft = palette.sideChairs.find(c => /left/.test(c.id));
    const sideRight = palette.sideChairs.find(c => /right/.test(c.id));
    if (sideLeft) {
      positions.push({ x: leftX, y: cy, pool: [sideLeft] });
    }
    if (sideRight) {
      positions.push({ x: rightX, y: cy, pool: [sideRight] });
    }
  }

  positions.slice(0, chairCount).forEach(pos => {
    const chair = pick(pos.pool);
    if (chair) {
      items.push({
        id: chair.id,
        instanceId: uid('ch'),
        x: pos.x,
        y: pos.y
      });
    }
  });

  // Place whiteboards along top wall
  const wb = pick(palette.whiteboards);
  if (wb) {
    items.push({
      id: wb.id,
      instanceId: uid('wb'),
      x: cx,
      y: CELL
    });
  }
}

function placeBreakroomLayout(items, palette, grid) {
  let curX = CELL;

  // Vending machines along top wall
  const vendingPool = shuffle(palette.vendingMachines);
  for (let i = 0; i < Math.min(3, vendingPool.length); i++) {
    const v = vendingPool[i];
    if (curX + v.w <= grid.widthPx - CELL) {
      items.push({
        id: v.id,
        instanceId: uid('vend'),
        x: curX + Math.floor(v.w / 2),
        y: CELL + v.h
      });
      grid.occupy(curX, CELL, v.w, v.h);
      curX += v.w + CELL;
    }
  }

  // Sofas along bottom
  const sofaPool = shuffle(palette.sofas);
  let sofaX = CELL;
  const sofaY = grid.heightPx - CELL;
  for (let i = 0; i < Math.min(2, sofaPool.length); i++) {
    const s = sofaPool[i];
    if (sofaX + s.w <= grid.widthPx - CELL) {
      items.push({
        id: s.id,
        instanceId: uid('sofa'),
        x: sofaX + Math.floor(s.w / 2),
        y: sofaY
      });
      grid.occupy(sofaX, sofaY - s.h, s.w, s.h);
      sofaX += s.w + CELL;
    }
  }

  // Small table between sofas
  const tbl = pick(palette.tables);
  if (tbl && sofaX + tbl.w <= grid.widthPx) {
    items.push({
      id: tbl.id,
      instanceId: uid('tbl'),
      x: Math.floor(grid.widthPx / 2),
      y: sofaY - CELL
    });
  }
}

function placeManagerLayout(items, palette, grid) {
  // Desk in upper-center area
  const desk = pick(palette.desks.filter(d => d.w >= 64 && d.w <= 128));
  if (!desk) return;

  const cx = Math.floor(grid.widthPx / 2);
  const deskY = CELL * 4;
  const deskId = uid('mgr_desk');

  items.push({
    id: desk.id,
    instanceId: deskId,
    x: cx,
    y: deskY + desk.h
  });
  grid.occupy(cx - Math.floor(desk.w / 2), deskY, desk.w, desk.h);

  // Chair behind desk
  const chair = pick(palette.chairs.filter(c => /orange|back/.test(c.id))) || pick(palette.chairs);
  if (chair) {
    items.push({
      id: chair.id,
      instanceId: uid('mgr_ch'),
      x: cx,
      y: deskY + desk.h + 56
    });
  }

  // Desk setup on desk
  const setup = pick(palette.deskSetups);
  if (setup) {
    items.push({
      id: setup.id,
      instanceId: uid('mgr_setup'),
      parentInstanceId: deskId,
      x: 0,
      y: 0
    });
  }

  // Bookshelf on left wall
  const shelf = pick(palette.bookshelves);
  if (shelf) {
    items.push({
      id: shelf.id,
      instanceId: uid('mgr_shelf'),
      x: CELL + Math.floor(shelf.w / 2),
      y: CELL * 3 + shelf.h
    });
    grid.occupy(CELL, CELL * 3, shelf.w, shelf.h);
  }

  // Sofa at bottom
  const sofa = pick(palette.sofas);
  if (sofa) {
    items.push({
      id: sofa.id,
      instanceId: uid('mgr_sofa'),
      x: cx,
      y: grid.heightPx - CELL
    });
  }
}

function placeReceptionLayout(items, palette, grid) {
  const cx = Math.floor(grid.widthPx / 2);

  // Reception desk center
  const desk = palette.all['box_desk'] || pick(palette.desks);
  if (desk) {
    const deskId = uid('rc_desk');
    items.push({
      id: desk.id,
      instanceId: deskId,
      x: cx,
      y: CELL * 4 + desk.h
    });
    grid.occupy(cx - Math.floor(desk.w / 2), CELL * 4, desk.w, desk.h);

    const chair = pick(palette.backChairs.length > 0 ? palette.backChairs : palette.chairs);
    if (chair) {
      items.push({
        id: chair.id,
        instanceId: uid('rc_ch'),
        x: cx,
        y: CELL * 4 + desk.h + 48
      });
    }

    const setup = pick(palette.deskSetups);
    if (setup) {
      items.push({
        id: setup.id,
        instanceId: uid('rc_setup'),
        parentInstanceId: deskId,
        x: 0, y: 0
      });
    }
  }

  // Waiting row at bottom
  const waitRow = palette.all['waiting_row_4'];
  if (waitRow) {
    items.push({
      id: 'waiting_row_4',
      instanceId: uid('rc_wait1'),
      x: cx - 80,
      y: grid.heightPx - CELL * 2
    });
    items.push({
      id: 'waiting_row_4',
      instanceId: uid('rc_wait2'),
      x: cx + 80,
      y: grid.heightPx - CELL * 2
    });
  }
}

function placeStorageLayout(items, palette, grid) {
  // Bookshelves along walls
  let curX = CELL;
  const shelfPool = shuffle(palette.bookshelves);
  for (let i = 0; i < Math.min(3, shelfPool.length); i++) {
    const s = shelfPool[i];
    if (curX + s.w <= grid.widthPx - CELL) {
      items.push({
        id: s.id,
        instanceId: uid('st_shelf'),
        x: curX + Math.floor(s.w / 2),
        y: grid.heightPx - CELL
      });
      grid.occupy(curX, grid.heightPx - s.h - CELL, s.w, s.h);
      curX += s.w + CELL;
    }
  }

  // Printer + shredder on one side
  const printer = palette.all['printer_paper'] || pick(palette.miscFurniture.filter(m => /printer/.test(m.id)));
  if (printer) {
    items.push({
      id: printer.id,
      instanceId: uid('st_print'),
      x: CELL + Math.floor(printer.w / 2),
      y: CELL * 3 + printer.h
    });
  }

  const shredder = pick(palette.miscFurniture.filter(m => /shredder/.test(m.id)));
  if (shredder) {
    items.push({
      id: shredder.id,
      instanceId: uid('st_shred'),
      x: CELL * 4 + Math.floor(shredder.w / 2),
      y: CELL * 3 + shredder.h
    });
  }
}

// ─── Decor Pass ──────────────────────────────────────────────────────────

function addDecorPass(items, palette, grid) {
  // Plants in corners
  const plantPool = shuffle(palette.plants);
  let plantIdx = 0;

  const plant = () => plantPool[plantIdx++ % Math.max(1, plantPool.length)];

  // Try each corner
  const corners = [
    { x: CELL, y: CELL * 2 },
    { x: grid.widthPx - CELL * 2, y: CELL * 2 },
    { x: CELL, y: grid.heightPx - CELL },
    { x: grid.widthPx - CELL * 2, y: grid.heightPx - CELL },
  ];

  for (const pos of corners) {
    if (plantPool.length === 0) break;
    const p = plant();
    if (p && grid.canPlace(pos.x, pos.y - p.h, p.w, p.h)) {
      items.push({
        id: p.id,
        instanceId: uid('plant'),
        x: pos.x + Math.floor(p.w / 2),
        y: pos.y
      });
      grid.occupy(pos.x, pos.y - p.h, p.w, p.h);
    }
  }

  // Wall decor along top edge (whiteboards, certs, ac units)
  const wallPool = shuffle([...palette.whiteboards, ...palette.wallDecor]);
  let wallX = CELL * 2;
  let wallPlaced = 0;
  for (const wd of wallPool) {
    if (wallPlaced >= 3) break;
    if (wallX + wd.w > grid.widthPx - CELL) break;
    if (grid.canPlace(wallX, 0, wd.w, wd.h)) {
      items.push({
        id: wd.id,
        instanceId: uid('wall'),
        x: wallX + Math.floor(wd.w / 2),
        y: wd.h, // bottom-origin, so y = height from top
        z_index: wd.depth || 1.2
      });
      grid.occupy(wallX, 0, wd.w, wd.h);
      wallX += wd.w + CELL;
      wallPlaced++;
    }
  }

  // Trash can near desks if not already placed
  const hasTrash = items.some(i => /trash/.test(i.id));
  if (!hasTrash) {
    const trash = palette.all['trash_can'] || pick(palette.miscFurniture.filter(m => /trash/.test(m.id)));
    if (trash) {
      const spot = grid.findSpot(trash.w, trash.h);
      if (spot) {
        items.push({
          id: trash.id,
          instanceId: uid('trash'),
          x: spot.x + Math.floor(trash.w / 2),
          y: spot.y + trash.h
        });
        grid.occupy(spot.x, spot.y, trash.w, trash.h);
      }
    }
  }
}

// ─── Optional: Partition Pass ────────────────────────────────────────────

function addPartitions(items, palette, grid, deskCount) {
  if (deskCount < 4 || palette.partitions.length === 0) return;

  // Try to place dividers between desk rows
  const divider = pick(palette.partitions.filter(p => p.w <= 160));
  if (!divider) return;

  // Place up to 2 dividers at mid-height
  const midY = Math.floor(grid.heightPx / 2);
  for (let pass = 0; pass < 2; pass++) {
    const dx = CELL * 2 + pass * Math.floor(grid.widthPx / 2);
    if (grid.canPlace(dx, midY, divider.w, divider.h)) {
      items.push({
        id: divider.id,
        instanceId: uid('div'),
        x: dx + Math.floor(divider.w / 2),
        y: midY + divider.h,
        z_index: 1.7
      });
      grid.occupy(dx, midY, divider.w, divider.h);
    }
  }
}

// ─── Main Generator ─────────────────────────────────────────────────────

export class RoomGenerator {
  /**
   * @param {object} catalogData - furniture_catalog_openplan.json (full object with .objects)
   */
  constructor(catalogData) {
    const objects = catalogData?.objects || catalogData || {};
    this.palette = buildPalette(objects);
    this._counter = 0;
  }

  /**
   * Generate a room template.
   * @param {object} spec
   * @param {string} spec.purpose    - 'workspace' | 'conference' | 'breakroom' | 'manager_office' | 'reception' | 'storage'
   * @param {number} [spec.width]    - room width in px (default: auto-sized)
   * @param {number} [spec.height]   - room height in px (default: auto-sized)
   * @param {number} [spec.occupants] - number of NPCs (for workspace/conference)
   * @param {string} [spec.activity]  - primary activity hint
   * @returns {{ description: string, items: Array<object> }}
   */
  generate(spec) {
    const purpose = spec.purpose || 'workspace';
    const occupants = spec.occupants || 4;

    // Auto-size room based on purpose and occupants
    const size = this._autoSize(purpose, occupants, spec.width, spec.height);
    const grid = new OccupancyGrid(size.width, size.height);
    const items = [];

    // Reset ID counter for this generation
    _idCounter = this._counter;

    switch (purpose) {
      case 'workspace':
        placeWorkstations(items, this.palette, grid, occupants);
        addPartitions(items, this.palette, grid, occupants);
        break;
      case 'conference':
        placeConferenceLayout(items, this.palette, grid, Math.max(4, occupants));
        break;
      case 'breakroom':
        placeBreakroomLayout(items, this.palette, grid);
        break;
      case 'manager_office':
        placeManagerLayout(items, this.palette, grid);
        break;
      case 'reception':
        placeReceptionLayout(items, this.palette, grid);
        break;
      case 'storage':
        placeStorageLayout(items, this.palette, grid);
        break;
      default:
        console.warn(`⚠️ Unknown room purpose: ${purpose}, falling back to workspace`);
        placeWorkstations(items, this.palette, grid, occupants);
        break;
    }

    // Decor pass — plants, wall art, trash cans
    addDecorPass(items, this.palette, grid);

    this._counter = _idCounter;

    const template = {
      description: `Generated ${purpose} room (${size.width}x${size.height}, ${occupants} occupants)`,
      items
    };

    console.log(`🏗️ Generated '${purpose}' — ${items.length} items in ${size.width}x${size.height}px`);
    return template;
  }

  /**
   * Generate and register a room directly into a RoomAssembly instance.
   * @param {RoomAssembly} assembly - initialized RoomAssembly
   * @param {object} spec - same as generate()
   * @param {string} [name] - template name (auto-generated if omitted)
   * @returns {string} the template name
   */
  generateAndRegister(assembly, spec, name) {
    const templateName = name || `gen_${spec.purpose}_${Date.now()}`;
    const template = this.generate(spec);
    assembly.templates[templateName] = template;
    return templateName;
  }

  /** Auto-size a room based on purpose and occupant count. */
  _autoSize(purpose, occupants, userW, userH) {
    if (userW && userH) return { width: userW, height: userH };

    const defaults = {
      workspace: {
        width: Math.max(384, Math.ceil(occupants / 2) * 192),
        height: Math.max(384, Math.ceil(occupants / 2) * 192 + 128)
      },
      conference: { width: 384, height: 320 },
      breakroom: { width: 384, height: 288 },
      manager_office: { width: 320, height: 288 },
      reception: { width: 384, height: 320 },
      storage: { width: 320, height: 256 }
    };

    const d = defaults[purpose] || defaults.workspace;
    return {
      width: userW || d.width,
      height: userH || d.height
    };
  }
}

// Also export for CommonJS / test usage
export default RoomGenerator;
