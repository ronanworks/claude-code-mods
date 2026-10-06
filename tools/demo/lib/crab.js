// 像素螃蟹: 逐行照搬 usage-hud/hooks/register.tsx 的 "像素画" 一节 (canvas/put/rect/encode/drawCrab/scenePx/miniPx)
// 只去掉了类型标注; 模块变量 frame 改成 setFrame() 设置。check-crab.mjs 会拿源码逐帧比对, 保证一模一样
export const SPRITE_W = 15 // 12 列螃蟹 + 3 列道具
export const MINI_W = 8
export const FRAME_MS = 150

export const COL = {
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
export const DEF = 0x01000000

export function mix(a, b, t) {
  const ch = s => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
export function heat(t) {
  const g = 0x4ade80
  const y = 0xfbbf24
  const r = 0xf87171
  return t < 0.6 ? mix(g, y, t / 0.6) : mix(y, r, Math.min(1, (t - 0.6) / 0.4))
}

let frame = 0
export function setFrame(f) {
  frame = f
}

// ---------------- 工具分类 (同源码) ----------------
export function toolKind(t) {
  if (!t) return 'think'
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(t)) return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return 'edit'
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/.test(t)) return 'bash'
  if (/^(WebSearch|WebFetch)$/.test(t)) return 'web'
  if (/^(Agent|Task|SendMessage)$/.test(t)) return 'agent'
  return 'other'
}

// ---------------- 像素画 ----------------
export function canvas(w, h) {
  const p = []
  for (let y = 0; y < h; y++) p.push(new Array(w).fill(-1))
  return p
}
function put(p, x, y, c) {
  if (y >= 0 && y < p.length && x >= 0 && x < p[y].length) p[y][x] = c
}
function rect(p, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(p, x, y, c)
}
export function encode(px, cols, cellRows) {
  const words = []
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

// 12x5 像素的螃蟹 (第 6 行留给上下颠)
function drawCrab(p, o) {
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

function bodyColor(pct) {
  if (pct >= 95) return frame % 4 < 2 ? COL.hot : COL.body
  return pct >= 80 ? COL.hot : COL.body
}

// s = { working, kind, pct, celebrating, sleeping, agents }
export function scenePx(s) {
  const p = canvas(SPRITE_W, 6)
  const f = frame
  const t = Math.floor(f / 2)
  const o = { bob: 0, legs: 0, eyes: 'open', look: 0, armL: 'out', armR: 'out', body: bodyColor(s.pct) }
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

export function miniPx(s) {
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
