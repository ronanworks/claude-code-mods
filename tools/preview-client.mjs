// 不开客户端, 直接看 usage-hud 客户端面板长什么样
// 用法: node tools/preview-client.mjs   (要 Node 23+, 能直接跑 .ts)
// 输出: tools/out/client.html, 用浏览器打开; 卡片底色仿客户端, 宽度算法和 register.tsx 的 buildDesktop 一致
import { mkdirSync, writeFileSync } from 'node:fs'

const { crabSvg, dashSvg } = await import(new URL('../usage-hud/hooks/desktop.ts', import.meta.url).href)
const enc = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s)

const idle = {
  model: 'Opus 5.5',
  effort: 'medium',
  project: 'my-app',
  branch: '',
  session: '1h19m',
  cost: '$64.93',
  ctx: { pct: 34, extra: '340k / 1.0M' },
  five: { pct: 34, extra: '1h52m 后重置' },
  week: { pct: 48, extra: '1d18h 后重置' },
  status: { text: '✓ 待命', tone: 'idle' },
  tools: '',
  tokenTotal: '0',
  tokenOutput: '0',
}
const busy = {
  ...idle,
  project: 'my-app',
  branch: 'main *2',
  status: { text: '读文件  +1 个子代理', tone: 'work' },
  tools: 'Bash 78  WebFetch 43  Read 34',
  tokenTotal: '345.4M',
  tokenOutput: '717k',
}

function card(cols, data, crabState) {
  const crabW = 80
  const est = Math.round(cols * 7.35) - crabW - 15
  const dashW = Math.max(340, Math.min(1040, Math.round(est * 1.05) + 20))
  const compact = est < 380
  const crab = crabSvg(crabState, compact ? 3 : 5)
  const cw = compact ? 48 : 80
  const ch = compact ? 21 : 35
  const contentW = Math.round(cols * 7.35)
  return `<div style="width:${contentW}px;background:#2b2b2b;border-radius:14px;padding:16px 18px;margin:10px 0">
  <div style="display:flex;align-items:center;gap:15px">
    <div style="flex:0 0 auto"><img src="${enc(crab)}" width="${cw}" height="${ch}" style="display:block"></div>
    <div style="flex:1 1 auto;min-width:0;overflow:hidden"><img src="${enc(dashSvg(data, { compact, width: dashW }))}" style="max-width:100%;display:block"></div>
  </div></div>
  <div style="width:${contentW}px;border:1px solid #444;border-radius:12px;padding:10px 14px;color:#777;margin-bottom:22px;font:14px Segoe UI,Microsoft YaHei UI">(输入框)</div>`
}

const html = `<!doctype html><html style="color-scheme:dark"><meta charset="utf-8"><title>usage-hud 客户端预览</title>
<body style="margin:0;padding:14px;background:#1f1f1e;color:#bbb;font:13px Segoe UI,Microsoft YaHei UI">
<div>窄窗口 (81 格 ≈ 596px) — 闲置</div>${card(81, idle, { mode: 'idle', kind: 'think', heat: 'ok', agents: 0 })}
<div>宽窗口 (120 格 ≈ 880px) — 工作中</div>${card(120, busy, { mode: 'work', kind: 'read', heat: 'ok', agents: 1 })}
<div>很窄 (55 格) — 自动只放一行</div>${card(55, idle, { mode: 'idle', kind: 'think', heat: 'ok', agents: 0 })}
</body></html>`
const out = new URL('./out/', import.meta.url)
mkdirSync(out, { recursive: true })
writeFileSync(new URL('client.html', out), html)
console.log('已生成 ' + new URL('client.html', out).pathname)
