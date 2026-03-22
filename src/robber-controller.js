/**
 * Robber Controller
 *
 * Spawns and controls robber NPC(s) in the pixel office game to visualize
 * security threats. Each active threat gets its own robber that performs
 * contextual actions based on the threat type.
 *
 * Threat → Behavior mapping:
 *   file_access    → Robber searches through bookshelves
 *   data_breach    → Robber hacks at a computer/monitor
 *   network_scan   → Robber sneaks along walls, checking doors
 *   brute_force    → Robber tries doors repeatedly (shaking animation)
 *   shell_exec     → Robber sits at a desk typing furiously
 *   api_abuse      → Robber at computer, speech bubble shows endpoint
 *   process_spawn  → Robber spawns from outside, sneaks in through door
 *   exfiltration   → Robber carries bag, walks toward exit
 */

// Target furniture/positions for each threat type
const THREAT_TARGETS = {
  file_access: {
    furnitureMatch: /bookshelf|shelf|cabinet|filing/i,
    fallback: { x: 960, y: 160 },  // near bookshelves in manager office
    action: 'searching',
    bubble: '📁 Searching files...',
    bubbleFromDetail: true,
  },
  data_breach: {
    furnitureMatch: /monitor|computer|pc|screen|laptop/i,
    fallback: { x: 388, y: 156 },  // desk with monitor
    action: 'hacking',
    bubble: '🔓 Accessing data...',
    bubbleFromDetail: true,
  },
  network_scan: {
    furnitureMatch: null, // walks along walls
    fallback: { x: 844, y: 300 },  // near wall/door
    action: 'sneaking',
    bubble: '📡 Scanning ports...',
    bubbleFromDetail: true,
    patrol: true,  // moves between multiple points
    patrolPoints: [
      { x: 100, y: 440 },
      { x: 400, y: 440 },
      { x: 844, y: 300 },
      { x: 844, y: 500 },
    ],
  },
  brute_force: {
    furnitureMatch: /door/i,
    fallback: { x: 340, y: 444 },  // near a doorway
    action: 'breaking',
    bubble: '🔑 Brute forcing...',
    bubbleFromDetail: true,
  },
  shell_exec: {
    furnitureMatch: /desk|monitor|computer/i,
    fallback: { x: 648, y: 156 },  // a desk
    action: 'hacking',
    bubble: '💻 Executing commands...',
    bubbleFromDetail: true,
  },
  api_abuse: {
    furnitureMatch: /monitor|computer|desk/i,
    fallback: { x: 456, y: 156 },  // a desk
    action: 'hacking',
    bubble: '🌐 API injection...',
    bubbleFromDetail: true,
  },
  process_spawn: {
    furnitureMatch: null,
    fallback: { x: 50, y: 400 },   // entrance/edge
    action: 'sneaking',
    bubble: '⚙️ Spawning process...',
    bubbleFromDetail: true,
    entryAnimation: true,
  },
  exfiltration: {
    furnitureMatch: null,
    fallback: { x: 1200, y: 600 }, // toward exit
    action: 'fleeing',
    bubble: '📦 Exfiltrating data...',
    bubbleFromDetail: true,
    exitPath: [
      { x: 400, y: 300 },  // start at desk area
      { x: 400, y: 444 },  // move to corridor
      { x: 844, y: 444 },  // move to door
      { x: 1200, y: 600 }, // exit building
    ],
  },
};

class RobberController {
  /**
   * @param {Phaser.Scene} scene - The OfficeScene
   * @param {SecurityMonitor} monitor - The security monitor instance
   */
  constructor(scene, monitor) {
    this.scene = scene;
    this.monitor = monitor;

    // Active robbers: threatId → { sprite, bubble, threat, state, ... }
    this.robbers = new Map();

    // Pool of despawned robber sprites for reuse
    this._pool = [];

    // Max simultaneous robbers
    this.maxRobbers = 5;

    // Alert overlay
    this._alertOverlay = null;
    this._alertText = null;

    this._bindEvents();
  }

  /** Initialize the controller */
  init() {
    console.log('[RobberCtrl] Initialized — watching for security threats');
    this._createAlertUI();
  }

  /** Spawn a robber for a threat */
  spawnRobber(threat) {
    if (this.robbers.size >= this.maxRobbers) {
      console.warn('[RobberCtrl] Max robbers reached, skipping threat:', threat.id);
      return;
    }

    if (this.robbers.has(threat.id)) {
      // Update existing robber's target
      this._updateRobber(threat);
      return;
    }

    const config = THREAT_TARGETS[threat.category] || THREAT_TARGETS.network_scan;

    // Find target position — try to match furniture first
    let targetPos = config.fallback;
    if (config.furnitureMatch && this.scene._interactables) {
      const match = this.scene._interactables.find(i =>
        i.def?.name && config.furnitureMatch.test(i.def.name)
      );
      if (match) {
        targetPos = { x: match.sprite.x, y: match.sprite.y };
      }
    }

    // Spawn position: pick a valid interior position near edges of the office
    // These are safe interior points that avoid walls
    const spawnPoints = [
      { x: 150, y: 440 },  // corridor left
      { x: 500, y: 440 },  // corridor center
      { x: 830, y: 440 },  // corridor right
      { x: 150, y: 600 },  // break room
      { x: 1050, y: 400 }, // supply room
    ];
    const spawnPos = config.entryAnimation
      ? spawnPoints[0]
      : spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    // Create or reuse sprite
    let sprite;
    if (this._pool.length > 0) {
      sprite = this._pool.pop();
      sprite.setActive(true).setVisible(true);
      sprite.setPosition(spawnPos.x, spawnPos.y);
    } else {
      sprite = this.scene.physics.add.sprite(spawnPos.x, spawnPos.y, 'robber', 20);
      sprite.setOrigin(0.5, 1);
      sprite.setScale(2); // 16x32 source → 32x64 display to match Dolo
      sprite.setCollideWorldBounds(true);
      sprite.setDepth(50); // above most furniture, below UI
      // Robbers don't collide with walls — they sneak through everything
      sprite.body.setAllowGravity(false);
    }

    // Create robber record
    const robber = {
      sprite,
      threat,
      config,
      state: 'entering',    // entering | moving | acting | fleeing | exiting
      targetPos,
      bubble: null,
      patrolIndex: 0,
      patrolTimer: 0,
      exitPathIndex: 0,
      shakeTimer: 0,
      actionTimer: 0,
    };

    this.robbers.set(threat.id, robber);

    // Show speech bubble
    const bubbleText = config.bubbleFromDetail && threat.detail
      ? threat.detail.slice(0, 35)
      : config.bubble;
    this._showBubble(robber, bubbleText);

    // Show alert
    this._showAlert(threat);

    // No wall collisions — robbers sneak through everything

    console.log(`[RobberCtrl] 🦹 Robber spawned for threat: ${threat.category} — ${threat.detail}`);
  }

  /** Despawn a robber when threat is resolved */
  despawnRobber(threatId) {
    const robber = this.robbers.get(threatId);
    if (!robber) return;

    // Start exit animation
    robber.state = 'exiting';
    robber.targetPos = { x: -50, y: robber.sprite.y }; // walk off screen left

    // After exit, pool the sprite
    this.scene.time.delayedCall(3000, () => {
      if (robber.bubble) {
        robber.bubble.destroy();
        robber.bubble = null;
      }
      robber.sprite.setActive(false).setVisible(false);
      robber.sprite.body.setVelocity(0, 0);
      this._pool.push(robber.sprite);
      this.robbers.delete(threatId);
    });
  }

  /** Update loop — called from scene.update() */
  update(time, delta) {
    this.robbers.forEach((robber, threatId) => {
      this._updateRobberBehavior(robber, time, delta);
    });
  }

  // --- Robber behavior state machine ---

  _updateRobberBehavior(robber, time, delta) {
    const sprite = robber.sprite;
    const config = robber.config;
    const speed = 80;
    // Use dt in seconds for position-based movement (bypass physics colliders)
    const dt = (delta || 16) / 1000;

    switch (robber.state) {
      case 'entering':
      case 'moving': {
        // Move toward target using direct position updates (ignores walls)
        const dx = robber.targetPos.x - sprite.x;
        const dy = robber.targetPos.y - sprite.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 8) {
          const moveX = (dx / dist) * speed * dt;
          const moveY = (dy / dist) * speed * dt;
          sprite.x += moveX;
          sprite.y += moveY;
          this._playWalkAnim(sprite, dx, dy);
        } else {
          robber.state = 'acting';
          robber.actionTimer = 0;
          // Face the furniture
          sprite.anims.play('robber:idle_down', true);
        }
        break;
      }

      case 'acting': {
        robber.actionTimer += delta;

        // Shake effect for brute_force
        if (config.action === 'breaking') {
          robber.shakeTimer += delta;
          if (robber.shakeTimer > 150) {
            robber.shakeTimer = 0;
            sprite.x += (Math.random() > 0.5 ? 2 : -2);
          }
        }

        // Patrol behavior — move between points
        if (config.patrol && robber.actionTimer > 3000) {
          robber.actionTimer = 0;
          robber.patrolIndex = (robber.patrolIndex + 1) % config.patrolPoints.length;
          robber.targetPos = config.patrolPoints[robber.patrolIndex];
          robber.state = 'moving';
        }

        // Exit path behavior (exfiltration)
        if (config.exitPath && robber.actionTimer > 2000) {
          robber.actionTimer = 0;
          robber.exitPathIndex++;
          if (robber.exitPathIndex < config.exitPath.length) {
            robber.targetPos = config.exitPath[robber.exitPathIndex];
            robber.state = 'moving';
          } else {
            // Reached exit — despawn
            this.despawnRobber(robber.threat.id);
          }
        }

        // Idle animation for searching/hacking
        if (config.action === 'searching') {
          // Alternate facing left/right like rummaging through shelves
          if (robber.actionTimer % 2000 < 1000) {
            sprite.anims.play('robber:idle_left', true);
          } else {
            sprite.anims.play('robber:idle_right', true);
          }
        } else if (config.action === 'hacking') {
          sprite.anims.play('robber:idle_down', true);
        }
        break;
      }

      case 'exiting': {
        const dx = robber.targetPos.x - sprite.x;
        const dy = robber.targetPos.y - sprite.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 4) {
          sprite.x += (dx / dist) * speed * 1.5 * dt;
          sprite.y += (dy / dist) * speed * 0.5 * dt;
          this._playWalkAnim(sprite, dx, dy);
        }
        break;
      }
    }

    // Update bubble position
    if (robber.bubble) {
      robber.bubble.x = sprite.x;
      robber.bubble.y = sprite.y - 44;
    }
  }

  _playWalkAnim(sprite, vx, vy) {
    if (Math.abs(vx) > Math.abs(vy)) {
      sprite.anims.play(vx < 0 ? 'robber:walk_left' : 'robber:walk_right', true);
    } else {
      sprite.anims.play(vy < 0 ? 'robber:walk_up' : 'robber:walk_down', true);
    }
  }

  // --- Speech bubbles ---

  _showBubble(robber, text) {
    if (robber.bubble) {
      robber.bubble.destroy();
    }

    const sprite = robber.sprite;
    const severity = robber.threat.severity;

    // Color based on severity
    const colors = {
      low: '#854d0e',      // dark yellow
      medium: '#9a3412',   // dark orange
      high: '#991b1b',     // dark red
      critical: '#7f1d1d', // deep red
    };
    const bgColor = colors[severity] || colors.medium;

    robber.bubble = this.scene.add.text(sprite.x, sprite.y - 44, `⚠ ${text}`, {
      fontSize: '7px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: bgColor,
      padding: { x: 4, y: 2 },
      align: 'center',
      wordWrap: { width: 140 },
    });
    robber.bubble.setOrigin(0.5, 1);
    robber.bubble.setDepth(10000);
  }

  _updateRobber(threat) {
    const robber = this.robbers.get(threat.id);
    if (!robber) return;

    robber.threat = threat;
    const config = THREAT_TARGETS[threat.category] || THREAT_TARGETS.network_scan;
    robber.config = config;

    const bubbleText = config.bubbleFromDetail && threat.detail
      ? threat.detail.slice(0, 35)
      : config.bubble;
    this._showBubble(robber, bubbleText);
  }

  // --- Alert UI ---

  _createAlertUI() {
    // Fixed-position alert banner at top of screen
    this._alertOverlay = this.scene.add.rectangle(
      this.scene.cameras.main.centerX,
      30,
      400, 28,
      0x7f1d1d, 0
    );
    this._alertOverlay.setScrollFactor(0);
    this._alertOverlay.setDepth(9998);

    this._alertText = this.scene.add.text(
      this.scene.cameras.main.centerX,
      30,
      '', {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: '#fecaca',
        backgroundColor: '#7f1d1dcc',
        padding: { x: 8, y: 4 },
        align: 'center',
      }
    );
    this._alertText.setOrigin(0.5, 0.5);
    this._alertText.setScrollFactor(0);
    this._alertText.setDepth(9999);
    this._alertText.setVisible(false);
  }

  _showAlert(threat) {
    if (!this._alertText) return;

    const severityLabel = {
      low: '⚡ LOW',
      medium: '⚠️ MEDIUM',
      high: '🔴 HIGH',
      critical: '🚨 CRITICAL',
    };

    const label = severityLabel[threat.severity] || '⚠️ ALERT';
    this._alertText.setText(`${label}: ${threat.category.replace(/_/g, ' ').toUpperCase()} — ${threat.detail.slice(0, 50)}`);
    this._alertText.setVisible(true);

    // Flash effect
    this.scene.tweens.add({
      targets: this._alertText,
      alpha: { from: 0, to: 1 },
      duration: 200,
      yoyo: true,
      repeat: 2,
    });

    // Auto-hide after 6 seconds
    this.scene.time.delayedCall(6000, () => {
      if (this._alertText && this.robbers.size === 0) {
        this._alertText.setVisible(false);
      }
    });
  }

  // --- Event binding ---

  _bindEvents() {
    this.monitor.addEventListener('threat', (evt) => {
      this.spawnRobber(evt.detail);
    });

    this.monitor.addEventListener('threat-cleared', (evt) => {
      this.despawnRobber(evt.detail.threatId);
    });
  }
}

// Global
window.RobberController = RobberController;
