# Denizen — NPC Awareness

> What an NPC "knows" when it decides what to do next. This doc enumerates
> every awareness signal currently surfaced into the system prompt and
> the cheap pattern for adding more.

The NPC's `think()` call assembles a system prompt with ~15 sections.
Three of those are awareness:

- **`## Current State (live)`** — pulled from `worldState.renderContextBlock(npcName)`
- **`## Situational`** — assembled in `npc-brains.js`; covers time-of-day, self-repetition
- **`## Direct Messages To You`** — drained from `agentBus` inbox

## What's in `## Current State` right now

For every NPC, every think cycle:

| Signal | Format | Why |
|---|---|---|
| **Self-state** | `- You are: working in open_office` | Anchors the prompt — they know where they are and what they're up to |
| **Last action** | `- Your last action: reviewed PR from Josh` | One-line continuity from the previous tick |
| **Current task** | `- Current task: fixing login bug` | Persistent task across ticks |
| **Adjacent rooms** | `- Adjacent rooms: conference, breakroom, manager_office, reception` | Topology — they can reason "I'll cut through breakroom" |
| **Desk neighbors** | `- Your desk neighbors: Josh, Edward` | Who's physically next to me at the open office |
| **Nearby NPCs with tags** | `- Nearby: Josh (walking, walking with you, frustrated), Bob (idle, last spoke 22m ago)` | Per-person richness — state, convoy detection, peer-contact recency, mood |
| **Office-wide activity** | `- Room activity: Marcus: meeting prep; Abby: 1:1 with Sarah` | Top 4 NPCs with a current task |
| **Office occupancy** | `- Office occupancy: open_office:5 conference:2 breakroom:1` | Density per room, lets them sense crowding |
| **Active threats** | `- Active threats: 1 (latest: scan_probe high)` | Security awareness |
| **Background jobs** | `- Background jobs: 3/5 running` | n8n / OpenClaw work in flight |
| **Meeting in progress** | `- Meeting in progress: Abby, Marcus` | Who's currently in conference |
| **Conversation thread continuity** | `- Thread with Josh: you've raised "mockups ready" 3x today. Either escalate, drop it, or shift topic.` | Catches an NPC hammering the same topic at one peer all day |

## What's in `## Situational`

| Signal | Format | Why |
|---|---|---|
| **Office time** | `- Office time: 14:30 (afternoon)` | Pacing — different priorities in morning vs end-of-day |
| **Self-repetition warning** | `- Your recent messages: "Hey, how's the sprint going?" then "Quick check-in — any updates?". Avoid asking the same thing again — do something new or wait.` | Breaks the polite check-in loop |

## How each signal is computed

**Position / velocity / room / busy** — pushed every ~10s from
`agent-office-manager._sendOfficeState()` → cofounder mirror →
`worldState.updateNpc()`. The data is "as of 10s ago" but that's fine
because NPC think cycles are 30-45s apart.

**Convoy detection** — `renderContextBlock` compares my velocity vector
to each nearby NPC's. If both `|v| > 30 px/s` AND the dot-product cosine
is `> 0.85`, tag as "walking with you". Cosine `< -0.85` → "walking opposite".

**Desk neighbors** — `getDeskContext(npcName)` walks the furniture
snapshot, finds my assigned desk's coordinates, then sorts other NPCs'
desks by Euclidean distance. Returns the two nearest.

**Per-pair last contact** — `recordContact(from, to)` fires on every NPC
decision that targets a peer. The pair-key is sorted so the map is
symmetric. Surfaced in the prompt only when the gap is > 15 minutes
(otherwise it's recent enough to be obvious).

**Self-repetition** — `recordSelfMessage(npcName, text)` fires on every
decision. `recentSimilarMessage(npcName, text)` normalises both (lowercase,
strip punctuation, first 8 words) and checks for exact overlap inside
the 5-minute window. Catches the "any updates?" / "checking in" loop
without false-positiving on different-but-related messages.

**Mood / sentiment** — `recordSelfMessage` also runs `sentiment.classify(text)`,
a sub-millisecond keyword regex pass over a fixed set of mood keywords
(`frustrated`, `anxious`, `tired`, `excited`, `happy`). The result is
stamped on the NPC as `lastMood = { value, ts }`. Peer NPCs see the tag
in their `Nearby:` line for 10 minutes after it was set, e.g.
`Josh (working, frustrated)`. Self-mood is intentionally NOT surfaced
to the speaker — they already know what they've been saying. Limitation:
keyword regex misses sarcasm, negation ("not happy"), and tone. That's
fine — this is a hint to nudge the LLM, not a verdict.

**Conversation thread continuity** — built on the same per-pair
`recentExchanges` ring as stuck-loop detection.
`topicCount(from, to, text, { windowMs = 24h })` normalises each
message to a 3-content-word "topic fingerprint" (lowercase, strip
punct, drop stop words) and counts how many times THIS NPC has raised
the same topic (prefix-matching, so "mockups ready" matches "mockups
ready yet") with the same peer inside the window. `renderContextBlock`
surfaces one line per think, picking the highest-count thread when
multiple peers qualify (count >= 3). Direction matters — replies from
the peer do NOT count, only the speaker's own raises of the topic.
This is a longer-window, looser-match companion to stuck-loop: stuck-loop
catches 10-minute back-and-forth on identical phrasing, thread-continuity
catches "Sarah has asked about the mockups three times today" across
the whole workday.

**Time of day** — pulled from the world clock the cofounder maintains.
Phase buckets: morning (5-11), midday (11-14), afternoon (14-17), evening
(17-20), after hours (otherwise).

## How to add a new awareness signal

The pattern is consistent. Three changes:

1. **Capture or compute the data.** Either:
   - Add a field to the `office_state` message in
     `src/agent-office-manager.js:_sendOfficeState()`, then mirror it
     into `worldState.updateNpc()` in `src/cofounder-agent.js`, OR
   - Compute it on the fly inside `renderContextBlock` from existing
     world-state fields.
2. **Surface in `renderContextBlock`.** Add one line; keep it short
   (the prompt budget matters). Use the same `- key: value` bullet style
   so the LLM parses it consistently.
3. **Test.** Add a case to `tests/awareness.test.js`. Pure logic only —
   no need to boot a server.

## Awareness signals NOT yet wired (the next backlog)

These are concrete; pick one and add it the same way as above.

| Signal | What it would add | Cost |
|---|---|---|
| **Line-of-sight occlusion** | "You can see Josh but not Edward (wall in the way)" | Needs a wall-aware raycast — ~1 hr |
| **Audio overhearing** | "You can hear Marcus and Sarah talking about Q3 planning" | Cheap: distance + currentTask, ~20 min |
| **Energy / fatigue per-peer** | "Edward looks tired (8h at desk, no break)" | Track per-NPC time-at-desk + last-break; ~30 min |
| **Daily progress** | "You've completed 2 of your 3 priorities today" | Compare goals to outcomes in MEMORY.md; ~30 min |
| **Stuck-loop detection** | "You and Sarah have asked each other if mockups are ready 5 times in 10 minutes" | Cross-NPC version of self-repetition; surfaces as office event; ~45 min |
| **Player presence** | "The CEO is standing near your desk" | Mirror player position into worldState (already partially done via voice gate); ~10 min |
| **Energy budget per provider** | "Anthropic has 14k tokens left of your daily budget" | Read provider stats; ~20 min |
| **Outside events** | "It's raining outside. Building HVAC just kicked on" | Inject from worldState.environment; ~15 min |

Don't add all at once — every signal is more prompt tokens and more
attention pressure on the LLM. Add the one that solves the next
observable bad behavior.

## See also

- [WORLD-STATE.md](WORLD-STATE.md) — the singleton these signals live in
- [AI-SYSTEM.md](AI-SYSTEM.md) — the broader prompt structure
- [ROADMAP_SELF_ADVANCEMENT.md](ROADMAP_SELF_ADVANCEMENT.md) — where this is going next
