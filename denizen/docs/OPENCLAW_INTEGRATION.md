# Denizen — OpenClaw Integration

> Real visualization of OpenClaw agents working. Tool calls move NPCs,
> appear in the task list, fire voice lines, and write events to the
> world-state singleton — all in real time, with zero changes to
> OpenClaw itself.

## What lights up when OpenClaw runs

When the OpenClaw gateway is reachable on `localhost:18789` and an
agent starts a tool call, you'll see all of this happen at once:

| Surface | Reaction |
|---|---|
| **NPC sprite** | Walks to the right area (bookshelf for research, desk for code, conference room for plan, etc.) |
| **Speech bubble** | Shows the tool name above the NPC |
| **Status indicator** | "Working" / "$ terminal" / "Browsing" colored chip |
| **Voice (ElevenLabs)** | NPC says what they're doing — gated on `zionPresent` |
| **WorldState `backgroundTasks`** | Task chip appears with `assignee=NPC, status=running` |
| **WorldState `recentEvents`** | `tool-start` event entry |
| **External sinks (Supabase / n8n)** | Same task fires as an outbound webhook (if configured) |
| **SFX** | `task_ping.ogg` triggers (if the file exists) |

When the tool finishes, the task flips to `done`, an `event` entry of
kind `shipped` lands, and SFX fires the `event_chime.ogg`.

## Architecture

Two layers run in parallel against the same gateway events:

```
                              OpenClaw gateway
                               (localhost:18789)
                                      │
                                      ▼
                           ┌──────────────────────┐
                           │ src/gateway-bridge.js │  ws client + reconnect
                           │  (existing)           │
                           └──────────┬───────────┘
                                      │ EventTarget — fires 'agent', 'chat', etc.
                                      │
                  ┌───────────────────┼────────────────────┐
                  ▼                                        ▼
   ┌──────────────────────────────┐      ┌──────────────────────────────────┐
   │ src/npc-agent-controller.js  │      │ src/openclaw-worldstate-bridge.js │
   │  (existing, sprite + bubble) │      │  (NEW, voice + worldState + bus) │
   │                              │      │           │                       │
   │  → walkTo, _showBubble       │      │           ▼                       │
   │  → _setCustomIndicator       │      │  src/openclaw-translator.js (pure) │
   │                              │      │  translateEvent() → intents       │
   └──────────────────────────────┘      │           │                       │
                                         │           ▼                       │
                                         │  POST /api/task-update            │
                                         │  POST /api/agent-bus              │
                                         │  window.DenizenSpeak() → TTS      │
                                         └──────────────────────────────────┘
```

The two layers cover **different surface areas** — sprite and worldState —
so they never produce duplicate work or duplicate bubbles. Both can be
replaced or removed independently.

## Files

| File | LOC | Purpose |
|---|---|---|
| [`src/openclaw-translator.js`](../src/openclaw-translator.js) | ~270 | **Pure** event-to-intents function. Tool classifier with 13 skill families. Agent → NPC mapping with role hints. Testable without browser. |
| [`src/openclaw-worldstate-bridge.js`](../src/openclaw-worldstate-bridge.js) | ~180 | Browser runner. Subscribes to the gateway, executes intents (POSTs + DenizenSpeak). Persists agent → NPC map to `localStorage`. |
| [`data/openclaw-agent-map.json`](../data/openclaw-agent-map.json) | — | Optional pinned mappings + role hints. Auto-assigner uses `npcRoles` to pick coherent NPCs. |

## Tool classifier — what each tool maps to

Beyond the standard Anthropic SDK tools (`Read`/`Bash`/`Edit`/`TodoWrite`/…),
the translator recognizes the OpenClaw skill families:

| Skill family pattern | Kind | NPC role preference |
|---|---|---|
| `mcp__*` | delegate | — |
| `browser*` / `browserclaw_*` | web | researcher |
| `vision*` / `screenshot*` | research | researcher |
| `supabase*` / `supabase-bridge*` | database | data engineer |
| `github*` / `gh_*` | devops | devops |
| `pdf*` | code | designer |
| `canvas*` | code | designer |
| `resume*` | research | pm |
| `job*` | research | pm |
| `spotify*` / `music*` | idle | — |
| `weather*` | research | — |
| `lm-studio*` | code | developer |
| `skill-creator` / `create-skill*` | code | developer |

Add a new family by editing `SKILL_KIND_HINTS` in
`src/openclaw-translator.js` — it's a plain array of `{match, kind, label, npcRoleHint}`.

## Agent → NPC mapping

Three tiers, in priority order:

1. **Pinned mapping** in `data/openclaw-agent-map.json` under `default`.
   Useful when you want "session X always plays Abby".
2. **Persisted assignments** in `localStorage` (`denizen.openclaw.mapping`).
   First time an unknown agent ID shows up, the auto-assigner picks an
   NPC and remembers — same agent always lands on the same NPC across
   page reloads.
3. **Role-hinted auto-assign**. The translator looks at the tool's
   `npcRoleHint` (e.g. `database` → `data engineer`) and picks the
   first available NPC whose role matches. Falls back to round-robin.

To wipe assignments and force a fresh round-robin:

```js
// In the browser console:
window.DenizenOpenClawBridge.reset();
```

## Event shape (what the gateway sends)

```jsonc
// Tool start
{
  "stream": "tool",
  "agentId": "session-claude-001",
  "agentName": "Frontend dev",
  "data": {
    "name": "github_create_pr",
    "id": "tc-xyz-123",
    "phase": "start"
  }
}

// Tool end
{
  "stream": "tool",
  "agentId": "session-claude-001",
  "data": { "name": "github_create_pr", "id": "tc-xyz-123", "phase": "end" }
}

// Lifecycle
{
  "stream": "lifecycle",
  "agentId": "session-claude-001",
  "data": { "phase": "start" | "end" | "error" }
}

// Final assistant text (deltas are filtered out)
{
  "stream": "assistant",
  "agentId": "session-claude-001",
  "data": { "text": "Done. Merged.", "final": true }
}

// Inter-agent message
{
  "stream": "message",
  "data": { "fromAgentId": "src-id", "toAgentId": "dst-id", "text": "hand-off" }
}
```

## Intents the translator produces

```jsonc
[
  { "kind": "task-update", "body": { "id":"tc-xyz", "title":"GitHub — github_create_pr",
                                     "status":"running", "assignee":"Oscar",
                                     "source":"openclaw", "foreground":true } },
  { "kind": "speak",       "npc":  "Oscar", "text": "GitHub" },
  { "kind": "event",       "body": { "kind":"tool-start", "text":"Oscar: GitHub (github_create_pr)" } }
]
```

The runner POSTs `task-update` and `agent-bus` intents to the local
server endpoints, and calls `window.DenizenSpeak()` for `speak`
intents. The `event` intent is informational — the task-update already
generates a worldState event, so it's currently a no-op (kept in case
a separate event endpoint lands later).

## Testing

[`tests/openclaw-translator.test.js`](../tests/openclaw-translator.test.js)
covers 25 cases — tool classification, role hints, label resolution,
agent resolution (cached / role-hinted / round-robin / pool-exhausted),
tool start/end/error, lifecycle start/end/error, assistant text
relaying, inter-agent message bus publishing, defensive cases. Pure
Node — no browser, no fetch, no scene.

The runner (`openclaw-worldstate-bridge.js`) is intentionally thin and
not directly tested; it just calls `translateEvent()` and executes
intents via `fetch` / `DenizenSpeak`. End-to-end testing is via the
browser with OpenClaw running.

## Verification (manual)

1. Make sure OpenClaw is running on the default port:
   ```powershell
   openclaw gateway --port 18789
   ```
2. Start Denizen and open the browser:
   ```powershell
   npm start
   # → open http://localhost:8080
   ```
3. In the browser console you should see:
   ```
   [GatewayBridge] WebSocket open, sending connect handshake...
   [OpenClawBridge] worldstate bridge attached
   ```
4. Press **Alt+V** (or run `DenizenSetPresence(true)`) to enable voice.
5. Trigger any OpenClaw agent task. You should see:
   - Task chip appear in worldState (`curl http://localhost:8080/api/world-state` → check `backgroundTasks`)
   - NPC sprite move to the appropriate area
   - Speech bubble + audio (if ElevenLabs configured)

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Console: "openclaw-translator.js not loaded" | Translator script tag missing or failed to load | Check `index.html` includes `src/openclaw-translator.js` BEFORE the bridge runner |
| OpenClaw events arrive but no tasks appear | Bridge not attached — gateway came up after bridge timed out | Reload the page (the bridge polls for 60s after init) |
| All tasks assigned to the same NPC | localStorage has stale assignments | `window.DenizenOpenClawBridge.reset()` and reload |
| Voice doesn't fire on tool start | Presence is off, or ElevenLabs not configured | `DenizenSetPresence(true)`; check `/api/tts/health` |
| Two NPC sprites speak the same line | The legacy npc-agent-controller and this bridge BOTH spoke | Bug — they're supposed to cover different surfaces. File an issue. |

## Outbound dispatch (Denizen → OpenClaw)

The bridge described above is **inbound** — it visualizes what OpenClaw is doing. The reverse direction — letting the player *trigger* OpenClaw work from inside Denizen — lives in **[VOICE_INPUT.md](VOICE_INPUT.md)**:

- `src/openclaw-dispatch.js` classifies player utterances (typed or via voice) into `chat` vs `action`.
- Action-classified messages get forwarded to OpenClaw via `gateway-bridge.sendChat()` (WebSocket) with HTTP fallback.
- Chat-classified messages stay in the local NPC brain.
- This closes the loop: voice in → OpenClaw runs the tool → events come back through this bridge → NPC animates and speaks the result.

## See also

- [VOICE.md](VOICE.md) — TTS proxy + voice gate (output side)
- [VOICE_INPUT.md](VOICE_INPUT.md) — STT + outbound dispatch (input side)
- [WORLD-STATE.md](WORLD-STATE.md) — singleton this bridge writes into
- [AGENT_BUS.md](AGENT_BUS.md) — the bus inter-agent messages flow through
- [SFX.md](SFX.md) — what plays when worldState changes
- [ARCHITECTURE.md](ARCHITECTURE.md)
