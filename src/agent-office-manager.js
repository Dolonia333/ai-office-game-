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

    // NPC key to display name mapping
    this.NPC_NAMES = {
      xp_abby: 'Abby',
      xp_alex: 'Alex',
      xp_bob: 'Bob',
      xp_dan: 'Dan',
      xp_jenny: 'Jenny',
      xp_lucy: 'Lucy',
      xp_bouncer: 'Bouncer',
      xp_conference_man: 'Marcus',
      xp_conference_woman: 'Sarah',
      xp_edward: 'Edward',
      xp_josh: 'Josh',
      xp_molly: 'Molly',
      xp_oscar: 'Oscar',
      xp_pier: 'Pier',
      xp_rob: 'Rob',
      xp_roki: 'Roki',
    };
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
      } else if (agent.role === 'desk_worker' || agent.role === 'stock_trader' || agent.role === 'researcher') {
        deskPool = openDesks;
      } else {
        return; // receptionist, etc. don't need desks
      }

      // Find first unassigned desk
      const desk = deskPool.find(d => !assignedDeskIds.has(d.instanceId || d.id));
      if (desk) {
        const deskId = desk.instanceId || desk.id;
        agent.assignedDesk = deskId;
        assignedDeskIds.add(deskId);
        this.deskAssignments.set(deskId, npcKey);
        console.log(`[AgentManager] Assigned ${agent.name} to desk ${deskId} (has chair nearby)`);
      }
    });
  }

  /**
   * Start initial agent behaviors
   */
  _startInitialBehaviors() {
    // Skip initial behaviors if demo mode is active
    if (this._demoMode) return;
    this.agents.forEach((agent, npcKey) => {
      switch (agent.role) {
        case 'cofounder':
          // CTO goes to her desk first, then checks on the team
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
            // After settling in, greet the team
            this.scene.time.delayedCall(5000, () => {
              this.actions.speak(npcKey, 'Good morning team!');
            });
            // Then go talk to developers
            this.scene.time.delayedCall(12000, () => {
              this._cofounderCheckIn(npcKey);
            });
          } else {
            this._cofounderPatrol(npcKey);
          }
          break;
        case 'desk_worker':
        case 'stock_trader':
          // Desk workers go to their assigned desk
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
            this.scene.time.delayedCall(3000, () => {
              this.actions.speak(npcKey, 'Starting work...');
            });
          }
          break;
        case 'researcher':
          // Researcher goes to assigned desk if they have one, otherwise bookshelf
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
            this.scene.time.delayedCall(2000, () => {
              this.actions.speak(npcKey, 'Reviewing data...');
            });
          } else {
            this.actions.checkBookshelf(npcKey);
            agent.status = 'researching';
            this.scene.time.delayedCall(2000, () => {
              this.actions.speak(npcKey, 'Reviewing research...');
            });
          }
          break;
        case 'receptionist':
          // Receptionist goes to front area
          this.actions.walkTo(npcKey, 580, 610);
          agent.status = 'stationed';
          this.scene.time.delayedCall(2000, () => {
            this.actions.speak(npcKey, 'Ready at reception.');
          });
          break;
        case 'it_support':
          // IT support roams
          this._itPatrol(npcKey);
          break;
      }
    });
  }

  /**
   * Cofounder patrol behavior (walks around checking on agents)
   */
  _cofounderPatrol(npcKey) {
    if (this._demoMode) return;
    const agent = this.agents.get(npcKey);
    if (!agent) return;

    const checkpoints = [
      { x: 200, y: 200, msg: 'Checking dev team...' },
      { x: 500, y: 200, msg: 'Reviewing code progress...' },
      { x: 700, y: 300, msg: 'Looking at research...' },
      { x: 400, y: 400, msg: 'Office looking good.' },
      { x: 200, y: 550, msg: 'Break room check.' },
    ];

    let idx = 0;
    const patrol = () => {
      if (agent.status === 'task_override') return; // server took over

      const cp = checkpoints[idx % checkpoints.length];
      idx++;

      this.actions.walkTo(npcKey, cp.x, cp.y).then(() => {
        this.actions.speak(npcKey, cp.msg);
        // Wait 8-15 seconds before next checkpoint
        const delay = 8000 + Math.random() * 7000;
        this.scene.time.delayedCall(delay, patrol);
      });
    };

    // Start after initial delay
    this.scene.time.delayedCall(4000, patrol);
  }

  /**
   * Cofounder check-in: stand up, walk to devs, talk, they respond, then return to desk
   */
  _cofounderCheckIn(npcKey) {
    if (this._demoMode) return;
    const agent = this.agents.get(npcKey);
    if (!agent) return;
    if (agent.status === 'task_override') return;

    // Find developer NPCs to talk to
    const devKeys = [];
    this.agents.forEach((a, k) => {
      if (k !== npcKey && (a.role === 'desk_worker' || a.role === 'researcher')) {
        devKeys.push(k);
      }
    });

    if (devKeys.length === 0) return;

    // Pick a random dev to check on
    const targetKey = devKeys[Math.floor(Math.random() * devKeys.length)];
    const targetAgent = this.agents.get(targetKey);
    const targetName = targetAgent?.name || targetKey;

    // Stand up from desk and walk to them
    this.actions.standUp(npcKey);

    const checkInMessages = [
      `Hey ${targetName}, how's it going?`,
      `${targetName}, any blockers?`,
      `Status update, ${targetName}?`,
      `${targetName}, need anything?`,
    ];
    const responseMessages = [
      'All good, making progress!',
      'Working on it, almost done.',
      'No blockers, thanks!',
      'Could use a code review later.',
      'Just fixing a bug, give me a sec.',
    ];

    const msg = checkInMessages[Math.floor(Math.random() * checkInMessages.length)];

    this.actions.speakTo(npcKey, targetKey, msg).then(() => {
      // Dev responds after a short delay
      this.scene.time.delayedCall(2000, () => {
        const response = responseMessages[Math.floor(Math.random() * responseMessages.length)];
        this.actions.speak(targetKey, response);

        // Abby goes back to her desk after chatting
        this.scene.time.delayedCall(3000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
          }
          // Schedule next check-in
          const nextDelay = 20000 + Math.random() * 20000;
          this.scene.time.delayedCall(nextDelay, () => {
            this._cofounderCheckIn(npcKey);
          });
        });
      });
    });
  }

  /**
   * IT support patrol behavior
   */
  _itPatrol(npcKey) {
    const agent = this.agents.get(npcKey);
    if (!agent) return;

    const locations = [
      { x: 200, y: 180, msg: 'Checking workstations...' },
      { x: 600, y: 180, msg: 'Network looks stable.' },
      { x: 400, y: 350, msg: 'Running diagnostics...' },
      { x: 900, y: 200, msg: 'Server room OK.' },
    ];

    let idx = 0;
    const patrol = () => {
      if (agent.status === 'task_override') return;

      const loc = locations[idx % locations.length];
      idx++;

      this.actions.walkTo(npcKey, loc.x, loc.y).then(() => {
        this.actions.speak(npcKey, loc.msg);
        const delay = 10000 + Math.random() * 10000;
        this.scene.time.delayedCall(delay, patrol);
      });
    };

    this.scene.time.delayedCall(5000, patrol);
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
        if (responderKey) {
          this.actions.speak(responderKey, msg.text);
          console.log(`[AgentManager] ${msg.npcName} responds to ${msg.fromName}: "${msg.text}"`);
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
