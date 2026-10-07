import type { Register } from 'claude-code'
import { crabSvg, dashSvg, type DashData } from './desktop'
import {
  FRAME_MS,
  SPRITE_W,
  MINI_W,
  DIM,
  VALUE,
  WARN,
  COL,
  mix,
  isWide,
  dw,
  clip,
  encode,
  scenePx,
  miniPx,
  type Mood,
  type ToolKind,
  type Scene,
  type Rows,
} from './sprites'
import { tipFit } from './sprites'
import type { WalkProps } from './walkway' // 散步道的 Client 模块 (只取类型)
export { previewLane, tipFit } from './sprites'
export type { Mood } from './sprites'

// usage-hud v0.5: 用量面板 (终端版 + 客户端版)
//
// 客户端 (桌面 app 的 Code 标签页): 输入框上方一张卡片, 左边 SVG 像素螃蟹 (动作由 SMIL 动画循环播放),
//   右边 SVG 仪表盘 (自带深色底板), 下面一行可点的链接; 绘制代码在 ./desktop.ts
//
// 位置 (终端, v0.16 起固定): 面板在输入框下方 (画在提示行 PromptHint 里, 引擎自己的提示行保留在最下面);
//       螃蟹在输入框正上方的横栏 (AbovePrompt) 里散步 (Client 模块 walkway.tsx; /hud crab 开关); /hud top|bottom 只回一句话
//       螃蟹的像素画 (面板那只 + 散步道) 在 sprites.ts, hooks 和 Client 共用
//
// 完整版是 "3 行 x 3 列" 的对齐网格 (v0.16 起终端面板里没有螃蟹), 每列起点在三行里完全一致:
//   模型   Opus 5.5 ▁▂▃▅▇ medium   项目   my-app main               会话   6d18h   $199.91
//   上下文 ━━━━━━━━  14% 140k/1.0M   5小时  ━━━━━━│━━━━━━  14% 3h05m    本周   ━━│━━━━━━━━━━  43% 1d18h
//   状态   ▃▅▂ 读文件        12s     工具   Bash 12  Read 4         子代理 2 个运行中
//
// 螃蟹动画 (全部用像素画, 不用可能宽度不一的符号):
//   思考 -> 眼睛往右看 + 冒出思考点点      读/搜 -> 看一页纸, 扫描线上下移动
//   改/写 -> 右钳子敲击 + 纸上逐渐写满字    跑命令 -> 双钳交替敲键盘 + 终端光标闪烁
//   上网 -> 旋转的小地球                   派子代理 / 子代理在跑 -> 散步道里跟着走的小螃蟹 (v0.14)
//   其他工具 -> 转动的小齿轮               一轮结束 -> 举钳跳跃 + 金色闪光
//   闲置 -> 眨眼 / 左右张望 / 偶尔挥手      5 分钟没动 -> 闭眼呼吸 + 冒泡泡
//   上下文 >=80% -> 变红冒汗, >=95% -> 红色闪烁报警
//   数字变化时会滚动过渡; 工作时上下文条有流光; 5小时/本周 >=90% 时用量条呼吸闪烁
//
// 可点击: 模型名 -> /model, 项目名 -> 打开项目文件夹, 上下文 -> /context, 5小时/本周 -> /usage
// /hud: 完整 -> 精简(1 行) -> 隐藏 循环; /hud agents 子代理看板; /hud crab 开关散步道
//
// v0.12 新增:
//   配速预警: 按 5小时/本周 窗口已过的时间算 "应该用到多少", 预计重置前会用完时, 用量条后面改成红色 "约40m后用完"
//   螃蟹情绪: 取 5小时 和 本周 里更紧张的那个 -> 悠闲 (戴墨镜) / 正常 / 冒汗 (汗滴) / 慌张 (举钳 + "!")
//   每轮收据: 每轮结束那行 (Crunched for 9m 6s) 后面追加 "· $0.42 · 改 3 个文件 +120 -30 · 工具 12 次"
//   一键压缩: 上下文 >=75% 时 "上下文" 那格出现 [压缩] 按钮 -> /compact; 额度重置后弹一次 "已恢复" 提示
//   子代理看板: /hud agents 或点状态格里的 "+N代理" -> 侧边面板, 列出每个子代理的时长/最后动静/工具/状态
//   点档位文字 -> /effort 打开档位滑块
//   子代理小螃蟹: 有子代理在跑时, 右侧 3 列让给小螃蟹, 干活时也看得见
//
// v0.13 改动:
//   时间刻度: 5小时/本周 的用量条上画一道亮色 │, 位置 = 窗口已过时间 / 窗口长度; 彩色段超过刻度 = 用得比时间快
//   文字缩短: 平时只写重置倒计时 "1h54m" (暗色); 会用完时百分比变红, 文字写红色的 "40m用完"
//     (v0.13.1: 预计用完的时间一定带 "用完"; 放不下就换 "4d用完", 再放不下照常写暗色的重置倒计时)
//     完整版 5小时/本周 的附加那段从 11 列缩到 7 列, 省下的给用量条; 中等版三根条仍然一样长
//   子代理小螃蟹: 不管几个子代理都只画一只 (3x2, 没有眼睛), 右下角慢慢跳; 数量看 "+N代理"
//
// v0.14 新增: 螃蟹散步道 (输入框正上方的横栏, 只在终端, 高 2 行; 只剩 1 行时画 1 行版)
//   主会话一轮在跑 -> 大螃蟹横着走, 碰到两端掉头, 速度跟心情 (悠闲慢 / 正常 / 冒汗快 / 慌张小跑)
//   闲着 -> 趴着偶尔眨眼; 5 分钟没动静 -> 睡着 (闭眼 + z); 一轮结束 -> 举钳跳
//   每个运行中的子代理一只小螃蟹, 排成一队; 放不下画几只 + 暗色 "+N"; 子代理结束 -> 挥手 1.5 秒后离场
//   主会话闲着、后台子代理还在跑 -> 大螃蟹趴着, 小螃蟹照样走; 面板里的螃蟹不再带小螃蟹
//   气泡 (「」, 约 5 秒, 新的顶掉旧的): 搞定 3m12s / 压缩完了 / 额度刷新了 / 慢点！40m用完 (红) / 上下文快满了 / 等你点头
//   鼠标停在横栏上 (只在全屏模式) -> 一行用量摘要 + 小贴士
//
// v0.16:
//   终端面板去掉螃蟹, 网格占满整行; 各档分界前移 17 列 (完整版 81 列起, 中等版 51-80 列, 精简版不到 51 列)
//   终端面板固定在输入框下方, 螃蟹固定在上方 (store 里存的 position 一律不读)
//   散步道顶上加一行 "天空行" 隔开正文和螃蟹 (maxRows >=4: 天空 + 3 行版; 3: 天空 + 2 行版; 2 / 1: 没有天空行)
//   散步道大螃蟹拿到面板螃蟹的整套动作 (scenePx): 用工具时停下做动作、道具画在右边; 在想时走, 头顶冒思考点点
//   粒子加量 (走路同时 3-5 粒, 小跑 5-7 粒, 上限 24); 小螃蟹改成 7x4, 眼睛四周都是身体
//   散步道整个搬进 Client 模块: 鼠标停在大螃蟹上 -> 停下举钳 + 气泡 (停下时定好), 离开约 0.5 秒后接着走
//
// v0.15 散步道 v2:
//   横栏放得下 3 行就画 3 行版: 大螃蟹用面板那套 12x6 画法 (走路腿交替、眼睛看前面、会眨眼、钳子偶尔夹一下,
//     冒汗 / 慌张 / 庆祝 / 睡觉和面板一样); 小螃蟹 9x4 排队跟着走; 不够 3 行退到 2 行 / 1 行版
//   大螃蟹一直有动静: 主会话或子代理在跑都走; 全闲时每 20-40 秒溜达几格再东张西望; 5 分钟没有任何动静才睡
//   打字 -> 停下低头看输入框 (停手 1.5 秒恢复); 发出消息 -> 跳一下, 落地冒尘土
//   粒子: 走路扬尘、小跑甩汗、庆祝金色闪光、睡觉冒泡泡、小螃蟹离场冒一团 (盲文点, 只画在空格子里, 最多 16 个)
//   悬停: 只以大螃蟹的格子为悬停区域 -> 举钳打招呼 + 旁边冒一个用量摘要气泡 (不再盖住整个顶行)
//   子代理看板只留引擎的 x 和 Esc 关闭
//
// 螃蟹各种状态怎么叠 (从高到低, 只有一个能决定 "姿势"):
//   1. 庆祝 (一轮刚结束)       -> 举钳跳 + 闪光, 情绪标记暂时不画
//   2. 工作中 (按工具做动作)   -> 动作照常; 情绪只叠小标记: 冒汗 = 头边汗滴, 慌张 = 头边汗滴和红色 "!" 交替闪
//   3. 闲置 + 慌张             -> 双钳举起 + 左右发抖 + 右侧大 "!" (慌张会把睡着的螃蟹叫醒)
//   4. 睡觉 (5 分钟没动)       -> 闭眼呼吸 + 泡泡 (冒汗时照样有汗滴)
//   5. 闲置                    -> 眨眼/张望/挥手; 悠闲时改戴墨镜 (不眨眼不张望)
//   身体颜色永远只表示上下文 (>=80% 变红, >=95% 闪); 上下文 >=80% 也冒汗, 和情绪的汗滴是同一颗
//   右侧 3 列 (x 12-14) 一律给道具/泡泡/闪光/大 "!" (v0.14 起子代理小螃蟹在散步道里, 不再占这里)

const LAYOUTS = ['full', 'compact', 'off'] as const
type Layout = (typeof LAYOUTS)[number]

const SLEEP_AFTER_MS = 5 * 60_000
const PRESS_GAP_MS = 800 // 双击只算一次
const COST_MILESTONES = [5, 10, 20, 50, 100, 200, 500, 1000]
const USAGE_URL = 'https://claude.ai/settings/usage'
const LABEL_W = 6
const GAP = 3
const HPAD = 2 // 面板左右各留的空格数
const COMPACT_AT = 75 // 上下文到这个百分比出现 [压缩] 按钮
const STUCK_MS = 5 * 60_000 // 子代理运行中超过这么久没有工具动作 -> "可能卡住"
const AGENTS_PANE = 'hud-agents'
const KEEP_ENDED = 10 // 看板里保留最近结束的子代理个数
// 额度窗口长度
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
// 窗口刚开始时外推不可靠, 已过时间不够就不算配速 (不报警、不影响情绪):
//   5小时 = 窗口的 2% (6 分钟); 本周 = 满 1 天 (一周开头几个小时的用量起伏大, 按它外推会早早报警)
const MIN_ELAPSED_FRAC = 0.02
const MIN_ELAPSED_MS: Record<string, number> = { seven_day: 86400_000 }
const PANIC_RUNOUT_MS = 30 * 60_000
// 线性外推下 "配速 > 1" 就等于 "会在重置前用完", 稍微用快一点就报警太吵: 配速到 1.15 才算会用完
const PACE_WARN = 1.15

// ---------------- 会话状态 (模块变量) ----------------
let layout: Layout = 'full'
let engineWorking = false
let turnStartedAt = 0
let lastTurnMs = 0
let lastTurnTools = 0
let turnTools = 0
let totalTools = 0
let currentTool = ''
let toolCounts: Record<string, number> = {}
let effort = ''
let modelId = ''
let cwd = ''
let project = ''
let branch = ''
let dirty = 0
let celebrateUntil = 0
let lastActive = 0
let lastPct = 0
// 客户端横栏的宽度 (格数), 记进 store 方便按实际截图校准像素换算
let lastDesktopCols = 0
let savedDesktopCols = 0
// 这个会话有没有终端在显示: 只有终端需要每 0.15 秒重画来放像素动画;
// 只有客户端时只在数据变化时重画 (客户端的螃蟹动画由 SVG 自己播放, 频繁重画反而会闪)
let hasTerminal = true
// 自动更新: 客户端会话不会热重载, 发现磁盘上的版本号变了就自己执行一次 /reload-plugins
let loadedVersion = ''
let reloadAsked = false
// token 统计 = 会话记录里的历史 (启动时用脚本数一遍) + 之后每次请求的实时累加
type Tok = { input: number; output: number; cacheRead: number; cacheWrite: number }
const zeroTok = (): Tok => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
let tokBase: Tok = zeroTok()
let tokLive: Tok = zeroTok()
let tokState: 'idle' | 'counting' | 'ready' | 'failed' = 'idle'
let transcriptPath = ''
let resumeCtx: number | undefined
let agentsNow = 0
let frame = 0
let costMilestone = 0
let milestonePrimed = false
let warnedContext = false
let nightNoticed = false
let tweening = false
const lastPress: Record<string, number> = {}
const shown: Record<string, number> = {}
let mood: Mood = 'normal'
let tick = 0 // 定时器跳了几次 (面板隐藏时 frame 不走, 额度提醒照样要查)

// ---- 每轮收据 ----
// 只算主线程的回合 (turn.start 只有主线程有; turn.complete 带 agentId 的是子代理的回合)
// 工具次数和改文件包括子代理在这一轮里做的
type TurnRun = { turnId: string; startedAt: number; usd0?: number; files: Set<string>; add: number; del: number; tools: number }
type Receipt = { turnId: string; startedAt: number; completedAt: number; durationMs: number; usd?: number; files: number; add: number; del: number; tools: number; boundTo?: string }
let turnRun: TurnRun | undefined
// 最近一段的收据: seg = 这一段, cum = 从提问开始的累计; 只有最近一段能被配对, 一对只配一行
type ReceiptPair = { seg: Receipt; cum: Receipt; startedAt: number; completedAt: number; boundTo?: string }
let lastReceipt: ReceiptPair | undefined

// ---- 一次提问 (v0.16.1 / v0.16.2) ----
// Claude Code 2.1.289 起 Agent 子代理默认放到后台跑: 一次提问里主线程会结束好几段 (每段一个不带 agentId 的
//   turn.complete); 子代理结束后, 它的结果作为一次 prompt.submit 送回主线程 (origin.kind = 'task-notification'):
//   主线程闲着时另起一段, 正在跑时塞进这一段. 最后一段结束那行引擎写的是整次提问的时长 ("Churned for 34s")
// 怎么划分 "一次提问" (v0.16.2 起看 prompt.submit 的来源, 不看 turn.start 带不带字):
//   origin 不是 task-notification (用户回车 / 手机 / SDK / 定时任务 / 别的会话 ...) = 新提问, 上一次没做完的作废
//   task-notification = 同一次提问的延续
// 什么时候算做完 (防抖): 主线程结束一段、没有子代理在跑之后, 先等 END_WAIT_MS; 这段时间里来了 task-notification
//   或新的一段 (turn.start) 就取消, 接着等下一段; 什么都没来才算做完 -> 只庆祝一次, "搞定 N" 的 N = 从用户发出
//   这条提问到最后一段结束; 有子代理已经结束、它的结果还没送回来时, 等待放宽到 END_LATE_MS
//   已经庆祝过的提问又来了迟到的通知: 接着记账, 不再庆祝
// 收据: 每一行 TurnDuration 同时拿去比 "这一段的时长" 和 "从提问开始的累计时长", 对上累计的显示整次提问的合计
const END_WAIT_MS = 2000
const END_LATE_MS = 10_000
type Ask = {
  startedAt: number
  usd0?: number
  files: Set<string>
  add: number
  del: number
  tools: number
  mainTools: number
  segments: number
  kidEnds: number // 这次提问里结束了几个 "会送结果回来" 的后台子代理
  notices: number // 收到了几次 task-notification
  lastEndAt: number // 主线程最后一段结束的时间
  celebrated: boolean
}
const newAsk = (at: number, usd0?: number): Ask => ({ startedAt: at, usd0, files: new Set(), add: 0, del: 0, tools: 0, mainTools: 0, segments: 0, kidEnds: 0, notices: 0, lastEndAt: 0, celebrated: false })
let askFromNext = false // 用户在主线程跑着时打了字 (排队): 下一个 turn.start 才算新提问开始
let submitSinceTurn = '' // 上一个 turn.start 之后来过的 prompt.submit 的来源 ('' = 没有)
let endToken = 0 // "提问做完" 的防抖: 每次取消 / 重排都换一个号
let endArmed = 0 // 正在等的那个号 (0 = 没在等)
let mainOpen = false // 主线程的一段正在跑 (只由 turn.start / turn.complete 改; 渲染时的 isWorking 不算, 免得测试或时序把它冲掉)
let ask: Ask | undefined
const receiptOf: Record<string, Receipt | null> = {} // TurnDuration 行的 requestId -> 收据 (null = 确定不配)
// 子代理的 token: 只算主线程和认得的子代理 (和会话记录一样); 引擎自己的分叉 (压缩 / 记忆 ...) 的 id 谁也不认得,
// 不算. 认出来之前先记在这里, 认出来 (SubagentStart / $.agent.list()) 时再加进去
const tokPending = new Map<string, Tok>()
const rowSeenAt: Record<string, number> = {} // TurnDuration 行第一次画出来的时间

// ---- 额度恢复提醒 ----
type Watch = { armed: boolean; resetAt: number }
const watch: Record<string, Watch> = {}

// ---- 子代理看板 ----
type Kid = {
  id: string
  ran?: boolean // 见过它在跑 (结束时才算一次 "子代理结束")
  endNoted?: boolean // 这次结束已经记过
  type: string
  desc: string
  startedAt: number
  lastAt: number
  lastTool: string
  tools: number
  status: string
  endedAt?: number
  note: string
  known: boolean // SubagentStart 或 $.agent.list() 认过; 只从 tool.call 看到的 id (引擎自己的分叉) 不显示
  listed: boolean
}
const kids = new Map<string, Kid>()

// ---------------- 颜色 (螃蟹的颜色 COL 在 sprites.ts) ----------------
const TRACK = 0x3f3f46
const TICK = 0xe5e5e5 // 用量条上的时间刻度 │: 绿/黄/红的彩色段和暗色段里都看得清
const ACCENT = '#d97757'
const VIOLET = '#a78bfa'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_COLOR: Record<string, string> = {
  low: '#a1a1aa',
  medium: '#60a5fa',
  high: '#fbbf24',
  xhigh: '#fb923c',
  max: '#f87171',
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
function heat(t: number): number {
  const g = 0x4ade80
  const y = 0xfbbf24
  const r = 0xf87171
  return t < 0.6 ? mix(g, y, t / 0.6) : mix(y, r, Math.min(1, (t - 0.6) / 0.4))
}

// 外部来的名字只留安全字符, 其余换成 ?
function safe(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63
    out += (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xc0 && cp <= 0x24f) || isWide(cp) ? ch : '?'
  }
  return out
}
const padL = (s: string, n: number) => ' '.repeat(Math.max(0, n - dw(s))) + s
const padR = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - dw(s)))

function prettyModel(id: string): string {
  const m = id.match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-_.](\d{1,2}))?/i)
  if (!m) return safe(id) || '--'
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
  return name + ' ' + m[2] + (m[3] ? '.' + m[3] : '') + (/\[1m\]/i.test(id) ? ' 1M' : '')
}
function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + String(m % 60).padStart(2, '0') + 'm'
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}
// 重置倒计时, 最多 5 列: 45m / 3h05m / 15h / 1d18h
function durShort(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 10) return h + 'h' + String(m % 60).padStart(2, '0') + 'm'
  if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}
// 粗一点的时长, 最多 3 列: 40m / 13h / 4d (往下取整, 宁可说早); 给 "4d用完" 这种放进 7 列用
function durCoarse(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd'
}
// 大数: 999 / 12.3k / 4.56M / 345.4M / 2.26B
function big(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k'
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M'
  return (n / 1e9).toFixed(2) + 'B'
}
// ---------------- 配速 (纯函数) ----------------
// 已过时间 = 窗口长度 - (重置时刻 - 现在); 应用量 = 已过 / 窗口 x 100; 配速 = 实际用量 / 应用量
// 预计用完 = 现在 + (100 - 实际用量) / (实际用量 / 已过时间)
// 注意: 线性外推下 "会在重置前用完" 和 "配速 > 1" 是同一件事 (100 x 已过 < 用量 x 窗口)
// elapsedFrac = 窗口已过的比例 (0-1), 用量条上的时间刻度画在这里; 窗口刚开始 (配速不外推) 时也有
export type Pace = { pct: number; ratio?: number; runOutIn?: number; resetIn?: number; elapsedFrac?: number; willRunOut: boolean }
type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export function paceOf(l: Limit | undefined, now: number): Pace | undefined {
  if (!l || typeof l.percentUsed !== 'number') return undefined
  const pct = l.percentUsed
  const win = WINDOW_MS[l.kind]
  const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!win || !isFinite(at)) return { pct, willRunOut: false }
  const resetIn = Math.max(0, at - now)
  const elapsed = Math.min(win, win - resetIn)
  const elapsedFrac = Math.max(0, Math.min(1, elapsed / win))
  const minElapsed = MIN_ELAPSED_MS[l.kind] ?? win * MIN_ELAPSED_FRAC
  if (pct < 1 || elapsed < minElapsed || resetIn <= 0) return { pct, resetIn, elapsedFrac, willRunOut: false }
  const ratio = pct / ((elapsed / win) * 100)
  const runOutIn = pct >= 100 ? 0 : (100 - pct) / (pct / elapsed)
  return { pct, ratio, runOutIn, resetIn, elapsedFrac, willRunOut: runOutIn < resetIn && ratio >= PACE_WARN }
}

const MOOD_RANK: Record<Mood, number> = { chill: 0, normal: 1, sweat: 2, panic: 3 }
function moodOne(p: Pace | undefined): Mood | undefined {
  if (!p) return undefined
  if (p.pct >= 95 || (p.willRunOut && (p.runOutIn ?? Infinity) <= PANIC_RUNOUT_MS)) return 'panic'
  if (p.ratio === undefined) return 'normal'
  if (p.ratio >= 1.2 || p.willRunOut) return 'sweat'
  if (p.ratio < 0.8) return 'chill'
  return 'normal'
}
// 5小时 和 本周 里更紧张的那个; 两个都没有读数 (不是订阅账号) 就是 正常
export function moodOf(...paces: Array<Pace | undefined>): Mood {
  const ms = paces.map(moodOne).filter((m): m is Mood => !!m)
  if (!ms.length) return 'normal'
  return ms.reduce((a, b) => (MOOD_RANK[b] > MOOD_RANK[a] ? b : a))
}

// 用量条后面那段. 规矩: 只有一个时间 = 重置倒计时 (暗色); 预计用完的时间一定带 "用完" 两个字 (红色)
//   会用完 -> "4d12h用完", 放不下换粗一点的 "4d用完"; 还放不下就照常写暗色的重置倒计时, 只靠红色百分比提醒
//   (以前放不下时只写红色的 "4d12h", 用户会以为是 4 天半后重置)
function limitExtra(p: Pace | undefined, extraW: number): { text: string; warn: boolean } {
  if (!p || p.resetIn === undefined) return { text: '', warn: false }
  if (p.willRunOut && p.runOutIn !== undefined) {
    for (const d of [durShort(p.runOutIn), durCoarse(p.runOutIn)]) {
      if (dw(d + '用完') <= extraW) return { text: d + '用完', warn: true }
    }
  }
  return { text: durShort(p.resetIn), warn: false }
}
// 时间刻度落在条的第几格: 已过比例 x 条长, 四舍五入, 夹在条里; 没有重置时间 -> -1 (不画)
// 用四舍五入 (和彩色段的格数同一种取整): 用量正好跟上时间时, 彩色段的最后一格正好挨着刻度
function tickCell(p: Pace | undefined, bw: number): number {
  if (p?.elapsedFrac === undefined || bw <= 0) return -1
  return Math.min(bw - 1, Math.max(0, Math.round(p.elapsedFrac * bw)))
}

function addTok(t: Tok, u: any) {
  t.input += u?.input_tokens || 0
  t.output += u?.output_tokens || 0
  t.cacheRead += u?.cache_read_input_tokens || 0
  t.cacheWrite += u?.cache_creation_input_tokens || 0
}
function tokSum(): Tok {
  return {
    input: tokBase.input + tokLive.input,
    output: tokBase.output + tokLive.output,
    cacheRead: tokBase.cacheRead + tokLive.cacheRead,
    cacheWrite: tokBase.cacheWrite + tokLive.cacheWrite,
  }
}
const tokTotal = (t: Tok) => t.input + t.output + t.cacheRead + t.cacheWrite
function tok(n: number | undefined): string {
  if (n === undefined) return '--'
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}
function eq(f: number): string {
  const H = '▁▂▃▄▅▆▇'
  const wave = [0, 2, 4, 6, 4, 2]
  return [0, 2, 4].map(o => H[wave[(f + o) % wave.length]]).join('')
}
// 数字滚动过渡
function ease(key: string, target: number | undefined): number | undefined {
  if (target === undefined) return undefined
  const cur = shown[key] ?? 0
  const nxt = Math.abs(target - cur) < 0.6 ? target : cur + (target - cur) * 0.35
  shown[key] = nxt
  if (nxt !== target) tweening = true
  return nxt
}

// ---------------- 工具分类 ----------------
function toolKind(t: string): ToolKind {
  if (!t) return 'think'
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(t)) return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return 'edit'
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/.test(t)) return 'bash'
  if (/^(WebSearch|WebFetch)$/.test(t)) return 'web'
  if (/^(Agent|Task|SendMessage)$/.test(t)) return 'agent'
  return 'other'
}
const TOOL_CN: Record<string, string> = {
  Read: '读文件',
  Grep: '搜内容',
  Glob: '找文件',
  Edit: '改文件',
  MultiEdit: '改文件',
  Write: '写文件',
  NotebookEdit: '改笔记本',
  Bash: '跑命令',
  PowerShell: '跑命令',
  WebSearch: '搜网页',
  WebFetch: '读网页',
  Agent: '派子代理',
  Task: '派子代理',
  SendMessage: '发消息',
  TodoWrite: '记待办',
  Skill: '用技能',
  ToolSearch: '找工具',
}
// MCP 工具名是 mcp__<服务>__<工具>, 服务名本身可能带下划线 (Claude_Browser), 所以按 "__" 拆
function mcpParts(t: string): [string, string] | undefined {
  if (!t.startsWith('mcp__')) return undefined
  const rest = t.slice(5)
  const cut = rest.indexOf('__')
  return cut > 0 ? [rest.slice(0, cut), rest.slice(cut + 2)] : [rest, '']
}
// 统计行里的短名: MCP 工具只留服务名
function shortTool(t: string): string {
  return safe(mcpParts(t)?.[0] ?? t)
}
function toolLabel(t: string): string {
  if (!t) return '思考中'
  if (TOOL_CN[t]) return TOOL_CN[t]
  const m = mcpParts(t)
  return safe(m ? m[0] + ':' + m[1] : t)
}

const KAOMOJI: Record<string, string> = {
  idle: '(o_o)',
  blink: '(-_-)',
  work: '(o_o)/',
  work2: '\\(o_o)',
  hot: '(;o_o)',
  jump: '\\(^o^)/',
  sleep: '(-_-)zZ',
  chill: '(B_B)',
  panic: '\\(O_O)/!',
}
function kaomoji(s: Scene): string {
  const md = s.mood ?? 'normal'
  if (s.celebrating) return KAOMOJI.jump
  if (s.working) return Math.floor(frame / 2) % 2 ? KAOMOJI.work : KAOMOJI.work2
  if (md === 'panic') return KAOMOJI.panic
  if (s.pct >= 80 || md === 'sweat') return KAOMOJI.hot
  if (s.sleeping) return KAOMOJI.sleep
  if (md === 'chill') return KAOMOJI.chill
  return frame % 30 === 0 ? KAOMOJI.blink : KAOMOJI.idle
}

// ---------------- 小部件 ----------------
function label(els: any, key: string, text: string, width: number, onPress?: () => void): any[] {
  const { Text, Button } = els
  const pad = ' '.repeat(Math.max(0, width - dw(text)) + 1)
  return onPress
    ? [<Button key={key} label={text} plain dimColor onPress={onPress} />, <Text key={key + '-p'}>{pad}</Text>]
    : [
        <Text key={key} color={DIM}>
          {text + pad}
        </Text>,
      ]
}

// tickAt: 时间刻度画在第几格 (-1 = 不画); 那一格的 ━ 换成亮色 │, 条的总宽度不变
function barParts(els: any, key: string, pct: number | undefined, width: number, shimmerAt: number, pulse: number, tickAt = -1): any[] {
  const { Text } = els
  const p = pct === undefined ? 0 : Math.max(0, Math.min(100, pct)) / 100
  // 只用整格: 半格字符在终端里会留一道缝 (实测)
  const full = p > 0 ? Math.max(1, Math.round(p * width)) : 0
  // 窗口刚开始、用量只占 1 格时, 刻度和那格彩色都在第 0 格: 刻度让到第 1 格, 彩色照样看得见
  const tick = tickAt === 0 && full === 1 && width > 1 ? 1 : tickAt
  const cells: any[] = []
  for (let i = 0; i < width; i++) {
    const lit = i < full
    let ch = '━'
    let col = lit ? heat(i / Math.max(1, width - 1)) : TRACK
    if (lit && pulse > 0) col = mix(col, 0xffffff, pulse)
    if (lit && Math.abs(i - shimmerAt) < 1) col = mix(col, 0xffffff, 0.6)
    // 刻度最后定: 不跟着呼吸 / 流光变色, 彩色段和暗色段里都一样亮
    if (i === tick) {
      ch = '│'
      col = TICK
    }
    cells.push(
      <Text key={key + '-c' + i} color={hex(col)}>
        {ch}
      </Text>,
    )
  }
  return cells
}

type MeterOpts = {
  key: string
  label: string
  labelW: number
  onPress: () => void
  labelKey?: string // 标签按钮的 key (默认 btn-<key>)
  pct?: number
  pctColor?: string // 百分比的颜色 (默认按用量冷暖)
  bw: number
  extra: string
  extraW: number
  extraColor?: string
  extraParts?: any[] // 自己画附加那段 (调用方保证正好 1 + extraW 列)
  shimmerAt: number
  pulse: number
  tickAt?: number // 时间刻度在第几格 (tickCell 算; 不给 = 不画)
}
function meter(els: any, o: MeterOpts): any[] {
  const { Text } = els
  const shownPct = ease(o.key, o.pct)
  const pctText = shownPct === undefined ? '--' : Math.round(shownPct) + '%'
  const pctColor = o.pctColor ?? (o.pct === undefined ? DIM : hex(heat(Math.min(100, o.pct) / 100)))
  const parts = [
    ...label(els, o.labelKey ?? 'btn-' + o.key, o.label, o.labelW, o.onPress),
    ...barParts(els, o.key, shownPct, o.bw, o.shimmerAt, o.pulse, o.tickAt ?? -1),
    <Text key={o.key + '-pct'} color={pctColor} bold>
      {' ' + padL(pctText, 4)}
    </Text>,
  ]
  if (o.extraW > 0 && o.extraParts) parts.push(...o.extraParts)
  else if (o.extraW > 0) {
    parts.push(
      <Text key={o.key + '-x'} color={o.extraColor ?? DIM} bold={o.extraColor ? true : undefined}>
        {' ' + padR(clip(o.extra, o.extraW), o.extraW)}
      </Text>,
    )
  }
  return parts
}

// 上下文 >= 75%: 附加那段换成 [压缩] 按钮; 放得下 (>= 10 列) 就在前面留已用 token 数
// 宽度和原来那段完全一样: 1 + extraW 列
function compactParts(els: any, extraW: number, used: string, onCompact: () => void): any[] {
  const { Text, Button } = els
  const btn = '压缩'
  if (extraW >= 10) {
    return [
      <Text key="cp-lead" color={DIM}>
        {' ' + padR(clip(used, extraW - 5), extraW - 5) + ' '}
      </Text>,
      <Button key="btn-compact" label={btn} plain onPress={onCompact} />,
    ]
  }
  return [<Text key="cp-lead"> </Text>, <Button key="btn-compact" label={btn} plain onPress={onCompact} />, <Text key="cp-pad">{' '.repeat(Math.max(0, extraW - dw(btn)))}</Text>]
}
const meterWidth = (o: { label: string; labelW: number; bw: number; extraW: number }) =>
  Math.max(o.labelW, dw(o.label)) + 1 + o.bw + 5 + (o.extraW > 0 ? 1 + o.extraW : 0)

// 档位: 五格保持彩色 (按钮不能上色), 档位文字做成按钮 -> /effort 打开档位滑块
// room = 模型名后面还剩几列; 放不下时先把档位缩写 (medium -> med), 再放不下就只留缩写按钮不画五格
// (以前窄的时候档位文字会被格子截掉; 现在它是点击目标, 要保证看得见)
const EFFORT_SHORT: Record<string, string> = { low: 'low', medium: 'med', high: 'hi', xhigh: 'xhi', max: 'max' }
function effortParts(els: any, key: string, onEffort: () => void, room = Infinity): any[] {
  const { Button } = els
  const word = effort ? clip(safe(effort), 6) : '--'
  const short = EFFORT_SHORT[effort] ?? word
  if (room < 6 + dw(word)) {
    if (room < 6 + dw(short)) return [<Button key="btn-effort" label={short} plain onPress={onEffort} />]
    return effortPips(els, key, short, onEffort)
  }
  return effortPips(els, key, word, onEffort)
}
function effortPips(els: any, key: string, word: string, onEffort: () => void): any[] {
  const { Text, Button } = els
  const i = EFFORTS.indexOf(effort)
  const color = EFFORT_COLOR[effort] ?? DIM
  const bars = '▁▂▃▅▇'
  const parts: any[] = []
  for (let k = 0; k < 5; k++) {
    parts.push(
      <Text key={key + '-e' + k} color={k <= i ? color : hex(TRACK)}>
        {bars[k]}
      </Text>,
    )
  }
  parts.push(<Text key={key + '-ews'}> </Text>, <Button key="btn-effort" label={word} plain onPress={onEffort} />)
  return parts
}

function cell(els: any, key: string, w: number, parts: any[]) {
  const { Box } = els
  return (
    <Box key={key} width={w} flexShrink={0} flexDirection="row" overflow="hidden">
      {parts}
    </Box>
  )
}

type Seg = { key: string; w: number; prio: number; parts: any[] }
function fit(segs: Seg[], width: number, gap: number): Seg[] {
  const order = segs.map((s, i) => ({ s, i })).sort((a, b) => a.s.prio - b.s.prio)
  const keep = new Set<number>()
  let total = 0
  for (const { s, i } of order) {
    const add = s.w + (keep.size ? gap : 0)
    if (total + add <= width) {
      keep.add(i)
      total += add
    }
  }
  return segs.filter((_, i) => keep.has(i))
}

// ---------------- 调用 $ 的动作 (必须是顶层函数) ----------------
function redraw($: any) {
  $.ui.invalidate('ui.render')
}

async function pressOk($: any, key: string): Promise<boolean> {
  const now = await $.clock.now()
  if (now - (lastPress[key] ?? 0) < PRESS_GAP_MS) return false
  lastPress[key] = now
  return true
}

function utf16Base64(s: string): string {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    bytes.push(c & 255, c >> 8)
  }
  return new Uint8Array(bytes).toBase64()
}

// ---- 跨平台 (html-shelf 里有同样一份; 带 $ 的函数必须写在本文件里, 不能 import) ----
type OS = 'windows' | 'mac' | 'linux'

// 按工作目录缓存: 同一个目录只判断一次, 换了目录 (或测试里换了系统) 再判断
let knownOS: { key: string; os: OS } | undefined

// 判断顺序: 环境变量 OS=Windows_NT (Windows 自带) → 路径像 C:\ → 有 /System/Library/CoreServices 就是 macOS → 其余按 Linux
async function detectOS($: any, dir: string): Promise<OS> {
  if (knownOS && knownOS.key === dir) return knownOS.os
  let found: OS = 'linux'
  try {
    if ((await $.env.get('OS')) === 'Windows_NT' || /^[A-Za-z]:[\\/]/.test(dir)) found = 'windows'
    else if (await $.fs.exists('/System/Library/CoreServices')) found = 'mac'
  } catch {}
  knownOS = { key: dir, os: found }
  return found
}

const sepOf = (sys: OS) => (sys === 'windows' ? '\\' : '/')

// 用户主目录: Windows 用 USERPROFILE, 其余用 HOME
async function homeDir($: any, sys: OS): Promise<string> {
  const h = (sys === 'windows' ? await $.env.get('USERPROFILE') : '') || (await $.env.get('HOME')) || ''
  return h.replace(/[\\/]+$/, '')
}

// Claude Code 的配置目录: 设置了 CLAUDE_CONFIG_DIR 就用它, 否则 ~/.claude
async function claudeDir($: any, sys: OS): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.replace(/[\\/]+$/, '')
  const home = await homeDir($, sys)
  return home ? home + sepOf(sys) + '.claude' : ''
}

// 跑一个命令, 退出码 0 算成功; 命令不存在会抛错, 也算失败
async function ranOk($: any, argv: string[]): Promise<boolean> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 10_000 })
    return r.exitCode === 0
  } catch {
    return false
  }
}

// WSL 里一般没有 Linux 的浏览器和文件管理器: 交给 Windows 那边的默认程序.
// 先试 wslview (wslu 包), 再经 wslpath 把路径转成 Windows 写法交给 explorer.exe
// (explorer.exe 成功也常返回 1, 所以 exit 0); 网址直接交给 explorer.exe
function wslTries(target: string): string[][] {
  const viaExplorer = /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
    ? ['sh', '-c', 'explorer.exe "$1"; exit 0', 'sh', target]
    : ['sh', '-c', 'explorer.exe "$(wslpath -w "$1")"; exit 0', 'sh', target]
  return [['wslview', target], viaExplorer]
}

// macOS / Linux: 用系统默认程序打开 (文件夹 → 文件管理器, 网址 → 浏览器); 都不行就抛错
async function openPosix($: any, target: string, sys: OS): Promise<void> {
  const tries: string[][] = []
  if (sys === 'mac') tries.push(['open', target])
  else {
    if (await $.env.get('WSL_DISTRO_NAME')) tries.push(...wslTries(target))
    tries.push(['xdg-open', target], ['gio', 'open', target])
  }
  for (const argv of tries) if (await ranOk($, argv)) return
  throw new Error('没能打开, 试过: ' + tries.map(a => (a[0] === 'sh' ? 'explorer.exe' : a[0])).join(' / '))
}
// ---- 跨平台 完 ----

// 项目根目录 ($.session.root): 会话开始的地方, Claude 在终端里 cd 进子目录不会改它;
// 拿不到 (老版本引擎) 再用当前目录 ($.session.cwd)
async function projectDir($: any): Promise<string> {
  try {
    const r = await $.session.root()
    if (r) return r
  } catch {}
  return await $.session.cwd()
}

// Windows: Claude Code 启动子进程时把窗口设成隐藏, 直接跑 explorer.exe 打开的文件夹窗口也会是隐藏的;
// 经 cmd 的 start 转一手, 新窗口按正常方式显示 (已在本机验证). macOS 用 open, Linux 用 xdg-open
async function openProject($: any) {
  if (!(await pressOk($, 'project'))) return
  try {
    const here = cwd || (await projectDir($))
    const sys = await detectOS($, here)
    if (sys !== 'windows') {
      await openPosix($, here, sys)
    } else {
      const dir = here.replace(/\//g, '\\')
      if (/^[^&^|<>()%!"]+$/.test(dir)) {
        await $.process.run(['cmd.exe', '/d', '/c', 'start', 'usage hud', dir], { timeoutMs: 10_000 })
      } else {
        const script = "Start-Process -FilePath '" + dir.replace(/'/g, "''") + "'"
        await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', utf16Base64(script)], {
          timeoutMs: 20_000,
        })
      }
    }
    $.ui.toast('已打开项目文件夹')
  } catch (err) {
    $.ui.toast('打开失败: ' + String(err))
  }
}

async function runSlash($: any, command: string, fallbackUrl?: string) {
  if (!(await pressOk($, 'cmd-' + command))) return
  try {
    await $.command.run({ command })
  } catch (err) {
    if (fallbackUrl) {
      try {
        const sys = await detectOS($, cwd || (await projectDir($)))
        if (sys === 'windows') await $.process.run(['cmd.exe', '/d', '/c', 'start', 'usage hud', fallbackUrl], { timeoutMs: 10_000 })
        else await openPosix($, fallbackUrl, sys)
      } catch {}
    } else {
      $.ui.toast('/' + command + ' 运行失败: ' + String(err))
    }
  }
}

// ---- 额度恢复提醒 ----
// 5小时 (本周同理) 用到 >=30% 后 "上膛"; 之后 resetsAt 已过, 或用量从高位掉到 <5%, 就提醒一次并退膛
// 用量是最后一次 API 回复带回来的: 闲着的时候读数不变, 所以主要靠 "resetsAt 已过" 来发现
// 已经过了重置时刻的旧读数不会再上膛, 所以不会重复提醒
const WATCHED: Array<[string, string]> = [
  ['five_hour', '5 小时'],
  ['seven_day', '本周'],
]
function checkResets($: any, limits: Limit[], now: number) {
  for (const [kind, name] of WATCHED) {
    const l = limits.find(x => x.kind === kind)
    if (!l) continue
    const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    const w = (watch[kind] ??= { armed: false, resetAt: NaN })
    if (w.armed && ((isFinite(w.resetAt) && now >= w.resetAt) || l.percentUsed < 5)) {
      w.armed = false
      $.ui.toast(`${name}额度已恢复，可以继续了`, { timeoutMs: 8000 })
      sayNow('额度刷新了', now)
    }
    if (l.percentUsed >= 30 && !(isFinite(at) && at <= now)) {
      w.armed = true
      w.resetAt = at
    }
  }
}

async function watchLimits($: any) {
  try {
    const u = await $.session.usage()
    checkResets($, (u.rateLimits ?? []) as Limit[], await $.clock.now())
  } catch {}
}

// ---- 子代理看板 ----
function kidOf(id: string, now: number): Kid {
  let k = kids.get(id)
  if (!k) {
    k = { id, type: '', desc: '', startedAt: now, lastAt: now, lastTool: '', tools: 0, status: 'running', note: '', known: false, listed: false }
    kids.set(id, k)
  }
  return k
}
// 已结束的只留最近 10 个; 没人认领的 id (引擎自己的分叉) 只留最近 50 个
function pruneKids() {
  const ended = [...kids.values()].filter(k => k.endedAt !== undefined).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  for (const k of ended.slice(KEEP_ENDED)) kids.delete(k.id)
  const strays = [...kids.values()].filter(k => !k.known).sort((a, b) => b.lastAt - a.lastAt)
  for (const k of strays.slice(50)) kids.delete(k.id)
}
// 用 $.agent.list() 补上描述、类型、状态; 列表里消失了的当作已结束; 同时更新运行中个数
async function syncAgents($: any, now: number) {
  let list: any[]
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const seen = new Set<string>()
  for (const a of list ?? []) {
    if (!a?.id) continue
    seen.add(a.id)
    const k = kidOf(a.id, now)
    kidKnown(k)
    k.listed = true
    if (a.description) k.desc = safe(String(a.description))
    if (a.type) k.type = safe(String(a.type))
    if (a.status) k.status = String(a.status)
    if (k.status === 'running') {
      k.endedAt = undefined
      k.ran = true
    } else if (k.endedAt === undefined) {
      k.endedAt = now
      kidEnded(k)
    }
  }
  for (const k of kids.values()) {
    if (k.listed && !seen.has(k.id) && k.endedAt === undefined) {
      k.endedAt = now
      if (k.status === 'running') k.status = 'completed'
      kidEnded(k)
    }
  }
  agentsNow = (list ?? []).filter((a: any) => a?.status === 'running').length
  pruneKids()
  armEnd($, false) // 最后一个子代理刚结束、主线程闲着: 开始等它的结果送回来
}

// 子代理认出来了: 先前记下的 token 加进去
function kidKnown(k: Kid) {
  k.known = true
  const t = tokPending.get(k.id)
  if (t) {
    tokPending.delete(k.id)
    tokLive.input += t.input
    tokLive.output += t.output
    tokLive.cacheRead += t.cacheRead
    tokLive.cacheWrite += t.cacheWrite
  }
}
// 一个子代理结束了: 后台子代理会把结果送回主线程, 记一笔 "还欠一次通知"
// (主线程正在用 Agent 工具时结束的, 是前台子代理: 结果随工具返回, 不会再来通知)
function kidEnded(k: Kid) {
  if (!k.ran || k.endNoted) return
  k.endNoted = true
  if (ask && toolKind(currentTool) !== 'agent') ask.kidEnds += 1
}

// "提问做完" 的防抖: 主线程闲着、没有子代理在跑时才排; force = 主线程刚结束一段 (重新计时)
function armEnd($: any, force: boolean) {
  const q = ask
  if (!q || q.celebrated || mainOpen) return
  if (agentsNow > 0 || runningKids().length > 0) return // 还有子代理在跑: 等它们
  if (!force && endArmed) return
  const wait = q.kidEnds > q.notices ? END_LATE_MS : END_WAIT_MS
  const token = ++endToken
  endArmed = token
  $.clock.after(wait, () => void endAsk($, token))
}
function cancelEnd() {
  endToken += 1
  endArmed = 0
}
// 等够了, 什么都没来: 这次提问做完, 庆祝一次
async function endAsk($: any, token: number) {
  if (token !== endToken) return
  endArmed = 0
  const q = ask
  if (!q || q.celebrated || mainOpen || agentsNow > 0 || runningKids().length > 0) return
  q.celebrated = true
  const now = await $.clock.now()
  lastTurnMs = (q.lastEndAt || now) - q.startedAt
  lastTurnTools = q.mainTools
  celebrateUntil = now + (lastTurnMs > 180_000 ? 2600 : 1400)
  celebSeq += 1
  celebFrames = Math.round((celebrateUntil - now) / FRAME_MS)
  sayNow('搞定 ' + dur(lastTurnMs), now)
  // 庆祝结束时再画一次, 让只有客户端的会话也能回到平常的样子
  $.clock.after(celebrateUntil - now + 100, () => redraw($))
  redraw($)
}

async function openAgents($: any, fromPress: boolean) {
  if (fromPress && !(await pressOk($, 'agents'))) return
  try {
    const r = await $.ui.open({ id: AGENTS_PANE, title: '子代理', focus: true, closeOnEscape: true })
    if (r && r.isPlaced === false) $.ui.toast('子代理看板等终端再宽一点才能显示: ' + String(r.reason ?? ''))
  } catch (err) {
    $.ui.toast('子代理看板打不开: ' + String(err))
  }
}

async function refreshRepo($: any) {
  try {
    // 项目名和分支都按项目根目录算, Claude 在终端里 cd 进子目录也不变
    cwd = await projectDir($)
    project = safe(cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd)
    const b = await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 5000 })
    branch = b.exitCode === 0 ? safe(b.stdout.trim()) : ''
    dirty = 0
    if (branch) {
      const s = await $.process.run(['git', 'status', '--porcelain', '-uno'], { cwd, timeoutMs: 5000 })
      dirty = s.exitCode === 0 ? s.stdout.split('\n').filter((l: string) => l.trim()).length : 0
    }
  } catch {
    branch = ''
  }
}

async function readEffortFromSettings($: any, force: boolean) {
  if (effort && !force) return
  try {
    const s: any = await $.settings.read()
    const v = s?.modelSettings?.[modelId]?.effortLevel ?? s?.effortLevel
    if (typeof v === 'string' && v) effort = v
  } catch {}
}

async function loadPrefs($: any) {
  try {
    const l = await $.store.get('layout')
    if (LAYOUTS.includes(l)) layout = l
    // v0.16: 终端版面板固定在输入框下方, store 里以前存的 position (测试曾写进过 above) 一律不读
    // 散步道默认开; store 里没有记录也当开 (不沿用上一个会话模块里的值)
    crabOn = (await $.store.get('crab')) !== false
  } catch {}
}

async function checkMilestones($: any) {
  try {
    const u = await $.session.usage()
    const usd = u.cost?.usd ?? 0
    const hit = COST_MILESTONES.filter(x => usd >= x).pop() ?? 0
    if (!milestonePrimed) {
      milestonePrimed = true // 第一次只记下当前档位: 恢复的老会话不补发提示
      costMilestone = hit
    } else if (hit > costMilestone) {
      costMilestone = hit
      $.ui.toast(`本会话已花 $${hit}，螃蟹替你记着账`)
    }
    checkResets($, (u.rateLimits ?? []) as Limit[], await $.clock.now())
    const pct = u.context.percent ?? 0
    if (pct >= 80 && !warnedContext) {
      warnedContext = true
      $.ui.toast(`上下文已用 ${pct}%，螃蟹开始冒汗了，可以考虑 /compact`)
    }
    if (pct < 50) warnedContext = false
  } catch {}
}

// 会话记录文件: ~/.claude/projects/<工作目录里非字母数字都换成 ->/<会话 id>.jsonl (设置了 CLAUDE_CONFIG_DIR 就在它下面)
// 会话记录按"启动时的目录"存放; 中途 cd 过的话这里猜错, 统计脚本会再按会话 id 去各项目目录里找
type Where = { guess: string; id: string; root: string }
async function guessTranscript($: any): Promise<Where> {
  try {
    const id = await $.session.id()
    const here = await projectDir($)
    const sys = await detectOS($, here)
    const sep = sepOf(sys)
    const base = await claudeDir($, sys)
    const root = base ? base + sep + 'projects' : ''
    const dir = here.replace(/[^a-zA-Z0-9]/g, '-')
    return { guess: root ? root + sep + dir + sep + id + '.jsonl' : '', id, root }
  } catch {
    return { guess: '', id: '', root: '' }
  }
}

// 用 scripts/count-tokens.js 把会话记录 (含子代理) 里已有的 token 数一遍; 实时累加从这一刻重新开始
async function countTokens($: any, where: Where) {
  if (!where.guess && !where.id) {
    tokState = 'failed' // 找不到会话记录: 只显示本次启动以来的实时累计
    return
  }
  transcriptPath = where.guess
  tokState = 'counting'
  tokLive = zeroTok()
  try {
    const sep = sepOf(await detectOS($, cwd || (await projectDir($))))
    const script = $.plugin.root.replace(/[\\/]+$/, '') + sep + 'scripts' + sep + 'count-tokens.js'
    const r = await $.process.run(['node', script, where.guess, where.id, where.root], { timeoutMs: 120_000 })
    const j = JSON.parse(r.stdout)
    if (!j.found) throw new Error('transcript not found')
    if (j.path) transcriptPath = j.path
    tokBase = { input: j.input || 0, output: j.output || 0, cacheRead: j.cacheRead || 0, cacheWrite: j.cacheWrite || 0 }
    tokState = 'ready'
  } catch {
    tokBase = zeroTok()
    tokState = 'failed'
  }
  redraw($)
}

function showTokenDetail($: any) {
  const t = tokSum()
  const scope = tokState === 'ready' ? '本会话（含子代理）' : '本次启动以来'
  $.ui.toast(
    `${scope}共 ${big(tokTotal(t))} token：读缓存 ${big(t.cacheRead)}，写缓存 ${big(t.cacheWrite)}，新输入 ${big(t.input)}，输出 ${big(t.output)}。读缓存最便宜，单价约为新输入的十分之一。`,
    { timeoutMs: 9000 },
  )
}

async function diskVersion($: any): Promise<string> {
  try {
    const pj = JSON.parse(await $.fs.read($.plugin.root.replace(/[\\/]+$/, '') + '/.claude-plugin/plugin.json'))
    return String(pj.version ?? '')
  } catch {
    return ''
  }
}

// 只在客户端会话里做 (终端会话的插件目录本来就会被监视, 改了自动重载)
// 重载后新模块会重新记下版本号, 所以不会反复重载
async function checkForUpdate($: any) {
  if (reloadAsked || hasTerminal || !loadedVersion) return
  const v = await diskVersion($)
  if (v && v !== loadedVersion) {
    reloadAsked = true
    try {
      await $.command.run({ command: 'reload-plugins' })
    } catch {
      reloadAsked = false
    }
  }
}

function needsFrame(now: number): boolean {
  // 只有客户端: 每 15 秒刷新一次时钟, 其余靠事件 (工具开始/结束、一轮结束、用量变化) 触发
  if (!hasTerminal) return frame % 100 === 0
  // 散步道的 props 变了 (比如冒了新气泡): 推一次 (散步道本身的动画在 Client 里, 不靠这里)
  if (laneDirty) {
    laneDirty = false
    return true
  }
  if (engineWorking || tweening || agentsNow > 0 || lastPct >= 80 || mood === 'sweat' || mood === 'panic') return true
  if (now < celebrateUntil + 2 * FRAME_MS) return true
  if (lastActive > 0 && now - lastActive > SLEEP_AFTER_MS) return frame % 2 === 0
  const cyc = frame % 160
  if (frame % 30 <= 1) return true
  if ((cyc >= 60 && cyc <= 77) || (cyc >= 120 && cyc <= 137)) return true
  return frame % 13 === 0
}

// ---------------- 画面 ----------------
// 终端版和客户端版共用的一次取数
async function snapshot($: any, working: boolean) {
  const now = await $.clock.now()
  engineWorking = working
  tweening = false
  let u: any = { context: { window: 0 }, rateLimits: [] }
  try {
    u = await $.session.usage()
  } catch {}
  const ctxWindow: number | undefined = u.context?.window || undefined
  const ctxTokens: number | undefined = u.context?.tokens ?? resumeCtx
  const pct: number | undefined =
    u.context?.percent ?? (resumeCtx !== undefined && ctxWindow ? Math.min(100, Math.round((resumeCtx / ctxWindow) * 100)) : undefined)
  lastPct = pct ?? 0
  await syncAgents($, now)
  const limits = (u.rateLimits ?? []) as Limit[]
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  const p5 = paceOf(five, now)
  const pw = paceOf(week, now)
  mood = moodOf(p5, pw)
  const scene: Scene = {
    working,
    kind: toolKind(currentTool),
    pct: lastPct,
    celebrating: now < celebrateUntil,
    sleeping: !working && lastActive > 0 && now - lastActive > SLEEP_AFTER_MS,
    agents: agentsNow,
    mood,
  }
  return { now, u, ctxWindow, ctxTokens, pct, five, week, p5, pw, scene, tk: tokSum() }
}

// ---------------- 客户端 (桌面 app) 版 ----------------
// 客户端横栏一格约 7.35 像素 (按 81 格 ≈ 596 像素的实测截图校准)
const DESKTOP_PX_PER_COL = 7.35

async function buildDesktop($: any, els: any, cols: number, working: boolean) {
  const { Box, Svg } = els
  const s = await snapshot($, working)
  // 会在重置前用完 -> "40m 用完" (红色), 否则只写重置倒计时 "1h20m"; tick = 窗口已过比例 (条上的时间刻度)
  const limitMeter = (l: Limit | undefined, p: Pace | undefined): DashData['five'] =>
    p?.willRunOut && p.runOutIn !== undefined
      ? { pct: l?.percentUsed, extra: durShort(p.runOutIn) + ' 用完', warn: true, tick: p.elapsedFrac }
      : { pct: l?.percentUsed, extra: p?.resetIn !== undefined ? durShort(p.resetIn) : '', tick: p?.elapsedFrac }
  const ag = agentsNow ? `  +${agentsNow} 个子代理` : ''
  // 客户端只显示到分钟: 每秒变一次会让图片每秒重换一次
  const ran = s.now - turnStartedAt
  const status: DashData['status'] = working
    ? { text: toolLabel(currentTool) + (ran >= 60_000 ? '  ' + durShort(ran) : '') + ag, tone: 'work' }
    : agentsNow
      ? { text: agentsNow + ' 个子代理在跑', tone: 'agents' }
      : lastTurnMs
        ? { text: '✓ 上一轮 ' + dur(lastTurnMs) + '，' + lastTurnTools + ' 次工具', tone: 'idle' }
        : { text: '✓ 待命', tone: 'idle' }
  const top = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => shortTool(t) + ' ' + n)
    .join('  ')
  const counted = tokState === 'ready' || tokState === 'failed'
  const data: DashData = {
    model: prettyModel(modelId),
    effort,
    project: project || '--',
    branch: branch ? branch + (dirty ? ' *' + dirty : '') : '',
    session: dur(s.now - (s.u.startedAt ?? s.now)),
    cost: s.u.cost ? '$' + s.u.cost.usd.toFixed(2) : '',
    ctx: { pct: s.pct, extra: tok(s.ctxTokens) + ' / ' + tok(s.ctxWindow) },
    five: limitMeter(s.five, s.p5),
    week: limitMeter(s.week, s.pw),
    status,
    tools: top,
    tokenTotal: counted ? big(tokTotal(s.tk)) : '统计中..',
    tokenOutput: counted ? big(s.tk.output) : '',
  }
  const sc = s.scene
  // 可用宽度: 横栏格数 x 每格像素, 减去螃蟹和间距; 太窄就只放一行用量条
  lastDesktopCols = cols
  const crabScale = 5
  const crabW = 16 * crabScale
  // 估计的可用宽度; 故意多画 5% + 20 像素, 让客户端总是把它等比缩到正好贴满卡片, 右边缘和卡片对齐
  const est = Math.round((cols || 100) * DESKTOP_PX_PER_COL) - crabW - 15
  const dashW = Math.max(340, Math.min(1040, Math.round(est * 1.05) + 20))
  const compact = layout === 'compact' || est < 380
  // 螃蟹直接画在卡片上 (没有底板/边框); 当普通图片显示, SMIL 动画照样会动, 必须给明确宽高
  const crab = crabSvg(
    {
      // 慌张会把睡着的螃蟹叫醒 (和终端版同一套优先级)
      mode: sc.celebrating ? 'celebrate' : working ? 'work' : sc.sleeping && mood !== 'panic' ? 'sleep' : 'idle',
      kind: sc.kind,
      heat: lastPct >= 95 ? 'crit' : lastPct >= 80 ? 'hot' : 'ok',
      agents: Math.min(3, agentsNow),
      mood,
    },
    compact ? 3 : crabScale,
  )
  const crabSize = compact ? { w: 48, h: 21 } : { w: crabW, h: 7 * crabScale }
  const dash = dashSvg(data, { compact, width: dashW })
  return (
    <Box key="hud-d-row" flexDirection="row" alignItems="center" columnGap={2}>
      <Box key="hud-d-crab" flexShrink={0}>
        <Svg key="crab-svg" source={crab} alt="用量面板的小螃蟹" width={crabSize.w} height={crabSize.h} />
      </Box>
      {/* 估计的宽度偏大时, 这个容器允许仪表盘等比缩小, 不会被截断 */}
      <Box key="hud-d-dash" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Svg key="dash-svg" source={dash} alt={`上下文 ${data.ctx.pct ?? '--'}%，5小时 ${data.five.pct ?? '--'}%，本周 ${data.week.pct ?? '--'}%`} />
      </Box>
    </Box>
  )
}

async function buildView($: any, els: any, surface: string, W: number, working: boolean) {
  const { Box, Text, Button } = els
  const isTerm = surface === 'terminal'
  const now = await $.clock.now()
  engineWorking = working
  tweening = false

  let u: any = { context: { window: 0 }, rateLimits: [] }
  try {
    u = await $.session.usage()
  } catch {}
  // 刚恢复的会话还没有新回复时, 用恢复时记下的上下文大小先顶上
  const ctxWindow: number | undefined = u.context?.window || undefined
  const ctxTokens: number | undefined = u.context?.tokens ?? resumeCtx
  const pct: number | undefined =
    u.context?.percent ?? (resumeCtx !== undefined && ctxWindow ? Math.min(100, Math.round((resumeCtx / ctxWindow) * 100)) : undefined)
  lastPct = pct ?? 0
  const tk = tokSum()
  const tokenText =
    tokState === 'counting' || tokState === 'idle'
      ? '统计中..'
      : big(tokTotal(tk)) + (tokState === 'failed' ? ' 本次启动' : '  out ' + big(tk.output))
  await syncAgents($, now)
  const limits = (u.rateLimits ?? []) as Limit[]
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  const p5 = paceOf(five, now)
  const pw = paceOf(week, now)
  mood = moodOf(p5, pw)
  const scene: Scene = {
    working,
    kind: toolKind(currentTool),
    pct: lastPct,
    celebrating: now < celebrateUntil,
    sleeping: !working && lastActive > 0 && now - lastActive > SLEEP_AFTER_MS,
    agents: agentsNow,
    mood,
  }
  const pulse = (l?: { percentUsed: number }) => (l && l.percentUsed >= 90 ? 0.25 * (1 + Math.sin(frame / 2)) : 0)

  const onModel = () => runSlash($, 'model')
  const onContext = () => runSlash($, 'context')
  const onUsage = () => runSlash($, 'usage', USAGE_URL)
  const onProject = () => openProject($)
  const onCompact = () => runSlash($, 'compact')
  const onEffort = () => runSlash($, 'effort')
  const onAgents = () => openAgents($, true)
  const showCompact = (pct ?? 0) >= COMPACT_AT

  const model = prettyModel(modelId)
  const statusText = (max: number): { text: string; color: string } => {
    if (working) {
      // 放不下 "工具名 + 计时" 时 (比如精简版状态格后面还有 +N代理 按钮) 先省掉计时, 不在半截处截断
      if (max < 15) return { text: eq(frame) + ' ' + clip(toolLabel(currentTool), Math.max(2, max - 4)), color: ACCENT }
      const room = max - 11
      return { text: eq(frame) + ' ' + padR(clip(toolLabel(currentTool), room), room) + ' ' + padL(dur(now - turnStartedAt), 6), color: ACCENT }
    }
    if (agentsNow) return { text: clip(eq(frame) + ' 子代理在跑', max), color: VIOLET }
    if (lastTurnMs) return { text: clip('✓ 上一轮 ' + dur(lastTurnMs) + '，' + lastTurnTools + ' 次工具', max), color: DIM }
    return { text: '✓ 待命', color: DIM }
  }
  // 状态格: 文字 + (有子代理时) 末尾一个可点的 "+N代理" -> 子代理看板
  // 文字补齐到固定宽度, 按钮的位置在工作 / 闲置两态完全一样
  const agLabel = agentsNow ? '+' + agentsNow + '代理' : ''
  const statusParts = (max: number): any[] => {
    const room = agLabel ? Math.max(0, max - dw(agLabel) - 1) : max
    const st = statusText(room)
    const parts: any[] = [
      <Text key="st" color={st.color}>
        {agLabel ? padR(clip(st.text, room), room) + ' ' : clip(st.text, room)}
      </Text>,
    ]
    if (agLabel) parts.push(<Button key="btn-agents" label={agLabel} plain onPress={onAgents} />)
    return parts
  }

  // v0.16: 终端面板不画螃蟹 (螃蟹在输入框上方的散步道里), 网格占满整行; 去掉螃蟹那 15+2 列后各档的分界跟着前移
  //   (算法不变, 只是可用宽度多了 crabCols 列: 完整版从 96 列降到 79 列, 精简版从不到 66 列降到不到 49 列)
  const crabCols = isTerm ? 0 : SPRITE_W + 2
  // ---------- 精简版: 1 行 (终端不到 49 列, 或 /hud 切到精简) ----------
  if (layout === 'compact' || W - crabCols < 49) {
    const bw = W >= 120 ? 8 : W >= 100 ? 6 : 4
    const crab = isTerm
      ? []
      : [
          <Text key="crab-k" color={ACCENT}>
            {kaomoji(scene)}
          </Text>,
        ]
    // 精简版没有附加文字那段: 会用完时百分比改成红色; 上下文 >=75% 时 "上下文" 标签换成 [压缩] (同样 6 列宽)
    // 5小时 / 本周 的条上照样画时间刻度
    const m = (key: string, lab: string, p: number | undefined, onPress: () => void, sh: number, pl: number, more: Partial<MeterOpts> = {}): Seg => {
      const o: MeterOpts = { key, label: lab, labelW: dw(lab), onPress, pct: p, bw, extra: '', extraW: 0, shimmerAt: sh, pulse: pl, ...more }
      return { key: 'seg-' + key, w: meterWidth(o), prio: 0, parts: meter(els, o) }
    }
    const limOpts = (p?: Pace): Partial<MeterOpts> => ({ ...(p?.willRunOut ? { pctColor: WARN } : {}), tickAt: tickCell(p, bw) })
    const ctxSeg = showCompact
      ? m('ctx', '压缩', pct, onCompact, working ? frame % (bw + 6) : -9, 0, { labelW: dw('上下文'), labelKey: 'btn-compact' })
      : m('ctx', '上下文', pct, onContext, working ? frame % (bw + 6) : -9, 0)
    const segs: Seg[] = [
      ...(isTerm ? [] : [{ key: 'seg-crab', w: 9, prio: 0, parts: crab }]),
      { ...ctxSeg, prio: 1 },
      { ...m('h5', '5小时', five?.percentUsed, onUsage, -9, pulse(five), limOpts(p5)), prio: 2 },
      { ...m('wk', '本周', week?.percentUsed, onUsage, -9, pulse(week), limOpts(pw)), prio: 3 },
      {
        key: 'seg-model',
        w: dw(model) + 1 + 5 + 1 + Math.max(2, dw(effort)),
        prio: 4,
        parts: [<Button key="btn-model" label={model} plain onPress={onModel} />, <Text key="m-sp"> </Text>, ...effortParts(els, 'c-eff', onEffort)],
      },
      {
        key: 'seg-status',
        w: 18,
        prio: 5,
        parts: statusParts(18),
      },
      {
        key: 'seg-token',
        w: 6 + 9,
        prio: 6,
        parts: [
          <Button key="btn-token" label="token" plain dimColor onPress={() => showTokenDetail($)} />,
          <Text key="tk" color={VALUE}>
            {' ' + clip(tokState === 'ready' || tokState === 'failed' ? big(tokTotal(tk)) : '..', 8)}
          </Text>,
        ],
      },
    ]
    return (
      <Box key="hud" flexDirection="row" columnGap={2} height={1} paddingLeft={HPAD} paddingRight={HPAD}>
        {fit(segs, W - HPAD * 2, 2).map(s => cell(els, s.key, s.w, s.parts))}
      </Box>
    )
  }

  // ---------- 完整版: 3 行 x 3 列 (终端 79 列以上) ----------
  // ---------- 中等版: 3 行 x 2 列 (终端 49~78 列, 比如 macOS 默认的 80 列窗口) ----------
  //   左列 模型 / 项目 / 状态, 右列 上下文 / 5小时 / 本周; 本会话、工具、token 放不下, 只在完整版里显示
  // 左右各留 HPAD 格; 各列取整后剩下的零头平分到两边, 让面板两端留空一样
  const nCols = W - crabCols >= 79 ? 3 : 2
  const avail = W - crabCols - HPAD * 2
  const cw = Math.floor((avail - (nCols - 1) * GAP) / nCols)
  const A = cw * nCols + GAP * (nCols - 1)
  const marginL = HPAD + Math.floor((avail - A) / 2)
  const marginR = HPAD + Math.ceil((avail - A) / 2)
  const inner = cw - LABEL_W - 1
  let extraW = 11
  let bw = inner - 5 - 1 - extraW
  if (bw < 6) {
    extraW = 5
    bw = inner - 5 - 1 - extraW
  }
  // 用量条吃掉这一列剩下的宽度, 第三列的条正好撑到右边距
  bw = Math.max(3, Math.min(60, bw))
  // 5小时 / 本周 的附加那段 (limW 列) 和条长 (limBw):
  //   完整版: 三格在不同列, 附加只放 "1h54m" / "40m用完", 7 列就够, 省下的给条;
  //           上下文退到 5 列时 (窄一点的完整版) 三格都用 5 列, 条一样长, 不比旧版短 (会用完时只有百分比红, 文字照常是重置倒计时)
  //   中等版: 三根条在同一列上下叠着, 条长和附加宽度必须和上下文那根一样, 百分比才竖着对齐
  let limW = extraW
  let limBw = bw
  if (nCols === 3 && extraW === 11) {
    limW = 7
    limBw = Math.max(3, Math.min(60, inner - 5 - 1 - limW))
  }
  const x5 = limitExtra(p5, limW)
  const xw = limitExtra(pw, limW)
  // 会用完: 百分比变红 (加粗); 附加文字写成 "…用完" 时也变红, 放不下 "用完" 时照常是暗色的重置倒计时
  const limMeter = (key: string, lab: string, l: Limit | undefined, p: Pace | undefined, x: { text: string; warn: boolean }) =>
    meter(els, {
      key,
      label: lab,
      labelW: LABEL_W,
      onPress: onUsage,
      pct: l?.percentUsed,
      pctColor: p?.willRunOut ? WARN : undefined,
      bw: limBw,
      extra: x.text,
      extraW: limW,
      extraColor: x.warn ? WARN : undefined,
      shimmerAt: -9,
      pulse: pulse(l),
      tickAt: tickCell(p, limBw),
    })

  // 第 1 行
  // 项目名优先完整显示, 分支名只用剩下的位置 (不够 4 格就不显示)
  const proj = clip(project || '--', inner)
  const branchRoom = inner - dw(proj) - 1
  const branchText = branch && branchRoom >= 4 ? clip(branch + (dirty ? ' *' + dirty : ''), branchRoom) : ''
  const r1 = [
    [
      ...label(els, 'l-model', '模型', LABEL_W),
      <Button key="btn-model" label={model} plain onPress={onModel} />,
      <Text key="m-sp"> </Text>,
      ...effortParts(els, 'eff', onEffort, inner - dw(model) - 1),
    ],
    [
      ...label(els, 'l-proj', '项目', LABEL_W),
      <Button key="btn-project" label={proj} plain onPress={onProject} />,
      <Text key="b-t" color={VIOLET}>
        {branchText ? ' ' + branchText : ''}
      </Text>,
    ],
    [
      // 本会话 = 这个对话 (含恢复前), 不是整个项目; /clear 会重新开始计
      ...label(els, 'l-sess', '本会话', LABEL_W),
      <Text key="s-t" color={VALUE}>
        {padR(dur(now - (u.startedAt ?? now)), 7)}
      </Text>,
      <Text key="s-c" color={DIM}>
        {u.cost ? '$' + u.cost.usd.toFixed(2) : ''}
      </Text>,
    ],
  ]

  // 第 2 行
  const r2 = [
    meter(els, {
      key: 'ctx',
      label: '上下文',
      labelW: LABEL_W,
      onPress: onContext,
      pct,
      bw,
      // 窄的时候只放已用量, 不放 "/窗口大小"
      extra: extraW >= 9 ? tok(ctxTokens) + '/' + tok(ctxWindow) : tok(ctxTokens),
      extraW,
      // 上下文 >=75%: 附加那段换成 [压缩] 按钮 (宽的时候前面还留着已用 token 数)
      extraParts: showCompact ? compactParts(els, extraW, tok(ctxTokens), onCompact) : undefined,
      shimmerAt: working ? (frame % (bw + 8)) - 2 : -9,
      pulse: 0,
    }),
    limMeter('h5', '5小时', five, p5, x5),
    limMeter('wk', '本周', week, pw, xw),
  ]

  // 第 3 行
  const top = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => shortTool(t) + ' ' + n)
    .join('  ')
  const r3 = [
    [
      ...label(els, 'l-st', '状态', LABEL_W),
      ...statusParts(inner),
    ],
    [
      ...label(els, 'l-tools', '工具', LABEL_W),
      <Text key="tl" color={VALUE}>
        {clip(top || '还没有', inner)}
      </Text>,
    ],
    [
      // 点 "token" 弹出明细: 读缓存 / 写缓存 / 新输入 / 输出
      ...label(els, 'btn-token', 'token', LABEL_W, () => showTokenDetail($)),
      <Text key="tk" color={VALUE}>
        {clip(tokenText, inner)}
      </Text>,
    ],
  ]

  // 中等版: 左列放文字 (模型 / 项目 / 状态), 右列放三根用量条
  const rows =
    nCols === 3
      ? [r1, r2, r3]
      : [
          [r1[0], r2[0]],
          [r1[1], r2[1]],
          [r3[0], r2[2]],
        ]

  const gridRow = (key: string, cells: any[][]) => (
    <Box key={key} flexDirection="row" columnGap={GAP} height={1}>
      {cells.map((parts, i) => cell(els, key + 'c' + i, cw, parts))}
    </Box>
  )

  // 终端: 只有网格; 其他界面照旧左边放颜文字
  const sprite = isTerm ? null : (
    <Box key="sprite" width={SPRITE_W} flexShrink={0} height={3}>
      <Text key="crab-k" color={ACCENT}>
        {kaomoji(scene)}
      </Text>
    </Box>
  )

  return (
    <Box key="hud" flexDirection="row" columnGap={isTerm ? 0 : 2} paddingLeft={marginL} paddingRight={marginR}>
      {sprite}
      <Box key="info" flexDirection="column" width={A} flexShrink={0}>
        {gridRow('r1', rows[0])}
        {gridRow('r2', rows[1])}
        {gridRow('r3', rows[2])}
      </Box>
    </Box>
  )
}

// ---------------- 螃蟹散步道: hooks 这边 (v0.16 起散步道本身在 Client 模块 walkway.tsx 里走) ----------------
// hooks 只把处境当 props 传进去 (忙不忙、心情、工具、上下文 %、子代理、事件气泡、打字 / 发送 / 庆祝的序号、用量摘要);
// 位置、小螃蟹、粒子、走路、悬停停下都由模块自己用帧钟推进, hooks 不用为散步道每帧重画
const TIPS = ['/hud agents 打开子代理看板', '/hud crab 关掉或打开散步的螃蟹', '/hud 切换 完整 / 精简 / 隐藏']
let crabOn = true // /hud crab 开关 (存进 store)
let laneDirty = false // 散步道的 props 变了 (比如冒了新气泡), 下一帧推一次
let typeSeq = 0 // 打字 (prompt.edit) 的序号: 模块见到新序号就低头 1.5 秒
let typePushedAt = 0 // 上次为打字重画的时间 (连着打字时约 0.4 秒推一次)
let jumpSeq = 0 // 发出消息 (prompt.submit) 的序号: 模块见到新序号就跳一下
let celebSeq = 0 // 一轮结束的序号 + 庆祝多少帧
let celebFrames = 0
let lastBusyAt = 0 // 最后一次 "有动静" (主会话 / 子代理 / 打字 / 发消息; 溜达不算) -> 模块据此算 5 分钟睡着
type Say = { seq: number; text: string; color: string }
let say: Say | undefined // 最近一条事件气泡; 模块按序号显示约 5 秒, 新的顶掉旧的
let saySeq = 0
const wasRunOut: Record<string, boolean> = {}
const saidRunOut = new Set<string>() // 每个额度窗口只说一次 "慢点"
let saidCtxFull = false

function sayNow(text: string, now: number, color = VALUE) {
  say = { seq: ++saySeq, text: '「' + text + '」', color }
  laneDirty = true
}

// 悬停气泡的内容 = 用量摘要 + 一条小贴士: 上下文 68% · 5小时 10% 1h54m 重置 · 本周 3% · 小贴士 /hud agents ...
// 给 Client 的是从长到短 4 种写法 + tipMin; 挑法 (tipFit) 和测试共用
function laneTipParts(pct: number | undefined, five: Limit | undefined, week: Limit | undefined, p5: Pace | undefined, pw: Pace | undefined, now: number): { v: string[]; tipMin: number } {
  const one = (name: string, l: Limit | undefined, p: Pace | undefined, withTime: boolean) =>
    !l
      ? ''
      : name + ' ' + Math.round(l.percentUsed) + '%' +
        (!withTime ? '' : p?.willRunOut && p.runOutIn !== undefined ? ' ' + durShort(p.runOutIn) + '用完' : p?.resetIn !== undefined ? ' ' + durShort(p.resetIn) + ' 重置' : '')
  const sum = (withTime: boolean) => ['上下文 ' + (pct === undefined ? '--' : Math.round(pct) + '%'), one('5小时', five, p5, withTime), one('本周', week, pw, withTime)].filter(Boolean).join(' · ')
  const tip = ' · 小贴士 ' + TIPS[Math.floor(now / 60000) % TIPS.length]
  return { v: [sum(true) + tip, sum(false) + tip, sum(true), sum(false)], tipMin: dw(sum(false) + ' · 小贴士 /hud ') + 3 }
}
export function laneTip(pct: number | undefined, five: Limit | undefined, week: Limit | undefined, p5: Pace | undefined, pw: Pace | undefined, now: number): (room: number) => string {
  const t = laneTipParts(pct, five, week, p5, pw, now)
  return tipFit(t.v, t.tipMin)
}

// 气泡: 配速从正常变成会用完 (每个窗口只说一次) / 上下文第一次到 COMPACT_AT
function noteTalk(now: number, pct: number | undefined, pairs: Array<[Limit | undefined, Pace | undefined]>) {
  for (const [l, p] of pairs) {
    if (!l || !p) continue
    const prev = wasRunOut[l.kind]
    wasRunOut[l.kind] = p.willRunOut
    const key = l.kind + '|' + (l.resetsAt ?? '')
    if (p.willRunOut && prev === false && p.runOutIn !== undefined && !saidRunOut.has(key)) {
      saidRunOut.add(key)
      sayNow('慢点！' + durShort(p.runOutIn) + '用完', now, WARN)
    }
  }
  if (pct === undefined) return
  if (pct >= COMPACT_AT && !saidCtxFull) {
    saidCtxFull = true
    sayNow('上下文快满了', now)
  }
  if (pct < 50) saidCtxFull = false
}

// 运行中的子代理 (按开始时间); 只认 SubagentStart 或 $.agent.list() 认过的
const runningKids = () =>
  [...kids.values()]
    .filter(k => k.known && k.endedAt === undefined)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(k => k.id)

// 散步道这一次画: 取用量 (心情 / 气泡 / 悬停摘要) 和子代理, 交给 Client; 渲染路径里不跑 git / 进程 / 文件
async function walkwayView($: any, els: any, W: number, rows: Rows, sky: boolean, working: boolean) {
  const now = await $.clock.now()
  engineWorking = working
  let u: any = {}
  try {
    u = await $.session.usage()
  } catch {}
  await syncAgents($, now)
  const limits = (u.rateLimits ?? []) as Limit[]
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  const p5 = paceOf(five, now)
  const pw = paceOf(week, now)
  const pct: number | undefined = u.context?.percent
  mood = moodOf(p5, pw)
  noteTalk(now, pct, [
    [five, p5],
    [week, pw],
  ])
  const w = Math.min(W, 512)
  const props: WalkProps = {
    w,
    rows,
    sky,
    working,
    agents: runningKids(),
    mood,
    pct: pct ?? lastPct,
    tool: currentTool ? toolKind(currentTool) : '',
    typeSeq,
    jumpSeq,
    celebSeq,
    celebFrames,
    ...(say ? { say } : {}), // props 里不能有 undefined
    idleMs: lastBusyAt > 0 ? Math.max(0, now - lastBusyAt) : 0,
    tip: laneTipParts(pct, five, week, p5, pw, now),
  }
  return <els.Client key="walkway" module="./walkway.tsx" props={props} width={w} height={rows + (sky ? 1 : 0)} />
}

// ---------------- 每轮收据 ----------------
function lineCount(s: unknown): number {
  if (typeof s !== 'string' || s === '') return 0
  const n = s.split('\n').length
  return s.endsWith('\n') ? n - 1 : n
}
// 按工具输入粗算 +/-: Edit 新旧字符串的行数, Write 内容的行数 (删掉的旧内容不知道, 不算)
function countEdit(run: { files: Set<string>; add: number; del: number }, e: any) {
  const path = String(e.file_path ?? e.notebook_path ?? '')
  if (path) run.files.add(path)
  switch (String(e.tool)) {
    case 'Edit':
      run.add += lineCount(e.new_string)
      run.del += lineCount(e.old_string)
      break
    case 'MultiEdit':
      for (const ed of Array.isArray(e.edits) ? e.edits : []) {
        run.add += lineCount(ed?.new_string)
        run.del += lineCount(ed?.old_string)
      }
      break
    case 'Write':
      run.add += lineCount(e.content)
      break
    case 'NotebookEdit':
      if (e.edit_mode !== 'delete') run.add += lineCount(e.new_source)
      break
  }
}

// TurnDuration 行和这一轮对上了吗:
//   TurnDuration 的 requestId 是那一行消息的 id, 不是 turnId, 所以按 "什么时候第一次画出来" + 时长对
//   - 只看最近一轮的收据; 一张收据只配一行
//   - 这一行第一次画出来的时间要在这一轮开始之后、结束后 5 秒之内 (更早的行是之前的回合)
//   - 行上的 durationMs 和 turn.complete 的 durationMs 相差不超过 max(2 秒, 5%)
//   - 配上了就按 requestId 钉住 (滚动重画还是同一张)
//   - 确定以后也配不上的行马上记成 "不配": 以后的回合都在现在之后才开始, 只有 "正在跑的这一轮" 和
//     "刚结束这一轮的 5 秒窗口" 还有机会; 面板动画每 0.15 秒会让所有 TurnDuration 行重画, 这样它们都走最省的路
const ROW_LATE_MS = 5000
export function receiptFor(id: string, durationMs: number | undefined, now: number): Receipt | undefined {
  if (!id) return undefined
  if (id in receiptOf) return receiptOf[id] ?? undefined
  const seen = (rowSeenAt[id] ??= now)
  const r = lastReceipt
  const inWindow = !!r && !r.boundTo && seen >= r.startedAt && seen <= r.completedAt + ROW_LATE_MS
  const near = (x: Receipt) => typeof durationMs !== 'number' || Math.abs(durationMs - x.durationMs) <= Math.max(2000, x.durationMs * 0.05)
  // 先比累计 (这一行写的是整次提问的时长 -> 整次提问的合计), 再比这一段
  const hit = r && inWindow ? (near(r.cum) ? r.cum : near(r.seg) ? r.seg : undefined) : undefined
  if (r && hit) {
    r.boundTo = id
    receiptOf[id] = hit
    return hit
  }
  const maybeRunning = !!turnRun && seen >= turnRun.startedAt
  const maybeLast = inWindow && now <= (r?.completedAt ?? 0) + ROW_LATE_MS
  if (!maybeRunning && !maybeLast) receiptOf[id] = null
  return undefined
}
// " · $0.42 · 改 3 个文件 +120 -30 · 工具 12 次"; 没数据的段省掉, 全没有就是空串
export function receiptText(r: Receipt): string {
  const parts: string[] = []
  if (r.usd !== undefined && r.usd >= 0.005) parts.push('$' + r.usd.toFixed(2))
  if (r.files > 0) parts.push('改 ' + r.files + ' 个文件' + (r.add || r.del ? ' +' + r.add + ' -' + r.del : ''))
  if (r.tools > 0) parts.push('工具 ' + r.tools + ' 次')
  return parts.length ? ' · ' + parts.join(' · ') : ''
}

// ---------------- 子代理看板 (侧边面板) ----------------
const KID_STATUS: Record<string, [string, string]> = {
  running: ['运行中', VIOLET],
  completed: ['已完成', '#4ade80'],
  failed: ['失败', WARN],
  killed: ['已停止', DIM],
}
async function buildAgentsPane($: any, els: any, W: number) {
  const { Box, Text, Button } = els
  const now = await $.clock.now()
  await syncAgents($, now)
  const shown = [...kids.values()].filter(k => k.known)
  const running = shown.filter(k => k.endedAt === undefined).sort((a, b) => a.startedAt - b.startedAt)
  const ended = shown
    .filter(k => k.endedAt !== undefined)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, KEEP_ENDED)
  const width = Math.max(30, W)
  const wide = width >= 72
  const line = (key: string, cols: Array<[string, number, string?]>) => (
    <Box key={key} flexDirection="row" height={1}>
      {cols.map(([text, w, color], i) => (
        <Text key={key + '-' + i} color={color ?? VALUE}>
          {padR(clip(text, w), w) + (i < cols.length - 1 ? ' ' : '')}
        </Text>
      ))}
    </Box>
  )
  // 宽面板一行一个: 状态 | 描述 | 时长 | 最后动静 | 最后工具 | 工具 (次数; 表头不能超过 FIX.n 格, 否则被截成 "工..")
  const FIX = { st: 8, ran: 7, idle: 9, tool: 14, n: 5 }
  const descW = Math.max(8, width - (FIX.st + FIX.ran + FIX.idle + FIX.tool + FIX.n) - 5)
  const row = (k: Kid) => {
    const isRun = k.endedAt === undefined
    const quiet = now - k.lastAt
    const stuck = isRun && quiet > STUCK_MS
    const [stText, stColor] = stuck ? ['可能卡住', WARN] : (KID_STATUS[k.status] ?? [safe(k.status) || '已结束', DIM])
    const name = k.desc || k.type || safe(k.id)
    const ran = dur((k.endedAt ?? now) - k.startedAt)
    const idle = isRun ? dur(quiet) + ' 前' : '--'
    const tool = k.lastTool ? shortTool(k.lastTool) : '--'
    const color = isRun ? (stuck ? WARN : VALUE) : DIM
    if (wide) {
      return [
        line('k-' + k.id, [
          [stText, FIX.st, stColor],
          [name, descW, color],
          [ran, FIX.ran, color],
          [idle, FIX.idle, stuck ? WARN : color],
          [tool, FIX.tool, color],
          [String(k.tools), FIX.n, color],
        ]),
      ]
    }
    // 窄面板两行一个
    const detail = isRun ? '已跑 ' + ran + ' · ' + idle + ' ' + tool + ' · ' + k.tools + ' 次' : '用时 ' + ran + ' · ' + k.tools + ' 次工具'
    return [
      line('k-' + k.id, [
        [stText, FIX.st, stColor],
        [name, width - FIX.st - 1, color],
      ]),
      line('k2-' + k.id, [
        ['', FIX.st],
        [detail, width - FIX.st - 1, stuck ? WARN : DIM],
      ]),
    ]
  }
  const head = wide
    ? [
        line('k-head', [
          ['状态', FIX.st, DIM],
          ['描述', descW, DIM],
          ['时长', FIX.ran, DIM],
          ['最后动静', FIX.idle, DIM],
          ['最后工具', FIX.tool, DIM],
          ['工具', FIX.n, DIM],
        ]),
      ]
    : []
  const body: any[] = [
    <Box key="k-top" flexDirection="row" height={1}>
      <Text key="k-title" color={ACCENT} bold>
        {'子代理'}
      </Text>
      <Text key="k-sum" color={DIM}>
        {padR('  运行中 ' + running.length + ' · 已结束 ' + ended.length, Math.max(0, width - 6))}
      </Text>
    </Box>,
  ]
  if (!shown.length) {
    body.push(
      <Text key="k-none" color={DIM}>
        {'这个会话还没有子代理，Esc 关闭'}
      </Text>,
    )
  }
  if (running.length) body.push(...head, ...running.flatMap(row))
  if (ended.length) {
    body.push(
      <Text key="k-ended" color={DIM}>
        {'已结束 (最近 ' + KEEP_ENDED + ' 个)'}
      </Text>,
      ...(running.length ? [] : head),
      ...ended.flatMap(row),
    )
  }
  if (shown.length) {
    body.push(
      <Text key="k-tip" color={DIM}>
        {'运行中超过 5 分钟没有工具动作的会标红，Esc 关闭'}
      </Text>,
    )
  }
  return (
    <Box key="kids" flexDirection="column" width={width}>
      {body}
    </Box>
  )
}

// 测试用: 不经过界面, 直接画某个状态下的螃蟹和状态文字
type PreviewOpts = { working?: boolean; pct?: number; agents?: number; frames?: number; mood?: Mood; celebrating?: boolean; sleeping?: boolean }
function previewOne(tool: string, opts: PreviewOpts): Scene {
  return {
    working: opts.working ?? true,
    kind: toolKind(tool),
    pct: opts.pct ?? 30,
    celebrating: opts.celebrating ?? false,
    sleeping: opts.sleeping ?? false,
    agents: opts.agents ?? 0,
    mood: opts.mood,
  }
}
export function previewScene(tool: string, opts: PreviewOpts = {}) {
  const out: string[] = []
  for (let f = 0; f < (opts.frames ?? 24); f++) {
    frame = f
    const s = previewOne(tool, opts)
    out.push(encode(scenePx(s, f), SPRITE_W, 3), encode(miniPx(s, f), MINI_W, 1))
  }
  frame = 0
  return { label: toolLabel(tool), kind: toolKind(tool), frames: out }
}
// 测试用: 同上, 但给出像素颜色 (-1 = 空), 方便检查小螃蟹画在哪里
export function previewPixels(tool: string, opts: PreviewOpts = {}) {
  const big: number[][][] = []
  const mini: number[][][] = []
  for (let f = 0; f < (opts.frames ?? 24); f++) {
    frame = f
    const s = previewOne(tool, opts)
    big.push(scenePx(s, f))
    mini.push(miniPx(s, f))
  }
  frame = 0
  return { big, mini, colors: { body: COL.body, kid: COL.kid, kidEye: COL.kidEye, kidLeg: COL.kidLeg, shades: COL.shades, sweat: COL.sweat, alarm: COL.alarm } }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadPrefs($)
    // 散步道和气泡从头开始
    say = undefined
    // 一次提问的记账从头开始
    ask = undefined
    mainOpen = false
    askFromNext = false
    submitSinceTurn = ''
    lastReceipt = undefined
    cancelEnd()
    saidCtxFull = false
    saidRunOut.clear()
    for (const k of Object.keys(wasRunOut)) delete wasRunOut[k]
    loadedVersion = await diskVersion($)
    lastActive = await $.clock.now()
    lastBusyAt = lastActive
    try {
      modelId = await $.session.model()
    } catch {}
    await readEffortFromSettings($, false)
    await refreshRepo($)
    await checkMilestones($)
    // 在后台数历史 token, 不耽误会话启动
    // classic.SessionStart 先到时它已经开数了, 这里不重复
    if (tokState === 'idle') {
      const where = await guessTranscript($)
      void countTokens($, transcriptPath ? { ...where, guess: transcriptPath } : where)
    }
    $.clock.every(FRAME_MS, async () => {
      tick += 1
      if (tick % 40 === 5) void watchLimits($) // 约每 6 秒看一次额度有没有恢复 (面板隐藏时也看)
      if (layout === 'off') return
      frame += 1
      // 散步道在 Client 里自己走; 这里只记 "有动静" 的时间 (模块据此算 5 分钟睡着)
      if (engineWorking || agentsNow > 0) lastBusyAt = await $.clock.now()
      if (needsFrame(await $.clock.now())) redraw($)
      if (frame % 400 === 7) void checkForUpdate($) // 约每 60 秒
      if (lastDesktopCols && lastDesktopCols !== savedDesktopCols) {
        savedDesktopCols = lastDesktopCols
        try {
          await $.store.set('desktopCols', lastDesktopCols)
        } catch {}
      }
    })
    try {
      await $.command.register({
        name: 'hud',
        description: '用量面板 (固定在输入框下方)：完整 → 精简 → 隐藏 循环；/hud agents 打开子代理看板，/hud crab 开关输入框上方散步的螃蟹',
        argumentHint: '[agents|crab]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('usage-hud: /hud 注册失败 ' + String(err))
    }
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase()
    // /hud agents: 子代理看板 (不注册顶级的 /agents, 那是内置命令)
    if (/^(agents?|kids?|代理|子代理)/.test(arg)) {
      await openAgents($, false)
      return { text: '已打开子代理看板（Esc 关闭）' }
    }
    // /hud crab [on|off]: 输入框正上方的螃蟹散步道 (只在终端); 不带参数就切换
    if (/^(crab|蟹|螃蟹)/.test(arg)) {
      const rest = arg.replace(/^(crab|蟹|螃蟹)\s*/, '')
      crabOn = /^(on|开|1)/.test(rest) ? true : /^(off|关|0)/.test(rest) ? false : !crabOn
      await $.store.set('crab', crabOn)
      laneDirty = true
      redraw($)
      return { text: crabOn ? '螃蟹散步道已打开（输入框正上方）' : '螃蟹散步道已关闭（/hud crab 再打开）' }
    }
    // v0.16: 终端版面板固定在输入框下方, 螃蟹在上方; /hud top|bottom 不再挪面板, 也不写 store
    if (/^(top|above|up|上)/.test(arg) || /^(bottom|below|down|下)/.test(arg)) {
      return { text: '终端版面板固定在输入框下方，螃蟹在上方' }
    }
    layout = LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length]
    await $.store.set('layout', layout)
    redraw($)
    return { text: '用量面板：' + { full: '完整', compact: '精简', off: '已隐藏（再输入 /hud 打开）' }[layout] }
  })

  // 换模型 / 换档位后马上刷新
  on('command.run', { command: ['model', 'effort'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      modelId = await $.session.model()
    } catch {}
    await readEffortFromSettings($, true)
    redraw($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as any).agentId) {
      engineWorking = true
      turnStartedAt = await $.clock.now()
      lastActive = turnStartedAt
      turnTools = 0
      // 每轮收据: 记下开始时的花费, 结束时取差
      let usd0: number | undefined
      try {
        usd0 = (await $.session.usage()).cost?.usd
      } catch {}
      turnRun = { turnId: String(e.turnId ?? ''), startedAt: turnStartedAt, usd0, files: new Set(), add: 0, del: 0, tools: 0 }
      // 新的一段开始: "提问做完" 的等待取消
      mainOpen = true
      cancelEnd()
      // 这一段属于哪次提问: 前面来的是 task-notification -> 延续; 用户排队的提问 -> 新提问从这里开始;
      // 前面什么都没来 (比如测试或引擎自己接着跑): 上一次还没做完就延续, 做完了就算新提问
      const via = submitSinceTurn
      submitSinceTurn = ''
      if (askFromNext || !ask || (via !== 'task-notification' && via === '' && ask.celebrated)) ask = newAsk(turnStartedAt, usd0)
      askFromNext = false
      ask.segments += 1
      const h = new Date().getHours()
      if (h >= 1 && h < 5 && !nightNoticed) {
        nightNoticed = true
        $.ui.toast(`已经凌晨 ${h} 点了，螃蟹陪你干活，也记得早点休息`)
      }
      redraw($)
    }
    return next(e)
  })

  // 每次向模型发请求: 主线程记下模型和档位; 所有线程 (含子代理) 的 token 都累加
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      if (e.effort !== undefined && e.effort !== null) effort = String(e.effort)
      if (e.model) modelId = e.model
    }
    const result = yield* next(e)
    if (result?.usage) {
      // 主线程和认得的子代理才算 (和会话记录一致); 还没认出来的 id 先记着, 引擎自己的分叉一直认不出来就不算
      const id = e.agentId ? String(e.agentId) : ''
      if (!id || kids.get(id)?.known) addTok(tokLive, result.usage)
      else {
        const t = tokPending.get(id) ?? zeroTok()
        addTok(t, result.usage)
        tokPending.set(id, t)
        if (tokPending.size > 50) tokPending.delete(tokPending.keys().next().value as string)
      }
      redraw($)
    }
    return result
  })

  // 启动 / 恢复 / /clear 时拿到会话记录的准确路径; 恢复时顺便拿到当时的上下文大小
  on('classic.SessionStart', async ($, e, next) => {
    const src = String((e as any).source ?? '')
    const path = String((e as any).transcript_path ?? '')
    if (src === 'resume' || src === 'fork') resumeCtx = (e as any).context_tokens
    if (src === 'clear') {
      resumeCtx = undefined
      milestonePrimed = false // 花费从 0 重新算, 里程碑提示也重新开始
      costMilestone = 0
      toolCounts = {}
      totalTools = 0
      lastTurnMs = 0
      lastTurnTools = 0
    }
    if (path && (path !== transcriptPath || src === 'clear' || src === 'resume' || src === 'fork')) void countTokens($, { guess: path, id: '', root: '' })
    return next(e)
  })

  // 子代理看板: 开始 / 结束时间、类型、最后一句话
  on('classic.SubagentStart', async ($, e, next) => {
    const id = String((e as any).agent_id ?? '')
    if (id) {
      const now = await $.clock.now()
      const k = kidOf(id, now)
      if (!k.known) {
        k.startedAt = now
        k.lastAt = now
      }
      kidKnown(k)
      k.status = 'running'
      k.ran = true
      k.endedAt = undefined
      k.endNoted = false
      if ((e as any).agent_type) k.type = safe(String((e as any).agent_type))
      redraw($)
    }
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const id = String((e as any).agent_id ?? '')
    if (id) {
      const now = await $.clock.now()
      const k = kidOf(id, now)
      kidKnown(k)
      k.ran = true
      if (k.endedAt === undefined) k.endedAt = now
      if (k.status === 'running') k.status = 'completed'
      kidEnded(k)
      if ((e as any).agent_type && !k.type) k.type = safe(String((e as any).agent_type))
      const last = String((e as any).last_assistant_message ?? '')
      if (last) k.note = clip(safe(last.replace(/\s+/g, ' ')), 120)
      pruneKids()
      armEnd($, false)
      redraw($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      turnTools += 1
      currentTool = e.tool
    }
    totalTools += 1
    toolCounts[e.tool] = (toolCounts[e.tool] ?? 0) + 1
    // 收据: 主线程一轮进行中, 所有线程 (含子代理) 的工具都算这一轮的
    const run = turnRun
    if (run) run.tools += 1
    // 整次提问的合计: 主线程两段之间后台子代理用的工具也算
    const q = ask
    if (q) {
      q.tools += 1
      if (!e.agentId) q.mainTools += 1
    }
    // 看板: 子代理的最后动静 / 最后工具 / 次数
    const kid = e.agentId ? kidOf(e.agentId, await $.clock.now()) : undefined
    if (kid) {
      kid.lastAt = await $.clock.now()
      kid.lastTool = e.tool
      kid.tools += 1
    }
    if (totalTools % 100 === 0) {
      celebrateUntil = (await $.clock.now()) + 1600
      $.ui.toast(`本会话第 ${totalTools} 次工具调用，螃蟹给你鼓掌`)
    }
    redraw($)
    let ran: any
    try {
      ran = await next(e)
      return ran
    } finally {
      if (!e.agentId) currentTool = '' // (工具刚结束时散步道的螃蟹还会多做 4 帧动作, 在模块里算)
      if (kid) kid.lastAt = await $.clock.now()
      // 改文件只算真的改成了的 (没被拒、没报错)
      const edited = ran && !ran.deny && !ran.isError && toolKind(String(e.tool)) === 'edit'
      if (run && edited) countEdit(run, e)
      if (q && edited) countEdit(q, e)
      redraw($)
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (!(e as any).agentId) {
      const now = await $.clock.now()
      // 每轮收据: 在 next(e) 之前落到模块变量里, TurnDuration 那行画出来时就能找到
      const run = turnRun
      turnRun = undefined
      let usd1: number | undefined
      try {
        usd1 = (await $.session.usage()).cost?.usd
      } catch {}
      const q = ask
      if (q) q.lastEndAt = now
      if (run && (!e.turnId || !run.turnId || e.turnId === run.turnId)) {
        // 这一段
        const seg: Receipt = {
          turnId: run.turnId,
          startedAt: run.startedAt,
          completedAt: now,
          durationMs: typeof e.durationMs === 'number' ? e.durationMs : now - run.startedAt,
          usd: run.usd0 !== undefined && usd1 !== undefined ? Math.max(0, usd1 - run.usd0) : undefined,
          files: run.files.size,
          add: run.add,
          del: run.del,
          tools: run.tools,
        }
        // 从提问开始的累计 (只有一段时就是这一段)
        const cum: Receipt =
          q && q.segments > 1
            ? {
                turnId: run.turnId,
                startedAt: q.startedAt,
                completedAt: now,
                durationMs: now - q.startedAt,
                usd: q.usd0 !== undefined && usd1 !== undefined ? Math.max(0, usd1 - q.usd0) : undefined,
                files: q.files.size,
                add: q.add,
                del: q.del,
                tools: q.tools,
              }
            : seg
        lastReceipt = { seg, cum, startedAt: run.startedAt, completedAt: now }
      }
      engineWorking = false
      mainOpen = false
      currentTool = ''
      lastActive = now
      // 这次提问做没做完: 子代理都结束了、等一小会儿没有新的一段才算 (见 armEnd / endAsk)
      await syncAgents($, now)
      armEnd($, true)
      await refreshRepo($)
      await checkMilestones($)
      redraw($)
    }
    return next(e)
  })

  // 每轮结束那行 (Crunched for 9m 6s · done 12:06 AM) 后面追加收据; 引擎自己那行原样保留
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.surface !== 'terminal' || layout === 'off') return theirs
    const known = receiptOf[e.requestId]
    if (known === null) return theirs // 已确定不配: 最省的路
    const r = known ?? receiptFor(e.requestId, e.props.durationMs, await $.clock.now())
    const text = r ? receiptText(r) : ''
    if (!text) return theirs
    const { Box, Text } = $.ui.resolve(e)
    // 底边对齐: 引擎那行上面可能留了空行 (marginTop), 收据跟在字的那一行
    return (
      <Box flexDirection="row" alignItems="flex-end">
        {theirs}
        <Text key="receipt" dimColor wrap="truncate">
          {text}
        </Text>
      </Box>
    )
  })

  // 子代理看板 (终端和客户端都画)
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const els: any = $.ui.resolve(e)
    return buildAgentsPane($, els, (e.props as any).bodyColumns ?? 60)
  })

  on('session.measure', async ($, e, next) => {
    redraw($)
    return next(e)
  })

  // 用户在输入框打字: 螃蟹停下低头看输入框, 最后一次按键后约 1.5 秒恢复 (只改序号; 连着打字时约 0.4 秒推一次 props)
  on('prompt.edit', async ($, e, next) => {
    const now = await $.clock.now()
    typeSeq += 1
    lastBusyAt = now
    if (now - typePushedAt > 400 && crabOn && layout !== 'off') {
      typePushedAt = now
      redraw($)
    }
    return next(e)
  })
  // 有消息送进会话 (v0.16.2 看 origin.kind):
  //   task-notification (后台子代理的结果送回来) = 同一次提问的延续; 其他来源 = 新提问, 上一次没做完的作废
  //   跳一下只给用户自己发的 (终端回车 composer / 手机网页 bridge)
  on('prompt.submit', async ($, e, next) => {
    const kind = String((e as any).origin?.kind ?? 'composer')
    const now = await $.clock.now()
    cancelEnd()
    submitSinceTurn = kind
    lastBusyAt = now
    if (kind === 'task-notification') {
      if (ask) ask.notices += 1
    } else if ((e as any).turnId) {
      askFromNext = true // 主线程跑着时打的字: 排在后面, 它那一段开始时才算新提问
    } else {
      let usd0: number | undefined
      try {
        usd0 = (await $.session.usage()).cost?.usd
      } catch {}
      ask = newAsk(now, usd0)
      askFromNext = false
    }
    if (kind === 'composer' || kind === 'bridge') {
      jumpSeq += 1
      if (crabOn && layout !== 'off') redraw($)
    }
    return next(e)
  })

  // 压缩完成 -> 气泡 "压缩完了" (主会话的; 预先算好备用的 precompute 不算)
  on('session.compact', async ($, e, next) => {
    const r: any = await next(e)
    if (!(e as any).agentId && e.trigger !== 'precompute' && r && !r.skip) {
      saidCtxFull = false
      sayNow('压缩完了', await $.clock.now())
    }
    return r
  })

  // 等你批准权限 -> 气泡 "等你点头"
  //   classic.PermissionRequest: 要弹权限框了; 下面的 settings hook 已经替你决定 (带 decision) 就不说
  //   classic.Notification 的 permission_prompt: 引擎发出 "需要你批准" 的通知
  //   (不用 tool.check 的 ask: auto 模式下 ask 先交给分类器, 不一定会问你)
  on('classic.PermissionRequest', async ($, e, next) => {
    const r: any = await next(e)
    if (!r?.decision && !r?.hookSpecificOutput?.decision) sayNow('等你点头', await $.clock.now())
    return r
  })
  on('classic.Notification', async ($, e, next) => {
    if (String((e as any).notification_type ?? '') === 'permission_prompt') sayNow('等你点头', await $.clock.now())
    return next(e)
  })

  // 输入框上方的横栏:
  //   客户端 -> 客户端专用的 SVG 面板 (客户端只用这一处)
  //   终端   -> 螃蟹散步道 (/hud crab 开关); 面板固定在输入框下方 (PromptHint)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (layout === 'off' || e.props.hasSurvey) return next(e)
    if (e.surface === 'desktop') {
      const els: any = $.ui.resolve(e)
      return buildDesktop($, els, e.props.bodyColumns ?? 100, !!e.props.isWorking)
    }
    if (e.surface !== 'terminal') return next(e)
    // bodyColumns 已经扣掉引擎右端放 [-] 的 5 格; maxRows = 这条横栏最多能占几行
    // v0.16: 终端版这里只画散步道 (面板固定在输入框下方). 按 maxRows 退档:
    //   >=4: 天空行 + 3 行版; 3: 天空行 + 2 行版; 2: 2 行版 (没有天空行); 1: 1 行版; 0: 不画
    const W = e.props.bodyColumns ?? 100
    const maxRows = e.props.maxRows ?? 0
    const total = crabOn ? Math.min(4, maxRows) : 0
    if (total < 1) return next(e)
    const sky = total >= 3
    const rows = (sky ? total - 1 : total) as Rows
    return walkwayView($, $.ui.resolve(e), W, rows, sky, !!e.props.isWorking)
  })

  // 终端面板固定在输入框下方: 面板在上, 引擎自己的提示行 (auto mode / esc to interrupt) 保留在下
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || layout === 'off') return next(e)
    const theirs = await next(e)
    const els: any = $.ui.resolve(e)
    const { Box } = els
    const cols = Math.max(40, ((e as any).viewport?.columns ?? 100) - 2)
    const view = await buildView($, els, e.surface, cols, !!e.props.isWorking)
    return (
      <Box flexDirection="column">
        {view}
        {theirs}
      </Box>
    )
  })
}
