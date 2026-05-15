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
    for l in remaining[:15]:
        print(f'  {repr(l[:120])}')

lq = '\u201c'  # "
rq = '\u201d'  # "

# ── index.html ──────────────────────────────────────────────────────────────
patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html', [
    # CSS comment with curly quotes
    (f'避免{lq}框比地图大{rq}', 'avoiding frame-larger-than-map issue'),
    # authDefaultPassHint trailing Chinese
    ('1234 (can be updated让我帮你改，建议改成强Password）', '1234 (can be changed any time)'),
    # btnDIY continuation
    ("btnDIY: '🪚 DIY'", "btnDIY: '🪚 DIY'"),
    # uploadPending + uploadTarget
    ("uploadPending: '待Upload'", "uploadPending: 'Pending Upload'"),
    ("uploadTarget: '目标'", "uploadTarget: 'Target'"),
    # Remaining two Japanese lines mixed in (assetHide/Show, coords) – these are JA locale, leave
    # Comments with curly quotes
    (f'避免一直卡在{lq}加载中{rq}遮罩', 'avoid getting stuck on loading overlay'),
    (f'仅返回{lq}是精灵表{rq}的信号，单帧尺寸后续自动推断', "only signal 'is spritesheet'; single-frame size inferred later"),
    # Asset load failed message with curly quotes
    (f'❌ 资产Failed to load，请点{lq}刷新{rq}重试', '❌ Asset load failed, click Refresh to retry'),
    # Comments that got partially translated leaving Chinese
    (f'// 点击空白处才Cancel选择；点击控件/资产项不Cancel', '// Click blank area to cancel selection; clicking controls/asset items does not cancel'),
    ('// 替换到新纹理', '// Replace with new texture'),
    ('// 同 key Character（如多个同材质Decoration）一起替换', '// Replace all same-key characters (e.g. multiple same-material decorations) together'),
    ('// 更新背景引用', '// Update background reference'),
    ('// 移除旧纹理，避免内存堆积', '// Remove old texture to avoid memory buildup'),
    ('// 允许仅改坐标', '// Allow coordinate-only change'),
    ('// 1) loading 遮罩', '// 1) loading overlay'),
    ('// 2) detail/status 严格限制在画布内部左下角', '// 2) detail/status strictly constrained to bottom-left inside canvas'),
    # Loading string with curly quotes
    (f'正在加载{lq}也许会爱上{rq}的新房间……', "Loading a room you might just fall in love with…"),
    # setWorkingStatus calls that were partially translated
    ("setWorkingStatus('正在Move In');", "setWorkingStatus('Moving in');"),
    # confirmMsg for restore with curly quotes
    (f"Restore Default会覆盖当前自定义房间背景（可从 bg-history 恢复历史图）。\\n确定继续吗？", "Restoring will overwrite the current custom background (recoverable from bg-history).\\nContinue?"),
    ("out.textContent = '已CancelRestore Default';", "out.textContent = 'Restore cancelled';"),
    ("setWorkingStatus('正在Restore Default');", "setWorkingStatus('Restoring default background');"),
    ('// 点击即刻显示遮罩，先于任何网络调用', '// Show overlay immediately on click, before any network call'),
    ("out.textContent = '🏡 正在Restore Default（恢复初始底图）...';", "out.textContent = '🏡 Restoring default background...';"),
    ('// 使用缓存，避免频繁请求', '// Use cache to avoid frequent requests'),
    ('if (out) out.textContent = `❌ Favorite列表Failed to load：${e.message || e}`;', 'if (out) out.textContent = `❌ Failed to load favorites: ${e.message || e}`;'),
    (f"${{t('homeFavApplied')}}（局部刷新失败，可手动刷新页面）", "${t('homeFavApplied')} (partial refresh failed, refresh manually)"),
])

# ── office-agent-push.py ────────────────────────────────────────────────────
patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\office-agent-push.py', [
    (f'当本地状态文件不存在或长期不更新时，自动回 idle，避免{lq}假Working{rq}',
     'if local state file is missing or stale, auto-revert to idle (prevent false "Working")'),
    (f'# 只接受{lq}状态文件{rq}结构；避免误把 office-agent-state.json（仅缓存 agentId）当状态源',
     '# Only accept state-file structure; avoid treating office-agent-state.json (which only caches agentId) as a state source'),
    (f'# detail 兜底纠偏，确保{lq}工作/休息/报警{rq}能正确落区',
     '# detail fallback correction to ensure working/resting/alert states route correctly'),
])

# ── invite.html ──────────────────────────────────────────────────────────────
patch(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\invite.html', [
    (f'把Invite Link + join key 一起发给你的 OpenClaw，并说{lq}帮我加入海辛办公室{rq}。',
     'Send the Invite Link + join key to your OpenClaw and say "Help me join the office".'),
])

print('\nAll done.')
