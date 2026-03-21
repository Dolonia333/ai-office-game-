$ErrorActionPreference = "Stop"

param(
  [string]$DesignsDir = "C:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff\Modern_Office_Revamped_v1.2\6_Office_Designs",
  [string]$OutDir = "C:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game\data\world\prefabs",
  [string]$AsepriteExe = $env:ASEPRITE_EXE
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "DesignsDir: $DesignsDir"
Write-Host "OutDir: $OutDir"

$aseFiles = Get-ChildItem -Path $DesignsDir -Filter "*.aseprite" -ErrorAction SilentlyContinue
if (-not $aseFiles -or $aseFiles.Count -eq 0) {
  throw "No .aseprite files found in $DesignsDir"
}

function Write-PrefabJsonFromGif($gifPath, $prefabPath, $id) {
  # Fallback: if Aseprite CLI isn't available, use the .gif as a prefab background image only.
  # Props/walls are filled later by the generator/renderer.
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($gifPath)
  $w = $img.Width
  $h = $img.Height
  $img.Dispose()

  $prefab = @{
    id = $id
    source = @{ type = "gif_fallback"; file = $gifPath }
    canvas = @{ width = $w; height = $h }
    tileSize = 16
    anchors = @{
      doors = @(
        @{ side = "left"; x = 0; y = [int]($h/2) },
        @{ side = "right"; x = $w; y = [int]($h/2) }
      )
    }
    layers = @(
      @{ name = "background"; kind = "image"; file = $gifPath }
    )
    objects = @()
  }

  $prefab | ConvertTo-Json -Depth 10 | Set-Content -Path $prefabPath -Encoding UTF8
}

foreach ($ase in $aseFiles) {
  $base = [System.IO.Path]::GetFileNameWithoutExtension($ase.Name)
  $id = $base.ToLower()
  $pngOut = Join-Path $OutDir "$base.png"
  $jsonOut = Join-Path $OutDir "$base.aseprite.json"
  $prefabOut = Join-Path $OutDir "$base.prefab.json"

  if ($AsepriteExe -and (Test-Path $AsepriteExe)) {
    Write-Host "Exporting via Aseprite CLI: $($ase.FullName)"
    & $AsepriteExe -b $ase.FullName --sheet $pngOut --data $jsonOut --format json-array --list-tags --list-slices | Out-Null

    # Minimal prefab wrapper; we keep raw Aseprite JSON for later parsing.
    $prefab = @{
      id = $id
      source = @{ type = "aseprite_cli"; aseprite = $ase.FullName; sheetPng = $pngOut; dataJson = $jsonOut }
      tileSize = 16
      anchors = @{ doors = @() }
      objects = @()
    }
    $prefab | ConvertTo-Json -Depth 10 | Set-Content -Path $prefabOut -Encoding UTF8
  } else {
    # Fallback: use corresponding GIF as the prefab background.
    $gif = Join-Path $DesignsDir "$base.gif"
    if (-not (Test-Path $gif)) {
      throw "Aseprite CLI not configured and no GIF fallback found for $base"
    }
    Write-Host "Aseprite CLI not configured. Writing GIF-based prefab: $gif"
    Write-PrefabJsonFromGif -gifPath $gif -prefabPath $prefabOut -id $id
  }
}

Write-Host "Done. Prefabs written to $OutDir"

