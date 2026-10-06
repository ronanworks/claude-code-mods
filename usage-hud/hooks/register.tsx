import type { Register } from 'claude-code'
import { crabSvg, dashSvg, type DashData } from './desktop'

// usage-hud v0.5: 用量面板 (终端版 + 客户端版)
//
// 客户端 (桌面 app 的 Code 标签页): 输入框上方一张卡片, 左边 SVG 像素螃蟹 (动作由 SMIL 动画循环播放),
//   右边 SVG 仪表盘 (自带深色底板), 下面一行可点的链接; 绘制代码在 ./desktop.ts
//
// 位置: 默认在输入框下方 (画在提示行 PromptHint 里, 引擎自己的提示行保留在最下面);
//       /hud top 改到输入框上方 (上面空一行, 和回复隔开), /hud bottom 改回下方
//
// 完整版是 "螃蟹 + 3 行 x 3 列" 的对齐网格, 每列起点在三行里完全一致:
//   模型   Opus 5.5 ▁▂▃▅▇ medium   项目   my-app main               会话   6d18h   $199.91
//   上下文 ━━━━━━━━  14% 140k/1.0M   5小时  ━━━━━━━━  14% 3h05m后重置  本周   ━━━━━━━━  43% 1d18h后重置
//   状态   ▃▅▂ 读文件        12s     工具   Bash 12  Read 4         子代理 2 个运行中
//
// 螃蟹动画 (全部用像素画, 不用可能宽度不一的符号):
//   思考 -> 眼睛往右看 + 冒出思考点点      读/搜 -> 看一页纸, 扫描线上下移动
//   改/写 -> 右钳子敲击 + 纸上逐渐写满字    跑命令 -> 双钳交替敲键盘 + 终端光标闪烁
//   上网 -> 旋转的小地球                   派子代理 / 子代理在跑 -> 身边跳动的小螃蟹
//   其他工具 -> 转动的小齿轮               一轮结束 -> 举钳跳跃 + 金色闪光
//   闲置 -> 眨眼 / 左右张望 / 偶尔挥手      5 分钟没动 -> 闭眼呼吸 + 冒泡泡
//   上下文 >=80% -> 变红冒汗, >=95% -> 红色闪烁报警
//   数字变化时会滚动过渡; 工作时上下文条有流光; 5小时/本周 >=90% 时用量条呼吸闪烁
//
// 可点击: 模型名 -> /model, 项目名 -> 打开项目文件夹, 上下文 -> /context, 5小时/本周 -> /usage
// /hud: 完整 -> 精简(1 行) -> 隐藏 循环; /hud top | bottom 切换位置

const LAYOUTS = ['full', 'compact', 'off'] as const
type Layout = (typeof LAYOUTS)[number]
const POSITIONS = ['below', 'above'] as const
type Position = (typeof POSITIONS)[number]

const FRAME_MS = 150
const SLEEP_AFTER_MS = 5 * 60_000
const PRESS_GAP_MS = 800 // 双击只算一次
const COST_MILESTONES = [5, 10, 20, 50, 100, 200, 500, 1000]
const USAGE_URL = 'https://claude.ai/settings/usage'
const SPRITE_W = 15 // 12 列螃蟹 + 3 列道具
const MINI_W = 8
const LABEL_W = 6
const GAP = 3
const HPAD = 2 // 面板左右各留的空格数

// ---------------- 会话状态 (模块变量) ----------------
let layout: Layout = 'full'
let position: Position = 'below'
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

// ---------------- 颜色 ----------------
const COL = {
  body: 0xd97757,
  hot: 0xe5484d,
  eye: 0x1c1917,
  sweat: 0x60a5fa,
  spark: 0xfacc15,
  bubble: 0x8b8b94,
  paper: 0xd4d4d8,
  ink: 0x52525b,
  scan: 0x60a5fa,
  term: 0x3f3f46,
  cursor: 0x4ade80,
  sea: 0x3b82f6,
  land: 0x4ade80,
  gear: 0xa1a1aa,
  thought: 0xa1a1aa,
}
const DEF = 0x01000000
const TRACK = 0x3f3f46
const DIM = '#71717a'
const ACCENT = '#d97757'
const VIOLET = '#a78bfa'
const VALUE = '#d4d4d8'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_COLOR: Record<string, string> = {
  low: '#a1a1aa',
  medium: '#60a5fa',
  high: '#fbbf24',
  xhigh: '#fb923c',
  max: '#f87171',
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
function heat(t: number): number {
  const g = 0x4ade80
  const y = 0xfbbf24
  const r = 0xf87171
  return t < 0.6 ? mix(g, y, t / 0.6) : mix(y, r, Math.min(1, (t - 0.6) / 0.4))
}

// ---------------- 文字宽度 (中文/全角算 2 列) ----------------
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  )
}
function dw(s: string): number {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return w
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
function clip(s: string, max: number): string {
  if (max <= 0) return ''
  if (dw(s) <= max) return s
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
    if (w + cw > max - 2) break
    out += ch
    w += cw
  }
  return out + '..'
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
// 大数: 999 / 12.3k / 4.56M / 345.4M / 2.26B
function big(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k'
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M'
  return (n / 1e9).toFixed(2) + 'B'
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
type ToolKind = 'think' | 'read' | 'edit' | 'bash' | 'web' | 'agent' | 'other'
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

// ---------------- 像素画 ----------------
type Px = number[][]
function canvas(w: number, h: number): Px {
  const p: Px = []
  for (let y = 0; y < h; y++) p.push(new Array(w).fill(-1))
  return p
}
function put(p: Px, x: number, y: number, c: number) {
  if (y >= 0 && y < p.length && x >= 0 && x < p[y].length) p[y][x] = c
}
function rect(p: Px, x0: number, y0: number, w: number, h: number, c: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(p, x, y, c)
}
function encode(px: Px, cols: number, cellRows: number): string {
  const words: number[] = []
  for (let r = 0; r < cellRows; r++) {
    for (let c = 0; c < cols; c++) {
      const top = px[r * 2]?.[c] ?? -1
      const bot = px[r * 2 + 1]?.[c] ?? -1
      if (top < 0 && bot < 0) words.push(32, DEF, DEF)
      else if (bot < 0) words.push(0x2580, top, DEF) // ▀
      else if (top < 0) words.push(0x2584, bot, DEF) // ▄
      else words.push(0x2580, top, bot)
    }
  }
  return new Uint8Array(Uint32Array.from(words).buffer).toBase64()
}

type Pose = { bob: number; legs: number; eyes: 'open' | 'closed'; look: number; armL: 'out' | 'up'; armR: 'out' | 'up'; body: number }

// 12x5 像素的螃蟹 (第 6 行留给上下颠)
function drawCrab(p: Px, o: Pose) {
  const y = o.bob
  rect(p, 2, y, 8, 4, o.body)
  if (o.armL === 'out') rect(p, 0, y + 2, 2, 1, o.body)
  else rect(p, 0, y, 1, 2, o.body)
  if (o.armR === 'out') rect(p, 10, y + 2, 2, 1, o.body)
  else rect(p, 11, y, 1, 2, o.body)
  // 走路: 四条腿两两交替抬起
  const legs = [[2, 4, 7, 9], [2, 7], [2, 4, 7, 9], [4, 9]][o.legs % 4]
  for (const x of legs) put(p, x, y + 4, o.body)
  const eye = o.eyes === 'open' ? COL.eye : mix(o.body, COL.eye, 0.45)
  put(p, 4 + o.look, y + 1, eye)
  put(p, 7 + o.look, y + 1, eye)
}

type Scene = { working: boolean; kind: ToolKind; pct: number; celebrating: boolean; sleeping: boolean; agents: number }

function bodyColor(pct: number): number {
  if (pct >= 95) return frame % 4 < 2 ? COL.hot : COL.body
  return pct >= 80 ? COL.hot : COL.body
}

function scenePx(s: Scene): Px {
  const p = canvas(SPRITE_W, 6)
  const f = frame
  const t = Math.floor(f / 2)
  const o: Pose = { bob: 0, legs: 0, eyes: 'open', look: 0, armL: 'out', armR: 'out', body: bodyColor(s.pct) }
  let props = true

  if (s.celebrating) {
    o.armL = 'up'
    o.armR = 'up'
    o.bob = t % 2
    const spots = [[12, 0], [14, 1], [13, 3], [12, 5], [14, 4], [13, 1], [1, 0], [10, 0]]
    spots.forEach(([x, y], i) => {
      if ((i + f) % 3 === 0) put(p, x, y, COL.spark)
    })
    props = false
  } else if (s.working) {
    o.legs = t % 4
    o.bob = t % 2
    switch (s.kind) {
      case 'think': {
        o.look = 1
        const dots = [[12, 4], [13, 2], [14, 0]]
        const n = Math.floor(f / 3) % 4
        for (let i = 0; i < n; i++) put(p, dots[i][0], dots[i][1], COL.thought)
        break
      }
      case 'read': {
        o.look = 1
        rect(p, 12, 1, 3, 4, COL.paper)
        rect(p, 12, 1 + (t % 4), 3, 1, COL.scan)
        break
      }
      case 'edit': {
        o.look = 1
        o.armR = f % 2 ? 'up' : 'out'
        rect(p, 12, 1, 3, 4, COL.paper)
        const k = t % 13
        for (let i = 0; i < k; i++) put(p, 12 + (i % 3), 1 + Math.floor(i / 3), COL.ink)
        break
      }
      case 'bash': {
        o.armL = f % 2 ? 'up' : 'out'
        o.armR = f % 2 ? 'out' : 'up'
        rect(p, 12, 1, 3, 4, COL.term)
        put(p, 12, 2, COL.cursor)
        if (f % 4 < 2) put(p, 13, 4, COL.cursor)
        break
      }
      case 'web': {
        o.look = 1
        const ring = [[13, 1], [14, 2], [13, 3], [12, 2]]
        for (const [x, y] of ring) put(p, x, y, COL.sea)
        put(p, 13, 2, COL.sea)
        const [lx, ly] = ring[t % 4]
        put(p, lx, ly, COL.land)
        break
      }
      case 'agent':
        break
      default: {
        const orbit = [[12, 1], [13, 1], [14, 1], [14, 2], [14, 3], [13, 3], [12, 3], [12, 2]]
        put(p, 13, 2, COL.gear)
        const [gx, gy] = orbit[f % 8]
        put(p, gx, gy, COL.gear)
      }
    }
    props = s.kind === 'agent'
  } else if (s.sleeping) {
    o.eyes = 'closed'
    o.bob = Math.floor(f / 8) % 2 // 慢慢呼吸
    const z = Math.floor(f / 3)
    put(p, 13, 5 - (z % 6), COL.bubble)
    put(p, 14, 5 - ((z + 3) % 6), COL.bubble)
  } else {
    const cyc = f % 160
    if (f % 30 === 0) o.eyes = 'closed' // 眨眼
    if (cyc >= 60 && cyc < 68) o.look = -1 // 左右张望
    else if (cyc >= 68 && cyc < 76) o.look = 1
    if (cyc >= 120 && cyc < 136) o.armR = Math.floor(f / 3) % 2 ? 'up' : 'out' // 挥手
  }

  drawCrab(p, o)

  // 子代理: 身边跳动的小螃蟹 (最多 3 只)
  if (props && s.agents > 0) {
    for (let i = 0; i < Math.min(3, s.agents); i++) {
      const up = (f + i * 2) % 4 < 2 ? 1 : 0
      put(p, 12 + i, 5 - up, COL.body)
      put(p, 12 + i, 4 - up, i % 2 ? COL.body : mix(COL.body, COL.eye, 0.3))
    }
  }
  // 上下文告急: 头边冒汗
  if (s.pct >= 80 && !s.celebrating) {
    const d = t % 4
    if (d < 2) put(p, 1, d, COL.sweat)
  }
  return p
}

function miniPx(s: Scene): Px {
  const p = canvas(MINI_W, 2)
  const f = frame
  const t = Math.floor(f / 2)
  const body = bodyColor(s.pct)
  rect(p, 0, 0, MINI_W, 1, body)
  const closed = s.sleeping || (!s.working && f % 30 === 0)
  const look = s.working ? 1 : 0
  const eye = closed ? mix(body, COL.eye, 0.45) : COL.eye
  put(p, 2 + look, 0, eye)
  put(p, 5 + look, 0, eye)
  const legs = s.celebrating ? [0, 7] : s.working && t % 2 ? [0, 2, 5, 7] : [1, 3, 4, 6]
  for (const x of legs) put(p, x, 1, body)
  return p
}

const KAOMOJI: Record<string, string> = {
  idle: '(o_o)',
  blink: '(-_-)',
  work: '(o_o)/',
  work2: '\\(o_o)',
  hot: '(;o_o)',
  jump: '\\(^o^)/',
  sleep: '(-_-)zZ',
}
function kaomoji(s: Scene): string {
  if (s.celebrating) return KAOMOJI.jump
  if (s.working) return Math.floor(frame / 2) % 2 ? KAOMOJI.work : KAOMOJI.work2
  if (s.pct >= 80) return KAOMOJI.hot
  if (s.sleeping) return KAOMOJI.sleep
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

function barParts(els: any, key: string, pct: number | undefined, width: number, shimmerAt: number, pulse: number): any[] {
  const { Text } = els
  const p = pct === undefined ? 0 : Math.max(0, Math.min(100, pct)) / 100
  // 只用整格: 半格字符在终端里会留一道缝 (实测)
  const full = p > 0 ? Math.max(1, Math.round(p * width)) : 0
  const cells: any[] = []
  for (let i = 0; i < width; i++) {
    const lit = i < full
    const ch = '━'
    let col = lit ? heat(i / Math.max(1, width - 1)) : TRACK
    if (lit && pulse > 0) col = mix(col, 0xffffff, pulse)
    if (lit && Math.abs(i - shimmerAt) < 1) col = mix(col, 0xffffff, 0.6)
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
  pct?: number
  bw: number
  extra: string
  extraW: number
  shimmerAt: number
  pulse: number
}
function meter(els: any, o: MeterOpts): any[] {
  const { Text } = els
  const shownPct = ease(o.key, o.pct)
  const pctText = shownPct === undefined ? '--' : Math.round(shownPct) + '%'
  const pctColor = o.pct === undefined ? DIM : hex(heat(Math.min(100, o.pct) / 100))
  const parts = [
    ...label(els, 'btn-' + o.key, o.label, o.labelW, o.onPress),
    ...barParts(els, o.key, shownPct, o.bw, o.shimmerAt, o.pulse),
    <Text key={o.key + '-pct'} color={pctColor} bold>
      {' ' + padL(pctText, 4)}
    </Text>,
  ]
  if (o.extraW > 0) {
    parts.push(
      <Text key={o.key + '-x'} color={DIM}>
        {' ' + padR(clip(o.extra, o.extraW), o.extraW)}
      </Text>,
    )
  }
  return parts
}
const meterWidth = (o: { label: string; labelW: number; bw: number; extraW: number }) =>
  Math.max(o.labelW, dw(o.label)) + 1 + o.bw + 5 + (o.extraW > 0 ? 1 + o.extraW : 0)

function effortParts(els: any, key: string): any[] {
  const { Text } = els
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
  parts.push(
    <Text key={key + '-ew'} color={color}>
      {' ' + (effort ? clip(safe(effort), 6) : '--')}
    </Text>,
  )
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

// Claude Code 启动子进程时把窗口设成隐藏, 直接跑 explorer.exe 打开的文件夹窗口也会是隐藏的;
// 经 cmd 的 start 转一手, 新窗口按正常方式显示 (已在本机验证)
async function openProject($: any) {
  if (!(await pressOk($, 'project'))) return
  try {
    const dir = (cwd || (await $.session.cwd())).replace(/\//g, '\\')
    if (/^[^&^|<>()%!"]+$/.test(dir)) {
      await $.process.run(['cmd.exe', '/d', '/c', 'start', 'usage hud', dir], { timeoutMs: 10_000 })
    } else {
      const script = "Start-Process -FilePath '" + dir.replace(/'/g, "''") + "'"
      await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', utf16Base64(script)], {
        timeoutMs: 20_000,
      })
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
        await $.process.run(['cmd.exe', '/d', '/c', 'start', 'usage hud', fallbackUrl], { timeoutMs: 10_000 })
      } catch {}
    } else {
      $.ui.toast('/' + command + ' 运行失败: ' + String(err))
    }
  }
}

async function refreshRepo($: any) {
  try {
    cwd = await $.session.cwd()
    project = safe(cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd)
    const b = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5000 })
    branch = b.exitCode === 0 ? safe(b.stdout.trim()) : ''
    dirty = 0
    if (branch) {
      const s = await $.process.run(['git', 'status', '--porcelain', '-uno'], { timeoutMs: 5000 })
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
    const p = await $.store.get('position')
    if (POSITIONS.includes(p)) position = p
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
    const pct = u.context.percent ?? 0
    if (pct >= 80 && !warnedContext) {
      warnedContext = true
      $.ui.toast(`上下文已用 ${pct}%，螃蟹开始冒汗了，可以考虑 /compact`)
    }
    if (pct < 50) warnedContext = false
  } catch {}
}

// 会话记录文件: ~/.claude/projects/<工作目录里非字母数字都换成 -><会话 id>.jsonl
// 会话记录按"启动时的目录"存放; 中途 cd 过的话这里猜错, 统计脚本会再按会话 id 去各项目目录里找
type Where = { guess: string; id: string; root: string }
async function guessTranscript($: any): Promise<Where> {
  try {
    const id = await $.session.id()
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
    const root = home ? home + '\\.claude\\projects' : ''
    const dir = (await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
    return { guess: root ? root + '\\' + dir + '\\' + id + '.jsonl' : '', id, root }
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
    const script = $.plugin.root.replace(/[\\/]+$/, '') + '\\scripts\\count-tokens.js'
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
  if (engineWorking || tweening || agentsNow > 0 || lastPct >= 80) return true
  if (now < celebrateUntil + 2 * FRAME_MS) return true
  if (lastActive > 0 && now - lastActive > SLEEP_AFTER_MS) return frame % 2 === 0
  const cyc = frame % 160
  if (frame % 30 <= 1) return true
  if ((cyc >= 60 && cyc <= 77) || (cyc >= 120 && cyc <= 137)) return true
  return frame % 13 === 0
}

// ---------------- 画面 ----------------
// 终端版和客户端版共用的一次取数
type Limit = { kind: string; percentUsed: number; resetsAt?: string }
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
  try {
    agentsNow = (await $.agent.list()).filter((a: any) => a.status === 'running').length
  } catch {}
  const limits = (u.rateLimits ?? []) as Limit[]
  const scene: Scene = {
    working,
    kind: toolKind(currentTool),
    pct: lastPct,
    celebrating: now < celebrateUntil,
    sleeping: !working && lastActive > 0 && now - lastActive > SLEEP_AFTER_MS,
    agents: agentsNow,
  }
  return {
    now,
    u,
    ctxWindow,
    ctxTokens,
    pct,
    five: limits.find(l => l.kind === 'five_hour'),
    week: limits.find(l => l.kind === 'seven_day'),
    scene,
    tk: tokSum(),
  }
}

// ---------------- 客户端 (桌面 app) 版 ----------------
// 客户端横栏一格约 7.35 像素 (按 81 格 ≈ 596 像素的实测截图校准)
const DESKTOP_PX_PER_COL = 7.35

async function buildDesktop($: any, els: any, cols: number, working: boolean) {
  const { Box, Svg } = els
  const s = await snapshot($, working)
  const reset = (l?: Limit) => (l?.resetsAt ? durShort(Date.parse(l.resetsAt) - Date.now()) + ' 后重置' : '')
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
    five: { pct: s.five?.percentUsed, extra: reset(s.five) },
    week: { pct: s.week?.percentUsed, extra: reset(s.week) },
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
      mode: sc.celebrating ? 'celebrate' : working ? 'work' : sc.sleeping ? 'sleep' : 'idle',
      kind: sc.kind,
      heat: lastPct >= 95 ? 'crit' : lastPct >= 80 ? 'hot' : 'ok',
      agents: Math.min(3, agentsNow),
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
  try {
    agentsNow = (await $.agent.list()).filter((a: any) => a.status === 'running').length
  } catch {}
  const limits = (u.rateLimits ?? []) as Array<{ kind: string; percentUsed: number; resetsAt?: string }>
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  const resetIn = (l?: { resetsAt?: string }) => (l?.resetsAt ? durShort(Date.parse(l.resetsAt) - Date.now()) : '')
  const scene: Scene = {
    working,
    kind: toolKind(currentTool),
    pct: lastPct,
    celebrating: now < celebrateUntil,
    sleeping: !working && lastActive > 0 && now - lastActive > SLEEP_AFTER_MS,
    agents: agentsNow,
  }
  const pulse = (l?: { percentUsed: number }) => (l && l.percentUsed >= 90 ? 0.25 * (1 + Math.sin(frame / 2)) : 0)

  const onModel = () => runSlash($, 'model')
  const onContext = () => runSlash($, 'context')
  const onUsage = () => runSlash($, 'usage', USAGE_URL)
  const onProject = () => openProject($)

  const model = prettyModel(modelId)
  const statusText = (max: number): { text: string; color: string } => {
    const ag = agentsNow ? ' +' + agentsNow + '代理' : ''
    if (working) {
      const room = Math.max(4, max - 11 - dw(ag))
      return { text: eq(frame) + ' ' + padR(clip(toolLabel(currentTool), room), room) + ' ' + padL(dur(now - turnStartedAt), 6) + ag, color: ACCENT }
    }
    if (agentsNow) return { text: clip(eq(frame) + ' ' + agentsNow + ' 个子代理在跑', max), color: VIOLET }
    if (lastTurnMs) return { text: clip('✓ 上一轮 ' + dur(lastTurnMs) + '，' + lastTurnTools + ' 次工具', max), color: DIM }
    return { text: '✓ 待命', color: DIM }
  }

  // ---------- 精简版: 1 行 ----------
  if (layout === 'compact' || W < 96) {
    const bw = W >= 120 ? 8 : W >= 100 ? 6 : 4
    const st = statusText(18)
    const crab = isTerm
      ? [<els.Raster key="crab-mini" columns={MINI_W} rows={1} cells={encode(miniPx(scene), MINI_W, 1)} />]
      : [
          <Text key="crab-k" color={ACCENT}>
            {kaomoji(scene)}
          </Text>,
        ]
    const m = (key: string, lab: string, p: number | undefined, onPress: () => void, sh: number, pl: number): Seg => {
      const o = { key, label: lab, labelW: dw(lab), onPress, pct: p, bw, extra: '', extraW: 0, shimmerAt: sh, pulse: pl }
      return { key: 'seg-' + key, w: meterWidth(o), prio: 0, parts: meter(els, o) }
    }
    const segs: Seg[] = [
      { key: 'seg-crab', w: isTerm ? MINI_W : 9, prio: 0, parts: crab },
      { ...m('ctx', '上下文', pct, onContext, working ? frame % (bw + 6) : -9, 0), prio: 1 },
      { ...m('h5', '5小时', five?.percentUsed, onUsage, -9, pulse(five)), prio: 2 },
      { ...m('wk', '本周', week?.percentUsed, onUsage, -9, pulse(week)), prio: 3 },
      {
        key: 'seg-model',
        w: dw(model) + 1 + 5 + 1 + Math.max(2, dw(effort)),
        prio: 4,
        parts: [<Button key="btn-model" label={model} plain onPress={onModel} />, <Text key="m-sp"> </Text>, ...effortParts(els, 'c-eff')],
      },
      {
        key: 'seg-status',
        w: 18,
        prio: 5,
        parts: [
          <Text key="st" color={st.color} wrap="truncate">
            {st.text}
          </Text>,
        ],
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

  // ---------- 完整版: 螃蟹 + 3 行 x 3 列 ----------
  // 左右各留 HPAD 格; 三列取整后剩下的零头平分到两边, 让面板两端留空一样
  const avail = W - SPRITE_W - 2 - HPAD * 2
  const cw = Math.floor((avail - 2 * GAP) / 3)
  const A = cw * 3 + GAP * 2
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
  const later = (l?: { resetsAt?: string }) => (l?.resetsAt ? padR(resetIn(l), 5) + (extraW >= 11 ? '后重置' : '') : '')

  // 第 1 行
  // 项目名优先完整显示, 分支名只用剩下的位置 (不够 4 格就不显示)
  const proj = clip(project || '--', inner)
  const branchRoom = inner - dw(proj) - 1
  const branchText = branch && branchRoom >= 4 ? clip(branch + (dirty ? ' *' + dirty : ''), branchRoom) : ''
  const r1 = [
    [...label(els, 'l-model', '模型', LABEL_W), <Button key="btn-model" label={model} plain onPress={onModel} />, <Text key="m-sp"> </Text>, ...effortParts(els, 'eff')],
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
      shimmerAt: working ? (frame % (bw + 8)) - 2 : -9,
      pulse: 0,
    }),
    meter(els, { key: 'h5', label: '5小时', labelW: LABEL_W, onPress: onUsage, pct: five?.percentUsed, bw, extra: later(five), extraW, shimmerAt: -9, pulse: pulse(five) }),
    meter(els, { key: 'wk', label: '本周', labelW: LABEL_W, onPress: onUsage, pct: week?.percentUsed, bw, extra: later(week), extraW, shimmerAt: -9, pulse: pulse(week) }),
  ]

  // 第 3 行
  const st = statusText(inner)
  const top = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => shortTool(t) + ' ' + n)
    .join('  ')
  const r3 = [
    [
      ...label(els, 'l-st', '状态', LABEL_W),
      <Text key="st" color={st.color}>
        {clip(st.text, inner)}
      </Text>,
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

  const gridRow = (key: string, cells: any[][]) => (
    <Box key={key} flexDirection="row" columnGap={GAP} height={1}>
      {cells.map((parts, i) => cell(els, key + 'c' + i, cw, parts))}
    </Box>
  )

  const sprite = isTerm ? (
    <els.Raster key="crab" columns={SPRITE_W} rows={3} cells={encode(scenePx(scene), SPRITE_W, 3)} />
  ) : (
    <Text key="crab-k" color={ACCENT}>
      {kaomoji(scene)}
    </Text>
  )

  return (
    <Box key="hud" flexDirection="row" columnGap={2} paddingLeft={marginL} paddingRight={marginR}>
      <Box key="sprite" width={SPRITE_W} flexShrink={0} height={3}>
        {sprite}
      </Box>
      <Box key="info" flexDirection="column" width={A} flexShrink={0}>
        {gridRow('r1', r1)}
        {gridRow('r2', r2)}
        {gridRow('r3', r3)}
      </Box>
    </Box>
  )
}

// 测试用: 不经过界面, 直接画某个状态下的螃蟹和状态文字
export function previewScene(tool: string, opts: { working?: boolean; pct?: number; agents?: number; frames?: number } = {}) {
  const out: string[] = []
  for (let f = 0; f < (opts.frames ?? 24); f++) {
    frame = f
    const s: Scene = {
      working: opts.working ?? true,
      kind: toolKind(tool),
      pct: opts.pct ?? 30,
      celebrating: false,
      sleeping: false,
      agents: opts.agents ?? 0,
    }
    out.push(encode(scenePx(s), SPRITE_W, 3), encode(miniPx(s), MINI_W, 1))
  }
  frame = 0
  return { label: toolLabel(tool), kind: toolKind(tool), frames: out }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadPrefs($)
    loadedVersion = await diskVersion($)
    lastActive = await $.clock.now()
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
      if (layout === 'off') return
      frame += 1
      if (frame % 20 === 1) {
        try {
          hasTerminal = (await $.session.surfaces()).includes('terminal')
        } catch {
          hasTerminal = true
        }
      }
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
        description: '用量面板：完整 → 精简 → 隐藏 循环；/hud top 放输入框上方，/hud bottom 放下方',
        argumentHint: '[top|bottom]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('usage-hud: /hud 注册失败 ' + String(err))
    }
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase()
    if (/^(top|above|up|上)/.test(arg) || /^(bottom|below|down|下)/.test(arg)) {
      position = /^(top|above|up|上)/.test(arg) ? 'above' : 'below'
      await $.store.set('position', position)
      if (layout === 'off') layout = 'full'
      redraw($)
      return { text: '用量面板放在输入框' + (position === 'above' ? '上方' : '下方') }
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
      addTok(tokLive, result.usage)
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

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      turnTools += 1
      currentTool = e.tool
    }
    totalTools += 1
    toolCounts[e.tool] = (toolCounts[e.tool] ?? 0) + 1
    if (totalTools % 100 === 0) {
      celebrateUntil = (await $.clock.now()) + 1600
      $.ui.toast(`本会话第 ${totalTools} 次工具调用，螃蟹给你鼓掌`)
    }
    redraw($)
    try {
      return await next(e)
    } finally {
      if (!e.agentId) currentTool = ''
      redraw($)
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (!(e as any).agentId) {
      const now = await $.clock.now()
      lastTurnMs = turnStartedAt ? now - turnStartedAt : 0
      lastTurnTools = turnTools
      celebrateUntil = now + (lastTurnMs > 180_000 ? 2600 : 1400)
      // 庆祝结束时再画一次, 让只有客户端的会话也能回到平常的样子
      $.clock.after(celebrateUntil - now + 100, () => redraw($))
      engineWorking = false
      currentTool = ''
      lastActive = now
      await refreshRepo($)
      await checkMilestones($)
      redraw($)
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    redraw($)
    return next(e)
  })

  // 输入框上方的横栏:
  //   客户端 -> 客户端专用的 SVG 面板 (客户端只用这一处)
  //   终端   -> /hud top 时在这里画, 上面空一行和回复隔开
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (layout === 'off' || e.props.hasSurvey) return next(e)
    if (e.surface === 'desktop') {
      const els: any = $.ui.resolve(e)
      return buildDesktop($, els, e.props.bodyColumns ?? 100, !!e.props.isWorking)
    }
    if (e.surface !== 'terminal' || position !== 'above') return next(e)
    const els: any = $.ui.resolve(e)
    const { Box, Text } = els
    const view = await buildView($, els, e.surface, e.props.bodyColumns ?? 100, !!e.props.isWorking)
    return (
      <Box flexDirection="column">
        <Text key="gap"> </Text>
        {view}
      </Box>
    )
  })

  // 放在输入框下方: 面板在上, 引擎自己的提示行 (auto mode / esc to interrupt) 保留在下
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || layout === 'off' || position !== 'below') return next(e)
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
