/**
 * Security Monitor Server
 *
 * Watches multiple system sources for suspicious activity and sends
 * threat events to the game via WebSocket.
 *
 * Monitors:
 *   1. System — file access, process spawns, failed logins (Windows Event Log / Linux auth.log)
 *   2. Network — port scans, suspicious connections, brute force attempts
 *   3. Web/API — HTTP request anomalies, injection attempts, rate limiting
 *   4. OpenClaw — suspicious agent behavior, unauthorized tool calls
 *
 * Usage:
 *   Integrated into server.js via require('./security-monitor-server')
 *   Or run standalone: node security-monitor-server.js
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SecurityMonitorServer {
  constructor(options = {}) {
    this.clients = new Set(); // WebSocket clients
    this.activeThreats = new Map();
    this.threatLog = [];

    // Configuration
    this.config = {
      // How often to check each source (ms)
      systemPollInterval: options.systemPollInterval || 10000,
      networkPollInterval: options.networkPollInterval || 5000,
      openclawPollInterval: options.openclawPollInterval || 3000,

      // Thresholds
      failedLoginThreshold: options.failedLoginThreshold || 3,     // in 60s window
      portScanThreshold: options.portScanThreshold || 10,           // connections in 10s
      apiRateLimit: options.apiRateLimit || 50,                     // requests per minute
      suspiciousPatterns: options.suspiciousPatterns || [
        /\.\.[\\/]/,                    // directory traversal
        /etc\/(passwd|shadow)/,         // *nix password files
        /\.(env|pem|key|crt|pfx)$/,    // sensitive file extensions
        /SELECT.*FROM|UNION.*SELECT|DROP\s+TABLE/i,  // SQL injection
        /<script[^>]*>/i,              // XSS
        /\$\{.*\}/,                    // template injection
        /;\s*(rm|del|format|shutdown)/i, // command injection
      ],

      // Monitored directories (file access)
      watchDirs: options.watchDirs || [],

      // OpenClaw gateway URL
      openclawUrl: options.openclawUrl || 'ws://localhost:18789',
    };

    this._intervals = [];
    this._watchers = [];
    this._failedLogins = [];
    this._connectionTracker = new Map(); // IP → [timestamps]
    this._requestTracker = new Map();    // IP → [timestamps]
    this._threatIdCounter = 0;
  }

  /** Register a WebSocket client to receive threat events */
  addClient(ws) {
    this.clients.add(ws);
    console.log(`[SecurityMonitor] Client connected (${this.clients.size} total)`);

    // Send current active threats
    this.activeThreats.forEach((threat) => {
      ws.send(JSON.stringify({ type: 'threat', ...threat }));
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[SecurityMonitor] Client disconnected (${this.clients.size} total)`);
    });
  }

  /** Start all monitors */
  start() {
    console.log('[SecurityMonitor] Starting security monitors...');

    // 1. System monitor
    this._startSystemMonitor();

    // 2. Network connection monitor
    this._startNetworkMonitor();

    // 3. File watchers
    this._startFileWatchers();

    // 4. Linux-only: Wireshark (tshark) live packet anomaly feeder.
    //    Translates real traffic into in-game robber spawns so non-technical
    //    viewers can "see" what a log line means.
    if (os.platform() === 'linux' && (process.env.ENABLE_TSHARK === '1' || this.config.enableTshark)) {
      this._startLinuxPacketMonitor();
    }

    // 5. Linux-only: firewall/ufw/iptables scan-probe detector.
    //    Passive — watches kernel/firewall logs for nmap-style scans against
    //    this host. No outbound scanning performed.
    if (os.platform() === 'linux' && (process.env.ENABLE_SCAN_DETECT !== '0')) {
      this._startLinuxScanDetector();
    }

    // 6. Heartbeat
    this._intervals.push(setInterval(() => {
      this._broadcast({ type: 'heartbeat', timestamp: Date.now() });
    }, 30000));

    console.log('[SecurityMonitor] All monitors active');
  }

  /** Stop all monitors */
  stop() {
    this._intervals.forEach(i => clearInterval(i));
    this._intervals = [];
    this._watchers.forEach(w => w.close());
    this._watchers = [];
    if (this._tsharkProc) {
      try { this._tsharkProc.kill('SIGTERM'); } catch (_) {}
      this._tsharkProc = null;
    }
  }

  /** Check an HTTP request for suspicious patterns (call from server.js) */
  checkHttpRequest(req) {
    const ip = req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
    const url = req.url || '';
    const method = req.method || 'GET';
    const ua = req.headers?.['user-agent'] || '';
    const body = req._body || ''; // if body was captured

    // Rate limiting
    this._trackRequest(ip);
    const reqCount = this._getRequestCount(ip, 60000);
    if (reqCount > this.config.apiRateLimit) {
      this._emitThreat({
        category: 'brute_force',
        severity: 'high',
        source: ip,
        target: url,
        detail: `Rate limit exceeded: ${reqCount} req/min from ${ip}`,
      });
    }

    // Check URL for suspicious patterns
    const fullInput = `${url} ${body} ${ua}`;
    for (const pattern of this.config.suspiciousPatterns) {
      if (pattern.test(fullInput)) {
        // Determine category based on pattern
        let category = 'api_abuse';
        let severity = 'medium';

        if (/\.\.[\\/]/.test(url)) {
          category = 'file_access';
          severity = 'high';
        }
        if (/etc\/(passwd|shadow)/.test(url) || /\.(env|pem|key)/.test(url)) {
          category = 'data_breach';
          severity = 'critical';
        }
        if (/SELECT|UNION|DROP/i.test(fullInput)) {
          category = 'api_abuse';
          severity = 'critical';
        }
        if (/<script/i.test(fullInput)) {
          category = 'api_abuse';
          severity = 'high';
        }
        if (/;\s*(rm|del|format)/i.test(fullInput)) {
          category = 'shell_exec';
          severity = 'critical';
        }

        this._emitThreat({
          category,
          severity,
          source: ip,
          target: url,
          detail: `${method} ${url.slice(0, 60)} — pattern: ${pattern.source.slice(0, 30)}`,
        });
        break; // one threat per request
      }
    }

    // Check for common attack paths
    const attackPaths = [
      { path: /\/wp-admin|\/wp-login/i, detail: 'WordPress admin probe' },
      { path: /\/phpmyadmin|\/pma/i, detail: 'phpMyAdmin probe' },
      { path: /\/\.git|\/\.svn/i, detail: 'Version control access attempt' },
      { path: /\/admin|\/manager|\/console/i, detail: 'Admin panel probe' },
      { path: /\/api\/.*token|\/api\/.*key/i, detail: 'API key/token probe' },
      { path: /\/etc\/|\/proc\//i, detail: 'System file access attempt' },
      { path: /\/cmd|\/shell|\/exec/i, detail: 'Remote shell probe' },
    ];

    for (const attack of attackPaths) {
      if (attack.path.test(url)) {
        this._emitThreat({
          category: 'network_scan',
          severity: 'medium',
          source: ip,
          target: url,
          detail: `${attack.detail} from ${ip}`,
        });
        break;
      }
    }
  }

  /** Check a failed login attempt */
  checkFailedLogin(ip, username) {
    this._failedLogins.push({ ip, username, timestamp: Date.now() });

    // Clean old entries
    const cutoff = Date.now() - 60000;
    this._failedLogins = this._failedLogins.filter(l => l.timestamp > cutoff);

    // Count recent failures from this IP
    const count = this._failedLogins.filter(l => l.ip === ip).length;
    if (count >= this.config.failedLoginThreshold) {
      this._emitThreat({
        category: 'brute_force',
        severity: count >= 10 ? 'critical' : 'high',
        source: ip,
        target: `user: ${username}`,
        detail: `${count} failed logins in 60s from ${ip} (user: ${username})`,
      });
    }
  }

  /** Check OpenClaw agent events for suspicious behavior */
  checkAgentEvent(event) {
    if (!event) return;

    // Suspicious tool calls
    const dangerousTools = [
      'bash', 'shell', 'exec', 'eval', 'system', 'subprocess',
      'file_write', 'file_delete', 'rm', 'del',
      'network_request', 'curl', 'wget',
      'credential', 'password', 'secret',
    ];

    if (event.stream === 'tool' && event.data) {
      const toolName = (event.data.name || event.data.tool || '').toLowerCase();
      const toolInput = JSON.stringify(event.data.input || event.data.args || '').toLowerCase();

      for (const danger of dangerousTools) {
        if (toolName.includes(danger) || toolInput.includes(danger)) {
          this._emitThreat({
            category: 'shell_exec',
            severity: 'high',
            source: `agent:${event.agentId || 'unknown'}`,
            target: toolName,
            detail: `Agent used dangerous tool: ${toolName}`,
          });
          break;
        }
      }

      // Check for data exfiltration patterns
      if (/curl|wget|fetch|request|http/i.test(toolInput) &&
          /external|api\.|webhook/i.test(toolInput)) {
        this._emitThreat({
          category: 'exfiltration',
          severity: 'critical',
          source: `agent:${event.agentId || 'unknown'}`,
          target: toolName,
          detail: `Agent sending data externally via ${toolName}`,
        });
      }
    }
  }

  // --- Internal monitors ---

  _startSystemMonitor() {
    const isWindows = os.platform() === 'win32';

    const check = () => {
      if (isWindows) {
        // Check Windows Security Event Log for failed logons (Event ID 4625)
        exec(
          'powershell -Command "Get-WinEvent -FilterHashtable @{LogName=\'Security\';Id=4625} -MaxEvents 5 2>$null | Select-Object TimeCreated,Message | ConvertTo-Json"',
          { timeout: 5000, windowsHide: true },
          (err, stdout) => {
            if (err || !stdout.trim()) return;
            try {
              const events = JSON.parse(stdout);
              const arr = Array.isArray(events) ? events : [events];
              arr.forEach(evt => {
                if (evt.TimeCreated) {
                  const eventTime = new Date(evt.TimeCreated).getTime();
                  // Only process events from last poll interval
                  if (Date.now() - eventTime < this.config.systemPollInterval * 1.5) {
                    const msg = evt.Message || '';
                    const ipMatch = msg.match(/Source Network Address:\s*(\S+)/);
                    const userMatch = msg.match(/Account Name:\s*(\S+)/);
                    this.checkFailedLogin(
                      ipMatch ? ipMatch[1] : 'local',
                      userMatch ? userMatch[1] : 'unknown'
                    );
                  }
                }
              });
            } catch (e) { /* parse error, skip */ }
          }
        );

        // Check for suspicious new processes
        exec(
          'powershell -Command "Get-Process | Where-Object {$_.StartTime -gt (Get-Date).AddSeconds(-10)} | Select-Object Name,Id,Path | ConvertTo-Json"',
          { timeout: 5000, windowsHide: true },
          (err, stdout) => {
            if (err || !stdout.trim()) return;
            try {
              const procs = JSON.parse(stdout);
              const arr = Array.isArray(procs) ? procs : [procs];
              const suspicious = ['nc', 'ncat', 'netcat', 'nmap', 'mimikatz', 'psexec',
                'meterpreter', 'reverse', 'keylogger', 'rat', 'backdoor'];
              // Exclude common system processes that contain suspicious substrings
              const safeProcesses = ['powershell', 'pwsh', 'cmd', 'conhost', 'explorer'];
              arr.forEach(proc => {
                const name = (proc.Name || '').toLowerCase();
                if (safeProcesses.some(s => name.includes(s))) return; // skip known safe
                if (suspicious.some(s => name.includes(s))) {
                  this._emitThreat({
                    category: 'process_spawn',
                    severity: 'critical',
                    source: `pid:${proc.Id}`,
                    target: proc.Path || proc.Name,
                    detail: `Suspicious process: ${proc.Name} (PID ${proc.Id})`,
                  });
                }
              });
            } catch (e) { /* skip */ }
          }
        );
      } else {
        // Linux/Mac: check auth.log for failed SSH attempts
        exec(
          'tail -20 /var/log/auth.log 2>/dev/null || tail -20 /var/log/secure 2>/dev/null',
          { timeout: 3000, windowsHide: true },
          (err, stdout) => {
            if (err || !stdout) return;
            const lines = stdout.split('\n');
            lines.forEach(line => {
              if (/Failed password|authentication failure/i.test(line)) {
                const ipMatch = line.match(/from\s+(\d+\.\d+\.\d+\.\d+)/);
                const userMatch = line.match(/for\s+(?:invalid user\s+)?(\S+)/);
                this.checkFailedLogin(
                  ipMatch ? ipMatch[1] : 'unknown',
                  userMatch ? userMatch[1] : 'unknown'
                );
              }
            });
          }
        );
      }
    };

    check();
    this._intervals.push(setInterval(check, this.config.systemPollInterval));
  }

  _startNetworkMonitor() {
    const isWindows = os.platform() === 'win32';

    const check = () => {
      const cmd = isWindows
        ? 'netstat -an | findstr ESTABLISHED'
        : 'netstat -an 2>/dev/null | grep ESTABLISHED || ss -tn state established 2>/dev/null';

      exec(cmd, { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return;

        const connections = new Map(); // IP → count
        const lines = stdout.split('\n');
        lines.forEach(line => {
          // Extract foreign address
          const parts = line.trim().split(/\s+/);
          let foreignAddr = '';
          if (isWindows && parts.length >= 3) {
            foreignAddr = parts[2]; // Foreign Address column
          } else if (parts.length >= 5) {
            foreignAddr = parts[4]; // peer column
          }

          // Extract IP
          const ipMatch = foreignAddr.match(/^(\d+\.\d+\.\d+\.\d+)/);
          if (ipMatch) {
            const ip = ipMatch[1];
            // Skip local/private IPs
            if (ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '0.0.0.0') return;
            connections.set(ip, (connections.get(ip) || 0) + 1);
          }
        });

        // Check for port scanning (many connections from one IP)
        connections.forEach((count, ip) => {
          if (count >= this.config.portScanThreshold) {
            this._emitThreat({
              category: 'network_scan',
              severity: count >= 20 ? 'critical' : 'high',
              source: ip,
              target: 'multiple ports',
              detail: `${count} connections from ${ip} — possible port scan`,
            });
          }
        });
      });
    };

    check();
    this._intervals.push(setInterval(check, this.config.networkPollInterval));
  }

  _startFileWatchers() {
    this.config.watchDirs.forEach(dir => {
      try {
        if (!fs.existsSync(dir)) return;
        const watcher = fs.watch(dir, { recursive: true, persistent: false }, (eventType, filename) => {
          if (!filename) return;
          const filePath = path.join(dir, filename);

          // Check for sensitive file access
          const sensitivePatterns = [
            /\.env$/i,
            /\.pem$/i,
            /\.key$/i,
            /password/i,
            /secret/i,
            /credential/i,
            /\.ssh/i,
            /id_rsa/i,
          ];

          for (const pattern of sensitivePatterns) {
            if (pattern.test(filename)) {
              this._emitThreat({
                category: 'data_breach',
                severity: 'critical',
                source: 'filesystem',
                target: filePath,
                detail: `Sensitive file ${eventType}: ${filename}`,
              });
              break;
            }
          }
        });
        this._watchers.push(watcher);
        console.log(`[SecurityMonitor] Watching: ${dir}`);
      } catch (err) {
        console.warn(`[SecurityMonitor] Can't watch ${dir}:`, err.message);
      }
    });
  }

  // --- Linux live security feeders (Wireshark + scan detection) ---

  /**
   * Linux packet monitor — spawns `tshark` (Wireshark CLI) as a long-lived
   * child process and parses its one-line-per-packet output. Each suspicious
   * pattern becomes a threat event → robber spawns in the game.
   *
   * Requirements (documented in docs/SETUP.md):
   *   - tshark installed (`sudo apt install tshark`)
   *   - Non-root capture: `sudo setcap cap_net_raw,cap_net_admin+eip $(which dumpcap)`
   *   - Or run the game server as a user in the `wireshark` group
   *
   * Toggle with env:
   *   ENABLE_TSHARK=1          — opt-in, off by default
   *   TSHARK_IFACE=any         — interface name (default "any")
   *   TSHARK_BPF="not port 22" — optional extra BPF filter
   */
  _startLinuxPacketMonitor() {
    const iface = process.env.TSHARK_IFACE || this.config.tsharkIface || 'any';
    const extraFilter = process.env.TSHARK_BPF || this.config.tsharkBpf || '';

    // tshark fields: time, src ip, dst ip, proto, src port, dst port, tcp flags,
    // http host, http user-agent, dns query, packet length
    const fields = [
      '-T', 'fields',
      '-E', 'separator=|',
      '-E', 'occurrence=f',
      '-e', 'frame.time_epoch',
      '-e', 'ip.src',
      '-e', 'ip.dst',
      '-e', '_ws.col.Protocol',
      '-e', 'tcp.srcport',
      '-e', 'tcp.dstport',
      '-e', 'tcp.flags',
      '-e', 'http.host',
      '-e', 'http.user_agent',
      '-e', 'dns.qry.name',
      '-e', 'frame.len',
    ];

    // BPF filter: skip our own game/LM Studio traffic so we don't spam events
    // on every WebSocket frame, but keep it broad enough to see real badness.
    const baseBpf = 'not (host 127.0.0.1 and (port 8080 or port 1234 or port 18789))';
    const bpf = extraFilter ? `${baseBpf} and (${extraFilter})` : baseBpf;

    let tshark;
    try {
      tshark = spawn('tshark', ['-i', iface, '-l', '-n', '-Q', ...fields, '-f', bpf], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      console.warn('[SecurityMonitor] tshark failed to spawn — is it installed?', err.message);
      return;
    }

    tshark.on('error', (err) => {
      console.warn('[SecurityMonitor] tshark error:', err.message);
    });
    tshark.stderr.on('data', (buf) => {
      const msg = buf.toString().trim();
      // Most tshark stderr is harmless ("Capturing on 'any'", "Running as user..."),
      // only log actual errors.
      if (/error|permission|denied|failed/i.test(msg)) {
        console.warn('[SecurityMonitor] tshark stderr:', msg.slice(0, 200));
      }
    });

    // Line buffer — tshark emits one line per packet
    let buf = '';
    const synTracker = new Map();  // src ip → [timestamps] for SYN-flood detection
    const dnsTracker = new Map();  // src ip → [long-name counts] for DNS tunneling

    tshark.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        try {
          this._parseTsharkLine(line, synTracker, dnsTracker);
        } catch (_) { /* malformed line, skip */ }
      }
    });

    tshark.on('exit', (code) => {
      console.warn(`[SecurityMonitor] tshark exited (code=${code}) — live packet monitor stopped`);
    });

    this._tsharkProc = tshark;
    console.log(`[SecurityMonitor] 🔍 tshark live packet monitor active on iface="${iface}"`);
  }

  /**
   * Parse one tshark line and emit a threat if suspicious.
   * Fields (pipe-separated):
   *   0 time, 1 src, 2 dst, 3 proto, 4 srcPort, 5 dstPort, 6 tcpFlags,
   *   7 httpHost, 8 httpUA, 9 dnsName, 10 frameLen
   */
  _parseTsharkLine(line, synTracker, dnsTracker) {
    if (!line || !line.includes('|')) return;
    const f = line.split('|');
    const src = f[1];
    const dst = f[2];
    const proto = f[3] || '';
    const tcpFlags = f[6] || '';
    const httpHost = f[7] || '';
    const httpUA = f[8] || '';
    const dnsName = f[9] || '';
    const frameLen = parseInt(f[10] || '0', 10);
    if (!src) return;

    const now = Date.now();

    // 1. SYN flood detection — many SYN-only packets in a short window
    //    TCP flag 0x02 = SYN only. Real connections follow with SYN-ACK (0x12).
    if (tcpFlags === '0x02' || tcpFlags === '0x0002' || tcpFlags === '2') {
      const list = synTracker.get(src) || [];
      list.push(now);
      // Keep only last 10 seconds
      while (list.length && now - list[0] > 10000) list.shift();
      synTracker.set(src, list);
      if (list.length >= 30) {
        this._emitThreat({
          category: 'scan_probe',
          severity: list.length >= 60 ? 'critical' : 'high',
          source: src,
          target: dst || 'this host',
          detail: `tshark: ${list.length} SYN packets in 10s from ${src} — nmap-style scan`,
        });
        // Reset so we don't spam — dedup upstream handles short-term duplicates
        synTracker.set(src, []);
      }
    }

    // 2. Plaintext HTTP password in URL (?password=, ?token=, ?apikey=)
    if (proto.includes('HTTP') && httpHost) {
      if (/[?&](password|passwd|pwd|token|apikey|api_key|secret)=/i.test(httpUA) ||
          /[?&](password|passwd|pwd|token|apikey|api_key|secret)=/i.test(httpHost)) {
        this._emitThreat({
          category: 'packet_anomaly',
          severity: 'high',
          source: src,
          target: httpHost,
          detail: `tshark: plaintext credential in HTTP to ${httpHost.slice(0, 40)}`,
        });
      }
    }

    // 3. DNS tunneling — unusually long subdomain names repeated from same src
    if (proto.includes('DNS') && dnsName && dnsName.length > 50) {
      const list = dnsTracker.get(src) || [];
      list.push(now);
      while (list.length && now - list[0] > 30000) list.shift();
      dnsTracker.set(src, list);
      if (list.length >= 5) {
        this._emitThreat({
          category: 'packet_anomaly',
          severity: 'critical',
          source: src,
          target: dnsName.slice(0, 60),
          detail: `tshark: DNS tunneling? ${list.length} long queries in 30s (${dnsName.length} chars)`,
        });
        dnsTracker.set(src, []);
      }
    }

    // 4. Large outbound transfer to unknown external IP
    //    Watch for >1MB single-packet frames (jumbo / bulk) — usually suspicious
    if (frameLen > 100000 && dst && !/^(10\.|192\.168\.|172\.|127\.|fe80|::1)/.test(dst)) {
      this._emitThreat({
        category: 'exfiltration',
        severity: 'high',
        source: src || 'local',
        target: dst,
        detail: `tshark: large (${Math.round(frameLen / 1024)} KB) packet to external ${dst}`,
      });
    }

    // 5. Suspicious user agent (sqlmap, nmap, nikto, hydra, etc.)
    if (httpUA && /(sqlmap|nmap|nikto|hydra|dirbuster|gobuster|metasploit|havij|wpscan)/i.test(httpUA)) {
      this._emitThreat({
        category: 'api_abuse',
        severity: 'critical',
        source: src,
        target: httpHost || 'web server',
        detail: `tshark: attack tool in user-agent — "${httpUA.slice(0, 40)}"`,
      });
    }
  }

  /**
   * Linux passive scan-probe detector — watches kernel/firewall logs for
   * nmap-style scans against this host. Purely passive (no outbound scan).
   *
   * Reads journalctl and /var/log/ufw.log / /var/log/kern.log for
   * "BLOCK"/"[UFW BLOCK]" patterns clustered from a single source IP.
   */
  _startLinuxScanDetector() {
    const scanTracker = new Map(); // src ip → [{port, time}]

    const checkFirewallLogs = () => {
      // Try journalctl first (systemd), fall back to ufw.log, then kern.log.
      const cmd = 'journalctl -k --since="30 seconds ago" --no-pager 2>/dev/null || ' +
                  'tail -100 /var/log/ufw.log 2>/dev/null || ' +
                  'tail -100 /var/log/kern.log 2>/dev/null';
      exec(cmd, { timeout: 4000 }, (err, stdout) => {
        if (err || !stdout) return;
        const lines = stdout.split('\n');
        const now = Date.now();
        for (const line of lines) {
          // Match UFW BLOCK / iptables DROP patterns:
          //   "[UFW BLOCK] IN=eth0 OUT= MAC=... SRC=1.2.3.4 DST=5.6.7.8 ... DPT=22 ..."
          if (!/BLOCK|DROP|REJECT/.test(line)) continue;
          const srcMatch = line.match(/SRC=(\d+\.\d+\.\d+\.\d+)/);
          const dptMatch = line.match(/DPT=(\d+)/);
          if (!srcMatch) continue;
          const src = srcMatch[1];
          const port = dptMatch ? parseInt(dptMatch[1], 10) : 0;
          // Skip local/RFC1918
          if (src.startsWith('127.') || src === '0.0.0.0') continue;

          const list = scanTracker.get(src) || [];
          list.push({ port, time: now });
          // Window: last 20 seconds
          while (list.length && now - list[0].time > 20000) list.shift();
          scanTracker.set(src, list);

          // Distinct ports probed — classic nmap signature
          const distinctPorts = new Set(list.map(e => e.port)).size;
          if (distinctPorts >= 5) {
            this._emitThreat({
              category: 'scan_probe',
              severity: distinctPorts >= 15 ? 'critical' : 'high',
              source: src,
              target: `${distinctPorts} ports`,
              detail: `Firewall blocked ${list.length} probes on ${distinctPorts} ports from ${src} — nmap scan`,
            });
            scanTracker.set(src, []); // reset
          }
        }
      });
    };

    checkFirewallLogs();
    this._intervals.push(setInterval(checkFirewallLogs, 15000));
    console.log('[SecurityMonitor] 🛡 Linux scan detector active (watching firewall/kernel logs)');
  }

  // --- Threat emission ---

  _emitThreat(threat) {
    const threatId = `threat-${++this._threatIdCounter}-${Date.now()}`;
    const fullThreat = {
      type: 'threat',
      threatId,
      ...threat,
      timestamp: Date.now(),
    };

    // Dedup: don't spam same threat category+source in 5s window
    const dedupKey = `${threat.category}:${threat.source}`;
    const existing = Array.from(this.activeThreats.values()).find(t =>
      `${t.category}:${t.source}` === dedupKey &&
      Date.now() - t.timestamp < 5000
    );
    if (existing) return;

    this.activeThreats.set(threatId, fullThreat);
    this.threatLog.push(fullThreat);

    // Auto-resolve after 30 seconds (unless re-triggered)
    setTimeout(() => {
      if (this.activeThreats.has(threatId)) {
        this.activeThreats.delete(threatId);
        this._broadcast({ type: 'threat-resolved', threatId });
      }
    }, 30000);

    // Broadcast to all connected game clients
    this._broadcast(fullThreat);
  }

  _broadcast(msg) {
    const data = JSON.stringify(msg);
    this.clients.forEach(ws => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(data);
        }
      } catch (e) {
        // client may have disconnected
      }
    });
  }

  // --- Request tracking ---

  _trackRequest(ip) {
    if (!this._requestTracker.has(ip)) {
      this._requestTracker.set(ip, []);
    }
    this._requestTracker.get(ip).push(Date.now());
  }

  _getRequestCount(ip, windowMs) {
    const timestamps = this._requestTracker.get(ip) || [];
    const cutoff = Date.now() - windowMs;
    const recent = timestamps.filter(t => t > cutoff);
    this._requestTracker.set(ip, recent); // clean up old entries
    return recent.length;
  }
}

module.exports = SecurityMonitorServer;

// --- Standalone mode ---
if (require.main === module) {
  console.log('Security Monitor running in standalone mode');
  console.log('Integrate with server.js for full functionality');
  const monitor = new SecurityMonitorServer({
    watchDirs: [process.cwd()],
  });
  monitor.start();
}
