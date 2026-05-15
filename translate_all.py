#!/usr/bin/env python3
"""Translate all Chinese strings in Star-Office-UI frontend files to English."""
import os

BASE = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend'

# All Chinese->English replacements (order matters for longer strings first)
REPLACEMENTS = [
    # STATES names
    ("'待命'", "'Standby'"),
    ("'整理文档'", "'Organizing docs'"),
    ("'搜索信息'", "'Researching'"),
    ("'执行任务'", "'Executing'"),
    ("'同步备份'", "'Syncing'"),
    ("'出错了'", "'Error'"),

    # State detail/label strings in i18n blocks (zh locale)
    ("stateDetailIdle: '待命'", "stateDetailIdle: 'Standby'"),
    ("stateDetailWriting: '整理文档'", "stateDetailWriting: 'Organizing docs'"),
    ("stateDetailResearching: '搜索信息'", "stateDetailResearching: 'Researching'"),
    ("stateDetailExecuting: '执行任务'", "stateDetailExecuting: 'Executing'"),
    ("stateDetailSyncing: '同步备份'", "stateDetailSyncing: 'Syncing'"),
    ("stateDetailError: '出错了'", "stateDetailError: 'Error'"),
    ("stateLabelIdle: '待命'", "stateLabelIdle: 'Standby'"),
    ("stateLabelWriting: '整理文档'", "stateLabelWriting: 'Organizing docs'"),
    ("stateLabelResearching: '搜索信息'", "stateLabelResearching: 'Researching'"),
    ("stateLabelExecuting: '执行任务'", "stateLabelExecuting: 'Executing'"),
    ("stateLabelSyncing: '同步备份'", "stateLabelSyncing: 'Syncing'"),
    ("stateLabelError: '出错了'", "stateLabelError: 'Error'"),

    # Bubble texts - zh idle
    ("'待命中：耳朵竖起来了'", "'On standby: ears perked up'"),
    ("'我在这儿，随时可以开工'", "'Right here, ready to roll'"),
    ("'先把桌面整理干净再说'", "'Clearing the desk before we start'"),
    ("'啊——让大脑先喘口气'", "'Ahhh, giving the brain a breather'"),
    ("'今天保持优雅的高效'", "'Staying elegantly efficient today'"),
    ("'等待最佳时机出手'", "'Waiting for the perfect moment'"),
    ("'咖啡还是热的，灵感也是'", "'Coffee is still hot, so is the inspiration'"),
    ("'在后台默默为你加持'", "'Buffing you up in the background'"),
    ("'状态：休息中 / 充电中'", "'Status: resting and recharging'"),
    ("'猫说：慢下来也没关系'", "'The cat says: it is okay to slow down'"),

    # Bubble texts - zh writing
    ("'进入专注模式：请勿打扰'", "'Entering focus mode: do not disturb'"),
    ("'先把关键路径跑通'", "'Getting the critical path working first'"),
    ("'把复杂的变成简单的'", "'Turning complexity into simplicity'"),
    ("'把这个 bug 关进笼子里'", "'Caging that bug'"),
    ("'过半了——先存档'", "'Halfway through, saving now'"),
    ("'让每一步都可以被撤回'", "'Making every step reversible'"),
    ("'今天的进度是明天的底气'", "'Today\\'s progress is tomorrow\\'s confidence'"),
    ("'先收敛，再发散'", "'Converge first, diverge later'"),
    ("'让系统更可解释'", "'Making the system more explainable'"),
    ("'稳住，我们能赢'", "'Stay steady, we got this'"),

    # Bubble texts - zh researching
    ("'顺着证据链往下挖'", "'Digging through the evidence chain'"),
    ("'把信息提炼成结论'", "'Distilling information into conclusions'"),
    ("'找到了：关键在这里'", "'Found it: the key is right here'"),
    ("'把变量先控制住'", "'Getting the variables under control'"),
    ("'排查中：为什么会这样'", "'Investigating: why is this happening'"),
    ("'把直觉变成证据'", "'Turning intuition into proof'"),
    ("'先定位，再优化'", "'Locate first, optimize later'"),
    ("'等等——先把因果图画出来'", "'Hold on, drawing the causal diagram first'"),

    # Bubble texts - zh executing
    ("'执行中：请勿眨眼'", "'Executing: do not blink'"),
    ("'把任务拆碎再各个击破'", "'Breaking the task into chunks and tackling each one'"),
    ("'流水线，启动'", "'Kicking off the pipeline'"),
    ("'一键推进：冲啊'", "'One-click advance: let\\'s go'"),
    ("'让结果自己说话'", "'Letting the results speak for themselves'"),
    ("'先做最小可用，再做好看'", "'Build the minimum viable first, then make it beautiful'"),

    # Bubble texts - zh syncing
    ("'同步中：把今天锁进云端'", "'Syncing: locking today into the cloud'"),
    ("'备份不是仪式，是安全感'", "'Backup is not a ritual, it is peace of mind'"),
    ("'写入中……请勿断电'", "'Writing, do not cut the power'"),
    ("'把改动交给时间戳保管'", "'Handing changes over to the timestamp'"),
    ("'云端对齐：咔'", "'Cloud aligned: done'"),
    ("'同步结束前请保持静止'", "'Hold still until sync finishes'"),
    ("'帮未来的自己省一场麻烦'", "'Saving your future self from disaster'"),
    ("'再备份一次，少后悔一次'", "'One more backup, one less regret'"),

    # Bubble texts - zh error
    ("'报错了，但我不慌'", "'There\\'s an error, but I\\'m not panicking'"),
    ("'先把日志给我——我来翻译'", "'Give me the logs, I\\'ll translate them'"),
    ("'找到根因，才能真正修好'", "'Find the root cause, then fix it properly'"),
    ("'这个错误见过，有解'", "'Seen this error before, there\\'s a fix'"),
    ("'不急，先把因果理清楚'", "'No rush, let\\'s map the causality first'"),
    ("'正在重新校准……'", "'Recalibrating...'"),
    ("'异常已捕获，处理中'", "'Exception caught, handling it'"),
    ("'把问题关在沙箱里'", "'Containing the problem in a sandbox'"),

    # game.js BUBBLE_TEXTS (no leading spaces/zh key)
    ("'待命中：耳朵竖起来了',", "'On standby: ears perked up',"),
    ("'我在这儿，随时可以开工',", "'Right here, ready to roll',"),

    # Writing bubble texts array entries in game.js
    ("writing: [", "writing: ["),  # no-op placeholder

    # Guest/agent intro bubbles
    ("'你好 ${newAgent.name}，一起加油'", "'Hi ${newAgent.name}, let\\'s get to work'"),
    ("'欢迎加入，${newAgent.name}'", "'Welcome aboard, ${newAgent.name}'"),
    ("'新伙伴来了：${newAgent.name}'", "'New teammate: ${newAgent.name}'"),

    # i18n zh block strings
    ("controlTitle: 'Star 状态'", "controlTitle: 'Star Status'"),
    ("btnIdle: '待命'", "btnIdle: 'Standby'"),
    ("btnWork: '工作'", "btnWork: 'Work'"),
    ("btnSync: '同步'", "btnSync: 'Sync'"),
    ("btnError: '警报'", "btnError: 'Alert'"),
    ("btnDecor: '装扮房间'", "btnDecor: 'Decorate Room'"),
    ("btnDecor: '编辑房间'", "btnDecor: 'Edit Room'"),
    ("drawerTitle: '资产抽屉'", "drawerTitle: 'Asset Drawer'"),
    ("chooseImage: '上传资产'", "chooseImage: 'Upload Asset'"),
    ("confirmUpload: '应用刷新'", "confirmUpload: 'Apply & Refresh'"),
    ("resetToDefault: '恢复默认'", "resetToDefault: 'Reset Default'"),
    ("restorePrevAsset: '恢复上一张'", "restorePrevAsset: 'Restore Previous'"),
    ("uploadPending: '待上传'", "uploadPending: 'Pending Upload'"),
    ("uploadTarget: '目标'", "uploadTarget: 'Target'"),
    ("assetHintNotInScene: '该对象在当前场景未被检测到；仍可替换文件（刷新后生效）'", "assetHintNotInScene: 'This object is not in the current scene; you can still replace the file (effective after refresh)'"),
    ("assetHintDefault: '通用资产：请保持源文件尺寸、透明通道和视觉锚点，避免错位/变形'", "assetHintDefault: 'Generic asset: keep source size, alpha channel, and visual anchor to avoid misalignment'"),
    ("showCoords: '显示坐标'", "showCoords: 'Show Coords'"),
    ("hideCoords: '隐藏坐标'", "hideCoords: 'Hide Coords'"),
    ("moveView: '移动视角'", "moveView: 'Pan View'"),
    ("lockView: '锁定视角'", "lockView: 'Lock View'"),
    ("memoTitle: '昨日日记'", "memoTitle: 'Yesterday Notes'"),
    ("guestTitle: '访客列表'", "guestTitle: 'Guest List'"),
    ("officeTitle: 'Star 的像素办公室'", "officeTitle: \"Star's Pixel Office\""),
    ("loadingOffice: '正在加载 Star 的像素办公室……'", "loadingOffice: \"Loading Star's pixel office...\""),

    # Lazy load comment
    ("// 懒加载逻辑已取消（体验优先：装饰首屏直接出现）", "// Lazy loading cancelled (UX priority: decorations appear immediately)"),

    # Agent push area bubble texts (zh)
    ("writing: ['我在工作区处理任务', '正在整理文档与执行中', '工作区专注推进中']",
     "writing: ['Handling tasks in workspace', 'Organizing docs and executing', 'Focused and pushing forward']"),
    ("idle: ['待命中，随时响应', '在休息区等待指令', '状态良好，等待任务']",
     "idle: ['On standby, ready to respond', 'Waiting in the break room', 'All good, waiting for tasks']"),
    ("researching: ['正在检索信息', '研究区深度挖掘中', '信息整合处理中']",
     "researching: ['Searching for information', 'Deep diving in the research area', 'Integrating information']"),
    ("executing: ['任务执行中', '正在推进流水线', '执行区全力运转中']",
     "executing: ['Task in progress', 'Pipeline running', 'Execution area at full speed']"),
    ("syncing: ['同步备份中', '数据上云处理中', '同步区稳定写入中']",
     "syncing: ['Syncing and backing up', 'Uploading data to cloud', 'Stable write in sync area']"),
    ("error: ['遇到异常，处理中', '错误区排查中', '异常捕获，修复推进中']",
     "error: ['Exception encountered, handling', 'Troubleshooting in error area', 'Exception caught, fix in progress']"),

    # Page title
    ("<title>Star 的像素办公室</title>", "<title>Star's Pixel Office</title>"),
    ("<title>Star的像素办公室</title>", "<title>Star's Pixel Office</title>"),

    # Memo placeholder (already done but just in case)
    ("暂无昨日日记", "No yesterday diary yet"),
    ("暂无访客", "No guests online"),

    # Loading text in HTML
    ("正在加载 Star 的像素办公室……", "Loading Star's pixel office..."),
    ("正在加载Star的像素办公室……", "Loading Star's pixel office..."),

    # Button/label text nodes
    (">待命<", ">Standby<"),
    (">工作<", ">Work<"),
    (">同步<", ">Sync<"),
    (">警报<", ">Alert<"),
    (">装扮房间<", ">Decorate Room<"),
    (">编辑房间<", ">Edit Room<"),
    (">资产抽屉<", ">Asset Drawer<"),
    (">昨日日记<", ">Yesterday Notes<"),
    (">访客列表<", ">Guest List<"),
    (">显示坐标<", ">Show Coords<"),
    (">隐藏坐标<", ">Hide Coords<"),
    (">移动视角<", ">Pan View<"),
    (">锁定视角<", ">Lock View<"),

    # Comments in JS
    ("// 状态配置", "// State configuration"),
    ("// 气泡文案", "// Bubble text"),
    ("// 多语言", "// i18n"),
    ("// 初始化", "// Initialize"),
    ("// 装饰品", "// Decorations"),
]

files = [
    os.path.join(BASE, 'index.html'),
    os.path.join(BASE, 'game.js'),
    os.path.join(BASE, 'electron-standalone.html'),
]

for fpath in files:
    if not os.path.exists(fpath):
        print(f'SKIP: {fpath}')
        continue
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    for zh, en in REPLACEMENTS:
        content = content.replace(zh, en)
    if content != original:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'FIXED: {os.path.basename(fpath)}')
    else:
        print(f'OK (no changes): {os.path.basename(fpath)}')

print('\nDone.')
