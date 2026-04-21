/**
 * Agent Office Manager
 * The browser-side brain that coordinates AI agents in the pixel office.
 * Connects to the server's /agent-ws WebSocket for cofounder agent commands.
 */

class AgentOfficeManager {
  /**
   * @param {Phaser.Scene} scene - The office scene
   * @param {AgentActions} actions - The action executor
   */
  constructor(scene, actions) {
    this.scene = scene;
    this.actions = actions;
    this.ws = null;
    this.connected = false;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;

    // Agent registry: npcKey -> { role, name, status, currentTask, assignedDesk }
    this.agents = new Map();

    // Task queue
    this.tasks = [];
    this._taskIdCounter = 0;

    // Desk assignments: deskInstanceId -> npcKey
    this.deskAssignments = new Map();

    // State reporting interval
    this._stateReportInterval = null;

    // Role definitions
    this.ROLES = {
      desk_worker: { label: 'Developer', color: '#4ade80', idleArea: 'desk' },
      researcher: { label: 'Researcher', color: '#60a5fa', idleArea: 'bookshelf' },
      receptionist: { label: 'Receptionist', color: '#f472b6', idleArea: 'reception' },
      it_support: { label: 'IT Support', color: '#fbbf24', idleArea: 'roaming' },
      stock_trader: { label: 'Trader', color: '#a78bfa', idleArea: 'desk' },
      cofounder: { label: 'CTO', color: '#f97316', idleArea: 'roaming' },
      security: { label: 'Security', color: '#ef4444', idleArea: 'reception' },
      project_mgr: { label: 'Project Mgr', color: '#8b5cf6', idleArea: 'roaming' },
      product_mgr: { label: 'Product Mgr', color: '#ec4899', idleArea: 'roaming' },
      qa_engineer: { label: 'QA Engineer', color: '#14b8a6', idleArea: 'desk' },
      devops: { label: 'DevOps', color: '#f59e0b', idleArea: 'desk' },
      designer: { label: 'Designer', color: '#a855f7', idleArea: 'desk' },
      data_engineer: { label: 'Data Engineer', color: '#06b6d4', idleArea: 'desk' },
      intern: { label: 'Intern', color: '#84cc16', idleArea: 'roaming' },
    };

    // Status indicator dots and task labels
    this._statusDots = new Map(); // npcKey -> Phaser.GameObjects.Arc
    this._taskLabels = new Map(); // npcKey -> Phaser.GameObjects.Text

    // NPC key to display name mapping (from shared roster)
    const roster = globalThis.DenizenNpcRoster;
    if (!roster) {
      console.error('[AgentManager] DenizenNpcRoster missing — load src/npc-roster.js before agent-office-manager.js');
    }
    this.NPC_NAMES = roster ? { ...roster.keyToDisplay } : {};
  }

  /**
   * Initialize the agent system
   */
  init() {
    console.log('[AgentManager] Initializing agent office system');

    // Default role assignments
    const defaultRoles = {
      xp_abby: 'cofounder',
      xp_alex: 'desk_worker',
      xp_bob: 'researcher',
      xp_dan: 'it_support',
      xp_jenny: 'desk_worker',
      xp_lucy: 'receptionist',
      xp_bouncer: 'security',
      xp_conference_man: 'project_mgr',
      xp_conference_woman: 'product_mgr',
      xp_edward: 'desk_worker',
      xp_josh: 'desk_worker',
      xp_molly: 'qa_engineer',
      xp_oscar: 'devops',
      xp_pier: 'data_engineer',
      xp_rob: 'designer',
      xp_roki: 'intern',
    };

    // Register agents with their roles
    Object.entries(defaultRoles).forEach(([npcKey, role]) => {
      this.registerAgent(npcKey, role);
    });

    // Assign desks to desk workers
    this._assignDesks();

    // Connect to server WebSocket
    this.connect();

    // Start periodic state reporting (every 10 seconds)
    this._stateReportInterval = this.scene.time.addEvent({
      delay: 10000,
      loop: true,
      callback: () => this._sendOfficeState(),
    });

    // Start initial agent behaviors after a short delay
    this.scene.time.delayedCall(2000, () => {
      this._startInitialBehaviors();
    });
  }

  /**
   * Register an NPC as an agent with a role
   */
  registerAgent(npcKey, role) {
    const name = this.NPC_NAMES[npcKey] || npcKey;
    const roleDef = this.ROLES[role] || this.ROLES.desk_worker;

    this.agents.set(npcKey, {
      npcKey,
      name,
      role,
      roleDef,
      status: 'idle',
      currentTask: null,
      assignedDesk: null,
      lastAction: Date.now(),
    });

    // Show role label
    this.actions.showRoleLabel(npcKey, name, roleDef.label);

    console.log(`[AgentManager] Registered ${name} as ${roleDef.label}`);
  }

  /**
   * Assign available desks to desk-based workers
   */
  _assignDesks() {
    if (!this.scene._interactables) return;

    // Find all desks that have a chair nearby (usable workstations)
    const allDesks = this.scene._interactables.filter(it =>
      it.id && /desk|cubicle/i.test(it.id) && it.def && it.def.type === 'surface'
    );

    // Filter to desks that actually have a chair within range
    const usableDesks = allDesks.filter(desk => {
      return this.actions._findChairNearDesk(desk, 80) !== null;
    });

    // Separate manager office desks from open office desks
    const managerDesks = usableDesks.filter(d => d.sprite.x >= 880 && d.sprite.y <= 240);
    const openDesks = usableDesks.filter(d => d.sprite.x < 880 || d.sprite.y > 240);
    const assignedDeskIds = new Set();

    this.agents.forEach((agent, npcKey) => {
      let deskPool;
      if (agent.role === 'cofounder') {
        // CTO gets a manager office desk, fallback to open office
        deskPool = managerDesks.length > 0 ? managerDesks : openDesks;
      } else {
        // Everyone gets a desk — it's an office, everyone needs a workstation
        deskPool = openDesks;
      }

      // Find first unassigned desk
      const desk = deskPool.find(d => !assignedDeskIds.has(d.instanceId || d.id));
      if (desk) {
        const deskId = desk.instanceId || desk.id;
        agent.assignedDesk = deskId;
        assignedDeskIds.add(deskId);
        this.deskAssignments.set(deskId, npcKey);
        // Store desk position for fallback use in office-scene.js
        const deskObj = this.actions._getFurniture(deskId);
        if (deskObj?.sprite) {
          agent._assignedDeskPos = { x: deskObj.sprite.x, y: deskObj.sprite.y };
        }
        console.log(`[AgentManager] Assigned ${agent.name} to desk ${deskId} (has chair nearby)`);
      }
    });
  }

  /**
   * Start initial agent behaviors — role-based startup + autonomous AI thinking
   */
  _startInitialBehaviors() {
    if (this._demoMode) return;

    // Role-based startup behaviors (existing — NPCs settle into the office)
    this.agents.forEach((agent, npcKey) => {
      switch (agent.role) {
        case 'cofounder':
          if (agent.assignedDesk) {
            // Teleport CTO directly to her private office desk — no walking across office
            this.actions.teleportToDesk(npcKey, agent.assignedDesk);
            agent.status = 'working';
            this.scene.time.delayedCall(5000, () => {
              this.actions.speak(npcKey, 'Good morning team!');
            });
          }
          break;
        case 'desk_worker':
        case 'stock_trader':
        case 'researcher':
        case 'qa_engineer':
        case 'devops':
        case 'designer':
        case 'data_engineer':
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
          break;
        case 'receptionist':
        case 'it_support':
        case 'security':
        case 'project_mgr':
        case 'product_mgr':
        case 'intern':
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
          break;
      }
    });

    // After everyone settles in, start AI think loops (staggered so LM Studio isn't overwhelmed)
    let delay = 15000;
    this.agents.forEach((agent, npcKey) => {
      this.scene.time.delayedCall(delay, () => {
        this._npcThinkLoop(npcKey);
      });
      delay += 4000; // space NPCs 4 seconds apart
    });

    // Update status indicators every 500ms
    this.scene.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this._updateStatusIndicators(),
    });

    // #5 — Per-role ambient routines. Runs every 60s on receptionist +
    // security NPCs so they USE the reception area even when their
    // LM think loop picks 'work'. Keeps Lucy/Pier/Bouncer from glueing
    // to their desks all day.
    this.scene.time.addEvent({
      delay: 60000,
      loop: true,
      callback: () => this._tickRoleRoutines(),
    });

    // #8 — Reception visitor spawn. Every 5 minutes a conference_* NPC
    // walks to the reception area and stands (as if a visitor arrived),
    // giving Lucy a reason to greet them.
    this.scene.time.addEvent({
      delay: 300000,
      loop: true,
      callback: () => this._spawnReceptionVisitor(),
    });
    // Fire one ~45s after startup so the demo has early reception activity.
    this.scene.time.delayedCall(45000, () => this._spawnReceptionVisitor());
  }

  /**
   * #5 — Role-specific ambient routines. Called on a timer so Lucy/Pier/Bouncer
   * actually use reception / patrol instead of always heading to their desk.
   */
  _tickRoleRoutines() {
    if (!this.agents) return;
    this.agents.forEach((agent, npcKey) => {
      if (!agent || agent.status === 'task_override') return;
      const role = (agent.role || '').toLowerCase();
      const isRecept = role === 'receptionist' || agent.name === 'Lucy' || agent.name === 'Pier';
      const isSec = role === 'security' || agent.name === 'Bouncer';
      if (!isRecept && !isSec) return;

      // Only interrupt benign statuses — don't break meetings/reports.
      const interruptible = !agent.status
        || ['working','idle','wandering','break','visiting','reading'].indexOf(agent.status) !== -1;
      if (!interruptible) return;

      if (isRecept) {
        // Alternate between sitting at reception desk and standing to greet.
        const variant = Math.random();
        this.actions.standUp(npcKey);
        if (variant < 0.5) {
          this.actions.goToRoom(npcKey, 'reception');
          agent.status = 'receptionist_patrol';
          this.scene.time.delayedCall(2500, () => {
            this.actions.speak(npcKey, 'Let me know if you need anything.');
          });
        } else {
          this.actions.goToRoom(npcKey, 'reception');
          agent.status = 'receptionist_patrol';
          this.scene.time.delayedCall(2500, () => {
            this.actions.emote(npcKey, 'wave');
          });
        }
        this.scene.time.delayedCall(14000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
      } else if (isSec) {
        // Security patrol loop: reception → open_office → reception → desk.
        this.actions.standUp(npcKey);
        agent.status = 'patrolling';
        this.actions.goToRoom(npcKey, 'reception');
        this.scene.time.delayedCall(6000, () => {
          this.actions.goToRoom(npcKey, 'open_office');
        });
        this.scene.time.delayedCall(14000, () => {
          this.actions.goToRoom(npcKey, 'reception');
        });
        this.scene.time.delayedCall(22000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
      }
    });
  }

  /**
   * #8 — Scripted "visitor arrives" moment. Picks a non-core NPC
   * (conference_man or conference_woman if free) to walk into reception
   * and stand, giving receptionist NPCs something real to react to.
   */
  _spawnReceptionVisitor() {
    if (!this.agents) return;
    const candidates = ['xp_conference_man', 'xp_conference_woman'];
    for (const key of candidates) {
      const agent = this.agents.get(key);
      if (!agent) continue;
      if (agent.status === 'task_override') continue;
      // Skip if already visiting
      if (agent.status === 'visitor_arrival') return;

      this.actions.standUp(key);
      agent.status = 'visitor_arrival';
      // Walk to reception center
      this.actions.goToRoom(key, 'reception');
      this.scene.time.delayedCall(3500, () => {
        this.actions.emote(key, 'wave');
        this.actions.speak(key, 'Hi, I\'m here for a meeting.');
      });
      // Nudge the receptionists to greet by name
      const lucyKey = 'xp_lucy';
      if (this.agents.get(lucyKey)) {
        this.scene.time.delayedCall(5000, () => {
          this.actions.standUp(lucyKey);
          this.actions.goToRoom(lucyKey, 'reception');
          this.scene.time.delayedCall(3500, () => {
            this.actions.speak(lucyKey, 'Welcome! Let me check you in.');
          });
        });
      }
      // Visitor wanders off (heads to conference) after a bit
      this.scene.time.delayedCall(16000, () => {
        this.actions.goToRoom(key, 'conference');
        agent.status = 'working';
      });
      return;
    }
  }

  /**
   * Update visual status indicators (colored dots + task labels) above each NPC
   */
  _updateStatusIndicators() {
    this.agents.forEach((agent, npcKey) => {
      const npc = this.actions._getNpc(npcKey);
      if (!npc) return;

      // Status dot color based on agent status
      const colors = {
        working: 0x4ade80,    // green
        talking: 0x60a5fa,    // blue
        collaborating: 0x60a5fa,
        break: 0xfbbf24,      // yellow
        meeting: 0xa855f7,    // purple
        error: 0xef4444,      // red
        idle: 0x94a3b8,       // gray
        checking: 0x06b6d4,   // cyan
        reporting: 0xf97316,  // orange
      };
      const color = colors[agent.status] || colors.idle;

      // Create or update dot
      let dot = this._statusDots.get(npcKey);
      if (!dot) {
        dot = this.scene.add.circle(0, 0, 3, color);
        dot.setDepth(9999);
        this._statusDots.set(npcKey, dot);
      }
      dot.setFillStyle(color);
      dot.setPosition(npc.x, npc.y - 56);
      dot.setVisible(true);

      // Task label — only show if NPC has an active task
      let label = this._taskLabels.get(npcKey);
      if (agent._taskLabel) {
        if (!label) {
          label = this.scene.add.text(0, 0, '', {
            fontSize: '6px',
            fontFamily: 'monospace',
            color: '#94a3b8',
            backgroundColor: '#0f172a80',
            padding: { x: 2, y: 1 },
          });
          label.setDepth(9998);
          label.setOrigin(0.5, 1);
          this._taskLabels.set(npcKey, label);
        }
        label.setText(agent._taskLabel.slice(0, 25));
        label.setPosition(npc.x, npc.y - 58);
        label.setVisible(true);
      } else if (label) {
        label.setVisible(false);
      }
    });
  }

  /**
   * Autonomous NPC think loop — each NPC periodically asks LM Studio what to do next.
   * Replaces all hardcoded patrol/checkin/wander behaviors.
   */
  _npcThinkLoop(npcKey) {
    const agent = this.agents.get(npcKey);
    if (!agent) return;
    if (agent.status === 'task_override') {
      // Server command took over — check again later
      this.scene.time.delayedCall(15000, () => this._npcThinkLoop(npcKey));
      return;
    }

    // Build office context for the NPC
    const nearbyNpcs = [];
    this.agents.forEach((a, k) => {
      if (k !== npcKey) {
        nearbyNpcs.push(`${a.name} (${a.role}) — ${a.status || 'idle'}`);
      }
    });

    // #4 — Compute nearby furniture so the NPC can pick concrete destinations.
    // Sample the 5 closest interactables to the NPC's current position.
    const nearbyFurniture = this._computeNearbyFurniture(npcKey, 5);

    const context = {
      description: `Office time: ${new Date().toLocaleTimeString()}. Your status: ${agent.status || 'idle'}. ` +
        `Nearby coworkers: ${nearbyNpcs.join(', ')}.`,
      nearbyFurniture,
    };

    // Ask server for NPC's decision
    this._send({
      type: 'npc_think',
      npcName: agent.name,
      context,
    });

    // The response comes back as 'npc_decision' in _handleServerMessage
    // Schedule next think cycle (30-45 seconds) — more active NPCs, still comfortable for the queue
    const nextDelay = 30000 + Math.random() * 15000;
    this.scene.time.delayedCall(nextDelay, () => this._npcThinkLoop(npcKey));
  }

  /**
   * #4 — Return short human-readable labels for the N closest interactables
   * to a given NPC. Used in the think prompt so the model can pick concrete
   * destinations ("coffee machine 40px away") instead of vague "work".
   */
  _computeNearbyFurniture(npcKey, maxItems = 5) {
    const npc = this.scene?.npcs?.find(n => n.npcKey === npcKey)
      || (this.scene?.npcs || []).find(n => n._npcKey === npcKey)
      || null;
    // Fallback: the scene stores npcs by texture key, so look there too.
    const sprite = npc || (Array.isArray(this.scene?.npcs) ? this.scene.npcs.find(n => n.texture?.key === npcKey) : null);
    if (!sprite) return [];
    const items = Array.isArray(this.scene?._interactables) ? this.scene._interactables : [];
    if (items.length === 0) return [];
    const scored = [];
    for (const it of items) {
      if (!it || !it.sprite || !it.id) continue;
      const d = Math.hypot(it.sprite.x - sprite.x, it.sprite.y - sprite.y);
      // Build a friendly short label
      let kind = 'object';
      const id = String(it.id);
      if (/coffee|espresso|kettle/i.test(id)) kind = 'coffee machine';
      else if (/vending|snack/i.test(id))      kind = 'vending machine';
      else if (/fridge|microwave/i.test(id))   kind = 'kitchen appliance';
      else if (/bookshelf|shelf|bookcase/i.test(id)) kind = 'bookshelf';
      else if (/printer|copier/i.test(id))     kind = 'printer';
      else if (/couch|sofa/i.test(id))         kind = 'couch';
      else if (/desk/i.test(id))               kind = 'desk';
      else if (/chair|seat|stool/i.test(id))   kind = 'chair';
      else if (/whiteboard|board/i.test(id))   kind = 'whiteboard';
      else if (/plant|pot/i.test(id))          continue; // decor clutter
      else continue; // skip anything we can't label usefully
      scored.push({ kind, d });
    }
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, maxItems).map(s => `${s.kind} (${Math.round(s.d)}px)`);
  }

  /**
   * Execute an NPC's autonomous decision from LM Studio
   */
  _executeNpcDecision(npcName, decision) {
    // Find the NPC key from name
    const npcKey = Object.entries(this.NPC_NAMES).find(
      ([k, v]) => v.toLowerCase() === npcName?.toLowerCase()
    )?.[0];
    if (!npcKey) return;

    const agent = this.agents.get(npcKey);
    if (!agent || agent.status === 'task_override') return;

    const thought = decision.thought || '';
    const action = decision.action || 'work';
    const target = decision.target || null;
    const location = decision.location || null;
    const message = decision.message || '';

    // Track task label for visual display
    if (decision.taskPhase === 'starting' && message) {
      agent._taskLabel = message.slice(0, 30);
    } else if (decision.taskPhase === 'finished') {
      agent._taskLabel = null;
    } else if (action === 'work' && message && message !== 'Working...') {
      agent._taskLabel = message.slice(0, 30);
    }

    console.log(`[NPC Think] ${npcName}: "${thought}" → ${action}${target ? ` → ${target}` : ''}${location ? ` @ ${location}` : ''}`);

    // Show thought bubble briefly
    if (thought) {
      this.actions.think(npcKey, thought);
    }

    // Helper: find target NPC key
    const findTargetKey = (name) => name ? Object.entries(this.NPC_NAMES).find(
      ([k, v]) => v.toLowerCase() === name.toLowerCase()
    )?.[0] : null;

    // Helper: move to a location. Extended to cover every room in the map
    // so NPCs can actually pick manager_office, reception, and open_office
    // from the think prompt.
    const goToLocation = (key, loc) => {
      if (loc === 'breakroom')           this.actions.goToBreakroom(key);
      else if (loc === 'conference')     this.actions.goToRoom(key, 'conference');
      else if (loc === 'storage')        this.actions.goToRoom(key, 'storage');
      else if (loc === 'manager_office') this.actions.goToRoom(key, 'manager_office');
      else if (loc === 'reception')      this.actions.goToRoom(key, 'reception');
      else if (loc === 'open_office')    this.actions.goToRoom(key, 'open_office');
      else if (loc === 'desk' && this.agents.get(key)?.assignedDesk) {
        this.actions.useComputer(key, this.agents.get(key).assignedDesk);
      }
    };

    switch (action) {
      case 'talk': {
        agent.status = 'talking';
        const targetKey = findTargetKey(target);
        if (targetKey && message) {
          this.actions.standUp(npcKey);
          // Fire the server request the moment the speaker arrives and the
          // opening bubble is shown (speakTo resolves after that happens).
          this.actions.speakTo(npcKey, targetKey, message).then(() => {
            this._send({
              type: 'npc_conversation',
              npcName: target,
              fromName: npcName,
              text: message,
              turn: 1,
            });
          });
        } else if (message) {
          this.actions.speak(npcKey, message);
        }
        break;
      }

      case 'collaborate': {
        // Two NPCs go to a location together and have a conversation
        const targetKey = findTargetKey(target);
        if (targetKey && message) {
          this.actions.standUp(npcKey);
          this.actions.standUp(targetKey);
          agent.status = 'collaborating';

          const targetAgent = this.agents.get(targetKey);
          if (targetAgent) targetAgent.status = 'collaborating';

          // Both walk to the location
          if (location && location !== 'desk') {
            goToLocation(npcKey, location);
            this.scene.time.delayedCall(1000, () => goToLocation(targetKey, location));
          }

          // Initiator speaks first, then server is notified on arrival
          this.scene.time.delayedCall(3000, () => {
            this.actions.speakTo(npcKey, targetKey, message).then(() => {
              this._send({
                type: 'npc_conversation',
                npcName: target,
                fromName: npcName,
                text: message,
                turn: 1,
              });
            });
          });

          // Both return to desks after collaboration
          this.scene.time.delayedCall(20000, () => {
            if (agent.assignedDesk) {
              this.actions.useComputer(npcKey, agent.assignedDesk);
              agent.status = 'working';
            }
            if (targetAgent?.assignedDesk) {
              this.actions.useComputer(targetKey, targetAgent.assignedDesk);
              targetAgent.status = 'working';
            }
          });
        }
        break;
      }

      case 'work':
        // #6 — Ambient wander: 30% of the time, if the NPC picks "work"
        // without a fresh task/message, they take a short detour to a
        // random nearby room before settling. Adds motion across the map
        // instead of 16 NPCs glued to their desks.
        if (agent.assignedDesk) {
          const noTask = !message || message === 'Working...';
          if (noTask && Math.random() < 0.3) {
            this.actions.standUp(npcKey);
            const rooms = ['open_office', 'breakroom', 'reception', 'storage', 'conference'];
            const pick = rooms[Math.floor(Math.random() * rooms.length)];
            goToLocation(npcKey, pick);
            agent.status = 'wandering';
            // Return to desk after the ambient walk
            this.scene.time.delayedCall(9000, () => {
              if (agent.assignedDesk) {
                this.actions.useComputer(npcKey, agent.assignedDesk);
                agent.status = 'working';
              }
            });
          } else {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        } else {
          // No desk — go to breakroom rather than random center clustering
          const wx = 80 + Math.random() * 150;
          const wy = 520 + Math.random() * 80;
          this.actions.walkTo(npcKey, wx, wy);
          agent.status = 'working';
        }
        if (message) {
          this.scene.time.delayedCall(1500, () => {
            this.actions.speak(npcKey, message);
          });
        }
        break;

      case 'break': {
        this.actions.standUp(npcKey);
        agent.status = 'break';

        // If targeting someone, invite them along
        const breakTargetKey = findTargetKey(target);
        if (breakTargetKey) {
          this.actions.standUp(breakTargetKey);
          const breakTargetAgent = this.agents.get(breakTargetKey);
          if (breakTargetAgent) breakTargetAgent.status = 'break';
          this.actions.goToBreakroom(breakTargetKey);
        }

        this.actions.goToBreakroom(npcKey);

        if (message) {
          this.scene.time.delayedCall(3000, () => {
            if (breakTargetKey) {
              this.actions.speakTo(npcKey, breakTargetKey, message);
              // Get AI response from break partner
              this.scene.time.delayedCall(2000, () => {
                this._send({
                  type: 'npc_conversation',
                  npcName: target,
                  fromName: npcName,
                  text: message,
                });
              });
            } else {
              this.actions.speak(npcKey, message);
            }
          });
        }

        // Return to desk after break (~30s)
        this.scene.time.delayedCall(30000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          } else {
            agent.status = 'idle';
          }
          if (breakTargetKey) {
            const bta = this.agents.get(breakTargetKey);
            if (bta?.assignedDesk) {
              this.actions.useComputer(breakTargetKey, bta.assignedDesk);
              bta.status = 'working';
            } else if (bta) {
              bta.status = 'idle';
            }
          }
        });
        break;
      }

      case 'check':
        this.actions.standUp(npcKey);
        agent.status = 'checking';
        if (location) {
          goToLocation(npcKey, location);
        } else if (message?.toLowerCase().includes('server')) {
          this.actions.goToRoom(npcKey, 'storage');
        } else if (message?.toLowerCase().includes('research')) {
          this.actions.checkBookshelf(npcKey);
        } else {
          this.actions.goToRoom(npcKey, 'open_office');
        }
        if (message) {
          this.scene.time.delayedCall(2000, () => {
            this.actions.speak(npcKey, message);
          });
        }
        // Return to desk after
        this.scene.time.delayedCall(12000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;

      case 'report': {
        // Task completion — visual "clock out" to manager
        const reportTargetKey = findTargetKey(target);
        this.actions.standUp(npcKey);
        agent.status = 'reporting';
        this.actions.emote(npcKey, '!');

        if (reportTargetKey) {
          // Walk toward manager, then speak
          this.scene.time.delayedCall(1500, () => {
            this.actions.speakTo(npcKey, reportTargetKey, message || 'Task complete.');
            // Request AI response from the manager
            this.scene.time.delayedCall(2000, () => {
              this._send({
                type: 'npc_conversation',
                npcName: target,
                fromName: npcName,
                text: message || 'Task complete.',
              });
            });
          });
        } else if (message) {
          this.scene.time.delayedCall(1500, () => {
            this.actions.speak(npcKey, message);
          });
        }

        // Return to desk after reporting
        this.scene.time.delayedCall(15000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'error': {
        // API error — NPC goes to breakroom to "reset"
        this.actions.emote(npcKey, '!');
        agent.status = 'error';

        this.scene.time.delayedCall(1000, () => {
          this.actions.standUp(npcKey);
        });

        this.scene.time.delayedCall(2000, () => {
          this.actions.goToBreakroom(npcKey);
        });

        // Show truncated error message as speech once in breakroom
        this.scene.time.delayedCall(5000, () => {
          const errorText = (message || 'Error').slice(0, 80) + ' — taking a break';
          this.actions.speak(npcKey, errorText);
        });

        // After 20 seconds, walk back to desk and resume
        this.scene.time.delayedCall(20000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          } else {
            agent.status = 'idle';
          }
        });
        break;
      }

      case 'read': {
        // Walk to the bookshelf and read. Represents research / looking things up.
        agent.status = 'reading';
        this.actions.standUp(npcKey);
        this.actions.checkBookshelf(npcKey);
        if (message) {
          this.scene.time.delayedCall(2500, () => this.actions.think(npcKey, message));
        }
        // Return to desk after a reading cycle
        this.scene.time.delayedCall(18000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'visit': {
        // Drop-by check-in — walk to coworker's desk without necessarily talking.
        const visitTargetKey = findTargetKey(target);
        if (!visitTargetKey) break;
        agent.status = 'visiting';
        this.actions.standUp(npcKey);
        this.actions.visit(npcKey, visitTargetKey);
        if (message) {
          this.scene.time.delayedCall(2500, () => {
            this.actions.speakTo(npcKey, visitTargetKey, message);
          });
        }
        // Return to desk after a short visit
        this.scene.time.delayedCall(14000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'coffee': {
        // Grab a coffee / snack. Short breakroom hop.
        agent.status = 'break';
        this.actions.standUp(npcKey);
        this.actions.goToCoffee(npcKey);
        if (message) {
          this.scene.time.delayedCall(3000, () => this.actions.speak(npcKey, message));
        }
        this.scene.time.delayedCall(12000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'wander': {
        // Stretch the legs — walk to the NPC's natural hangout room, or a
        // random room if location is unspecified. Used sparingly by the model.
        agent.status = 'wandering';
        this.actions.standUp(npcKey);
        const wanderRooms = ['open_office', 'breakroom', 'conference', 'reception', 'storage', 'manager_office'];
        const pick = location && wanderRooms.indexOf(location) !== -1
          ? location
          : wanderRooms[Math.floor(Math.random() * wanderRooms.length)];
        goToLocation(npcKey, pick);
        if (message) {
          this.scene.time.delayedCall(3500, () => this.actions.speak(npcKey, message));
        }
        this.scene.time.delayedCall(12000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'meeting':
        agent.status = 'meeting';
        this.actions.standUp(npcKey);
        if (message) {
          this.actions.speak(npcKey, message);
        }
        // Actually walk to the conference room and join meeting
        this.actions.joinMeeting(npcKey);
        // Return to desk after meeting (~25s)
        this.scene.time.delayedCall(25000, () => {
          agent.status = 'working';
          agent._taskLabel = null;
          this.actions.standUp(npcKey);
          const deskId = this._deskAssignments?.get(npcKey);
          if (deskId) {
            this.actions.useComputer(npcKey, deskId);
          }
        });
        break;

      default:
        if (agent.assignedDesk) {
          this.actions.useComputer(npcKey, agent.assignedDesk);
          agent.status = 'working';
        }
    }
  }

  // ---- WebSocket Connection ----

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Connect to same host/port as the page (server.js serves both HTTP and WS)
    const url = `${protocol}//${window.location.host}/agent-ws`;

    console.log('[AgentManager] Connecting to', url);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.warn('[AgentManager] WebSocket creation failed:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[AgentManager] Connected to agent WebSocket');
      this.connected = true;
      this._reconnectAttempt = 0;

      // Send initial office state
      this._sendOfficeState();
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this._handleServerMessage(msg);
      } catch (err) {
        console.warn('[AgentManager] Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('[AgentManager] WebSocket closed');
      this.connected = false;
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('[AgentManager] WebSocket error:', err);
    };
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(2000 * Math.pow(2, this._reconnectAttempt), 30000);
    this._reconnectAttempt++;
    console.log(`[AgentManager] Reconnecting in ${delay}ms`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Send a message to the server
   */
  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Handle messages from the server (cofounder agent commands)
   */
  _handleServerMessage(msg) {
    // In demo mode, only handle player_chat_response — block all other server commands
    if (this._demoMode && msg.type !== 'player_chat_response') return;
    console.log('[AgentManager] Server message:', msg.type, msg);

    switch (msg.type) {
      case 'agent_command':
        this._executeAgentCommand(msg);
        break;
      case 'spawn_agent':
        this._spawnAgent(msg);
        break;
      case 'cofounder_speak':
        this._cofounderSpeak(msg);
        break;
      case 'assign_task':
        this._assignTask(msg);
        break;
      case 'office_update':
        // Server sending office layout changes
        break;
      case 'npc_response': {
        // An NPC's brain generated a response — show it as speech
        const responderKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        const originalSpeakerKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.fromName?.toLowerCase()
        )?.[0];

        if (responderKey) {
          this.actions.speak(responderKey, msg.text);
          console.log(`[AgentManager] ${msg.npcName} responds to ${msg.fromName}: "${msg.text}"`);
        }

        // Reply-back loop: if we're under the turn cap, have the original
        // speaker say something back. Creates a natural two-way conversation
        // instead of the one-shot "A speaks, B replies" we had before.
        // Raised from 2 to 4 — gives conversations room to actually exchange
        // ideas instead of A-speaks/B-replies/done. NPCs can now follow up,
        // disagree, or build on each other's lines across 4 turns.
        const MAX_CHAT_TURNS = 4;
        const currentTurn = typeof msg.turn === 'number' ? msg.turn : 1;
        const canReplyBack =
          responderKey &&
          originalSpeakerKey &&
          msg.text &&
          !msg.text.toLowerCase().includes('no reply') &&
          currentTurn < MAX_CHAT_TURNS;

        if (canReplyBack) {
          // Small beat so the responder's bubble is visible before the next
          // request fires (server adds its own delay before the response bubble).
          this.scene.time.delayedCall(1800, () => {
            // Responder now becomes the speaker — walks to and addresses the
            // original speaker with their just-generated line.
            this.actions.speakTo(responderKey, originalSpeakerKey, msg.text).then(() => {
              this._send({
                type: 'npc_conversation',
                npcName: msg.fromName,   // original speaker is now the target
                fromName: msg.npcName,   // responder is now the speaker
                text: msg.text,
                turn: currentTurn + 1,
              });
            }).catch(() => {
              // NPC destroyed or scene torn down — conversation dies silently, no retry.
            });
          });
        }
        break;
      }
      case 'npc_decision': {
        // NPC's autonomous decision from LM Studio think loop
        this._executeNpcDecision(msg.npcName, msg.decision || {});
        break;
      }
      case 'npc_cascade': {
        // A leader's decision cascading down to a report
        const cascadeTargetKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        const cascadeFromKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.fromName?.toLowerCase()
        )?.[0];
        if (cascadeTargetKey && cascadeFromKey && msg.message) {
          // The leader speaks to the report, then request a reply on arrival
          console.log('[Cascade] ' + msg.fromName + ' -> ' + msg.npcName + ': "' + msg.message + '"');
          this.actions.speakTo(cascadeFromKey, cascadeTargetKey, msg.message).then(() => {
            this._send({
              type: 'npc_conversation',
              npcName: msg.npcName,
              fromName: msg.fromName,
              text: msg.message,
              turn: 1,
            });
          });
        }
        break;
      }
      case 'player_chat_response': {
        // NPC responding to the CEO (player) — route to PlayerChat UI
        const respondingKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];

        // Tell PlayerChat whether there are actions (so it knows whether to auto-resume)
        const hasActions = Array.isArray(msg.actions) && msg.actions.length > 0;
        if (this.scene._playerChat) {
          this.scene._playerChat._hasActions = hasActions;
          this.scene._playerChat.handleNpcResponse(msg.npcName, msg.text, msg.delegation);
        } else if (respondingKey) {
          this.actions.speak(respondingKey, msg.text);
        }

        // Execute any actions the NPC decided to take
        if (respondingKey && hasActions) {
          this._executeNpcActions(respondingKey, msg.npcName, msg.actions);
        }

        console.log(`[AgentManager] ${msg.npcName} responds to CEO: "${msg.text}"${msg.delegation ? ` [delegating to ${msg.delegation.delegateTo}]` : ''}${msg.actions?.length ? ` [${msg.actions.length} actions]` : ''}`);
        break;
      }
      case 'agent_error': {
        // CofounderAgent hit an error — show the NPC going to breakroom
        const errorAgentKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.agentId?.toLowerCase()
        )?.[0];
        if (errorAgentKey) {
          const errorAgent = this.agents.get(errorAgentKey);
          if (errorAgent && errorAgent.status !== 'error') {
            errorAgent.status = 'error';
            this.actions.emote(errorAgentKey, '!');
            this.scene.time.delayedCall(1000, () => {
              this.actions.standUp(errorAgentKey);
            });
            this.scene.time.delayedCall(2000, () => {
              this.actions.goToBreakroom(errorAgentKey);
            });
            this.scene.time.delayedCall(5000, () => {
              const errText = (msg.message || 'API error').slice(0, 60) + ' — resetting';
              this.actions.speak(errorAgentKey, errText);
            });
            // Return to desk after 20 seconds
            this.scene.time.delayedCall(20000, () => {
              if (errorAgent.assignedDesk) {
                this.actions.useComputer(errorAgentKey, errorAgent.assignedDesk);
              }
              errorAgent.status = 'idle';
            });
          }
        }
        break;
      }
      default:
        console.log('[AgentManager] Unknown message type:', msg.type);
    }
  }

  /**
   * Execute a command from the cofounder agent
   */
  _executeAgentCommand(msg) {
    const { agentId, action, params } = msg;

    // Map agentId to npcKey
    let npcKey = null;
    if (agentId === 'cofounder') {
      npcKey = this._findNpcByRole('cofounder');
    } else {
      // Try matching by name
      npcKey = Object.entries(this.NPC_NAMES).find(
        ([k, v]) => v.toLowerCase() === agentId?.toLowerCase()
      )?.[0];
      if (!npcKey) npcKey = `xp_${agentId}`;
    }

    if (!npcKey) {
      console.warn(`[AgentManager] Unknown agent: ${agentId}`);
      return;
    }

    // Mark NPC as under CofounderAgent control — prevents think loop conflicts
    const agent = this.agents.get(npcKey);
    if (agent && action !== 'speak' && action !== 'think' && action !== 'emote') {
      agent.status = 'task_override';
      // Release after 15 seconds so think loop can resume
      this.scene.time.delayedCall(15000, () => {
        if (agent.status === 'task_override') agent.status = 'idle';
      });
    }

    switch (action) {
      case 'walkTo':
        this.actions.walkTo(npcKey, params.x, params.y);
        break;
      case 'speak':
        this.actions.speak(npcKey, params.text);
        break;
      case 'think':
        this.actions.think(npcKey, params.text);
        break;
      case 'emote':
        this.actions.emote(npcKey, params.type);
        break;
      case 'useComputer':
        this.actions.useComputer(npcKey, params.deskId || this.agents.get(npcKey)?.assignedDesk);
        break;
      case 'checkBookshelf':
        this.actions.checkBookshelf(npcKey, params.shelfId);
        break;
      case 'goToBreakroom':
        this.actions.goToBreakroom(npcKey);
        break;
      case 'reportToCEO':
        this.actions.reportToCEO(npcKey);
        break;
      case 'sitAt':
        this.actions.sitAt(npcKey, params.furnitureId);
        break;
      case 'standUp':
        this.actions.standUp(npcKey);
        break;
      case 'assignTask':
        this._assignTaskToAgent(params.targetAgent, params.task, params.desk);
        break;
      case 'setIdle':
        this.actions.setIdle(npcKey);
        break;
      case 'speakTo': {
        // Stagger speech so bubbles don't overlap; decrement when speakTo finishes
        // (do not reset the counter on a fixed 1s timer — that overlapped pending staggered calls)
        this._speechQueue = this._speechQueue || 0;
        const staggerDelay = this._speechQueue * 3500; // 3.5s between speeches
        this._speechQueue++;

        const targetName = params.target || params.targetAgent;
        const targetKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === targetName?.toLowerCase()
        )?.[0] || `xp_${targetName?.toLowerCase()}`;

        const releaseSpeechSlot = () => {
          this._speechQueue = Math.max(0, (this._speechQueue || 0) - 1);
        };

        this.scene.time.delayedCall(staggerDelay, () => {
          const speakPromise = this.actions.speakTo(npcKey, targetKey, params.text);
          if (speakPromise && typeof speakPromise.then === 'function') {
            speakPromise.then(releaseSpeechSlot).catch(releaseSpeechSlot);
          } else {
            releaseSpeechSlot();
          }

          // Request a response from the target NPC's brain
          const speakerName = this.NPC_NAMES[npcKey] || agentId;
          if (targetName) {
            this.scene.time.delayedCall(2500, () => {
              this._send({
                type: 'npc_conversation',
                npcName: targetName,
                fromName: speakerName,
                text: params.text,
              });
            });
          }
        });
        break;
      }
      case 'goToRoom':
        this.actions.goToRoom(npcKey, params.room || params.roomKey);
        break;
      case 'joinMeeting':
        this.actions.joinMeeting(npcKey);
        break;
      case 'attendMeeting':
        this.actions.attendMeeting(npcKey);
        break;
      case 'leaveMeeting':
        this.actions.leaveMeeting(npcKey);
        break;
      case 'callMeeting': {
        // Leadership sits in chairs, lower-rank staff stands in rows
        const CHAIR_RANKS = new Set([
          'abby', 'marcus', 'sarah', 'alex', 'jenny', 'bob', 'dan'
        ]);
        const attendees = params.attendees || [];

        // Caller (usually leadership) sits
        const callerName = (this.NPC_NAMES[npcKey] || '').toLowerCase();
        if (CHAIR_RANKS.has(callerName)) {
          this.actions.joinMeeting(npcKey);
        } else {
          this.actions.attendMeeting(npcKey);
        }

        // Route each attendee: leaders sit, others stand
        const meetingNpcKeys = [npcKey];
        attendees.forEach((name, i) => {
          const aKey = Object.entries(this.NPC_NAMES).find(
            ([k, v]) => v.toLowerCase() === name.toLowerCase()
          )?.[0];
          if (aKey) {
            meetingNpcKeys.push(aKey);
            const isLeader = CHAIR_RANKS.has(name.toLowerCase());
            setTimeout(() => {
              if (isLeader) {
                this.actions.joinMeeting(aKey);
              } else {
                this.actions.attendMeeting(aKey);
              }
            }, (i + 1) * 1500);
          }
        });

        // Auto-end meeting after 30 seconds — everyone stands and returns to desks
        if (this._meetingTimeout) clearTimeout(this._meetingTimeout);
        this._meetingTimeout = setTimeout(() => {
          meetingNpcKeys.forEach(key => {
            this.actions.leaveMeeting(key);
            const agent = this.agents.get(key);
            if (agent?.assignedDesk) {
              setTimeout(() => this.actions.useComputer(key, agent.assignedDesk), 1500);
            }
          });
          this._meetingTimeout = null;
        }, 30000);
        break;
      }
    }
  }

  /**
   * Assign a task to a worker agent
   */
  _assignTaskToAgent(targetAgentName, taskType, deskId) {
    const npcKey = Object.entries(this.NPC_NAMES).find(
      ([k, v]) => v.toLowerCase() === targetAgentName?.toLowerCase()
    )?.[0];

    if (!npcKey) {
      console.warn(`[AgentManager] Cannot assign task: unknown agent ${targetAgentName}`);
      return;
    }

    const agent = this.agents.get(npcKey);
    if (!agent) return;

    agent.status = 'task_override';
    agent.currentTask = taskType;

    const taskId = `task_${++this._taskIdCounter}`;
    const task = { id: taskId, type: taskType, agent: npcKey, desk: deskId, startedAt: Date.now() };
    this.tasks.push(task);

    // Execute task based on type
    switch (taskType) {
      case 'research':
        this.actions.speak(npcKey, `Starting research task...`);
        this.actions.checkBookshelf(npcKey);
        // After some time at bookshelf, go to desk
        this.scene.time.delayedCall(15000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            this.actions.speak(npcKey, 'Writing up findings...');
          }
          this.scene.time.delayedCall(20000, () => {
            this._completeTask(taskId);
          });
        });
        break;
      case 'code':
      case 'development':
        this.actions.speak(npcKey, 'Working on code...');
        if (agent.assignedDesk || deskId) {
          this.actions.useComputer(npcKey, deskId || agent.assignedDesk);
        }
        this.scene.time.delayedCall(30000, () => {
          this._completeTask(taskId);
        });
        break;
      case 'stock_monitoring':
        this.actions.speak(npcKey, 'Monitoring markets...');
        if (agent.assignedDesk || deskId) {
          this.actions.useComputer(npcKey, deskId || agent.assignedDesk);
        }
        break;
      default:
        this.actions.speak(npcKey, `Working on: ${taskType}`);
        if (agent.assignedDesk) {
          this.actions.useComputer(npcKey, agent.assignedDesk);
        }
        this.scene.time.delayedCall(20000, () => {
          this._completeTask(taskId);
        });
    }
  }

  /**
   * Complete a task
   */
  _completeTask(taskId) {
    const taskIdx = this.tasks.findIndex(t => t.id === taskId);
    if (taskIdx === -1) return;

    const task = this.tasks[taskIdx];
    this.tasks.splice(taskIdx, 1);

    const agent = this.agents.get(task.agent);
    if (agent) {
      agent.status = 'idle';
      agent.currentTask = null;
      this.actions.speak(task.agent, 'Task complete!');
      this.actions.emote(task.agent, 'done');
    }

    // Notify server
    this._send({
      type: 'task_complete',
      agentId: task.agent,
      taskId: task.id,
      taskType: task.type,
    });
  }

  /**
   * Handle cofounder speaking (from server AI)
   */
  _cofounderSpeak(msg) {
    const cofKey = this._findNpcByRole('cofounder');
    if (cofKey) {
      this.actions.speak(cofKey, msg.text);
    }
  }

  /**
   * Handle task assignment from server
   */
  _assignTask(msg) {
    this._assignTaskToAgent(msg.targetAgent, msg.task, msg.desk);
  }

  /**
   * Spawn a new agent (reuse an idle NPC)
   */
  _spawnAgent(msg) {
    const { agentId, role } = msg;
    // Find an idle NPC that isn't strongly assigned
    const idleEntry = Array.from(this.agents.entries()).find(
      ([k, a]) => a.status === 'idle' && a.role === 'desk_worker'
    );

    if (idleEntry) {
      const [npcKey] = idleEntry;
      this.registerAgent(npcKey, role);
      this.actions.speak(npcKey, `New role: ${this.ROLES[role]?.label || role}`);
      this.actions.emote(npcKey, 'star');
    } else {
      console.warn('[AgentManager] No available NPCs to spawn new agent');
    }
  }

  /**
   * Find NPC key by role
   */
  _findNpcByRole(role) {
    for (const [npcKey, agent] of this.agents) {
      if (agent.role === role) return npcKey;
    }
    return null;
  }

  /**
   * Execute actions that an NPC decided to take after talking to the CEO.
   * Actions come from the NPC brain as parsed [ACTION:...] tags.
   */
  _executeNpcActions(npcKey, npcName, actions) {
    let delay = 2000; // Start actions after speech bubble shows

    actions.forEach(act => {
      this.scene.time.delayedCall(delay, () => {
        console.log(`[AgentManager] ${npcName} executing: ${act.action}`, act.params);

        switch (act.action) {
          case 'useComputer': {
            const agent = this.agents.get(npcKey);
            this.actions.useComputer(npcKey, agent?.assignedDesk);
            break;
          }
          case 'goToBreakroom':
            this.actions.goToBreakroom(npcKey);
            break;

          case 'goToRoom': {
            const room = act.params[0] || 'open_office';
            this.actions.goToRoom(npcKey, room);
            break;
          }
          case 'checkBookshelf':
            this.actions.checkBookshelf(npcKey);
            break;

          case 'standUp':
            this.actions.standUp(npcKey);
            break;

          case 'speakTo': {
            const targetName = act.params[0];
            const spkText = act.params[1] || 'Hey, got a minute?';
            const targetKey = Object.entries(this.NPC_NAMES).find(
              ([k, v]) => v.toLowerCase() === targetName?.toLowerCase()
            )?.[0] || `xp_${targetName?.toLowerCase()}`;

            this.actions.speakTo(npcKey, targetKey, spkText);

            // Also send to NPC brain so the target can respond
            this.scene.time.delayedCall(3000, () => {
              this._send({
                type: 'npc_conversation',
                npcName: targetName,
                fromName: npcName,
                text: spkText,
              });
            });
            break;
          }
          case 'callMeeting': {
            const attendeeStr = act.params[0] || '';
            const attendees = attendeeStr.split(',').map(n => n.trim()).filter(Boolean);
            this._executeAgentCommand({
              agentId: npcName,
              action: 'callMeeting',
              params: { attendees },
            });
            break;
          }
          default:
            console.log(`[AgentManager] Unknown NPC action: ${act.action}`);
        }
      });
      delay += 2500; // Stagger multiple actions
    });
  }

  /**
   * Handle CEO (player) speaking to agents
   */
  ceoSpeak(text) {
    this._send({
      type: 'ceo_speak',
      text,
      timestamp: Date.now(),
    });
  }

  /**
   * Send current office state to server
   */
  _sendOfficeState() {
    if (!this.connected) return;

    const agentList = [];
    this.agents.forEach((agent, npcKey) => {
      const npc = this.actions._getNpc(npcKey);
      agentList.push({
        id: npcKey,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        currentTask: agent.currentTask,
        assignedDesk: agent.assignedDesk,
        position: npc ? { x: Math.round(npc.x), y: Math.round(npc.y) } : null,
      });
    });

    // Collect furniture info
    const furniture = [];
    if (this.scene._interactables) {
      this.scene._interactables.forEach(it => {
        if (it.id && it.sprite) {
          furniture.push({
            id: it.id,
            instanceId: it.instanceId,
            type: it.def?.type,
            position: { x: Math.round(it.sprite.x), y: Math.round(it.sprite.y) },
            assignedTo: this.deskAssignments.get(it.instanceId || it.id) || null,
          });
        }
      });
    }

    this._send({
      type: 'office_state',
      agents: agentList,
      furniture,
      tasks: this.tasks.map(t => ({ id: t.id, type: t.type, agent: t.agent })),
      time: this.scene.worldClock?.toString() || '',
    });
  }

  /**
   * Update (called from scene update loop)
   */
  update() {
    this.actions.update();
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this._stateReportInterval) {
      this._stateReportInterval.remove();
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}

window.AgentOfficeManager = AgentOfficeManager;
