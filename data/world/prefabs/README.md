# Prefabs

This folder holds **prefab templates** used by the seeded world generator.

## Source
- Primary: `Modern_Office_Revamped_v1.2/6_Office_Designs/*.aseprite` exported via Aseprite CLI.\n+- Fallback: `Office_Design_*.gif` used as a background-only prefab when Aseprite CLI is not available.\n+
## Export
Run:

```powershell
$env:ASEPRITE_EXE = \"C:\\Path\\To\\aseprite.exe\"  # optional\n+pwsh -File .\\pixel-office-game\\scripts\\export_aseprite_prefabs.ps1\n+```

Outputs:
- `*.prefab.json` (generator input)\n+- Optionally `*.png` + `*.aseprite.json` if Aseprite CLI is configured.\n+
