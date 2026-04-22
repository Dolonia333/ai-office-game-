# Denizen — Security Visualization

**Goal:** turn real system and network events into character animations, so someone who can't read a log file can still *see* that something bad is happening.

When the security monitor detects a threat, a robber NPC spawns in the pixel office and performs the action corresponding to the threat type. No logs to parse, no CLI to open — just watch the office.

## How it works in one paragraph

The server runs [`security-monitor-server.js`](../security-monitor-server.js) on startup. It polls three always-on sources (system events, network connections, file watches) and — on Linux only, opt-in — two live feeders that plug into Wireshark (`tshark`) and the firewall logs (`ufw`/`iptables`/`journalctl`). When any of these sources emits a threat, the server broadcasts it on `/security-ws`. The browser client's [`RobberController`](../src/robber-controller.js) picks a robber archetype from the threat's `category` field, spawns a sprite, and makes it perform a contextual animation with a speech bubble summarizing the detail.

## Threat catalog

Ten threat categories. Each is both a server-side detection rule and a client-side robber archetype.

| Category | Detection source | Robber behavior | Typical detail |
|---|---|---|---|
| `file_access` | Watched directory + suspicious filename pattern (`*.env`, `*.pem`, `id_rsa`, `password*`) | Searches bookshelves, alternating left/right idle | `Sensitive file change: .env` |
| `data_breach` | HTTP URL hits `/etc/passwd`, `/etc/shadow`, `.env`, `.pem`, `.key` | Sits at a monitor, "hacking" idle | `GET /.env from 1.2.3.4` |
| `network_scan` | Many `ESTABLISHED` connections from one IP, OR HTTP probe to wp-admin/phpmyadmin/.git/admin panels | Patrols 4 points along outside walls | `12 connections from 1.2.3.4` |
| `brute_force` | Failed logins (Windows Event Log 4625 OR `auth.log`/`secure` `Failed password`) past threshold (default 3/60s), OR HTTP rate limit > 50/min | Shakes at a door | `5 failed logins from 1.2.3.4` |
| `shell_exec` | Suspicious process name in `Get-Process` (Windows) — `nc`, `ncat`, `nmap`, `mimikatz`, etc., OR command-injection pattern in HTTP | Types furiously at a desk | `Suspicious process: mimikatz (PID 4242)` |
| `api_abuse` | SQL injection, XSS, template injection, or attack-tool user-agent (`sqlmap`, `nikto`, `nmap`, `hydra`, …) | Stands at monitor, hacking idle | `POST /api — pattern: UNION SELECT` |
| `process_spawn` | New suspicious process started in the last 10s | Sneaks in from the left entrance | `New process: reverse_shell.exe` |
| `exfiltration` | `tshark` flags a >100 KB packet to a non-RFC1918 IP | Walks a scripted exit path, leaves through the right door | `tshark: 248 KB packet to 203.0.113.5` |
| **`scan_probe`** 🆕 | `tshark` SYN flood (30+ SYNs from one IP in 10s), OR firewall log shows 5+ distinct ports probed from one IP in 20s | Patrols reception, "casing" the office | `Firewall blocked 17 probes on 12 ports from 1.2.3.4 — nmap scan` |
| **`packet_anomaly`** 🆕 | `tshark` plaintext credential in HTTP, DNS tunneling signature, attack-tool user-agent | Lurks in the storage/IT room, "sniffing" idle | `tshark: DNS tunneling? 7 long queries in 30s (84 chars)` |

Severity levels: `low` / `medium` / `high` / `critical`. Severity drives the color of the speech bubble (yellow → orange → red → deep red) and how urgent the top-banner alert feels.

## Robber archetype visual cues

Every robber visual is deliberately different so a watcher can identify the threat from across the room:

- **Searching** (`file_access`) — rummages through a bookshelf with alternating left/right idle frames
- **Hacking** (`data_breach`, `shell_exec`, `api_abuse`, `packet_anomaly`) — stationary at a computer, down-facing idle
- **Sneaking** (`network_scan`, `process_spawn`, `scan_probe`) — patrols between multiple waypoints
- **Breaking** (`brute_force`) — 2px shake animation every 150ms, at a doorway
- **Fleeing** (`exfiltration`) — scripted multi-waypoint exit toward the right edge, then despawn

All robbers use the same sprite set (`assets/robber.png`) — they're identified by their behavior, position, and speech bubble, not by different looks. This keeps the asset footprint small and the visual language consistent ("any robber = something bad").

## Alert banner

Independent of the robber sprites, a top-center alert banner flashes with the severity icon, category, and truncated detail for 6 seconds. This ensures:

- First-time viewers see the category name written out
- The alert is readable even when the robber is off-screen
- Multiple simultaneous threats still surface at least the latest one

## Testing locally

### Trigger a single fake threat

Hit the built-in test endpoint (any HTTP client):

```
http://localhost:8080/security-test?type=file_access&severity=high&detail=Someone+reading+passwords
```

Valid `type` values match the category names above. Valid `severity` values: `low`, `medium`, `high`, `critical`. The `detail` field becomes the speech bubble and banner text.

```bash
# Quick smoke — spawns a scanner robber in reception
curl "http://localhost:8080/security-test?type=scan_probe&severity=high&detail=nmap+scan+from+192.168.1.50"

# Plaintext credential event — spawns a sniffer robber in storage
curl "http://localhost:8080/security-test?type=packet_anomaly&severity=high&detail=plaintext+password+captured+from+192.168.1.50"
```

### Trigger real threats (Linux host)

Run these **against your own machine only** — they will cause the security monitor to fire real events.

```bash
# Port scan yourself — firewall will log blocks, scan detector picks them up
sudo nmap -sS -p 1-100 localhost

# Brute force SSH against yourself (will fail; log watcher picks up)
for i in {1..5}; do ssh invaliduser@localhost; done

# Plaintext credential in URL — tshark picks it up
curl "http://some-local-service/login?password=hunter2"

# Long DNS query — tshark picks up as possible tunneling
dig TXT $(head -c 60 /dev/urandom | base64).example.com
```

### Trigger real threats (Windows host)

```powershell
# Fail login a few times to your own box
for ($i=0; $i -lt 5; $i++) { Get-Credential | Out-Null }

# Rename a suspicious-looking file in a watched dir
New-Item -ItemType File -Path .\creds.env
```

## The Linux live feeders

### Wireshark (`tshark`) packet monitor

Enabled by setting `ENABLE_TSHARK=1` in the environment. Off by default because it requires elevated capabilities on the `dumpcap` binary.

Parses tshark's field-separated output line by line and runs five detections:

1. **SYN flood / port scan** — tracks SYN-only packets per source IP over a 10-second window. 30+ → `scan_probe`.
2. **Plaintext credentials** — `?password=`, `?token=`, `?apikey=` in any HTTP URI/UA → `packet_anomaly`.
3. **DNS tunneling** — queries longer than 50 characters, repeated 5+ times in 30s from the same source → `packet_anomaly` (critical).
4. **Bulk exfiltration** — single packet >100 KB to a non-RFC1918 IP → `exfiltration`.
5. **Attack-tool user-agents** — `sqlmap`, `nmap`, `nikto`, `hydra`, etc. → `api_abuse` (critical).

Filter `not (host 127.0.0.1 and (port 8080 or port 1234 or port 18789))` is always applied to avoid self-monitoring noise. Add extra filters via `TSHARK_BPF`.

### Scan-probe detector (firewall logs)

Always-on when running on Linux (disable with `ENABLE_SCAN_DETECT=0`).

Reads the last 30s of `journalctl -k`, falling back to `/var/log/ufw.log`, falling back to `/var/log/kern.log`. Looks for `BLOCK`/`DROP`/`REJECT` lines with `SRC=` and `DPT=` fields, tracks distinct ports probed per source IP in a 20s window, and fires `scan_probe` when 5+ distinct ports are seen.

**Entirely passive.** No outbound scanning. Only reads what the kernel already logged.

## Tuning thresholds

All thresholds live in the `SecurityMonitorServer` constructor options:

| Option | Default | What it controls |
|---|---|---|
| `failedLoginThreshold` | 3 | Failed logins from one IP in 60s before firing `brute_force` |
| `portScanThreshold` | 10 | Simultaneous connections from one IP before firing `network_scan` |
| `apiRateLimit` | 50 | HTTP requests per minute per IP before firing `brute_force` |
| `systemPollInterval` | 10000 | ms between system-log checks |
| `networkPollInterval` | 5000 | ms between netstat checks |
| `tsharkIface` | `any` | tshark `-i` interface |
| `tsharkBpf` | (none) | Extra BPF filter AND-ed with the default self-exclude filter |

Override by passing options into the `new SecurityMonitorServer({...})` call in [server.js](../server.js), or by setting the documented env vars.

## Dedup, auto-resolution, cap

- **Dedup:** `category + source` within 5s is dropped (prevents a single event firing 50 times while the tshark line buffer is churning).
- **Auto-resolve:** 30s after first fire, the threat is cleared. The robber then walks off-screen-left and is pooled for reuse.
- **Cap:** max 5 simultaneous robbers. New threats beyond that are dropped (not queued) — the monitor emits a warning.

## Legal / operational notes

- The Linux feeders are **passive only**. No outbound scanning, no packet injection, no MITM.
- `tshark` requires `CAP_NET_RAW` + `CAP_NET_ADMIN` on the `dumpcap` binary (or root). The recommended non-root setup is documented in [SETUP.md](SETUP.md).
- The firewall log watcher only reads files that `ufw`/`iptables` already wrote — no new kernel modules, no new firewall rules installed by Denizen.
- Dedup + cap ensure a noisy network can't DoS the game or flood the browser with sprite spawns.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — whole-system topology
- [SETUP.md](SETUP.md) — installing and enabling the Linux feeders
- [AI-SYSTEM.md](AI-SYSTEM.md) — the NPC intelligence layer (separate from security)
