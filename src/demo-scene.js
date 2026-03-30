/**
 * DemoScene — Scripted 20-second investor demo cutscene
 *
 * Trigger: ?demo=investor URL param
 *
 * Timeline:
 *   0s  — Scene setup: Alex at desk working, Bob in breakroom, Abby at conference, CEO bottom-left
 *   2s  — CEO bubble: "Research our three biggest competitors and report back to the team."
 *   5s  — Abby bubble: "Understood. Bob — take this one."
 *   7s  — Bob walks from breakroom to a desk
 *  10s  — Bob sits, bubble: "Searching competitors..."
 *  13s  — Bubble: "Found Datadog. Found LangSmith. Found Helicone."
 *  17s  — Bubble: "Done. Log-first tools only. Nobody does live. Gap confirmed." (persists)
 *  18s  — Report icon appears near Bob
 *  20s  — Hold. Full office visible.
 */

class DemoScene {
  constructor(scene, agentManager) {
    this.scene = scene;
    this.manager = agentManager;
    this.actions = agentManager?.actions;
  }

  start() {
    const scene = this.scene;
    const actions = this.actions;
    if (!actions || !scene.npcs) return;

    console.log('[DemoScene] Starting investor demo...');

    // --- Step 0: Freeze ALL NPCs ---
    // Mark demo mode so the agent manager won't reassign tasks
    this.manager._demoMode = true;
    scene.npcs.forEach(npc => {
      if (!npc.ai) return;
      npc.body.setVelocity(0, 0);
      if (npc._pathFollower) npc._pathFollower.stop();
      npc.ai.mode = 'agent_task';
      npc.ai.taskState = 'reporting'; // frozen in place
      npc.anims.stop();
    });

    // Lock player movement
    scene.playerLocked = true;

    // --- Camera: stop following player, show the full office ---
    const cam = scene.cameras.main;
    cam.stopFollow();
    // Center camera to show the whole office (1280x720 world)
    cam.setScroll(0, 0);
    cam.setZoom(1);

    // --- Hide debug/UI overlays for clean presentation ---
    // Hide debug header text
    document.querySelectorAll('#game-container canvas').forEach(c => c.style.cursor = 'default');
    // Hide any HTML overlays
    const hideSelectors = ['#openclaw-status', '#rate-limit-warning', '.debug-overlay', '#runtime-error'];
    hideSelectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    });
    // Hide in-game debug texts and prompts
    if (scene._sitPrompt) scene._sitPrompt.setVisible(false);
    if (scene._talkPrompt) scene._talkPrompt.setVisible(false);
    if (scene._debugText) scene._debugText.setVisible(false);
    if (scene._headerText) scene._headerText.setVisible(false);
    if (scene._timeText) scene._timeText.setVisible(false);
    // Hide any Phaser text objects that look like debug info
    scene.children.list.forEach(child => {
      if (child.type === 'Text' && child.text) {
        const t = child.text;
        if (/^MODE |^Time:|^OpenClaw|Rate limit|^\[F\]|^\[Enter\]/i.test(t)) {
          child.setVisible(false);
          child._demoHidden = true;
        }
      }
    });

    // --- Find our actors ---
    const abby = this._findNpc('xp_abby');
    const alex = this._findNpc('xp_alex');
    const bob = this._findNpc('xp_bob');
    const player = scene.player;

    if (!abby || !alex || !bob || !player) {
      console.warn('[DemoScene] Missing actors, aborting demo');
      return;
    }

    // --- Position actors at starting marks ---

    // CEO: bottom-left of open office, visible on screen
    player.x = 130;
    player.y = 370;
    player.setFrame(8); // facing right
    player.anims.stop();

    // Abby: conference table area — positioned where her bubble is visible
    abby.x = 960;
    abby.y = 340;
    abby.ai.facing = 'left';
    abby.setFrame(4); // facing left
    abby.body.setVelocity(0, 0);

    // Bob: breakroom couch area (bottom-left)
    bob.x = 150;
    bob.y = 540;
    bob.ai.facing = 'down';
    bob.setFrame(0); // facing down
    bob.body.setVelocity(0, 0);

    // Alex: manually sit at a desk position (don't use useComputer which requires walking)
    // Find Alex's assigned desk chair position
    const alexAgent = this.manager.agents?.get('xp_alex');
    const alexDeskId = alexAgent?.assignedDesk;
    let alexChairPos = null;

    if (alexDeskId) {
      const desk = scene._interactables?.find(it => (it.instanceId || it.id) === alexDeskId);
      if (desk?.sprite) {
        // Find chair near this desk
        const chair = actions._findChairNearDesk(desk, 80);
        if (chair?.sprite) {
          alexChairPos = { x: chair.sprite.x, y: chair.sprite.y };
        }
      }
    }

    if (alexChairPos) {
      alex.x = alexChairPos.x;
      alex.y = alexChairPos.y;
    } else {
      alex.x = 196;
      alex.y = 156;
    }
    alex.ai.facing = 'up';
    alex.setFrame(12); // facing up (toward desk)
    alex.ai.taskState = 'sitting';
    alex.body.setVelocity(0, 0);

    // Alex's persistent bubble — he's working the whole time
    scene.time.delayedCall(500, () => {
      actions.speak('xp_alex', 'Building auth module...', 0); // persist forever
    });

    // --- Timed sequence ---

    // 2s — CEO speaks
    scene.time.delayedCall(2000, () => {
      this._showCeoBubble('Research our three biggest competitors and report back to the team.', 4000);
    });

    // 5s — Abby responds
    scene.time.delayedCall(5000, () => {
      actions.speak('xp_abby', 'Understood. Bob — take this one.', 3000);
    });

    // 7s — Bob walks to desk
    scene.time.delayedCall(7000, () => {
      // Unfreeze Bob so he can walk
      bob.ai.taskState = 'idle';

      const bobAgent = this.manager.agents?.get('xp_bob');
      const bobDeskId = bobAgent?.assignedDesk;

      if (bobDeskId) {
        actions.useComputer('xp_bob', bobDeskId);
      } else {
        // Fallback: walk to a known desk
        actions.walkTo('xp_bob', 388, 156);
      }
    });

    // 10s — Bob seated, first research bubble
    scene.time.delayedCall(10000, () => {
      actions.speak('xp_bob', 'Searching competitors...', 3000);
    });

    // 13s — Bob found results
    scene.time.delayedCall(13000, () => {
      actions.speak('xp_bob', 'Found Datadog. Found LangSmith. Found Helicone.', 4000);
    });

    // 17s — Bob's final report (persists)
    scene.time.delayedCall(17000, () => {
      actions.speak('xp_bob', 'Done. Log-first only. Nobody does live. Gap confirmed.', 0);
    });

    // 18s — Report icon appears
    scene.time.delayedCall(18000, () => {
      this._showReportIcon(bob);
    });

    console.log('[DemoScene] Timeline scheduled (20s)');
  }

  /**
   * Show CEO speech bubble (green, above player)
   */
  _showCeoBubble(text, duration) {
    const player = this.scene.player;
    if (!player) return;

    if (this._ceoBubble) {
      this._ceoBubble.destroy();
      this._ceoBubble = null;
    }

    this._ceoBubble = this.scene.add.text(player.x, player.y - 60, text, {
      fontSize: '7px',
      fontFamily: 'monospace',
      color: '#4ade80',
      backgroundColor: '#0f172a',
      padding: { x: 4, y: 3 },
      wordWrap: { width: 180 },
      align: 'center',
    });
    this._ceoBubble.setOrigin(0.5, 1);
    this._ceoBubble.setDepth(9999);

    if (duration > 0) {
      this.scene.time.delayedCall(duration, () => {
        if (this._ceoBubble) {
          this._ceoBubble.destroy();
          this._ceoBubble = null;
        }
      });
    }
  }

  /**
   * Show clickable report icon near Bob
   */
  _showReportIcon(bob) {
    if (!bob) return;

    const icon = this.scene.add.text(bob.x + 40, bob.y - 56, 'View Report', {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#4ade80',
      backgroundColor: '#0f172a',
      padding: { x: 6, y: 4 },
    });
    icon.setOrigin(0, 1);
    icon.setDepth(9999);
    icon.setInteractive({ useHandCursor: true });

    // Pulse animation
    this.scene.tweens.add({
      targets: icon,
      alpha: { from: 1, to: 0.5 },
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    icon.on('pointerdown', () => {
      window.open('/pixel-office-game/reports/competitor-report.html', '_blank');
    });

    this._reportIcon = icon;
  }

  _findNpc(textureKey) {
    return this.scene.npcs?.find(n => n.texture?.key === textureKey);
  }
}

// Expose globally
window.DemoScene = DemoScene;
