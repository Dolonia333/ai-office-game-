# Audio assets

Drop `.ogg` (preferred) or `.mp3` files here that match the names declared in [`/data/sfx-map.json`](../../data/sfx-map.json). The runtime silently skips missing files, so the system ships safely before any audio lands.

Default expected files (override the map to use different names):

| File | When it plays |
|---|---|
| `office_ambient.ogg` | Ambient loop while presence is on |
| `presence_on.ogg` / `presence_off.ogg` | Alt+V toggle |
| `threat_low.ogg` … `threat_critical.ogg` | Per-severity threat alerts |
| `task_ping.ogg` | New `/api/task-update` arrives |
| `event_chime.ogg` | Generic worldState event broadcast |
| `meeting_start.ogg` / `meeting_end.ogg` | `worldState.setMeeting()` flips |
| `chat_ding.ogg` | New `player_chat_response` |

Free-tier sources for placeholder audio: [freesound.org](https://freesound.org), [zapsplat.com](https://zapsplat.com), [pixabay.com/sound-effects](https://pixabay.com/sound-effects/).

Keep individual files under ~100 KB. The ambient loop can be longer (~1 MB) but should be a clean loop point.
