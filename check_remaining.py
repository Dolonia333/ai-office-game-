#!/usr/bin/env python3
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def check(path):
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Check if line is inside a Japanese locale block (after "ja:" key or inside ja: { ... })
    # Simple heuristic: track if we're inside a ja block
    chinese_lines = []
    for i, line in enumerate(lines, 1):
        if re.search(r'[\u4e00-\u9fff]', line):
            chinese_lines.append((i, line.rstrip()))
    
    print(f'\n=== {path.split(chr(92))[-1]}: {len(chinese_lines)} lines with CJK ===')
    for ln, txt in chinese_lines[:60]:
        print(f'  L{ln}: {txt.strip()[:120]}')
    if len(chinese_lines) > 60:
        print(f'  ... and {len(chinese_lines) - 60} more lines')

check(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html')
check(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\join.html')
check(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\invite.html')
check(r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\office-agent-push.py')
