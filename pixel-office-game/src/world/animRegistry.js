// Animation registry: centralizes creation of Phaser animations from JSON.
// For now this focuses on logical names; sheet filenames can be wired later.

const charAnims = {
  animations: {
    idle_down: {
      frames: [0],
      fps: 0,
      loop: true
    },
    idle_up: {
      frames: [12],
      fps: 0,
      loop: true
    },
    idle_left: {
      frames: [4],
      fps: 0,
      loop: true
    },
    idle_right: {
      frames: [8],
      fps: 0,
      loop: true
    },
    walk_down: {
      frames: [0, 1, 2, 3],
      fps: 10,
      loop: true
    },
    walk_up: {
      frames: [12, 13, 14, 15],
      fps: 10,
      loop: true
    },
    walk_left: {
      frames: [4, 5, 6, 7],
      fps: 10,
      loop: true
    },
    walk_right: {
      frames: [8, 9, 10, 11],
      fps: 10,
      loop: true
    }
  }
};

/**
 * Create Phaser animations for a given spritesheet key using the logical
 * animation names from animations_character_animations.json.
 *
 * This is a light wrapper around `scene.anims.create` that assumes the
 * underlying sheet follows the 4x4 XP layout already used for `player_xp`.
 */
export function registerCharacterAnimations(scene, textureKey) {
  const defs = charAnims.animations || {};

  const ensure = (name, config) => {
    const key = `${textureKey}:${name}`;
    if (scene.anims.exists(key)) return key;
    if (Array.isArray(config.frames) && config.frames.length > 0) {
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(textureKey, {
          frames: config.frames
        }),
        frameRate: config.fps || 8,
        repeat: config.loop === false ? 0 : -1
      });
    }
    return key;
  };

  const created = {};
  Object.entries(defs).forEach(([name, def]) => {
    created[name] = ensure(name, def);
  });
  return created;
}

/**
 * Returns the Phaser animation key for a given texture and animation name.
 * e.g. getAnimKey('xp_abby', 'walk_down') => 'xp_abby:walk_down'
 */
export function getAnimKey(textureKey, animName) {
  return `${textureKey}:${animName}`;
}
