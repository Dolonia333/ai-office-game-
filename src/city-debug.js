/**
 * City Debug Overlay
 *
 * Drops a small HUD on the page and, when activated, fetches a fresh
 * generated city from `/api/generate-city` and renders it into a hidden
 * canvas overlay (separate from the main Phaser scene — we don't want
 * to scramble the running office). The overlay is purely a developer
 * tool to verify the city pipeline runs end-to-end.
 *
 * Activate by appending `?debug=city` to the URL, or by running
 * `window.DenizenCityDebug.show()` from the console at any time.
 *
 * Once you're convinced the data is right, the real next step is to
 * wire it into office-scene.js properly — see docs/CITY_GENERATOR.md
 * for the integration steps. This file is the bridge between "the
 * generator works" and "the generator is the office."
 */
(function () {
  'use strict';

  const TILE_SIZE = 4;     // overlay tile size in pixels (downsampled for fit)
  const PADDING = 8;
  const COLORS = {
    ground:    '#1b3a1b',
    roads:     '#444444',
    park:      '#2d6a2d',
    downtown:  '#5a5a8a',
    industrial:'#7a5a3a',
    residential:'#3a5a7a',
  };

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let infoBox = null;

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'denizen-city-debug';
    Object.assign(overlay.style, {
      position: 'fixed', top: '10px', right: '10px', zIndex: 9999,
      background: 'rgba(0,0,0,0.85)', color: '#cfe7ff',
      font: '11px monospace', padding: '10px', border: '1px solid #355',
      borderRadius: '4px', display: 'none', maxWidth: '420px',
    });

    const title = document.createElement('div');
    title.textContent = '🏙  City Debug — /api/generate-city';
    title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#9cf';
    overlay.appendChild(title);

    canvas = document.createElement('canvas');
    canvas.width = 220; canvas.height = 220;
    canvas.style.cssText = 'background:#000;border:1px solid #224;display:block';
    overlay.appendChild(canvas);
    ctx = canvas.getContext('2d');

    infoBox = document.createElement('pre');
    infoBox.style.cssText = 'margin:6px 0 0;white-space:pre-wrap;max-height:200px;overflow:auto';
    infoBox.textContent = '(fetching…)';
    overlay.appendChild(infoBox);

    const controls = document.createElement('div');
    controls.style.cssText = 'margin-top:8px;display:flex;gap:6px';
    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'background:#234;color:#cfe7ff;border:1px solid #456;padding:3px 8px;cursor:pointer;font:11px monospace';
      b.onclick = onClick;
      return b;
    };
    controls.appendChild(mkBtn('refresh', () => fetchAndRender()));
    controls.appendChild(mkBtn('new seed', () => fetchAndRender(Math.random().toString(36).slice(2, 10))));
    controls.appendChild(mkBtn('hide', () => hide()));
    overlay.appendChild(controls);

    document.body.appendChild(overlay);
  }

  function show() { buildOverlay(); overlay.style.display = 'block'; fetchAndRender(); }
  function hide() { if (overlay) overlay.style.display = 'none'; }

  async function fetchAndRender(seed) {
    buildOverlay();
    const url = new URL('/api/generate-city', window.location.origin);
    if (seed) url.searchParams.set('seed', seed);
    infoBox.textContent = '(fetching…)';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderChunk(data);
      renderInfo(data);
    } catch (err) {
      infoBox.textContent = 'Error: ' + (err.message || err);
    }
  }

  function renderChunk(data) {
    const chunk = data && data.chunk;
    if (!chunk || !chunk.layers) return;
    const w = chunk.width || 48;
    const h = chunk.height || 48;
    canvas.width = w * TILE_SIZE + PADDING * 2;
    canvas.height = h * TILE_SIZE + PADDING * 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Layers come out of cityGenerator as { id, width, height, grid:[[ref|null]] }.
    // We paint ground first, then roads on top, then mark buildings.
    const layerByName = Object.fromEntries(
      (chunk.layers || []).map(l => [l.id || l.name, l])
    );
    const ground = layerByName.ground;
    const roads = layerByName.roads;

    const paint = (layer, color) => {
      if (!layer || !layer.grid) return;
      ctx.fillStyle = color;
      for (let y = 0; y < layer.height; y++) {
        for (let x = 0; x < layer.width; x++) {
          if (layer.grid[y] && layer.grid[y][x]) {
            ctx.fillRect(PADDING + x * TILE_SIZE, PADDING + y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        }
      }
    };
    paint(ground, COLORS.ground);
    paint(roads, COLORS.roads);

    // Buildings (rects)
    (chunk.buildings || []).forEach(b => {
      const r = b.rect || b;
      ctx.strokeStyle = COLORS[b.kind] || COLORS.downtown;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        PADDING + (r.x || 0) * TILE_SIZE - 0.5,
        PADDING + (r.y || 0) * TILE_SIZE - 0.5,
        (r.w || 1) * TILE_SIZE + 1,
        (r.h || 1) * TILE_SIZE + 1,
      );
    });
  }

  function renderInfo(data) {
    const plan = data.plan || {};
    const chunk = data.chunk || {};
    const interior = data.sampleInterior;
    const zoneCounts = {};
    (plan.zones || []).forEach(z => { zoneCounts[z.zone] = (zoneCounts[z.zone] || 0) + 1; });
    const lines = [
      `seed:      ${plan.seed || chunk?.metadata?.seed || '?'}`,
      `plan src:  ${plan.source || '?'}`,
      `grid:      ${plan.gridW || '?'} × ${plan.gridH || '?'}`,
      `zones:     ${Object.entries(zoneCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`,
      `chunk:     ${chunk.width || '?'} × ${chunk.height || '?'} tiles`,
      `buildings: ${(chunk.buildings || []).length}`,
      `interior:  ${interior ? `${interior.buildingId} (${interior.prefabs?.length || 0} prefabs)` : '(none)'}`,
    ];
    infoBox.textContent = lines.join('\n');
  }

  // Public hook
  window.DenizenCityDebug = { show, hide, refresh: fetchAndRender };

  // Auto-show via ?debug=city
  try {
    const debugParam = new URL(window.location.href).searchParams.get('debug') || '';
    if (debugParam.split(',').includes('city')) {
      if (document.readyState === 'complete') show();
      else window.addEventListener('load', show);
    }
  } catch (_) { /* tolerate non-browser environments */ }

  console.log('[CityDebug] ready — append ?debug=city or run window.DenizenCityDebug.show()');
})();
