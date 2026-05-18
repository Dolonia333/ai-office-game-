/**
 * RoomBuilder.js
 * 
 * Low-level sprite rendering foundation for room assembly.
 * Handles sprite creation, transformation, z-index sorting, and layering.
 * 
 * Key responsibilities:
 * - Validate modular groups (sofas have matching ends, bookshelves stacked correctly)
 * - Sort items by z_index for proper rendering order
 * - Create Phaser sprites with correct origin, offset, and depth
 * - Apply transformations and visual effects
 */

export class RoomBuilder {
  constructor(scene) {
    this.scene = scene;
    this.spriteRegistry = {};
    this.renderedSprites = [];
  }

  /**
   * Validate modular groups to ensure completeness
   * e.g., sofas require matching left/center/right pieces
   * e.g., bookshelves require proper stacking
   */
  validateModularGroups(template, registry) {
    if (!template.modular_groups_used || template.modular_groups_used.length === 0) {
      return { valid: true, errors: [] };
    }

    const errors = [];

    // For each modular group used in this template
    template.modular_groups_used.forEach(groupName => {
      // Find all items in this template that belong to this group
      const groupItems = template.items.filter(item => item.modular_group === groupName);

      if (groupItems.length === 0) {
        errors.push(`Modular group '${groupName}' declared but no items found`);
        return;
      }

      // Check if this group requires specific pieces
      // Example: sofa_tan_3piece requires 'sofa_tan_left', 'sofa_tan_center', 'sofa_tan_right'
      const expectedPattern = this._getModularGroupPattern(groupName);
      if (expectedPattern) {
        const actual = new Set(groupItems.map(item => item.sprite_id));
        const expected = new Set(expectedPattern);

        for (const sprite of expected) {
          if (!actual.has(sprite)) {
            errors.push(`Modular group '${groupName}' missing piece: ${sprite}`);
          }
        }

        // No extra pieces allowed in modular groups
        for (const sprite of actual) {
          if (!expected.has(sprite)) {
            errors.push(`Modular group '${groupName}' has unexpected piece: ${sprite}`);
          }
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get expected pieces for a modular group by name
   * Extensible pattern - can be loaded from sprite-assembly-system.json
   */
  _getModularGroupPattern(groupName) {
    const patterns = {
      'sofa_tan_3piece': ['sofa_tan_left', 'sofa_tan_center', 'sofa_tan_right'],
      'sofa_grey_3piece': ['sofa_grey_left', 'sofa_grey_center', 'sofa_grey_right'],
      'bookshelf_tall_stack': ['bookshelf_tall_bottom', 'bookshelf_tall_top'],
      'cubicle_pod_set': ['cubicle_divider', 'desk_pod_center', 'monitor_pod', 'chair_task_pod'],
      'pod_4person': [
        'cubicle_divider_front',
        'cubicle_divider_right',
        'desk_front',
        'desk_right',
        'monitor_front',
        'monitor_right',
        'chair_task_front',
        'chair_task_right'
      ]
    };
    return patterns[groupName] || null;
  }

  /**
   * Build room by sorting items by z_index and rendering layer-by-layer
   */
  buildRoom(template, registry) {
    if (!template || !template.items) {
      console.error('❌ Invalid template: missing items array');
      return [];
    }

    // Sort items by z_index (ascending = back to front)
    const sortedItems = [...template.items].sort((a, b) => {
      const aZ = a.z_index || 0;
      const bZ = b.z_index || 0;
      return aZ - bZ;
    });

    const rendered = [];

    // Render layer by layer
    const uniqueZIndices = [...new Set(sortedItems.map(item => item.z_index || 0))].sort((a, b) => a - b);

    for (const zIndex of uniqueZIndices) {
      const layer = sortedItems.filter(item => (item.z_index || 0) === zIndex);
      for (const item of layer) {
        const sprite = this.renderSprite(item, zIndex, registry);
        if (sprite) {
          rendered.push(sprite);
          this.renderedSprites.push(sprite);
        }
      }
    }

    return rendered;
  }

  /**
   * Render a single sprite in the Phaser scene
   * Applies origin, offset, depth, and visual properties
   */
  renderSprite(item, zIndex, registry) {
    if (!item.sprite_id) {
      console.warn('⚠️ Item missing sprite_id:', item);
      return null;
    }

    const spriteInfo = registry[item.sprite_id];
    if (!spriteInfo) {
      console.error(`❌ Sprite not found in registry: ${item.sprite_id}`);
      return null;
    }

    const { coords, size, sheet, origin = 'top-left' } = spriteInfo;
    if (!coords || !size) {
      console.error(`❌ Sprite ${item.sprite_id} missing coords or size`);
      return null;
    }

    // Create Phaser sprite using spritesheet
    const sprite = this.scene.add.sprite(
      item.x,
      item.y,
      sheet, // texture key
      coords.x + coords.y * size.width // frame index calculation
    );

    if (!sprite) {
      console.error(`❌ Failed to create Phaser sprite: ${item.sprite_id}`);
      return null;
    }

    // Set origin (default top-left)
    const originPoint = this.setOrigin(sprite, origin);
    sprite.setOrigin(originPoint.x, originPoint.y);

    // Apply y-offset if specified (e.g., desktop items sitting on desks)
    let finalY = item.y;
    if (item.y_offset) {
      finalY = item.y + item.y_offset;
    }

    // Update position with offset applied
    sprite.setPosition(item.x, finalY);

    // Set depth for proper z-index rendering
    sprite.setDepth(zIndex);

    // Store metadata for debugging/inspection
    sprite.spriteId = item.sprite_id;
    sprite.zIndex = zIndex;
    sprite.originType = origin;
    sprite.modulerGroup = item.modular_group;

    // Optional: add outline/debug visualization
    if (this.debugMode) {
      sprite.setAlpha(0.95);
      sprite.setTint(0xffffff); // Slight tint to show bounds
    }

    return sprite;
  }

  /**
   * Map origin descriptors to Phaser origin values (0-1 scale)
   */
  setOrigin(sprite, originType) {
    const origins = {
      'top-left': { x: 0, y: 0 },
      'top-center': { x: 0.5, y: 0 },
      'top-right': { x: 1, y: 0 },
      'center': { x: 0.5, y: 0.5 },
      'center-left': { x: 0, y: 0.5 },
      'center-right': { x: 1, y: 0.5 },
      'bottom-left': { x: 0, y: 1 },
      'bottom-center': { x: 0.5, y: 1 },
      'bottom-right': { x: 1, y: 1 }
    };

    return origins[originType] || origins['top-left'];
  }

  /**
   * Clear all rendered sprites from the scene
   */
  clearRoom() {
    this.renderedSprites.forEach(sprite => {
      sprite.destroy();
    });
    this.renderedSprites = [];
  }

  /**
   * Get statistics about rendered room
   */
  getRoomStats() {
    const stats = {
      totalSprites: this.renderedSprites.length,
      byZIndex: {},
      byType: {}
    };

    this.renderedSprites.forEach(sprite => {
      // Count by z-index
      const zIdx = sprite.zIndex;
      stats.byZIndex[zIdx] = (stats.byZIndex[zIdx] || 0) + 1;

      // Count by sprite type
      const type = sprite.spriteId;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    });

    return stats;
  }

  /**
   * Enable debug visualization mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    if (enabled) {
      console.log('✅ Debug mode enabled');
    }
  }
}

export default RoomBuilder;
