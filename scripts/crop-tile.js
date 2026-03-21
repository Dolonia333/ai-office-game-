const fs = require('fs');
const { PNG } = require('pngjs');

function main() {
  const [file, out, txStr, tyStr, wStr, hStr, tileStr] = process.argv.slice(2);
  if (!file || !out || txStr === undefined || tyStr === undefined) {
    console.error('Usage: node crop-tile.js <sheet.png> <out.png> <tx> <ty> [w=1] [h=1] [tile=32]');
    process.exit(1);
  }
  const tx = parseInt(txStr, 10);
  const ty = parseInt(tyStr, 10);
  const w = parseInt(wStr || '1', 10);
  const h = parseInt(hStr || '1', 10);
  const tile = parseInt(tileStr || '32', 10);

  const src = PNG.sync.read(fs.readFileSync(file));
  const x0 = tx * tile;
  const y0 = ty * tile;
  const outPng = new PNG({ width: w * tile, height: h * tile });
  outPng.data.fill(0);

  for (let y = 0; y < outPng.height; y++) {
    for (let x = 0; x < outPng.width; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const sidx = (src.width * sy + sx) << 2;
      const didx = (outPng.width * y + x) << 2;
      outPng.data[didx + 0] = src.data[sidx + 0];
      outPng.data[didx + 1] = src.data[sidx + 1];
      outPng.data[didx + 2] = src.data[sidx + 2];
      outPng.data[didx + 3] = src.data[sidx + 3];
    }
  }

  fs.writeFileSync(out, PNG.sync.write(outPng));
  console.log(`Wrote ${out}`);
}

main();

