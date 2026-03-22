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

    // 4. Heartbeat
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
          { timeout: 5000 },
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
          { timeout: 5000 },
          (err, stdout) => {
            if (err || !stdout.trim()) return;
            try {
              const procs = JSON.parse(stdout);
              const arr = Array.isArray(procs) ? procs : [procs];
              const suspicious = ['nc', 'ncat', 'netcat', 'nmap', 'mimikatz', 'psexec',
                'meterpreter', 'reverse', 'shell', 'keylogger', 'rat', 'backdoor'];
              arr.forEach(proc => {
                const name = (proc.Name || '').toLowerCase();
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
          { timeout: 3000 },
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

      exec(cmd, { timeout: 5000 }, (err, stdout) => {
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
        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
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
