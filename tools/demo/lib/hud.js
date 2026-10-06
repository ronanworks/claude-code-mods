// usage-hud 终端版 "完整布局" (螃蟹 + 3 行 x 3 列) 的移植: 按 register.tsx 的 buildView 逐段排, 写进格子
// 常量、文字、颜色、宽度算法、裁剪规则都照源码; 只把 Ink 的 Box/Text/Button 换成往格子里写字
import { dw, clip, padL, padR, hex } from './cells.js'
import { scenePx, setFrame, toolKind, heat, mix, SPRITE_W } from './crab.js'

export const LABEL_W = 6
export const GAP = 3
export const HPAD = 2

const TRACK = 0x3f3f46
const DIM = '#71717a'
const ACCENT = '#d97757'
const VIOLET = '#a78bfa'
const VALUE = '#d4d4d8'
// 终端默认前景 (Button plain 的标签) 和 dimColor (Button plain dimColor 的标签, SGR 2 暗色) — 近似值
export const FG = '#ffffff'
export const DIM_BTN = '#868686'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_COLOR = { low: '#a1a1aa', medium: '#60a5fa', high: '#fbbf24', xhigh: '#fb923c', max: '#f87171' }

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

// 完整布局的几何 (同 buildView)
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

// s: 见 scenes 里的 hudState(); grid 里从 (row, col0) 开始画, W = 面板可用宽度 (PromptHint 的 viewport.columns - 2)
export function drawHud(g, row, col0, W, s) {
  if (W < 96) throw new Error('演示只画完整布局, W 至少 96')
  const L = layoutFor(W)
  const f = s.frame
  setFrame(f)
  const scene = {
    working: s.working,
    kind: toolKind(s.currentTool),
    pct: s.ctx.pct ?? 0,
    celebrating: s.celebrating,
    sleeping: s.sleeping,
    agents: s.agents,
  }
  const spriteCol = col0 + L.marginL
  g.raster(row, spriteCol, scenePx(scene), SPRITE_W, 3)
  const info = spriteCol + SPRITE_W + 2
  const cellCol = i => info + i * (L.cw + GAP)

  // 一格: 各段文字连着写, 超出列宽的裁掉 (overflow hidden)
  const cell = (r, i, runs) => g.runs(row + r, cellCol(i), runs.filter(Boolean), cellCol(i) + L.cw)
  const label = (text, width, pressable) => {
    const pad = ' '.repeat(Math.max(0, width - dw(text)) + 1)
    return pressable ? [[text, { fg: DIM_BTN }], [pad, {}]] : [[text + pad, { fg: DIM }]]
  }
  const pulse = l => (l && l.percentUsed >= 90 ? 0.25 * (1 + Math.sin(f / 2)) : 0)
  const meter = (lab, pct, shown, extra, shimmerAt, pl) => {
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
    if (L.extraW > 0) runs.push([' ' + padR(clip(extra, L.extraW), L.extraW), { fg: DIM }])
    return runs
  }
  const resetIn = l => (l?.resetsInMs !== undefined ? durShort(l.resetsInMs) : '')
  const later = l => (l?.resetsInMs !== undefined ? padR(resetIn(l), 5) + (L.extraW >= 11 ? '后重置' : '') : '')

  // 第 1 行: 模型 | 项目 | 本会话
  const ei = EFFORTS.indexOf(s.effort)
  const ecol = EFFORT_COLOR[s.effort] ?? DIM
  const pips = '▁▂▃▅▇'.split('').map((ch, k) => [ch, { fg: k <= ei ? ecol : hex(TRACK) }])
  cell(0, 0, [...label('模型', LABEL_W), [prettyModel(s.modelId), { fg: FG }], [' ', {}], ...pips, [' ' + (s.effort ? clip(s.effort, 6) : '--'), { fg: ecol }]])
  const proj = clip(s.project || '--', L.inner)
  const branchRoom = L.inner - dw(proj) - 1
  const branchText = s.branch && branchRoom >= 4 ? clip(s.branch + (s.dirty ? ' *' + s.dirty : ''), branchRoom) : ''
  cell(0, 1, [...label('项目', LABEL_W), [proj, { fg: FG }], [branchText ? ' ' + branchText : '', { fg: VIOLET }]])
  cell(0, 2, [...label('本会话', LABEL_W), [padR(dur(s.now - s.startedAt), 7), { fg: VALUE }], [s.costUsd !== undefined ? '$' + s.costUsd.toFixed(2) : '', { fg: DIM }]])

  // 第 2 行: 上下文 | 5小时 | 本周
  const ctxExtra = L.extraW >= 9 ? tok(s.ctx.tokens) + '/' + tok(s.ctx.window) : tok(s.ctx.tokens)
  cell(1, 0, meter('上下文', s.ctx.pct, s.shown.ctx, ctxExtra, s.working ? (f % (L.bw + 8)) - 2 : -9, 0))
  cell(1, 1, meter('5小时', s.five?.percentUsed, s.shown.h5, later(s.five), -9, pulse(s.five)))
  cell(1, 2, meter('本周', s.week?.percentUsed, s.shown.wk, later(s.week), -9, pulse(s.week)))

  // 第 3 行: 状态 | 工具 | token
  const ag = s.agents ? ' +' + s.agents + '代理' : ''
  let st
  if (s.working) {
    const room = Math.max(4, L.inner - 11 - dw(ag))
    st = { text: eq(f) + ' ' + padR(clip(toolLabel(s.currentTool), room), room) + ' ' + padL(dur(s.now - s.turnStartedAt), 6) + ag, color: ACCENT }
  } else if (s.agents) st = { text: clip(eq(f) + ' ' + s.agents + ' 个子代理在跑', L.inner), color: VIOLET }
  else if (s.lastTurnMs) st = { text: clip('✓ 上一轮 ' + dur(s.lastTurnMs) + '，' + s.lastTurnTools + ' 次工具', L.inner), color: DIM }
  else st = { text: '✓ 待命', color: DIM }
  cell(2, 0, [...label('状态', LABEL_W), [clip(st.text, L.inner), { fg: st.color }]])
  const top = Object.entries(s.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => t + ' ' + n)
    .join('  ')
  cell(2, 1, [...label('工具', LABEL_W), [clip(top || '还没有', L.inner), { fg: VALUE }]])
  const tk = s.tok
  const tokenText = tk.state === 'counting' ? '统计中..' : big(tk.total) + (tk.state === 'failed' ? ' 本次启动' : '  out ' + big(tk.output))
  cell(2, 2, [...label('token', LABEL_W, true), [clip(tokenText, L.inner), { fg: VALUE }]])
  return L
}
