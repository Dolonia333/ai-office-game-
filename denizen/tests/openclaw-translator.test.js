'use strict';
/**
 * Tests for the OpenClaw → Denizen event translator.
 *
 * Pure functions, no DOM, no fetch — assert on the intent arrays they
 * produce. Each intent is later executed by src/openclaw-worldstate-bridge.js
 * (browser) or by tests that mock fetch.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const T = require('../src/openclaw-translator.js');

// ---------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------

describe('classifyTool', () => {
  it('matches exact known tool names', () => {
    assert.equal(T.classifyTool('Read'), 'research');
    assert.equal(T.classifyTool('Bash'), 'terminal');
    assert.equal(T.classifyTool('TodoWrite'), 'todo');
    assert.equal(T.classifyTool('Edit'), 'code');
  });

  it('classifies skill-namespaced tools', () => {
    assert.equal(T.classifyTool('browser_navigate'), 'web');
    assert.equal(T.classifyTool('vision_screenshot'), 'research');
    assert.equal(T.classifyTool('supabase_query'), 'database');
    assert.equal(T.classifyTool('github_create_pr'), 'devops');
    assert.equal(T.classifyTool('weather_today'), 'research');
    assert.equal(T.classifyTool('spotify_play'), 'idle');
  });

  it('mcp__ tools route to delegate', () => {
    assert.equal(T.classifyTool('mcp__ccd_session__mark_chapter'), 'delegate');
    assert.equal(T.classifyTool('mcp__notion__create_page'), 'delegate');
  });

  it('falls back to heuristics for unknown tools', () => {
    assert.equal(T.classifyTool('list_users'), 'research');
    assert.equal(T.classifyTool('save_record'), 'code');
    assert.equal(T.classifyTool('exec_command'), 'terminal');
    assert.equal(T.classifyTool('something_random'), 'generic');
  });

  it('handles falsy / non-string input', () => {
    assert.equal(T.classifyTool(null), 'generic');
    assert.equal(T.classifyTool(undefined), 'generic');
    assert.equal(T.classifyTool(42), 'generic');
  });
});

describe('suggestRoleForTool', () => {
  it('returns role hints for known skill families', () => {
    assert.equal(T.suggestRoleForTool('supabase_query'), 'data engineer');
    assert.equal(T.suggestRoleForTool('github_create_pr'), 'devops');
    assert.equal(T.suggestRoleForTool('browser_navigate'), 'researcher');
    assert.equal(T.suggestRoleForTool('vision_screenshot'), 'researcher');
  });

  it('returns null for tools without a role hint', () => {
    assert.equal(T.suggestRoleForTool('Read'), null);
    assert.equal(T.suggestRoleForTool('Bash'), null);
  });
});

describe('labelForTool', () => {
  it('uses skill-specific labels when matching', () => {
    assert.equal(T.labelForTool('github_create_pr').text, 'GitHub');
    assert.equal(T.labelForTool('supabase_query').text, 'Database');
    assert.equal(T.labelForTool('browser_navigate').text, 'Browsing');
  });

  it('falls back to generic kind labels otherwise', () => {
    assert.equal(T.labelForTool('Read').text, 'Reading');
    assert.equal(T.labelForTool('unknown_tool').text, 'Working');
  });
});

// ---------------------------------------------------------------------
// resolveAgent
// ---------------------------------------------------------------------

describe('resolveAgent', () => {
  it('uses cached mapping if present', () => {
    const map = new Map([['agent-1', 'Alex']]);
    const npc = T.resolveAgent('agent-1', null, null, map, ['Bob', 'Josh'], {});
    assert.equal(npc, 'Alex');
  });

  it('honors role hint when available', () => {
    const map = new Map();
    const roles = { Pier: 'Data Engineer', Bob: 'Researcher', Oscar: 'DevOps Engineer' };
    const npc = T.resolveAgent('agent-2', null, 'data engineer', map, ['Bob', 'Pier', 'Oscar'], roles);
    assert.equal(npc, 'Pier');
    assert.equal(map.get('agent-2'), 'Pier');
  });

  it('falls back to round-robin when no role hint matches', () => {
    const map = new Map();
    const npc = T.resolveAgent('agent-3', null, null, map, ['Bob', 'Josh'], {});
    assert.equal(npc, 'Bob');
  });

  it('reuses an existing NPC when the pool is empty', () => {
    const map = new Map([['agent-1', 'Alex']]);
    const npc = T.resolveAgent('agent-2', null, null, map, [], {});
    assert.equal(npc, 'Alex');
  });

  it('returns null for falsy agentId', () => {
    assert.equal(T.resolveAgent(null, null, null, new Map(), ['Alex'], {}), null);
  });
});

// ---------------------------------------------------------------------
// translateEvent — the main surface area
// ---------------------------------------------------------------------

function fixture(overrides = {}) {
  return {
    mapping: new Map(),
    availableNpcs: ['Bob', 'Pier', 'Oscar', 'Edward'],
    npcRoles: {
      Bob: 'Researcher', Pier: 'Data Engineer', Oscar: 'DevOps Engineer',
      Edward: 'Backend Developer',
    },
    toolState: new Map(),
    ...overrides,
  };
}

describe('translateEvent — tool calls', () => {
  it('emits task-update + speak + event on tool start', () => {
    const ctx = fixture();
    const intents = T.translateEvent({
      event: 'agent',
      payload: {
        agentId: 'a1',
        agentName: 'TestAgent',
        stream: 'tool',
        data: { name: 'github_create_pr', id: 'tc1', phase: 'start' },
      },
      ...ctx,
    });
    const kinds = intents.map(i => i.kind);
    assert.deepEqual(kinds, ['task-update', 'speak', 'event']);

    const task = intents[0].body;
    assert.equal(task.id, 'tc1');
    assert.equal(task.source, 'openclaw');
    assert.equal(task.status, 'running');
    assert.equal(task.assignee, 'Oscar');         // role hint matched
    assert.equal(task.foreground, true);
    assert.match(task.title, /GitHub/);

    assert.equal(intents[1].kind, 'speak');
    assert.equal(intents[1].npc, 'Oscar');

    assert.equal(intents[2].body.kind, 'tool-start');
    assert.match(intents[2].body.text, /Oscar/);
  });

  it('emits done task + event on tool end', () => {
    const ctx = fixture();
    // Prime the start so toolState has the entry
    T.translateEvent({
      event: 'agent',
      payload: {
        agentId: 'a1',
        stream: 'tool',
        data: { name: 'Bash', id: 'tc1', phase: 'start' },
      },
      ...ctx,
    });
    const intents = T.translateEvent({
      event: 'agent',
      payload: {
        agentId: 'a1',
        stream: 'tool',
        data: { name: 'Bash', id: 'tc1', phase: 'end' },
      },
      ...ctx,
    });
    assert.equal(intents[0].kind, 'task-update');
    assert.equal(intents[0].body.status, 'done');
    assert.equal(intents[1].body.kind, 'shipped');
    assert.equal(ctx.toolState.size, 0, 'toolState should be drained on end');
  });

  it('emits failed + blocker on tool error', () => {
    const ctx = fixture();
    T.translateEvent({
      payload: { agentId: 'a1', stream: 'tool', data: { name: 'Read', id: 'tc1', phase: 'start' } },
      ...ctx,
    });
    const intents = T.translateEvent({
      payload: { agentId: 'a1', stream: 'tool', data: { name: 'Read', id: 'tc1', phase: 'error' } },
      ...ctx,
    });
    assert.equal(intents[0].body.status, 'failed');
    assert.equal(intents[1].body.kind, 'blocker');
    assert.equal(intents[2].kind, 'speak');
  });

  it('persists agent → NPC across multiple events', () => {
    const ctx = fixture();
    T.translateEvent({
      payload: { agentId: 'a1', stream: 'tool', data: { name: 'github_pr', id: 't1', phase: 'start' } },
      ...ctx,
    });
    const npc1 = ctx.mapping.get('a1');
    T.translateEvent({
      payload: { agentId: 'a1', stream: 'tool', data: { name: 'Bash', id: 't2', phase: 'start' } },
      ...ctx,
    });
    const npc2 = ctx.mapping.get('a1');
    assert.equal(npc1, npc2, 'same agent should keep the same NPC');
  });
});

describe('translateEvent — lifecycle', () => {
  it('emits event + speak on agent start', () => {
    const ctx = fixture();
    const intents = T.translateEvent({
      payload: { agentId: 'lc1', agentName: 'A', stream: 'lifecycle', data: { phase: 'start' } },
      ...ctx,
    });
    assert.equal(intents.length, 2);
    assert.equal(intents[0].body.kind, 'agent-start');
    assert.equal(intents[1].kind, 'speak');
  });

  it('emits event + speak on agent end', () => {
    const ctx = fixture();
    const intents = T.translateEvent({
      payload: { agentId: 'lc2', stream: 'lifecycle', data: { phase: 'end' } },
      ...ctx,
    });
    assert.equal(intents[0].body.kind, 'shipped');
  });

  it('emits blocker on agent error', () => {
    const ctx = fixture();
    const intents = T.translateEvent({
      payload: { agentId: 'lc3', stream: 'lifecycle', data: { phase: 'error' } },
      ...ctx,
    });
    assert.equal(intents[0].body.kind, 'blocker');
  });
});

describe('translateEvent — assistant + message streams', () => {
  it('relays final assistant text but ignores deltas', () => {
    const ctx = fixture();
    const finals = T.translateEvent({
      payload: { agentId: 'm1', stream: 'assistant', data: { text: 'Hello world', final: true } },
      ...ctx,
    });
    assert.equal(finals[0].kind, 'speak');

    const deltas = T.translateEvent({
      payload: { agentId: 'm1', stream: 'assistant', data: { text: 'Hello', final: false } },
      ...ctx,
    });
    assert.equal(deltas.length, 0);
  });

  it('publishes inter-agent messages on the bus', () => {
    const ctx = fixture();
    const intents = T.translateEvent({
      payload: {
        agentId: 'src',
        stream: 'message',
        data: { fromAgentId: 'src', toAgentId: 'dst', text: 'hand-off' },
      },
      ...ctx,
    });
    assert.equal(intents[0].kind, 'agent-bus');
    assert.equal(intents[0].body.text, 'hand-off');
    assert.ok(intents[0].body.from);
    assert.ok(intents[0].body.to);
    assert.notEqual(intents[0].body.from, intents[0].body.to);
  });
});

describe('translateEvent — defensive cases', () => {
  it('returns no intents for missing payload', () => {
    const ctx = fixture();
    assert.deepEqual(T.translateEvent({ payload: null, ...ctx }), []);
    assert.deepEqual(T.translateEvent({ payload: undefined, ...ctx }), []);
  });

  it('returns no intents for unknown stream type', () => {
    const ctx = fixture();
    assert.deepEqual(
      T.translateEvent({ payload: { agentId: 'x', stream: 'nope' }, ...ctx }),
      [],
    );
  });
});
