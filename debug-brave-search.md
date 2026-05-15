# OpenClaw Brave Search Debug Guide

## Issue Analysis

You're getting `422 Unprocessable Entity` with `SUBSCRIPTION_TOKEN_INVALID`, but your Brave API key works manually. The OpenClaw code **IS** correctly setting the `X-Subscription-Token` header.

## Root Cause

The issue is **configuration/environment variable mismatch**, not a code problem.

## ✅ Code Verification

OpenClaw correctly sends the header (lines 422-424 in `web-search.ts`):
```typescript
headers: {
  Accept: "application/json",
  "X-Subscription-Token": params.apiKey,
},
```

## 🐛 The Problem

OpenClaw expects the environment variable to be `BRAVE_API_KEY` (not `BRAVE_SEARCH_API_KEY`).

Check line 127 in `web-search.ts`:
```typescript
const fromEnv = (process.env.BRAVE_API_KEY ?? "").trim();
```

## 🔧 Solution Steps

### Step 1: Set Correct Environment Variable

**Windows PowerShell:**
```powershell
# Remove any incorrect env vars
Remove-Item Env:BRAVE_SEARCH_API_KEY -ErrorAction SilentlyContinue

# Set the correct one
setx BRAVE_API_KEY "BSAgPTfHr7FVrJGJj37uJMQcIgP0aB_"

# Or for current session only:
$env:BRAVE_API_KEY = "BSAgPTfHr7FVrJGJj37uJMQcIgP0aB_"
```

### Step 2: Restart Gateway

Environment variables only apply to **new processes**. You must fully restart:

```bash
# Stop gateway
pkill -f openclaw
# Or use the Mac app "Stop Gateway" button

# Start gateway
openclaw gateway
```

### Step 3: Verify Configuration

```bash
openclaw doctor
```

Should show:
```
Web Search Provider: brave
Subscription Token: detected
```

### Step 4: Alternative - Config File Method

If env vars don't work, put it directly in config:

```json5
{
  "tools": {
    "web": {
      "search": {
        "enabled": true,
        "provider": "brave",
        "apiKey": "BSAgPTfHr7FVrJGJj37uJMQcIgP0aB_",
        "maxResults": 5,
        "timeoutSeconds": 30
      }
    }
  }
}
```

Location: `~/.openclaw/config.json`

### Step 5: Test

```bash
# This should work now without disconnecting
openclaw chat "search for latest AI news"
```

## Common Gotchas

1. **Wrong env var name**: Must be `BRAVE_API_KEY` not `BRAVE_SEARCH_API_KEY`
2. **Not restarting**: Env vars don't apply to running processes
3. **Plan type**: Make sure you have "Data for Search" plan, not "Data for AI"
4. **Config location**: Config should be at `~/.openclaw/config.json`

## Debugging Commands

```bash
# Check if env var is set
echo $BRAVE_API_KEY

# Check OpenClaw config
openclaw config get tools.web.search

# Test with verbose logging
OPENCLAW_LOG_LEVEL=debug openclaw gateway
```

## Expected Behavior After Fix

- `openclaw doctor` shows "Subscription Token: detected"
- `web_search` tool works without errors
- No more "disconnected (1006)" in UI
- No more `SUBSCRIPTION_TOKEN_INVALID` errors