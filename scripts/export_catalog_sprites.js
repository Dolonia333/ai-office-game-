/**
 * Export every sprite from a catalog as a PNG so you can open and confirm them.
 * Sheet paths: see data/sheet_registry.json (canonical list of LimeZu Modern Office sheet paths).
 * Usage (from repo root or pixel-office-game):
 *   node scripts/export_catalog_sprites.js [--catalog openplan|modern_office_32|...|all] [--out dir]
 *   node scripts/export_catalog_sprites.js --list-sheets   # print sheets from registry
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const PIXEL_GAME_BASE = path.join(__dirname, '..', '..', 'pixel game stuff', 'pixel game assets and stuff');
const MODERN_OFFICE_BLACK = path.join(PIXEL_GAME_BASE, 'Modern_Office_Revamped_v1.2', '2_Modern_Office_Black_Shadow');
const MODERN_OFFICE_BASE = path.join(PIXEL_GAME_BASE, 'Modern_Office_Revamped_v1.2');

function getSheetPathFromRegistry(sheetId) {
  const regPath = path.join(__dirname, '..', 'data', 'sheet_registry.json');
  if (!fs.existsSync(regPath)) return null;
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const sheet = (reg.sheets || []).find(s => s.id === sheetId);
  return sheet ? sheet.path : null;
}

function loadPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function cropToPng(src, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx >= 0 && sy >= 0 && sx < src.width && sy < src.height) {
        const si = (src.width * sy + sx) << 2;
        const oi = (out.width * dy + dx) << 2;
        out.data[oi] = src.data[si];
        out.data[oi + 1] = src.data[si + 1];
        out.data[oi + 2] = src.data[si + 2];
        out.data[oi + 3] = src.data[si + 3];
      }
    }
  }
  return out;
}

function exportOpenplan(outDir) {
  const catalogPath = path.join(__dirname, '..', 'data', 'furniture_catalog_openplan.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const sheetPath = getSheetPathFromRegistry('modern_office_black_shadow_32') || path.join(MODERN_OFFICE_BLACK, 'Modern_Office_Black_Shadow_32x32.png');
  if (!fs.existsSync(sheetPath)) {
    console.error('Sheet not found:', sheetPath);
    return 0;
  }
  const sheet = loadPng(sheetPath);
  fs.mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const [id, def] of Object.entries(catalog.objects)) {
    const x = def.x || 0;
    const y = def.y || 0;
    const w = Math.max(1, def.w || 32);
    const h = Math.max(1, def.h || 32);
    const out = cropToPng(sheet, x, y, w, h);
    const safe = id.replace(/[^a-z0-9_]/gi, '_');
    fs.writeFileSync(path.join(outDir, `${safe}.png`), PNG.sync.write(out));
    count++;
  }
  return count;
}

function exportAutoCatalog(catalogName, outDir) {
  const catalogPath = path.join(__dirname, '..', 'data', `catalog_${catalogName}.auto.json`);
  if (!fs.existsSync(catalogPath)) {
    console.error('Catalog not found:', catalogPath);
    return 0;
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const info = catalog.info || {};
  const sheetPath = info.source || path.join(MODERN_OFFICE_BASE, `${catalogName.replace('modern_office_', 'Modern_Office_')}.png`);
  if (!fs.existsSync(sheetPath)) {
    console.error('Sheet not found:', sheetPath);
    return 0;
  }
  const sheet = loadPng(sheetPath);
  fs.mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const [id, def] of Object.entries(catalog.objects)) {
    const r = def.rect || {};
    const x = r.x || 0;
    const y = r.y || 0;
    const w = Math.max(1, r.w || 32);
    const h = Math.max(1, r.h || 32);
    const out = cropToPng(sheet, x, y, w, h);
    const safe = id.replace(/[^a-z0-9_]/gi, '_').slice(0, 80);
    fs.writeFileSync(path.join(outDir, `${safe}.png`), PNG.sync.write(out));
    count++;
  }
  return count;
}

function main() {
  const args = process.argv.slice(2);
  let catalog = 'openplan';
  let outDir = path.join(__dirname, '..', 'out', 'verify_sprites');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--catalog' && args[i + 1]) {
      catalog = args[i + 1];
      i++;
    } else if (args[i] === '--out' && args[i + 1]) {
      outDir = args[i + 1];
      i++;
    } else if (args[i] === '--list-sheets') {
      const regPath = path.join(__dirname, '..', 'data', 'sheet_registry.json');
      if (!fs.existsSync(regPath)) {
        console.error('No sheet_registry.json found at', regPath);
        process.exit(1);
      }
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      (reg.sheets || []).forEach(s => console.log(s.id, s.grid, s.path));
      return;
    }
  }

  let count = 0;
  if (catalog === 'openplan') {
    count = exportOpenplan(path.join(outDir, 'openplan'));
    console.log('Exported', count, 'sprites to', path.join(outDir, 'openplan'));
  } else if (catalog === 'modern_office_32' || catalog === 'modern_office_16' || catalog === 'modern_office_48') {
    count = exportAutoCatalog(catalog, path.join(outDir, catalog));
    console.log('Exported', count, 'sprites to', path.join(outDir, catalog));
  } else if (catalog === 'all') {
    const n1 = exportOpenplan(path.join(outDir, 'openplan'));
    const n2 = exportAutoCatalog('modern_office_32', path.join(outDir, 'modern_office_32'));
    const n3 = exportAutoCatalog('modern_office_16', path.join(outDir, 'modern_office_16'));
    const n4 = exportAutoCatalog('modern_office_48', path.join(outDir, 'modern_office_48'));
    count = n1 + n2 + n3 + n4;
    console.log('Exported openplan:', n1, ', modern_office_32:', n2, ', modern_office_16:', n3, ', modern_office_48:', n4);
    console.log('Total:', count, '→', outDir);
  } else {
    console.error('Usage: node export_catalog_sprites.js [--catalog openplan|modern_office_32|modern_office_16|modern_office_48|all] [--out dir]');
    process.exit(1);
  }
}

main();
