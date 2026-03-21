param(
  [string]$Root = "c:\Users\zionv\OneDrive\Desktop\multbot",
  [string]$OutDir = "c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game\out\sheet_extract",
  [int]$MinPixels = 30,
  [int]$Pad = 1,
  [int]$BgTol = 2,
  [switch]$Snap
)

$ErrorActionPreference = "Stop"

$pythonScript = Join-Path $Root "pixel-office-game\scripts\extract_sheet_objects.py"
if (-not (Test-Path $pythonScript)) {
  throw "Extractor not found: $pythonScript"
}

$sheetRoot = Join-Path $Root "pixel game stuff\pixel game assets and stuff"
if (-not (Test-Path $sheetRoot)) {
  throw "Sheet root not found: $sheetRoot"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$pngs = Get-ChildItem -Path $sheetRoot -Recurse -Filter *.png |
  Where-Object {
    $_.FullName -notmatch "\\4_Modern_Office_singles\\" -and
    $_.Name -match "(16x16|32x32|48x48|TILESET|Tileset|Office|Modern|_32|_48|_16)"
  }

if (-not $pngs) {
  Write-Host "No matching sheets found under $sheetRoot"
  exit 0
}

foreach ($png in $pngs) {
  $grid = 32
  if ($png.Name -match "16x16|_16") { $grid = 16 }
  elseif ($png.Name -match "48x48|_48") { $grid = 48 }
  elseif ($png.Name -match "32x32|_32") { $grid = 32 }

  $safeName = ($png.BaseName -replace "[^a-zA-Z0-9._-]", "_")
  $outJson = Join-Path $OutDir ("{0}.extract.json" -f $safeName)

  $args = @(
    $pythonScript,
    $png.FullName,
    "--grid", $grid,
    "--bg", "auto",
    "--bgTol", $BgTol,
    "--minAlpha", 0,
    "--minPixels", $MinPixels,
    "--pad", $Pad,
    "--collisionMode", "back_strip",
    "--collisionH", 0.22,
    "--collisionW", 0.70,
    "--out", $outJson
  )

  if ($Snap) {
    $args += "--snap"
  }

  Write-Host "Extracting $($png.Name) (grid=$grid) -> $outJson"
  python @args
}

Write-Host "Done. JSON outputs in: $OutDir"
