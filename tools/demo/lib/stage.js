// 舞台: 渐变背景、Windows Terminal 风格窗口、鼠标指针、点击涟漪、步骤标题、缓动函数
// 所有画面由 renderFrame(t) 按时间直接算出来 (不靠 CSS 过渡), 同一个 t 永远画出同一帧
import { metrics } from './cells.js'

export const clamp01 = x => Math.max(0, Math.min(1, x))
export const seg = (t, a, b) => clamp01((t - a) / (b - a))
export const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
export const easeOut = x => 1 - Math.pow(1 - x, 3)
export const easeOutBack = x => {
  const c1 = 1.5
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
export const lerp = (a, b, k) => a + (b - a) * k

const CSS = `
  html, body { margin: 0; padding: 0; }
  body { position: relative; overflow: hidden; font-family: "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; }
  .bg { position: absolute; inset: 0;
    background:
      radial-gradient(760px 420px at 8% 108%, rgba(215,119,87,0.34), transparent 70%),
      radial-gradient(720px 420px at 96% -8%, rgba(139,92,246,0.30), transparent 70%),
      radial-gradient(600px 300px at 55% 50%, rgba(255,255,255,0.025), transparent 70%),
      linear-gradient(155deg, #17131f 0%, #0c0b11 52%, #140f0e 100%); }
  .dots { position: absolute; inset: 0; opacity: 0.55;
    background-image: radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.2px); background-size: 22px 22px; }
  .win { position: absolute; border-radius: 12px; overflow: hidden; background: #0c0c0c;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.10), 0 28px 70px rgba(0,0,0,0.62), 0 10px 26px rgba(0,0,0,0.45); }
  .tabbar { height: 38px; background: #1f1f1f; display: flex; align-items: flex-end; padding-left: 10px; box-sizing: border-box; position: relative; }
  .tab { height: 31px; background: #0c0c0c; border-radius: 8px 8px 0 0; padding: 0 12px 0 12px; display: flex; align-items: center; gap: 9px;
    color: #ececec; font-size: 12.5px; min-width: 210px; box-sizing: border-box; }
  .tab .x { margin-left: auto; color: #9a9a9a; font-size: 11px; }
  .tabplus { color: #bdbdbd; font-size: 17px; margin: 0 0 6px 12px; line-height: 1; }
  .tabdown { color: #bdbdbd; font-size: 11px; margin: 0 0 9px 10px; line-height: 1; }
  .ctl { position: absolute; right: 0; top: 0; height: 38px; display: flex; }
  .ctl div { width: 46px; height: 38px; display: flex; align-items: center; justify-content: center; }
  .termbody { padding: 9px 12px 11px 12px; background: #0c0c0c; }
  .termbody canvas { display: block; }
  .icon { width: 16px; height: 16px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font: 700 9px "Cascadia Mono", monospace; }
  .pointer { position: absolute; left: 0; top: 0; width: 22px; height: 30px; pointer-events: none; z-index: 50; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.55)); }
  .ripple { position: absolute; left: 0; top: 0; border-radius: 50%; pointer-events: none; z-index: 49; box-sizing: border-box; }
  .caption { position: absolute; color: #f4f4f5; display: flex; align-items: baseline; gap: 12px; white-space: nowrap; }
  .caption b { font-size: 19px; font-weight: 700; letter-spacing: 0.2px; }
  .caption span { font-size: 13.5px; color: #a1a1aa; }
`

export function makeStage(W, H) {
  document.body.style.width = W + 'px'
  document.body.style.height = H + 'px'
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  document.body.insertAdjacentHTML('afterbegin', '<div class="bg"></div><div class="dots"></div>')
}

const CTL_SVG = `
  <div><svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="#d0d0d0"/></svg></div>
  <div><svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="#d0d0d0"/></svg></div>
  <div><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="#d0d0d0" stroke-width="1"/></svg></div>`

// Windows Terminal 风格的窗口: 标签页 + 窗口按钮 + 字符画布
export function termWindow({ x, y, cols, rows, cw, ch, size, title, iconBg = '#2b2b2b', iconFg = '#e6e6e6', iconText = '>_', z = 1 }) {
  const el = document.createElement('div')
  el.className = 'win'
  el.style.left = x + 'px'
  el.style.top = y + 'px'
  el.style.zIndex = z
  el.innerHTML = `<div class="tabbar"><div class="tab"><div class="icon" style="background:${iconBg};color:${iconFg}">${iconText}</div><span class="title"></span><span class="x">✕</span></div><div class="tabplus">+</div><div class="tabdown">⌄</div><div class="ctl">${CTL_SVG}</div></div><div class="termbody"><canvas></canvas></div>`
  el.querySelector('.title').textContent = title
  document.body.appendChild(el)
  const cv = el.querySelector('canvas')
  const w = cols * cw
  const h = rows * ch
  cv.style.width = w + 'px'
  cv.style.height = h + 'px'
  el.style.width = w + 24 + 'px'
  const api = {
    el,
    canvas: cv,
    cols,
    rows,
    cw,
    ch,
    width: w + 24,
    height: 38 + 9 + h + 11,
    // 画布左上角在页面里的位置 (窗口不变形时)
    originX: x + 12,
    originY: y + 38 + 9,
    setTitle(s) {
      el.querySelector('.title').textContent = s
    },
    // 开始画一帧: 清成终端底色, 返回 ctx 和字体度量
    begin(bg = '#0c0c0c') {
      const dpr = window.devicePixelRatio || 1
      if (cv.width !== w * dpr) {
        cv.width = w * dpr
        cv.height = h * dpr
      }
      const ctx = cv.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      return { ctx, m: metrics(ctx, cw, ch, size) }
    },
  }
  return api
}

// 鼠标指针 (箭头) 和点击涟漪
export function makePointer() {
  const p = document.createElement('div')
  p.className = 'pointer'
  p.innerHTML = `<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 23 L7.2 18.3 L10.6 26.4 L14.2 24.9 L10.8 17 L17.6 17 Z" fill="#ffffff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`
  document.body.appendChild(p)
  const r = document.createElement('div')
  r.className = 'ripple'
  document.body.appendChild(r)
  return {
    // (x, y) = 箭头尖端; down = 按下时略缩小
    set(x, y, visible = true, down = false, alpha = 1) {
      p.style.display = visible && alpha > 0 ? 'block' : 'none'
      p.style.opacity = alpha
      p.style.transform = `translate(${x - 2}px, ${y - 2}px) scale(${down ? 0.9 : 1})`
      p.style.transformOrigin = '2px 2px'
    },
    // k: 0..1 涟漪进度; null = 不显示
    ripple(x, y, k, color = '255,255,255') {
      if (k === null || k <= 0 || k >= 1) {
        r.style.display = 'none'
        return
      }
      const e = easeOut(k)
      const rad = 6 + 26 * e
      r.style.display = 'block'
      r.style.width = r.style.height = rad * 2 + 'px'
      r.style.transform = `translate(${x - rad}px, ${y - rad}px)`
      r.style.border = `2px solid rgba(${color},${0.85 * (1 - e)})`
      r.style.background = `rgba(${color},${0.22 * (1 - e)})`
    },
  }
}

// 叠在某个元素上的一块画布 (看板、对照层等): begin(bg) 清屏后返回 ctx; bg 省略 = 透明
export function canvasLayer(parent, left, top, w, h, z = 5) {
  const cv = document.createElement('canvas')
  cv.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;z-index:${z};`
  parent.appendChild(cv)
  return {
    canvas: cv,
    begin(bg) {
      const dpr = window.devicePixelRatio || 1
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      const ctx = cv.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (bg) {
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
      }
      return ctx
    },
  }
}

// 终端右上角的提示条 (toast); 样子是示意: 引擎在终端里怎么画 toast 没有公开
export function makeToast(parent, right, top) {
  const el = document.createElement('div')
  el.style.cssText = `position:absolute;right:${right}px;top:${top}px;z-index:40;display:none;align-items:center;gap:9px;padding:7px 13px 7px 11px;border-radius:8px;
    background:#1d1d1f;border:1px solid #4a4a4f;box-shadow:0 8px 22px rgba(0,0,0,0.5);font:13px "Cascadia Mono","Microsoft YaHei",monospace;color:#e4e4e7;white-space:nowrap;`
  el.innerHTML = '<span style="width:3px;align-self:stretch;border-radius:2px;background:#d97757"></span><span class="tx"></span>'
  parent.appendChild(el)
  return {
    // k: 0..1 进场进度, 1 = 完全显示; null = 隐藏
    set(text, k) {
      if (k === null || k <= 0) {
        el.style.display = 'none'
        return
      }
      el.style.display = 'flex'
      el.querySelector('.tx').textContent = text
      el.style.opacity = Math.min(1, k)
      el.style.transform = `translateY(${(1 - Math.min(1, k)) * -8}px)`
    },
  }
}
// 一段时间里显示的 toast 的进场/退场进度 (0..1)
export function toastK(t, at, hold = 1.6) {
  if (t < at || t > at + hold + 0.25) return null
  return Math.min(easeOut(seg(t, at, at + 0.2)), 1 - easeOut(seg(t, at + hold, at + hold + 0.25)))
}

// 指针路径: keys = [[t, x, y], ...], 两点之间缓动
export function pathAt(keys, t) {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]]
  for (let i = 1; i < keys.length; i++) {
    const [t1, x1, y1] = keys[i]
    const [t0, x0, y0] = keys[i - 1]
    if (t <= t1) {
      const k = easeInOut(seg(t, t0, t1))
      return [lerp(x0, x1, k), lerp(y0, y1, k)]
    }
  }
  const last = keys[keys.length - 1]
  return [last[1], last[2]]
}

// 打字: 从 t0 开始每 dt 秒打一个字
export function typed(s, t, t0, dt) {
  const chars = [...s]
  const n = Math.max(0, Math.min(chars.length, Math.floor((t - t0) / dt) + 1))
  return t < t0 ? '' : chars.slice(0, n).join('')
}
