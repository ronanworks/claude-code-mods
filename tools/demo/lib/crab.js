// 像素螃蟹: 逐行照搬 usage-hud/hooks/register.tsx (0.12.0) 的 "像素画" 一节
// (canvas/put/rect/encode/drawCrab/bodyColor/KID_TALL/KID_FLAT/stamp/drawKids/scenePx/miniPx) 和颜色表 COL
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
  shades: 0x09090b, // 墨镜镜片
  bridge: 0x52525b, // 墨镜鼻梁
  alarm: 0xef4444, // 慌张的 "!"
  kid: 0xf2a07b, // 小螃蟹用浅一号的颜色
  kidEye: 0xf5f5f4, // 小螃蟹的眼睛用浅色
  kidLeg: 0xa4553d,
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

// 子代理小螃蟹 (3 列宽, 画在右侧 x 12-14): C = 钳子和身体, E = 眼睛, L = 腿, . = 空; 两帧交替 = 腿在走
// 1-2 只用 3x3 (钳子 / 身体 + 眼睛 / 腿), 3 只时放不下, 改 3x2 (身体 + 眼睛 / 腿)
const KID_TALL = [
  ['C.C', 'CEC', 'L.L'],
  ['C.C', 'CEC', '.L.'],
]
const KID_FLAT = [
  ['CEC', 'L.L'],
  ['CEC', '.L.'],
]
function stamp(p, x0, y0, rows) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]
      const c = ch === 'C' ? COL.kid : ch === 'E' ? COL.kidEye : ch === 'L' ? COL.kidLeg : -1
      if (c >= 0) put(p, x0 + dx, y0 + dy, c)
    }
  })
}
function drawKids(p, n, f) {
  const step = Math.floor(f / 2)
  if (n === 1) {
    // 一只: 一边走一边上下跳 (占 4 行里的 3 行)
    stamp(p, 12, [2, 1, 2, 3][step % 4], KID_TALL[step % 2])
  } else if (n === 2) {
    stamp(p, 12, 0, KID_TALL[step % 2])
    stamp(p, 12, 3, KID_TALL[(step + 1) % 2])
  } else if (n >= 3) {
    for (let i = 0; i < 3; i++) stamp(p, 12, i * 2, KID_FLAT[(step + i) % 2])
  }
}

// s = { working, kind, pct, celebrating, sleeping, agents, mood }
export function scenePx(s) {
  const p = canvas(SPRITE_W, 6)
  const f = frame
  const t = Math.floor(f / 2)
  const md = s.mood ?? 'normal'
  const nKids = Math.min(3, Math.max(0, s.agents))
  const zoneFree = nKids === 0 // 右侧 3 列有子代理时让给小螃蟹
  const o = { bob: 0, legs: 0, eyes: 'open', look: 0, armL: 'out', armR: 'out', body: bodyColor(s.pct) }
  let shades = false
  let bigBang = false // 右侧的大 "!"

  if (s.celebrating) {
    o.armL = 'up'
    o.armR = 'up'
    o.bob = t % 2
    const spots = [[12, 0], [14, 1], [13, 3], [12, 5], [14, 4], [13, 1], [1, 0], [10, 0]]
    spots.forEach(([x, y], i) => {
      if ((i + f) % 3 === 0 && (zoneFree || x < 12)) put(p, x, y, COL.spark)
    })
  } else if (s.working) {
    o.legs = t % 4
    o.bob = t % 2
    switch (s.kind) {
      case 'think': {
        o.look = 1
        const dots = [[12, 4], [13, 2], [14, 0]]
        const n = Math.floor(f / 3) % 4
        if (zoneFree) for (let i = 0; i < n; i++) put(p, dots[i][0], dots[i][1], COL.thought)
        break
      }
      case 'read': {
        o.look = 1
        if (zoneFree) {
          rect(p, 12, 1, 3, 4, COL.paper)
          rect(p, 12, 1 + (t % 4), 3, 1, COL.scan)
        }
        break
      }
      case 'edit': {
        o.look = 1
        o.armR = f % 2 ? 'up' : 'out'
        if (zoneFree) {
          rect(p, 12, 1, 3, 4, COL.paper)
          const k = t % 13
          for (let i = 0; i < k; i++) put(p, 12 + (i % 3), 1 + Math.floor(i / 3), COL.ink)
        }
        break
      }
      case 'bash': {
        o.armL = f % 2 ? 'up' : 'out'
        o.armR = f % 2 ? 'out' : 'up'
        if (zoneFree) {
          rect(p, 12, 1, 3, 4, COL.term)
          put(p, 12, 2, COL.cursor)
          if (f % 4 < 2) put(p, 13, 4, COL.cursor)
        }
        break
      }
      case 'web': {
        o.look = 1
        if (zoneFree) {
          const ring = [[13, 1], [14, 2], [13, 3], [12, 2]]
          for (const [x, y] of ring) put(p, x, y, COL.sea)
          put(p, 13, 2, COL.sea)
          const [lx, ly] = ring[t % 4]
          put(p, lx, ly, COL.land)
        }
        break
      }
      case 'agent':
        break
      default: {
        if (zoneFree) {
          const orbit = [[12, 1], [13, 1], [14, 1], [14, 2], [14, 3], [13, 3], [12, 3], [12, 2]]
          put(p, 13, 2, COL.gear)
          const [gx, gy] = orbit[f % 8]
          put(p, gx, gy, COL.gear)
        }
      }
    }
  } else if (md === 'panic') {
    // 闲置时慌张: 双钳举起, 左右发抖, 腿乱蹬; 右侧空着就竖一个大 "!"
    o.armL = 'up'
    o.armR = 'up'
    o.look = f % 2 ? 1 : -1
    o.legs = f % 4
    bigBang = zoneFree
  } else if (s.sleeping) {
    o.eyes = 'closed'
    o.bob = Math.floor(f / 8) % 2 // 慢慢呼吸
    if (zoneFree) {
      const z = Math.floor(f / 3)
      put(p, 13, 5 - (z % 6), COL.bubble)
      put(p, 14, 5 - ((z + 3) % 6), COL.bubble)
    }
  } else {
    const cyc = f % 160
    if (md === 'chill') shades = true // 戴墨镜: 不眨眼, 不张望
    else {
      if (f % 30 === 0) o.eyes = 'closed' // 眨眼
      if (cyc >= 60 && cyc < 68) o.look = -1 // 左右张望
      else if (cyc >= 68 && cyc < 76) o.look = 1
    }
    if (cyc >= 120 && cyc < 136) o.armR = Math.floor(f / 3) % 2 ? 'up' : 'out' // 挥手
  }

  drawCrab(p, o)

  if (shades) {
    const y = o.bob + 1
    rect(p, 3, y, 2, 1, COL.shades)
    rect(p, 5, y, 2, 1, COL.bridge)
    rect(p, 7, y, 2, 1, COL.shades)
  }
  if (bigBang) {
    const c = f % 4 < 2 ? COL.alarm : COL.spark
    put(p, 13, 0, c)
    put(p, 13, 1, c)
    put(p, 13, 3, c)
  }
  // 头边 (x=1, 第 0-1 行, 任何姿势下都空着): 上下文告急 / 冒汗 -> 汗滴; 慌张 -> 汗滴和红色 "!" 交替
  if (!s.celebrating) {
    const sweat = s.pct >= 80 || md === 'sweat' || md === 'panic'
    if (md === 'panic' && !bigBang && t % 4 >= 2) {
      put(p, 1, 0, COL.alarm)
      put(p, 1, 1, COL.alarm)
    } else if (sweat) {
      const d = t % 4
      if (d < 2) put(p, 1, d, COL.sweat)
    }
  }
  // 子代理小螃蟹最后画: 盖在任何道具 / 闪光 / 泡泡上面
  if (nKids) drawKids(p, nKids, f)
  return p
}

// 精简版的一行小螃蟹 (8 列 x 2 像素); 有子代理时身体缩成 6 列, 第 8 列放跳动的小点 (宽度不变)
export function miniPx(s) {
  const p = canvas(MINI_W, 2)
  const f = frame
  const t = Math.floor(f / 2)
  const md = s.mood ?? 'normal'
  const body = bodyColor(s.pct)
  const nKids = Math.min(3, Math.max(0, s.agents))
  const bw = nKids ? 6 : MINI_W
  rect(p, 0, 0, bw, 1, body)
  const idle = !s.working && !s.celebrating
  const closed = s.sleeping || (idle && md !== 'chill' && f % 30 === 0)
  const look = s.working ? 1 : 0
  const ex = nKids ? [1, 4] : [2, 5]
  let eye = closed ? mix(body, COL.eye, 0.45) : COL.eye
  if (md === 'panic' && !s.celebrating && f % 4 < 2) eye = COL.spark // 慌张: 眼睛黄红闪
  if (idle && !s.sleeping && md === 'chill') rect(p, ex[0], 0, ex[1] - ex[0] + 1, 1, COL.shades) // 墨镜
  else {
    put(p, ex[0] + look, 0, eye)
    put(p, ex[1] + look, 0, eye)
  }
  const scramble = md === 'panic' && !s.celebrating
  const wide = s.celebrating ? [0, 7] : (s.working || scramble) && t % 2 ? [0, 2, 5, 7] : [1, 3, 4, 6]
  const legs = nKids ? wide.map(x => Math.min(5, Math.round((x * 5) / 7))) : wide
  for (const x of legs) put(p, x, 1, body)
  // 冒汗: 左下角一颗蓝色汗滴闪
  if (!s.celebrating && (s.pct >= 80 || md === 'sweat' || md === 'panic') && t % 4 < 2) put(p, 0, 1, COL.sweat)
  // 子代理: 第 8 列; 1 只 = 一个点上下跳, 2 只以上 = 两格都亮, 3 只再加闪
  if (nKids === 1) put(p, 7, t % 2, COL.kid)
  else if (nKids >= 2) {
    const hi = nKids >= 3 && f % 4 < 2 ? COL.kidEye : COL.kid
    put(p, 7, 0, t % 2 ? COL.kid : hi)
    put(p, 7, 1, t % 2 ? hi : COL.kidLeg)
  }
  return p
}
