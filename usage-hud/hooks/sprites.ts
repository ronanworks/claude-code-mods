// usage-hud: 螃蟹的像素画 (纯函数, 不碰 $), 给 hooks 模块 (register.tsx) 和散步道的 Client 模块 (walkway.tsx) 共用
//   - 面板那只大螃蟹 (scenePx / miniPx): 按工具做动作、道具区、情绪
//   - 散步道 (v0.14 起; v0.16 搬进 Client): 排队、走路、粒子、天空行; 像素 -> 格子 (laneCells), 最后一步由 walkway.tsx 画成 Text

export const FRAME_MS = 150
export const SPRITE_W = 15 // 12 列螃蟹 + 3 列道具
export const MINI_W = 8
export const JUMP_FRAMES = 4 // 发出消息那一跳: 蹲 / 腾空 / 腾空 / 落地
export const DEF = 0x01000000 // 终端的默认颜色
export const DIM = '#71717a'
export const VALUE = '#d4d4d8'
export const WARN = '#f87171' // 会用完时 百分比 和 "40m用完" 的颜色

export type Mood = 'chill' | 'normal' | 'sweat' | 'panic'
export type ToolKind = 'think' | 'read' | 'edit' | 'bash' | 'web' | 'agent' | 'other'

// ---------------- 颜色 ----------------
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
  kid: 0xf2a07b, // 小螃蟹用浅一号的颜色, 和大螃蟹分得开
  kidEye: 0xf5f5f4, // 0.12 的小螃蟹眼睛 (会闪的浅色像素); 0.13 起不画, 留着给测试确认画面里没有它
  kidLeg: 0xa4553d,
}
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

// ---------------- 文字宽度 (中文/全角算 2 列) ----------------
export function isWide(cp: number): boolean {
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
export function dw(s: string): number {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return w
}
export function clip(s: string, max: number): string {
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

// ---------------- 像素画 ----------------
export type Px = number[][]
export function canvas(w: number, h: number): Px {
  const p: Px = []
  for (let y = 0; y < h; y++) p.push(new Array(w).fill(-1))
  return p
}
export function put(p: Px, x: number, y: number, c: number) {
  if (y >= 0 && y < p.length && x >= 0 && x < p[y].length) p[y][x] = c
}
export function rect(p: Px, x0: number, y0: number, w: number, h: number, c: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(p, x, y, c)
}
export function encode(px: Px, cols: number, cellRows: number): string {
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

// eyeDy: 眼睛在身体第几行 (默认 1, 散步道里低头看输入框时 2); legs < 0 = 腾空不画腿
export type Pose = { bob: number; legs: number; eyes: 'open' | 'closed'; look: number; armL: 'out' | 'up'; armR: 'out' | 'up'; body: number; eyeDy?: number }

// 12x5 像素的螃蟹 (第 6 行留给上下颠); ox = 往右挪几格 (面板里是 0, 散步道里是螃蟹的位置)
export function drawCrab(p: Px, o: Pose, ox = 0) {
  const y = o.bob
  rect(p, ox + 2, y, 8, 4, o.body)
  if (o.armL === 'out') rect(p, ox, y + 2, 2, 1, o.body)
  else rect(p, ox, y, 1, 2, o.body)
  if (o.armR === 'out') rect(p, ox + 10, y + 2, 2, 1, o.body)
  else rect(p, ox + 11, y, 1, 2, o.body)
  // 走路: 四条腿两两交替抬起
  if (o.legs >= 0) {
    const legs = [[2, 4, 7, 9], [2, 7], [2, 4, 7, 9], [4, 9]][o.legs % 4]
    for (const x of legs) put(p, ox + x, y + 4, o.body)
  }
  const eye = o.eyes === 'open' ? COL.eye : mix(o.body, COL.eye, 0.45)
  const ey = y + (o.eyeDy ?? 1)
  put(p, ox + 4 + o.look, ey, eye)
  put(p, ox + 7 + o.look, ey, eye)
}

// look / low / hop: 散步道用 (面板不给, 画法和以前一样):
//   look = 眼睛看哪边 (走路方向 / 东张西望); low = 打字时低头看输入框; hop = 发出消息那一跳的第几帧
export type Scene = { working: boolean; kind: ToolKind; pct: number; celebrating: boolean; sleeping: boolean; agents: number; mood?: Mood; look?: number; low?: boolean; hop?: number }

export function bodyColor(pct: number, f: number): number {
  if (pct >= 95) return f % 4 < 2 ? COL.hot : COL.body
  return pct >= 80 ? COL.hot : COL.body
}

// 按字符画盖像素: rows 里每个字符查 colors 得到颜色, 查不到 (比如 '.') 就空着
export function paint(p: Px, x0: number, y0: number, rows: string[], colors: Record<string, number>) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = colors[row[dx]]
      if (c !== undefined) put(p, x0 + dx, y0 + dy, c)
    }
  })
}

export function scenePx(s: Scene, f: number): Px {
  const p = canvas(SPRITE_W, 6)
  const t = Math.floor(f / 2)
  const md = s.mood ?? 'normal'
  // 0.14 起子代理小螃蟹搬到输入框上方的散步道, 面板右侧 3 列永远给道具
  const zoneFree = true
  const o: Pose = { bob: 0, legs: 0, eyes: 'open', look: 0, armL: 'out', armR: 'out', body: bodyColor(s.pct, f) }
  let shades = false
  let bigBang = false // 右侧的大 "!"

  if (s.hop !== undefined && s.hop >= 0 && s.hop < JUMP_FRAMES) {
    // 散步道: 发出消息那一跳 (画布只有 6 像素高, 没法整只往上移): 蹲 -> 腾空 (不画腿) -> 落地
    o.bob = s.hop === 0 || s.hop >= JUMP_FRAMES - 1 ? 1 : 0
    if (s.hop === 1 || s.hop === 2) {
      o.legs = -1
      o.armL = 'up'
      o.armR = 'up'
    }
  } else if (s.low) {
    // 散步道: 打字时低头看输入框 (身体放低, 眼睛往下)
    o.bob = 1
    o.eyeDy = 2
  } else if (s.celebrating) {
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

  if (s.look !== undefined && !s.low) o.look = s.look // 散步道: 眼睛看走的方向 / 东张西望
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
  return p
}

// 精简版的一行小螃蟹 (8 列 x 2 像素); 0.14 起子代理小螃蟹在散步道里, 这里不再画
export function miniPx(s: Scene, f: number): Px {
  const p = canvas(MINI_W, 2)
  const t = Math.floor(f / 2)
  const md = s.mood ?? 'normal'
  const body = bodyColor(s.pct, f)
  const bw = MINI_W
  rect(p, 0, 0, bw, 1, body)
  const idle = !s.working && !s.celebrating
  const closed = s.sleeping || (idle && md !== 'chill' && f % 30 === 0)
  const look = s.working ? 1 : 0
  const ex = [2, 5]
  let eye = closed ? mix(body, COL.eye, 0.45) : COL.eye
  if (md === 'panic' && !s.celebrating && f % 4 < 2) eye = COL.spark // 慌张: 眼睛黄红闪
  if (idle && !s.sleeping && md === 'chill') rect(p, ex[0], 0, ex[1] - ex[0] + 1, 1, COL.shades) // 墨镜
  else {
    put(p, ex[0] + look, 0, eye)
    put(p, ex[1] + look, 0, eye)
  }
  const scramble = md === 'panic' && !s.celebrating
  const wide = s.celebrating ? [0, 7] : (s.working || scramble) && t % 2 ? [0, 2, 5, 7] : [1, 3, 4, 6]
  const legs = wide
  for (const x of legs) put(p, x, 1, body)
  // 冒汗: 左下角一颗蓝色汗滴闪
  if (!s.celebrating && (s.pct >= 80 || md === 'sweat' || md === 'panic') && t % 4 < 2) put(p, 0, 1, COL.sweat)
  return p
}


// ---------------- 螃蟹散步道 (v0.14 起: 输入框正上方的横栏, 只在终端) ----------------
// 3 行版 (v0.15) = 6 像素高: 大螃蟹就是面板那只 (v0.16 直接用 scenePx: 按工具做动作 + 右边 3 列道具区 + 情绪), 占 15 格;
//   小螃蟹 7x4 (v0.16: 比大螃蟹小一大截, 眼睛四周都有身体, 看前面时也只在身体里挪), 占下面两行
// 天空行 (v0.16): 横栏放得下就在最上面空一行, 隔开上面的正文和螃蟹; 只有往上飘的粒子 (庆祝闪光 / 睡觉泡泡 / 思考点点) 能进去
// 2 行版 = 4 像素高: 大螃蟹 9x4 (BIG2); 小螃蟹 3x2, 只占下面那行
// 1 行版 = 2 像素高: 大螃蟹缩成 7x2 (占 9 格, 居中); 小螃蟹 3x2
// 排队: 一维的路上谁也不能从谁身上穿过去, 所以左右顺序固定 [最新的小螃蟹 ... 最早的小螃蟹, 大螃蟹]
//   往右走时小螃蟹跟在大螃蟹后面; 碰到一端整队一起掉头, 往左走时大螃蟹在后面赶着它们走
//   (按 "k 帧之前的位置" 跟着走的话, 掉头时每只都会和前面那只交叉重叠, 所以不用)
// 大螃蟹什么时候走: 主会话在跑, 或者有子代理在跑 (速度跟心情); 全闲时每 20-40 秒溜达 3-8 格, 停下东张西望;
//   5 分钟没有任何动静 (主会话 / 子代理 / 打字 / 发消息) 才睡; 打字时停下低头看输入框; 发出消息时跳一下
// 粒子 (v0.15): 盲文点画在没有螃蟹的空格子里, 最多 24 个 (v0.16), 每个活 2-8 帧, 每帧最多挪 1 个点位, 只会慢慢变暗
// 节奏: 每只每帧最多挪 1 格; 腿每 2-3 帧换一次; 身体颜色不闪
export type Rows = 1 | 2 | 3
// bw = 大螃蟹占的格数 (3 行版 = 螃蟹 12 + 右边道具区 3: 永远给道具留着地方, 不用镜像); cw = 螃蟹本身 (悬停区域); kw = 小螃蟹
export const LANE_SIZE: Record<Rows, { bw: number; cw: number; kw: number }> = { 3: { bw: 15, cw: 12, kw: 7 }, 2: { bw: 9, cw: 9, kw: 3 }, 1: { bw: 9, cw: 9, kw: 3 } }
export const TOOL_HOLD_FRAMES = 4 // 工具刚结束的这么多帧 (600ms) 里还算 "在用工具": 连着几个工具之间的空档不会走一格停一格
const LANE_L = 5 // 放不下时左端留给暗色的 "+N"
const LANE_ROAM = 6 // 小螃蟹再多也给整队留几格走动的地方
export const SAY_FRAMES = 33 // 气泡显示多久 (约 5 秒)
const WAVE_MS = 1500 // 子代理结束后挥手多久
export const TYPE_FRAMES = 10 // 最后一次按键后多久恢复 (约 1.5 秒)
const MOOD_STEP: Record<Mood, number> = { chill: 5, normal: 3, sweat: 2, panic: 1 } // 忙的时候每几帧走一格
const STROLL_STEP = 3 // 溜达时每几帧走一格
const STROLL_GAP = [133, 267] // 全闲时每隔多少帧溜达一次 (20-40 秒)
const LOOK_FRAMES = 24 // 溜达完东张西望多久 (3.6 秒)
const PT_MAX = 24 // 同时最多几个粒子
const DUST = 0x8a7f72 // 尘土: 暖灰
const PT_DARK = 0x27272a // 粒子变暗的方向

// state: walk = 在队里; wave = 子代理结束, 原地挥手; hop = 3 行版挥完往上跳出横栏 (还占着队里的位置, 后面的不会滑到它身下);
//        exit = 2 行版挥完走上面那行出去 (在 gone 里, 画在最底下)
export type LaneKid = { id: string; x: number; y: number; state: 'walk' | 'wave' | 'hop' | 'exit'; until: number; dir: 1 | -1 }
// 粒子: 盲文点坐标 (每格 2 x 4 个点; y 从螃蟹区顶上算, 天空行是 -4..-1), 速度每轴 -1/0/1 (有两个轴时奇偶帧轮流动, 每帧只挪 1 个点位)
// sky = 能不能进天空行 (只有往上飘的: 庆祝闪光 / 睡觉泡泡 / 思考点点)
export type Particle = { x: number; y: number; vx: -1 | 0 | 1; vy: -1 | 0 | 1; age: number; life: number; color: number; sky: boolean; every: 1 | 2 }
// greet = 鼠标停在大螃蟹上 (v0.16): 停下举钳打招呼, 队伍也停
export type LanePose = 'greet' | 'celebrate' | 'jump' | 'type' | 'tool' | 'walk' | 'sleep' | 'idle'
export type Lane = {
  w: number // 宽度 (格)
  rows: Rows // 螃蟹区几行 (不含天空行)
  sky: boolean // 最上面有没有天空行
  bw: number // 大螃蟹占几格 (3 行版含道具区)
  cw: number // 大螃蟹本身几格
  kw: number // 小螃蟹占几格
  bx: number // 大螃蟹最左一格
  dir: 1 | -1
  stepAt: number // 大螃蟹上次挪动的帧
  steps: number // 走了多少步 (尘土每隔几步扬一次)
  kids: LaneKid[] // 队里的小螃蟹, 从右 (挨着大螃蟹) 到左
  gone: LaneKid[] // 2 行版正在离场的
  hidden: number // 放不下的子代理个数 (+N)
  pt: Particle[]
  strollLeft: number // 这次溜达还剩几格
  strollAt: number // 下次溜达的帧 (-1 = 还没排)
  lookUntil: number // 溜达完东张西望到哪一帧
  celebAt: number // 这次庆祝从哪一帧开始 (-1 = 不在庆祝)
  pose: LanePose
}
// 这一帧的处境: 散步道的时钟和渲染用同一份; tool = 主会话正在用的工具种类 ('' = 没有, 在想 / 在回复)
// hold = 鼠标停在大螃蟹上 (或刚离开 0.5 秒内); lookAt = 指针在横栏别处时的列 (闲着时眼睛看过去), 没有就 undefined
export type LaneAct = { working: boolean; agents: number; typing: boolean; celebrating: boolean; sleeping: boolean; jumpAge: number; md: Mood; tool: ToolKind | ''; hold: boolean; lookAt?: number }
export function newLane(w: number, rows: Rows = 3, sky = false): Lane {
  const { bw, cw, kw } = LANE_SIZE[rows]
  const bx = Math.max(0, Math.floor((w - bw) / 2))
  return { w, rows, sky, bw, cw, kw, bx, dir: 1, stepAt: 0, steps: 0, kids: [], gone: [], hidden: 0, pt: [], strollLeft: 0, strollAt: -1, lookUntil: -1, celebAt: -1, pose: 'idle' }
}
export const laneCap = (L: Lane) => Math.max(0, Math.floor((L.w - LANE_L - L.bw - LANE_ROAM) / (L.kw + 1)))
const sgn = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0)
// 帧号做种子的伪随机 (测试里可复现)
const rnd = (f: number, salt: number) => (Math.imul(f + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0

// 宽度或行数变了: 宽度变 -> 整队平移回横栏里; 行数变 -> 螃蟹换尺寸, 小螃蟹按新尺寸重新排在大螃蟹后面
export function laneFit(L: Lane, w: number, rows: Rows, sky: boolean) {
  if (sky !== L.sky) {
    L.sky = sky
    L.pt = []
  }
  if (rows !== L.rows) {
    const { bw, cw, kw } = LANE_SIZE[rows]
    L.rows = rows
    L.bw = bw
    L.cw = cw
    L.kw = kw
    L.gone = []
    L.pt = []
    L.kids = L.kids.filter(k => k.state !== 'hop')
    L.kids.forEach((k, i) => (k.x = L.bx - (kw + 1) * (i + 1)))
  }
  if (w !== L.w || L.bx + L.bw > w) {
    L.w = w
    const shift = Math.min(0, w - L.bw - L.bx)
    if (shift) {
      L.bx += shift
      for (const k of L.kids) k.x += shift
    }
    if (L.bx < 0) L.bx = 0
  }
  L.kids = L.kids.slice(0, laneCap(L))
}

// 进队 / 出队 (不走动): 子代理结束 -> 原地挥手 WAVE_MS -> 3 行版往上跳出去, 2 行版走上面那行出去; 新的排到队尾
export function laneSync(L: Lane, now: number, running: string[]): boolean {
  let changed = false
  const run = new Set(running)
  for (const k of L.kids) {
    if (k.state === 'walk' && !run.has(k.id)) {
      k.state = 'wave'
      k.until = now + WAVE_MS
      changed = true
    } else if (k.state === 'wave' && run.has(k.id)) {
      k.state = 'walk'
      changed = true
    } else if (k.state === 'wave' && now >= k.until) {
      changed = true
      if (L.rows === 3) {
        k.state = 'hop'
        k.y = 2
      } else {
        k.state = 'exit'
        k.dir = k.x + L.kw / 2 < L.w / 2 ? -1 : 1
        L.gone.push(k)
      }
    }
  }
  L.kids = L.kids.filter(k => k.state !== 'exit')
  const cap = laneCap(L)
  const slot = L.kw + 1
  for (const id of running) {
    if (L.kids.some(k => k.id === id)) continue
    if (L.kids.length >= cap) break
    const i = L.kids.length
    const right = i ? L.kids[i - 1].x : L.bx // 右边邻居; 新来的放在队尾, 不和它挨着
    L.kids.push({ id, x: Math.min(L.bx - slot * (i + 1), right - slot), y: 0, state: 'walk', until: 0, dir: 1 })
    changed = true
  }
  const shown = L.kids.filter(k => k.state === 'walk').length
  const hidden = Math.max(0, running.length - shown)
  if (hidden !== L.hidden) {
    L.hidden = hidden
    changed = true
  }
  return changed
}

// 这一帧大螃蟹是什么姿势: 庆祝 > 跳 > 打字低头 > 用工具 (停下做动作) > 走 (在想 / 在回复 / 子代理在跑 / 溜达) > 睡 > 趴着
export function lanePose(L: Lane, a: LaneAct): LanePose {
  if (a.hold) return 'greet'
  if (a.celebrating) return 'celebrate'
  if (a.jumpAge >= 0 && a.jumpAge < JUMP_FRAMES) return 'jump'
  if (a.typing) return 'type'
  if (a.tool) return 'tool'
  if (a.working || a.agents > 0 || L.strollLeft > 0) return 'walk'
  if (a.sleeping) return 'sleep'
  return 'idle'
}

// 粒子能到的最上面一行点: 能进天空行的到 -4, 其余到螃蟹区顶边 0
const ptTop = (L: Lane, sky: boolean) => (sky && L.sky ? -4 : 0)
function addPt(L: Lane, x: number, y: number, vx: -1 | 0 | 1, vy: -1 | 0 | 1, life: number, color: number, sky = false, every: 1 | 2 = 1) {
  if (L.pt.length >= PT_MAX) return
  if (x < 0 || y < ptTop(L, sky) || x >= L.w * 2 || y >= L.rows * 4) return
  L.pt.push({ x, y, vx, vy, age: 0, life: Math.max(2, Math.min(8, life)), color, sky, every })
}

// 粒子: 先让活着的走一步 (到寿命就消失), 再按这一帧发生的事冒新的
// 每粒的方向 (vx, vy) 和快慢 (every: 每 1 帧或每 2 帧挪一次) 略有不同, 散开飘, 不排成一条线
function laneParticles(L: Lane, f: number, a: LaneAct, pose: LanePose, exits: LaneKid[]) {
  for (const p of L.pt) {
    p.age += 1
    if (p.age % p.every) continue // 慢的那些隔一帧才挪
    // 两个轴都有速度时轮流动: 每帧只挪 1 个点位
    if (p.vx && p.vy) {
      if ((p.age / p.every) % 2) p.x += p.vx
      else p.y += p.vy
    } else {
      p.x += p.vx
      p.y += p.vy
    }
  }
  L.pt = L.pt.filter(p => p.age < p.life && p.x >= 0 && p.y >= ptTop(L, p.sky) && p.x < L.w * 2 && p.y < L.rows * 4)
  const H = L.rows * 4 // 点的行数
  const backCell = L.dir > 0 ? L.bx - 1 : L.bx + L.cw // 脚后那一格 (往右走: 和队里的小螃蟹之间的空隙; 往左走: 螃蟹右边)
  const away = (L.dir > 0 ? -1 : 1) as -1 | 1 // 往后
  const fast = a.md === 'sweat' || a.md === 'panic'
  const busy = a.working || a.agents > 0
  const trot = fast && busy
  // 走路扬尘: 每 1-2 帧从脚后冒 1 粒, 每粒活 4-8 帧, 往后上方散开 -> 平时同时 3-5 粒; 小跑时每帧都冒, 活得久一点 -> 5-7 粒
  if (pose === 'walk') {
    const r = rnd(f, 1)
    if (trot || f % 3 !== 2) {
      const vy = (r % 3 === 0 ? 0 : -1) as -1 | 0 // 大多往上飘, 少数贴着地往后走
      const vx = (r % 4 === 1 ? 0 : away) as -1 | 0 | 1 // 大多往后, 少数直着往上
      const life = trot ? 6 + (r % 2) : 4 + (r % 2) + (f % 3 === 0 ? 1 : 0)
      addPt(L, backCell * 2 + (f % 2), H - 1 - (r % 2), vx, vy, life, DUST, false, r % 5 === 0 ? 2 : 1)
    }
    // 小跑: 偶尔甩出一滴蓝色汗珠 (往后下方落)
    if (trot && rnd(f, 4) % 12 === 0) addPt(L, backCell * 2, 2, away, 1, 5, mix(COL.sweat, PT_DARK, 0.25))
  }
  // 一轮结束庆祝: 螃蟹两边冒一小圈金色闪光, 往上飘进天空行消失 (分三波, 同时 6-10 粒)
  if (pose === 'celebrate') {
    if (L.celebAt < 0) L.celebAt = f
    const age = f - L.celebAt
    const wave = age === 0 ? 5 : age === 2 ? 3 : age === 4 ? 2 : 0
    const left = L.bx * 2 - 1
    const right = (L.bx + L.cw) * 2
    for (let i = 0; i < wave; i++) {
      const k = i + age * 3
      const onRight = k % 2 === 1
      const x = onRight ? right + ((k >> 1) % 3) : left - ((k >> 1) % 3)
      const y = H - 2 - ((k * 3) % Math.max(1, H - 2))
      addPt(L, x, y, (k >> 1) % 2 ? (onRight ? 1 : -1) : 0, -1, 5 + (rnd(f, 10 + i) % 3), mix(COL.spark, PT_DARK, 0.25), true, k % 3 === 0 ? 2 : 1)
    }
  } else L.celebAt = -1
  // 发出消息那一跳落地: 两只脚边冒 5 粒, 往两边散
  if (pose === 'jump' && a.jumpAge === JUMP_FRAMES - 1) {
    const lx = (L.bx - 1) * 2 + 1
    const rx = (L.bx + L.cw) * 2
    addPt(L, lx, H - 1, -1, -1, 5, DUST)
    addPt(L, lx, H - 2, -1, 0, 4, DUST, false, 2)
    addPt(L, rx, H - 1, 1, -1, 5, DUST)
    addPt(L, rx, H - 2, 1, 0, 4, DUST, false, 2)
    addPt(L, rx + 1, H - 1, 1, -1, 6, DUST, false, 2)
  }
  // 睡着: 头边慢慢冒泡泡 (每 12 帧一个), 往上飘进天空行
  if (pose === 'sleep' && f % 12 === 0) {
    const x = L.bx + L.bw < L.w ? (L.bx + L.bw) * 2 : (L.bx - 1) * 2 + 1
    addPt(L, x, Math.min(H - 1, 5), 0, -1, 5, mix(COL.bubble, PT_DARK, 0.3), true)
  }
  // 在想 / 在回复 (主会话在跑但没有工具): 头顶冒思考点点, 往上飘进天空行 (没有天空行就不冒, 头顶就是格子边)
  if (pose === 'walk' && a.working && !a.tool && L.sky && f % 5 === 0) {
    const head = L.bx + Math.floor(L.cw / 2) + (Math.floor(f / 5) % 3) - 1
    addPt(L, head * 2 + (Math.floor(f / 5) % 2), -1, 0, -1, 4 + (rnd(f, 30) % 2), mix(COL.thought, PT_DARK, 0.2), true, 2)
  }
  // 小螃蟹离场: 出口处冒一小团 (5 粒, 往四周散)
  for (const k of exits) {
    const cx = L.rows === 3 ? (k.x + 4) * 2 : k.dir < 0 ? 1 : L.w * 2 - 2
    const cy = L.rows === 3 ? 0 : 1
    addPt(L, cx, cy, -1, 0, 4, DUST)
    addPt(L, cx + 1, cy, 1, 0, 4, DUST)
    addPt(L, cx, cy + 1, 0, 1, 4, DUST, false, 2)
    addPt(L, cx + 1, cy + 1, 1, 1, 5, DUST, false, 2)
    addPt(L, cx - 1, cy + 1, -1, 1, 5, DUST)
  }
}

// 走一帧 (只是算位置和粒子, 不碰 $); 返回这一帧画面有没有变化
export function laneStep(L: Lane, f: number, now: number, a: LaneAct, running: string[]): boolean {
  let changed = laneSync(L, now, running)
  if (L.kids.some(k => k.state === 'wave')) changed = true // 挥手的钳子在动
  // 3 行版往上跳出去的: 每帧升 1 像素, 整只出了顶边才让出队里的位置
  const exits: LaneKid[] = []
  for (const k of L.kids) {
    if (k.state !== 'hop') continue
    k.y -= 1
    changed = true
    if (k.y + 4 <= 0) exits.push(k)
  }
  L.kids = L.kids.filter(k => !exits.includes(k))
  // 2 行版走上面那行出去的
  for (const k of L.gone) {
    k.x += k.dir
    changed = true
    if (k.x + L.kw <= 0 || k.x >= L.w) exits.push(k)
  }
  L.gone = L.gone.filter(k => !exits.includes(k))
  // 溜达的排程: 只在全闲时 (不忙、不打字、不跳、不庆祝、没睡) 才排; 一忙起来就清掉
  const busy = a.working || a.agents > 0
  const calm = !busy && !a.hold && !a.typing && !a.celebrating && !a.sleeping && !(a.jumpAge >= 0 && a.jumpAge < JUMP_FRAMES)
  if (!calm) {
    L.strollLeft = 0
    L.strollAt = -1
  } else {
    if (L.strollAt < 0) L.strollAt = f + STROLL_GAP[0] + (rnd(f, 20) % (STROLL_GAP[1] - STROLL_GAP[0]))
    if (L.strollLeft === 0 && f >= L.strollAt) {
      L.strollLeft = 3 + (rnd(f, 21) % 6)
      L.dir = rnd(f, 22) % 2 ? 1 : -1
      L.strollAt = Number.MAX_SAFE_INTEGER // 走完再排下一次
    }
  }
  const pose = lanePose(L, a)
  if (pose !== L.pose) {
    L.pose = pose
    changed = true
  }
  if (pose === 'idle' && f < L.lookUntil) changed = true // 东张西望
  const m = L.kids.length
  const lo = L.hidden ? LANE_L : 0
  const slot = L.kw + 1
  let dBig: -1 | 0 | 1 = 0
  if (pose === 'walk') {
    const room = L.w - lo - L.bw - slot * m > 0
    if (!room) {
      // 没地方走: 这次溜达作罢, 过一阵再试 (不然会一直摆着走路的姿势)
      if (L.strollLeft) L.strollAt = f + STROLL_GAP[0]
      L.strollLeft = 0
    }    else if (f - L.stepAt >= (busy ? MOOD_STEP[a.md] : STROLL_STEP)) {
      if (L.dir > 0 && L.bx + L.bw >= L.w) L.dir = -1
      else if (L.dir < 0 && L.bx - slot * m <= lo) L.dir = 1
      dBig = L.dir
    }
  }
  // 一起挪: 往右的从最右一只开始依次挪, 往左的从最左一只开始依次挪, 前面被挡住就这一帧不动
  // 这样任何时候两只之间至少空 1 格, 不会重叠, 也不会贴住
  const base = L.bx + dBig - slot // 第 0 只小螃蟹的目标位置, 第 i 只再往左 i 个 slot
  const xs = [L.bx, ...L.kids.map(k => k.x)]
  const want = [dBig, ...L.kids.map((k, i) => (k.state === 'hop' ? 0 : sgn(base - slot * i - k.x)))]
  for (let j = 0; j < xs.length; j++) {
    if (want[j] !== 1) continue
    const limit = j === 0 ? L.w - L.bw : xs[j - 1] - slot
    if (xs[j] + 1 <= limit) xs[j] += 1
  }
  for (let j = xs.length - 1; j >= 0; j--) {
    if (want[j] !== -1) continue
    const limit = j === xs.length - 1 ? (j === 0 ? 0 : -Infinity) : xs[j + 1] + slot
    if (xs[j] - 1 >= limit) xs[j] -= 1
  }
  const stepped = xs[0] !== L.bx
  if (stepped) {
    L.bx = xs[0]
    L.stepAt = f
    L.steps += 1
    changed = true
    if (!busy && L.strollLeft > 0) {
      L.strollLeft -= 1
      if (L.strollLeft === 0) {
        L.lookUntil = f + LOOK_FRAMES
        L.strollAt = f + STROLL_GAP[0] + (rnd(f, 23) % (STROLL_GAP[1] - STROLL_GAP[0]))
      }
    }
  }
  L.kids.forEach((k, i) => {
    if (xs[i + 1] !== k.x) {
      k.x = xs[i + 1]
      changed = true
    }
  })
  laneParticles(L, f, a, pose, exits)
  if (L.pt.length) changed = true
  return changed
}

// 2 行版大螃蟹的字符画: B = 身体 (钳子、腿同色), 眼睛另外点 (也是 3 行版小螃蟹的精灵)
// 3 行版的小螃蟹 (7x4): 眼睛在第 1 行的 x=2 / x=4, 看前面时整体挪 1 格 (x 1-5), 四周都还是身体; 挥手 = 一边的钳子尖翘起来
export const KID3 = {
  walk: ['.BBBBB.', 'BBBBBBB', '.BBBBB.'],
  legs: ['.B.B.B.', '..B.B..'],
  waveA: ['BBBBBB.', 'BBBBBBB', '.BBBBB.'],
  waveB: ['.BBBBBB', 'BBBBBBB', '.BBBBB.'],
}
export const BIG2 = {
  walk: ['..BBBBB..', 'B.BBBBB.B', 'BBBBBBBBB'],
  legs: ['..B.B.B..', '...B.B...'],
  rest: ['.........', '..BBBBB..', '..BBBBB..', 'BBBBBBBBB'], // 趴着: 身体放低, 腿收起, 钳子平放在地上
  jump: ['B.BBBBB.B', 'B.BBBBB.B', '..BBBBB..'], // 举钳
  jumpLegs: ['..B...B..', '.........'], // 落地 / 腾空
  hi: ['..BBBBB.B', 'B.BBBBB.B', 'BBBBBBB..', '..B.B.B..'], // 打招呼: 右钳举起
}

// 大螃蟹在散步道里的处境 -> 面板螃蟹 (scenePx / miniPx) 认的 Scene; 面板那套动作、道具、情绪原样拿来用
export function laneScene(L: Lane, f: number, a: LaneAct, pct: number): Scene {
  const base: Scene = { working: false, kind: 'think', pct, celebrating: false, sleeping: false, agents: 0, mood: a.md }
  switch (L.pose) {
    case 'celebrate':
      return { ...base, celebrating: true }
    case 'jump':
      return { ...base, hop: a.jumpAge }
    case 'type':
      return { ...base, low: true }
    case 'tool':
      // 停下来原地做这个工具的动作, 道具画在右边 3 列 (和面板一样)
      return { ...base, working: true, kind: a.tool || 'other' }
    case 'walk':
      // 走路: 腿交替、上下颠, 眼睛看走的方向; 不画道具 ("派子代理" 那种空手的样子)
      return { ...base, working: true, kind: 'agent', look: L.dir }
    case 'sleep':
      return { ...base, sleeping: true }
    default:
      // 闲着: 眨眼 / 张望 / 偶尔挥手 / 悠闲戴墨镜 / 慌张举钳 "!" 都是面板那套; 溜达完东张西望
      // 指针在横栏别处时眼睛看过去
      if (a.lookAt !== undefined) return { ...base, look: a.lookAt < L.bx + L.cw / 2 - 1 ? -1 : a.lookAt > L.bx + L.cw / 2 ? 1 : 0 }
      return { ...base, look: f < L.lookUntil ? (Math.floor((L.lookUntil - f) / 6) % 2 ? -1 : 1) : undefined }
  }
}

// 画大螃蟹 (不含粒子)
//   3 行版: 面板那只 (scenePx 15x6: 螃蟹 12 + 道具区 3), 逐像素拷到 bx; greet = 悬停时的举钳打招呼 (12x6, 静止的一张)
//   2 行版: BIG2 字符画 (用工具时站着, 两只钳子轮流敲); 1 行版: 面板精简版那只 (miniPx 8x2, 带墨镜 / 汗滴 / 慌张眼睛)
export function drawLaneBig(p: Px, L: Lane, f: number, a: LaneAct, pct: number, greetOnly = false, ox = L.bx) {
  const greet = greetOnly || L.pose === 'greet'
  const body = bodyColor(pct, f)
  const blit = (src: Px, x0: number) => src.forEach((row, y) => row.forEach((c, x) => c >= 0 && put(p, x0 + x, y, c)))
  if (L.rows === 3) {
    if (greet) drawCrab(p, { bob: 0, legs: 0, eyes: 'open', look: 0, armL: 'out', armR: 'up', body }, ox)
    else blit(scenePx(laneScene(L, f, a, pct), f), ox)
    return
  }
  if (L.rows === 1) {
    blit(miniPx(greet ? { working: false, kind: 'think', pct, celebrating: false, sleeping: false, agents: 0, mood: 'normal' } : laneScene(L, f, a, pct), f), ox + 1)
    return
  }
  const bc = { B: body }
  const pose = greet ? 'hi' : L.pose
  const shut = (pose === 'sleep' || ((pose === 'idle' || pose === 'type') && f % 30 === 0)) && !greet
  const eye = shut ? mix(body, COL.eye, 0.45) : COL.eye
  const look = pose === 'walk' ? L.dir : pose === 'tool' ? 1 : pose === 'idle' && f < L.lookUntil ? (Math.floor((L.lookUntil - f) / 6) % 2 ? -1 : 1) : 0
  const legStep = Math.floor(f / (a.md === 'panic' ? 2 : 3)) % 2
  const hop = Math.floor(f / 3) % 2
  let ey = 1
  if (pose === 'hi') paint(p, ox, 0, BIG2.hi, bc)
  else if (pose === 'walk') paint(p, ox, 0, [...BIG2.walk, BIG2.legs[legStep]], bc)
  else if (pose === 'tool') paint(p, ox, 0, [...(hop ? BIG2.hi : BIG2.walk).slice(0, 3), BIG2.legs[0]], bc) // 站着, 右钳一起一落
  else if (pose === 'celebrate') paint(p, ox, 0, [...BIG2.jump, BIG2.jumpLegs[hop]], bc)
  else if (pose === 'jump') paint(p, ox, 0, [...BIG2.jump, BIG2.jumpLegs[a.jumpAge === 1 || a.jumpAge === 2 ? 1 : 0]], bc)
  else {
    paint(p, ox, 0, BIG2.rest, bc) // 趴着 / 睡着 / 打字时低头
    ey = 2
  }
  put(p, ox + 3 + look, ey, eye)
  put(p, ox + 5 + look, ey, eye)
}

// 螃蟹区的像素 (不含天空行)
export function lanePx(L: Lane, f: number, a: LaneAct, pct: number): Px {
  const rows = L.rows
  const p = canvas(L.w, rows * 2)
  const kc = { C: COL.kid, L: COL.kidLeg }
  const kstep = Math.floor(f / 3) % 2
  // 大螃蟹停下来用工具时, 小螃蟹也停下, 原地慢慢跳 (每 5 帧起落一次, 跳的时候腿不动)
  const bounce = L.pose === 'tool' ? Math.floor(f / 5) % 2 : 0
  // 2 行版离场的小螃蟹画在最底下 (从别的螃蟹背后过); 1 行版没有上面那行, 挥完手直接消失
  if (rows === 2) for (const k of L.gone) paint(p, k.x, 0, ['CCC', Math.floor(f / 2) % 2 ? '.L.' : 'L.L'], kc)
  for (const k of L.kids) {
    const hopNow = k.state === 'walk' ? bounce : 0
    if (rows === 3) {
      // 7x4 的小螃蟹 (浅一号的颜色, 腿深一号), 眼睛看走的方向 (只在身体里挪); 挥手 = 两边的钳子尖轮流翘起
      const y = (k.state === 'hop' ? k.y : 2) - hopNow
      const arms = k.state === 'wave' ? (kstep ? KID3.waveA : KID3.waveB) : KID3.walk
      paint(p, k.x, y, arms, { B: COL.kid })
      paint(p, k.x, y + 3, [k.state === 'hop' ? '.......' : KID3.legs[L.pose === 'tool' || L.pose === 'greet' ? 0 : kstep]], { B: COL.kidLeg })
      put(p, k.x + 2 + L.dir, y + 1, COL.eye)
      put(p, k.x + 4 + L.dir, y + 1, COL.eye)
    } else if (k.state === 'wave') {
      // 挥手: 2 行版两只钳子轮流举起; 1 行版原地小跳
      if (rows === 2) paint(p, k.x, 1, [kstep ? 'C..' : '..C', 'CCC', 'L.L'], kc)
      else paint(p, k.x, 0, ['CCC', kstep ? '...' : 'L.L'], kc)
    } else if (rows === 2) paint(p, k.x, 2 - hopNow, ['CCC', L.pose === 'tool' ? 'L.L' : kstep ? '.L.' : 'L.L'], kc)
    else paint(p, k.x, 0, ['CCC', L.pose === 'tool' ? 'L.L' : kstep ? '.L.' : 'L.L'], kc)
  }
  drawLaneBig(p, L, f, a, pct)
  return p
}

// 盲文点: (列, 行) -> 位
const BRAILLE = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]
// 编码: 有像素的格子照常用半格方块; 上下两半都空的格子才放粒子 (同一格几个点合成一个盲文字符, 颜色取最年轻的)
// px 已经含天空行 (sky 时最上面 2 像素是空的); 粒子的 y 从螃蟹区顶上算, 所以往下挪 yOff 个点
export function laneCells(px: Px, cols: number, rows: number, pts: Particle[], yOff = 0): number[] {
  const dots = new Map<number, { bits: number; age: number; color: number }>()
  for (const p of pts) {
    const y = p.y + yOff
    const cx = p.x >> 1
    const r = y >> 2
    if (y < 0 || cx >= cols || r >= rows) continue
    const id = r * cols + cx
    const d = dots.get(id) ?? { bits: 0, age: Infinity, color: 0 }
    d.bits |= BRAILLE[p.x & 1][y & 3]
    if (p.age / p.life < d.age) {
      d.age = p.age / p.life
      d.color = mix(p.color, PT_DARK, d.age * 0.6) // 只会慢慢变暗
    }
    dots.set(id, d)
  }
  const words: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const top = px[r * 2]?.[c] ?? -1
      const bot = px[r * 2 + 1]?.[c] ?? -1
      const d = dots.get(r * cols + c)
      if (top < 0 && bot < 0) {
        if (d && d.bits) words.push(0x2800 + d.bits, d.color, DEF)
        else words.push(32, DEF, DEF)
      } else if (bot < 0) words.push(0x2580, top, DEF)
      else if (top < 0) words.push(0x2584, bot, DEF)
      else words.push(0x2580, top, bot)
    }
  }
  return words
}
// 同上, 打包成 Raster 那种 base64 (测试和预览用)
export function encodeLane(px: Px, cols: number, rows: number, pts: Particle[], yOff = 0): string {
  return new Uint8Array(Uint32Array.from(laneCells(px, cols, rows, pts, yOff)).buffer).toBase64()
}

// 悬停气泡的内容挑法: 从长到短 [全文, 省掉时间, 只有摘要, 只有摘要且不带时间]; 放不下时先省掉时间,
// 再把小贴士截短 (至少留得下 "小贴士 /hud" 和一个字, 见 tipMin), 再放不下才只留摘要 (截短)
export function tipFit(v: string[], tipMin: number): (room: number) => string {
  const [full, short, sumT, sum] = v
  return room => (dw(full) <= room ? full : dw(short) <= room ? short : room >= tipMin ? clip(short, room) : dw(sumT) <= room ? sumT : clip(sum, room))
}

// 气泡放在大螃蟹旁边: 右边地方大就放右边, 否则放左边; 只放第 0 行 (2/3 行版的小螃蟹在下面); 放不下就截短, 绝不压到螃蟹
// text: 一句话 (放不下就截短), 或者 "给定宽度, 返回放得下的写法" 的函数 (悬停气泡用)
export function bubbleSpot(L: Lane, text: string | ((room: number) => string)): { x: number; text: string } | undefined {
  const fit = typeof text === 'string' ? (room: number) => clip(text, room) : text
  const rightX = L.bx + L.bw + 1
  const rightRoom = L.w - rightX
  const leftRoom = L.bx - 1
  const useRight = rightRoom >= dw(fit(Infinity)) || rightRoom >= leftRoom
  const room = useRight ? rightRoom : leftRoom
  if (room < 4) return undefined
  const t = fit(room)
  return { x: useRight ? rightX : L.bx - 1 - dw(t), text: t }
}

// 测试用: 用一条全新的散步道跑 N 帧 (不碰会话里那条), 给出每帧的像素、粒子和位置
type LanePreviewOpts = {
  w?: number
  rows?: Rows
  sky?: boolean
  frames?: number
  working?: boolean | ((f: number) => boolean)
  mood?: Mood
  running?: (f: number) => string[]
  typing?: (f: number) => boolean
  jumpAt?: number
  celebrating?: boolean | ((f: number) => boolean)
  sleeping?: boolean
  pct?: number
  tool?: ToolKind | '' | ((f: number) => ToolKind | '')
  hold?: (f: number) => boolean
}
export function previewLane(o: LanePreviewOpts = {}) {
  const rows = o.rows ?? 3
  const sky = !!o.sky
  const L = newLane(o.w ?? 80, rows, sky)
  const out: Array<{ px: Px; cells: string; pt: Particle[]; pose: LanePose; bx: number; dir: number; kids: Array<{ id: string; x: number; y: number; state: string }>; gone: Array<{ id: string; x: number }>; hidden: number }> = []
  const at = (v: boolean | ((f: number) => boolean) | undefined, f: number, d: boolean) => (typeof v === 'function' ? v(f) : (v ?? d))
  for (let f = 0; f < (o.frames ?? 60); f++) {
    const running = o.running ? o.running(f) : []
    const a: LaneAct = {
      working: at(o.working, f, true),
      agents: running.length,
      typing: o.typing ? o.typing(f) : false,
      celebrating: at(o.celebrating, f, false),
      sleeping: !!o.sleeping,
      jumpAge: o.jumpAt === undefined ? -999 : f - o.jumpAt,
      md: o.mood ?? 'normal',
      tool: typeof o.tool === 'function' ? o.tool(f) : (o.tool ?? ''),
      hold: o.hold ? o.hold(f) : false,
    }
    laneStep(L, f, f * FRAME_MS, a, running)
    // px 含天空行 (和真的横栏一样)
    const px = [...(sky ? [new Array(L.w).fill(-1), new Array(L.w).fill(-1)] : []), ...lanePx(L, f, a, o.pct ?? 30)]
    out.push({
      px,
      cells: encodeLane(px, L.w, rows + (sky ? 1 : 0), L.pt, sky ? 4 : 0),
      pt: L.pt.map(p => ({ ...p })),
      pose: L.pose,
      bx: L.bx,
      dir: L.dir,
      kids: L.kids.map(k => ({ id: k.id, x: k.x, y: k.y, state: k.state })),
      gone: L.gone.map(k => ({ id: k.id, x: k.x })),
      hidden: L.hidden,
    })
  }
  return {
    frames: out,
    colors: { body: COL.body, eye: COL.eye, kid: COL.kid, kidLeg: COL.kidLeg, spark: COL.spark, thought: COL.thought, paper: COL.paper, term: COL.term, sea: COL.sea, scan: COL.scan, cursor: COL.cursor },
    bw: L.bw,
    cw: L.cw,
    kw: L.kw,
    cap: laneCap(L),
    max: PT_MAX,
    dust: DUST,
  }
}
