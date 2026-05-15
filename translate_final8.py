#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

lq = '\u201c'
rq = '\u201d'

path = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

hi = re.compile(r'[\u3040-\u30ff\uff65-\uff9f]')
for i, l in enumerate(c.split('\n'), 1):
    if re.search(r'[\u4e00-\u9fff]', l) and not hi.search(l):
        cjk = re.findall(r'[\u4e00-\u9fff]+', l)
        print(f'L{i} CJK={cjk}')
        print(f'  FULL: {repr(l)}')
        print()
