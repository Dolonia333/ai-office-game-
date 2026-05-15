#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

lq = '\u201c'
rq = '\u201d'

path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

replacements = [
    # btnBrokerGo
    ("btnBrokerGo: '听中介的'", "btnBrokerGo: 'Go with AI Design'"),
    # homeFav remaining
    ("homeFavSaved: '✅ 已Favorite当前地图'", "homeFavSaved: '✅ Saved current map as favorite'"),
    # Find homeFavDelete continuation
    ("homeFavDelete: 'Delete', homeFavSaved:", "homeFavDelete: 'Delete', homeFavSaved:"),  # already en
    # More homeFav fields - need to find them
    ("'✅ 已替换为Favorite地图'", "'✅ Applied favorite map'"),
    ("'✅ 地图已删除'", "'✅ Map deleted'"),
    ("'已Favorite当前地图'", "'Saved current map as favorite'"),
    # geminiIn remaining
    ("geminiIn未配置", "geminiIn: 'Not configured'"),
    ("'未配置'", "'Not configured'"),
    ("'当前已配置'", "'Currently configured'"),
    # idle bubble: 静心 / 充电 was already translated but one occurrence survived
    ("'Status: 静心 / 充电'", "'Status: resting / recharging'"),
    ("'状态：静心 / 充电'", "'Status: resting / recharging'"),
    # pendingActions Leave房间
    (">Leave房间</", ">Leave</"),
    # comment: demo 气泡 partially translated
    ('// demo 气泡：优先展示与Status对应的内容，to clearly verify the State→Area→Bubble chain',
     '// Demo bubble: prioritize state-matching content to clearly verify the State→Area→Bubble chain'),
    # comment: memo 底图 partially translated
    ('// memo 底图固定走 png，to avoid WebP transparency issues on some clients causing background loss',
     '// Memo background always uses PNG to avoid WebP transparency issues on some clients'),
]

for old, new in replacements:
    c = c.replace(old, new)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

hi = re.compile(r'[\u3040-\u30ff\uff65-\uff9f]')
remaining = [l.strip() for l in c.split('\n') if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l)]
print(f'index.html: {len(remaining)} non-Japanese CJK lines')
for l in remaining:
    cjk = re.findall(r'[\u4e00-\u9fff]+', l)
    print(f'  CJK: {cjk}  |  {repr(l[:130])}')
