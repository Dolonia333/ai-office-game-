param(
  [switch]$Install,
  [switch]$Build
)

$ErrorActionPreference = "Stop"

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $name"
  }
}

Write-Host ""
Write-Host "Starting OpenClaw + Star-Office-UI..." -ForegroundColor Cyan
Write-Host ""

# Prereqs
Require-Command node
Require-Command pnpm
Require-Command python

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$openclaw = Join-Path $root "openclaw"
$star = Join-Path $root "Star-Office-UI"

if (-not (Test-Path $openclaw)) { throw "Folder not found: $openclaw" }
if (-not (Test-Path $star)) { throw "Folder not found: $star" }

if ($Install) {
  Write-Host "[OpenClaw] pnpm install" -ForegroundColor Yellow
  Push-Location $openclaw
  pnpm install
  Pop-Location

  Write-Host "[Star-Office-UI] pip install -r backend/requirements.txt" -ForegroundColor Yellow
  Push-Location $star
  python -m pip install -r backend/requirements.txt
  if (-not (Test-Path "state.json") -and (Test-Path "state.sample.json")) {
    Copy-Item "state.sample.json" "state.json"
  }
  Pop-Location
}

if ($Build) {
  Write-Host "[OpenClaw] build + ui:build" -ForegroundColor Yellow
  Push-Location $openclaw
  pnpm build
  pnpm ui:build
  Pop-Location
}

# Start OpenClaw Gateway
Write-Host "[OpenClaw] starting gateway in new window..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$openclaw`"; pnpm openclaw gateway"
)

# Start Star-Office-UI backend
Write-Host "[Star-Office-UI] starting backend in new window..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd `"$star`"; if (!(Test-Path state.json) -and (Test-Path state.sample.json)) { Copy-Item state.sample.json state.json }; cd backend; python app.py"
)

Write-Host ""
Write-Host "OpenClaw UI:       http://localhost:18789/?token=test-token-12345" -ForegroundColor Cyan
Write-Host "Star Office UI:    http://127.0.0.1:19000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tip: Star Office test state:" -ForegroundColor DarkGray
Write-Host "  cd `"$star`"" -ForegroundColor DarkGray
Write-Host "  python set_state.py writing `"organizing catalogs`"" -ForegroundColor DarkGray
Write-Host ""

