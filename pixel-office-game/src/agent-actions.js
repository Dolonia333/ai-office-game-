/**
 * Agent Action Protocol
 * Defines executable actions that AI agents can perform in the pixel office game.
 * Loaded in the browser. Each action returns a Promise that resolves when complete.
 */

class AgentActions {
  /**
   * @param {Phaser.Scene} scene - The office scene
   */
  constructor(scene) {
    this.scene = scene;
    this._actionQueues = new Map(); // npcKey -> Promise chain
    this._speechBubbles = new Map(); // npcKey -> { container, timer }
    this._thoughtBubbles = new Map();
    this._emoteBubbles = new Map();
    this._roleLabels = new Map(); // npcKey -> text object
    this._typingIndicators = new Map(); // npcKey -> text object
    this._sittingNpcs = new Map(); // npcKey -> { chairSprite, origDepth, origY }
    this._standingMeetingNpcs = new Set(); // npcKey -> Set of NPCs currently standing in meeting
    // Tracks how many NPCs are currently walking up to speak to a given target.
    // Caps concurrent speakers so Abby doesn't attract a 4-NPC tornado.
    this._activeSpeakers = new Map(); // targetNpcKey -> count
    this.MAX_SPEAKERS_PER_TARGET = 2;

    // Room definitions — agents understand the office layout
    this.ROOMS = {
      open_office: { name: 'Open Office', xMin: 100, xMax: 800, yMin: 80, yMax: 420, purpose: 'Main workspace with cubicle desks and computers' },
      manager_office: { name: 'Manager Office', xMin: 880, xMax: 1248, yMin: 80, yMax: 240, purpose: 'Private office for management' },
      conference: { name: 'Conference Room', xMin: 880, xMax: 1248, yMin: 280, yMax: 440, purpose: 'Meetings, printer, supplies' },
      breakroom: { name: 'Break Room', xMin: 40, xMax: 280, yMin: 460, yMax: 660, purpose: 'Couches, coffee, vending machines' },
      reception: { name: 'Reception', xMin: 380, xMax: 840, yMin: 460, yMax: 660, purpose: 'Front desk, waiting area for visitors' },
      storage: { name: 'Storage/IT', xMin: 880, xMax: 1248, yMin: 460, yMax: 660, purpose: 'Server room, IT equipment, storage' },
    };
  }

  // ---- NPC / Furniture Helpers ----

  _getNpc(npcKey) {
    if (!this.scene.npcs) return null;
    return this.scene.npcs.find(n => n.texture?.key === npcKey) || null;
  }

  _getFurniture(furnitureId) {
    if (!this.scene._interactables) return null;
    return this.scene._interactables.find(
      it => it.instanceId === furnitureId || it.id === furnitureId
    ) || null;
  }

  /**
   * Find the nearest chair to a desk (searches _interactables for seats within range)
   */
  _findChairNearDesk(desk, range = 80) {
    if (!this.scene._interactables || !desk?.sprite) return null;

    let best = null;
    let bestDist = range;

    this.scene._interactables.forEach(it => {
      if (!it.def || !it.sprite) return;
      const isSeat = it.def.type === 'seat' || (it.id && /chair|seat|stool/i.test(it.id));
      if (!isSeat) return;

      const d = Math.hypot(it.sprite.x - desk.sprite.x, it.sprite.y - desk.sprite.y);
      if (d < bestDist) {
        bestDist = d;
        best = it;
      }
    });

    return best;
  }

  /**
   * Determine if a chair is "back-facing" (NPC sits behind it, facing up toward desk)
   * or "front-facing" (NPC sits in front of it, facing down).
   * Uses the chair sprite name first (most reliable), falls back to Y position.
   */
  _getChairFacing(chair, desk) {
    if (!chair?.sprite || !desk?.sprite) return { facing: 'up', backFacing: true };

    // Check sprite name for explicit facing info
    const chairId = (chair.id || '').toLowerCase();
    if (/back/.test(chairId)) {
      // Chair sprite shows the back → NPC faces UP (away from camera, toward desk)
      // Chair renders ON TOP of NPC
      return { facing: 'up', backFacing: true };
    }
    if (/front/.test(chairId)) {
      // Chair sprite shows the front → NPC faces DOWN (toward camera)
      // NPC renders ON TOP of chair
      return { facing: 'down', backFacing: false };
    }

    // Fallback: use Y position relative to desk
    if (chair.sprite.y > desk.sprite.y) {
      return { facing: 'up', backFacing: true };
    } else {
      return { facing: 'down', backFacing: false };
    }
  }

  /**
   * Get which room a position is in
   */
  getRoom(x, y) {
    for (const [key, room] of Object.entries(this.ROOMS)) {
      if (x >= room.xMin && x <= room.xMax && y >= room.yMin && y <= room.yMax) {
        return { key, ...room };
      }
    }
    return { key: 'unknown', name: 'Unknown Area', xMin: 0, xMax: 1280, yMin: 0, yMax: 720, purpose: 'Uncharted area' };
  }

  /**
   * Get a full map description for AI agents to understand the environment
   */
  getEnvironmentDescription() {
    const rooms = Object.entries(this.ROOMS).map(([key, room]) => {
      // Count furniture in this room
      const furniture = (this.scene._interactables || []).filter(it => {
        if (!it.sprite) return false;
        return it.sprite.x >= room.xMin && it.sprite.x <= room.xMax &&
               it.sprite.y >= room.yMin && it.sprite.y <= room.yMax;
      });

      const desks = furniture.filter(f => /desk/i.test(f.id || ''));
      const chairs = furniture.filter(f => f.def?.type === 'seat' || /chair/i.test(f.id || ''));
      const shelves = furniture.filter(f => /shelf|bookcase/i.test(f.id || ''));

      return `${room.name} (${key}): ${room.purpose}. Contains ${desks.length} desks, ${chairs.length} chairs, ${shelves.length} shelves, ${furniture.length} total items.`;
    });

    return {
      rooms: rooms.join('\n'),
      totalFurniture: (this.scene._interactables || []).length,
      mapSize: '1280x720 pixels',
      tileSize: '32px',
    };
  }

  // ---- Action Queue ----

  queueAction(npcKey, actionFn) {
    const current = this._actionQueues.get(npcKey) || Promise.resolve();
    const next = current.then(() => actionFn()).catch(err => {
      console.warn(`[AgentActions] Action failed for ${npcKey}:`, err);
    });
    this._actionQueues.set(npcKey, next);
    return next;
  }

  // ---- Core Actions ----

  /**
   * walkTo(npcKey, x, y) - Walk NPC to position
   */
  walkTo(npcKey, x, y) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        if (!npc || !npc.ai) { resolve(); return; }

        // If sitting, stand up first
        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        // Add slight random offset so multiple NPCs don't stack on the exact same pixel
        const ox = x + (Math.random() - 0.5) * 12;
        const oy = y + (Math.random() - 0.5) * 12;

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: ox, y: oy };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(ox - npc.x, oy - npc.y);
            if (dist <= 10 || npc.ai.taskState === 'working') {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              // Brief idle pause on arrival — looks like settling into position
              this.scene.time.delayedCall(200, () => {
                npc.ai.taskState = 'arrived';
                resolve();
              });
            }
          }
        });

        this.scene.time.delayedCall(12000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          resolve();
        });
      });
    });
  }

  /**
   * useComputer(npcKey, deskId) - Walk to desk's chair, sit properly, show working
   */
  useComputer(npcKey, deskId) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const desk = this._getFurniture(deskId);
        if (!npc || !desk?.sprite) { resolve(); return; }

        // If already sitting, stand up first
        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        // Find the chair near this desk
        const chair = this._findChairNearDesk(desk);
        const chairInfo = this._getChairFacing(chair, desk);

        // Target position: in front of the chair (where NPC stands to sit)
        let targetX, targetY;
        if (chair?.sprite) {
          targetX = chair.sprite.x;
          // Position NPC at the chair — offset slightly based on facing
          if (chairInfo.backFacing) {
            // Back-facing: NPC goes to chair Y (sits behind desk looking up)
            targetY = chair.sprite.y;
          } else {
            // Front-facing: NPC goes to chair Y
            targetY = chair.sprite.y;
          }
        } else {
          // No chair found — just stand near the desk
          targetX = desk.sprite.x;
          targetY = desk.sprite.y + 24;
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        // Shrink collision body while walking to desk so NPC can squeeze through tight furniture gaps
        npc.body.setSize(6, 4);
        npc.body.setOffset(5, 20);

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(targetX - npc.x, targetY - npc.y);
            if (dist <= 14 || npc.ai.taskState === 'working') {
              checkInterval.remove();

              // Restore normal collision body
              npc.body.setSize(10, 8);
              npc.body.setOffset(3, 16);

              // Snap NPC to chair position and sit
              npc.body.setVelocity(0, 0);
              npc.x = targetX;
              npc.y = targetY;

              // Set facing direction
              npc.ai.facing = chairInfo.facing;

              // Stop animation — set idle frame based on facing
              npc.anims.stop();
              if (chairInfo.facing === 'up') npc.setFrame(12);
              else if (chairInfo.facing === 'down') npc.setFrame(0);
              else if (chairInfo.facing === 'left') npc.setFrame(4);
              else npc.setFrame(8);

              // Adjust depth for proper chair layering
              npc.ai.taskState = 'sitting';
              if (chair?.sprite) {
                this._applySitDepth(npc, npcKey, chair, chairInfo);
              }

              // Show typing indicator
              this._showTypingIndicator(npc, npcKey);
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(12000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          // Restore collision body if walk timed out
          npc.body.setSize(10, 8);
          npc.body.setOffset(3, 16);
          resolve();
        });
      });
    });
  }

  /**
   * teleportToDesk(npcKey, deskId) - Instantly place NPC at desk chair (no walking)
   */
  teleportToDesk(npcKey, deskId) {
    const npc = this._getNpc(npcKey);
    const desk = this._getFurniture(deskId);
    if (!npc || !desk?.sprite) return;

    const chair = this._findChairNearDesk(desk);
    const chairInfo = this._getChairFacing(chair, desk);

    const tx = chair?.sprite ? chair.sprite.x : desk.sprite.x;
    const ty = chair?.sprite ? chair.sprite.y : desk.sprite.y + 24;

    npc.x = tx;
    npc.y = ty;
    npc.body.setVelocity(0, 0);
    npc.ai.mode = 'agent_task';
    npc.ai.taskState = 'sitting';
    npc.ai.facing = chairInfo.facing;
    npc.anims.stop();
    if (chairInfo.facing === 'up') npc.setFrame(12);
    else if (chairInfo.facing === 'down') npc.setFrame(0);
    else if (chairInfo.facing === 'left') npc.setFrame(4);
    else npc.setFrame(8);

    if (chair?.sprite) {
      this._applySitDepth(npc, npcKey, chair, chairInfo);
    }
    this._sittingNpcs.set(npcKey, {
      chairSprite: chair?.sprite || null,
      origDepth: npc.depth,
      origY: npc.y,
      chairInfo,
    });
    this._showTypingIndicator(npc, npcKey);
  }

  /**
   * Apply correct depth when NPC sits in a chair
   * Back-facing chair: chair renders ON TOP of NPC (higher depth)
   * Front-facing chair: NPC renders ON TOP of chair (higher depth)
   */
  _applySitDepth(npc, npcKey, chair, chairInfo) {
    const origDepth = npc.depth;
    const chairDepth = chair.sprite.depth;

    if (chairInfo.backFacing) {
      // Back-facing: chair should be on top of NPC (NPC is behind the chair back)
      // Set NPC depth below chair
      npc.setDepth(chairDepth - 0.5);
    } else {
      // Front-facing: NPC should be on top of chair
      npc.setDepth(chairDepth + 0.5);
    }

    this._sittingNpcs.set(npcKey, {
      chairSprite: chair.sprite,
      origDepth,
      origY: npc.y,
      chairInfo,
    });
  }

  /**
   * Stand up NPC from sitting
   */
  _standUpNpc(npcKey) {
    const sitData = this._sittingNpcs.get(npcKey);
    if (!sitData) return;

    const npc = this._getNpc(npcKey);
    if (npc) {
      // Restore original depth (Y-sort will take over)
      npc.setDepth(sitData.origDepth);
      // Step away from chair — direction depends on which way the chair faces
      npc.y += sitData.chairInfo.backFacing ? -16 : 16;
    }

    this._hideTypingIndicator(npcKey);
    this._hideReadingIndicator(npcKey);
    this._sittingNpcs.delete(npcKey);
  }

  /**
   * sitAt(npcKey, furnitureId) - Walk to and sit at a specific chair
   */
  sitAt(npcKey, furnitureId) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const furniture = this._getFurniture(furnitureId);
        if (!npc || !furniture?.sprite) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        const targetX = furniture.sprite.x;
        const targetY = furniture.sprite.y;

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(targetX - npc.x, targetY - npc.y);
            if (dist <= 14) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              npc.x = targetX;
              npc.y = targetY;
              npc.ai.taskState = 'sitting';
              npc.ai.facing = 'down';
              npc.anims.stop();
              npc.setFrame(0);

              // Depth: NPC in front of chair for front-facing
              const isFront = /front/i.test(furniture.id || '');
              if (isFront) {
                npc.setDepth(furniture.sprite.depth + 0.5);
              } else {
                npc.setDepth(furniture.sprite.depth - 0.5);
              }

              this._sittingNpcs.set(npcKey, {
                chairSprite: furniture.sprite,
                origDepth: npc.depth,
                origY: npc.y,
                chairInfo: { facing: 'down', backFacing: !isFront },
              });
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(8000, () => {
          checkInterval.remove();
          resolve();
        });
      });
    });
  }

  /**
   * standUp(npcKey) - Stand up from sitting
   */
  standUp(npcKey) {
    return this.queueAction(npcKey, () => {
      this._standUpNpc(npcKey);
      const npc = this._getNpc(npcKey);
      if (npc) {
        npc.ai.taskState = 'idle';
        npc.ai.mode = 'agent_task';
      }
    });
  }

  /**
   * checkBookshelf(npcKey, shelfId) - Walk to bookshelf and face it
   */
  checkBookshelf(npcKey, shelfId) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        if (!npc) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        const shelf = this._getFurniture(shelfId);
        let targetX, targetY;
        if (shelf?.sprite) {
          targetX = shelf.sprite.x;
          targetY = shelf.sprite.y + 24;
        } else {
          // Find any bookshelf
          const anyShelf = (this.scene._interactables || []).find(
            it => it.id && /bookshelf|shelf|bookcase/i.test(it.id)
          );
          if (anyShelf?.sprite) {
            targetX = anyShelf.sprite.x;
            targetY = anyShelf.sprite.y + 24;
          } else {
            targetX = 700; targetY = 300;
          }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(targetX - npc.x, targetY - npc.y);
            if (dist <= 14) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              npc.ai.taskState = 'reading';
              npc.ai.facing = 'up';
              npc.anims.stop();
              npc.setFrame(12);
              this._showReadingIndicator(npc, npcKey);
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(10000, () => {
          checkInterval.remove();
          resolve();
        });
      });
    });
  }

  /**
   * speak(npcKey, text) - Show speech bubble above NPC
   */
  speak(npcKey, text, duration) {
    return this.queueAction(npcKey, () => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      this._showSpeechBubble(npc, npcKey, text, 'speech', duration);
    });
  }

  /**
   * speakTo(npcKey, targetNpcKey, text) - NPC talks to another NPC
   */
  speakTo(npcKey, targetNpcKey, text) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const target = this._getNpc(targetNpcKey);
        if (!npc || !target) { resolve(); return; }

        // #4 — Conversation slot reservation. If the target already has
        // MAX_SPEAKERS_PER_TARGET speakers walking up, skip this speakTo so we
        // don't form a pile. The speaker just doesn't walk over — a short speech
        // bubble at their own spot still works via the separate speak() verb.
        const activeCount = this._activeSpeakers.get(targetNpcKey) || 0;
        if (activeCount >= this.MAX_SPEAKERS_PER_TARGET) {
          resolve();
          return;
        }
        this._activeSpeakers.set(targetNpcKey, activeCount + 1);
        let slotReleased = false;
        const releaseSlot = () => {
          if (slotReleased) return;
          slotReleased = true;
          const n = (this._activeSpeakers.get(targetNpcKey) || 1) - 1;
          if (n <= 0) this._activeSpeakers.delete(targetNpcKey);
          else this._activeSpeakers.set(targetNpcKey, n);
        };

        // Walk near the target NPC — add slight Y offset so they don't stack.
        let tx = target.x + (npc.x > target.x ? 26 : -26);
        let ty = target.y + Phaser.Math.Between(-6, 6);

        // #2 — Snap target to nearest walkable cell so we don't aim into a wall
        // (happens when the target NPC is flush against furniture).
        const pf = this.scene._pathfinder;
        if (pf && typeof pf.findWalkableNear === 'function') {
          const snapped = pf.findWalkableNear(tx, ty, 48);
          if (snapped) { tx = snapped.x; ty = snapped.y; }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: tx, y: ty };
        npc.ai.taskState = 'walking';

        // Stuck detection: if distance doesn't decrease for ~1.5s, abort early
        // so the NPC doesn't grind into a wall or pile onto another NPC.
        let lastDist = Math.hypot(tx - npc.x, ty - npc.y);
        let stuckTicks = 0;
        const STUCK_LIMIT = 15; // 15 × 100ms = 1.5s with no progress
        let resolved = false;
        const finish = (mode) => {
          if (resolved) return;
          resolved = true;
          releaseSlot();
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          if (mode === 'arrived') {
            // Face speaker toward the target
            npc.ai.facing = target.x > npc.x ? 'right' : 'left';
            npc.anims.stop();
            if (npc.ai.facing === 'left') npc.setFrame(4);
            else npc.setFrame(8);

            // Face the target NPC back toward the speaker
            if (target.ai) {
              target.ai.facing = npc.x > target.x ? 'right' : 'left';
              target.body.setVelocity(0, 0);
              target.anims.stop();
              if (target.ai.facing === 'left') target.setFrame(4);
              else target.setFrame(8);
            }

            // Small idle pause before speaking — looks like settling in
            this.scene.time.delayedCall(350, () => {
              // Show speech bubble after the pause
              this._showSpeechBubble(npc, npcKey, text, 'speech');
              // After a beat, resolve
              this.scene.time.delayedCall(1500, () => resolve());
            });
          } else {
            // Stuck or timed out — release the NPC back to wander so it
            // doesn't stay jammed against geometry.
            npc.ai.mode = 'wander';
            npc.ai.taskTarget = null;
            npc.ai.taskState = null;
            npc.ai.nextWanderAt = this.scene.time.now + 1500;
            resolve();
          }
        };

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(tx - npc.x, ty - npc.y);
            if (dist <= 20) {
              finish('arrived');
              return;
            }
            // Made less than 1px of progress this tick — count as stuck.
            if (lastDist - dist < 1) {
              stuckTicks++;
              if (stuckTicks >= STUCK_LIMIT) {
                finish('stuck');
                return;
              }
            } else {
              stuckTicks = 0;
            }
            lastDist = dist;
          }
        });

        // Hard ceiling — dropped from 8s to 3s so jammed NPCs recover fast.
        this.scene.time.delayedCall(3000, () => finish('timeout'));
      });
    });
  }

  /**
   * think(npcKey, text) - Show thought bubble
   */
  think(npcKey, text) {
    return this.queueAction(npcKey, () => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      this._showSpeechBubble(npc, npcKey, text, 'thought');
    });
  }

  /**
   * emote(npcKey, type) - Show emoji reaction
   */
  emote(npcKey, type) {
    return this.queueAction(npcKey, () => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      const emoteMap = {
        '!': '!', '?': '?', 'idea': '💡', 'confused': '?',
        'happy': ':)', 'working': '...', 'done': '✓',
        'error': '✗', 'star': '★', 'wave': '👋',
      };
      const symbol = emoteMap[type] || type || '!';
      this._showEmote(npc, npcKey, symbol);
    });
  }

  /**
   * goToBreakroom(npcKey) - Walk to breakroom area
   */
  goToBreakroom(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }
    const bx = 80 + Math.random() * 150;
    const by = 520 + Math.random() * 80;
    return this.walkTo(npcKey, bx, by);
  }

  /**
   * goToCoffee(npcKey) - Walk to coffee-like furniture in the breakroom.
   * Falls back to a generic breakroom spot if no match is found.
   */
  goToCoffee(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }
    const item = (this.scene._interactables || []).find(it => {
      return it.sprite && it.id && /coffee|espresso|kettle|vending|snack|fridge|microwave/i.test(it.id);
    });
    if (item && item.sprite) {
      const x = item.sprite.x + Phaser.Math.Between(-10, 10);
      const y = item.sprite.y + 20 + Phaser.Math.Between(-6, 6);
      return this.walkTo(npcKey, x, y);
    }
    return this.goToBreakroom(npcKey);
  }

  /**
   * visit(npcKey, targetNpcKey) - Walk toward a coworker's desk for a
   * drop-by check-in. Does not speak; caller can follow up with speak()
   * or speakTo() if they want a conversation. Returns a promise that
   * resolves once the NPC has arrived (or given up).
   */
  visit(npcKey, targetNpcKey) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const target = this._getNpc(targetNpcKey);
        if (!npc || !target) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        // Aim for a walkable offset beside the target — snapped to the grid
        // so we don't land inside a desk or wall.
        let tx = target.x + (npc.x > target.x ? 30 : -30);
        let ty = target.y + Phaser.Math.Between(-8, 8);
        const pf = this.scene._pathfinder;
        if (pf && typeof pf.findWalkableNear === 'function') {
          const snapped = pf.findWalkableNear(tx, ty, 48);
          if (snapped) { tx = snapped.x; ty = snapped.y; }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: tx, y: ty };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(tx - npc.x, ty - npc.y);
            if (dist <= 18) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              // Face the target
              npc.ai.facing = target.x > npc.x ? 'right' : 'left';
              npc.anims.stop();
              npc.setFrame(npc.ai.facing === 'left' ? 4 : 8);
              resolve();
            }
          }
        });

        // Dropped 8s → 3s ceiling so jammed visitors abandon quickly.
        this.scene.time.delayedCall(3000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          resolve();
        });
      });
    });
  }

  /**
   * goToRoom(npcKey, roomKey) - Walk to center of a named room
   */
  goToRoom(npcKey, roomKey) {
    const room = this.ROOMS[roomKey];
    if (!room) return this.walkTo(npcKey, 400, 300);
    const x = (room.xMin + room.xMax) / 2 + Phaser.Math.Between(-30, 30);
    const y = (room.yMin + room.yMax) / 2 + Phaser.Math.Between(-20, 20);
    return this.walkTo(npcKey, x, y);
  }

  /**
   * Find available chairs in the conference room that no NPC is sitting in
   */
  _findConferenceChairs() {
    if (!this.scene._interactables) return [];
    const room = this.ROOMS.conference;
    const chairs = this.scene._interactables.filter(it => {
      if (!it.sprite || !it.def) return false;
      const isSeat = it.def.type === 'seat' || (it.id && /chair|seat|stool/i.test(it.id));
      if (!isSeat) return false;
      const x = it.sprite.x, y = it.sprite.y;
      return x >= room.xMin && x <= room.xMax && y >= room.yMin && y <= room.yMax;
    });
    // Sort by position so we can spread NPCs out (alternate sides of table)
    chairs.sort((a, b) => a.sprite.x - b.sprite.x || a.sprite.y - b.sprite.y);
    return chairs;
  }

  /**
   * joinMeeting(npcKey) - Walk to conference room and sit at an available chair
   */
  joinMeeting(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }

    const chairs = this._findConferenceChairs();
    // Find chairs not occupied by another NPC
    const occupiedChairs = new Set();
    this._sittingNpcs.forEach((data) => {
      if (data.chairSprite) occupiedChairs.add(data.chairSprite);
    });

    const available = chairs.filter(c => !occupiedChairs.has(c.sprite));
    if (available.length === 0) {
      return this.goToRoom(npcKey, 'conference');
    }

    // Spread out: pick the chair farthest from any occupied chair
    let bestChair = available[0];
    if (occupiedChairs.size > 0) {
      let bestMinDist = -1;
      for (const chair of available) {
        let minDist = Infinity;
        occupiedChairs.forEach(occ => {
          const d = Math.hypot(chair.sprite.x - occ.x, chair.sprite.y - occ.y);
          if (d < minDist) minDist = d;
        });
        if (minDist > bestMinDist) {
          bestMinDist = minDist;
          bestChair = chair;
        }
      }
    }

    return this.sitAt(npcKey, bestChair.instanceId || bestChair.id);
  }

  /**
   * attendMeeting(npcKey) - Walk to conference room and stand in rows (for lower-rank staff)
   * Standing NPCs form rows behind the seated leadership, facing the table.
   */
  attendMeeting(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }

    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        if (!npc) { resolve(); return; }

        const room = this.ROOMS.conference;
        // Standing positions: rows behind the chairs, spread across the room
        // Track how many are already standing so we can stagger them
        this._standingMeetingNpcs.add(npcKey);
        const standIndex = [...this._standingMeetingNpcs].indexOf(npcKey);

        // Arrange in 2 rows of up to 5, spread across the conference room width
        const cols = 5;
        const row = Math.floor(standIndex / cols);
        const col = standIndex % cols;
        const startX = room.xMin + 40;
        const spacingX = (room.xMax - room.xMin - 80) / (cols - 1);
        const startY = room.yMax - 20 + (row * 28); // Below the chairs, in rows

        const targetX = startX + col * spacingX;
        const targetY = startY;

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(targetX - npc.x, targetY - npc.y);
            if (dist <= 16) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              npc.ai.taskState = 'attending_meeting';
              // Face upward toward the table/presenters
              npc.anims.stop();
              npc.setFrame(0); // facing up/front
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(12000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          resolve();
        });
      });
    });
  }

  /**
   * leaveMeeting(npcKey) - Clean up standing meeting state when NPC leaves
   */
  leaveMeeting(npcKey) {
    if (this._standingMeetingNpcs) {
      this._standingMeetingNpcs.delete(npcKey);
    }
    return this.standUp(npcKey);
  }

  /**
   * reportToCEO(npcKey) - Walk to player and face them
   */
  reportToCEO(npcKey) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const player = this.scene.player;
        if (!npc || !player) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        const targetX = player.x + 32;
        const targetY = player.y;

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(targetX - npc.x, targetY - npc.y);
            if (dist <= 24) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              npc.ai.taskState = 'reporting';
              npc.ai.facing = player.x < npc.x ? 'left' : 'right';
              npc.anims.stop();
              if (npc.ai.facing === 'left') npc.setFrame(4);
              else npc.setFrame(8);
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(12000, () => {
          checkInterval.remove();
          resolve();
        });
      });
    });
  }

  /**
   * setIdle(npcKey) - Put NPC in idle state at current position
   */
  setIdle(npcKey) {
    const npc = this._getNpc(npcKey);
    if (!npc || !npc.ai) return;

    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }

    npc.ai.mode = 'agent_task';
    npc.ai.taskState = 'idle';
    npc.body.setVelocity(0, 0);
    npc.anims.stop();

    // Set idle frame based on facing
    if (npc.ai.facing === 'up') npc.setFrame(12);
    else if (npc.ai.facing === 'down') npc.setFrame(0);
    else if (npc.ai.facing === 'left') npc.setFrame(4);
    else npc.setFrame(8);

    this._hideTypingIndicator(npcKey);
    this._hideReadingIndicator(npcKey);
  }

  // ---- Visual Helpers ----

  _showSpeechBubble(npc, npcKey, text, style, duration) {
    this._clearBubble(npcKey, this._speechBubbles);

    const truncated = text.length > 60 ? text.slice(0, 57) + '...' : text;
    const isThought = style === 'thought';

    const bgColor = isThought ? '#1a1a2e' : '#1e293b';
    const textColor = isThought ? '#c4b5fd' : '#ffffff';
    const prefix = isThought ? '( ' : '';
    const suffix = isThought ? ' )' : '';

    const bubbleText = this.scene.add.text(0, 0, prefix + truncated + suffix, {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: textColor,
      backgroundColor: bgColor,
      padding: { x: 5, y: 4 },
      wordWrap: { width: 180 },
      align: 'center',
    });
    bubbleText.setOrigin(0.5, 1);
    bubbleText.setDepth(9998);
    bubbleText.x = npc.x;
    bubbleText.y = npc.y - 48;

    // duration=0 means persist forever (no auto-clear), undefined defaults to 5s
    const dur = duration !== undefined ? duration : 5000;
    const timer = dur > 0 ? this.scene.time.delayedCall(dur, () => {
      this._clearBubble(npcKey, this._speechBubbles);
    }) : null;

    this._speechBubbles.set(npcKey, { text: bubbleText, timer, npc });
  }

  _showEmote(npc, npcKey, symbol) {
    this._clearBubble(npcKey, this._emoteBubbles);

    const emoteText = this.scene.add.text(0, 0, symbol, {
      fontSize: '12px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#fbbf24',
      backgroundColor: '#00000088',
      padding: { x: 3, y: 1 },
    });
    emoteText.setOrigin(0.5, 1);
    emoteText.setDepth(9999);
    emoteText.x = npc.x + 12;
    emoteText.y = npc.y - 52;

    const timer = this.scene.time.delayedCall(2500, () => {
      this._clearBubble(npcKey, this._emoteBubbles);
    });

    this._emoteBubbles.set(npcKey, { text: emoteText, timer, npc });
  }

  _showTypingIndicator(npc, npcKey) {
    this._hideTypingIndicator(npcKey);

    const indicator = this.scene.add.text(0, 0, '...', {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#4ade80',
      backgroundColor: '#0f172a',
      padding: { x: 3, y: 2 },
    });
    indicator.setOrigin(0.5, 1);
    indicator.setDepth(9997);
    indicator.x = npc.x;
    indicator.y = npc.y - 36;

    let dotCount = 0;
    const dotTimer = this.scene.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        dotCount = (dotCount + 1) % 4;
        indicator.setText('.'.repeat(dotCount || 1));
      }
    });

    this._typingIndicators.set(npcKey, { text: indicator, timer: dotTimer, npc });
  }

  _hideTypingIndicator(npcKey) {
    const existing = this._typingIndicators.get(npcKey);
    if (existing) {
      existing.text.destroy();
      if (existing.timer) existing.timer.remove();
      this._typingIndicators.delete(npcKey);
    }
  }

  _showReadingIndicator(npc, npcKey) {
    this._hideTypingIndicator(npcKey);

    const indicator = this.scene.add.text(0, 0, 'Reading...', {
      fontSize: '7px',
      fontFamily: 'monospace',
      color: '#60a5fa',
      backgroundColor: '#0f172a',
      padding: { x: 3, y: 2 },
    });
    indicator.setOrigin(0.5, 1);
    indicator.setDepth(9997);
    indicator.x = npc.x;
    indicator.y = npc.y - 36;

    this._typingIndicators.set(npcKey, { text: indicator, timer: null, npc });
  }

  _hideReadingIndicator(npcKey) {
    this._hideTypingIndicator(npcKey);
  }

  showRoleLabel(npcKey, name, role) {
    this._clearRoleLabel(npcKey);
    const npc = this._getNpc(npcKey);
    if (!npc) return;

    const labelText = `${name}\n${role}`;
    const label = this.scene.add.text(0, 0, labelText, {
      fontSize: '7px',
      fontFamily: 'monospace',
      color: '#1e293b',
      align: 'center',
      stroke: '#ffffff',
      strokeThickness: 2,
    });
    label.setOrigin(0.5, 1);
    label.setDepth(9996);
    label.x = npc.x;
    label.y = npc.y - 52;

    this._roleLabels.set(npcKey, { text: label, npc });
  }

  _clearRoleLabel(npcKey) {
    const existing = this._roleLabels.get(npcKey);
    if (existing) {
      existing.text.destroy();
      this._roleLabels.delete(npcKey);
    }
  }

  _clearBubble(npcKey, map) {
    const existing = map.get(npcKey);
    if (existing) {
      if (existing.text) existing.text.destroy();
      if (existing.timer) existing.timer.remove();
      map.delete(npcKey);
    }
  }

  /**
   * Update all visual elements positions (call from scene update)
   */
  update() {
    const updateMap = (map, yOffset) => {
      map.forEach((entry) => {
        if (entry.npc && entry.text && !entry.text.scene) return;
        if (entry.npc && entry.text) {
          entry.text.x = entry.npc.x;
          entry.text.y = entry.npc.y - yOffset;
        }
      });
    };

    updateMap(this._speechBubbles, 48);
    updateMap(this._emoteBubbles, 56);
    updateMap(this._roleLabels, 52);

    this._typingIndicators.forEach((entry) => {
      if (entry.npc && entry.text) {
        entry.text.x = entry.npc.x;
        entry.text.y = entry.npc.y - 36;
      }
    });

    // Keep sitting NPCs from being moved by Y-sort (lock their depth)
    this._sittingNpcs.forEach((sitData, npcKey) => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;

      const chairDepth = sitData.chairSprite?.depth;
      if (chairDepth != null) {
        if (sitData.chairInfo?.backFacing) {
          npc.setDepth(chairDepth - 0.5);
        } else {
          npc.setDepth(chairDepth + 0.5);
        }
      }
    });
  }
}

window.AgentActions = AgentActions;
