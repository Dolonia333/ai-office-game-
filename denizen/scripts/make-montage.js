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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function nearestScaleFit(srcW, srcH, dstW, dstH) {
  const s = Math.min(dstW / srcW, dstH / srcH);
  return Math.max(1, Math.floor(s));
}

function blitNearest(src, dst, sx, sy, sw, sh, dx, dy, scale) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const srcIdx = ((src.width * (sy + y)) + (sx + x)) << 2;
      const r = src.data[srcIdx + 0];
      const g = src.data[srcIdx + 1];
      const b = src.data[srcIdx + 2];
      const a = src.data[srcIdx + 3];
      if (a === 0) continue;
      for (let yy = 0; yy < scale; yy++) {
        for (let xx = 0; xx < scale; xx++) {
          const tx = dx + x * scale + xx;
          const ty = dy + y * scale + yy;
          if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
          const dstIdx = ((dst.width * ty) + tx) << 2;
          dst.data[dstIdx + 0] = r;
          dst.data[dstIdx + 1] = g;
          dst.data[dstIdx + 2] = b;
          dst.data[dstIdx + 3] = a;
        }
      }
    }
  }
}

// Tiny 3x5 digit font (monospace) for labels.
const DIGITS_3x5 = {
  '0': ['###', '# #', '# #', '# #', '###'],
  '1': [' ##', '  #', '  #', '  #', ' ###'],
  '2': ['###', '  #', '###', '#  ', '###'],
  '3': ['###', '  #', ' ##', '  #', '###'],
  '4': ['# #', '# #', '###', '  #', '  #'],
  '5': ['###', '#  ', '###', '  #', '###'],
  '6': ['###', '#  ', '###', '# #', '###'],
  '7': ['###', '  #', '  #', '  #', '  #'],
  '8': ['###', '# #', '###', '# #', '###'],
  '9': ['###', '# #', '###', '  #', '###'],
  '-': ['   ', '   ', '###', '   ', '   '],
};

function putPixel(dst, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return;
  const idx = ((dst.width * y) + x) << 2;
  dst.data[idx + 0] = r;
  dst.data[idx + 1] = g;
  dst.data[idx + 2] = b;
  dst.data[idx + 3] = a;
}

function drawDigit(dst, x, y, ch, scale = 2, color = { r: 255, g: 255, b: 255 }, shadow = true) {
  const glyph = DIGITS_3x5[String(ch)];
  if (!glyph) return 0;

  const w = glyph[0].length * scale;
  const h = glyph.length * scale;
  if (shadow) {
    for (let gy = 0; gy < glyph.length; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== '#') continue;
        for (let yy = 0; yy < scale; yy++) {
          for (let xx = 0; xx < scale; xx++) {
            putPixel(dst, x + gx * scale + xx + 1, y + gy * scale + yy + 1, 0, 0, 0, 255);
          }
        }
      }
    }
  }

  for (let gy = 0; gy < glyph.length; gy++) {
    const row = glyph[gy];
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] !== '#') continue;
      for (let yy = 0; yy < scale; yy++) {
        for (let xx = 0; xx < scale; xx++) {
          putPixel(dst, x + gx * scale + xx, y + gy * scale + yy, color.r, color.g, color.b, 255);
        }
      }
    }
  }

  return w;
}

function drawLabel(dst, x, y, text, scale = 2) {
  const s = String(text);
  let cx = x;
  for (const ch of s) {
    const w = drawDigit(dst, cx, y, ch, scale);
    cx += w + scale; // 1px (scaled) spacing
  }
}

function main() {
  const args = parseArgs(process.argv);
  const scanPath = args._[0];
  const imagePath = args._[1];
  const outPng = args.out || 'montage.png';
  const outJson = args.map || 'montage.map.json';
  const label = args.label === true || String(args.label || '').toLowerCase() === 'true';

  if (!scanPath || !imagePath) {
    console.error(
      'Usage: node make-montage.js <scan.json> <sheet.png> --out montage.png --map montage.map.json [--label true] [--minW 0] [--minH 0] [--maxW 99999] [--maxH 99999] [--limit 200] [--cell 96] [--cols 12]'
    );
    process.exit(1);
  }

  const minW = parseInt(args.minW || '0', 10);
  const minH = parseInt(args.minH || '0', 10);
  const maxW = parseInt(args.maxW || '999999', 10);
  const maxH = parseInt(args.maxH || '999999', 10);
  const limit = parseInt(args.limit || '200', 10);
  const cell = parseInt(args.cell || '96', 10);
  const cols = parseInt(args.cols || '12', 10);
  const pad = parseInt(args.pad || '6', 10);

  const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  const sheet = PNG.sync.read(fs.readFileSync(imagePath));

  const all = Array.isArray(scan.objects) ? scan.objects : [];
  const filtered = all.filter((o) => {
    const r = o?.rect;
    if (!r) return false;
    if (r.w < minW || r.h < minH) return false;
    if (r.w > maxW || r.h > maxH) return false;
    return true;
  });

  const picked = filtered.slice(0, clamp(limit, 1, filtered.length));
  const rows = Math.ceil(picked.length / cols);
  const outW = cols * (cell + pad) + pad;
  const outH = rows * (cell + pad) + pad;

  const out = new PNG({ width: outW, height: outH });
  out.data.fill(0);

  const map = {
    source: {
      scanPath: path.resolve(scanPath),
      imagePath: path.resolve(imagePath),
      width: sheet.width,
      height: sheet.height,
    },
    cell,
    pad,
    cols,
    count: picked.length,
    items: [],
  };

  picked.forEach((obj, i) => {
    const r = obj.rect;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = pad + col * (cell + pad);
    const y0 = pad + row * (cell + pad);

    const scale = nearestScaleFit(r.w, r.h, cell, cell);
    const dw = r.w * scale;
    const dh = r.h * scale;
    const dx = x0 + Math.floor((cell - dw) / 2);
    const dy = y0 + Math.floor((cell - dh) / 2);

    blitNearest(sheet, out, r.x, r.y, r.w, r.h, dx, dy, scale);
    if (label) {
      // Label with the montage index (i) and grid coords (gx,gy) when available.
      const gx = obj.grid?.x;
      const gy = obj.grid?.y;
      const tag = (gx !== undefined && gy !== undefined) ? `${i}-${gx},${gy}` : `${i}`;
      drawLabel(out, x0 + 4, y0 + 4, tag, 2);
    }
    map.items.push({
      i,
      name: obj.name,
      rect: { ...r },
      grid: obj.grid ? { ...obj.grid } : null,
    });
  });

  fs.writeFileSync(outPng, PNG.sync.write(out));
  fs.writeFileSync(outJson, JSON.stringify(map, null, 2));
  console.log(`Wrote ${outPng} and ${outJson} (${picked.length} items).`);
}

main();

