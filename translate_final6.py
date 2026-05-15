#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

lq = '\u201c'
rq = '\u201d'

path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# Print the exact lines to see what Chinese still remains in the "long" lines
hi = re.compile(r'[\u3040-\u30ff\uff65-\uff9f]')
for l in c.split('\n'):
    if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l):
        # Find the CJK chars
        cjk = re.findall(r'[\u4e00-\u9fff]+', l)
        print(f'CJK found: {cjk}')
        print(f'  Line: {repr(l.strip()[:200])}')
        print()
