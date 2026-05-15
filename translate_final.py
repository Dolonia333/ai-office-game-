#!/usr/bin/env python3
"""Final pass: translate remaining Chinese in all frontend files."""
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def patch(path, replacements):
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    for old, new in replacements:
        c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)
    # Count non-Japanese CJK lines (skip lines with katakana/hiragana indicating Japanese)
    hi = re.compile(r'[\u3040-\u30ff\uff65-\uff9f]')  # hiragana + katakana
    chinese_only = [l for l in c.split('\n') if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l)]
    print(f'{path.split(chr(92))[-1]}: {len(chinese_only)} non-Japanese CJK lines remaining')
    for l in chinese_only[:15]:
        print(f'  {l.strip()[:120]}')

# ── index.html ──────────────────────────────────────────────────────────────
index_path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html'
patch(index_path, [
    # CSS comments
    ('/* 底部面板容器 */', '/* Bottom panel container */'),
    ('/* 与右侧抽屉并列：按视口动态左移，确保与抽屉至少保留 20px 间隔 */', '/* Alongside right drawer: shift left dynamically, keep at least 20px gap */'),
    ('/* 再兜底一次：即使外层高度变化，也不要拉伸变形 */', '/* Extra fallback: do not stretch even if outer height changes */'),
    ('/* 边框改为直接贴合画布内部，避免"框比地图大" */', '/* Border now fits inside canvas, avoiding "frame larger than map" issue */'),
    ('/* 首屏骨架：避免 Phaser 未就绪时纯黑屏 */', '/* First-paint skeleton: avoid pure black screen before Phaser is ready */'),
    ('/* Status控制栏 */', '/* Status control bar */'),
    ('/* Star Status四按钮（不含装修）使用像素精灵皮肤 */', '/* Star status four buttons (excluding decor) use pixel sprite skin */'),
    ('/* Decor Room按钮使用像素精灵皮肤 */', '/* Decor Room button uses pixel sprite skin */'),
    ('/* Guest Agent 名单面板（右下角） */', '/* Guest Agent list panel (bottom right) */'),
    ('/* Memo 区域 - 4:3 小正方形 */', '/* Memo area - 4:3 small square */'),
    ('/* 手机端专属适配（不影响桌面） */', '/* Mobile-only layout (no effect on desktop) */'),
    ('/* Office占 2/3 屏幕高度 */', '/* Office takes 2/3 of screen height */'),
    ('/* 余下约 1/3 可见区 */', '/* Remaining ~1/3 visible area */'),
    # HTML comments
    ('<!-- 加载遮罩 -->', '<!-- Loading overlay -->'),
    ('<!-- 底部面板容器 -->', '<!-- Bottom panel container -->'),
    ('<!-- Memo 面板 -->', '<!-- Memo panel -->'),
    ('<!-- Status控制栏 -->', '<!-- Status control bar -->'),
    ('<!-- Guest Agent 名单面板（右下角） -->', '<!-- Guest Agent list panel (bottom right) -->'),
    # HTML buttons
    ("setState('idle','待命')", "setState('idle','Idle')"),
    ("setState('writing','工作中')", "setState('writing','Working')"),
    ("setState('syncing','同步中')", "setState('syncing','Syncing')"),
    ("setState('error','报警中')", "setState('error','Alert')"),
    (">待命</button>", ">Idle</button>"),
    (">工作</button>", ">Work</button>"),
    (">同步</button>", ">Sync</button>"),
    (">报警</button>", ">Alert</button>"),
    # Asset broker prompt
    ('写你的风格主题（严格保持原始房间结构，只改变视觉风格）', 'Describe your style theme (keep original room structure, only change visual style)'),
    ('例如：像素风赛博东京夜景，霓虹灯、雨夜地面反光、蓝紫主色', 'e.g. Pixel-art cyberpunk Tokyo night, neon lights, rainy reflections, blue-purple palette'),
    # Gemini panel
    ('🔐 API Settings（可折叠）', '🔐 API Settings (collapsible)'),
    # zh locale strings that still have Chinese
    ("No favorites yet, click\u201c\u2b50 Save Favorite\u201d", "No favorites yet, click '⭐ Save Favorite'"),
    ('homeFavEmpty: \'No favorites yet, click"⭐ Save Favorite"\'', "homeFavEmpty: 'No favorites yet, click ⭐ Save Favorite'"),
    # Comment on line 1605
    ('// 兜底：某些移动网络/CDN 抖动时，避免一直卡在"加载中"遮罩', '// Fallback: on flaky mobile/CDN, prevent getting stuck on loading overlay'),
    # Default pass hint remaining Chinese
    ("authDefaultPassHint: 'Default password: 1234 (can be changed", "authDefaultPassHint: 'Default password: 1234 (can be updated"),
    # officeTitle apostrophe issue
    ("officeTitle: 'Star", "officeTitle: 'Star"),
    # gemini api doc link remaining
    ("geminiApiDoc: '📘 How to get a Google API Ke", "geminiApiDoc: '📘 How to get a Google API Key'"),
])

# ── join.html ──────────────────────────────────────────────────────────────
join_path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\join.html'
patch(join_path, [
    ("Join Star 的像素办公室", "Join Star's Pixel Office"),
    ('Your Name（会显示在办公室）', 'Your Name (will be shown in the office)'),
    ('placeholder="例如：小龙虾助手"', 'placeholder="e.g. My Assistant"'),
    ('<!-- 状态与细节改为自动同步，不在 join 页面填写 -->', '<!-- Status and detail are auto-synced; no need to fill in on this page -->'),
    ('Agent Join Key（一次性）', 'Agent Join Key (one-time use)'),
    ('placeholder="请输入你拿到的 join key"', 'placeholder="Enter the join key you received"'),
    ('>离开办公室</button>', '>Leave Office</button>'),
    ('⚠️ 注意：join 页面仅需要名字 + 一次性 join key', '⚠️ Note: this page only requires Name + one-time join key'),
    ('状态与状态细节会由 agent 后续自动推送同步', 'Status and detail will be pushed automatically by the agent'),
    ('📌 邀请说明：', '📌 Invite Info:'),
    ("showStatus('请先输入Your Name～', false);", "showStatus('Please enter your name first', false);"),
    ("showStatus('请先输入 Agent Join Key～', false);", "showStatus('Please enter the Agent Join Key first', false);"),
    ("showStatus('Joined successfully！刷新办公室就能看到你啦 ✨', true);", "showStatus('Joined successfully! Refresh the office to see yourself ✨', true);"),
    ("showStatus('网络出错，请重试', false);", "showStatus('Network error, please retry', false);"),
    ("showStatus('请先输入你要离开的名字～', false);", "showStatus('Please enter the name you joined with', false);"),
    ("showStatus('已离开办公室 👋', true);", "showStatus('Left the office 👋', true);"),
    ("showStatus(data.msg || '离开失败', false);", "showStatus(data.msg || 'Leave failed', false);"),
])

# ── invite.html ──────────────────────────────────────────────────────────────
invite_path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\invite.html'
patch(invite_path, [
    ('海辛办公室 - 加入邀请', "Star's Office - Join Invite"),
    ('✨ 海辛办公室 · 加入邀请', "✨ Star's Office · Join Invite"),
    ('欢迎加入海辛的像素办公室看板！', "Welcome to Star's pixel office dashboard!"),
    ('加入Step（一共 3 步）', 'Join Steps (3 total)'),
    ('<strong>确认信息</strong>', '<strong>Confirm Details</strong>'),
    ('你应该已经收到两样东西：', 'You should have received two things:'),
    ('一次性Join Key（join key）：', 'One-time Join Key:'),
    ('<strong>把邀请信息丢给你的 OpenClaw</strong>', '<strong>Give the invite info to your OpenClaw</strong>'),
    ('把Invite Link + join key 一起发给你的 OpenClaw，并说"帮我加入海辛办公室"。', 'Send the Invite Link + join key to your OpenClaw and say "Help me join the office".'),
    ('<strong>在你这边授权</strong>', '<strong>Authorize on Your End</strong>'),
    ('你的 OpenClaw 会在对话里向你要授权；同意后，它就会开始自动把工作状态推送到海辛办公室看板啦！', 'Your OpenClaw will ask for authorization in the conversation. Once approved, it will start auto-pushing your work status to the office dashboard!'),
    ('<strong>⚠️  隐私说明</strong>', '<strong>⚠️  Privacy Note</strong>'),
    ('只推送状态（idle/writing/researching/executing/syncing/error），不含任何具体内容/隐私；随时可停。', 'Only status is pushed (idle/writing/researching/executing/syncing/error) — no content or private data. You can stop anytime.'),
    ('← 回到海辛办公室', "← Back to Office"),
    ("海辛工作室 · 像素办公室看板", "Star's Studio · Pixel Office Dashboard"),
    ('有问题找海辛 😊', 'Questions? Feel free to reach out 😊'),
])

# ── office-agent-push.py ────────────────────────────────────────────────────
push_path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\office-agent-push.py'
patch(push_path, [
    ('海辛办公室 - Agent 状态主动推送脚本', 'Star Office - Agent Status Push Script'),
    ('用法：', 'Usage:'),
    ('1. 填入下面的 JOIN_KEY（你从海辛那里拿到的一次性 join key）', '1. Fill in JOIN_KEY below (the one-time join key you received)'),
    ('2. 填入 AGENT_NAME（你想要在办公室里显示的名字）', '2. Fill in AGENT_NAME (the name to display in the office)'),
    ('3. 运行：python office-agent-push.py', '3. Run: python office-agent-push.py'),
    ('4. 脚本会自动先 join（首次运行），然后每 30s 向海辛办公室推送一次你的当前状态', '4. Script will auto-join on first run, then push your current status every 30s'),
    ('# === 你需要填入的信息 ===', '# === Fill in your info here ==='),
    ('JOIN_KEY = ""   # 必填：你的一次性 join key', 'JOIN_KEY = ""   # Required: your one-time join key'),
    ('AGENT_NAME = "" # 必填：你在办公室里的名字', 'AGENT_NAME = "" # Required: your display name in the office'),
    ('OFFICE_URL = "https://office.hyacinth.im"  # 海辛办公室地址（一般不用改）', 'OFFICE_URL = "https://office.hyacinth.im"  # Office URL (usually no change needed)'),
    ('# === 推送配置 ===', '# === Push config ==='),
    ('PUSH_INTERVAL_SECONDS = 15  # 每隔多少秒推送一次（更实时）', 'PUSH_INTERVAL_SECONDS = 15  # How often to push (seconds)'),
    ('# 自动状态守护：当本地状态文件不存在或长期不更新时，自动回 idle，避免"假Working"', '# Auto state guardian: if local state file is missing or stale, auto-revert to idle to avoid false "Working" status'),
    ('# 本地状态存储（记住上次 join 拿到的 agentId）', '# Local state storage (remembers agentId from last join)'),
    ('# 优先读取本机 OpenClaw 工作区的状态文件（更贴合 AGENTS.md 的工作流）', '# Prefer reading from local OpenClaw workspace state file (aligns with AGENTS.md workflow)'),
    ('# 支持自动发现，减少对方手动配置成本。', '# Supports auto-discovery to reduce manual configuration.'),
    ('"当前仓库（大小写精确）', '"current repo (exact case)'),
    ('"历史/兼容路径', '"legacy/compat path'),
    ('# 如果对方本地 /status 需要鉴权，可在这里填写 token（或通过环境变量 OFFICE_LOCAL_STATUS_TOKEN）', '# If local /status requires auth, set token here or via OFFICE_LOCAL_STATUS_TOKEN env var'),
    ('# 可选：直接指定本地状态文件路径（最简单方案：绕过 /status 鉴权）', '# Optional: specify local state file path directly (simplest approach: bypasses /status auth)'),
    ('"""兼容不同本地状态词，并映射到办公室识别状态。"""', '"""Normalize various local state names and map to recognized office states."""'),
    ('"""当只有 detail 时，用关键词推断状态（贴近 AGENTS.md 的办公区逻辑）。"""', '"""When only detail is available, infer state from keywords (aligned with AGENTS.md logic)."""'),
    ('if any(k in d for k in ["报错", "error", "bug", "异常", "报警"]):', 'if any(k in d for k in ["error", "bug", "exception", "alert", "crash"]):'),
    ('if any(k in d for k in ["同步", "sync", "备份"]):', 'if any(k in d for k in ["sync", "backup"]):'),
    ('if any(k in d for k in ["调研", "research", "搜索", "查资料"]):', 'if any(k in d for k in ["research", "search", "investigate"]):'),
    ('if any(k in d for k in ["执行", "run", "推进", "处理任务", "Working", "writing"]):', 'if any(k in d for k in ["execute", "run", "working", "writing"]):'),
    ('if any(k in d for k in ["待命", "休息", "idle", "完成", "done"]):', 'if any(k in d for k in ["idle", "rest", "done", "complete"]):'),
    ('"""读取本地状态：', '"""Read local state:'),
    ('1) 优先 state.json（符合 AGENTS.md：任务前切 writing，完成后切 idle）', '1) Prefer state.json (per AGENTS.md: switch to writing before task, idle after)'),
    ('2) 其次尝试本地 HTTP /status', '2) Then try local HTTP /status'),
    ('3) 最后 fallback idle', '3) Finally fallback to idle'),
    ('额外防抖：如果本地状态更新时间超过 STALE_STATE_TTL_SECONDS，自动视为 idle。', 'Extra debounce: if local state has not been updated for STALE_STATE_TTL_SECONDS, treat as idle.'),
    ('# 1) 读本地 state.json（优先读取显式指定路径，其次自动发现）', '# 1) Read local state.json (prefer explicitly specified path, then auto-discover)'),
    ('# 只接受"状态文件"结构；避免误把 office-agent-state.json（仅缓存 agentId）当状态源', '# Only accept "state file" structure; avoid mistaking office-agent-state.json (just caches agentId) as a state source'),
    ('# detail 兜底纠偏，确保"工作/休息/报警"能正确落区', '# detail fallback correction to ensure working/resting/alert routes correctly'),
    ('# 防止状态文件久未更新仍停留在 working 态', '# Prevent state file remaining in working state after long periods without update'),
    ('detail = f"本地状态超过{STALE_STATE_TTL_SECONDS}s未更新，自动回待命"', 'detail = f"Local state stale (>{STALE_STATE_TTL_SECONDS}s), auto-reverting to idle"'),
    ('# 2) 尝试本地 /status（可能需要鉴权）', '# 2) Try local /status (may require auth)'),
    ('detail = f"本地/status 超过{STALE_STATE_TTL_SECONDS}s未更新，自动回待命"', 'detail = f"Local /status stale (>{STALE_STATE_TTL_SECONDS}s), auto-reverting to idle"'),
    ('# 如果 401，说明需要 token', '# If 401, auth token is required'),
    ('return {"state": "idle", "detail": "本地/status需要鉴权（401），请设置 OFFICE_LOCAL_STATUS_TOKEN"}', 'return {"state": "idle", "detail": "Local /status requires auth (401), please set OFFICE_LOCAL_STATUS_TOKEN"}'),
    ('# 3) 默认 fallback', '# 3) Default fallback'),
    ('"detail": "刚刚加入"', '"detail": "Just joined"'),
    ('print(f"✅ 已加入海辛办公室，agentId={local[\'agentId\']}")', 'print(f"✅ Joined the office, agentId={local[\'agentId\']}")'),
    ('print(f"✅ 状态已同步，当前区域={area}")', 'print(f"✅ Status synced, current area={area}")'),
    ('# 403/404：拒绝/移除 → 停止推送', '# 403/404: rejected/removed → stop pushing'),
    ('print(f"⚠️  访问拒绝或已移出房间（{r.status_code}），停止推送：{msg}")', 'print(f"⚠️  Access denied or removed from room ({r.status_code}), stopping push: {msg}")'),
    ('# 先确认配置是否齐全', '# Verify config is complete'),
    ('print("❌ 请先在脚本开头填入 JOIN_KEY 和 AGENT_NAME")', 'print("❌ Please fill in JOIN_KEY and AGENT_NAME at the top of the script")'),
    ('# 如果之前没 join，先 join', '# If not yet joined, join first'),
    ('# 持续推送', '# Continuous push'),
    ('print(f"🚀 开始持续推送状态，间隔={PUSH_INTERVAL_SECONDS}秒")', 'print(f"🚀 Starting continuous status push, interval={PUSH_INTERVAL_SECONDS}s")'),
    ('print("🧭 状态逻辑：任务中→工作区；待命/完成→休息区；异常→bug区")', 'print("🧭 State logic: working→work area; idle/done→break room; error→bug corner")'),
    ('print("🔐 若本地 /status 返回 Unauthorized(401)，请设置环境变量：OFFICE_LOCAL_STATUS_TOKEN 或 OFFICE_LOCAL_STATUS_URL")', 'print("🔐 If local /status returns 401 Unauthorized, set env var: OFFICE_LOCAL_STATUS_TOKEN or OFFICE_LOCAL_STATUS_URL")'),
    ('print(f"⚠️  推送异常：{e}")', 'print(f"⚠️  Push error: {e}")'),
    ('print("\\n👋 停止推送")', 'print("\\n👋 Stopping push")'),
    # Path comments
    ('# 当前仓库（大小写精确）', '# current repo (exact case)'),
    ('# 历史/兼容路径', '# legacy/compat path'),
])

print('\nAll done.')
