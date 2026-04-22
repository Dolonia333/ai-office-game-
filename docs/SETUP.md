# Denizen — Setup

Step-by-step setup for running Denizen, including the optional Linux security sidecar that makes real Wireshark + Nmap events spawn robbers in the game.

## 1. Minimum baseline (any platform)

### Node.js

Install Node 18+ (any current LTS works). Verify:

```bash
node --version
```

### Clone and install

```bash
git clone <your-fork-url>
cd multbot/pixel-office-game
npm install
```

### Optional: remote provider keys

If you want to use paid APIs instead of (or in addition to) LM Studio, drop a config at `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "anthropic": { "apiKey": "..." },
      "google":    { "apiKey": "..." },
      "xai":       { "apiKey": "..." },
      "moonshot":  { "apiKey": "..." }
    }
  }
}
```

The NPCs' `SOUL.md` files list which provider each uses. If the key is missing, that NPC falls through to LM Studio (always available) or canned responses.

### LM Studio (the default local brain)

1. Download [LM Studio](https://lmstudio.ai/) for your platform.
2. Install and launch.
3. Download a model. Default: `qwen2.5-14b-instruct-1m`.
4. In LM Studio, click **Developer → Start server** (port 1234). Confirm the "Status: Running" indicator.
5. Load your model by selecting it in the top dropdown.

Smoke test the API directly:

```bash
curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5-14b-instruct-1m","messages":[{"role":"user","content":"Say hi."}]}'
```

If you get a reply, LM Studio is good.

Override the model name with `LM_STUDIO_MODEL=<name>` in your shell if you're using a different model. Override the URL with `LM_STUDIO_URL=http://host:port`. If you've enabled auth in LM Studio, set `LM_STUDIO_API_KEY=<key>`.

### Run the game

```bash
cd pixel-office-game
npm start
```

Open http://localhost:8080 in a browser. You should see 16 NPCs moving around, talking to each other, and occasionally taking breaks.

## 2. Enable the security visualization (local fake events)

No Linux required for this part. The security monitor is always running in the background. Test it:

```bash
# Spawn a fake "brute force" robber at a doorway
curl "http://localhost:8080/security-test?type=brute_force&severity=high&detail=5+failed+logins"

# Spawn a fake "data breach" hacker at a monitor
curl "http://localhost:8080/security-test?type=data_breach&severity=critical&detail=Someone+read+.env"

# Spawn a fake Wireshark-flagged scanner in reception
curl "http://localhost:8080/security-test?type=scan_probe&severity=high&detail=nmap+scan+from+1.2.3.4"
```

You'll see a robber sprite appear in the office with a speech bubble and a top-center alert banner.

Full threat catalog is in [SECURITY.md](SECURITY.md).

## 3. Enable the Linux live feeders (Wireshark + Nmap)

**Only on Linux.** Makes real traffic and real firewall events spawn robbers.

### 3a. Install tshark

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install tshark
```

Arch:

```bash
sudo pacman -S wireshark-cli
```

Fedora:

```bash
sudo dnf install wireshark-cli
```

When the installer asks whether non-root users should be able to capture packets, **say yes**. If you missed it:

```bash
sudo dpkg-reconfigure wireshark-common
```

### 3b. Grant tshark capture capabilities (non-root)

```bash
sudo usermod -aG wireshark $USER
# Log out and back in for group change to take effect

# Also add capabilities to dumpcap (the capture backend tshark uses)
sudo setcap cap_net_raw,cap_net_admin+eip $(which dumpcap)
```

Verify:

```bash
tshark -i any -c 1
```

If that prints one captured packet line without errors, you're set.

### 3c. Install Nmap / Zenmap (optional, for testing)

```bash
sudo apt install nmap zenmap
```

Nmap isn't used by the game server — it's only what you'll use to *trigger* scan_probe events against your own host.

### 3d. Firewall logging (for the passive scan detector)

The scan detector reads `journalctl -k` / `/var/log/ufw.log` / `/var/log/kern.log`. Make sure at least one of those is producing BLOCK/DROP lines.

UFW (most Ubuntu/Debian setups):

```bash
sudo ufw enable
sudo ufw logging on
sudo ufw status verbose
```

Verify firewall is logging:

```bash
sudo journalctl -k --since "1 minute ago" | grep -i "ufw\|block\|drop"
```

If you're using `iptables` directly, make sure your DROP rules include `-j LOG`.

### 3e. Enable the feeders when starting the server

```bash
cd pixel-office-game
ENABLE_TSHARK=1 TSHARK_IFACE=any npm start
```

You should see these extra startup lines:

```
[SecurityMonitor] 🔍 tshark live packet monitor active on iface="any"
[SecurityMonitor] 🛡 Linux scan detector active (watching firewall/kernel logs)
```

### 3f. Prove it works — trigger a real scan

In another terminal, scan your own box:

```bash
# From another local host, or from the same box against localhost
sudo nmap -sS -p 1-200 127.0.0.1
```

Within 5-15 seconds, a **scan_probe** robber should spawn in the reception area of the pixel office with a bubble that says something like *"Firewall blocked 43 probes on 28 ports from 127.0.0.1 — nmap scan"*.

Trigger a credential leak detection:

```bash
# Intentionally send a plaintext password via HTTP to prove tshark catches it
curl "http://localhost:8080/anything?password=hunter2"
```

A **packet_anomaly** robber should appear in the IT/storage room.

## 4. Environment variable reference

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + WS port for the game server |
| `LM_STUDIO_URL` | `http://localhost:1234` | LM Studio base URL |
| `LM_STUDIO_MODEL` | `qwen2.5-14b-instruct-1m` | Model to use |
| `LM_STUDIO_API_KEY` | `lm-studio` | API key if LM Studio auth is enabled |
| `ENABLE_TSHARK` | unset | Set to `1` to enable Linux packet monitor |
| `TSHARK_IFACE` | `any` | Interface for tshark to listen on |
| `TSHARK_BPF` | unset | Extra BPF filter AND-ed with default self-exclude |
| `ENABLE_SCAN_DETECT` | enabled on Linux | Set to `0` to disable firewall-log scan detector |

## 5. Troubleshooting

### "tshark: Couldn't run /usr/bin/dumpcap in child process: Permission denied"

You haven't granted capabilities to dumpcap. Re-run step 3b.

### "tshark exited (code=1)"

Usually interface permissions. Try:

```bash
sudo tshark -i any -c 1
```

If that works but non-root doesn't, the capability grant didn't persist (some systems wipe it on upgrade). Re-apply.

### No scan_probe events even though I'm running nmap

Check:

```bash
sudo journalctl -k --since "2 minutes ago" | grep -i block
```

If that's empty, your firewall isn't logging drops. See step 3d. If UFW is disabled or not logging, the passive detector has nothing to read.

Also note: scanning localhost is sometimes not blocked by the loopback chain. Try scanning from another machine on the LAN, or from a VM. Scanning your own external IP from the same host works on most configurations.

### LM Studio returns HTTP 500 "Model unloaded"

Your model got unloaded (LM Studio does this under memory pressure, or if you manually unloaded it). Re-load the model in LM Studio UI. The circuit breaker in Denizen will detect the recovery and resume within 30s.

### 16 NPCs but only 3 are moving

Check `curl http://localhost:1234/v1/models` — if LM Studio isn't responding, or the model name doesn't match `LM_STUDIO_MODEL`, think() calls are all failing. Check the server log for `[NpcBrains] ... think error`.

### Robbers never spawn even when I call /security-test

Open browser devtools → Network → filter WS → confirm `/security-ws` is connected and receiving messages. If the `threat` event arrives but no robber appears, check the browser console for errors from RobberController (most likely the sprite sheet `robber.png` failed to load).

### "Max robbers reached, skipping threat"

You have 5 active threats. Wait 30s for auto-resolution, or lower the threshold via the test endpoint / detector tuning.

## 6. Legal and ethical notes

- Only run the `nmap` testing commands against **your own machines** that you're authorized to scan. Scanning other hosts without permission is a crime in most jurisdictions (US: CFAA; EU: Computer Misuse Act equivalents).
- The Linux feeders built into Denizen are **passive-only** — they read what the kernel/firewall already logged. No outbound scanning, no packet injection, no MITM.
- `tshark` sees all traffic on the interface. If you're running on a shared machine, be aware that this includes other users' traffic. The default BPF filter excludes only the game's own ports — tighten `TSHARK_BPF` if privacy is a concern.

## 7. Going further

Once the basics work:

- Edit `npcs/*/SOUL.md` to customize an NPC's personality
- Watch `npcs/*/MEMORY.md` grow over time — you can tail them live
- Raise `MAX_CHAT_TURNS` in [agent-office-manager.js](../src/agent-office-manager.js) if you want longer conversations
- Add custom threat types by adding a new entry in `THREAT_TARGETS` in [robber-controller.js](../src/robber-controller.js) and emitting events from your own code via the `/security-test` endpoint or by calling `securityMonitor._emitThreat(...)` from server code
- Wire a Grafana / Prometheus / SIEM feed into `_emitThreat` to replace or supplement the built-in detectors

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — whole-system topology
- [SECURITY.md](SECURITY.md) — threat catalog, robber mappings, detection rules
- [AI-SYSTEM.md](AI-SYSTEM.md) — how the NPC brains work
