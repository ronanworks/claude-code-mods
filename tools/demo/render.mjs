// 把 scenes/<名字>.html 逐帧渲染成 PNG, 再用 ffmpeg 合成 GIF 放进 assets/
// 用法: node tools/demo/render.mjs [usage-hud|html-shelf|quickstart|client|smoke ...]   (不写名字 = 全部)
//   --frames-only  只出帧不合成;  --gif-only  只用已有的帧重新合成
// 依赖: Node 23+ (自带 WebSocket / stripTypeScriptTypes), Chrome 或 Edge, ffmpeg
//   浏览器: 环境变量 CHROME_PATH, 否则在常见安装位置里找; ffmpeg: 环境变量 FFMPEG_PATH, 否则 PATH / 常见位置
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname, resolve, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const OUT = join(HERE, 'out')
const ASSETS = join(REPO, 'assets')
const ALL = ['usage-hud', 'html-shelf', 'quickstart', 'client']

const argv = process.argv.slice(2)
const flags = new Set(argv.filter(a => a.startsWith('--')))
const names = argv.filter(a => !a.startsWith('--'))
const scenes = names.length ? names : ALL

// ---------------- 找程序 ----------------
function which(cmd) {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split(/\r?\n/).find(l => l.trim() && existsSync(l.trim()))?.trim()
  } catch {
    return undefined
  }
}
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  const bases = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const rel = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ]
  for (const b of bases) for (const r of rel) if (existsSync(join(b, ...r))) return join(b, ...r)
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'])
    if (existsSync(p)) return p
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const w = which(c)
    if (w) return w
  }
  throw new Error('找不到 Chrome / Edge, 请设置环境变量 CHROME_PATH')
}
function findFfmpeg(tool = 'ffmpeg') {
  const envKey = tool === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
  if (process.env[envKey] && existsSync(process.env[envKey])) return process.env[envKey]
  if (tool === 'ffprobe' && process.env.FFMPEG_PATH) {
    const p = join(dirname(process.env.FFMPEG_PATH), 'ffprobe' + extname(process.env.FFMPEG_PATH))
    if (existsSync(p)) return p
  }
  const w = which(tool)
  if (w) return w
  const exe = process.platform === 'win32' ? tool + '.exe' : tool
  for (const b of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean)) {
    const p = join(b, 'ffmpeg', 'bin', exe)
    if (existsSync(p)) return p
  }
  throw new Error('找不到 ' + tool + ', 请设置环境变量 ' + envKey)
}

// ---------------- 本地静态服务 (只读) ----------------
// /vendor/desktop.js = usage-hud/hooks/desktop.ts 去掉类型标注后的原样代码 (客户端面板用真代码画)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    try {
      if (url.pathname === '/vendor/desktop.js') {
        const ts = readFileSync(join(REPO, 'usage-hud', 'hooks', 'desktop.ts'), 'utf8')
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' })
        res.end(stripTypeScriptTypes(ts))
        return
      }
      const file = normalize(join(HERE, decodeURIComponent(url.pathname)))
      if (!file.startsWith(HERE + sep) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(readFileSync(file))
    } catch (err) {
      res.writeHead(500)
      res.end(String(err))
    }
  })
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)))
}

// ---------------- Chrome DevTools Protocol ----------------
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.seq = 0
    this.pending = new Map()
    this.ws.onmessage = ev => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
      if (m.id && this.pending.has(m.id)) {
        const { ok, fail } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? fail(new Error(m.error.message + ' ' + (m.error.data ?? ''))) : ok(m.result)
      }
    }
    this.open = new Promise((ok, fail) => {
      this.ws.onopen = ok
      this.ws.onerror = fail
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }))
  }
}

async function launchChrome() {
  const profile = join(OUT, 'chrome-profile')
  rmSync(join(profile, 'DevToolsActivePort'), { force: true })
  mkdirSync(profile, { recursive: true })
  const proc = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-color-profile=srgb',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await new Promise(r => setTimeout(r, 100))
  let lines = []
  for (let i = 0; i < 50; i++) {
    lines = readFileSync(portFile, 'utf8').split(/\r?\n/)
    if (lines[1]) break
    await new Promise(r => setTimeout(r, 100))
  }
  const cdp = new CDP(`ws://127.0.0.1:${lines[0]}${lines[1]}`)
  await cdp.open
  return { proc, cdp }
}

async function evaluate(cdp, sid, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid)
  if (r.exceptionDetails) throw new Error('页面报错: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  return r.result.value
}

async function renderFrames(cdp, base, name) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Page.enable', {}, sid)
  await cdp.send('Runtime.enable', {}, sid)
  // 先按 2 倍像素密度打开页面 (页面声明自己的尺寸后再按尺寸设视口)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false }, sid)
  await cdp.send('Page.navigate', { url: `${base}/scenes/${name}.html` }, sid)
  let meta
  for (let i = 0; i < 100; i++) {
    meta = await evaluate(cdp, sid, `window.demo && window.demo.ready ? window.demo.ready.then(() => ({ width: demo.width, height: demo.height, fps: demo.fps, duration: demo.duration, gif: demo.gif || {}, check: demo.check || [] })) : null`).catch(() => null)
    if (meta) break
    await new Promise(r => setTimeout(r, 100))
  }
  if (!meta) throw new Error(name + ': 页面没有准备好 (window.demo.ready)')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: meta.width, height: meta.height, deviceScaleFactor: 2, mobile: false }, sid)
  const dir = join(OUT, 'frames', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const n = Math.round(meta.duration * meta.fps)
  const t0 = Date.now()
  for (let i = 0; i < n; i++) {
    const t = i / meta.fps
    await evaluate(cdp, sid, `Promise.resolve(demo.renderFrame(${t})).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sid)
    writeFileSync(join(dir, 'f_' + String(i).padStart(5, '0') + '.png'), Buffer.from(shot.data, 'base64'))
    if (i % 30 === 0) process.stdout.write(`  ${name}: ${i}/${n} 帧\r`)
  }
  console.log(`  ${name}: ${n} 帧, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await cdp.send('Target.closeTarget', { targetId })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  return meta
}

function makeGif(name) {
  const dir = join(OUT, 'frames', name)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
  const g = { colors: 256, dither: 'bayer:bayer_scale=4', stats: 'full', ...meta.gif }
  mkdirSync(ASSETS, { recursive: true })
  // 名字以 _ 开头的是试验场景, GIF 留在 out/ 里, 不进 assets/
  const out = name.startsWith('_') ? join(OUT, name + '.gif') : join(ASSETS, name + '.gif')
  const vf =
    `scale=${meta.width}:${meta.height}:flags=area,split[a][b];` +
    `[a]palettegen=max_colors=${g.colors}:stats_mode=${g.stats}[p];` +
    `[b][p]paletteuse=dither=${g.dither}:diff_mode=rectangle`
  execFileSync(findFfmpeg(), ['-y', '-v', 'error', '-framerate', String(meta.fps), '-i', join(dir, 'f_%05d.png'), '-vf', vf, '-loop', '0', out], { stdio: 'inherit' })
  return out
}

// 从 GIF 里抽几帧成 PNG 放 out/check/, 用来肉眼抽查 (场景用 demo.check = [秒, ...] 指定, 不写就均匀取 4 帧)
function extractCheck(name, gif) {
  const meta = JSON.parse(readFileSync(join(OUT, 'frames', name, 'meta.json'), 'utf8'))
  const n = Math.round(meta.duration * meta.fps)
  const idx = (meta.check?.length ? meta.check.map(t => Math.round(t * meta.fps)) : [0.15, 0.4, 0.65, 0.9].map(k => Math.round(k * n))).map(i => Math.min(n - 1, Math.max(0, i)))
  const dir = join(OUT, 'check')
  mkdirSync(dir, { recursive: true })
  const files = []
  for (const i of idx) {
    const f = join(dir, `${name}_f${String(i).padStart(3, '0')}.png`)
    execFileSync(findFfmpeg(), ['-y', '-v', 'error', '-i', gif, '-vf', `select=eq(n\\,${i})`, '-vsync', '0', '-frames:v', '1', f])
    files.push(f.slice(REPO.length + 1).replace(/\\/g, '/'))
  }
  return files
}

function probe(file) {
  const j = JSON.parse(
    execFileSync(findFfmpeg('ffprobe'), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate:format=duration,size', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  )
  const s = j.streams[0]
  return { file: file.slice(REPO.length + 1).replace(/\\/g, '/'), width: s.width, height: s.height, frames: Number(s.nb_read_frames), fps: s.r_frame_rate, duration_s: Number(j.format.duration), bytes: Number(j.format.size), MB: +(Number(j.format.size) / 1048576).toFixed(2) }
}

// ---------------- 主流程 ----------------
mkdirSync(OUT, { recursive: true })
if (!flags.has('--gif-only')) {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  const { proc, cdp } = await launchChrome()
  try {
    for (const name of scenes) await renderFrames(cdp, base, name)
  } finally {
    try {
      await cdp.send('Browser.close')
    } catch {}
    proc.kill()
    server.close()
  }
}
if (!flags.has('--frames-only')) {
  const manifestFile = join(OUT, 'manifest.json')
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {}
  for (const name of scenes) {
    const gif = makeGif(name)
    manifest[name] = { ...probe(gif), check: extractCheck(name, gif), rendered: new Date().toISOString() }
    console.log(`  ${name}.gif  ${manifest[name].width}x${manifest[name].height}  ${manifest[name].frames} 帧  ${manifest[name].duration_s}s  ${manifest[name].MB} MB`)
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2))
}
