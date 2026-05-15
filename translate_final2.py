#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ── index.html direct patches ──────────────────────────────────────────────
path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# Find and print lines with Chinese to see exact content
hi = re.compile(r'[\u3040-\u30ff\uff65-\uff9f]')
remaining = [l for l in c.split('\n') if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l)]
for l in remaining[:30]:
    # Print repr to see actual chars
    s = l.strip()
    if len(s) < 200:
        print(repr(s[:180]))

# ── office-agent-push.py ────────────────────────────────────────────────────
print('\n--- office-agent-push.py ---')
push_path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\office-agent-push.py'
with open(push_path, 'r', encoding='utf-8') as f:
    pc = f.read()
for l in pc.split('\n'):
    if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l):
        print(repr(l.strip()[:180]))

# ── invite.html ─────────────────────────────────────────────────────────────
print('\n--- invite.html ---')
inv_path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\invite.html'
with open(inv_path, 'r', encoding='utf-8') as f:
    iv = f.read()
for l in iv.split('\n'):
    if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l):
        print(repr(l.strip()[:180]))
