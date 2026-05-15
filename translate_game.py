#!/usr/bin/env python3
import re

file = r'C:\Users\zionv\OneDrive\Desktop\multbot\Star-Office-UI\frontend\game.js'
with open(file, 'r', encoding='utf-8') as f:
    c = f.read()

replacements = [
    # Top comments
    ('// Star Office UI - 游戏主逻辑', '// Star Office UI - Main game logic'),
    ('// 依赖: layout.js（必须在这个之前加载）', '// Dependency: layout.js (must be loaded before this)'),
    ('// 检测浏览器是否支持 WebP', '// Detect browser WebP support'),
    ('// 方法 1: 使用 canvas 检测', '// Method 1: detect via canvas'),
    ('// 方法 2: 使用 image 检测（备用）', '// Method 2: detect via image (fallback)'),
    ('// 获取文件扩展名（根据 WebP 支持情况 + 布局配置的 forcePng）', '// Get file extension based on WebP support and layout forcePng config'),
    ('// star-working-spritesheet.png 太宽了，WebP 不支持，始终用 PNG', '// star-working-spritesheet.png too wide for WebP, always use PNG'),
    ('// 如果布局配置里强制用 PNG，就用 .png', '// If layout config forces PNG, use .png'),
    ("console.log('WebP 支持:', supportsWebP);", "console.log('WebP support:', supportsWebP);"),
    # Memo
    ('// Memo 相关函数', '// Memo functions'),
    ('暂无昨日日记', 'No memo for yesterday'),
    ("console.error('加载 memo 失败:', e);", "console.error('Failed to load memo:', e);"),
    ('加载失败', 'Failed to load'),
    # Loading
    ('// 更新加载进度', '// Update loading progress'),
    ('正在加载 Star 的像素办公室...', "Loading Star's pixel office..."),
    ('// 隐藏加载界面', '// Hide loading overlay'),
    # States
    ("idle: { name: '待命'", "idle: { name: 'Idle'"),
    ("writing: { name: '整理文档'", "writing: { name: 'Writing'"),
    ("researching: { name: '搜索信息'", "researching: { name: 'Researching'"),
    ("executing: { name: '执行任务'", "executing: { name: 'Executing'"),
    ("syncing: { name: '同步备份'", "syncing: { name: 'Syncing'"),
    ("error: { name: '出错了'", "error: { name: 'Error'"),
    # Idle bubbles
    ('待命中：耳朵竖起来了', 'On standby: ears perked up'),
    ('我在这儿，随时可以开工', 'Right here, ready to roll'),
    ('先把桌面收拾干净再说', 'Clearing the desk before we start'),
    ('呼——给大脑放个风', 'Ahhh — giving the brain a breather'),
    ('今天也要优雅地高效', 'Staying elegantly efficient today'),
    ('等待，是为了更准确的一击', 'Waiting for the perfect moment to strike'),
    ('咖啡还热，灵感也还在', 'Coffee is still hot, so is the inspiration'),
    ('我在后台给你加 Buff', 'Buffing you up in the background'),
    ('状态：静心 / 充电', 'Status: resting / recharging'),
    ('小猫说：慢一点也没关系', 'The cat says: it is okay to slow down'),
    # Writing bubbles
    ('进入专注模式：勿扰', 'Entering focus mode: do not disturb'),
    ('先把关键路径跑通', 'Getting the critical path working first'),
    ('我来把复杂变简单', 'Turning complexity into simplicity'),
    ('把 bug 关进笼子里', 'Caging that bug'),
    ('写到一半，先保存', 'Halfway through — saving now'),
    ('把每一步都做成可回滚', 'Making every step reversible'),
    ('今天的进度，明天的底气', "Today's progress is tomorrow's confidence"),
    ('先收敛，再发散', 'Converge first, diverge later'),
    ('让系统变得更可解释', 'Making the system more explainable'),
    ('稳住，我们能赢', 'Stay steady, we got this'),
    # Researching bubbles
    ('我在挖证据链', 'Digging through the evidence chain'),
    ('让我把信息熬成结论', 'Distilling information into conclusions'),
    ('找到了：关键在这里', 'Found it: the key is right here'),
    ('先把变量控制住', 'Getting the variables under control'),
    ('我在查：它为什么会这样', 'Investigating: why is this happening'),
    ('把直觉写成验证', 'Turning intuition into proof'),
    ('先定位，再优化', 'Locate first, optimize later'),
    ('别急，先画因果图', 'Hold on — drawing the causal diagram first'),
    # Executing bubbles
    ('执行中：不要眨眼', 'Executing: do not blink'),
    ('把任务切成小块逐个击破', 'Breaking the task into chunks and tackling each one'),
    ('开始跑 pipeline', 'Kicking off the pipeline'),
    ('一键推进：走你', "One-click advance: let's go"),
    ('让结果自己说话', 'Letting the results speak for themselves'),
    ('先做最小可行，再做最美版本', 'Build the minimum viable first, then make it beautiful'),
    # Syncing bubbles
    ('同步中：把今天锁进云里', 'Syncing: locking today into the cloud'),
    ('备份不是仪式，是安全感', 'Backup is not a ritual — it is peace of mind'),
    ('写入中…别断电', 'Writing… do not cut the power'),
    ('把变更交给时间戳', 'Handing changes over to the timestamp'),
    ('云端对齐：咔哒', 'Cloud aligned: click'),
    ('同步完成前先别乱动', 'Hold still until sync finishes'),
    ('把未来的自己从灾难里救出来', 'Saving your future self from disaster'),
    ('多一份备份，少一份后悔', 'One more backup, one less regret'),
    # Error bubbles
    ('警报响了：先别慌', 'Alert triggered: stay calm first'),
    ('我闻到 bug 的味道了', 'I can smell a bug nearby'),
    ('先复现，再谈修复', 'Reproduce it first, then talk about fixing'),
    ('把日志给我，我会说人话', "Give me the logs — I'll translate them"),
    ('错误不是敌人，是线索', 'Errors are not enemies — they are clues'),
    ('把影响面圈起来', 'Circling the blast radius'),
    ('先止血，再手术', 'Stop the bleeding first, then operate'),
    ('我在：马上定位根因', 'On it: finding the root cause now'),
    ('别怕，这种我见多了', 'Do not worry — seen this a hundred times'),
    ('报警中：让问题自己现形', 'Alarming: letting the bug reveal itself'),
    # Cat bubbles
    ('喵~', 'Meow~'),
    ('咕噜咕噜…', 'Purrrr...'),
    ('尾巴摇一摇', 'Swishing my tail'),
    ('晒太阳最开心', 'Sunbathing is the best'),
    ('有人来看我啦', 'Someone came to see me!'),
    ('我是这个办公室的吉祥物', 'I am the office mascot'),
    ('伸个懒腰', 'Stretching out'),
    ('今天的罐罐准备好了吗', "Is today's treat ready?"),
    ('呼噜呼噜', 'Purrr purrr'),
    ('这个位置视野最好', 'Best view in the office'),
    # Comments
    ('// agent 颜色配置', '// Agent color config'),
    ('// agent 名字颜色', '// Agent name tag colors'),
    ('// breakroom / writing / error 区域的 agent 分布位置（多 agent 时错开）', '// Agent spread positions per area (staggered for multi-agent)'),
    ('// 状态控制栏函数（用于测试）', '// State control function (for testing)'),
    ('// 初始化：先检测 WebP 支持，再启动游戏', '// Init: detect WebP support then start game'),
    ('// 从 LAYOUT 读取总资源数量（避免 magic number）', '// Read total asset count from LAYOUT (avoid magic number)'),
    ('// 新办公桌：强制 PNG（透明）', '// New desk: force PNG (transparent)'),
    ('// === 沙发（来自 LAYOUT）===', '// === Sofa (from LAYOUT) ==='),
    ('// === 牌匾（来自 LAYOUT）===', '// === Plaque (from LAYOUT) ==='),
    ('// === 植物们（来自 LAYOUT）===', '// === Plants (from LAYOUT) ==='),
    ('// === 海报（来自 LAYOUT）===', '// === Poster (from LAYOUT) ==='),
    ('// === 小猫（来自 LAYOUT）===', '// === Cat (from LAYOUT) ==='),
    ('// === 咖啡机（来自 LAYOUT）===', '// === Coffee machine (from LAYOUT) ==='),
    ('// === 服务器区（来自 LAYOUT）===', '// === Server room (from LAYOUT) ==='),
    ('// === 新办公桌（来自 LAYOUT，强制透明 PNG）===', '// === New desk (from LAYOUT, force transparent PNG) ==='),
    ('// === 花盆（来自 LAYOUT）===', '// === Flower pot (from LAYOUT) ==='),
    ('// === Star 在桌前工作（来自 LAYOUT）===', '// === Star working at desk (from LAYOUT) ==='),
    ('// === 错误 bug（来自 LAYOUT）===', '// === Error bug (from LAYOUT) ==='),
    ('// === 同步动画（来自 LAYOUT）===', '// === Sync animation (from LAYOUT) ==='),
    ("coordsToggle.textContent = showCoords ? '隐藏坐标' : '显示坐标';",
     "coordsToggle.textContent = showCoords ? 'Hide Coords' : 'Show Coords';"),
    ('// 可选调试：仅在显式开启 debug 模式时渲染测试用尼卡 agent',
     '// Optional debug: only render test agent when debug mode is explicitly enabled'),
    ("name: '尼卡',", "name: 'Nika',"),
    ("detail: '在画像素画...',", "detail: 'Drawing pixel art...',"),
    ("typewriterTarget = '连接失败，正在重试...';", "typewriterTarget = 'Connection failed, retrying...';"),
    ("console.error('拉取 agents 失败:', error);", "console.error('Failed to fetch agents:', error);"),
    ('// 重置位置计数器', '// Reset position counters'),
    ('// 按区域分配不同位置索引，避免重叠', '// Assign different position indices per area to avoid overlap'),
    ('// 移除不再存在的 agent', '// Remove agents that no longer exist'),
    ('// 获取这个 agent 在区域里的位置', '// Get position for this agent in its area'),
    ('// 颜色', '// Colors'),
    ('// 透明度（离线/待批准/拒绝时变半透明）', '// Opacity (semi-transparent when offline/pending/rejected)'),
    ('// 新建 agent', '// Create new agent'),
    ('// 放到最顶层！', '// push to top layer!'),
    ('// 像素小人：用星星图标，更明显', '// Pixel avatar: use star icon for visibility'),
    ('// 名字标签（漂浮）', '// Floating name tag'),
    ('// 状态小点（绿色/黄色/红色）', '// Status dot (green/yellow/red)'),
    ('// 更新 agent', '// Update existing agent'),
    ('// 更新名字和颜色（如果变化）', '// Update name and color if changed'),
    ('// 更新状态点颜色', '// Update status dot color'),
    ('// 启动游戏', '// Start game'),
    ('海辛小龙虾的办公室', 'Star Office'),
    ("detail: '暂停中...'", "detail: 'Pausing...'"),
    ("detail: '等待中...'", "detail: 'Waiting...'"),
]

for old, new in replacements:
    c = c.replace(old, new)

with open(file, 'w', encoding='utf-8') as f:
    f.write(c)

remaining = [(i+1, line.strip()) for i, line in enumerate(c.split('\n')) if re.search(r'[\u4e00-\u9fff]', line)]
print(f'Remaining Chinese chars: {len(remaining)} lines')
for ln, txt in remaining:
    print(f'  L{ln}: {txt}')
