#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

lq = '\u201c'
rq = '\u201d'

path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

replacements = [
    # btnBrokerGo continuation
    ("btnBrokerGo: '按AI Design方案搬家'", "btnBrokerGo: 'Generate with AI Design'"),
    # gemini hint continuation with Chinese
    ("API Key（留空不影响基础功能）'", "API Key (core features work without it)'"),
    # bubble texts line with Japanese chars (idle line) - this is the zh array now full English, skip Japanese
    # Comments with curly quotes around Chinese
    (f'便于Verify{lq}Status→区域→气泡{rq}链路', "to clearly verify the State→Area→Bubble chain"),
    (f'// 气泡位置：demo 维持原逻辑；真实访客放在{lq}名字上方{rq}，避免压Character也避免压名字',
     '// Bubble position: demo keeps original logic; real guests placed above name to avoid covering character or name'),
    ('// 即使拉取失败，demo 也要能渲染', '// Even if fetch fails, demo guests must still render'),
    ('多帧): 非同步显示首帧，同步从第2帧循环', 'multi-frame): show frame 0 when not syncing, loop from frame 2 when syncing'),
    (f'避免某些端 webp 透明通道异常导致{lq}底图丢失{rq}', 'to avoid WebP transparency issues on some clients causing background loss'),
    ('// 动态帧数', '// dynamic frame count'),
    (f'// 允许手机端{lq}拖动/滑动{rq}来Pan View（本质：移动 Phaser Camera）',
     '// Allow mobile drag/swipe to pan the view (moves Phaser Camera)'),
    (f'// 手机上：锁定{lq}Office画布高度 = 2/3 区域高度{rq}，',
     '// Mobile: lock office canvas height = 2/3 viewport height,'),
    (f"const info = on ? '视野拖动已开启（可左右拖动画布）' : '视野拖动已Close（点击左上角{lq}Pan View{rq}可开启）';",
     "const info = on ? 'Pan enabled (drag canvas left/right)' : 'Pan disabled (click \"Pan View\" in top-left to enable)';"),
    (f'// 手机端默认Close拖动画面：由左上角{lq}Pan View{rq}开关显式开启',
     '// Mobile: pan disabled by default; enabled by the top-left "Pan View" toggle'),
    (f'// 手机端允许页面自然滚动，避免{lq}不能滑动{rq}',
     '// Allow natural page scroll on mobile to avoid "can\'t scroll" issue'),
    (f'// 手机端优先{lq}横向拖动看Office{rq}，纵向手势留给页面滚动看下方面板。',
     '// Mobile: prioritize horizontal office pan; vertical gestures go to page scroll.'),
    # isDemo line still has agent.name Chinese check
    ("|| agent.name === 'Nika' || agent.name === '水星')", "|| agent.name === 'Nika' || agent.name === 'Mercury')"),
]

for old, new in replacements:
    c = c.replace(old, new)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

hi = re.compile(r'[\u3040-\u30ff\uff65-\uff9f]')
remaining = [l.strip() for l in c.split('\n') if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l)]
print(f'index.html: {len(remaining)} non-Japanese CJK lines')
for l in remaining[:20]:
    print(f'  {repr(l[:130])}')
