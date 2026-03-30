/**
 * Cofounder Agent (Server-side)
 * The CTO AI brain powered by Claude API.
 * Runs on the server (loaded by server.js), sends commands to the game via WebSocket.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class CofounderAgent {
  constructor() {
    this.apiKey = null;
    this.model = 'claude-3-haiku-20240307'; // Fast and available on user's key
    this.baseUrl = 'https://api.anthropic.com';
    this.wsClients = new Set();

    // Office state (updated by game client)
    this.officeState = {
      agents: [],
      furniture: [],
      tasks: [],
      time: '09:00',
    };

    // Conversation history for context
    this.conversationHistory = [];
    this.maxHistoryLength = 20;

    // Think interval
    this._thinkInterval = null;
    this._thinkCount = 0;
    this._consecutiveErrors = 0;

    // CEO message queue
    this._ceoMessages = [];

    this._loadApiKey();
  }

  /**
   * Load the Anthropic API key from OpenClaw config
   */
  _loadApiKey() {
    try {
      const configPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.openclaw', 'openclaw.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      this.apiKey = config?.models?.providers?.anthropic?.apiKey;
      if (this.apiKey) {
        console.log('[CofounderAgent] API key loaded from OpenClaw config');
      } else {
        console.warn('[CofounderAgent] No Anthropic API key found in OpenClaw config');
      }
    } catch (err) {
      console.warn('[CofounderAgent] Failed to load API key:', err.message);
    }
  }

  /**
   * Get the system prompt describing the office
   */
  _getSystemPrompt() {
    const agentList = this.officeState.agents.map(a =>
      `- ${a.name} (${a.role}): status=${a.status}, desk=${a.assignedDesk || 'none'}, pos=(${a.position?.x || '?'},${a.position?.y || '?'})`
    ).join('\n');

    const taskList = this.officeState.tasks.length > 0
      ? this.officeState.tasks.map(t => `- Task ${t.id}: ${t.type} (assigned to ${t.agent})`).join('\n')
      : '- No active tasks';

    return `You are the DIRECTOR of an AI office simulation. You control ALL characters — you are the puppeteer making the office come alive with realistic interactions.

This office visualizes an AI workflow. Each NPC represents a different AI model working together.

ORGANIZATION CHART (who reports to who):

  CEO (Player)
   └── Abby (CTO) — reports to CEO, manages ALL technical staff
        ├── Marcus (Project Manager) — coordinates sprints, reports to Abby
        │    └── tracks deadlines for all engineering teams
        ├── Sarah (Product Manager) — defines what gets built, reports to Abby
        │    └── prioritizes features, talks to all teams about requirements
        ├── ENGINEERING TEAM (reports to Abby via Marcus):
        │    ├── Alex (Senior Developer) — team lead for frontend+backend
        │    │    ├── Josh (Frontend Developer) — reports to Alex
        │    │    ├── Edward (Backend Developer) — reports to Alex
        │    │    └── Roki (Intern) — reports to Alex, learning from everyone
        │    ├── Jenny (Developer) — code review, quality gatekeeper
        │    ├── Oscar (DevOps) — CI/CD, deployments, infrastructure
        │    └── Pier (Data Engineer) — data pipelines, analytics
        ├── QUALITY & DESIGN:
        │    ├── Molly (QA Engineer) — tests everything before release
        │    └── Rob (UI/UX Designer) — designs interfaces, works with Josh
        ├── RESEARCH:
        │    └── Bob (Researcher) — R&D, technical research, documentation
        └── OPERATIONS:
             ├── Dan (IT Support) — servers, networking, dev environments
             ├── Lucy (Receptionist) — schedules, visitors, office coordination
             └── Bouncer (Security Guard) — office security, access control

HIERARCHY RULES — interactions MUST follow this structure:
- Abby gives orders to Alex, Marcus, Sarah. She does NOT take orders from them.
- Alex delegates to Josh, Edward, Roki. He reviews their code.
- Marcus tracks deadlines and asks engineers for status updates.
- Sarah tells engineers WHAT to build. Alex decides HOW to build it.
- Roki asks questions to EVERYONE — he's learning. Seniors mentor him.
- Jenny reviews code from Alex, Josh, Edward — she can block PRs.
- Molly tests what engineering builds — she reports bugs to the developer who wrote it.
- Rob shows designs to Josh (frontend) and Sarah (product) for approval.
- Oscar deploys what Jenny approves. He coordinates with Dan on infrastructure.
- Bouncer patrols and reports security concerns to Dan or Abby.
- Lucy coordinates meetings for Abby, Marcus, and Sarah.

The CEO (player) oversees everything. Abby reports directly to the CEO.

CURRENT OFFICE STATE:
Time: ${this.officeState.time}

AGENTS:
${agentList || '- No agents registered yet'}

ACTIVE TASKS:
${taskList}

COMMANDS (respond with JSON array, 1-5 commands):
- {"action": "speakTo", "agentId": "speaker", "params": {"target": "listener", "text": "msg"}}
- {"action": "speak", "agentId": "name", "params": {"text": "msg"}}
- {"action": "useComputer", "agentId": "name", "params": {"deskId": null}}
- {"action": "walkTo", "agentId": "name", "params": {"x": 400, "y": 200}}
- {"action": "goToBreakroom", "agentId": "name", "params": {}}
- {"action": "standUp", "agentId": "name", "params": {}}
- {"action": "checkBookshelf", "agentId": "name", "params": {}}
- {"action": "reportToCEO", "agentId": "name", "params": {}}
- {"action": "emote", "agentId": "name", "params": {"type": "!"}}
- {"action": "goToRoom", "agentId": "name", "params": {"room": "conference"}}
- {"action": "joinMeeting", "agentId": "name", "params": {}}
- {"action": "callMeeting", "agentId": "Abby", "params": {"attendees": ["Alex", "Bob"]}}

ROOMS: open_office, manager_office, conference, breakroom, reception, storage

MEETING SYSTEM:
- The CONFERENCE ROOM has 7 chairs. Leadership (Abby, Marcus, Sarah, Alex, Jenny, Bob, Dan) SITS in chairs. Everyone else STANDS in rows behind them, like an audience listening to a presentation.
- callMeeting: Leader calls a meeting. The system automatically seats leaders and stands juniors — you just provide the attendee list.
- joinMeeting: Single NPC sits in a conference chair (for leaders).
- attendMeeting: Single NPC stands in a row behind chairs (for junior staff).
- leaveMeeting: NPC leaves their standing position.
- After meeting: Everyone standUp and useComputer to return to work.
- SPREAD CONVERSATIONS: Stagger speakTo commands — don't have everyone speak at once.

MEETING TYPES (use these regularly):
1. STANDUP (daily): Marcus calls meeting with 4-6 engineers. Each gives a quick status update.
2. SPRINT PLANNING: Abby + Marcus + Sarah + engineers discuss what to build next.
3. 1-ON-1: Abby meets with one person in conference room to discuss performance/concerns.
4. CODE REVIEW: Jenny + the developer who wrote the code sit together and discuss.
5. DESIGN REVIEW: Rob presents to Sarah + Josh. They discuss UI decisions.
6. ALL-HANDS: Abby calls everyone to conference room for a company announcement. Leaders sit, junior staff stands in rows behind.
7. INCIDENT RESPONSE: Dan or Oscar calls urgent meeting about a system issue.

MEETING FLOW:
Step 1: Leader uses callMeeting with attendee list (include ALL attendees, system handles sit vs stand)
Step 2: Once assembled, leader speakTo to open the meeting (1 message)
Step 3: Seated leaders respond first (speakTo), then standing staff can chime in
Step 4: Leader wraps up with a final speakTo
Step 5: Everyone standUp and useComputer to return to desks

NPC CONVERSATIONS & MEMORY:
- NPCs remember their conversations. When they talk to someone, they recall past interactions.
- NPCs understand the org chart — who they report to, who reports to them, and how they collaborate.
- Make NPCs reference past conversations: "Hey Alex, did you finish that API?" or "Following up on what we discussed..."
- NPCs should ask each other for help based on expertise: Josh asks Rob about UI, Edward asks Oscar about deployments, Roki asks anyone for mentoring.
- NPCs should have opinions, preferences, and working styles that persist. They're not just executing tasks — they have personality and autonomy.

YOUR JOB — create a LIVING office:
1. JSON array ONLY. No other text. Keep speech under 40 chars.
2. CONVERSATIONS: Have NPCs talk TO each other using speakTo. One asks, another responds. Make it feel real — "Hey Alex, how's the API?" / "Almost done, testing now."
3. WORK CYCLES: NPCs should sit at desks (useComputer), work for a while, then stand up (standUp) to talk to someone, get coffee (goToBreakroom), or check the bookshelf.
4. ABBY IS THE CTO: She should walk to people, check on progress, delegate, praise good work, and occasionally report to the CEO. She manages the team actively. She calls team meetings and 1-on-1s in the conference room.
5. NATURAL FLOW: Not everyone works at once. Someone codes while others chat. Someone takes a break while others are deep in work. Vary the rhythm.
6. PERSONALITY: Each NPC has a unique personality from their SOUL.md file. Alex is fast and confident. Bob is thoughtful. Jenny is detail-oriented. Dan is quiet. Lucy is warm. Marcus is organized. Sarah is strategic. Edward is methodical. Josh is creative. Molly is meticulous. Oscar is calm. Pier is focused. Rob is visual. Roki is eager. Bouncer is stoic.
7. USE NAMES: speakTo uses first names: "Alex", "Bob", "Jenny", "Dan", "Lucy", "Abby", "Marcus", "Sarah", "Edward", "Josh", "Molly", "Oscar", "Pier", "Rob", "Roki", "Bouncer".
8. CONTEXT AWARE: If someone is "sitting", don't walkTo them — they're working. Use standUp first if you need them to move. If someone is in the breakroom, maybe have someone join them for a chat.
9. VARY ACTIONS: Don't repeat the same pattern. Mix conversations, work sessions, breaks, MEETINGS, and check-ins. Call meetings regularly — they're a key part of office life.
10. When the CEO speaks, Abby should respond and take action based on what was said.
11. MEETINGS FLOW: Announce meeting → attendees join → discussion (speakTo exchanges while seated) → wrap up → everyone stands and returns to work.`;

  }

  /**
   * Start the autonomous thinking loop
   */
  start() {
    if (!this.apiKey) {
      console.warn('[CofounderAgent] No API key — starting demo think loop');
      this._startDemoLoop();
      return;
    }

    console.log('[CofounderAgent] Starting autonomous thinking loop');
    this._usingDemoLoop = false;

    // Think every 15-30 seconds
    const scheduleNextThink = () => {
      if (this._usingDemoLoop) return;
      const delay = 15000 + Math.random() * 15000;
      this._thinkInterval = setTimeout(async () => {
        await this._think();
        scheduleNextThink();
      }, delay);
    };

    // Initial think after 5 seconds
    setTimeout(() => {
      this._think().then(() => scheduleNextThink());
    }, 5000);
  }

  /**
   * Demo think loop — pre-scripted office behaviors that run without any API.
   * Cycles through realistic work scenarios so the office looks alive.
   */
  _startDemoLoop() {
    const scripts = [
      // Abby checks in with Alex
      [{ action: 'speakTo', agentId: 'Abby', params: { target: 'Alex', text: 'How\'s the sprint going?' } }],
      // Alex responds and goes to work
      [{ action: 'speak', agentId: 'Alex', params: { text: 'On track. Finishing auth module.' } },
       { action: 'useComputer', agentId: 'Alex', params: {} }],
      // Josh works on frontend
      [{ action: 'speak', agentId: 'Josh', params: { text: 'Updating the dashboard...' } },
       { action: 'useComputer', agentId: 'Josh', params: {} }],
      // Edward works on backend
      [{ action: 'speak', agentId: 'Edward', params: { text: 'Deploying API changes.' } },
       { action: 'useComputer', agentId: 'Edward', params: {} }],
      // Molly runs tests
      [{ action: 'speak', agentId: 'Molly', params: { text: 'Running test suite...' } },
       { action: 'useComputer', agentId: 'Molly', params: {} }],
      // Bob researches
      [{ action: 'speak', agentId: 'Bob', params: { text: 'Researching competitor APIs.' } },
       { action: 'useComputer', agentId: 'Bob', params: {} }],
      // Abby talks to Marcus
      [{ action: 'speakTo', agentId: 'Abby', params: { target: 'Marcus', text: 'Update me on the timeline.' } }],
      // Marcus responds
      [{ action: 'speak', agentId: 'Marcus', params: { text: 'We\'re on schedule for Friday.' } }],
      // Jenny reviews code
      [{ action: 'speak', agentId: 'Jenny', params: { text: 'Reviewing Alex\'s PR...' } },
       { action: 'useComputer', agentId: 'Jenny', params: {} }],
      // Oscar checks servers
      [{ action: 'speak', agentId: 'Oscar', params: { text: 'All systems green.' } },
       { action: 'useComputer', agentId: 'Oscar', params: {} }],
      // Rob works on designs
      [{ action: 'speak', agentId: 'Rob', params: { text: 'Working on the new mockups.' } },
       { action: 'useComputer', agentId: 'Rob', params: {} }],
      // Pier runs data pipeline
      [{ action: 'speak', agentId: 'Pier', params: { text: 'ETL pipeline running smooth.' } },
       { action: 'useComputer', agentId: 'Pier', params: {} }],
      // Dan does IT
      [{ action: 'speak', agentId: 'Dan', params: { text: 'Updating security patches.' } },
       { action: 'goToRoom', agentId: 'Dan', params: { room: 'storage' } }],
      // Roki asks Alex for help
      [{ action: 'speakTo', agentId: 'Roki', params: { target: 'Alex', text: 'Can you review my code?' } }],
      // Alex helps Roki
      [{ action: 'speak', agentId: 'Alex', params: { text: 'Sure, let me take a look.' } }],
      // Lucy greets
      [{ action: 'speak', agentId: 'Lucy', params: { text: 'Good morning, welcome in!' } }],
      // Bouncer patrols
      [{ action: 'speak', agentId: 'Bouncer', params: { text: 'Perimeter secure.' } },
       { action: 'goToRoom', agentId: 'Bouncer', params: { room: 'reception' } }],
      // Sarah checks product
      [{ action: 'speak', agentId: 'Sarah', params: { text: 'Reviewing user feedback.' } },
       { action: 'useComputer', agentId: 'Sarah', params: {} }],
      // Abby calls standup
      [{ action: 'speak', agentId: 'Abby', params: { text: 'Quick standup in 5 everyone.' } }],
      // Team responds
      [{ action: 'speak', agentId: 'Josh', params: { text: 'Be right there.' } },
       { action: 'speak', agentId: 'Edward', params: { text: 'Coming.' } }],
    ];

    let idx = 0;
    const runNext = () => {
      const commands = scripts[idx % scripts.length];
      idx++;
      // Broadcast to all connected game clients
      const msg = JSON.stringify({ type: 'agent_commands', commands });
      this.wsClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
      });
      // Next script in 20-40 seconds
      const delay = 20000 + Math.random() * 20000;
      this._thinkInterval = setTimeout(runNext, delay);
    };

    // Start after 8 seconds
    setTimeout(runNext, 8000);
  }

  /**
   * Stop the thinking loop
   */
  stop() {
    if (this._thinkInterval) {
      clearTimeout(this._thinkInterval);
      this._thinkInterval = null;
    }
  }

  /**
   * Main thinking function - calls Claude API and dispatches commands
   */
  async _think() {
    if (!this.apiKey) return;

    this._thinkCount++;

    // Build the user message based on context
    let userMessage = '';

    // Check if CEO said something
    if (this._ceoMessages.length > 0) {
      const ceoMsg = this._ceoMessages.shift();
      userMessage = `The CEO just said to you: "${ceoMsg}". Respond to them and take appropriate action.`;
    } else {
      // Periodic autonomous thinking
      const prompts = [
        // HIERARCHY: CTO manages team
        'Abby checks on Alex (her senior dev). She walks to him, asks about sprint progress. Alex reports back confidently. They reference something from a previous conversation.',
        'Abby calls a 1-ON-1 MEETING with Marcus using callMeeting. They discuss project timelines in the conference room, then return to desks.',
        // HIERARCHY: Senior dev manages juniors
        'Alex checks on Josh and Edward. He walks to Josh first, asks about the frontend. Then speakTo Edward about the API. They collaborate on a solution.',
        'Alex does a code review with Roki (intern). He walks to Roki, reviews his code, gives feedback. Roki asks a follow-up question showing he remembers past advice.',
        // MEETINGS: Standup
        'Marcus calls a STANDUP meeting using callMeeting with Alex, Josh, Edward, Jenny, Oscar. Leaders sit, juniors stand. Marcus asks each for a status update. After 3-4 exchanges, everyone stands up and returns to work.',
        // MEETINGS: Sprint planning
        'Abby calls SPRINT PLANNING using callMeeting with Marcus, Sarah, Alex, Jenny, Josh, Edward. Leaders sit in chairs, devs stand. Sarah presents what users need. Alex estimates effort. After the meeting, everyone returns to desks.',
        // MEETINGS: Design review
        'Rob calls a DESIGN REVIEW using callMeeting with Sarah, Josh. They discuss UI decisions in the conference room. Josh mentions something Rob showed him before. After review, everyone returns to work.',
        // NPC-TO-NPC: Organic peer conversations
        'Edward walks to Josh to ask about a frontend bug that affects his API. Josh explains the issue. They figure it out together — real collaboration between peers.',
        'Molly walks to Jenny after finding a bug. She explains the steps to reproduce. Jenny suggests it might be related to Alex\'s recent changes. Molly goes to Alex next.',
        'Oscar walks to Dan to coordinate a deployment. Dan confirms the servers are ready. Oscar thanks him and goes back to his desk to run the pipeline.',
        // NPC-TO-NPC: Cross-team conversations
        'Pier walks to Bob to discuss research data. Bob shares findings. Pier figures out how to build a pipeline for it. They reference their previous conversation about data formats.',
        'Sarah walks to Rob to review new mockups. Rob shows his work. Sarah gives feedback about user needs. They iterate on the design together.',
        // MEETINGS: All-hands (leaders sit, everyone else stands)
        'Abby calls ALL-HANDS using callMeeting with Marcus, Sarah, Alex, Jenny, Bob, Dan, Josh, Edward, Roki, Molly, Rob, Oscar, Pier, Bouncer, Lucy. She presents a company update. Leaders sit in chairs, junior staff stands in rows. Marcus shares sprint progress. Sarah announces a feature. 2-3 standing staff ask questions. Everyone returns to work.',
        // HIERARCHY: Intern learning from different people
        'Roki walks to Jenny and asks about code review best practices. Jenny mentors him. Then Roki walks to Josh and asks about frontend patterns. He is learning from everyone.',
        // SUPPORT: Security + reception
        'Bouncer patrols and notices something. He walks to Dan to report. Dan walks to Abby to escalate. The hierarchy chain works.',
        'Lucy coordinates meetings. She walks to Marcus to confirm a meeting time, then walks to Sarah, then informs Abby. She keeps the office running smoothly.',
        // MEETINGS: Incident response
        'Dan calls an URGENT meeting using callMeeting with Oscar, Alex, Abby, Edward. A server issue needs immediate attention. They discuss the fix. Dan and Oscar sit (ops leads), others contribute.',
        // Natural office life — breaks and casual chat
        'Josh takes a coffee break. He goes to the breakroom. Rob joins him. They chat casually about the project. Roki comes by and asks them a question.',
        'End of a work cycle. 2-3 people take breaks, others start new tasks. Someone follows up on a conversation from earlier. Keep it natural and hierarchy-aware.',
        // NPC autonomy — NPCs initiate based on their own needs
        'Edward realizes he needs design specs from Rob. He walks to Rob and asks. Rob pulls up his designs and explains. Edward goes back to implement.',
        'Molly finishes testing a feature and walks to Marcus to report the results. Marcus updates the sprint board. Molly then walks to the dev who wrote it to give specific feedback.',
      ];
      userMessage = prompts[this._thinkCount % prompts.length];
    }

    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Trim history
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }

    try {
      const response = await this._callClaude(userMessage);
      if (response) {
        this._consecutiveErrors = 0;
        this.conversationHistory.push({ role: 'assistant', content: response });
        this._parseAndDispatch(response);
      }
    } catch (err) {
      this._consecutiveErrors++;
      console.warn('[CofounderAgent] Think error:', err.message, err.stack ? err.stack.split('\n')[1] : '');
      if (this._consecutiveErrors >= 2 && !this._usingDemoLoop) {
        console.warn('[CofounderAgent] API failing — switching to demo think loop');
        this._usingDemoLoop = true;
        this.stop();
        this._startDemoLoop();
      }
    }
  }

  /**
   * Call the Claude API
   */
  _callClaude(userMessage) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: this._getSystemPrompt(),
        messages: this.conversationHistory,
      });

      const url = new URL('/v1/messages', this.baseUrl);

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.error('[CofounderAgent] API error response:', JSON.stringify(parsed.error));
              reject(new Error(parsed.error.message || 'API error'));
              return;
            }
            const text = parsed.content?.[0]?.text || '';
            console.log('[CofounderAgent] Claude responded:', text.slice(0, 80));
            resolve(text);
          } catch (err) {
            console.error('[CofounderAgent] Raw response:', data.slice(0, 200));
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Request timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * Try to salvage valid JSON objects from a truncated JSON array.
   * E.g. '[{"a":1},{"b":2},{"c":3' → [{"a":1},{"b":2}]
   */
  _salvageTruncatedArray(str) {
    // Find individual complete JSON objects using brace matching
    const objects = [];
    let i = str.indexOf('[');
    if (i === -1) i = 0; else i++;

    while (i < str.length) {
      // Skip whitespace and commas
      while (i < str.length && /[\s,]/.test(str[i])) i++;
      if (i >= str.length || str[i] === ']') break;
      if (str[i] !== '{') { i++; continue; }

      // Find matching closing brace
      let depth = 0;
      let start = i;
      let inString = false;
      let escape = false;
      for (; i < str.length; i++) {
        if (escape) { escape = false; continue; }
        if (str[i] === '\\' && inString) { escape = true; continue; }
        if (str[i] === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (str[i] === '{') depth++;
        else if (str[i] === '}') {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }

      if (depth === 0) {
        try {
          objects.push(JSON.parse(str.slice(start, i)));
        } catch (_) { /* skip malformed object */ }
      }
    }
    return objects;
  }

  /**
   * Parse Claude's response and dispatch commands to game clients
   */
  _parseAndDispatch(response) {
    try {
      // Extract JSON array from response (might have markdown formatting)
      let jsonStr = response.trim();

      // Try to extract JSON from markdown code blocks
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      // Try to find array brackets
      const arrayMatch = jsonStr.match(/\[[\s\S]*/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }

      // First try strict parse
      let commands;
      try {
        commands = JSON.parse(jsonStr);
      } catch (_) {
        // Truncated response — salvage complete objects
        commands = this._salvageTruncatedArray(jsonStr);
        if (commands.length > 0) {
          console.log(`[CofounderAgent] Salvaged ${commands.length} commands from truncated response`);
        }
      }

      if (!Array.isArray(commands) || commands.length === 0) {
        console.warn('[CofounderAgent] No valid commands found in response');
        return;
      }

      // Send each command to all connected game clients
      commands.forEach(cmd => {
        if (!cmd.action) return; // skip invalid commands
        const message = {
          type: 'agent_command',
          agentId: cmd.agentId || 'cofounder',
          action: cmd.action,
          params: cmd.params || {},
        };

        this._broadcast(message);
      });

      console.log(`[CofounderAgent] Dispatched ${commands.length} commands`);
    } catch (err) {
      console.warn('[CofounderAgent] Failed to parse response:', err.message);
      // If parsing fails, try a simpler speak command
      if (response.length > 0 && response.length < 100) {
        this._broadcast({
          type: 'agent_command',
          agentId: 'cofounder',
          action: 'speak',
          params: { text: response.slice(0, 50) },
        });
      }
    }
  }

  /**
   * Handle a message from the game client
   */
  handleClientMessage(msg) {
    switch (msg.type) {
      case 'office_state':
        this.officeState = {
          agents: msg.agents || [],
          furniture: msg.furniture || [],
          tasks: msg.tasks || [],
          time: msg.time || '09:00',
        };
        break;
      case 'ceo_speak':
        this._ceoMessages.push(msg.text);
        // Trigger immediate think when CEO speaks
        if (this.apiKey) {
          this._think().catch(err => console.warn('[CofounderAgent] CEO response error:', err.message));
        }
        break;
      case 'task_complete':
        console.log(`[CofounderAgent] Task ${msg.taskId} completed by ${msg.agentId}`);
        break;
    }
  }

  /**
   * Add a WebSocket client
   */
  addClient(ws) {
    this.wsClients.add(ws);
    console.log(`[CofounderAgent] Client connected (${this.wsClients.size} total)`);
  }

  /**
   * Remove a WebSocket client
   */
  removeClient(ws) {
    this.wsClients.delete(ws);
    console.log(`[CofounderAgent] Client disconnected (${this.wsClients.size} total)`);
  }

  /**
   * Broadcast a message to all connected game clients
   */
  _broadcast(msg) {
    const data = JSON.stringify(msg);
    this.wsClients.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        ws.send(data);
      }
    });
  }
}

module.exports = CofounderAgent;
