/**
 * RoomAssembly.js
 *
 * Renders room layouts by composing sprites from furniture_catalog_openplan.
 * Uses the same canvas-cut + add.image() pipeline that already works in
 * the main scene, so all coordinates and texture keys are proven correct.
 *
 * Templates are defined in room-templates.json and reference catalog IDs
 * (e.g. "desk_pod", "chair_forward") rather than raw sheet coords.
 */

export class RoomAssembly {
  constructor(scene) {
    this.scene = scene;
    this.catalog = null;        // furniture_catalog_openplan objects map
    this.masterCatalog = null;  // master_furniture_catalog objects map (fallback)
    this.templates = null;      // room-templates.json templates map
    this._canvasBuilt = new Set();
    this._placed = [];          // all sprites created by this instance
    this._instanceMap = {};     // instanceId -> sprite (for parent lookups)
  }

  /**
   * Initialize with catalog and template data already loaded from cache.
   * @param {object} catalogData   – furniture_catalog_openplan.json
   * @param {object} roomTemplates – room-templates.json
   * @param {object} masterData    – master_furniture_catalog.json (optional)
   */
  initialize(catalogData, roomTemplates, masterData = null) {
    if (!catalogData || !roomTemplates) {
      console.error('❌ RoomAssembly: missing catalog or template data');
      return false;
    }
    this.catalog = catalogData.objects || {};
    this.masterCatalog = masterData?.objects || {};
    this.templates = roomTemplates.templates || {};

    const templateCount = Object.keys(this.templates).length;
    const spriteCount = Object.keys(this.catalog).length;
    console.log(`✅ RoomAssembly ready — ${spriteCount} catalog sprites, ${templateCount} templates`);
    return true;
  }

  /** List available template names. */
  listTemplates() {
    const names = Object.keys(this.templates);
    console.log('📋 Available templates:', names.join(', '));
    return names;
  }

  /**
   * Ensure a canvas texture exists for the given catalog entry.
   * Safe to call repeatedly – skips if already built.
   */
  _ensureTexture(catalogId, def) {
    // Single-file sprites were pre-loaded in preload() as single_<id>
    if (def.source_type === 'single_file') {
      const singleKey = `single_${def.single_id}`;
      if (this.scene.textures.exists(singleKey)) return singleKey;
      console.warn(`⚠️ Single texture not loaded: ${singleKey} (id: ${catalogId})`);
      return null;
    }

    // Sheet-based sprite: cut canvas from source image (cached after first cut)
    const texKey = `asm_${catalogId}`;
    if (this._canvasBuilt.has(texKey) || this.scene.textures.exists(texKey)) {
      this._canvasBuilt.add(texKey);
      return texKey;
    }

    const sheetKey = def.sheet;
    if (!sheetKey || !this.scene.textures.exists(sheetKey)) {
      console.warn(`⚠️ Sheet not loaded: ${sheetKey} (id: ${catalogId})`);
      return null;
    }
    const img = this.scene.textures.get(sheetKey).getSourceImage();
    const x = def.x ?? 0;
    const y = def.y ?? 0;
    const w = Math.max(1, def.w || 32);
    const h = Math.max(1, def.h || 32);
    const canvasTex = this.scene.textures.createCanvas(texKey, w, h);
    canvasTex.context.imageSmoothingEnabled = false;
    canvasTex.context.drawImage(img, x, y, w, h, 0, 0, w, h);
    canvasTex.refresh();
    this._canvasBuilt.add(texKey);
    return texKey;
  }

  /** Resolve a catalog definition by ID (local catalog first, then master). */
  _getDef(catalogId) {
    return this.catalog[catalogId] || this.masterCatalog[catalogId] || null;
  }

  /**
   * Place a single item from the template.
   * @param {object} item      – { id, x?, y?, instanceId?, parentInstanceId?, parent_offset_y? }
   * @param {number} offsetX   – room origin X in world space
   * @param {number} offsetY   – room origin Y in world space
   */
  _placeItem(item, offsetX, offsetY) {
    if (!item.id) return null;

    const def = this._getDef(item.id);
    if (!def) {
      console.warn(`⚠️ Catalog entry not found: ${item.id}`);
      return null;
    }

    const texKey = this._ensureTexture(item.id, def);
    if (!texKey) {
      console.warn(`⚠️ Failed to create texture for ${item.id}`);
      return null;
    }

    let worldX, worldY;

    if (item.parentInstanceId) {
      // Decor: stack on parent sprite
      const parent = this._instanceMap[item.parentInstanceId];
      if (!parent) {
        console.warn(`⚠️ Parent instance not found: ${item.parentInstanceId}`);
        return null;
      }
      const yOff = item.parent_offset_y !== undefined
        ? item.parent_offset_y
        : (def.parent_offset_y !== undefined ? def.parent_offset_y : -8);
      worldX = parent.x;
      worldY = parent.y + yOff;
      console.log(`  📦 Stacking '${item.id}' (${item.instanceId}) on parent '${item.parentInstanceId}' at (${worldX}, ${worldY})`);
    } else {
      worldX = (item.x || 0) + offsetX;
      worldY = (item.y || 0) + offsetY;
      console.log(`  📍 Placing '${item.id}' (${item.instanceId}) at (${worldX}, ${worldY})`);
    }

    const originY = def.origin === 'center' ? 0.5 : 1;
    const depth = item.z_index !== undefined ? item.z_index : (typeof def.depth === 'number' ? def.depth : 1.5);
    const sprite = this.scene.add.image(worldX, worldY, texKey)
      .setOrigin(0.5, originY)
      .setDepth(depth);

    // Scale sprite if display dimensions are specified
    if (def.display_w || def.display_h) {
      const dw = def.display_w || (def.w * 1.25) || 32;
      const dh = def.display_h || (def.h * 1.25) || 48;
      sprite.setDisplaySize(dw, dh);
    }

    const instanceId = item.instanceId || `${item.id}_${this._placed.length}`;
    this._instanceMap[instanceId] = sprite;
    this._placed.push(sprite);
    return sprite;
  }

  /**
   * Render a named template, positioned so room origin is at (originX, originY).
   * Base items are placed first, then decor items (parentInstanceId) on top.
   */
  renderRoom(templateName, originX = 100, originY = 100) {
    const template = this.templates[templateName];
    if (!template) {
      const available = Object.keys(this.templates).join(', ');
      console.error(`❌ Template '${templateName}' not found. Available: ${available}`);
      return [];
    }

    const items = Array.isArray(template.items) ? template.items : [];
    console.log(`📐 Rendering '${templateName}' — ${items.length} items at (${originX}, ${originY})`);

    // Pass 1: base items (no parentInstanceId)
    items
      .filter(item => item.id && !item.parentInstanceId)
      .forEach(item => this._placeItem(item, originX, originY));

    // Pass 2: decor items stacked on parents
    items
      .filter(item => item.id && !!item.parentInstanceId)
      .forEach(item => this._placeItem(item, originX, originY));

    console.log(`✅ Placed ${this._placed.length} sprites for '${templateName}'`);
    return this._placed;
  }

  /** Destroy all sprites created by this assembly instance. */
  clear() {
    this._placed.forEach(s => s.destroy());
    this._placed = [];
    this._instanceMap = {};
    this._canvasBuilt.clear();
  }
}

export default RoomAssembly;
