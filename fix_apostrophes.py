#!/usr/bin/env python3
"""Fix all broken apostrophes in JS strings across frontend files."""
import re, os

files = [
    r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\index.html',
    r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\electron-standalone.html',
    r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\game.js',
]

# Pattern: find single-quoted JS strings that contain an apostrophe mid-word
# e.g. 'Loading Star's ...'  ->  "Loading Star's ..."
def fix_broken_sq_strings(content):
    # Find all single-quoted strings that have a word-apostrophe inside them
    # Match: '<anything>'<lowercase letter>  (the closing quote is actually mid-word apostrophe)
    # Strategy: find patterns like 'text text's text' and replace outer quotes with double quotes
    
    result = content
    
    # Specific known broken patterns - replace with double-quoted versions
    broken = [
        # Star's
        ("'Loading Star\u2019s pixel office...'", '"Loading Star\'s pixel office..."'),
        ("'Loading Star's pixel office...'", '"Loading Star\'s pixel office..."'),
        ("'Star\u2019s Pixel Office'", '"Star\'s Pixel Office"'),
        ("'Star's Pixel Office'", '"Star\'s Pixel Office"'),
        # Today's / tomorrow's
        ("'Today\u2019s progress is tomorrow\u2019s confidence'", '"Today\'s progress is tomorrow\'s confidence"'),
        ("'Today's progress is tomorrow's confidence'", '"Today\'s progress is tomorrow\'s confidence"'),
        # I'll
        ("'Give me the logs \u2014 I\u2019ll translate them'", '"Give me the logs — I\'ll translate them"'),
        ("'Give me the logs — I'll translate them'", '"Give me the logs — I\'ll translate them"'),
        ("'Give me the logs \u2014 I'll translate them'", '"Give me the logs — I\'ll translate them"'),
        # let's go
        ("'One-click advance: let\u2019s go'", '"One-click advance: let\'s go"'),
        ("'One-click advance: let's go'", '"One-click advance: let\'s go"'),
        # today's treat
        ("'Is today\u2019s treat ready?'", '"Is today\'s treat ready?"'),
        ("'Is today's treat ready?'", '"Is today\'s treat ready?"'),
        # Packing up today's
        ("'Packing up today\u2019s inspiration\u2026'", '"Packing up today\'s inspiration\u2026"'),
        ("'Packing up today's inspiration\u2026'", '"Packing up today\'s inspiration\u2026"'),
        # journey's
        ("'Checking this journey\u2019s destination\u2026'", '"Checking this journey\'s destination\u2026"'),
        ("'Checking this journey's destination\u2026'", '"Checking this journey\'s destination\u2026"'),
        # destination's
        ("'Playing a preview of the next destination\u2019s ocean breeze BGM\u2026'", '"Playing a preview of the next destination\'s ocean breeze BGM\u2026"'),
        ("'Playing a preview of the next destination's ocean breeze BGM\u2026'", '"Playing a preview of the next destination\'s ocean breeze BGM\u2026"'),
        # it's
        ("'The cat says: it\u2019s okay to slow down'", '"The cat says: it\'s okay to slow down"'),
        ("'The cat says: it's okay to slow down'", '"The cat says: it\'s okay to slow down"'),
        # Coffee's
        ("'Coffee\u2019s still hot, so is the inspiration'", '"Coffee\'s still hot, so is the inspiration"'),
        ("'Coffee's still hot, so is the inspiration'", '"Coffee\'s still hot, so is the inspiration"'),
        # let's (in welcome bubble)
        ("'Hi ${newAgent.name}, let\u2019s get to work'", '`Hi ${newAgent.name}, let\'s get to work`'),
        ("'Hi ${newAgent.name}, let's get to work'", '`Hi ${newAgent.name}, let\'s get to work`'),
        # don't (in comments - fine, won't break JS)
        # No rush let's
        ("'No rush, let\u2019s map the causality first'", '"No rush, let\'s map the causality first"'),
        ("'No rush, let's map the causality first'", '"No rush, let\'s map the causality first"'),
        # Star''s (double-single-quote style from game.js)
        ("'Star''s Pixel Office'", '"Star\'s Pixel Office"'),
        ("'Coffee''s still hot, so is the inspiration'", '"Coffee\'s still hot, so is the inspiration"'),
        ("'The cat says: it''s okay to slow down'", '"The cat says: it\'s okay to slow down"'),
        ("'Today''s progress is tomorrow''s confidence'", '"Today\'s progress is tomorrow\'s confidence"'),
        ("'No rush, let''s map the causality first'", '"No rush, let\'s map the causality first"'),
        ("'One-click advance: let''s go'", '"One-click advance: let\'s go"'),
        ("'Is today''s treat ready?'", '"Is today\'s treat ready?"'),
    ]
    
    for old, new in broken:
        result = result.replace(old, new)
    
    return result

for fpath in files:
    if not os.path.exists(fpath):
        print(f'SKIP (not found): {fpath}')
        continue
    with open(fpath, 'r', encoding='utf-8') as f:
        original = f.read()
    fixed = fix_broken_sq_strings(original)
    if fixed != original:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(fixed)
        print(f'FIXED: {os.path.basename(fpath)}')
    else:
        print(f'OK (no changes): {os.path.basename(fpath)}')

print('\nDone.')
