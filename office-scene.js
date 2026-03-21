class OfficeScene extends Phaser.Scene {
  constructor() {
    super('OfficeScene');
  }

  preload() {
    // Helpful in-browser diagnostics so missing assets don't look like a silent blue screen.
    this._loadErrors = [];
    this.load.on('loaderror', (file) => {
      const key = file?.key || '(unknown-key)';
      const src = file?.src || file?.url || '(unknown-src)';
      this._loadErrors.push({ key, src });
      // Also log to devtools console.
      // eslint-disable-next-line no-console
      console.error('ASSET LOAD ERROR', key, src);
    });

    // Interior floor tileset (MV-style, treated as 32x32 grid)
    this.load.image(
      'floor_tiles',
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_MV/Floors_TILESET_A2_.png'
    );
    // Modern Office Room Builder — floor + wall tiles matching the furniture art style
    this.load.image(
      'room_builder',
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Office_Revamped_v1.2/1_Room_Builder_Office/Room_Builder_Office_32x32.png'
    );
    // Modern UI Style 2 — gray UI panels for dialog boxes
    this.load.image(
      'ui_style2',
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/modernuserinterface-win/32x32/Modern_UI_Style_2_32x32.png'
    );
    // Interior walls tileset (used for office walls/trim when needed)
    this.load.image(
      'wall_tiles',
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_MV/Walls_TILESET_A4_.png'
    );
    // Core JSON catalogs
    const cacheBust = Date.now();
    this.load.json('tiles_catalog', `./tiles-catalog.json?v=${cacheBust}`);
    this.load.json('furniture_catalog_openplan', `./data/furniture_catalog_openplan.json?v=${cacheBust}`);
    this.load.json('room_templates', `./data/room-templates.json?v=${cacheBust}`);
    this.load.json('sprite_map_modern_office', `./data/sprite-map-modern-office.json?v=${cacheBust}`);
    // Modern Office Revamped — main spritesheet for ALL furniture
    this.load.image(
      'mo_black_shadow_32',
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_32x32.png?v=2'
    );
    // Unused sheets removed to prevent loader stall (were loading 90+ files)

    // Modern Office singles — minimal set (most items now use spritesheet cuts)
    // The layout uses ONLY spritesheet-based entries, so no singles needed for initial load.
    const singleIds = [];
    singleIds.forEach(id => {
      this.load.image(
        `single_${id}`,
        `../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Office_Revamped_v1.2/4_Modern_Office_singles/32x32/Modern_Office_Singles_32x32_${id}.png`
      );
    });

    // Player: full 4-direction sheet from paid RPG Maker XP (32x48 per frame)
    this.load.spritesheet(
      'player_xp',
      '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_XP/Characters/Adam.png',
      { frameWidth: 32, frameHeight: 48 }
    );

    // Dolo: Character Generator 2.0 sprite (32x64 per frame, 24 cols x 1 row)
    this.load.spritesheet(
      'dolo',
      'assets/Dolo.png',
      { frameWidth: 32, frameHeight: 64 }
    );

    // All distinct XP characters available in the pack (32x48 per frame, 4x4 grid)
    // Reduced NPC list to keep total preload under 32 files (prevent loader stall)
    const xpNames = [
      'Abby',
      'Alex',
      'Bob',
      'Dan',
      'Jenny',
      'Lucy'
    ];

    xpNames.forEach((name) => {
      this.load.spritesheet(
        `xp_${name.toLowerCase()}`,
        `../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_XP/Characters/${name}.png`,
        { frameWidth: 32, frameHeight: 48 }
      );
    });

    const urlParams = new URLSearchParams(window.location.search);
    const layoutParam = urlParams.get('layout') || 'openplan';

    // --- Preload singles used in the current layout from the master catalog ---
    const fCatKey = layoutParam === 'promo'
      ? 'furniture_catalog_promo'
      : (layoutParam === 'openplan' ? 'furniture_catalog_openplan' : 'furniture_catalog');
    
    // Some logic loads world generator which handles its own things, but for handcrafted layouts
    // we can parse our own JSONs. Wait, if URL params change what JSON we need, we should ideally
    // fetch the JSON synchronously or rely on the cached 'furniture_catalog' etc.
    // However, during preload(), `this.cache.json.get` is definitely valid because it loads these static definitions.
    // Wait, let's just use Phaser's loader in create() if we need to. Actually, it's safer to load all required singles here.
    // Let's do a trick: we will just load ALL known singles referenced in ALL 3 furniture_catalogs, as well as scene_recipes.
    // It's a small number of strings (maybe 50 singles total).
    
    const tryPreloadSingles = (catKey) => {
        const cat = this.cache.json.get(catKey);
        if(!cat || !cat.placements) return;
        const master = this.cache.json.get('master_furniture_catalog');
        if(!master || !master.objects) return;
        
        cat.placements.forEach(pl => {
             const def = master.objects[pl.id];
             if(def && def.source_type === 'single_file') {
                 // The url_path is something like "assets/Modern_Exteriors/.../foo.png"
                 // Our root is C:\...\pixel game stuff\pixel game assets and stuff\
                 // The index.html is in C:\...\pixel-office-game\
                 const cleanPath = def.url_path.replace(/^assets[\\/]/, '').replace(/\\/g, '/');
                 const fullUrl = '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/' + cleanPath.split('/').map(encodeURIComponent).join('/');
                 if(!this.textures.exists(`single_${pl.id}`)) {
                     this.load.image(`single_${pl.id}`, fullUrl);
                 }
             }
        });
    }
    
    // For safety, let's wait until create() to do dynamic loading if we have to, 
    // OR just rely on preload() catching them if we fetched the JSONs beforehand. 
    // Wait! `preload` is exactly where we do this, but `this.cache` is populated *after* preload.
    // So we can't read the catalog in preload unless we use a Boot scene.
    // Let's just do dynamic loading in create().
  }

  create() {
    // If anything failed to load, show it on-screen immediately.
    if (Array.isArray(this._loadErrors) && this._loadErrors.length > 0) {
      const msg = this._loadErrors
        .slice(0, 8)
        .map((e) => `- ${e.key}: ${e.src}`)
        .join('\n');
      this.add.text(16, 16, `Missing assets (${this._loadErrors.length})\n${msg}`, {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
        fontSize: '14px',
        color: '#fecaca'
      }).setDepth(2000);
      // Continue anyway so you can still see floor/UI.
    }

    // Seeded world generation: visit /pixel-office-game/index.html?seed=YOURSEED
    const urlParams = new URLSearchParams(window.location.search);
    const seedParam = urlParams.get('seed');
    const layoutParam = urlParams.get('layout') || 'openplan'; // default to openplan
    const modeParam = urlParams.get('mode'); // 'city', 'officegen', etc.

    const width = 1280;
    const height = 720;
    const tileSize = 32;

    const tileCatalog = this.cache.json.get('tiles_catalog') || { tiles: [] };
    const tiles = Array.isArray(tileCatalog.tiles) ? tileCatalog.tiles : [];

    // ========================================================
    // Room Builder tile system — floors, wall faces, wall outlines, shadows
    // Based on Room_Builder_Office_32x32.png (512×448, 16×14 tiles)
    // ========================================================
    const rbImg = this.textures.get('room_builder')?.getSourceImage();

    // Helper: cut a single 32×32 tile from the Room Builder sheet
    const cutRBTile = (key, sx, sy, sw, sh) => {
      sw = sw || 32; sh = sh || 32;
      if (this.textures.exists(key)) this.textures.remove(key);
      const t = this.textures.createCanvas(key, sw, sh);
      t.context.imageSmoothingEnabled = false;
      if (rbImg) t.context.drawImage(rbImg, sx, sy, sw, sh, 0, 0, sw, sh);
      t.refresh();
    };

    // --- Wall Outline pieces (top half of Room Builder — white/black structural lines) ---
    cutRBTile('wall_top_h',      32,  0);    // Horizontal wall outline — tile (1,0)
    cutRBTile('wall_top_v',      128, 0);    // Vertical wall outline — tile (4,0)
    cutRBTile('wall_corner_tl',  32,  32);   // Corner top-left — tile (1,1)
    cutRBTile('wall_corner_tr',  64,  32);   // Corner top-right — tile (2,1)
    cutRBTile('wall_tjunc_l',    32,  64);   // T-junction left — tile (1,2)
    cutRBTile('wall_tjunc_r',    64,  64);   // T-junction right — tile (2,2)
    cutRBTile('wall_fill',       320, 0);    // Solid white fill — tile (10,0) for thick walls

    // --- Wall Face textures (bottom half — gives walls visible height) ---
    cutRBTile('wall_face_grey',  0,   224);  // Grey/concrete — standard office wall
    cutRBTile('wall_face_purple', 0,  160);  // Purple/patterned — decorative/feature walls
    cutRBTile('wall_shadow',     96,  160);  // Shadow strip — right side of vertical walls for 3D

    // --- Floor tiles from Room Builder ---
    cutRBTile('floor_rb_office', 320, 160);  // Grey grid/tile — standard office
    cutRBTile('floor_rb_dark',   320, 224);  // Dark grey/concrete — hallways, storage
    cutRBTile('floor_rb_wood',   448, 160);  // Wood/parquet — boss office, breakroom

    // Fallback procedural textures (in case Room Builder image fails)
    const makeCheckerTex = (key, c1, c2) => {
      if (this.textures.exists(key)) return; // don't overwrite RB tiles
      const t = this.textures.createCanvas(key, 64, 64);
      t.context.fillStyle = c1; t.context.fillRect(0, 0, 64, 64);
      t.context.fillStyle = c2; t.context.fillRect(32, 0, 32, 32); t.context.fillRect(0, 32, 32, 32);
      t.refresh();
    };

    // LAYER 1: Floor — base layer, everything sits on top of this
    // Fill entire world with office floor, then overlay room-specific floors
    this.add.tileSprite(width / 2, height / 2, width, height, 'floor_rb_office').setDepth(0);

    const floorZones = [
      { x: 32, y: 64, w: 816, h: 384, tex: 'floor_rb_office' },   // Open office (below top wall, left of divider)
      { x: 880, y: 64, w: 368, h: 192, tex: 'floor_rb_wood' },    // Manager office — wood
      { x: 880, y: 320, w: 368, h: 128, tex: 'floor_rb_dark' },   // Conference/supply — dark
      { x: 32, y: 512, w: 256, h: 144, tex: 'floor_rb_wood' },    // Break room — wood
      { x: 384, y: 512, w: 464, h: 144, tex: 'floor_rb_office' }, // Reception — office
      { x: 880, y: 512, w: 368, h: 144, tex: 'floor_rb_dark' },   // Bottom-right — dark
    ];
    floorZones.forEach(z => {
      this.add.tileSprite(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, z.tex).setDepth(0.1);
    });

    // Keep corridor/clinic textures for the non-openplan layout fallback
    const makeSingleTileTex = (texKey, sx, sy) => {
      if (this.textures.exists(texKey)) this.textures.remove(texKey);
      const t = this.textures.createCanvas(texKey, 32, 32);
      t.context.imageSmoothingEnabled = false;
      t.context.clearRect(0, 0, 32, 32);
      if (rbImg) {
        t.context.drawImage(rbImg, sx, sy, 32, 32, 0, 0, 32, 32);
      } else {
        t.context.fillStyle = texKey === 'clinic_single' ? '#b0c4de' : '#888888';
        t.context.fillRect(0, 0, 32, 32);
      }
      t.refresh();
    };
    makeSingleTileTex('corridor_single', 0, 224);
    makeSingleTileTex('clinic_single', 0, 160);

    // Debug HUD so it's obvious which mode is active (helps when caching / wrong URL params).
    // Very visible mode banner to prove new code is running.
    this.add.rectangle(width / 2, 18, width, 36, 0x0b1220, 0.92).setDepth(2000);
    this.add.text(16, 8, `MODE layout=${layoutParam || '(none)'} mode=${modeParam || '(none)'} seed=${seedParam || '(none)'}`, {
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '14px',
      color: '#e5e7eb',
    }).setDepth(2001);

    // --- Early exit: pure procedural office interior demo ---
    if (modeParam === 'officegen') {
      Promise.all([
        import('./src/city/interiorGenerator.js'),
        import('./src/city/phaserAdapter.js')
      ]).then(([interiors, adapter]) => {
        const layout = interiors.generateOfficeInterior({
          seed: seedParam || 'default',
          buildingId: 'demo_office',
          width: 24,
          height: 16
        });

        const catalog = this.cache.json.get('interiors_prefabs');
        const prefabSprites = {};

        if (catalog && catalog.prefabs && catalog.sheets) {
          Object.entries(catalog.prefabs).forEach(([id, def]) => {
            const sheetInfo = catalog.sheets[def.sheet];
            if (!sheetInfo) return;
            const imageKey = sheetInfo.imageKey;
            if (!this.textures.exists(imageKey)) return;
            const img = this.textures.get(imageKey).getSourceImage();
            const { x, y, w, h } = def.rect;
            const texKey = `int_${id}`;
            if (this.textures.exists(texKey)) this.textures.remove(texKey);
            const canvasTex = this.textures.createCanvas(texKey, w, h);
            canvasTex.context.imageSmoothingEnabled = false;
            canvasTex.context.drawImage(img, x, y, w, h, 0, 0, w, h);
            canvasTex.refresh();

            prefabSprites[id] = ({ scene, x: px, y: py }) => {
              const originY = def.origin === 'center' ? 0.5 : 1;
              return scene.add.image(px, py, texKey).setOrigin(0.5, originY);
            };
          });
        }

        adapter.renderInteriorPhaser(this, layout, prefabSprites);
      });
      // Skip the rest of create() for this mode.
      return;
    }

    // --- Room Assembly system mode: render perfect rooms without broken sprites ---
    if (modeParam === 'assembly') {
      Promise.all([
        import('./src/RoomAssembly.js')
      ]).then(([module]) => {
        const RoomAssembly = module.RoomAssembly || module.default;
        
        // Initialize assembly system
        const assembly = new RoomAssembly(this);
        const catalogData = this.cache.json.get('furniture_catalog_openplan');
        const roomTemplatesData = this.cache.json.get('room_templates');
        const masterData = this.cache.json.get('master_furniture_catalog');
        
        if (!assembly.initialize(catalogData, roomTemplatesData, masterData)) {
          console.error('❌ Failed to initialize RoomAssembly');
          return;
        }
        
        // List available templates
        assembly.listTemplates();
        
        // Render a test room - default to the rebuilt reference layout
        const templateName = new URLSearchParams(window.location.search).get('template') || 'reference_office_main';
        const isReferenceTemplate = templateName === 'reference_office_main';
        // Anchor compact reference composition near the middle so camera can frame it tightly.
        // Reference template uses catalog-placement coords directly (origin at 0,0).
        const originX = isReferenceTemplate ? 0 : 140;
        const originY = isReferenceTemplate ? 0 : 120;
        assembly.renderRoom(templateName, originX, originY);

        // Assembly-specific wall pass: cleaner enclosing walls for the rebuilt template zone.
        // This avoids relying on generic map walls that may feel disconnected from template content.
        const T = 32;
        const drawAsmHWall = (startX, y, endX) => {
          if (endX <= startX) return;
          const w = endX - startX;
          const trimH = 4;
          const wallH = T * 2;

          // Keep wall depths below furniture so props are never visually clipped.
          this.add.rectangle(startX + w / 2, y + trimH / 2, w, trimH, 0x2a3550, 1).setDepth(1.1);
          this.add.rectangle(startX + w / 2, y + trimH + (wallH - trimH) / 2, w, wallH - trimH, 0xe8e8ec, 1).setDepth(0.8);
        };
        const drawAsmVWall = (x, startY, endY) => {
          if (endY <= startY) return;
          const h = endY - startY;
          const trimW = 4;

          // Continuous vertical trim + connected body + subtle right shadow.
          this.add.rectangle(x + trimW / 2, startY + h / 2, trimW, h, 0x2a3550, 1).setDepth(1.1);
          this.add.rectangle(x + trimW + (T - trimW) / 2, startY + h / 2, T - trimW, h, 0xe8e8ec, 1).setDepth(0.8);
          this.add.rectangle(x + T - 1, startY + h / 2, 2, h, 0x6d7384, 0.55).setDepth(0.9);
        };
        const drawAsmHWallWithGaps = (startX, y, endX, gaps = []) => {
          const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
          let cursor = startX;
          sorted.forEach(([gx0, gx1]) => {
            drawAsmHWall(cursor, y, Math.max(cursor, gx0));
            cursor = Math.max(cursor, gx1);
          });
          drawAsmHWall(cursor, y, endX);
        };
        const drawAsmVWallWithGaps = (x, startY, endY, gaps = []) => {
          const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
          let cursor = startY;
          sorted.forEach(([gy0, gy1]) => {
            drawAsmVWall(x, cursor, Math.max(cursor, gy0));
            cursor = Math.max(cursor, gy1);
          });
          drawAsmVWall(x, cursor, endY);
        };

        // Zone covers all template content. Template items span world x:172–614, y:104–550.
        // Zone covers all catalog placements: items span x:52–1228, y:72–700.
        const zoneX = isReferenceTemplate ? 16 : (originX - 92);
        const zoneY = isReferenceTemplate ? 32 : (originY - 96);
        const zoneW = isReferenceTemplate ? 1264 : 840;
        const zoneH = isReferenceTemplate ? 700 : 430;

        // Outer enclosure top wall (always drawn)
        drawAsmHWall(zoneX, zoneY, zoneX + zoneW);
        if (!isReferenceTemplate) {
          drawAsmHWallWithGaps(zoneX, zoneY + zoneH - T * 2, zoneX + zoneW, [[zoneX + 320, zoneX + 430]]);
          drawAsmVWall(zoneX, zoneY + T * 2, zoneY + zoneH - T * 2);
          drawAsmVWallWithGaps(zoneX + zoneW - T, zoneY + T * 2, zoneY + zoneH - T * 2, [[zoneY + 224, zoneY + 300]]);

          // Manager-room box on upper-right with a door gap in its bottom wall.
          const mgrX = zoneX + 470;
          const mgrY = zoneY + 44;
          const mgrW = 260;
          const mgrH = 210;
          drawAsmHWall(mgrX, mgrY, mgrX + mgrW);
          drawAsmVWall(mgrX, mgrY + T * 2, mgrY + mgrH);
          drawAsmVWall(mgrX + mgrW - T, mgrY + T * 2, mgrY + mgrH);
          drawAsmHWallWithGaps(mgrX, mgrY + mgrH - T * 2, mgrX + mgrW, [[mgrX + 86, mgrX + 166]]);
        }

        if (isReferenceTemplate) {
          drawAsmHWall(zoneX, zoneY + zoneH - T * 2, zoneX + zoneW);
          drawAsmVWall(zoneX, zoneY + T * 2, zoneY + zoneH - T * 2);
          drawAsmVWall(zoneX + zoneW - T, zoneY + T * 2, zoneY + zoneH - T * 2);
        }

        // Assembly-mode character pass: keep a visible player + a few NPCs.
        const ensureAnimSet = (prefix, key) => {
          const mk = (name, frames, frameRate) => {
            const k = `${prefix}_${name}`;
            if (this.anims.exists(k)) return k;
            this.anims.create({ key: k, frames, frameRate, repeat: -1 });
            return k;
          };
          return {
            walkDown: mk('walk_down', this.anims.generateFrameNumbers(key, { start: 0, end: 3 }), 8),
            walkLeft: mk('walk_left', this.anims.generateFrameNumbers(key, { start: 4, end: 7 }), 8),
            walkRight: mk('walk_right', this.anims.generateFrameNumbers(key, { start: 8, end: 11 }), 8),
            walkUp: mk('walk_up', this.anims.generateFrameNumbers(key, { start: 12, end: 15 }), 8)
          };
        };

        const playerAnims = ensureAnimSet('asm_player_xp', 'player_xp');
        const playerStartX = isReferenceTemplate ? 300 : (originX + 250);
        const playerStartY = isReferenceTemplate ? 260 : (originY + 228);
        this.player = this.physics.add.sprite(playerStartX, playerStartY, 'player_xp', 1);
        this.player.setCollideWorldBounds(true).setDepth(2.6).setScale(2);
        // Match the main update() animation contract.
        this._playerAnimKey = (name) => `asm_player_xp_${name}`;
        this.player.setFrame(0);
        this.cursors = this.input.keyboard.createCursorKeys();
        this.interactKeys = this.input.keyboard.addKeys({ E: 'E', SPACE: 'SPACE' });
        this.playerState = 'walk';
        this.playerLocked = false;
        this.facing = 'down';

        this.npcs = [];
        const npcKeys = ['xp_abby', 'xp_alex', 'xp_bob', 'xp_dan'];
        const npcPoints = isReferenceTemplate
          ? [
                { x: 200, y: 210 },
                { x: 400, y: 390 },
                { x: 640, y: 590 },
                { x: 980, y: 270 }
            ]
          : [
              { x: originX + 8, y: originY + 64 },
              { x: originX + 140, y: originY + 64 },
              { x: originX + 270, y: originY + 64 },
              { x: originX + 598, y: originY + 162 }
            ];
        npcKeys.forEach((texKey, i) => {
          if (!this.textures.exists(texKey)) return;
          const p = npcPoints[i];
          const npcAnims = ensureAnimSet(`asm_${texKey}`, texKey);
          const npc = this.physics.add.sprite(p.x, p.y, texKey, 1);
          npc.setDepth(2.6).setScale(2);
          npc._animKey = (name) => `asm_${texKey}_${name}`;
          npc.ai = {
            mode: 'wander',
            facing: 'down',
            nextWanderAt: 0,
            wanderTarget: { x: p.x, y: p.y },
            followOffset: { x: (i % 2) * 24 - 12, y: Math.floor(i / 2) * 20 - 10 }
          };
          npc.setFrame(0);
          this.npcs.push(npc);
        });

        if (isReferenceTemplate) {
           // Full openplan zone 1264×700. Zoom 1.0 fits in a 1280×720 viewport.
           const cam = this.cameras.main;
           cam.setZoom(1.0);
           cam.centerOn(zoneX + zoneW / 2, zoneY + zoneH / 2);
           cam.setBounds(zoneX - 32, zoneY - 32, zoneW + 64, zoneH + 64);
        }
        
        // Store assembly instance on scene for debugging/inspection
        this.roomAssembly = assembly;
      }).catch(err => {
        console.error('❌ Failed to load RoomAssembly module:', err);
      });
      // Skip the rest of create() for this mode.
      return;
    }

    // If a seed was provided, generate and render a world layout and skip the handcrafted walls.
    if (seedParam) {
      // Seeded / generated view: render world asynchronously, but still run character setup.
      // We skip the handcrafted wall layout below so the generated content can be seen clearly.
      this._skipHandcraftedLayout = true;
      Promise.all([
        import('./src/world/generator.js'),
        import('./src/world/renderer.js'),
        import('./src/world/debug.js')
      ]).then(([gen, rend, dbg]) => {
        gen.generateWorld({
          seed: seedParam,
          prefabs: [],
          config: {
            roomCount: 6,
            corridorWidth: 120,
            outdoorEnabled: true,
            layoutMode: 'recipes',
            defaultTheme: 'modern_office',
            defaultRoomType:
              layoutParam === 'reception'
                ? 'reception_lobby'
                : layoutParam === 'small_office'
                  ? 'small_office'
                  : layoutParam === 'reference_office'
                    ? 'reference_office'
                    : 'openplan_bullpen'
          }
        })
          .then((world) => {
            rend.renderWorld(this, world, { rooms: 'floor_single', corridor: 'corridor_single', clinic: 'clinic_single' });
            const debugWorld = urlParams.get('debug') === '1';
            if (debugWorld) dbg.drawWorldDebug(this, world);

            // Spawn furniture from world.objects.
            // reference_office: use Modern Office (mo_black_shadow_32) so it looks like the promo.
            // Other layouts: use interiors prefab catalog (XP sheets).
            let useModernOffice = layoutParam === 'reference_office';
            const openplanCatalog = this.cache.json.get('furniture_catalog_openplan');
            const catalog = this.cache.json.get('interiors_prefabs');

            if (useModernOffice && openplanCatalog && openplanCatalog.objects && Array.isArray(world.objects)) {
              const prefabToCatalog = {
                desk_cluster_2x2: 'desk_pod',
                office_chair: 'chair_office',
                pc_monitor: 'monitor',
                plant_pot: 'plant_pot',
                bookshelf: 'bookshelf',
                printer: 'printer'
              };
              const sheetKey = 'mo_black_shadow_32';
              if (!this.textures.exists(sheetKey)) {
                useModernOffice = false;
              }
              if (useModernOffice) {
                const img = this.textures.get(sheetKey).getSourceImage();
                const built = new Set();
                world.objects.forEach((obj) => {
                  const catalogId = prefabToCatalog[obj.prefabId];
                  if (!catalogId) return;
                  const def = openplanCatalog.objects[catalogId];
                  if (!def || def.sheet !== sheetKey) return;
                  const w = def.w || 32;
                  const h = def.h || 32;
                  const texKey = `mo_ref_${catalogId}`;
                  if (!built.has(texKey)) {
                    built.add(texKey);
                    if (this.textures.exists(texKey)) this.textures.remove(texKey);
                    const canvasTex = this.textures.createCanvas(texKey, w, h);
                    canvasTex.context.imageSmoothingEnabled = false;
                    canvasTex.context.drawImage(img, def.x, def.y, w, h, 0, 0, w, h);
                    canvasTex.refresh();
                  }
                  const originY = (def.origin === 'center') ? 0.5 : 1;
                  const s = this.add.image(obj.x, obj.y, texKey).setOrigin(0.5, originY);
                  s.setDepth(def.depth != null ? def.depth : (def.type === 'decor' ? 2 : 1.5));
                });
              }
            }
            if (!useModernOffice && catalog && catalog.prefabs && catalog.sheets && Array.isArray(world.objects)) {
              const prefabSprites = {};
              Object.entries(catalog.prefabs).forEach(([id, def]) => {
                const sheetInfo = catalog.sheets[def.sheet];
                if (!sheetInfo) return;
                const imageKey = sheetInfo.imageKey;
                if (!this.textures.exists(imageKey)) return;
                const img = this.textures.get(imageKey).getSourceImage();
                const { x, y, w, h } = def.rect;
                const texKey = `int_${id}`;
                if (this.textures.exists(texKey)) this.textures.remove(texKey);
                const canvasTex = this.textures.createCanvas(texKey, w, h);
                canvasTex.context.imageSmoothingEnabled = false;
                canvasTex.context.drawImage(img, x, y, w, h, 0, 0, w, h);
                canvasTex.refresh();

                prefabSprites[id] = ({ scene, x: px, y: py }) => {
                  const originY = def.origin === 'center' ? 0.5 : 1;
                  return scene.add.image(px, py, texKey).setOrigin(0.5, originY);
                };
              });

              world.objects.forEach((obj) => {
                const def = catalog.prefabs[obj.prefabId];
                const factory = prefabSprites[obj.prefabId];
                if (!def || !factory) return;
                const s = factory({ scene: this, x: obj.x, y: obj.y });
                const depth = def.type === 'decor' ? 2 : 1.5;
                s.setDepth(depth);
              });
            }
          });
      });
      // Fall through so player/NPC setup runs.
    }

    // Collect all static collision obstacles (walls + furniture bases).
    // Must exist before wall creation (drawWallRectTiles pushes into it).
    this._obstacles = [];

    // Shared layout measurements (used for spawn points, etc.)
    const corridorY = 260;
    const corridorH = 140;
    const bottomY = corridorY + corridorH + 16;
    const bottomH = height - bottomY - 24;

    // Layout override: open-plan office uses proper 3-layer wall system.
    if (layoutParam === 'openplan' || layoutParam === 'promo' || this._skipHandcraftedLayout) {
      // ========================================================
      // LAYER 2 & 3: Wall System — Face + Outline + Shadow
      // Strategy: Wall Top Outline at (x,y), Wall Face at (x, y+32)
      // Horizontal walls: 2 tiles tall (outline on top, face below)
      // Vertical walls: 1 tile wide (outline) + shadow strip on right
      // ========================================================
      const T = 32; // tile size

      // -- Helper: draw a horizontal wall segment --
      // Renders: wall outline on top row, wall face below, with corners at ends
      // y = top edge of wall outline. Total height = 64px (2 tiles).
      const drawHWall = (startX, y, endX) => {
        const tiles = Math.ceil((endX - startX) / T);
        for (let i = 0; i < tiles; i++) {
          const px = startX + i * T;
          // LAYER 3: Wall top outline (Z=5)
          this.add.image(px, y, 'wall_top_h').setOrigin(0, 0).setDepth(5);
          // LAYER 2: Wall face below outline (Z=3)
          this.add.image(px, y + T, 'wall_face_grey').setOrigin(0, 0).setDepth(3);
        }
        // Collision for the full wall (2 tiles tall)
        const w = endX - startX;
        const obs = this.add.rectangle(startX + w / 2, y + T, w, T * 2, 0x000000, 0);
        this.physics.add.existing(obs, true);
        this._obstacles.push(obs);
      };

      // -- Helper: draw a vertical wall segment --
      // Renders: wall outline tiles + shadow strip on right side for 3D depth
      // x = left edge of wall outline. Total width = 64px (outline + shadow).
      const drawVWall = (x, startY, endY) => {
        const tiles = Math.ceil((endY - startY) / T);
        for (let i = 0; i < tiles; i++) {
          const py = startY + i * T;
          // LAYER 3: Wall outline (Z=5)
          this.add.image(x, py, 'wall_top_v').setOrigin(0, 0).setDepth(5);
          // LAYER 2: Shadow on the right side (Z=3) for 3D depth
          this.add.image(x + T, py, 'wall_shadow').setOrigin(0, 0).setDepth(3);
        }
        // Collision for wall (1 tile wide)
        const h = endY - startY;
        const obs = this.add.rectangle(x + T / 2, startY + h / 2, T, h, 0x000000, 0);
        this.physics.add.existing(obs, true);
        this._obstacles.push(obs);
      };

      // -- Helper: place a corner piece --
      const drawCorner = (x, y, type) => {
        const texKey = type === 'tl' ? 'wall_corner_tl'
                     : type === 'tr' ? 'wall_corner_tr'
                     : type === 'tjl' ? 'wall_tjunc_l'
                     : 'wall_tjunc_r';
        this.add.image(x, y, texKey).setOrigin(0, 0).setDepth(5.1);
        // Face tile below corner
        this.add.image(x, y + T, 'wall_face_grey').setOrigin(0, 0).setDepth(3);
      };

      // ============================
      // PERIMETER WALLS
      // ============================
      // Top wall (full width): outline + face = 64px tall
      drawHWall(0, 0, width);
      // Corners
      drawCorner(0, 0, 'tl');
      drawCorner(width - T, 0, 'tr');

      // Bottom wall: outline + face = 64px tall, placed at bottom
      drawHWall(0, height - T * 2, width);

      // Left wall (vertical): outline + shadow
      drawVWall(0, T * 2, height - T * 2);

      // Right wall (vertical): outline + shadow
      drawVWall(width - T, T * 2, height - T * 2);

      // ============================
      // INTERNAL WALLS — room divisions with doorway gaps (96px = 3 tiles)
      // ============================

      // Vertical divider (x=848): separates open office (left) from right rooms
      drawVWall(848, T * 2, 160);                // top portion
      // gap y=160-256 (door to manager office, 96px)
      drawVWall(848, 256, 416);                   // middle portion
      // gap y=416-512 (hallway connection, 96px)
      drawVWall(848, 512, height - T * 2);        // bottom portion

      // T-junction where vertical divider meets top wall
      drawCorner(848, 0, 'tjr');
      // T-junction where vertical divider meets bottom wall
      this.add.image(848, height - T * 2, 'wall_tjunc_r').setOrigin(0, 0).setDepth(5.1);

      // Horizontal divider (y=448): separates top offices from bottom rooms (left side)
      drawHWall(T, 448, 288);                    // left of break room door
      // gap x=288-384 (door to break room, 96px)
      drawHWall(384, 448, 848);                   // right of break room door

      // Horizontal divider (y=256, right side): manager from conference/supply
      drawHWall(848 + T, 256, 1000);             // left of door
      // gap x=1000-1096 (door, 96px)
      drawHWall(1096, 256, width - T);            // right of door

      // Continue with character setup + furniture placement.
    } else {
    // --- Office layout (tile-based): rooms + corridor like the reference screenshot ---
    // We render walls using a solid wall tile from `wall_tiles`, and keep collisions via static rectangles.
    // Wall tile: Room Builder Office — white office wall panel at pixel (0, 0) in the Room Builder sheet
    // The top-left of the Room Builder sheet has clean white wall sections with dark blue trim lines.
    const wallTileSize = 32;
    if (this.textures.exists('wall_single')) this.textures.remove('wall_single');
    const wallSingle = this.textures.createCanvas('wall_single', wallTileSize, wallTileSize);
    wallSingle.context.imageSmoothingEnabled = false;
    wallSingle.context.clearRect(0, 0, wallTileSize, wallTileSize);
    if (rbImg) {
      // Room Builder wall: solid white wall fill tile at pixel (320, 0)
      wallSingle.context.drawImage(rbImg, 320, 0, 32, 32, 0, 0, wallTileSize, wallTileSize);
    } else {
      wallSingle.context.fillStyle = '#d4c8b8';
      wallSingle.context.fillRect(0, 0, wallTileSize, wallTileSize);
    }
    wallSingle.refresh();

    const drawWallRectTiles = (x, y, w, h) => {
      const tx0 = Math.floor(x / wallTileSize);
      const ty0 = Math.floor(y / wallTileSize);
      const tx1 = Math.ceil((x + w) / wallTileSize);
      const ty1 = Math.ceil((y + h) / wallTileSize);
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          this.add.image(tx * wallTileSize, ty * wallTileSize, 'wall_single')
            .setOrigin(0, 0)
            .setDepth(5);
        }
      }
      // Collision
      const obstacle = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0);
      this.physics.add.existing(obstacle, true);
      this._obstacles.push(obstacle);
    };

    // Outer border (tile walls)
    drawWallRectTiles(0, 0, width, 24);
    drawWallRectTiles(0, 0, 24, height);
    drawWallRectTiles(width - 24, 0, 24, height);
    drawWallRectTiles(0, height - 24, width, 24);

    // Corridor top/bottom boundaries
    drawWallRectTiles(0, corridorY - 16, width, 16);
    drawWallRectTiles(0, corridorY + corridorH, width, 16);

    // Top row: 3 small rooms (dividers)
    const roomTopY = 24;
    const roomH = corridorY - roomTopY - 16;
    const roomW = Math.floor((width - 24 * 2 - 40 * 2) / 3);
    const gap = 40;
    let rx = 24 + gap;
    for (let i = 0; i < 3; i++) {
      drawWallRectTiles(rx - 8, roomTopY, 8, roomH);
      drawWallRectTiles(rx + roomW, roomTopY, 8, roomH);
      drawWallRectTiles(rx - 8, roomTopY, roomW + 16, 8);
      rx += roomW + gap;
    }

    // Bottom-left security room divider + bottom-right room boundary
    drawWallRectTiles(24, bottomY, Math.floor(width * 0.58), 8);
    drawWallRectTiles(Math.floor(width * 0.58), bottomY, 8, bottomH);
    drawWallRectTiles(Math.floor(width * 0.58) + 8, bottomY, width - (Math.floor(width * 0.58) + 8) - 24, 8);

    // Corridor floor strip (dark) + clinic room floor (blue) to match reference.
    const corridorFloor = this.add.tileSprite(width / 2, corridorY + corridorH / 2, width - 48, corridorH, 'corridor_single');
    corridorFloor.setDepth(1);
    // Clinic room = bottom-right area
    const clinicX0 = Math.floor(width * 0.58) + 8;
    const clinicW = width - clinicX0 - 24;
    const clinicFloor = this.add.tileSprite(
      clinicX0 + clinicW / 2,
      bottomY + bottomH / 2,
      clinicW,
      bottomH,
      'clinic_single'
    );
    clinicFloor.setDepth(0.5);
    }

    // Arcade physics
    this.physics.world.setBounds(0, 0, width, height);

    // Unified animation registration for all XP characters.
    // Registers walk + idle anims for any texture key. Safe to call multiple times.
    const registerXpAnims = (texKey) => {
      const makeKey = (k) => `${texKey}:${k}`;
      const defs = {
        walk_down:  { frames: [0, 1, 2, 3],   fps: 10, loop: true },
        walk_left:  { frames: [4, 5, 6, 7],   fps: 10, loop: true },
        walk_right: { frames: [8, 9, 10, 11], fps: 10, loop: true },
        walk_up:    { frames: [12, 13, 14, 15], fps: 10, loop: true },
        idle_down:  { frames: [0],  fps: 0, loop: true },
        idle_left:  { frames: [4],  fps: 0, loop: true },
        idle_right: { frames: [8],  fps: 0, loop: true },
        idle_up:    { frames: [12], fps: 0, loop: true }
      };
      if (!this.anims.exists(makeKey('walk_down'))) {
        Object.entries(defs).forEach(([name, def]) => {
          this.anims.create({
            key: makeKey(name),
            frames: this.anims.generateFrameNumbers(texKey, { frames: def.frames }),
            frameRate: def.fps,
            repeat: def.loop === false ? 0 : -1
          });
        });
      }
      return makeKey;
    };

    // Register XP animations for NPCs
    registerXpAnims('player_xp');

    // --- Dolo: Character Generator 2.0 (24 cols x 1 row, 32x64 frames) ---
    // 4 dirs × 6 frames: RIGHT(0-5), UP(6-11), LEFT(12-17), DOWN(18-23)
    // Idle = frame 0 of each direction (neutral standing pose)
    const registerDoloAnims = () => {
      const texKey = 'dolo';
      const makeKey = (k) => `${texKey}:${k}`;
      const defs = {
        idle_right: { frames: [2],                     fps: 1 },
        idle_up:    { frames: [8],                     fps: 1 },
        idle_left:  { frames: [14],                    fps: 1 },
        idle_down:  { frames: [20],                    fps: 1 },
        walk_right: { frames: [0, 1, 2, 3, 4, 5],     fps: 10 },
        walk_up:    { frames: [6, 7, 8, 9, 10, 11],   fps: 10 },
        walk_left:  { frames: [12, 13, 14, 15, 16, 17], fps: 10 },
        walk_down:  { frames: [18, 19, 20, 21, 22, 23], fps: 10 }
      };
      Object.entries(defs).forEach(([name, def]) => {
        this.anims.create({
          key: makeKey(name),
          frames: this.anims.generateFrameNumbers(texKey, { frames: def.frames }),
          frameRate: def.fps,
          repeat: -1
        });
      });
      return makeKey;
    };
    this._playerAnimKey = registerDoloAnims();

    // --- Player character (Dolo) ---
    // Character Generator 2.0 sprites are 16x32, designed for LimeZu 32x32 tileset
    this.player = this.physics.add.sprite(310, 200, 'dolo', 0);
    this.player.setOrigin(0.5, 1);
    this.player.setScale(1); // native 32x64, natural proportions
    this.player.setCollideWorldBounds(true);
    this.player.setFrame(20); // front-facing idle (down) - 3rd frame is standing pose
    const scale = 1; // used by NPCs below

    // Camera: 2x zoom, follow player, clamp to world bounds
    this.cameras.main.setZoom(2);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setBounds(0, 0, 1280, 720);

    // --- NPCs: spawn all XP characters and make them wander/follow-chain ---
    this.npcs = [];
    const npcKeys = [
      'xp_abby',
      'xp_alex',
      'xp_bob',
      'xp_dan',
      'xp_jenny',
      'xp_lucy'
    ];

    // Spawn NPCs at desk chairs in the open office and spread others around rooms.
    const deskSpawns = [
      { x: 128, y: 156 }, { x: 196, y: 156 }, { x: 388, y: 156 }, { x: 456, y: 156 },
      { x: 648, y: 156 }, { x: 716, y: 156 }, { x: 128, y: 296 }, { x: 196, y: 296 },
      { x: 388, y: 406 }, { x: 456, y: 406 }
    ];
    const otherSpawns = [
      { x: 1060, y: 160 }, { x: 140, y: 630 }, { x: 580, y: 610 }, { x: 1040, y: 390 }
    ];
    const npcCount = layoutParam === 'reference_office' ? 2 : Math.min(12, npcKeys.length);
    npcKeys.slice(0, npcCount).forEach((texKey, i) => {
      const spawn = i < deskSpawns.length ? deskSpawns[i] : otherSpawns[i - deskSpawns.length] || { x: Phaser.Math.Between(120, 1100), y: Phaser.Math.Between(120, 600) };
      const x = spawn.x + Phaser.Math.Between(-10, 10);
      const y = spawn.y + Phaser.Math.Between(-10, 10);
      const npc = this.physics.add.sprite(x, y, texKey, 8);
      npc.setOrigin(0.5, 1);
      npc.setScale(scale);
      npc.setCollideWorldBounds(true);
      npc.setDrag(900, 900);
      npc.body.setMaxVelocity(160, 160);
      npc.ai = {
        mode: 'wander',
        facing: 'right',
        nextWanderAt: 0,
        wanderTarget: { x, y },
        followOffset: { x: (i % 4) * 32 - 48, y: Math.floor(i / 4) * 28 - 28 }
      };
      npc._animKey = registerXpAnims(texKey);
      this.npcs.push(npc);
    });

    // Hotkeys: F = toggle follow-chain, W = toggle wander for all NPCs
    this.aiKeys = this.input.keyboard.addKeys('F,W');
    this.aiKeys.F.on('down', () => {
      this.npcs.forEach((n) => { n.ai.mode = 'follow'; });
    });
    this.aiKeys.W.on('down', () => {
      this.npcs.forEach((n) => { n.ai.mode = 'wander'; n.ai.nextWanderAt = 0; });
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.interactKeys = this.input.keyboard.addKeys({ E: 'E', SPACE: 'SPACE' });
    this.playerState = 'walk'; // 'walk' | 'interacting'
    this.playerLocked = false;

    // Click any NPC to show a dialog with their texture key
    this.npcs.forEach((npc) => {
      npc.setInteractive({ useHandCursor: true });
      npc.on('pointerdown', () => {
        const rawKey = npc.texture.key;
        const displayName = rawKey.replace('xp_', '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const roles = ['Worker', 'Worker', 'Manager', 'Receptionist', 'Security', 'Worker', 'Worker', 'Manager', 'Worker', 'Worker', 'Receptionist', 'Security', 'Worker', 'Manager', 'Worker', 'Worker'];
        const role = roles[this.npcs.indexOf(npc)] || 'Worker';
        this.showNpcDialog(displayName, `Role: ${role}\n\nPress E or Space to interact.`);
      });
    });

    this.dialogBox = null;

    // Track which way the player is facing for better idle behavior.
    // Possible values: 'down', 'up', 'left', 'right'
    this.facing = 'right';

    // --- Universal Object Loader (furniture_catalog = pixel-perfect slicing, bottom anchor, decor stacking) ---
    this.furnitureDecorSprites = [];
    this._placedCatalogSprites = {}; // instanceId -> sprite for decor parent lookup
    if (!Array.isArray(this._obstacles)) this._obstacles = [];
    this._interactables = []; // { id, sprite, def, taskId? }
    // In reference_office seeded mode, furniture is already placed from the recipe; skip duplicate placements.
    const skipCatalogPlacements = this._skipHandcraftedLayout && layoutParam === 'reference_office';
    const furnitureCatalog = skipCatalogPlacements
      ? null
      : this.cache.json.get('furniture_catalog_openplan');
    const placements = furnitureCatalog?.placements;
    const catalogObjects = furnitureCatalog?.objects;
    const sliceMargin = (furnitureCatalog?.info?.slice_margin_px !== undefined) ? furnitureCatalog.info.slice_margin_px : 0;

    if (catalogObjects && Array.isArray(placements) && placements.length > 0) {
      // Build texture for each object id from catalog (pixel x,y,w,h; optional 2px margin for shadows)
      // Master catalog support: defs might originate in master_furniture_catalog instead of local objects
      const masterCatalog = this.cache.json.get('master_furniture_catalog');
      const masterObjs = masterCatalog ? masterCatalog.objects : {};
      
      const requiresDynamicLoad = new Set();

      placements.forEach((pl) => {
        const id = pl.id;
        let def = id ? catalogObjects[id] : null;
        if (!def && id && masterObjs[id]) def = masterObjs[id];
        if (!def) return;
        
        if (def.source_type === 'single_file') {
           // Singles are preloaded in preload() as single_${single_id}.
           // Map object id -> texture key for later placement.
           const singleTexKey = `single_${def.single_id || pl.id}`;
           if (this.textures.exists(singleTexKey)) {
             // Nothing to slice; texture already loaded from preload().
           } else {
             // Fallback: try dynamic load via url_path if available
             if (def.url_path) {
               const cleanPath = def.url_path.replace(/^assets[\\/]/, '').replace(/\\/g, '/');
               const fullUrl = '../pixel%20game%20stuff/pixel%20game%20assets%20and%20stuff/' + cleanPath.split('/').map(encodeURIComponent).join('/');
               requiresDynamicLoad.add({ id: pl.id, url: fullUrl });
             }
           }
           return;
        }

        const sheetKey = def.sheet;
        if (!sheetKey || !this.textures.exists(sheetKey)) return;
        const img = this.textures.get(sheetKey).getSourceImage();
        let sx = def.rect ? def.rect.x : (def.x || 0);
        let sy = def.rect ? def.rect.y : (def.y || 0);
        let sw = Math.max(1, def.rect ? def.rect.w : (def.w || 16));
        let sh = Math.max(1, def.rect ? def.rect.h : (def.h || 16));
        if (sliceMargin > 0) {
          const ms = sliceMargin;
          sx = Math.max(0, sx - ms);
          sy = Math.max(0, sy - ms);
          sw = Math.min(img.width - sx, sw + 2 * ms);
          sh = Math.min(img.height - sy, sh + 2 * ms);
        }
        const texKey = `cat_${pl.id}`;
        if (this.textures.exists(texKey)) return;
        const canvasTex = this.textures.createCanvas(texKey, sw, sh);
        canvasTex.context.imageSmoothingEnabled = false;
        canvasTex.context.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        canvasTex.refresh();
      });

      // Define a helper to actually place the objects once assets are ready
      const finalizePlacements = () => {
        // Place furniture first (bottom-center = placement x,y)
        placements.forEach((pl) => {
          if (pl.parentInstanceId) return; // decor placed after
          let def = catalogObjects[pl.id];
          if (!def && masterObjs[pl.id]) def = masterObjs[pl.id];
          
          let texKey = `cat_${pl.id}`;
          if (def && def.source_type === 'single_file') texKey = `single_${def.single_id || pl.id}`;

          if (!def || !this.textures.exists(texKey)) return;
          const depth = typeof def.depth === 'number' ? def.depth : 1.5;
          const originY = def.origin === 'center' ? 0.5 : 1;
          const s = this.add.image(pl.x, pl.y, texKey).setOrigin(0.5, originY).setDepth(depth);
          if (def.source_type === 'single_file') {
            const dw = def.display_w || 32;
            const dh = def.display_h || 48;
            s.setDisplaySize(dw, dh);
          }
          this.furnitureDecorSprites.push({ sprite: s, depth });
          const instanceId = pl.instanceId || pl.id;
          this._placedCatalogSprites[instanceId] = s;
          const interactable = { id: pl.id, instanceId, sprite: s, def: { ...def, _placement: pl }, obstacle: null, parentInstanceId: null };

          // Auto-collision box: only large furniture blocks movement (not chairs/seats/small items).
          if (def.type !== 'decor' && def.type !== 'seat' && s.displayWidth >= 48) {
            const obstacle = this.add.rectangle(pl.x, pl.y, s.displayWidth, 16, 0x000000, 0);
            obstacle.setOrigin(0.5, 1);
            this.physics.add.existing(obstacle, true);
            this._obstacles.push(obstacle);
            interactable.obstacle = obstacle;
          }
          this._interactables.push(interactable);
        });
        
        // Place decor on parent + offset (smart stacking)
        placements.forEach((pl) => {
          if (!pl.parentInstanceId) return;
          let def = catalogObjects[pl.id];
          if (!def && masterObjs[pl.id]) def = masterObjs[pl.id];
          
          const parentSprite = this._placedCatalogSprites[pl.parentInstanceId];
          
          let texKey = `cat_${pl.id}`;
          if (def && def.source_type === 'single_file') texKey = `single_${def.single_id || pl.id}`;

          if (!def || !parentSprite || !this.textures.exists(texKey)) return;
          const offsetY = pl.parent_offset_y !== undefined ? pl.parent_offset_y : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
          const depth = typeof def.depth === 'number' ? def.depth : 2;
          const originY = def.origin === 'center' ? 0.5 : 1;
          const s = this.add.image(parentSprite.x, parentSprite.y + offsetY, texKey).setOrigin(0.5, originY).setDepth(depth);
          if (def.source_type === 'single_file') {
            const dw = def.display_w || 32;
            const dh = def.display_h || 48;
            s.setDisplaySize(dw, dh);
          }
          this.furnitureDecorSprites.push({ sprite: s, depth });
          const instanceId = pl.instanceId || pl.id;
          this._interactables.push({ id: pl.id, instanceId, sprite: s, def: { ...def, _placement: pl }, obstacle: null, parentInstanceId: pl.parentInstanceId || null });
        });
      };
      
      if (requiresDynamicLoad.size > 0) {
          requiresDynamicLoad.forEach(req => {
              if(!this.textures.exists(`single_${req.id}`)) {
                  this.load.image(`single_${req.id}`, req.url);
              }
          });
          this.load.once('complete', finalizePlacements);
          this.load.start();
      } else {
          finalizePlacements();
      }
    } else {
      // Fallback: object-defs (tile-index) + desk/computer placement
      const BASE_GRID = 16;
      const SHEET_TILE = 32;
      const TILES_PER_ROW = 24;
      const od = this.cache.json.get('object_defs');
      const objects = (od && od.objects) ? od.objects : {};
      const sheetTex = this.textures.get('office_tiles')?.getSourceImage();
      if (sheetTex && Object.keys(objects).length > 0) {
        const furniture = [];
        const decor = [];
        Object.entries(objects).forEach(([key, obj]) => {
          const topLeftIndex = obj.topLeftIndex ?? 0;
          const w = Math.max(1, obj.w ?? 1);
          const h = Math.max(1, obj.h ?? 1);
          const pixelW = w * BASE_GRID;
          const pixelH = h * BASE_GRID;
          const col = topLeftIndex % TILES_PER_ROW;
          const row = Math.floor(topLeftIndex / TILES_PER_ROW);
          const sx = col * SHEET_TILE;
          const sy = row * SHEET_TILE;
          const texKey = `obj_${key}`;
          if (this.textures.exists(texKey)) this.textures.remove(texKey);
          const canvasTex = this.textures.createCanvas(texKey, pixelW, pixelH);
          canvasTex.context.imageSmoothingEnabled = false;
          canvasTex.context.drawImage(sheetTex, sx, sy, pixelW, pixelH, 0, 0, pixelW, pixelH);
          canvasTex.refresh();
          const depth = typeof obj.depth === 'number' ? obj.depth : (obj.type === 'decor' ? 2 : 1.5);
          const entry = { key, texKey, pixelW, pixelH, depth, render_offset: obj.render_offset || { x: 0, y: 0 }, type: obj.type, pivot: obj.pivot || 'bottom' };
          if (obj.type === 'decor') decor.push(entry);
          else furniture.push(entry);
        });
        const place = (entry, worldX, worldY) => {
          const x = worldX + (entry.render_offset?.x || 0);
          const y = worldY + (entry.render_offset?.y || 0);
          const originY = entry.pivot === 'center' ? 0.5 : 1;
          const s = this.add.image(x, y, entry.texKey).setOrigin(0.5, originY).setDepth(entry.depth);
          this.furnitureDecorSprites.push({ sprite: s, depth: entry.depth });

          if (entry.type !== 'decor') {
            const obstacle = this.add.rectangle(x, y, s.displayWidth, 16, 0x000000, 0);
            obstacle.setOrigin(0.5, 1);
            this.physics.add.existing(obstacle, true);
            this._obstacles.push(obstacle);
          }
        };
        const deskXY = { x: 400, y: 400 };
        const computerXY = { x: 400, y: 400 };
        furniture.forEach((entry) => place({ ...entry, render_offset: { x: 0, y: 0 } }, deskXY.x, deskXY.y));
        decor.forEach((entry) => place(entry, computerXY.x, computerXY.y));
      }
    }

    // Hook up collisions: player + NPCs vs furniture obstacles. Decor stays non-blocking.
    if (Array.isArray(this._obstacles) && this._obstacles.length > 0) {
      this._obstacles.forEach((o) => {
        this.physics.add.collider(this.player, o);
        if (Array.isArray(this.npcs)) this.npcs.forEach((npc) => this.physics.add.collider(npc, o));
      });
    }

    // --- World clock + HUD ---
    class WorldClock {
      constructor({ startHour = 9, startMinute = 0, minuteStep = 1, tickMs = 2000 } = {}) {
        this.hour = startHour;
        this.minute = startMinute;
        this.minuteStep = minuteStep;
        this.tickMs = tickMs;
        this._acc = 0;
        this._lastEmitted = null;
      }
      update(deltaMs) {
        this._acc += deltaMs;
        let changed = false;
        while (this._acc >= this.tickMs) {
          this._acc -= this.tickMs;
          this.minute += this.minuteStep;
          while (this.minute >= 60) { this.minute -= 60; this.hour = (this.hour + 1) % 24; }
          changed = true;
        }
        return changed;
      }
      toString() {
        const hh = String(this.hour).padStart(2, '0');
        const mm = String(this.minute).padStart(2, '0');
        return `${hh}:${mm}`;
      }
      isLate() { return this.hour >= 22; }
    }
    this.worldClock = new WorldClock({ startHour: 9, startMinute: 0, tickMs: 2000 });
    this.timeText = this.add.text(16, 44, `Time: ${this.worldClock.toString()}`, {
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
      fontSize: '14px',
      color: '#e5e7eb'
    }).setDepth(1000).setScrollFactor(0);

    // Find a bed to highlight at night
    this._bedInteractable = this._interactables.find((it) => it?.def?.action === 'sleep') || null;

    // --- Task model (AI workflow stubs) ---
    this._tasks = this.cache.json.get('tasks')?.tasks || [];
    this._currentTask = null;

    // --- OpenClaw Gateway Bridge ---
    if (window.GatewayBridge && window.NpcAgentController) {
      this._gatewayBridge = new window.GatewayBridge();
      this._npcAgentCtrl = new window.NpcAgentController(this, this._gatewayBridge);
      this._npcAgentCtrl.init();
      this._gatewayBridge.connect();
      console.log('[OfficeScene] OpenClaw Gateway Bridge initialized');

      // In-game chat panel (press C to toggle)
      if (window.OpenClawChat) {
        this._openclawChat = new window.OpenClawChat(this._gatewayBridge);
        this.input.keyboard.on('keydown-C', () => {
          // Don't toggle if typing in the chat input
          if (document.activeElement?.id === 'openclaw-chat-input') return;
          this._openclawChat.toggle();
        });
      }
    }
  }

  showNpcDialog(title, body) {
    if (this.dialogBox) {
      this.dialogBox.destroy();
      this.dialogBox = null;
    }

    const panelW = 520;
    const panelH = 170;
    const cx = 1280 / 2;
    const cy = 720 - panelH / 2 - 24;

    const children = [];

    // Try to use Modern UI Style 2 panel tiles for the background.
    // The ui_style2 sheet (32x32 tiles) has a clean gray window panel starting at pixel (0,0).
    // We build the dialog background using 9 canvas slices: 4 corners + 4 edges + 1 center.
    const uiImg = this.textures.exists('ui_style2')
      ? this.textures.get('ui_style2').getSourceImage()
      : null;

    if (uiImg) {
      // 9-slice panel using Room Builder UI tiles at 32x32.
      // From Style_2_32x32: the second gray panel (medium gray) starts at approximately px (0, 64).
      // Corner size: 32x32. Edge tiles: same. Center: stretches to fill.
      const T = 32; // tile size
      // Panel origin in the sheet — the medium-gray dialog panel
      const PX = 0, PY = 64;
      // Panel layout: top-left corner, top edge, top-right corner, etc.
      const slices = [
        // corners
        { name: 'dlg_tl', sx: PX,      sy: PY,      sw: T, sh: T, dx: cx - panelW/2,          dy: cy - panelH/2 },
        { name: 'dlg_tr', sx: PX+T*2,  sy: PY,      sw: T, sh: T, dx: cx + panelW/2 - T,       dy: cy - panelH/2 },
        { name: 'dlg_bl', sx: PX,      sy: PY+T*2,  sw: T, sh: T, dx: cx - panelW/2,          dy: cy + panelH/2 - T },
        { name: 'dlg_br', sx: PX+T*2,  sy: PY+T*2,  sw: T, sh: T, dx: cx + panelW/2 - T,       dy: cy + panelH/2 - T },
      ];

      // Build canvas textures for each slice piece
      slices.forEach(({ name, sx, sy, sw, sh, dx, dy }) => {
        if (!this.textures.exists(name)) {
          const ct = this.textures.createCanvas(name, sw, sh);
          ct.context.imageSmoothingEnabled = false;
          ct.context.drawImage(uiImg, sx, sy, sw, sh, 0, 0, sw, sh);
          ct.refresh();
        }
        children.push(this.add.image(dx + sw/2, dy + sh/2, name).setOrigin(0.5, 0.5));
      });

      // Center fill: edge tile (PX+T, PY+T) tiled across the interior
      const innerX = cx - panelW/2 + T;
      const innerY = cy - panelH/2 + T;
      const innerW = panelW - T*2;
      const innerH = panelH - T*2;
      if (!this.textures.exists('dlg_center')) {
        const ct = this.textures.createCanvas('dlg_center', T, T);
        ct.context.imageSmoothingEnabled = false;
        ct.context.drawImage(uiImg, PX+T, PY+T, T, T, 0, 0, T, T);
        ct.refresh();
      }
      children.push(this.add.tileSprite(innerX + innerW/2, innerY + innerH/2, innerW, innerH, 'dlg_center'));

      // Top bar strip
      if (!this.textures.exists('dlg_top_edge')) {
        const ct = this.textures.createCanvas('dlg_top_edge', T, T);
        ct.context.imageSmoothingEnabled = false;
        ct.context.drawImage(uiImg, PX+T, PY, T, T, 0, 0, T, T);
        ct.refresh();
      }
      children.push(this.add.tileSprite(cx, cy - panelH/2 + T/2, panelW - T*2, T, 'dlg_top_edge'));

      // Bottom edge
      if (!this.textures.exists('dlg_bot_edge')) {
        const ct = this.textures.createCanvas('dlg_bot_edge', T, T);
        ct.context.imageSmoothingEnabled = false;
        ct.context.drawImage(uiImg, PX+T, PY+T*2, T, T, 0, 0, T, T);
        ct.refresh();
      }
      children.push(this.add.tileSprite(cx, cy + panelH/2 - T/2, panelW - T*2, T, 'dlg_bot_edge'));

      // Left edge
      if (!this.textures.exists('dlg_left_edge')) {
        const ct = this.textures.createCanvas('dlg_left_edge', T, T);
        ct.context.imageSmoothingEnabled = false;
        ct.context.drawImage(uiImg, PX, PY+T, T, T, 0, 0, T, T);
        ct.refresh();
      }
      children.push(this.add.tileSprite(cx - panelW/2 + T/2, cy, T, panelH - T*2, 'dlg_left_edge'));

      // Right edge
      if (!this.textures.exists('dlg_right_edge')) {
        const ct = this.textures.createCanvas('dlg_right_edge', T, T);
        ct.context.imageSmoothingEnabled = false;
        ct.context.drawImage(uiImg, PX+T*2, PY+T, T, T, 0, 0, T, T);
        ct.refresh();
      }
      children.push(this.add.tileSprite(cx + panelW/2 - T/2, cy, T, panelH - T*2, 'dlg_right_edge'));

    } else {
      // Fallback: plain styled rectangle if UI sheet not loaded
      children.push(this.add.rectangle(cx + 4, cy + 4, panelW, panelH, 0x000000, 0.5));
      children.push(
        this.add.rectangle(cx, cy, panelW, panelH, 0x0f172a, 0.97)
          .setStrokeStyle(2, 0x3b82f6)
      );
    }

    // Title bar background
    children.push(
      this.add.rectangle(cx, cy - panelH/2 + 18, panelW - 8, 28, 0x1e3a5f, 0.85)
        .setOrigin(0.5, 0.5)
    );

    // Title text
    children.push(
      this.add.text(cx - panelW/2 + 16, cy - panelH/2 + 7, title, {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#93c5fd'
      })
    );

    // Body text
    children.push(
      this.add.text(cx - panelW/2 + 16, cy - panelH/2 + 40, body, {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '13px',
        color: '#e2e8f0',
        wordWrap: { width: panelW - 32 }
      })
    );

    // Close hint
    children.push(
      this.add.text(cx + panelW/2 - 16, cy + panelH/2 - 12, '[E] Close', {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '11px',
        color: '#64748b'
      }).setOrigin(1, 1)
    );

    this.dialogBox = this.add.container(0, 0, children);
    this.dialogBox.setDepth(1000);
  }

  update() {
    if (!this.cursors) return;
    const speed = 220;
    const body = this.player.body;

    // World clock tick + late-night hint
    if (this.worldClock && this.worldClock.update(this.game.loop.delta)) {
      if (this.timeText) this.timeText.setText(`Time: ${this.worldClock.toString()}`);
      if (this.worldClock.isLate() && this._bedInteractable?.sprite) {
        // highlight bed (simple pulse tint)
        const t = (this.time.now % 600) / 600;
        const on = t < 0.5;
        this._bedInteractable.sprite.setTint(on ? 0xfff3b0 : 0xffffff);
        if (!this._didYawn) {
          this._didYawn = true;
          this.showNpcDialog('Adam', 'Yawn... It’s getting late. Maybe I should sleep.');
        }
      }
    }

    // Automated Z-sorting (Y-sorting): sort ALL sprites by bottom_y and assign depth.
    // This is the “brain”: if character.bottom_y < desk.bottom_y they draw behind; if > they draw in front.
    const bottomY = (s) => s.y + (s.displayHeight * (1 - s.originY));
    const sortable = [];
    if (this.player) sortable.push(this.player);
    if (Array.isArray(this.npcs)) sortable.push(...this.npcs);
    if (Array.isArray(this.furnitureDecorSprites)) sortable.push(...this.furnitureDecorSprites.map((e) => e.sprite).filter(Boolean));
    sortable.sort((a, b) => bottomY(a) - bottomY(b));
    sortable.forEach((s, i) => s.setDepth(10 + i));

    // Interaction: press E/Space near object in front of player.
    const interactPressed = (this.interactKeys?.E?.isDown || this.interactKeys?.SPACE?.isDown);
    if (!this._interactWasDown) this._interactWasDown = false;
    const justPressed = interactPressed && !this._interactWasDown;
    this._interactWasDown = interactPressed;

    const facingVec = (() => {
      if (this.facing === 'up') return { x: 0, y: -1 };
      if (this.facing === 'down') return { x: 0, y: 1 };
      if (this.facing === 'left') return { x: -1, y: 0 };
      return { x: 1, y: 0 };
    })();

    const standUp = () => {
      this.playerLocked = false;
      this.playerState = 'walk';
    };

    if (justPressed && !this.playerLocked && Array.isArray(this._interactables)) {
      const maxDistDefault = 64;
      let best = null;
      for (const it of this._interactables) {
        if (!it?.sprite) continue;
        const def = it.def || {};
        const maxDist = def.interact_distance ?? maxDistDefault;
        const dx = it.sprite.x - this.player.x;
        const dy = it.sprite.y - this.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist) continue;
        // must be roughly in front of player (dot product)
        const dot = (dx / (dist || 1)) * facingVec.x + (dy / (dist || 1)) * facingVec.y;
        if (dot < 0.25) continue;
        if (!best || dist < best.dist) best = { it, dist };
      }

      if (best) {
        const { it } = best;
        const def = it.def || {};
        if (def.action === 'use_computer' || def.action === 'use_it') {
          // Generic PC / device use → launch task stub if available.
          const task = (this._tasks || []).find((t) => t.id === 'pc_research') || null;
          this._currentTask = task;
          const label = task?.label || 'Accessing Computer';
          this.showNpcDialog('Computer', `${label}...\nTime: ${this.worldClock?.toString?.() || ''}\n\n(This is a stub – real AI workflow can be wired here later.)`);
          this.playerLocked = true;
          this.playerState = 'interacting';
          this.facing = 'down';
        } else if (def.action === 'sleep') {
          this.showNpcDialog('Bed', `Sleeping... Time: ${this.worldClock?.toString?.() || ''}`);
          const snap = def.snap_offset || { x: 0, y: 0 };
          this.player.setPosition(it.sprite.x + (snap.x || 0), it.sprite.y + (snap.y || 0));
          this.playerLocked = true;
          this.playerState = 'interacting';
          this.facing = 'down';
        } else if (def.type === 'seat' || String(it.id).includes('bench')) {
          this.showNpcDialog('Seat', 'Sitting...');
          this.player.setPosition(it.sprite.x, it.sprite.y - Math.floor(it.sprite.displayHeight * 0.55));
          this.playerLocked = true;
          this.playerState = 'interacting';
          this.facing = 'down';
        }
      }
    } else if (justPressed && this.playerLocked) {
      standUp();
    }

    // If interacting, any movement key stands up.
    const leftKey = this.cursors.left.isDown;
    const rightKey = this.cursors.right.isDown;
    const upKey = this.cursors.up.isDown;
    const downKey = this.cursors.down.isDown;
    if (this.playerLocked && (leftKey || rightKey || upKey || downKey)) {
      standUp();
    }

    if (this.playerLocked) {
      body.setVelocity(0, 0);
      this.player.anims.stop();
      return;
    }

    body.setVelocity(0);
    let moving = false;

    const left = leftKey;
    const right = rightKey;
    const up = upKey;
    const down = downKey;

    if (left) {
      body.setVelocityX(-speed);
      moving = true;
      this.facing = 'left';
    } else if (right) {
      body.setVelocityX(speed);
      moving = true;
      this.facing = 'right';
    }

    if (up) {
      body.setVelocityY(-speed);
      moving = true;
      if (!left && !right) this.facing = 'up';
    } else if (down) {
      body.setVelocityY(speed);
      moving = true;
      if (!left && !right) this.facing = 'down';
    }

    if (moving) {
      const baseKey = (dir) => {
        const fn = this._playerAnimKey;
        return fn ? fn(`walk_${dir}`) : `player_xp:walk_${dir}`;
      };
      if (this.facing === 'up') {
        this.player.anims.play(baseKey('up'), true);
      } else if (this.facing === 'down') {
        this.player.anims.play(baseKey('down'), true);
      } else if (this.facing === 'left') {
        this.player.anims.play(baseKey('left'), true);
      } else if (this.facing === 'right') {
        this.player.anims.play(baseKey('right'), true);
      }
    } else {
      // Idle: play idle animation or hold first walk frame for that direction.
      const idleKey = (dir) => {
        const fn = this._playerAnimKey;
        return fn ? fn(`idle_${dir}`) : `player_xp:idle_${dir}`;
      };
      if (this.facing === 'up') {
        this.player.anims.play(idleKey('up'), true);
      } else if (this.facing === 'down') {
        this.player.anims.play(idleKey('down'), true);
      } else if (this.facing === 'left') {
        this.player.anims.play(idleKey('left'), true);
      } else if (this.facing === 'right') {
        this.player.anims.play(idleKey('right'), true);
      }
    }

    // --- NPC AI ---
    if (Array.isArray(this.npcs)) {
      const now = this.time.now;
      const followDistance = 44;
      const followSpeed = 140;
      const wanderSpeed = 90;

      this.npcs.forEach((npc, idx) => {
        const ai = npc.ai;
        if (!ai) return;

        let target = null;
        if (ai.mode === 'agent_task') {
          // AI agent task: walk to assigned position and stay
          const t = ai.taskTarget || { x: 400, y: 300 };
          const dx = t.x - npc.x;
          const dy = t.y - npc.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 8) {
            npc.body.setVelocity((dx / dist) * wanderSpeed, (dy / dist) * wanderSpeed);
            ai.taskState = 'walking';
          } else {
            npc.body.setVelocity(0, 0);
            ai.taskState = 'working';
            ai.facing = 'down'; // face desk
          }
        } else if (ai.mode === 'follow') {
          const offset = ai.followOffset || { x: 0, y: 0 };
          const targetX = this.player.x + offset.x;
          const targetY = this.player.y + offset.y;
          const dx = targetX - npc.x;
          const dy = targetY - npc.y;
          const dist = Math.hypot(dx, dy);
          if (dist > followDistance) {
            const vx = (dx / dist) * followSpeed;
            const vy = (dy / dist) * followSpeed;
            npc.body.setVelocity(vx, vy);
          } else {
            npc.body.setVelocity(0, 0);
          }
        } else {
          // wander
          if (now >= ai.nextWanderAt) {
            ai.nextWanderAt = now + Phaser.Math.Between(900, 2200);
            ai.wanderTarget = {
              x: Phaser.Math.Between(120, 1160),
              y: Phaser.Math.Between(160, 600)
            };
          }
          const dx = ai.wanderTarget.x - npc.x;
          const dy = ai.wanderTarget.y - npc.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 12) {
            npc.body.setVelocity((dx / dist) * wanderSpeed, (dy / dist) * wanderSpeed);
          } else {
            npc.body.setVelocity(0, 0);
          }
        }

        // Animations based on velocity
        const vx = npc.body.velocity.x;
        const vy = npc.body.velocity.y;
        const moving = Math.abs(vx) > 2 || Math.abs(vy) > 2;
        if (moving) {
          if (Math.abs(vx) > Math.abs(vy)) {
            ai.facing = vx < 0 ? 'left' : 'right';
          } else {
            ai.facing = vy < 0 ? 'up' : 'down';
          }
          if (ai.facing === 'up') npc.anims.play(npc._animKey('walk_up'), true);
          else if (ai.facing === 'down') npc.anims.play(npc._animKey('walk_down'), true);
          else if (ai.facing === 'left') npc.anims.play(npc._animKey('walk_left'), true);
          else npc.anims.play(npc._animKey('walk_right'), true);
        } else {
          // idle frames: up=12 down=0 left=4 right=8
          if (ai.facing === 'up') npc.setFrame(12);
          else if (ai.facing === 'down') npc.setFrame(0);
          else if (ai.facing === 'left') npc.setFrame(4);
          else npc.setFrame(8);
          npc.anims.stop();
        }
      });
    }

    // Update agent controller bubbles
    if (this._npcAgentCtrl) {
      this._npcAgentCtrl.updateBubbles();
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: 'game-container',
  backgroundColor: '#020617',
  pixelArt: true,
  loader: {
    maxParallelDownloads: 6,   // prevent connection stalls with local serve
    maxRetries: 2
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  },
  scene: [OfficeScene]
};

window.game = new Phaser.Game(config);

// ========== DRAG & DROP EDITOR MODE ==========
// Press E to toggle editor mode. Drag catalog items onto the map or click to place.
// Double-click a placed sprite to delete it. Press X to export the updated placements.
(function() {
  const DOUBLE_CLICK_MS = 260;
  let editorActive = false;
  let selectedSprite = null;
  let editorUI = null;
  let layerFilter = 'all';
  let lastPointerTarget = null;
  let lastPointerAt = 0;

  function getScene() {
    return window.game?.scene?.scenes?.[0];
  }

  function getCatalog(scene) {
    return scene?.cache?.json?.get('furniture_catalog_openplan') || null;
  }

  function clonePlacements(placements) {
    return JSON.parse(JSON.stringify(Array.isArray(placements) ? placements : []));
  }

  function initEditorState(scene) {
    if (scene._editorState) return scene._editorState;
    const catalog = getCatalog(scene);
    scene._editorState = {
      placements: clonePlacements(catalog?.placements),
      nextId: 1,
      pendingCatalogId: null
    };
    return scene._editorState;
  }

  function syncInfo(text) {
    const info = document.getElementById('ed-info');
    if (info) info.textContent = text;
  }

  function setPendingCatalog(id) {
    const scene = getScene();
    if (!scene) return;
    const state = initEditorState(scene);
    state.pendingCatalogId = id || null;
    const selected = document.getElementById('ed-selected');
    if (selected) {
      selected.textContent = state.pendingCatalogId
        ? `Selected: ${state.pendingCatalogId} (${getCatalog(scene)?.objects?.[state.pendingCatalogId]?.type || 'unknown'})`
        : 'Selected: none';
    }
    document.querySelectorAll('#ed-catalog-list .cat-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.catalogId === state.pendingCatalogId);
    });
  }

  function getCanvasWorldPoint(scene, clientX, clientY) {
    const canvas = scene?.game?.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return scene.cameras.main.getWorldPoint(screenX, screenY);
  }

  function snapCoord(value) {
    return window._editorSnap ? Math.round(value / 4) * 4 : Math.round(value);
  }

  function ensureCatalogTexture(scene, catalogId, def) {
    if (!scene || !def) return null;
    if (def.source_type === 'single_file') {
      const singleKey = `single_${def.single_id || catalogId}`;
      return scene.textures.exists(singleKey) ? singleKey : null;
    }

    const texKey = `cat_${catalogId}`;
    if (scene.textures.exists(texKey)) return texKey;

    const sheetKey = def.sheet;
    if (!sheetKey || !scene.textures.exists(sheetKey)) return null;
    const img = scene.textures.get(sheetKey).getSourceImage();
    const catalog = getCatalog(scene);
    const sliceMargin = (catalog?.info?.slice_margin_px !== undefined) ? catalog.info.slice_margin_px : 0;
    let sx = def.rect ? def.rect.x : (def.x || 0);
    let sy = def.rect ? def.rect.y : (def.y || 0);
    let sw = Math.max(1, def.rect ? def.rect.w : (def.w || 16));
    let sh = Math.max(1, def.rect ? def.rect.h : (def.h || 16));
    if (sliceMargin > 0) {
      sx = Math.max(0, sx - sliceMargin);
      sy = Math.max(0, sy - sliceMargin);
      sw = Math.min(img.width - sx, sw + sliceMargin * 2);
      sh = Math.min(img.height - sy, sh + sliceMargin * 2);
    }
    const canvasTex = scene.textures.createCanvas(texKey, sw, sh);
    canvasTex.context.imageSmoothingEnabled = false;
    canvasTex.context.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    canvasTex.refresh();
    return texKey;
  }

  function buildCatalogPreview(scene, catalogId, def) {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 48, 48);

    if (def.source_type === 'single_file') {
      const singleKey = `single_${def.single_id || catalogId}`;
      if (scene.textures.exists(singleKey)) {
        const img = scene.textures.get(singleKey).getSourceImage();
        const scale = Math.min(40 / img.width, 40 / img.height, 1);
        const dw = Math.max(1, Math.round(img.width * scale));
        const dh = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, Math.round((48 - dw) / 2), Math.round((48 - dh) / 2), dw, dh);
      }
      return canvas;
    }

    const sheetKey = def.sheet;
    if (!sheetKey || !scene.textures.exists(sheetKey)) return canvas;
    const img = scene.textures.get(sheetKey).getSourceImage();
    const sx = def.rect ? def.rect.x : (def.x || 0);
    const sy = def.rect ? def.rect.y : (def.y || 0);
    const sw = Math.max(1, def.rect ? def.rect.w : (def.w || 16));
    const sh = Math.max(1, def.rect ? def.rect.h : (def.h || 16));
    const scale = Math.min(40 / sw, 40 / sh, 1);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    ctx.drawImage(img, sx, sy, sw, sh, Math.round((48 - dw) / 2), Math.round((48 - dh) / 2), dw, dh);
    return canvas;
  }

  function renderCatalogList() {
    const scene = getScene();
    const list = document.getElementById('ed-catalog-list');
    if (!scene || !list) return;
    const catalog = getCatalog(scene);
    const state = initEditorState(scene);
    const query = (document.getElementById('ed-search')?.value || '').trim().toLowerCase();
    const entries = Object.entries(catalog?.objects || {})
      .filter(([id, def]) => {
        if (!query) return true;
        return id.toLowerCase().includes(query) || (def.type || '').toLowerCase().includes(query);
      })
      .sort((a, b) => a[0].localeCompare(b[0]));

    list.innerHTML = '';
    entries.forEach(([id, def]) => {
      const item = document.createElement('div');
      item.className = 'cat-item';
      item.dataset.catalogId = id;
      item.draggable = true;
      if (state.pendingCatalogId === id) item.classList.add('active');
      item.appendChild(buildCatalogPreview(scene, id, def));

      const meta = document.createElement('div');
      meta.className = 'cat-meta';
      meta.innerHTML = `<div class="cat-name">${id}</div><div class="cat-type">${def.type || 'unknown'}</div>`;
      item.appendChild(meta);

      item.addEventListener('click', () => setPendingCatalog(id));
      item.addEventListener('dragstart', (event) => {
        setPendingCatalog(id);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', id);
      });
      list.appendChild(item);
    });
  }

  function createEditorUI() {
    if (editorUI) return;
    editorUI = document.createElement('div');
    editorUI.id = 'editor-ui';
    editorUI.innerHTML = `
      <style>
        #editor-ui {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 9999;
          font-family: 'Segoe UI', system-ui, sans-serif;
          color: #fff;
        }
        #editor-toolbar {
          pointer-events: auto;
          position: fixed;
          top: 0;
          left: 0;
          right: 320px;
          height: 38px;
          background: rgba(233, 69, 96, 0.96);
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          font-size: 12px;
        }
        #editor-toolbar .title { font-weight: 700; font-size: 14px; }
        #editor-toolbar .info,
        #editor-toolbar .selected {
          background: rgba(0, 0, 0, 0.28);
          padding: 2px 8px;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }
        #editor-toolbar button,
        #editor-toolbar select,
        #editor-toolbar input {
          background: rgba(0, 0, 0, 0.32);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 11px;
        }
        #editor-toolbar button { cursor: pointer; }
        #editor-toolbar .spacer { margin-left: auto; opacity: 0.72; }
        #editor-catalog {
          pointer-events: auto;
          position: fixed;
          top: 0;
          right: 0;
          width: 320px;
          height: 100vh;
          background: rgba(15, 23, 42, 0.96);
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
        }
        #editor-catalog-head {
          padding: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: grid;
          gap: 8px;
        }
        #ed-catalog-list {
          overflow: auto;
          padding: 10px;
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr;
        }
        .cat-item {
          display: grid;
          grid-template-columns: 52px 1fr;
          gap: 10px;
          align-items: center;
          padding: 8px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          cursor: grab;
          user-select: none;
        }
        .cat-item.active {
          border-color: rgba(253, 224, 71, 0.9);
          background: rgba(253, 224, 71, 0.14);
        }
        .cat-item canvas {
          width: 48px;
          height: 48px;
          image-rendering: pixelated;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 6px;
        }
        .cat-name {
          font-size: 12px;
          font-weight: 600;
          word-break: break-word;
        }
        .cat-type {
          font-size: 11px;
          opacity: 0.7;
          margin-top: 2px;
        }
      </style>
      <div id="editor-toolbar">
        <span class="title">EDITOR MODE</span>
        <span class="info" id="ed-info">Drag a catalog sprite into the room or click to place.</span>
        <span class="selected" id="ed-selected">Selected: none</span>
        <select id="ed-layer">
          <option value="all">All Layers</option>
          <option value="surface">Desks</option>
          <option value="seat">Chairs</option>
          <option value="partition">Dividers</option>
          <option value="decor">Decor/Monitors</option>
          <option value="furniture">Furniture</option>
        </select>
        <button id="ed-export-btn">Export JSON (X)</button>
        <button id="ed-snap-btn">Snap: ON</button>
        <button id="ed-clear-btn">Clear Selection</button>
        <span class="spacer">E=toggle | Drag catalog -> map | Double-click sprite = delete</span>
      </div>
      <aside id="editor-catalog">
        <div id="editor-catalog-head">
          <div style="font-weight:700;">Catalog</div>
          <input id="ed-search" type="text" placeholder="Search by id or type" />
        </div>
        <div id="ed-catalog-list"></div>
      </aside>
    `;
    document.body.appendChild(editorUI);

    document.getElementById('ed-layer').addEventListener('change', (event) => {
      layerFilter = event.target.value;
      updateLayerVisibility();
    });
    document.getElementById('ed-search').addEventListener('input', renderCatalogList);
    document.getElementById('ed-export-btn').addEventListener('click', () => window._editorExport());
    document.getElementById('ed-snap-btn').addEventListener('click', (event) => {
      window._editorSnap = !window._editorSnap;
      event.currentTarget.textContent = `Snap: ${window._editorSnap ? 'ON' : 'OFF'}`;
    });
    document.getElementById('ed-clear-btn').addEventListener('click', () => setPendingCatalog(null));
    renderCatalogList();
  }

  function removeEditorUI() {
    if (editorUI) { editorUI.remove(); editorUI = null; }
  }

  function updateLayerVisibility() {
    const scene = getScene();
    if (!scene || !scene._interactables) return;
    scene._interactables.forEach(it => {
      if (!it.sprite || !it.def) return;
      if (layerFilter === 'all') {
        it.sprite.setAlpha(1);
      } else if (it.def.type === layerFilter) {
        it.sprite.setAlpha(1);
      } else {
        it.sprite.setAlpha(0.2);
      }
    });
  }

  window._editorSnap = true;

  function addObstacle(scene, sprite, def) {
    if (def.type === 'decor' || def.type === 'seat' || sprite.displayWidth < 48) return null;
    const obstacle = scene.add.rectangle(sprite.x, sprite.y, sprite.displayWidth, 16, 0x000000, 0);
    obstacle.setOrigin(0.5, 1);
    scene.physics.add.existing(obstacle, true);
    scene._obstacles.push(obstacle);
    return obstacle;
  }

  function removeObstacle(scene, obstacle) {
    if (!obstacle) return;
    if (Array.isArray(scene._obstacles)) {
      scene._obstacles = scene._obstacles.filter((item) => item !== obstacle);
    }
    obstacle.destroy();
  }

  function makePlacementSprite(scene, placement) {
    const catalog = getCatalog(scene);
    const def = catalog?.objects?.[placement.id];
    if (!def) return null;
    const texKey = ensureCatalogTexture(scene, placement.id, def);
    if (!texKey) return null;

    const isChild = !!placement.parentInstanceId;
    let x = placement.x;
    let y = placement.y;
    if (isChild) {
      const parentSprite = scene._placedCatalogSprites[placement.parentInstanceId];
      if (!parentSprite) return null;
      const offsetY = placement.parent_offset_y !== undefined
        ? placement.parent_offset_y
        : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
      x = parentSprite.x;
      y = parentSprite.y + offsetY;
    }

    const depth = typeof def.depth === 'number' ? def.depth : (isChild ? 2 : 1.5);
    const originY = def.origin === 'center' ? 0.5 : 1;
    const sprite = scene.add.image(x, y, texKey).setOrigin(0.5, originY).setDepth(depth);
    if (def.source_type === 'single_file') {
      sprite.setDisplaySize(def.display_w || 32, def.display_h || 48);
    }
    scene.furnitureDecorSprites.push({ sprite, depth });

    const instanceId = placement.instanceId || placement.id;
    const obstacle = isChild ? null : addObstacle(scene, sprite, def);
    const entry = {
      id: placement.id,
      instanceId,
      sprite,
      def: { ...def, _placement: placement },
      obstacle,
      parentInstanceId: placement.parentInstanceId || null
    };
    scene._placedCatalogSprites[instanceId] = sprite;
    scene._interactables.push(entry);
    if (editorActive) prepareSpriteForEditing(scene, entry);
    updateLayerVisibility();
    return entry;
  }

  function removeEntry(scene, entry) {
    if (!scene || !entry) return;
    const state = initEditorState(scene);
    const children = scene._interactables.filter((item) => item.parentInstanceId === entry.instanceId);
    children.forEach((child) => removeEntry(scene, child));

    removeObstacle(scene, entry.obstacle);
    if (entry.sprite) entry.sprite.destroy();
    delete scene._placedCatalogSprites[entry.instanceId];
    scene._interactables = scene._interactables.filter((item) => item !== entry);
    scene.furnitureDecorSprites = scene.furnitureDecorSprites.filter((item) => item.sprite !== entry.sprite);
    state.placements = state.placements.filter((placement) => (placement.instanceId || placement.id) !== entry.instanceId);
    syncInfo(`Deleted ${entry.id} [${entry.instanceId}]`);
  }

  function addCatalogPlacement(scene, catalogId, worldX, worldY) {
    const catalog = getCatalog(scene);
    const def = catalog?.objects?.[catalogId];
    if (!def) return null;

    const state = initEditorState(scene);
    const placement = {
      id: catalogId,
      instanceId: `editor_${catalogId}_${state.nextId++}`,
      x: snapCoord(worldX),
      y: snapCoord(worldY)
    };
    state.placements.push(placement);
    const entry = makePlacementSprite(scene, placement);
    if (entry) {
      selectedSprite = entry.sprite;
      syncInfo(`Placed ${catalogId} at x:${placement.x} y:${placement.y}`);
    }
    return entry;
  }

  function prepareSpriteForEditing(scene, entry) {
    if (!entry?.sprite) return;
    entry.sprite.removeInteractive();
    if (entry.parentInstanceId) {
      entry.sprite.setInteractive({ useHandCursor: true });
      return;
    }
    entry.sprite.setInteractive({ draggable: true, useHandCursor: true });
  }

  window._editorExport = function() {
    const scene = getScene();
    if (!scene) return;
    const catalog = getCatalog(scene);
    if (!catalog) return;
    const state = initEditorState(scene);

    const updated = state.placements.map((placement) => {
      if (placement._comment) return placement;
      const instanceId = placement.instanceId || placement.id;
      const entry = scene._interactables.find((item) => item.instanceId === instanceId);
      if (!entry || entry.parentInstanceId) return placement;
      return {
        ...placement,
        x: Math.round(entry.sprite.x),
        y: Math.round(entry.sprite.y)
      };
    });

    const output = JSON.stringify({ ...catalog, placements: updated }, null, 2);

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(output).then(() => {
        syncInfo('Copied updated catalog JSON to clipboard');
      });
    }

    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'furniture_catalog_openplan_edited.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  function enableEditor() {
    const scene = getScene();
    if (!scene || !scene._interactables) return;
    editorActive = true;
    initEditorState(scene);
    createEditorUI();
    renderCatalogList();

    scene._editorWasLocked = scene.playerLocked;
    scene.playerLocked = true;

    scene._interactables.forEach((entry) => prepareSpriteForEditing(scene, entry));

    const onDragStart = (pointer, gameObject) => {
      selectedSprite = gameObject;
      gameObject.setTint(0x00ff00);
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      if (entry) {
        syncInfo(`${entry.id} [${entry.instanceId}] x:${Math.round(gameObject.x)} y:${Math.round(gameObject.y)}`);
      }
    };

    const onDrag = (pointer, gameObject, dragX, dragY) => {
      if (window._editorSnap) {
        gameObject.x = snapCoord(dragX);
        gameObject.y = snapCoord(dragY);
      } else {
        gameObject.x = dragX;
        gameObject.y = dragY;
      }
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      if (entry) {
        syncInfo(`${entry.id} [${entry.instanceId}] x:${Math.round(gameObject.x)} y:${Math.round(gameObject.y)}`);
        if (entry.obstacle) {
          entry.obstacle.x = gameObject.x;
          entry.obstacle.y = gameObject.y;
          if (entry.obstacle.body) entry.obstacle.body.updateFromGameObject();
        }

        const state = initEditorState(scene);
        const placement = state.placements.find((item) => (item.instanceId || item.id) === entry.instanceId);
        if (placement) {
          placement.x = Math.round(gameObject.x);
          placement.y = Math.round(gameObject.y);
        }

        initEditorState(scene).placements.forEach((placementItem) => {
          if (placementItem.parentInstanceId === entry.instanceId) {
            const childEntry = scene._interactables.find((item) => item.instanceId === (placementItem.instanceId || placementItem.id));
            if (childEntry && childEntry.sprite) {
              const def = childEntry.def || {};
              const offsetY = placementItem.parent_offset_y !== undefined
                ? placementItem.parent_offset_y
                : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
              childEntry.sprite.x = gameObject.x;
              childEntry.sprite.y = gameObject.y + offsetY;
              if (childEntry.obstacle) {
                childEntry.obstacle.x = childEntry.sprite.x;
                childEntry.obstacle.y = childEntry.sprite.y;
                if (childEntry.obstacle.body) childEntry.obstacle.body.updateFromGameObject();
              }
            }
          }
        });
      }
    };

    const onDragEnd = (pointer, gameObject) => {
      gameObject.clearTint();
    };

    const onPointerDown = (pointer, currentlyOver) => {
      if (!editorActive) return;
      const state = initEditorState(scene);
      if (!state.pendingCatalogId) return;
      if (currentlyOver && currentlyOver.length > 0) return;
      addCatalogPlacement(scene, state.pendingCatalogId, pointer.worldX, pointer.worldY);
    };

    const onGameObjectDown = (pointer, gameObject) => {
      if (!editorActive) return;
      const entry = scene._interactables.find((item) => item.sprite === gameObject);
      if (!entry) return;
      const now = performance.now();
      if (lastPointerTarget === gameObject && now - lastPointerAt <= DOUBLE_CLICK_MS) {
        removeEntry(scene, entry);
        lastPointerTarget = null;
        lastPointerAt = 0;
        return;
      }
      lastPointerTarget = gameObject;
      lastPointerAt = now;
      selectedSprite = gameObject;
      syncInfo(`${entry.id} [${entry.instanceId}] x:${Math.round(gameObject.x)} y:${Math.round(gameObject.y)}`);
    };

    const canvas = scene.game?.canvas;
    const onCanvasDragOver = (event) => {
      if (!editorActive) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onCanvasDrop = (event) => {
      if (!editorActive) return;
      event.preventDefault();
      const catalogId = event.dataTransfer.getData('text/plain');
      if (!catalogId) return;
      const point = getCanvasWorldPoint(scene, event.clientX, event.clientY);
      if (!point) return;
      addCatalogPlacement(scene, catalogId, point.x, point.y);
    };

    scene._editorHandlers = { onDragStart, onDrag, onDragEnd, onPointerDown, onGameObjectDown, onCanvasDragOver, onCanvasDrop };
    scene.input.on('dragstart', onDragStart);
    scene.input.on('drag', onDrag);
    scene.input.on('dragend', onDragEnd);
    scene.input.on('pointerdown', onPointerDown);
    scene.input.on('gameobjectdown', onGameObjectDown);
    if (canvas) {
      canvas.addEventListener('dragover', onCanvasDragOver);
      canvas.addEventListener('drop', onCanvasDrop);
    }
  }

  function disableEditor() {
    const scene = getScene();
    if (!scene) return;
    editorActive = false;
    removeEditorUI();

    scene.playerLocked = scene._editorWasLocked ?? false;
    const handlers = scene._editorHandlers;
    if (handlers) {
      scene.input.off('dragstart', handlers.onDragStart);
      scene.input.off('drag', handlers.onDrag);
      scene.input.off('dragend', handlers.onDragEnd);
      scene.input.off('pointerdown', handlers.onPointerDown);
      scene.input.off('gameobjectdown', handlers.onGameObjectDown);
      if (scene.game?.canvas) {
        scene.game.canvas.removeEventListener('dragover', handlers.onCanvasDragOver);
        scene.game.canvas.removeEventListener('drop', handlers.onCanvasDrop);
      }
      scene._editorHandlers = null;
    }

    if (scene._interactables) {
      scene._interactables.forEach((entry) => {
        if (entry.sprite) {
          entry.sprite.setAlpha(1);
          entry.sprite.removeInteractive();
        }
      });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'e' || e.key === 'E') {
      if (editorActive) disableEditor();
      else enableEditor();
    }
    if (e.key === 'x' || e.key === 'X') {
      if (editorActive) window._editorExport();
    }
  });
})();
