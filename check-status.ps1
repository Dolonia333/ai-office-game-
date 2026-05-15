Get-Process node,cloudflared,python -ErrorAction SilentlyContinue | Group-Object ProcessName | ForEach-Object { Write-Host "$($_.Name): $($_.Count) process(es)" }
Write-Host ""
Write-Host "Watchdog:"
$wd = Get-Process powershell -ErrorAction SilentlyContinue
Write-Host "  PowerShell processes: $($wd.Count)"
Write-Host ""
Write-Host "Ports:"
netstat -ano | Select-String "LISTENING" | Select-String ":1878[0-9] " | ForEach-Object { Write-Host "  $_" }
