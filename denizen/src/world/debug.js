export function drawWorldDebug(scene, world) {
  const g = scene.add.graphics();
  g.setDepth(3000);

  // Rooms
  g.lineStyle(2, 0x22c55e, 0.9);
  for (const r of world.rooms || []) {
    g.strokeRect(r.x, r.y, r.w, r.h);
  }

  // Corridors
  g.lineStyle(2, 0x60a5fa, 0.9);
  for (const c of world.corridors || []) {
    g.strokeRect(c.x, c.y, c.w, c.h);
  }

  // Outdoor
  g.lineStyle(2, 0xf59e0b, 0.9);
  for (const o of world.outdoor || []) {
    g.strokeRect(o.x, o.y, o.w, o.h);
  }

  const t = scene.add.text(12, 12, `seed: ${world.seed}\nrooms: ${(world.rooms||[]).length}\ncorridors: ${(world.corridors||[]).length}`, {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
    fontSize: '12px',
    color: '#e5e7eb',
    backgroundColor: 'rgba(2,6,23,0.7)',
    padding: { x: 8, y: 6 }
  });
  t.setDepth(3001);
  t.setScrollFactor(0);
}

