/* global fetch, document, navigator */

const SHEETS = {
  basement: {
    label: 'XP 14_Basement',
    scanUrl: './scripts/basement.scan.json',
    imageUrl:
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_XP/14_Basement.png',
    sheetKey: 'xp_basement_sheet',
  },
  bedroom: {
    label: 'XP 4_Bedroom',
    scanUrl: './scripts/bedroom.scan.json',
    imageUrl:
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_XP/4_Bedroom.png',
    sheetKey: 'xp_bedroom_sheet',
  },
  bathroom: {
    label: 'XP 3_Bathroom',
    scanUrl: './scripts/bathroom.scan.json',
    imageUrl:
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_XP/3_Bathroom.png',
    sheetKey: 'xp_bathroom_sheet',
  },
  mo_black_32: {
    label: 'Modern Office Black Shadow (32x32)',
    scanUrl: './scripts/modern_office_black_shadow.grid32.json',
    imageUrl:
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_32x32.png',
    sheetKey: 'mo_black_shadow_32',
  },
  mo_black_48: {
    label: 'Modern Office Black Shadow (48x48)',
    scanUrl: './scripts/modern_office_black_shadow.grid48.json',
    imageUrl:
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_48x48.png',
    sheetKey: 'mo_black_shadow_48',
  },
  master: {
    label: 'Master Catalog (All Packs)',
    scanUrl: './data/master_furniture_catalog.json',
    imageUrl: null, // Master catalog uses individual singles or multiple sheets, handled differently
    sheetKey: 'master',
  }
};

const els = {
  sheet: document.getElementById('sheet'),
  q: document.getElementById('q'),
  minW: document.getElementById('minW'),
  minH: document.getElementById('minH'),
  pageSize: document.getElementById('pageSize'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  status: document.getElementById('status'),
  grid: document.getElementById('grid'),
  selName: document.getElementById('selName'),
  selSheetKey: document.getElementById('selSheetKey'),
  snippet: document.getElementById('snippet'),
  copy: document.getElementById('copy'),
  copyStatus: document.getElementById('copyStatus'),
};

let state = {
  sheetId: els.sheet.value,
  scan: null,
  image: null,
  filtered: [],
  page: 0,
  selected: null,
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function fmtRect(r) {
  return `${r.x},${r.y} ${r.w}x${r.h}`;
}

function buildSnippet(obj, sheetKey) {
  if (obj.source_type === 'single_file') {
    return JSON.stringify(
      {
        url_path: obj.url_path,
        w: obj.w,
        h: obj.h,
        origin: obj.origin || 'bottom',
        depth: obj.type === 'decor' ? 2 : 1.5,
        type: obj.type || 'furniture',
        action: null,
      },
      null,
      2
    );
  } else {
    // sheet slice
    const r = obj.rect;
    return JSON.stringify(
      {
        sheet: obj.sheet || sheetKey,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        origin: obj.origin || 'bottom',
        depth: obj.type === 'decor' ? 2 : 1.5,
        type: obj.type || 'furniture',
        action: null,
      },
      null,
      2
    );
  }
}

async function loadSheet(sheetId) {
  const cfg = SHEETS[sheetId];
  els.status.textContent = `Loading ${cfg.label}…`;

  const [scanRes] = await Promise.all([fetch(cfg.scanUrl)]);
  if (!scanRes.ok) throw new Error(`Failed to load scan: ${cfg.scanUrl} (${scanRes.status})`);
  let scan = await scanRes.json();
  
  // Normalize master catalog dictionary to array
  if (sheetId === 'master' && !Array.isArray(scan.objects)) {
    const arr = [];
    for (const [id, def] of Object.entries(scan.objects)) {
      def.id = id;
      arr.push(def);
    }
    scan.objects = arr;
  } else if (!scan.objects) {
     scan.objects = [];
  } else if (Array.isArray(scan.objects)) {
     // inject names as ID for legacy scans
     scan.objects.forEach(o => { if(!o.id) o.id = o.name || "unnamed"; });
  }

  let img = null;
  if (cfg.imageUrl) {
    img = new Image();
    img.decoding = 'async';
    img.src = cfg.imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(`Failed to load image: ${cfg.imageUrl}`));
    });
  }

  state = {
    ...state,
    sheetId,
    scan,
    image: img,
    page: 0,
    selected: null,
  };
  els.status.textContent = `Loaded ${cfg.label}. Objects detected: ${scan.objects.length}.`;
  applyFilters();
}

function applyFilters() {
  const q = (els.q.value || '').trim().toLowerCase();
  const minW = parseInt(els.minW.value || '0', 10) || 0;
  const minH = parseInt(els.minH.value || '0', 10) || 0;

  const all = state.scan?.objects || [];
  const filtered = all.filter((o) => {
    if (q) {
      const searchStr = [String(o.id), o.ai_name || '', o.type || '', o.pack || ''].join(' ').toLowerCase();
      if (!searchStr.includes(q)) return false;
    }
    const w = o.rect ? o.rect.w : o.w;
    const h = o.rect ? o.rect.h : o.h;
    if ((w || 0) < minW) return false;
    if ((h || 0) < minH) return false;
    return true;
  });

  state.filtered = filtered;
  state.page = clamp(state.page, 0, Math.max(0, Math.ceil(filtered.length / pageSize()) - 1));
  renderGrid();
}

function pageSize() {
  return parseInt(els.pageSize.value, 10) || 60;
}

function renderGrid() {
  const cfg = SHEETS[state.sheetId];
  const ps = pageSize();
  const start = state.page * ps;
  const end = Math.min(state.filtered.length, start + ps);
  const pageItems = state.filtered.slice(start, end);

  els.status.textContent = `Showing ${start + 1}-${end} of ${state.filtered.length} (page ${
    state.page + 1
  }/${Math.max(1, Math.ceil(state.filtered.length / ps))}) — ${cfg.label}`;

  els.grid.innerHTML = '';

  pageItems.forEach((obj) => {
    const tile = document.createElement('div');
    tile.className = 'tile';

    const c = document.createElement('canvas');
    c.className = 'thumb';
    c.width = 96;
    c.height = 96;

    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);

    let displayW = 0;
    let displayH = 0;

    if (obj.source_type === 'single_file') {
      // Lazy load the image
      const thumbImg = new Image();
      thumbImg.decoding = 'async';
      // Assume the web server is running from the 'multbot' root folder,
      // so we use absolute-style paths from the root to the assets
      let srcPath = obj.url_path.replace(/\\/g, '/');
      if (srcPath.startsWith('/pixel game stuff')) {
         // Already absolute, no modification needed
      } else if (srcPath.startsWith('assets/')) {
         srcPath = '/pixel game stuff/pixel game assets and stuff/' + srcPath.substring(7);
      } else if (srcPath.match(/pixel game/)) {
         // strip relative prefixes if any
         srcPath = srcPath.replace(/^.*?(pixel game stuff)/, '/$1');
      } else {
         // Prepend the missing pixel game stuff prefix
         if (srcPath.startsWith('/')) {
             srcPath = '/pixel game stuff/pixel game assets and stuff' + srcPath;
         } else {
             srcPath = '/pixel game stuff/pixel game assets and stuff/' + srcPath;
         }
      }
      thumbImg.src = srcPath;
      
      thumbImg.onload = () => {
        const scale = Math.min(c.width / thumbImg.width, c.height / thumbImg.height);
        const dw = Math.max(1, Math.floor(thumbImg.width * scale));
        const dh = Math.max(1, Math.floor(thumbImg.height * scale));
        const dx = Math.floor((c.width - dw) / 2);
        const dy = Math.floor((c.height - dh) / 2);
        ctx.drawImage(thumbImg, 0, 0, thumbImg.width, thumbImg.height, dx, dy, dw, dh);
      };
      displayW = obj.w;
      displayH = obj.h;
    } else {
      // Sheet slice
      let r = obj.rect || {x:0, y:0, w:32, h:32};
      displayW = r.w;
      displayH = r.h;
      
      const drawSlice = (sourceImg, rect) => {
        const scale = Math.min(c.width / rect.w, c.height / rect.h);
        const dw = Math.max(1, Math.floor(rect.w * scale));
        const dh = Math.max(1, Math.floor(rect.h * scale));
        const dx = Math.floor((c.width - dw) / 2);
        const dy = Math.floor((c.height - dh) / 2);
        ctx.drawImage(sourceImg, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);
      };

      if (state.image) {
          drawSlice(state.image, r);
      } else {
          // If master catalog sheet_slice but we didn't load a single giant image
          // Try to look up the sheet dynamically
          const sheetKey = obj.sheet;
          let foundImgUrl = null;
          
          if (sheetKey && sheetKey.includes('modern_office_black_shadow_grid32')) {
            foundImgUrl = '/pixel game stuff/pixel game assets and stuff/Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_32x32.png';
          } else if (sheetKey && sheetKey.includes('modern_office_black_shadow_grid48')) {
            foundImgUrl = '/pixel game stuff/pixel game assets and stuff/Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_48x48.png';
          } else if (sheetKey === 'modern_office_16x16' || sheetKey === 'modern_office_16') {
            foundImgUrl = '/pixel game stuff/pixel game assets and stuff/Modern_Office_Revamped_v1.2/Modern_Office_16x16.png';
          }
          
          if (foundImgUrl) {
              const sheetImg = new Image();
              sheetImg.decoding = 'async';
              sheetImg.src = foundImgUrl;
              sheetImg.onload = () => {
                  drawSlice(sheetImg, r);
              };
          } else {
              ctx.fillStyle = "#334155";
              ctx.fillRect(0, 0, c.width, c.height);
              ctx.fillStyle = "#e5e7eb";
              ctx.font = "10px sans-serif";
              ctx.fillText(obj.sheet || "sheet", 4, 14);
          }
      }
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const left = document.createElement('div');
    // Show ai_name if available, otherwise fall back to the catalog ID
    const displayLabel = obj.ai_name || obj.id;
    left.textContent = displayLabel;
    left.title = obj.ai_name ? `${obj.ai_name}\n${obj.id}` : obj.id;
    // ensure text truncates cleanly for long master IDs
    left.style.overflow = 'hidden';
    left.style.textOverflow = 'ellipsis';
    left.style.whiteSpace = 'nowrap';
    left.style.maxWidth = '75px'; 
    
    const right = document.createElement('div');
    right.textContent = `${displayW}×${displayH}`;
    meta.appendChild(left);
    meta.appendChild(right);

    tile.appendChild(c);
    tile.appendChild(meta);

    tile.addEventListener('click', () => {
      state.selected = obj;
      const rectStr = obj.rect ? fmtRect(obj.rect) : 'Single File';
      els.selName.textContent = `${obj.id} (${rectStr})`;
      els.selSheetKey.textContent = obj.sheet || cfg.sheetKey;
      els.snippet.textContent = buildSnippet(obj, cfg.sheetKey);
      els.copyStatus.textContent = '';
    });

    els.grid.appendChild(tile);
  });
}

async function copySelected() {
  const txt = els.snippet.textContent || '';
  try {
    await navigator.clipboard.writeText(txt);
    els.copyStatus.innerHTML = `<span class=\"ok\">Copied.</span>`;
  } catch (e) {
    els.copyStatus.innerHTML = `<span class=\"warn\">Copy failed.</span> Select the text and copy manually.`;
  }
}

// Events
els.sheet.addEventListener('change', () => loadSheet(els.sheet.value));
els.q.addEventListener('input', () => applyFilters());
els.minW.addEventListener('input', () => applyFilters());
els.minH.addEventListener('input', () => applyFilters());
els.pageSize.addEventListener('change', () => applyFilters());
els.prev.addEventListener('click', () => {
  state.page = Math.max(0, state.page - 1);
  renderGrid();
});
els.next.addEventListener('click', () => {
  state.page = Math.min(Math.max(0, Math.ceil(state.filtered.length / pageSize()) - 1), state.page + 1);
  renderGrid();
});
els.copy.addEventListener('click', () => copySelected());

// Init
loadSheet(els.sheet.value).catch((e) => {
  els.status.textContent = `Error: ${String(e)}`;
});

