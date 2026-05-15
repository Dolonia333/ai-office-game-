#!/usr/bin/env python3
"""Translate all remaining Chinese text in Star-Office-UI frontend files."""
import re, os

BASE = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend'

def translate_file(path, replacements):
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    for old, new in replacements:
        c = c.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)
    remaining = [(i+1, line.strip()) for i, line in enumerate(c.split('\n')) if re.search(r'[\u4e00-\u9fff]', line)]
    print(f'{os.path.basename(path)}: {len(remaining)} remaining Chinese lines')
    for ln, txt in remaining[:10]:
        print(f'  L{ln}: {txt}')

# ── index.html ──────────────────────────────────────────────────────────────
index_path = os.path.join(BASE, 'index.html')
with open(index_path, 'r', encoding='utf-8') as f:
    idx = f.read()

index_replacements = [
    ('海辛小龙虾的办公室', "Star's Pixel Office"),
    ('像素风 AI 助手办公室', 'Pixel AI Assistant Office'),
    ('昨日小记', 'Yesterday Memo'),
    ('暂无记录', 'No records'),
    ('加载昨日日记...', 'Loading yesterday memo...'),
    ('正在加载 Star 的像素办公室...', "Loading Star's pixel office..."),
    ('加载中...', 'Loading...'),
    ('当前状态', 'Current Status'),
    ('状态', 'Status'),
    ('显示坐标', 'Show Coords'),
    ('隐藏坐标', 'Hide Coords'),
    ('资产管理', 'Asset Manager'),
    ('侧边栏', 'Sidebar'),
    ('设置', 'Settings'),
    ('语言', 'Language'),
    ('中文', 'Chinese'),
    ('英文', 'English'),
    ('日文', 'Japanese'),
    ('角色', 'Character'),
    ('场景', 'Scene'),
    ('装饰', 'Decoration'),
    ('上传', 'Upload'),
    ('重置', 'Reset'),
    ('保存', 'Save'),
    ('取消', 'Cancel'),
    ('确认', 'Confirm'),
    ('关闭', 'Close'),
    ('密码', 'Password'),
    ('请输入密码', 'Enter password'),
    ('验证', 'Verify'),
    ('AI 生图', 'AI Generate'),
    ('生成背景', 'Generate Background'),
    ('生成中...', 'Generating...'),
    ('收藏', 'Favorite'),
    ('已收藏', 'Favorited'),
    ('回退', 'Rollback'),
    ('恢复默认', 'Restore Default'),
    ('多 Agent', 'Multi-Agent'),
    ('在线', 'Online'),
    ('离线', 'Offline'),
    ('待批准', 'Pending'),
    ('已批准', 'Approved'),
    ('已拒绝', 'Rejected'),
    ('邀请', 'Invite'),
    ('加入', 'Join'),
    ('离开', 'Leave'),
    ('复制', 'Copy'),
    ('已复制', 'Copied'),
    ('错误', 'Error'),
    ('警告', 'Warning'),
    ('成功', 'Success'),
    ('办公室', 'Office'),
    ('休息区', 'Break Room'),
    ('工作区', 'Work Area'),
    ('Bug 区', 'Bug Corner'),
    ('服务器区', 'Server Room'),
    ('桌面宠物', 'Desktop Pet'),
    ('Gemini API', 'Gemini API'),
    ('API 密钥', 'API Key'),
    ('模型', 'Model'),
    ('快速', 'Fast'),
    ('质量', 'Quality'),
]
translate_file(index_path, index_replacements)

# ── join.html ──────────────────────────────────────────────────────────────
join_path = os.path.join(BASE, 'join.html')
with open(join_path, 'r', encoding='utf-8') as f:
    jc = f.read()

join_replacements = [
    ('加入办公室', 'Join the Office'),
    ('访客加入', 'Guest Join'),
    ('接入密钥', 'Join Key'),
    ('请输入接入密钥', 'Enter join key'),
    ('你的名字', 'Your Name'),
    ('请输入名字', 'Enter your name'),
    ('加入', 'Join'),
    ('正在加入...', 'Joining...'),
    ('加入成功', 'Joined successfully'),
    ('加入失败', 'Join failed'),
    ('密钥无效', 'Invalid key'),
    ('名字不能为空', 'Name cannot be empty'),
    ('密钥不能为空', 'Key cannot be empty'),
    ('已在办公室', 'Already in office'),
    ('办公室已满', 'Office is full'),
    ('密钥已过期', 'Key has expired'),
    ('连接中...', 'Connecting...'),
    ('已连接', 'Connected'),
    ('断开连接', 'Disconnected'),
    ('重新连接', 'Reconnect'),
    ('状态推送', 'Status Push'),
    ('推送间隔', 'Push interval'),
    ('秒', 's'),
    ('开始推送', 'Start Pushing'),
    ('停止推送', 'Stop Pushing'),
    ('当前状态', 'Current Status'),
    ('待命', 'Idle'),
    ('工作中', 'Working'),
    ('研究中', 'Researching'),
    ('执行中', 'Executing'),
    ('同步中', 'Syncing'),
    ('出错了', 'Error'),
    ('状态描述', 'Status Description'),
    ('请输入描述', 'Enter description'),
    ('更新状态', 'Update Status'),
    ('访客指南', 'Guest Guide'),
    ('步骤', 'Step'),
    ('复制链接', 'Copy Link'),
    ('分享', 'Share'),
]
translate_file(join_path, join_replacements)

# ── invite.html ─────────────────────────────────────────────────────────────
invite_path = os.path.join(BASE, 'invite.html')
with open(invite_path, 'r', encoding='utf-8') as f:
    ic = f.read()

invite_replacements = [
    ('邀请访客', 'Invite Guest'),
    ('邀请链接', 'Invite Link'),
    ('接入密钥', 'Join Key'),
    ('复制', 'Copy'),
    ('已复制', 'Copied'),
    ('生成新密钥', 'Generate New Key'),
    ('密钥列表', 'Key List'),
    ('无密钥', 'No keys'),
    ('添加密钥', 'Add Key'),
    ('删除', 'Delete'),
    ('最大并发', 'Max Concurrent'),
    ('可复用', 'Reusable'),
    ('已使用', 'Used'),
    ('未使用', 'Unused'),
    ('访客指南', 'Guest Guide'),
    ('如何加入', 'How to Join'),
    ('步骤', 'Step'),
    ('下载脚本', 'Download Script'),
    ('填写信息', 'Fill in Details'),
    ('运行脚本', 'Run Script'),
    ('你的访客将出现在办公室里', 'Your guest will appear in the office'),
    ('办公室地址', 'Office URL'),
    ('分享给访客', 'Share with guest'),
]
translate_file(invite_path, invite_replacements)

# ── office-agent-push.py ────────────────────────────────────────────────────
push_path = os.path.join(BASE, 'office-agent-push.py')
with open(push_path, 'r', encoding='utf-8') as f:
    pc = f.read()

push_replacements = [
    ('# 填写你的信息', '# Fill in your details'),
    ('# 你的接入密钥', '# Your join key'),
    ('# 你的名字（显示在看板上）', '# Your display name (shown on dashboard)'),
    ('# 办公室地址', '# Office URL'),
    ('# 状态推送间隔（秒）', '# Status push interval (seconds)'),
    ('# 当前工作状态', '# Current work state'),
    ('# 状态描述', '# Status description'),
    ('# 有效状态', '# Valid states'),
    ('# 加入办公室', '# Join the office'),
    ('# 推送状态', '# Push status'),
    ('# 离开办公室', '# Leave the office'),
    ('# 主循环', '# Main loop'),
    ('# 捕获退出信号', '# Catch exit signal'),
    ('加入中...', 'Joining...'),
    ('加入成功', 'Joined successfully'),
    ('加入失败', 'Join failed'),
    ('推送状态中...', 'Pushing status...'),
    ('推送失败', 'Push failed'),
    ('离开办公室...', 'Leaving office...'),
    ('离开成功', 'Left successfully'),
    ('按 Ctrl+C 退出', 'Press Ctrl+C to exit'),
    ('已退出', 'Exited'),
    ('连接失败', 'Connection failed'),
    ('重试中...', 'Retrying...'),
    ('等待中', 'Waiting'),
    ('正在工作', 'Working'),
    ('接入密钥', 'Join key'),
    ('显示名称', 'Display name'),
]
for old, new in push_replacements:
    pc = pc.replace(old, new)
with open(push_path, 'w', encoding='utf-8') as f:
    f.write(pc)
remaining = [(i+1, l.strip()) for i, l in enumerate(pc.split('\n')) if re.search(r'[\u4e00-\u9fff]', l)]
print(f'office-agent-push.py: {len(remaining)} remaining Chinese lines')
for ln, txt in remaining[:10]:
    print(f'  L{ln}: {txt}')

print('\nDone.')
