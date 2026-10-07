// usage-hud 终端版 "完整布局" (螃蟹 + 3 行 x 3 列) 的移植: 按 register.tsx (0.12.0) 的 buildView 逐段排, 写进格子
// 常量、文字、颜色、宽度算法、裁剪规则都照源码; 只把 Ink 的 Box/Text/Button 换成往格子里写字
// 配速 / 情绪 / 收据的纯函数 (paceOf / moodOf / limitExtra / receiptText) 照搬源码, check-crab.mjs 会和源码比对
import { dw, clip, padL, padR, hex } from './cells.js'
import { scenePx, setFrame, toolKind, heat, mix, SPRITE_W } from './crab.js'

export const LABEL_W = 6
export const GAP = 3
export const HPAD = 2
export const COMPACT_AT = 75 // 上下文到这个百分比出现 [压缩] 按钮
export const STUCK_MS = 5 * 60_000
export const WARN = '#f87171' // "约40m后用完" 的颜色

const TRACK = 0x3f3f46
export const DIM = '#71717a'
export const ACCENT = '#d97757'
export const VIOLET = '#a78bfa'
export const VALUE = '#d4d4d8'
// 终端默认前景 (Button plain 的标签) 和 dimColor (Button plain dimColor 的标签, SGR 2 暗色) — 近似值
export const FG = '#ffffff'
export const DIM_BTN = '#868686'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_COLOR = { low: '#a1a1aa', medium: '#60a5fa', high: '#fbbf24', xhigh: '#fb923c', max: '#f87171' }
const EFFORT_SHORT = { low: 'low', medium: 'med', high: 'hi', xhigh: 'xhi', max: 'max' }

const TOOL_CN = {
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
export function toolLabel(t) {
  if (!t) return '思考中'
  return TOOL_CN[t] ?? t
}
export function prettyModel(id) {
  const m = id.match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-_.](\d{1,2}))?/i)
  if (!m) return id || '--'
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
  return name + ' ' + m[2] + (m[3] ? '.' + m[3] : '') + (/\[1m\]/i.test(id) ? ' 1M' : '')
}
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + String(m % 60).padStart(2, '0') + 'm'
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}
export function durShort(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 10) return h + 'h' + String(m % 60).padStart(2, '0') + 'm'
  if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h'
}
export function big(n) {
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k'
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M'
  return (n / 1e9).toFixed(2) + 'B'
}
export function tok(n) {
  if (n === undefined) return '--'
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}
function eq(f) {
  const H = '▁▂▃▄▅▆▇'
  const wave = [0, 2, 4, 6, 4, 2]
  return [0, 2, 4].map(o => H[wave[(f + o) % wave.length]]).join('')
}

// ---------------- 配速 (纯函数, 照搬源码) ----------------
const WINDOW_MS = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
const MIN_ELAPSED_FRAC = 0.02
const PANIC_RUNOUT_MS = 30 * 60_000
const PACE_WARN = 1.15
export function paceOf(l, now) {
  if (!l || typeof l.percentUsed !== 'number') return undefined
  const pct = l.percentUsed
  const win = WINDOW_MS[l.kind]
  const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!win || !isFinite(at)) return { pct, willRunOut: false }
  const resetIn = Math.max(0, at - now)
  const elapsed = Math.min(win, win - resetIn)
  if (pct < 1 || elapsed < win * MIN_ELAPSED_FRAC || resetIn <= 0) return { pct, resetIn, willRunOut: false }
  const ratio = pct / ((elapsed / win) * 100)
  const runOutIn = pct >= 100 ? 0 : (100 - pct) / (pct / elapsed)
  return { pct, ratio, runOutIn, resetIn, willRunOut: runOutIn < resetIn && ratio >= PACE_WARN }
}
const MOOD_RANK = { chill: 0, normal: 1, sweat: 2, panic: 3 }
function moodOne(p) {
  if (!p) return undefined
  if (p.pct >= 95 || (p.willRunOut && (p.runOutIn ?? Infinity) <= PANIC_RUNOUT_MS)) return 'panic'
  if (p.ratio === undefined) return 'normal'
  if (p.ratio >= 1.2 || p.willRunOut) return 'sweat'
  if (p.ratio < 0.8) return 'chill'
  return 'normal'
}
export function moodOf(...paces) {
  const ms = paces.map(moodOne).filter(m => !!m)
  if (!ms.length) return 'normal'
  return ms.reduce((a, b) => (MOOD_RANK[b] > MOOD_RANK[a] ? b : a))
}
export function limitExtra(p, extraW) {
  if (!p || p.resetIn === undefined) return { text: '', warn: false }
  if (p.willRunOut && p.runOutIn !== undefined) {
    const d = durShort(p.runOutIn)
    const head = dw('约' + d) <= 5 ? '约' + d : d
    return { text: extraW >= 11 ? padR(head, 5) + '后用完' : head, warn: true }
  }
  return { text: padR(durShort(p.resetIn), 5) + (extraW >= 11 ? '后重置' : ''), warn: false }
}
// " · $0.42 · 改 3 个文件 +120 -30 · 工具 12 次"
export function receiptText(r) {
  const parts = []
  if (r.usd !== undefined && r.usd >= 0.005) parts.push('$' + r.usd.toFixed(2))
  if (r.files > 0) parts.push('改 ' + r.files + ' 个文件' + (r.add || r.del ? ' +' + r.add + ' -' + r.del : ''))
  if (r.tools > 0) parts.push('工具 ' + r.tools + ' 次')
  return parts.length ? ' · ' + parts.join(' · ') : ''
}

// 数字滚动过渡: 源码每次重画走一步 cur + (target - cur) * 0.35 (目标未知时不动, 显示 --);
// 这里按 150ms 一帧从头模拟, 结果确定。start = 第 0 帧之前已显示的值 (新会话是 0)
export function easeAt(targetAt, frames, start) {
  let cur = start
  let target
  for (let f = 0; f <= frames; f++) {
    target = targetAt(f)
    if (target === undefined) continue
    cur = Math.abs(target - cur) < 0.6 ? target : cur + (target - cur) * 0.35
  }
  return target === undefined ? undefined : cur
}

// 完整布局的几何 (同 buildView, 3 列)
export function layoutFor(W) {
  const avail = W - SPRITE_W - 2 - HPAD * 2
  const cw = Math.floor((avail - 2 * GAP) / 3)
  const A = cw * 3 + GAP * 2
  const marginL = HPAD + Math.floor((avail - A) / 2)
  const inner = cw - LABEL_W - 1
  let extraW = 11
  let bw = inner - 5 - 1 - extraW
  if (bw < 6) {
    extraW = 5
    bw = inner - 5 - 1 - extraW
  }
  bw = Math.max(3, Math.min(60, bw))
  return { avail, cw, A, marginL, inner, extraW, bw }
}

// s: 见各场景的 hudState(); grid 里从 (row, col0) 开始画, W = 面板可用宽度 (PromptHint 的 viewport.columns - 2)
// 返回布局和可点元素的位置 (给鼠标指针用): { L, buttons: { agents: [row, c0, c1], compact: [...] } }
export function drawHud(g, row, col0, W, s) {
  if (W < 96) throw new Error('演示只画完整布局, W 至少 96')
  const L = layoutFor(W)
  const f = s.frame
  const now = s.now
  const p5 = paceOf(s.five, now)
  const pw = paceOf(s.week, now)
  const mood = moodOf(p5, pw)
  setFrame(f)
  const scene = {
    working: s.working,
    kind: toolKind(s.currentTool),
    pct: s.ctx.pct ?? 0,
    celebrating: s.celebrating,
    sleeping: s.sleeping,
    agents: s.agents,
    mood,
  }
  const spriteCol = col0 + L.marginL
  g.raster(row, spriteCol, scenePx(scene), SPRITE_W, 3)
  const info = spriteCol + SPRITE_W + 2
  const cellCol = i => info + i * (L.cw + GAP)
  const buttons = {}

  // 一格: 各段文字连着写, 超出列宽的裁掉 (overflow hidden); 返回每段的起止列
  const cell = (r, i, runs) => {
    const spans = []
    let c = cellCol(i)
    const max = cellCol(i) + L.cw
    for (const run of runs.filter(Boolean)) {
      const [str, st, id] = run
      const c0 = c
      c = g.text(row + r, c, str, st, max)
      if (id) spans.push([id, row + r, c0, Math.min(c, max)])
    }
    for (const [id, rr, c0, c1] of spans) buttons[id] = [rr, c0, c1]
    return c
  }
  const label = (text, width, pressable) => {
    const pad = ' '.repeat(Math.max(0, width - dw(text)) + 1)
    return pressable ? [[text, { fg: DIM_BTN }], [pad, {}]] : [[text + pad, { fg: DIM }]]
  }
  const pulse = l => (l && l.percentUsed >= 90 ? 0.25 * (1 + Math.sin(f / 2)) : 0)
  const meter = (lab, pct, shown, extra, shimmerAt, pl, extraColor, extraRuns) => {
    const runs = [...label(lab, LABEL_W, true)]
    const p = shown === undefined ? 0 : Math.max(0, Math.min(100, shown)) / 100
    const full = p > 0 ? Math.max(1, Math.round(p * L.bw)) : 0
    for (let i = 0; i < L.bw; i++) {
      const lit = i < full
      let col = lit ? heat(i / Math.max(1, L.bw - 1)) : TRACK
      if (lit && pl > 0) col = mix(col, 0xffffff, pl)
      if (lit && Math.abs(i - shimmerAt) < 1) col = mix(col, 0xffffff, 0.6)
      runs.push(['━', { fg: hex(col) }])
    }
    const pctText = shown === undefined ? '--' : Math.round(shown) + '%'
    const pctColor = pct === undefined ? DIM : hex(heat(Math.min(100, pct) / 100))
    runs.push([' ' + padL(pctText, 4), { fg: pctColor, bold: true }])
    if (L.extraW > 0 && extraRuns) runs.push(...extraRuns)
    else if (L.extraW > 0) runs.push([' ' + padR(clip(extra, L.extraW), L.extraW), extraColor ? { fg: extraColor, bold: true } : { fg: DIM }])
    return runs
  }

  // 第 1 行: 模型 | 项目 | 本会话
  const model = prettyModel(s.modelId)
  const room = L.inner - dw(model) - 1
  const word = s.effort ? clip(s.effort, 6) : '--'
  const short = EFFORT_SHORT[s.effort] ?? word
  const ei = EFFORTS.indexOf(s.effort)
  const ecol = EFFORT_COLOR[s.effort] ?? DIM
  const pips = w => [...'▁▂▃▅▇'.split('').map((ch, k) => [ch, { fg: k <= ei ? ecol : hex(TRACK) }]), [' ', {}], [w, { fg: FG }, 'effort']]
  // 档位: 五格彩色, 档位文字是按钮 (默认前景色); 放不下先缩写, 再放不下只留缩写按钮
  const eff = room < 6 + dw(word) ? (room < 6 + dw(short) ? [[short, { fg: FG }, 'effort']] : pips(short)) : pips(word)
  cell(0, 0, [...label('模型', LABEL_W), [model, { fg: FG }, 'model'], [' ', {}], ...eff])
  const proj = clip(s.project || '--', L.inner)
  const branchRoom = L.inner - dw(proj) - 1
  const branchText = s.branch && branchRoom >= 4 ? clip(s.branch + (s.dirty ? ' *' + s.dirty : ''), branchRoom) : ''
  cell(0, 1, [...label('项目', LABEL_W), [proj, { fg: FG }, 'project'], [branchText ? ' ' + branchText : '', { fg: VIOLET }]])
  cell(0, 2, [...label('本会话', LABEL_W), [padR(dur(now - s.startedAt), 7), { fg: VALUE }], [s.costUsd !== undefined ? '$' + s.costUsd.toFixed(2) : '', { fg: DIM }]])

  // 第 2 行: 上下文 | 5小时 | 本周
  const ctxExtra = L.extraW >= 9 ? tok(s.ctx.tokens) + '/' + tok(s.ctx.window) : tok(s.ctx.tokens)
  // 上下文 >= 75%: 附加那段换成 [压缩] 按钮 (宽的时候前面留已用 token 数), 宽度不变 (compactParts)
  const showCompact = (s.ctx.pct ?? 0) >= COMPACT_AT
  let compactRuns
  if (showCompact) {
    const used = tok(s.ctx.tokens)
    compactRuns =
      L.extraW >= 10
        ? [[' ' + padR(clip(used, L.extraW - 5), L.extraW - 5) + ' ', { fg: DIM }], ['压缩', { fg: FG }, 'compact']]
        : [[' ', {}], ['压缩', { fg: FG }, 'compact'], [' '.repeat(Math.max(0, L.extraW - 4)), {}]]
  }
  cell(1, 0, meter('上下文', s.ctx.pct, s.shown.ctx, ctxExtra, s.working ? (f % (L.bw + 8)) - 2 : -9, 0, undefined, compactRuns))
  const x5 = limitExtra(p5, L.extraW)
  const xw = limitExtra(pw, L.extraW)
  cell(1, 1, meter('5小时', s.five?.percentUsed, s.shown.h5, x5.text, -9, pulse(s.five), x5.warn ? WARN : undefined))
  cell(1, 2, meter('本周', s.week?.percentUsed, s.shown.wk, xw.text, -9, pulse(s.week), xw.warn ? WARN : undefined))

  // 第 3 行: 状态 | 工具 | token
  const statusText = max => {
    if (s.working) {
      if (max < 15) return { text: eq(f) + ' ' + clip(toolLabel(s.currentTool), Math.max(2, max - 4)), color: ACCENT }
      const rm = max - 11
      return { text: eq(f) + ' ' + padR(clip(toolLabel(s.currentTool), rm), rm) + ' ' + padL(dur(now - s.turnStartedAt), 6), color: ACCENT }
    }
    if (s.agents) return { text: clip(eq(f) + ' 子代理在跑', max), color: VIOLET }
    if (s.lastTurnMs) return { text: clip('✓ 上一轮 ' + dur(s.lastTurnMs) + '，' + s.lastTurnTools + ' 次工具', max), color: DIM }
    return { text: '✓ 待命', color: DIM }
  }
  // 状态格: 文字补齐到固定宽度 + (有子代理时) 末尾一个可点的 "+N代理"
  const agLabel = s.agents ? '+' + s.agents + '代理' : ''
  const stRoom = agLabel ? Math.max(0, L.inner - dw(agLabel) - 1) : L.inner
  const st = statusText(stRoom)
  cell(2, 0, [
    ...label('状态', LABEL_W),
    [agLabel ? padR(clip(st.text, stRoom), stRoom) + ' ' : clip(st.text, stRoom), { fg: st.color }],
    agLabel ? [agLabel, { fg: FG }, 'agents'] : null,
  ])
  const top = Object.entries(s.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => t + ' ' + n)
    .join('  ')
  cell(2, 1, [...label('工具', LABEL_W), [clip(top || '还没有', L.inner), { fg: VALUE }]])
  const tk = s.tok
  const tokenText = tk.state === 'counting' ? '统计中..' : big(tk.total) + (tk.state === 'failed' ? ' 本次启动' : '  out ' + big(tk.output))
  cell(2, 2, [...label('token', LABEL_W, true), [clip(tokenText, L.inner), { fg: VALUE }]])
  return { L, mood, p5, pw, buttons }
}

// ---------------- 子代理看板 (buildAgentsPane 的移植, 宽面板 >= 72 列: 一行一个) ----------------
const KID_STATUS = { running: ['运行中', VIOLET], completed: ['已完成', '#4ade80'], failed: ['失败', WARN], killed: ['已停止', DIM] }
const KEEP_ENDED = 10
// kids: [{ desc, type, startedAt, lastAt, lastTool, tools, status, endedAt? }]
export function drawAgentsPane(g, row, col0, width, kids, now) {
  const running = kids.filter(k => k.endedAt === undefined).sort((a, b) => a.startedAt - b.startedAt)
  const ended = kids
    .filter(k => k.endedAt !== undefined)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, KEEP_ENDED)
  const FIX = { st: 8, ran: 7, idle: 9, tool: 14, n: 5 }
  const descW = Math.max(8, width - (FIX.st + FIX.ran + FIX.idle + FIX.tool + FIX.n) - 5)
  let r = row
  const line = cols => {
    let c = col0
    cols.forEach(([text, w, color], i) => {
      c = g.text(r, c, padR(clip(text, w), w) + (i < cols.length - 1 ? ' ' : ''), { fg: color ?? VALUE })
    })
    r++
  }
  const kidRow = k => {
    const isRun = k.endedAt === undefined
    const quiet = now - k.lastAt
    const stuck = isRun && quiet > STUCK_MS
    const [stText, stColor] = stuck ? ['可能卡住', WARN] : (KID_STATUS[k.status] ?? [k.status || '已结束', DIM])
    const name = k.desc || k.type || k.id
    const ran = dur((k.endedAt ?? now) - k.startedAt)
    const idle = isRun ? dur(quiet) + ' 前' : '--'
    const tool = k.lastTool || '--'
    const color = isRun ? (stuck ? WARN : VALUE) : DIM
    line([
      [stText, FIX.st, stColor],
      [name, descW, color],
      [ran, FIX.ran, color],
      [idle, FIX.idle, stuck ? WARN : color],
      [tool, FIX.tool, color],
      [String(k.tools), FIX.n, color],
    ])
  }
  const head = () =>
    line([
      ['状态', FIX.st, DIM],
      ['描述', descW, DIM],
      ['时长', FIX.ran, DIM],
      ['最后动静', FIX.idle, DIM],
      ['最后工具', FIX.tool, DIM],
      ['工具', FIX.n, DIM],
    ])
  // 标题行: 子代理 (橙色加粗) + 运行中 N · 已结束 M + 右边 "关闭"
  let c = g.text(r, col0, '子代理', { fg: ACCENT, bold: true })
  c = g.text(r, c, padR('  运行中 ' + running.length + ' · 已结束 ' + ended.length, Math.max(0, width - 6 - 6)), { fg: DIM })
  g.text(r, c, '关闭', { fg: DIM_BTN })
  r++
  if (running.length) {
    head()
    running.forEach(kidRow)
  }
  if (ended.length) {
    g.text(r++, col0, '已结束 (最近 ' + KEEP_ENDED + ' 个)', { fg: DIM })
    if (!running.length) head()
    ended.forEach(kidRow)
  }
  g.text(r++, col0, '运行中超过 5 分钟没有工具动作的会标红，Esc 关闭', { fg: DIM })
  return r
}
