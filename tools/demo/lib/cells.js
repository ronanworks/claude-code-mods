// 终端格子画布: 每格一个字符 + 前景色 + 背景色, 中文/全角占 2 格 (宽度规则照搬 usage-hud 的 isWide/dw/clip)
// 块字符 (▀▄▁..█)、框线 (─━│╭╮╰╯)、⎿ 用矩形/线段画, 保证相邻格无缝相接, 和 Windows Terminal 自绘的效果一致

// ---------- 宽度 (与 usage-hud/hooks/register.tsx 相同) ----------
export function isWide(cp) {
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
export function dw(s) {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return w
}
export function clip(s, max) {
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
export const padL = (s, n) => ' '.repeat(Math.max(0, n - dw(s))) + s
export const padR = (s, n) => s + ' '.repeat(Math.max(0, n - dw(s)))

export const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6)

// ---------- 格子 ----------
export class Grid {
  constructor(cols, rows) {
    this.cols = cols
    this.rows = rows
    this.cells = Array.from({ length: rows }, () => new Array(cols).fill(null))
    this.bgs = Array.from({ length: rows }, () => new Array(cols).fill(null))
  }
  inRow(r) {
    return r >= 0 && r < this.rows
  }
  // 背景色: [c0, c1)
  bg(r, c0, c1, color) {
    if (!this.inRow(r)) return
    for (let c = Math.max(0, c0); c < Math.min(this.cols, c1); c++) this.bgs[r][c] = color
  }
  // 写一段文字, 返回写完后的列; max = 这一段最多写到哪一列 (不含), 放不下的宽字符直接截掉 (同 overflow:hidden)
  text(r, c, s, st = {}, max = this.cols) {
    if (!this.inRow(r)) return c + dw(s)
    for (const ch of s) {
      const w = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
      if (c + w > max) break
      if (c >= 0) {
        this.cells[r][c] = { ch, w, fg: st.fg, bold: !!st.bold, ul: !!st.ul, italic: !!st.italic }
        if (w === 2 && c + 1 < this.cols) this.cells[r][c + 1] = { cont: true }
        if (st.bg) for (let k = 0; k < w; k++) if (c + k < this.cols) this.bgs[r][c + k] = st.bg
      }
      c += w
    }
    return c
  }
  // 一段连续的 [文字, 样式] 片段
  runs(r, c, runs, max = this.cols) {
    for (const [s, st] of runs) c = this.text(r, c, s, st, max)
    return c
  }
  // 半块像素: 和 usage-hud 的 encode() 同一种拼法 (一格 = 上下两个像素; -1 = 终端默认底色)
  raster(r0, c0, px, cols, cellRows) {
    for (let r = 0; r < cellRows; r++) {
      for (let c = 0; c < cols; c++) {
        const top = px[r * 2]?.[c] ?? -1
        const bot = px[r * 2 + 1]?.[c] ?? -1
        if (!this.inRow(r0 + r) || c0 + c < 0 || c0 + c >= this.cols) continue
        if (top < 0 && bot < 0) this.cells[r0 + r][c0 + c] = null
        else this.cells[r0 + r][c0 + c] = { raster: true, top, bot }
      }
    }
  }
}

// ---------- 画到 canvas ----------
const MONO = '"Cascadia Mono", "Microsoft YaHei", "Segoe UI Symbol", "Segoe UI Emoji", sans-serif'
const widthCache = new Map()

export function metrics(ctx, cw, ch, size) {
  ctx.font = `${size}px ${MONO}`
  const m = ctx.measureText('Hg')
  const asc = m.fontBoundingBoxAscent
  const desc = m.fontBoundingBoxDescent
  return { cw, ch, size, baseline: Math.round(((ch - (asc + desc)) / 2 + asc) * 2) / 2 }
}

function glyphWidth(ctx, font, ch) {
  const k = font + '|' + ch
  let w = widthCache.get(k)
  if (w === undefined) {
    ctx.font = font
    w = ctx.measureText(ch).width
    widthCache.set(k, w)
  }
  return w
}

const rgb = c => (typeof c === 'number' ? hex(c) : c)

// 框线和块字符: 自己画, 不靠字体
function special(ctx, cp, x, y, m, color) {
  const { cw, ch } = m
  const light = 1
  const heavy = Math.max(2, Math.round(ch * 0.18))
  ctx.fillStyle = color
  ctx.strokeStyle = color
  if (cp >= 0x2581 && cp <= 0x2588) {
    const h = ((cp - 0x2580) / 8) * ch
    ctx.fillRect(x, y + ch - h, cw, h)
    return true
  }
  // 四分块 ▌▐▖▗▘▙▚▛▜▝▞▟: [左上, 右上, 左下, 右下]
  const QUAD = { 0x258c: 0b1010, 0x2590: 0b0101, 0x2596: 0b0010, 0x2597: 0b0001, 0x2598: 0b1000, 0x2599: 0b1011, 0x259a: 0b1001, 0x259b: 0b1110, 0x259c: 0b1101, 0x259d: 0b0100, 0x259e: 0b0110, 0x259f: 0b0111 }
  if (QUAD[cp] !== undefined) {
    const q = QUAD[cp]
    const hw = cw / 2
    const hh = ch / 2
    if (q & 0b1000) ctx.fillRect(x, y, hw, hh)
    if (q & 0b0100) ctx.fillRect(x + hw, y, hw, hh)
    if (q & 0b0010) ctx.fillRect(x, y + hh, hw, hh)
    if (q & 0b0001) ctx.fillRect(x + hw, y + hh, hw, hh)
    return true
  }
  switch (cp) {
    case 0x2580: // ▀
      ctx.fillRect(x, y, cw, ch / 2)
      return true
    case 0x2584: // ▄
      ctx.fillRect(x, y + ch / 2, cw, ch / 2)
      return true
    case 0x2500: // ─
      ctx.fillRect(x, y + ch / 2 - light / 2, cw, light)
      return true
    case 0x2501: // ━
      ctx.fillRect(x, y + ch / 2 - heavy / 2, cw, heavy)
      return true
    case 0x2502: // │
      ctx.fillRect(x + cw / 2 - light / 2, y, light, ch)
      return true
    case 0x256d: // ╭
    case 0x256e: // ╮
    case 0x256f: // ╯
    case 0x2570: {
      // ╰
      const cx = x + cw / 2
      const cy = y + ch / 2
      const r = Math.min(cw, ch) / 2
      const right = cp === 0x256d || cp === 0x2570
      const down = cp === 0x256d || cp === 0x256e
      const ex = right ? x + cw : x
      const ey = down ? y + ch : y
      ctx.lineWidth = light
      ctx.beginPath()
      ctx.moveTo(ex, cy)
      ctx.arcTo(cx, cy, cx, ey, r)
      ctx.lineTo(cx, ey)
      ctx.stroke()
      return true
    }
    case 0x23bf: {
      // ⎿ : 竖线 + 底部向右的横线
      const vx = Math.round(x + cw * 0.35)
      const top = y + Math.round(ch * 0.12)
      const bot = y + Math.round(ch * 0.62)
      ctx.fillRect(vx, top, light, bot - top + light)
      ctx.fillRect(vx, bot, x + cw - vx, light)
      return true
    }
  }
  return false
}

// 把格子画在 (ox, oy); opts.fg = 默认前景色, opts.bg = 背景 (null = 不画, 透出底下的终端底色)
export function drawGrid(ctx, g, ox, oy, m, opts = {}) {
  const { cw, ch } = m
  const defFg = opts.fg ?? '#ffffff'
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  // 背景: 一行里同色的连续格子合成一个矩形, 避免接缝
  for (let r = 0; r < g.rows; r++) {
    let c = 0
    while (c < g.cols) {
      const col = g.bgs[r][c]
      if (!col) {
        c++
        continue
      }
      let e = c + 1
      while (e < g.cols && g.bgs[r][e] === col) e++
      ctx.fillStyle = rgb(col)
      ctx.fillRect(ox + c * cw, oy + r * ch, (e - c) * cw, ch)
      c = e
    }
  }
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const cell = g.cells[r][c]
      if (!cell || cell.cont) continue
      const x = ox + c * cw
      const y = oy + r * ch
      if (cell.raster) {
        if (cell.top >= 0) {
          ctx.fillStyle = rgb(cell.top)
          ctx.fillRect(x, y, cw, ch / 2)
        }
        if (cell.bot >= 0) {
          ctx.fillStyle = rgb(cell.bot)
          ctx.fillRect(x, y + ch / 2, cw, ch / 2)
        }
        continue
      }
      if (cell.ch === ' ') continue
      const color = rgb(cell.fg ?? defFg)
      const cp = cell.ch.codePointAt(0)
      if (!special(ctx, cp, x, y, m, color)) {
        const font = `${cell.italic ? 'italic ' : ''}${cell.bold ? 'bold ' : ''}${m.size}px ${MONO}`
        const room = cell.w * cw
        const w = glyphWidth(ctx, font, cell.ch)
        ctx.font = font
        ctx.fillStyle = color
        if (w > room * 1.04) {
          // 回退字体里比格子宽的符号: 横向压进格子
          ctx.save()
          ctx.translate(x, 0)
          ctx.scale(room / w, 1)
          ctx.fillText(cell.ch, 0, y + m.baseline)
          ctx.restore()
        } else ctx.fillText(cell.ch, x + (room - w) / 2, y + m.baseline)
      }
      if (cell.ul) {
        ctx.fillStyle = color
        ctx.fillRect(x, y + m.baseline + Math.max(1.5, ch * 0.1), cell.w * cw, 1)
      }
    }
  }
  ctx.restore()
}
