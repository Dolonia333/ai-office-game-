## Quickstart: OpenClaw + Star-Office-UI (Windows)

This repo contains multiple projects. If your goal is **OpenClaw (assistant) + Star-Office-UI (pixel status office)**, use the launcher script:

### 1) One-command launcher

From PowerShell in `c:\Users\zionv\OneDrive\Desktop\multbot`:

```powershell
.\RUN_OPENCLAW_AND_STAR_OFFICE.ps1 -Install -Build
```

After the first run, you can start without reinstall/rebuild:

```powershell
.\RUN_OPENCLAW_AND_STAR_OFFICE.ps1
```

### 2) URLs

- **OpenClaw UI**: `http://localhost:18789/?token=test-token-12345`
- **Star Office UI**: `http://127.0.0.1:19000`

### 3) Test Star Office state switching

In another terminal:

```powershell
cd .\Star-Office-UI
python set_state.py writing "organizing catalogs"
python set_state.py syncing "syncing progress"
python set_state.py idle "standing by"
```

### Notes

- OpenClaw uses `pnpm` + Node 22+.
- Star-Office-UI uses Python + `backend/requirements.txt`.

