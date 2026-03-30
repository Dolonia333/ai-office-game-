/**
 * Player Chat System
 * Lets the player (CEO) communicate directly with individual NPCs.
 *
 * Targeting logic:
 * 1. If player is near an NPC and facing them → that NPC is the target
 * 2. If the message mentions an NPC name → that NPC walks to the player
 * 3. If no target found → broadcasts to nearest NPC
 *
 * NPCs respond via their individual AI brains, can delegate tasks up hierarchy.
 */

class PlayerChat {
  constructor(scene, agentManager) {
    this.scene = scene;
    this.manager = agentManager;
    this._visible = false;
    this._input = null;
    this._container = null;
    this._chatLog = [];       // { from, text, time }
    this._maxLog = 50;
    this._waitingForResponse = false;

    // All NPC names for name detection in messages
    this._npcNames = [
      'Abby', 'Alex', 'Bob', 'Dan', 'Jenny', 'Lucy', 'Bouncer',
      'Marcus', 'Sarah', 'Edward', 'Josh', 'Molly', 'Oscar',
      'Pier', 'Rob', 'Roki'
    ];

    // NPC name → npcKey mapping
    this._nameToKey = {
      'abby': 'xp_abby', 'alex': 'xp_alex', 'bob': 'xp_bob',
      'dan': 'xp_dan', 'jenny': 'xp_jenny', 'lucy': 'xp_lucy',
      'bouncer': 'xp_bouncer', 'marcus': 'xp_conference_man',
      'sarah': 'xp_conference_woman', 'edward': 'xp_edward',
      'josh': 'xp_josh', 'molly': 'xp_molly', 'oscar': 'xp_oscar',
      'pier': 'xp_pier', 'rob': 'xp_rob', 'roki': 'xp_roki',
    };

    this._buildUI();
  }

  /**
   * Toggle chat visibility
   */
  toggle() {
    this._visible = !this._visible;
    this._container.style.display = this._visible ? 'flex' : 'none';
    if (this._visible) {
      this._input.focus();
      // Lock player movement while chat is open
      this.scene.playerLocked = true;
    } else {
      this._input.blur();
      this.scene.playerLocked = false;
      this.scene.playerState = 'walk';
    }
  }

  /**
   * Open chat and focus input
   */
  open() {
    if (!this._visible) this.toggle();
    else this._input.focus();
  }

  /**
   * Close chat
   */
  close() {
    if (this._visible) this.toggle();
  }

  get isOpen() { return this._visible; }

  /**
   * Find the NPC the player is currently facing (proximity + direction check)
   */
  _findFacingNpc() {
    const player = this.scene.player;
    if (!player || !Array.isArray(this.scene.npcs)) return null;

    const facing = this.scene.facing || 'down';
    const facingVec = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    }[facing];

    const maxDist = 80; // slightly larger than furniture interact distance
    let best = null;
    let bestDist = maxDist;

    this.scene.npcs.forEach(npc => {
      const dx = npc.x - player.x;
      const dy = npc.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxDist || dist < 1) return;

      // Dot product — must be roughly in front of player
      const dot = (dx / dist) * facingVec.x + (dy / dist) * facingVec.y;
      if (dot < 0.2) return;

      if (dist < bestDist) {
        bestDist = dist;
        best = npc;
      }
    });

    return best;
  }

  /**
   * Find NPC mentioned by name in the message
   */
  _findNamedNpc(message) {
    const lower = message.toLowerCase();
    for (const name of this._npcNames) {
      // Word boundary check: name must be standalone word
      const regex = new RegExp('\\b' + name.toLowerCase() + '\\b');
      if (regex.test(lower)) {
        return { name, key: this._nameToKey[name.toLowerCase()] };
      }
    }
    return null;
  }

  /**
   * Find the closest NPC to the player
   */
  _findNearestNpc() {
    const player = this.scene.player;
    if (!player || !Array.isArray(this.scene.npcs)) return null;

    let best = null;
    let bestDist = Infinity;

    this.scene.npcs.forEach(npc => {
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = npc;
      }
    });

    return best;
  }

  /**
   * Get NPC display name from texture key
   */
  _getNpcName(npcKey) {
    return this.manager?.NPC_NAMES?.[npcKey] || npcKey.replace('xp_', '').replace(/_/g, ' ');
  }

  /**
   * Stop an NPC, make them face the player, and freeze in place
   */
  _stopNpcForConversation(npc, npcKey) {
    if (!npc?.ai) return;
    const actions = this.manager?.actions;

    // If sitting, stand up first
    if (actions?._sittingNpcs?.has(npcKey)) {
      actions._standUpNpc(npcKey);
    }

    // Stop all movement
    npc.body.setVelocity(0, 0);
    if (npc._pathFollower) npc._pathFollower.stop();
    npc.ai.mode = 'agent_task';
    npc.ai.taskState = 'reporting'; // freeze in place

    // Face the player
    const player = this.scene.player;
    if (player) {
      const dx = player.x - npc.x;
      const dy = player.y - npc.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        npc.ai.facing = dx < 0 ? 'left' : 'right';
      } else {
        npc.ai.facing = dy < 0 ? 'up' : 'down';
      }
      // Set idle frame for facing direction
      if (npc.ai.facing === 'up') npc.setFrame(12);
      else if (npc.ai.facing === 'down') npc.setFrame(0);
      else if (npc.ai.facing === 'left') npc.setFrame(4);
      else npc.setFrame(8);
      npc.anims.stop();
    }
  }

  /**
   * Send a player message to an NPC
   */
  async sendMessage(text) {
    if (!text.trim() || this._waitingForResponse) return;

    const trimmed = text.trim();

    // Add to chat log
    this._addToLog('You', trimmed);

    // Determine target NPC
    let targetNpc = null;
    let targetKey = null;
    let targetName = null;
    let needsWalkToPlayer = false;

    // 1. Check if a name is mentioned in the message (priority — explicit intent)
    const named = this._findNamedNpc(trimmed);
    if (named) {
      targetKey = named.key;
      targetName = named.name;
      targetNpc = this.scene.npcs?.find(n => n.texture?.key === targetKey);
      if (targetNpc) {
        const player = this.scene.player;
        const dist = Math.hypot(targetNpc.x - player.x, targetNpc.y - player.y);
        if (dist > 80) {
          needsWalkToPlayer = true;
        }
      }
    }

    // 2. If no name mentioned, check if facing an NPC nearby
    if (!targetNpc) {
      const facingNpc = this._findFacingNpc();
      if (facingNpc) {
        targetNpc = facingNpc;
        targetKey = facingNpc.texture?.key;
        targetName = this._getNpcName(targetKey);
      }
    }

    // 3. Fallback: nearest NPC
    if (!targetNpc) {
      targetNpc = this._findNearestNpc();
      if (targetNpc) {
        targetKey = targetNpc.texture?.key;
        targetName = this._getNpcName(targetKey);
        const player = this.scene.player;
        const dist = Math.hypot(targetNpc.x - player.x, targetNpc.y - player.y);
        if (dist > 80) needsWalkToPlayer = true;
      }
    }

    if (!targetNpc || !targetKey) {
      this._addToLog('System', 'No NPC found to talk to.');
      return;
    }

    // Show who we're targeting
    this._updateTargetLabel(targetName);
    this._waitingForResponse = true;
    this._lastTargetKey = targetKey; // remember for response handler

    // Show player's speech bubble above the player character
    this._showPlayerBubble(trimmed);

    if (needsWalkToPlayer) {
      // NPC is far away — walk them to the player using proper pathfinding
      this._addToLog('System', `${targetName} is coming over...`);
      this.manager.actions.emote(targetKey, '!');

      // reportToCEO handles: stand up if sitting, walk via pathfinding, stop & face player
      await this.manager.actions.reportToCEO(targetKey);
      this._stopNpcForConversation(targetNpc, targetKey);
    } else {
      // NPC is nearby — show reaction, stop, face player
      this.manager.actions.emote(targetKey, '!');
      this._stopNpcForConversation(targetNpc, targetKey);
    }

    // Send to server for NPC brain processing
    if (this.manager?.ws?.readyState === WebSocket.OPEN) {
      this.manager._send({
        type: 'player_chat',
        npcName: targetName,
        npcKey: targetKey,
        text: trimmed,
        playerPos: {
          x: Math.round(this.scene.player?.x || 0),
          y: Math.round(this.scene.player?.y || 0),
        },
      });
    }

    // Timeout after 15s
    this._responseTimeout = setTimeout(() => {
      if (this._waitingForResponse) {
        this._waitingForResponse = false;
        this._addToLog(targetName, '(no response)');
        // Resume NPC
        this._resumeNpc(targetKey);
      }
    }, 15000);
  }

  /**
   * Resume an NPC after conversation — go back to desk or wander
   */
  _resumeNpc(npcKey) {
    const agent = this.manager?.agents?.get(npcKey);
    if (agent?.assignedDesk && this.manager?.actions) {
      this.manager.actions.useComputer(npcKey, agent.assignedDesk);
    } else {
      const npc = this.manager?.actions?._getNpc(npcKey);
      if (npc?.ai) {
        npc.ai.mode = 'wander';
        npc.ai.taskState = 'idle';
        npc.ai.nextWanderAt = 0;
      }
    }
  }

  /**
   * Handle NPC response from server
   */
  handleNpcResponse(npcName, text, delegation) {
    this._waitingForResponse = false;
    if (this._responseTimeout) {
      clearTimeout(this._responseTimeout);
      this._responseTimeout = null;
    }

    // Add to chat log
    this._addToLog(npcName, text);

    // Show speech bubble on the NPC
    const npcKey = this._nameToKey[npcName?.toLowerCase()] || this._lastTargetKey;
    if (npcKey && this.manager?.actions) {
      this.manager.actions.speak(npcKey, text);
    }

    // Handle delegation — NPC escalates to their superior
    if (delegation && delegation.delegateTo) {
      const superiorName = delegation.delegateTo;
      const superiorKey = this._nameToKey[superiorName?.toLowerCase()];
      const reason = delegation.reason || 'escalating';

      this._addToLog('System', `${npcName} is delegating to ${superiorName}: "${reason}"`);

      if (superiorKey && this.manager?.actions) {
        // After speech bubble shows, NPC walks to their superior
        this.scene.time.delayedCall(2500, () => {
          this.manager.actions.speakTo(npcKey, superiorKey, reason);

          // After speaking to superior, superior comes to the player
          this.scene.time.delayedCall(4000, () => {
            this.manager.actions.reportToCEO(superiorKey);

            // Superior responds to the original task
            this.scene.time.delayedCall(3000, () => {
              if (this.manager?.ws?.readyState === WebSocket.OPEN) {
                this.manager._send({
                  type: 'player_chat',
                  npcName: superiorName,
                  npcKey: superiorKey,
                  text: `[Delegated from ${npcName}] ${delegation.originalMessage || ''}`,
                  playerPos: {
                    x: Math.round(this.scene.player?.x || 0),
                    y: Math.round(this.scene.player?.y || 0),
                  },
                });
              }
            });
          });
        });
      }
      return; // delegation handles its own resume flow
    }

    // Resume NPC after speech bubble — but only if no actions are pending
    // (actions are handled by agent-office-manager._executeNpcActions with a 2s delay)
    const hadActions = this._hasActions;
    this._hasActions = false; // reset for next message
    if (!hadActions) {
      this.scene.time.delayedCall(3500, () => {
        // Re-check: _hasActions may have been set by a late-arriving action dispatch
        if (!this._hasActions) {
          this._resumeNpc(npcKey);
        }
      });
    }
  }

  /**
   * Show player's speech as a bubble above the player sprite
   */
  _showPlayerBubble(text) {
    if (this._playerBubble) {
      this._playerBubble.destroy();
      this._playerBubble = null;
    }

    const truncated = text.length > 50 ? text.slice(0, 47) + '...' : text;
    const player = this.scene.player;
    if (!player) return;

    this._playerBubble = this.scene.add.text(player.x, player.y - 60, truncated, {
      fontSize: '7px',
      fontFamily: 'monospace',
      color: '#4ade80',
      backgroundColor: '#0f172a',
      padding: { x: 4, y: 3 },
      wordWrap: { width: 140 },
      align: 'center',
    });
    this._playerBubble.setOrigin(0.5, 1);
    this._playerBubble.setDepth(9999);

    this.scene.time.delayedCall(4000, () => {
      if (this._playerBubble) {
        this._playerBubble.destroy();
        this._playerBubble = null;
      }
    });
  }

  /**
   * Update player bubble position (call from scene update)
   */
  updateBubbles() {
    if (this._playerBubble && this.scene.player) {
      this._playerBubble.x = this.scene.player.x;
      this._playerBubble.y = this.scene.player.y - 60;
    }
  }

  // --- UI ---

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      #player-chat-panel {
        position: fixed;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 500px;
        max-height: 280px;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid #334155;
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        display: none;
        flex-direction: column;
        z-index: 99999;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.5);
      }
      #player-chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        border-bottom: 1px solid #1e293b;
        color: #94a3b8;
        font-size: 11px;
        flex-shrink: 0;
      }
      #player-chat-header .target {
        color: #4ade80;
        font-weight: bold;
      }
      #player-chat-header .hint {
        color: #475569;
        font-size: 10px;
      }
      #player-chat-log {
        flex: 1;
        overflow-y: auto;
        padding: 8px 12px;
        min-height: 60px;
        max-height: 160px;
      }
      #player-chat-log .msg {
        margin-bottom: 4px;
        line-height: 1.4;
      }
      #player-chat-log .msg .sender {
        font-weight: bold;
        margin-right: 4px;
      }
      #player-chat-log .msg .sender.you { color: #4ade80; }
      #player-chat-log .msg .sender.npc { color: #60a5fa; }
      #player-chat-log .msg .sender.system { color: #fbbf24; }
      #player-chat-log .msg .text { color: #e2e8f0; }
      #player-chat-input-row {
        display: flex;
        gap: 6px;
        padding: 8px 12px;
        border-top: 1px solid #1e293b;
        flex-shrink: 0;
      }
      #player-chat-input {
        flex: 1;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 4px;
        color: #e2e8f0;
        padding: 6px 10px;
        font-family: inherit;
        font-size: 12px;
        outline: none;
      }
      #player-chat-input:focus {
        border-color: #4ade80;
      }
      #player-chat-input::placeholder {
        color: #475569;
      }
      #player-chat-send {
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 4px;
        padding: 6px 14px;
        cursor: pointer;
        font-family: inherit;
        font-weight: bold;
        font-size: 11px;
      }
      #player-chat-send:hover {
        background: #22c55e;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'player-chat-panel';
    panel.innerHTML = `
      <div id="player-chat-header">
        <div>
          <span class="target" id="player-chat-target">Chat</span>
          <span class="hint"> - Press Enter to send, Esc to close</span>
        </div>
      </div>
      <div id="player-chat-log"></div>
      <div id="player-chat-input-row">
        <input id="player-chat-input" type="text" placeholder="Talk to an NPC... (say their name or face them)" autocomplete="off" />
        <button id="player-chat-send">Send</button>
      </div>
    `;
    document.body.appendChild(panel);

    this._container = panel;
    this._input = panel.querySelector('#player-chat-input');
    this._logEl = panel.querySelector('#player-chat-log');
    this._targetLabel = panel.querySelector('#player-chat-target');

    // Send on Enter
    this._input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Prevent game keys from firing
      if (e.key === 'Enter' && this._input.value.trim()) {
        this.sendMessage(this._input.value);
        this._input.value = '';
      }
      if (e.key === 'Escape') {
        this.close();
      }
    });

    // Block all key events from reaching the game while typing
    this._input.addEventListener('keyup', (e) => e.stopPropagation());
    this._input.addEventListener('keypress', (e) => e.stopPropagation());

    // Send button
    panel.querySelector('#player-chat-send').addEventListener('click', () => {
      if (this._input.value.trim()) {
        this.sendMessage(this._input.value);
        this._input.value = '';
      }
    });

    // Block game input while interacting with panel
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  _addToLog(sender, text) {
    this._chatLog.push({ from: sender, text, time: Date.now() });
    if (this._chatLog.length > this._maxLog) {
      this._chatLog = this._chatLog.slice(-this._maxLog);
    }
    this._renderLog();
  }

  _renderLog() {
    const log = this._logEl;
    if (!log) return;

    // Only render last 20 messages
    const recent = this._chatLog.slice(-20);
    log.innerHTML = recent.map(m => {
      const senderClass = m.from === 'You' ? 'you' : m.from === 'System' ? 'system' : 'npc';
      const escaped = m.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="msg"><span class="sender ${senderClass}">${m.from}:</span><span class="text">${escaped}</span></div>`;
    }).join('');

    // Scroll to bottom
    log.scrollTop = log.scrollHeight;
  }

  _updateTargetLabel(name) {
    if (this._targetLabel) {
      this._targetLabel.textContent = name ? `Talking to ${name}` : 'Chat';
    }
  }
}

window.PlayerChat = PlayerChat;
