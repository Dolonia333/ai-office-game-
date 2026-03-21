/**
 * NPC Agent Controller
 * Maps OpenClaw agent events to NPC behaviors in the pixel office game.
 *
 * Agent states map to NPC actions:
 *   idle       → NPC wanders in breakroom area
 *   writing    → NPC sits at desk, typing
 *   researching → NPC sits at desk, reading
 *   executing  → NPC at desk, working
 *   syncing    → NPC walks between desks
 *   error      → NPC stops, shows error indicator
 */

// Map agent states to office areas (matches Star-Office-UI pattern)
const STATE_TO_AREA = {
  idle: 'breakroom',
  writing: 'desk',
  researching: 'desk',
  executing: 'desk',
  syncing: 'desk',
  error: 'desk',
};

// Breakroom area bounds (bottom-left of office)
const BREAKROOM = { xMin: 50, xMax: 400, yMin: 500, yMax: 680 };
// Desk area bounds (main office)
const DESK_AREA = { xMin: 100, xMax: 750, yMin: 100, yMax: 400 };

class NpcAgentController {
  /**
   * @param {object} scene - The Phaser scene (OfficeScene)
   * @param {GatewayBridge} bridge - The gateway bridge instance
   */
  constructor(scene, bridge) {
    this.scene = scene;
    this.bridge = bridge;

    // Map of agentId → { npc, state, assignedDesk }
    this.agentNpcs = new Map();

    // Track which NPCs are available for agent assignment
    this._availableNpcs = [];

    // Speech bubble sprites
    this._bubbles = new Map();

    this._bindEvents();
  }

  /** Initialize: assign NPCs to agents based on snapshot */
  init() {
    // Collect available NPCs from the scene
    if (this.scene.npcs) {
      this._availableNpcs = [...this.scene.npcs];
    }
    console.log(`[NpcAgentCtrl] ${this._availableNpcs.length} NPCs available for agent assignment`);
  }

  /** Get or create an agent→NPC binding */
  getOrAssignNpc(agentId, agentName) {
    if (this.agentNpcs.has(agentId)) {
      return this.agentNpcs.get(agentId);
    }

    // Assign next available NPC
    const npc = this._availableNpcs.shift();
    if (!npc) {
      console.warn(`[NpcAgentCtrl] No available NPCs for agent ${agentId}`);
      return null;
    }

    const binding = {
      npc,
      agentId,
      agentName: agentName || agentId,
      state: 'idle',
      assignedDesk: null,
    };
    this.agentNpcs.set(agentId, binding);
    console.log(`[NpcAgentCtrl] Assigned NPC ${npc.texture?.key} to agent "${agentName || agentId}"`);
    return binding;
  }

  /** Update an agent's state, driving its NPC behavior */
  setAgentState(agentId, state, detail) {
    const binding = this.agentNpcs.get(agentId);
    if (!binding) return;

    const prevState = binding.state;
    binding.state = state;
    const area = STATE_TO_AREA[state] || 'breakroom';

    console.log(`[NpcAgentCtrl] Agent "${binding.agentName}" ${prevState} → ${state} (area: ${area})`);

    const npc = binding.npc;
    if (!npc || !npc.ai) return;

    if (area === 'desk') {
      // Walk to a desk position
      this._sendToDesk(npc, binding);
    } else {
      // Wander in breakroom
      this._sendToBreakroom(npc);
    }

    // Show status bubble
    if (detail) {
      this._showBubble(npc, detail);
    }
  }

  /** Show a speech/status bubble above an NPC */
  _showBubble(npc, text) {
    // Remove existing bubble for this NPC
    const existing = this._bubbles.get(npc);
    if (existing) {
      existing.destroy();
    }

    // Create bubble text
    const bubble = this.scene.add.text(npc.x, npc.y - 40, text.slice(0, 30), {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: '#1e293b',
      padding: { x: 3, y: 2 },
      align: 'center',
    });
    bubble.setOrigin(0.5, 1);
    bubble.setDepth(9999);
    this._bubbles.set(npc, bubble);

    // Auto-remove after 4 seconds
    this.scene.time.delayedCall(4000, () => {
      if (this._bubbles.get(npc) === bubble) {
        bubble.destroy();
        this._bubbles.delete(npc);
      }
    });
  }

  /** Update bubble positions (call from scene update) */
  updateBubbles() {
    this._bubbles.forEach((bubble, npc) => {
      bubble.x = npc.x;
      bubble.y = npc.y - 40;
    });
  }

  /** Send NPC to a desk area */
  _sendToDesk(npc, binding) {
    // Find desk position - use a deterministic position based on agent index
    const idx = Array.from(this.agentNpcs.values()).indexOf(binding);
    const deskPositions = [
      { x: 128, y: 156 }, { x: 196, y: 156 }, { x: 388, y: 156 },
      { x: 456, y: 156 }, { x: 648, y: 156 }, { x: 716, y: 156 },
    ];
    const pos = deskPositions[idx % deskPositions.length];

    npc.ai.mode = 'agent_task';
    npc.ai.taskTarget = { x: pos.x, y: pos.y };
    npc.ai.taskState = 'walking';
  }

  /** Send NPC to wander in breakroom */
  _sendToBreakroom(npc) {
    npc.ai.mode = 'wander';
    // Set a target in the breakroom area
    npc.ai.wanderTarget = {
      x: BREAKROOM.xMin + Math.random() * (BREAKROOM.xMax - BREAKROOM.xMin),
      y: BREAKROOM.yMin + Math.random() * (BREAKROOM.yMax - BREAKROOM.yMin),
    };
    npc.ai.nextWanderAt = 0; // move immediately
  }

  /** Bind to gateway bridge events */
  _bindEvents() {
    // Agent lifecycle events
    this.bridge.addEventListener('agent', (evt) => {
      const payload = evt.detail;
      if (!payload) return;

      const agentId = payload.agentId || payload.runId || 'default';
      const binding = this.getOrAssignNpc(agentId, payload.agentName);
      if (!binding) return;

      // Lifecycle events
      if (payload.stream === 'lifecycle' && payload.data) {
        if (payload.data.phase === 'start') {
          this.setAgentState(agentId, 'executing', 'Working...');
        } else if (payload.data.phase === 'end') {
          this.setAgentState(agentId, 'idle', 'Done!');
        } else if (payload.data.phase === 'error') {
          this.setAgentState(agentId, 'error', 'Error!');
          // Return to idle after a delay
          this.scene.time.delayedCall(3000, () => {
            this.setAgentState(agentId, 'idle');
          });
        }
      }

      // Assistant text output
      if (payload.stream === 'assistant' && payload.data?.text) {
        this.setAgentState(agentId, 'writing', payload.data.text.slice(0, 25));
      }

      // Tool use
      if (payload.stream === 'tool' && payload.data) {
        const toolName = payload.data.name || payload.data.tool || 'tool';
        this.setAgentState(agentId, 'executing', toolName);
      }
    });

    // Chat events
    this.bridge.addEventListener('chat', (evt) => {
      const payload = evt.detail;
      if (!payload) return;

      const agentId = payload.agentId || payload.sessionKey || 'default';
      const binding = this.getOrAssignNpc(agentId, payload.agentName);
      if (!binding) return;

      if (payload.state === 'delta') {
        this.setAgentState(agentId, 'writing', 'Typing...');
      } else if (payload.state === 'final') {
        this.setAgentState(agentId, 'idle', 'Sent!');
      }
    });

    // Presence events
    this.bridge.addEventListener('presence', (evt) => {
      const payload = evt.detail;
      if (!payload) return;
      // Could map presence changes to NPC visibility
    });

    // Connection state
    this.bridge.addEventListener('connected', (evt) => {
      console.log('[NpcAgentCtrl] Gateway connected');
      this._showConnectionStatus(true);
    });

    this.bridge.addEventListener('disconnected', () => {
      console.log('[NpcAgentCtrl] Gateway disconnected');
      this._showConnectionStatus(false);
    });

    // Debug: log all events
    this.bridge.addEventListener('gateway-event', (evt) => {
      const { event, payload } = evt.detail;
      if (event !== 'tick') { // skip noisy heartbeats
        console.log(`[GatewayEvent] ${event}:`, payload);
      }
    });
  }

  /** Show connection status indicator in the game */
  _showConnectionStatus(connected) {
    if (this._statusText) {
      this._statusText.destroy();
    }
    this._statusText = this.scene.add.text(4, 4,
      connected ? 'OpenClaw: Connected' : 'OpenClaw: Disconnected', {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: connected ? '#4ade80' : '#f87171',
      backgroundColor: '#0f172a',
      padding: { x: 3, y: 2 },
    });
    this._statusText.setScrollFactor(0);
    this._statusText.setDepth(9999);
  }
}

window.NpcAgentController = NpcAgentController;
