/**
 * Room Builder System for Pixel Office Game
 * 
 * Converts sprite assembly blueprints into Phaser scene renders
 * with proper layering, modular validation, and Y-offset handling.
 */

class RoomBuilder {
  constructor(scene) {
    this.scene = scene;
    this.spriteGroups = new Map();
    this.loadAssemblySystem();
  }

  /**
   * Load the sprite assembly system data
   */
  loadAssemblySystem() {
    // This will be loaded from sprite-assembly-system.json
    this.assemblySystem = window.SPRITE_ASSEMBLY_SYSTEM || {};
  }

  /**
   * Validate that modular groups are complete before rendering
   * @param {Array} items - Array of sprite items to render
   * @returns {Object} { valid: boolean, errors: Array }
   */
  validateModularGroups(items) {
    const errors = [];
    const modularsInScene = {};

    // First pass: collect all modular groups mentioned
    items.forEach(item => {
      if (item.modular_group) {
        if (!modularsInScene[item.modular_group]) {
          modularsInScene[item.modular_group] = [];
        }
        modularsInScene[item.modular_group].push(item.type);
      }
    });

    // Second pass: validate each modular group is complete
    const modularDefs = this.assemblySystem.modular_groups || {};
    
    Object.entries(modularsInScene).forEach(([groupName, typesFound]) => {
      const groupDef = modularDefs[groupName];
      if (!groupDef) return;

      const requiredPieces = groupDef.pieces || [];
      const missingPieces = requiredPieces.filter(
        piece => !typesFound.includes(piece)
      );

      if (missingPieces.length > 0) {
        errors.push({
          group: groupName,
          missing: missingPieces,
          found: typesFound,
          severity: 'ERROR',
          message: `Incomplete modular group "${groupName}". Missing pieces: ${missingPieces.join(', ')}`
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Build a room from a blueprint
   * @param {Object} blueprint - Room blueprint with layers and sprites
   * @returns {Map} Collection of Phaser groups organized by z-index
   */
  buildRoom(blueprint) {
    const validation = this.validateModularGroups(blueprint.items || []);
    
    if (!validation.valid) {
      console.error('❌ BLUEPRINT VALIDATION FAILED:', validation.errors);
      validation.errors.forEach(err => {
        console.error(`  → ${err.message}`);
      });
      return null;
    }

    console.log('✅ Blueprint validation passed');

    // Sort items by z_index
    const itemsByLayer = {};
    blueprint.items.forEach(item => {
      const z = item.z_index || 0;
      if (!itemsByLayer[z]) itemsByLayer[z] = [];
      itemsByLayer[z].push(item);
    });

    // Render each layer in order
    const layers = Object.keys(itemsByLayer).sort((a, b) => a - b);
    
    layers.forEach(z_index => {
      console.log(`🎨 Rendering Layer ${z_index}...`);
      itemsByLayer[z_index].forEach(item => {
        this.renderSprite(item, parseInt(z_index));
      });
    });

    return this.spriteGroups;
  }

  /**
   * Render a single sprite with all transformations
   * @param {Object} item - Sprite item from blueprint
   * @param {Number} z_index - Layer index
   */
  renderSprite(item, z_index) {
    if (!item.type || !item.sprite_id) {
      console.warn(`❌ Missing type or sprite_id for item:`, item);
      return;
    }

    // Get sprite sheet coordinates
    const spriteData = this.getSpriteData(item.sprite_id);
    if (!spriteData) {
      console.warn(`⚠️  Sprite not found: ${item.sprite_id}`);
      return;
    }

    // Calculate position with Y-offset if applicable
    let renderY = item.y || 0;
    if (item.y_offset) {
      renderY += item.y_offset;
    }

    // Create Phaser sprite
    const sprite = this.scene.add.sprite(
      item.x || 0,
      renderY,
      spriteData.sheet_key,
      spriteData.frame
    );

    // Set depth/z-index
    sprite.setDepth(z_index);

    // Apply scale if needed
    if (item.scale) {
      sprite.setScale(item.scale);
    }

    // Set origin (default: bottom for furniture)
    const origin = item.origin || 'bottom';
    this.setOrigin(sprite, origin);

    // Store in layer group
    if (!this.spriteGroups.has(z_index)) {
      this.spriteGroups.set(z_index, []);
    }
    this.spriteGroups.get(z_index).push(sprite);

    // Add metadata for debugging
    sprite.setData('itemType', item.sprite_id);
    sprite.setData('zIndex', z_index);

    console.log(`  ✓ ${item.sprite_id} @ (${item.x}, ${renderY}) Z=${z_index}`);
  }

  /**
   * Set sprite origin based on string descriptor
   * @param {Object} sprite - Phaser sprite
   * @param {String} originType - 'bottom', 'center', 'top', 'top-left', etc.
   */
  setOrigin(sprite, originType) {
    const originMap = {
      'bottom': { x: 0.5, y: 1 },
      'center': { x: 0.5, y: 0.5 },
      'top': { x: 0.5, y: 0 },
      'top-left': { x: 0, y: 0 },
      'top-right': { x: 1, y: 0 },
      'bottom-left': { x: 0, y: 1 },
      'bottom-right': { x: 1, y: 1 }
    };

    const origin = originMap[originType] || originMap['bottom'];
    sprite.setOrigin(origin.x, origin.y);
  }

  /**
   * Get sprite data from assembly system
   * (In practice, this would query sprite-assembly-system.json)
   * @param {String} spriteId - Sprite identifier
   * @returns {Object} Sheet key and frame info
   */
  getSpriteData(spriteId) {
    // TODO: Implement lookup in sprite-assembly-system.json
    // For now, return placeholder
    return {
      sheet_key: 'modern_office_sprites',
      frame: spriteId
    };
  }

  /**
   * Create context for a specific room zone
   * (e.g., "vending", "boss_office", "breakroom")
   */
  createZoneContext(zoneName) {
    return {
      name: zoneName,
      items: [],
      bounds: { x: 0, y: 0, w: 512, h: 512 },
      lighting: 'default'
    };
  }
}

export default RoomBuilder;
