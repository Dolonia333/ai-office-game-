# Test various canvas paths
$paths = @(
    "/__openclaw__/canvas/",
    "/__openclaw__/canvas/index.html",
    "/__moltbot__/canvas/",
    "/__moltbot__/canvas/index.html",
    "/canvas/",
    "/canvas/index.html"
)
foreach ($p in $paths) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:18789$p" -UseBasicParsing -TimeoutSec 3
        Write-Host "$p -> $($r.StatusCode) ($($r.Content.Length) bytes)"
    } catch {
        $status = "Error"
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        Write-Host "$p -> $status"
    }
}

# Also check if canvas host runs on separate port
try {
    $r = Invoke-WebRequest -Uri "http://localhost:18793/" -UseBasicParsing -TimeoutSec 3
    Write-Host "`nPort 18793 root -> $($r.StatusCode)"
} catch {
    Write-Host "`nPort 18793 -> not responding"
}
