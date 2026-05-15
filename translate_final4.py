#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

lq = '\u201c'
rq = '\u201d'

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
        print(f'  {repr(l[:130])}')

patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html', [
    # CSS comment: mixed partial translation
    ('/* 边框改为直接贴合画布内部，avoiding frame-larger-than-map issue */', '/* Border fits directly inside canvas (avoiding frame-larger-than-map issue) */'),
    # btnHomeFavorite already English, skip
    # homeFavEmpty
    ("homeFavEmpty: 'No favorites yet, click \u2b50 Save Favorite'", "homeFavEmpty: 'No favorites yet — click ⭐ Save Favorite first'"),
    # gemini hint continuation
    # These lines are truncated in output; the issue is they contain Chinese somewhere
    # Let's patch known fragments
    ('geminiApiDoc: \'📘 How to get a Google API Key\',', "geminiApiDoc: '📘 How to get a Google API Key',"),
    # Loading overlay comment with mixed
    ('// 兜底：某些移动网络/CDN 抖动时，avoid getting stuck on loading overlay', '// Fallback: avoid getting stuck on loading overlay on flaky mobile/CDN'),
    # Comments
    ('// 记录 body scroll 位置，drawer Close时恢复', '// Record body scroll position; restore when drawer closes'),
    ('// 移动端 body 锁定：打开时冻结滚动位置，Close时恢复', '// Mobile body lock: freeze scroll position on open, restore on close'),
    ('// Guest Agent Leave房间', '// Guest Agent leaving the room'),
    ('// 优先按 agentId 清理，避免重名误伤', '// Prefer clearing by agentId to avoid collateral removal with same name'),
    ('// demo agent 没在后端也允许本地隐藏', '// Allow local hide for demo agents not present in backend'),
    # isDemo line with agent name
    ("|| agent.name === 'Nika' || ag", "|| agent.name === 'Nika' || ag"),  # already English, skip
])

patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\office-agent-push.py', [
    ('# 自动状态守护：if local state file', '# Auto state guardian: if local state file'),
])

print('\nDone.')
