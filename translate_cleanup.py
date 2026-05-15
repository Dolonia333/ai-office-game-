#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def patch(path, replacements):
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    for old, new in replacements:
        c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)
    hi = re.compile(r'[\u3040-\u30ff\uff65-\uff9f]')
    remaining = [l.strip() for l in c.split('\n') if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l)]
    print(f'{path.split(chr(92))[-1]}: {len(remaining)} non-Japanese CJK lines')
    for l in remaining[:20]:
        print(f'  {l[:120]}')

# ── index.html final fixes ──────────────────────────────────────────────────
patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html', [
    # CSS comment with curly quotes
    ('避免"框比地图大"', 'avoiding frame-larger-than-map issue'),
    # gemini api doc link (truncated line, just the Chinese part)
    ('📘 如何申请 Google API Key', '📘 How to get a Google API Key'),
    # authDefaultPassHint truncated
    ('1234（可随时', '1234 (can be changed'),
    # homeFavEmpty with nested quotes  
    ("click '⭐ Save Favorite'", "click ⭐ Save Favorite"),
    # JS verify message that got partially translated
    ("'❌ 请Enter passcode'", "'❌ Please enter the passcode'"),
    # JS comment with curly quotes
    ('避免一直卡在"加载中"遮罩', 'avoid getting stuck on loading overlay'),
    # asset item hidden indicator
    ("' ｜ 已隐藏'", "' | Hidden'"),
    # JS comments with curly quotes
    ('仅返回"是精灵表"的信号，单帧尺寸后续自动推断', "only signal 'is spritesheet'; single-frame size inferred later"),
    # thumbnail comment
    ('// 先画静态缩略图，再尝试对精灵表做逐帧预览', '// First draw static thumbnail, then try frame-by-frame preview for spritesheets'),
])

# ── invite.html final fix ───────────────────────────────────────────────────
patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\invite.html', [
    ('把Invite Link + join key 一起发给你的 OpenClaw，并说"帮我加入海辛办公室"。', 
     'Send the Invite Link + join key to your OpenClaw and say "Help me join the office".'),
])

# ── office-agent-push.py final fixes ───────────────────────────────────────
patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\office-agent-push.py', [
    ('# 自动状态守护：当本地状态文件不存在或长期不更新时，自动回 idle，避免"假Working"',
     '# Auto state guardian: if local state file is missing or stale, auto-revert to idle (prevent false "Working")'),
    ('# 只接受"状态文件"结构；避免误把 office-agent-state.json（仅缓存 agentId）当状态源',
     '# Only accept state-file structure; avoid treating office-agent-state.json (which only caches agentId) as a state source'),
    ('# detail 兜底纠偏，确保"工作/休息/报警"能正确落区',
     '# detail fallback correction to ensure working/resting/alert states route correctly'),
])

print('\nCleanup done.')
