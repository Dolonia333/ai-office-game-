/**
 * Build a manifest JSON for singles PNGs so the browser UI can list them.
 *
 * Usage:
 *   node scripts/build_singles_manifest.js --in assets/modern_office_singles_16 --out out/singles/modern_office_singles_16.manifest.json
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function parseArgs(argv) {
  const args = { inDir: null, outFile: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' && argv[i + 1]) { args.inDir = argv[++i]; continue; }
    if (a === '--out' && argv[i + 1]) { args.outFile = argv[++i]; continue; }
  }
  if (!args.inDir || !args.outFile) {
    console.error('Usage: node build_singles_manifest.js --in <dir> --out <file>');
    process.exit(1);
  }
  return args;
}

function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height };
}

function main() {
  const { inDir, outFile } = parseArgs(process.argv);
  const absIn = path.resolve(inDir);
  const files = fs.readdirSync(absIn)
    .filter(f => f.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const entries = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    const abs = path.join(absIn, name);
    const { w, h } = readPngSize(abs);
    entries.push({
      index: i,
      filename: name,
      url: `assets/${path.basename(inDir)}/${name}`.replace(/\\/g, '/'),
      w,
      h
    });
  }

  const out = {
    info: {
      generatedAt: new Date().toISOString(),
      inDir: inDir.replace(/\\/g, '/'),
      count: entries.length
    },
    entries
  };

  const absOut = path.resolve(outFile);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote', outFile, '(' + entries.length + ' entries)');
}

main();

