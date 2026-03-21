const fs = require('fs');
const { PNG } = require('pngjs');

function crop(png, x0, y0, w, h) {
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) continue;
      const sidx = (png.width * sy + sx) << 2;
      const didx = (w * y + x) << 2;
      out.data[didx + 0] = png.data[sidx + 0];
      out.data[didx + 1] = png.data[sidx + 1];
      out.data[didx + 2] = png.data[sidx + 2];
      out.data[didx + 3] = png.data[sidx + 3];
    }
  }
  return out;
}

function resizeNearest(src, w, h) {
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor((y / h) * src.height);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x / w) * src.width);
      const sidx = (src.width * sy + sx) << 2;
      const didx = (w * y + x) << 2;
      out.data[didx + 0] = src.data[sidx + 0];
      out.data[didx + 1] = src.data[sidx + 1];
      out.data[didx + 2] = src.data[sidx + 2];
      out.data[didx + 3] = src.data[sidx + 3];
    }
  }
  return out;
}

function scoreTile(tile, templ, opts) {
  const { bgR, bgG, bgB, bgTol } = opts;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < tile.data.length; i += 4) {
    const tr = tile.data[i + 0];
    const tg = tile.data[i + 1];
    const tb = tile.data[i + 2];
    const ta = tile.data[i + 3];
    if (ta === 0) continue;
    const isBg = Math.abs(tr - bgR) <= bgTol && Math.abs(tg - bgG) <= bgTol && Math.abs(tb - bgB) <= bgTol;
    if (isBg) continue;

    const rr = templ.data[i + 0];
    const rg = templ.data[i + 1];
    const rb = templ.data[i + 2];
    const ra = templ.data[i + 3];
    if (ra === 0) continue;

    sum += Math.abs(tr - rr) + Math.abs(tg - rg) + Math.abs(tb - rb);
    count++;
  }
  if (count === 0) return Infinity;
  return sum / count;
}

function extractTile(sheet, tx, ty, tileSize) {
  return crop(sheet, tx * tileSize, ty * tileSize, tileSize, tileSize);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 7) {
    console.error('Usage: node match-tile.js <sheet.png> <shot.png> <cropX> <cropY> <cropW> <cropH> <tileSize=32>');
    process.exit(1);
  }
  const [sheetPath, shotPath, cxS, cyS, cwS, chS, tileS] = args;
  const cx = parseInt(cxS, 10);
  const cy = parseInt(cyS, 10);
  const cw = parseInt(cwS, 10);
  const ch = parseInt(chS, 10);
  const tileSize = parseInt(tileS || '32', 10);

  const sheet = PNG.sync.read(fs.readFileSync(sheetPath));
  const shot = PNG.sync.read(fs.readFileSync(shotPath));

  const bg = { r: sheet.data[0], g: sheet.data[1], b: sheet.data[2] }; // top-left
  const templCrop = crop(shot, cx, cy, cw, ch);
  const templ = resizeNearest(templCrop, tileSize, tileSize);

  let best = null;
  const tilesX = Math.floor(sheet.width / tileSize);
  const tilesY = Math.floor(sheet.height / tileSize);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const t = extractTile(sheet, tx, ty, tileSize);
      const s = scoreTile(t, templ, { bgR: bg.r, bgG: bg.g, bgB: bg.b, bgTol: 2 });
      if (!best || s < best.score) best = { tx, ty, score: s };
    }
  }

  process.stdout.write(JSON.stringify({ best, crop: { cx, cy, cw, ch }, tileSize }, null, 2));
  process.stdout.write('\n');
}

main();

