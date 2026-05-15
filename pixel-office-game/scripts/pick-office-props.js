const fs = require('fs');
const { PNG } = require('pngjs');

function getPixel(png, x, y) {
  const idx = (png.width * y + x) << 2;
  return {
    r: png.data[idx + 0],
    g: png.data[idx + 1],
    b: png.data[idx + 2],
    a: png.data[idx + 3],
  };
}

function tileStats(png, tx, ty, tile) {
  const x0 = tx * tile;
  const y0 = ty * tile;
  let nonBg = 0;
  let sumR = 0, sumG = 0, sumB = 0;
  let blueish = 0;
  let orangeish = 0;
  let beigeish = 0;
  let darkish = 0;
  let bottomDark = 0;

  for (let y = 0; y < tile; y++) {
    for (let x = 0; x < tile; x++) {
      const { r, g, b, a } = getPixel(png, x0 + x, y0 + y);
      if (a === 0) continue;
      // background is (near) black for this sheet
      const isBg = r < 8 && g < 8 && b < 8;
      if (isBg) continue;
      nonBg++;
      sumR += r;
      sumG += g;
      sumB += b;

      if (b > r + 30 && b > g + 30 && b > 120) blueish++;
      if (r > 150 && g > 70 && g < 160 && b < 120 && r > g + 10) orangeish++;
      if (r > 150 && g > 130 && b < 140 && Math.abs(r - g) < 60) beigeish++;
      if (r < 60 && g < 60 && b < 60) darkish++;
      if (y >= tile - 6 && r < 70 && g < 70 && b < 70) bottomDark++;
    }
  }

  const denom = Math.max(1, nonBg);
  return {
    tx, ty,
    nonBg,
    avg: { r: sumR / denom, g: sumG / denom, b: sumB / denom },
    blueish,
    orangeish,
    beigeish,
    darkish,
    bottomDark,
  };
}

function scoreMonitor(s) {
  // monitors: lots of blue pixels, reasonable occupancy
  const occPenalty = (s.nonBg < 80 || s.nonBg > 650) ? 500 : 0;
  return (s.blueish * 4) + (s.nonBg * 0.03) - (s.beigeish * 0.5) - occPenalty;
}

function scoreChair(s) {
  // chairs: orange seat/back + some dark frame + mid occupancy; avoid beige blocks
  const occPenalty = (s.nonBg < 80 || s.nonBg > 650) ? 200 : 0;
  return (s.orangeish * 3) + (s.darkish * 0.8) + (s.nonBg * 0.01) - (s.beigeish * 1.2) - occPenalty;
}

function scoreDeskCandidate2x2(a, b, c, d) {
  // desk pods are beige-ish across 2x2 with some dark legs; avoid screen-blue
  const beige = a.beigeish + b.beigeish + c.beigeish + d.beigeish;
  const blue = a.blueish + b.blueish + c.blueish + d.blueish;
  const occ = a.nonBg + b.nonBg + c.nonBg + d.nonBg;
  const dark = a.darkish + b.darkish + c.darkish + d.darkish;
  const bottomLegs = a.bottomDark + b.bottomDark + c.bottomDark + d.bottomDark;
  // Strongly prefer bottom dark (legs), avoid blue screens, avoid huge filled blocks.
  const occPenalty = (occ > 2400) ? 800 : 0;
  return beige * 1.2 + bottomLegs * 1.8 + dark * 0.05 + occ * 0.01 - blue * 3.0 - occPenalty;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node pick-office-props.js <Modern_Office_Black_Shadow_32x32.png>');
    process.exit(1);
  }

  const png = PNG.sync.read(fs.readFileSync(file));
  const tile = 32;
  const tilesX = Math.floor(png.width / tile);
  const tilesY = Math.floor(png.height / tile);

  const stats = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const s = tileStats(png, tx, ty, tile);
      if (s.nonBg < 10) continue;
      stats.push(s);
    }
  }

  const monitors = [...stats].sort((a, b) => scoreMonitor(b) - scoreMonitor(a)).slice(0, 8);
  const chairs = [...stats].sort((a, b) => scoreChair(b) - scoreChair(a)).slice(0, 8);

  // brute force 2x2 desk candidates (skip edges)
  let bestDesk = null;
  for (let ty = 0; ty < tilesY - 1; ty++) {
    for (let tx = 0; tx < tilesX - 1; tx++) {
      const a = stats.find((s) => s.tx === tx && s.ty === ty);
      const b = stats.find((s) => s.tx === tx + 1 && s.ty === ty);
      const c = stats.find((s) => s.tx === tx && s.ty === ty + 1);
      const d = stats.find((s) => s.tx === tx + 1 && s.ty === ty + 1);
      if (!a || !b || !c || !d) continue;
      const sc = scoreDeskCandidate2x2(a, b, c, d);
      if (!bestDesk || sc > bestDesk.score) bestDesk = { tx, ty, score: sc };
    }
  }

  const out = {
    file,
    tile,
    picks: {
      desk2x2: bestDesk ? { tx: bestDesk.tx, ty: bestDesk.ty, w: 2, h: 2 } : null,
      monitor: monitors[0] ? { tx: monitors[0].tx, ty: monitors[0].ty } : null,
      chair: chairs[0] ? { tx: chairs[0].tx, ty: chairs[0].ty } : null,
    },
    topCandidates: {
      monitors: monitors.map((s) => ({ tx: s.tx, ty: s.ty, score: scoreMonitor(s) })),
      chairs: chairs.map((s) => ({ tx: s.tx, ty: s.ty, score: scoreChair(s) })),
    },
  };

  process.stdout.write(JSON.stringify(out, null, 2));
  process.stdout.write('\n');
}

main();

