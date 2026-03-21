/**
 * Room Assembly Module
 * Integrates RoomBuilder with Phaser scene to render complete offices
 * Handles sprite loading, validation, and scene composition
 */

export class RoomAssembly {
  constructor(scene, spriteAssemblySystem, roomTemplates) {
    this.scene = scene;
    this.assemblySystem = spriteAssemblySystem;
    this.roomTemplates = roomTemplates;
    this.renderedRooms = new Map();
    this.spriteRegistry = new Map();
  }

  /**
   * Initialize sprite registry from assembly system
   * Maps sprite IDs to their sheet coordinates
   */
  initializeSpriteRegistry() {
    const categories = this.assemblySystem.sprite_categories || {};

    Object.entries(categories).forEach(([categoryName, spriteGroup]) => {
      Object.entries(spriteGroup.sprites || {}).forEach(([spriteId, spriteData]) => {
        this.spriteRegistry.set(spriteId, {
          sheetId: spriteData.sheet || 'modern_office_sprites',
          coords: spriteData.coords,
          size: spriteData.size,
          origin: spriteData.origin || 'bottom',
          zIndex: spriteData.z_index || 2,
          description: spriteData.description
        });
      });
    });

    console.log(`✅ Sprite registry initialized with ${this.spriteRegistry.size} sprites`);
  }

  /**
   * Load a room template by name
   * @param {String} templateName - Name of template (e.g., 'cubicle_pod_4person')
   * @returns {Object} Validated template blueprint
   */
  loadTemplate(templateName) {
    const template = this.roomTemplates.templates[templateName];
    if (!template) {
      console.error(`❌ Template not found: ${templateName}`);
      return null;
    }

    console.log(`📖 Loaded template: ${template.name}`);
    return template;
  }

  /**
   * Validate that all sprites in a template are registered
   * @param {Object} template - Room template
   * @returns {Object} Validation result
   */
  validateSpriteRegistry(template) {
    const missing = [];
    const items = template.items || [];

    items.forEach(item => {
      if (item.type === 'floor' || item.type === 'comment') return;
      if (!this.spriteRegistry.has(item.sprite_id)) {
        missing.push(item.sprite_id);
      }
    });

    return {
      valid: missing.length === 0,
      missing: missing
    };
  }

  /**
   * Validate modular groups are complete
   * @param {Object} template - Room template
   * @returns {Object} Validation result
   */
  validateModularGroups(template) {
    const errors = [];
    const modularsUsed = {};
    const items = template.items || [];

    // Collect all modular groups mentioned
    items.forEach(item => {
      if (item.modular_group) {
        if (!modularsUsed[item.modular_group]) {
          modularsUsed[item.modular_group] = [];
        }
        modularsUsed[item.modular_group].push(item.sprite_id);
      }
    });

    // Check each modular group is complete
    const modularDefs = this.assemblySystem.modular_groups || {};
    Object.entries(modularsUsed).forEach(([groupName, spritesUsed]) => {
      const def = modularDefs[groupName];
      if (!def) return;

      const required = def.pieces || [];
      const found = new Set(spritesUsed);
      const allPresent = required.every(piece => found.has(piece));

      if (!allPresent) {
        const missing = required.filter(piece => !found.has(piece));
        errors.push({
          group: groupName,
          missing: missing,
          breaking_rule: def.breaking_rule
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Full pre-render validation
   * @param {Object} template - Room template
   * @returns {Object} Combined validation
   */
  validateTemplate(template) {
    const registryCheck = this.validateSpriteRegistry(template);
    const modularCheck = this.validateModularGroups(template);

    if (!registryCheck.valid) {
      console.error(`❌ Missing sprites: ${registryCheck.missing.join(', ')}`);
    }

    if (!modularCheck.valid) {
      console.error('❌ Broken modular groups:');
      modularCheck.errors.forEach(err => {
        console.error(`  → ${err.group}: missing ${err.missing.join(', ')}`);
        if (err.breaking_rule) console.error(`     ${err.breaking_rule}`);
      });
    }

    return {
      valid: registryCheck.valid && modularCheck.valid,
      registry: registryCheck,
      modular: modularCheck
    };
  }

  /**
   * Render a room template into the scene
   * @param {String} templateName - Template identifier
   * @param {Object} options - Render options (x, y offset, etc.)
   * @returns {Object} Rendered room with sprite references
   */
  renderRoom(templateName, options = {}) {
    const template = this.loadTemplate(templateName);
    if (!template) return null;

    // Validate before rendering
    const validation = this.validateTemplate(template);
    if (!validation.valid) {
      console.error('⚠️  Template validation failed. Proceeding with caution...');
    }

    // Organize items by z-index
    const layers = {};
    (template.items || []).forEach(item => {
      if (item.type === 'comment' || !item.sprite_id) return;

      const z = item.z_index || 0;
      if (!layers[z]) layers[z] = [];
      layers[z].push(item);
    });

    // Render each layer
    const sprites = [];
    const zLayers = Object.keys(layers).sort((a, b) => Number(a) - Number(b));

    zLayers.forEach(zIndex => {
      console.log(`🎨 Rendering layer Z=${zIndex}...`);

      layers[zIndex].forEach(item => {
        const sprite = this.renderSprite(item, Number(zIndex), options);
        if (sprite) sprites.push(sprite);
      });
    });

    const room = {
      name: template.name,
      template: templateName,
      sprites: sprites,
      dimensions: template.dimensions,
      validation: validation
    };

    this.renderedRooms.set(templateName, room);
    console.log(`✅ Room "${template.name}" rendered with ${sprites.length} sprites`);

    return room;
  }

  /**
   * Render a single sprite item
   * @param {Object} item - Item from template
   * @param {Number} z_index - Layer index
   * @param {Object} options - Render options
   * @returns {Object} Phaser sprite
   */
  renderSprite(item, z_index, options = {}) {
    const spriteData = this.spriteRegistry.get(item.sprite_id);
    if (!spriteData) {
      console.warn(`⚠️  Sprite not registered: ${item.sprite_id}`);
      return null;
    }

    // Calculate render position
    const baseX = (item.x || 0) + (options.offsetX || 0);
    let baseY = (item.y || 0) + (options.offsetY || 0);

    // Apply Y-offset if specified (for items sitting on surfaces)
    if (item.y_offset) {
      baseY += item.y_offset;
    }

    // Create Phaser sprite
    const sprite = this.scene.add.sprite(
      baseX,
      baseY,
      spriteData.sheetId,
      item.sprite_id
    );

    // Configure sprite
    sprite.setDepth(z_index);
    sprite.setOrigin(
      spriteData.origin === 'center' ? 0.5 : (spriteData.origin === 'bottom' ? 0.5 : 0),
      spriteData.origin === 'center' ? 0.5 : (spriteData.origin === 'bottom' ? 1 : 0)
    );

    // Store metadata
    sprite.setData('itemType', item.sprite_id);
    sprite.setData('zIndex', z_index);
    sprite.setData('spriteData', spriteData);

    // Debug info
    if (options.debug) {
      console.log(
        `  ✓ ${item.sprite_id.padEnd(30)} @ (${baseX}, ${baseY}) Z=${z_index}`
      );
    }

    return sprite;
  }

  /**
   * Get statistics on a rendered room
   * @param {String} templateName - Template name
   * @returns {Object} Statistics
   */
  getRoomStats(templateName) {
    const room = this.renderedRooms.get(templateName);
    if (!room) return null;

    const byType = {};
    const byZ = {};

    room.sprites.forEach(sprite => {
      const itemType = sprite.getData('itemType');
      const z = sprite.getData('zIndex');

      byType[itemType] = (byType[itemType] || 0) + 1;
      byZ[z] = (byZ[z] || 0) + 1;
    });

    return {
      templateName: templateName,
      roomName: room.name,
      totalSprites: room.sprites.length,
      dimensions: room.dimensions,
      byType: byType,
      byZIndex: byZ
    };
  }

  /**
   * List all available templates
   * @returns {Array} Template names and info
   */
  listTemplates() {
    return Object.entries(this.roomTemplates.templates).map(([key, template]) => ({
      id: key,
      name: template.name,
      description: template.description,
      dimensions: template.dimensions,
      itemCount: (template.items || []).length
    }));
  }
}

export default RoomAssembly;
