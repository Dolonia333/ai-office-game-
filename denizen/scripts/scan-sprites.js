const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const hasValue = next !== undefined && !next.startsWith('--');
      args[key] = hasValue ? next : true;
      if (hasValue) i++;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function parseRgb(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  // formats: "0,0,0" or "#000000" / "#000"
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  }
  const parts = s.split(',').map((p) => parseInt(p.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

function colorNear(r, g, b, bg, tol) {
  if (!bg) return false;
  return (
    Math.abs(r - bg.r) <= tol &&
    Math.abs(g - bg.g) <= tol &&
    Math.abs(b - bg.b) <= tol
  );
}

function getPixel(png, x, y) {
  const idx = (png.width * y + x) << 2;
  return {
    r: png.data[idx + 0],
    g: png.data[idx + 1],
    b: png.data[idx + 2],
    a: png.data[idx + 3],
  };
}

function cellHasPixels(png, startX, startY, size, minAlpha, bg, bgTol) {
  const endX = Math.min(png.width, startX + size);
  const endY = Math.min(png.height, startY + size);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (png.width * y + x) << 2;
      const a = png.data[idx + 3];
      if (a > minAlpha) {
        const r = png.data[idx + 0];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        if (bg && colorNear(r, g, b, bg, bgTol)) continue;
        return true;
      }
    }
  }
  return false;
}

function collectOccupiedCells(png, grid, minAlpha, bg, bgTol) {
  const cells = new Set();
  for (let y = 0; y < png.height; y += grid) {
    for (let x = 0; x < png.width; x += grid) {
      if (cellHasPixels(png, x, y, grid, minAlpha, bg, bgTol)) {
        const cx = Math.floor(x / grid);
        const cy = Math.floor(y / grid);
        cells.add(`${cx},${cy}`);
      }
    }
  }
  return cells;
}

function neighbors(cx, cy) {
  return [
    [cx - 1, cy],
    [cx + 1, cy],
    [cx, cy - 1],
    [cx, cy + 1],
  ];
}

function scanGridCells(png, grid, minAlpha, bg, bgTol) {
  const objects = [];
  let i = 0;
  for (let y = 0; y < png.height; y += grid) {
    for (let x = 0; x < png.width; x += grid) {
      if (!cellHasPixels(png, x, y, grid, minAlpha, bg, bgTol)) continue;
      const cx = Math.floor(x / grid);
      const cy = Math.floor(y / grid);
      objects.push({
        name: `cell_${i++}`,
        rect: { x, y, w: grid, h: grid },
        grid: { x: cx, y: cy, w: 1, h: 1 },
        origin: 'bottom',
        pivot_y: y + grid,
      });
    }
  }
  return objects;
}

function mergeAdjacentCells(cells) {
  // Flood-fill connected components (4-neighborhood) and return bounding boxes in grid units.
  const remaining = new Set(cells);
  const regions = [];

  const popOne = (set) => {
    for (const v of set) return v;
    return null;
  };

  while (remaining.size > 0) {
    const start = popOne(remaining);
    remaining.delete(start);
    const [sx, sy] = start.split(',').map((n) => parseInt(n, 10));
    const stack = [[sx, sy]];
    const seen = new Set([start]);

    while (stack.length) {
      const [cx, cy] = stack.pop();
      for (const [nx, ny] of neighbors(cx, cy)) {
        const key = `${nx},${ny}`;
        if (remaining.has(key) && !seen.has(key)) {
          remaining.delete(key);
          seen.add(key);
          stack.push([nx, ny]);
        }
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const key of seen) {
      const [cx, cy] = key.split(',').map((n) => parseInt(n, 10));
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }
    regions.push({ xGrid: minX, yGrid: minY, wGrid: maxX - minX + 1, hGrid: maxY - minY + 1 });
  }

  regions.sort((a, b) => (a.yGrid - b.yGrid) || (a.xGrid - b.xGrid));
  return regions;
}

function scanSpriteSheet(fileName, grid = 16, minAlpha = 0, bg, bgTol = 0, mode = 'merge') {
  const data = fs.readFileSync(fileName);
  const png = PNG.sync.read(data);

  let objects = [];
  if (mode === 'grid') {
    objects = scanGridCells(png, grid, minAlpha, bg, bgTol);
  } else {
    const occupied = collectOccupiedCells(png, grid, minAlpha, bg, bgTol);
    const regions = mergeAdjacentCells(occupied);
    objects = regions.map((r, i) => ({
      name: `obj_${i}`,
      rect: {
        x: r.xGrid * grid,
        y: r.yGrid * grid,
        w: r.wGrid * grid,
        h: r.hGrid * grid,
      },
      grid: {
        x: r.xGrid,
        y: r.yGrid,
        w: r.wGrid,
        h: r.hGrid,
      },
      origin: 'bottom',
      pivot_y: (r.yGrid + r.hGrid) * grid, // bottom edge in pixels (for bottom anchoring)
    }));
  }

  return {
    file: path.resolve(fileName),
    width: png.width,
    height: png.height,
    grid,
    mode,
    background: bg ? { ...bg } : null,
    backgroundTolerance: bg ? bgTol : 0,
    objects,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const fileName = args._[0];
  if (!fileName) {
    console.error(
      'Usage: node scan-sprites.js <path-to.png> [--grid 16] [--mode merge|grid] [--minAlpha 0] [--bg auto|#000000|0,0,0|none] [--bgTol 0] [--json]'
    );
    process.exit(1);
  }

  const grid = args.grid ? parseInt(args.grid, 10) : 16;
  const mode = args.mode ? String(args.mode) : 'merge';
  const minAlpha = args.minAlpha ? parseInt(args.minAlpha, 10) : 0;
  const asJson = !!args.json;
  const bgMode = args.bg === undefined ? 'none' : String(args.bg);
  const bgTol = args.bgTol ? parseInt(args.bgTol, 10) : 0;

  // Background color handling:
  // - none: don't ignore any colors (use alpha only)
  // - auto: sample top-left pixel as background
  // - "#000" / "#000000" / "0,0,0": explicit background to ignore
  let bg = null;
  if (bgMode && bgMode !== 'none') {
    const data = fs.readFileSync(fileName);
    const png = PNG.sync.read(data);
    if (bgMode === 'auto') {
      const p = getPixel(png, 0, 0);
      bg = { r: p.r, g: p.g, b: p.b };
    } else {
      bg = parseRgb(bgMode);
    }
  }

  const result = scanSpriteSheet(fileName, grid, minAlpha, bg, bgTol, mode);
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
  } else {
    console.log(`# ${result.file} (${result.width}x${result.height}) grid=${result.grid}`);
    result.objects.forEach((o) => {
      console.log(`- ${o.name} @ (${o.rect.x},${o.rect.y}) ${o.rect.w}x${o.rect.h} origin=${o.origin}`);
    });
  }
}

main();
