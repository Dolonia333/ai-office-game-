#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

replacements = [
    # L1305
    ("homeFavDeleted: '🗑️ 已删除Favorite'", "homeFavDeleted: '🗑️ Deleted favorite'"),
    # L1313 - geminiMask strings
    ("geminiMaskNoKey: 'Current Status：未配置 Key'", "geminiMaskNoKey: 'Current Status: No key configured'"),
    ("geminiMaskHasKey: '当前已配置：'", "geminiMaskHasKey: 'Currently configured: '"),
    # L1313 - broken geminiApiDoc
    ("geminiApiDoc: '📘 How to get a Google API Key'y'", "geminiApiDoc: '📘 How to get a Google API Key'"),
    # L1625 - idle bubble with Chinese fullwidth colon
    ("'Status\uff1a静心 / 充电'", "'Status: resting / recharging'"),
    # Also try ASCII colon version
    ("'Status：静心 / 充电'", "'Status: resting / recharging'"),
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
    print(f'  CJK: {cjk}')
    print(f'  {repr(l[:160])}')
