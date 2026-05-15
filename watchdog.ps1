# OpenClaw Service Watchdog
# Monitors gateway + bridge + cloudflared, restarts if they die.
# Checks every 15 seconds.

$ErrorActionPreference = "SilentlyContinue"

$env:AGENT_TOKEN = "rvJ4Odm7EYmHOxbEtO6dwUIQLv55aYybAyU3uZw6880"
$GatewayDir = "C:\Users\zionv\OneDrive\Desktop\multbot\openclaw"
$BridgeScript = "C:\Users\zionv\OneDrive\Desktop\multbot\openclaw\supabase-bridge\secure-bridge.py"
$CloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

function Test-Port($port) {
    $result = netstat -ano | Select-String "LISTENING" | Select-String ":$port "
    return $null -ne $result
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Watchdog started"

while ($true) {
    # Check bridge on port 18790
    if (-not (Test-Port 18790)) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Bridge down - restarting..."
        Start-Process -FilePath "python" -ArgumentList $BridgeScript -WindowStyle Minimized
        Start-Sleep -Seconds 3
    }

    # Check gateway on port 18789
    if (-not (Test-Port 18789)) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Gateway down - restarting..."
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "set AGENT_TOKEN=$env:AGENT_TOKEN && cd /d $GatewayDir && npm start -- gateway" -WindowStyle Minimized
        Start-Sleep -Seconds 10
    }

    # Check cloudflared tunnel
    $cf = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
    if (-not $cf) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cloudflare tunnel down - restarting..."
        Start-Process -FilePath $CloudflaredExe -ArgumentList "tunnel", "run" -WindowStyle Minimized
        Start-Sleep -Seconds 5
    }

    Start-Sleep -Seconds 15
}
