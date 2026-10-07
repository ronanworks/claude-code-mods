import { test, expect, mock } from 'claude-code/testing'
import { previewScene, previewPixels, paceOf, moodOf, receiptText } from './register'
import { crabSvg } from './desktop'

const USAGE = {
  startedAt: Date.now() - 5_520_000,
  context: { tokens: 164_000, window: 200_000, percent: 82 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(Date.now() + 3 * 86400_000).toISOString() },
  ],
  cost: { usd: 3.21 },
}

// 终端里允许出现的字符: ASCII、中日韩文字、全角逗号、以及确定单宽的方块/框线字符
const SAFE = /^[\x20-\x7E\u4E00-\u9FFF，│█▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓]*$/
const CWD = 'D:\\work\\my-app'

// 模拟三种系统: 工作目录、环境变量、是不是 macOS、打不开的命令 (退出码 3)
// Windows 这里故意不给 OS 变量, 靠 C:\ 这种路径认出来
// root = 项目根目录 (不给就和 cwd 一样)
type Sys = { cwd: string; root?: string; env: Record<string, string>; mac?: boolean; broken?: string[] }
const WIN: Sys = { cwd: CWD, env: { USERPROFILE: 'C:\\Users\\me' } }
const MAC: Sys = { cwd: '/Users/me/my-app', env: { HOME: '/Users/me' }, mac: true }
const LINUX: Sys = {
  cwd: '/home/me/my-app',
  env: { HOME: '/home/me', CLAUDE_CONFIG_DIR: '/home/me/.config/claude' },
  broken: ['xdg-open'],
}
const WSL: Sys = { cwd: '/home/me/my-app', env: { HOME: '/home/me', WSL_DISTRO_NAME: 'Ubuntu-22.04' }, broken: ['wslview'] }

type Calls = { run: string[][]; cmd: string[]; dirs: string[]; toasts: string[]; opens: any[] }
// 新功能的测试用: 可变的用量 / 子代理列表 / 手动拨的时钟 (只替换 clock.now, 定时器仍是空的)
type Opts = { usage?: () => any; agents?: () => any[]; now?: () => number }

function mocks(on: any, calls: Calls, sys: Sys = WIN, opts: Opts = {}) {
  // 存储用内存里的假存储: 测试里的 /hud top 不能写进用户真实的偏好文件
  mock.store(on)
  on('clock.now', async () => ({ value: opts.now ? opts.now() : Date.now() }))
  on('clock.every', async () => ({ value: undefined }))
  on('clock.after', async () => ({ value: undefined }))
  on('ui.render', async ($: any, e: any) => $.ui.resolve(e).Text({ children: ['engine-base'] }))
  on('ui.toast', async ($: any, e: any) => {
    calls.toasts.push(String(e?.text ?? ''))
    return { value: undefined }
  })
  on('ui.open', async ($: any, e: any) => {
    calls.opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('tool.call', async () => ({ result: {}, text: 'ok' }))
  on('classic.SubagentStart', async () => ({}))
  on('classic.SubagentStop', async () => ({}))
  on('ui.log', async () => ({ value: undefined }))
  on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: opts.usage ? opts.usage() : USAGE }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', async () => ({ value: sys.cwd }))
  on('session.root', async () => ({ value: sys.root ?? sys.cwd }))
  // 测试跑在 Windows 上, 引擎可能把 /System/... 规整成本机写法, 只比结尾
  on('fs.exists', async ($: any, e: any) => ({ value: !!sys.mac && /[\\/]System[\\/]Library[\\/]CoreServices$/.test(String(e.path ?? e)) }))
  on('settings.read', async () => ({ value: { effortLevel: 'medium' } }))
  on('agent.list', async () => ({ value: opts.agents ? opts.agents() : [{ id: 'a', description: 'x', type: 'fork', status: 'running' }] }))
  on('command.register', async ($: any, e: any) => ({ value: { command: e.name } }))
  on('command.run', async ($: any, e: any) => {
    calls.cmd.push(e.command)
    return { value: {} }
  })
  on('session.id', async () => ({ value: 'abc-123' }))
  on('env.get', async ($: any, e: any) => ({ value: sys.env[String(e.name ?? e)] }))
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv ?? e
    calls.run.push(argv)
    calls.dirs.push(String(e.init?.cwd ?? ''))
    if (sys.broken?.includes(argv[0])) return { value: { exitCode: 3, stdout: '', stderr: '' } }
    const s = JSON.stringify(argv)
    if (argv[0] === 'node') {
      // 统计脚本: 与本机实测的一个会话同量级
      return { value: { exitCode: 0, stdout: JSON.stringify({ found: true, input: 1646, output: 716680, cacheRead: 332073078, cacheWrite: 12632343 }), stderr: '' } }
    }
    const stdout = s.includes('show-current') ? 'codex/research\n' : ' M a.py\n M b.py\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
}

async function start($: any, on: any, sys: Sys = WIN, opts: Opts = {}) {
  const calls: Calls = { run: [], cmd: [], dirs: [], toasts: [], opens: [] }
  mocks(on, calls, sys, opts)
  await $.session.start({ cwd: sys.cwd } as any)
  return calls
}

async function mountHint($: any, surface: 'terminal' | 'desktop', cols: number, isWorking = false) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface,
    component: 'PromptHint',
    requestId: 'hint',
    viewport: { columns: cols, rows: 40, isFullscreen: true },
    props: { isDraft: false, isWorking, hint: '? for shortcuts' },
  } as any)
}

async function mountBand($: any, cols: number, hasSurvey = false) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols, rows: 40, isFullscreen: true },
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: cols, scroll: { top: 0, bodyRows: 10, totalRows: 4 }, view: {} },
  } as any)
}

async function strings(ui: any): Promise<string[]> {
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.props.label))
  return [...texts, ...labels]
}

test('默认画在输入框下方，引擎自己的提示行保留；有档位、本周用量', async ($, on) => {
  await start($, on)
  for (const cols of [140, 118]) {
    for (const working of [false, true]) {
      const ui = await mountHint($, 'terminal', cols, working)
      const all = await strings(ui)
      for (const s of all) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      expect(all).toContain('本周')
      expect(all).toContain('5小时')
      expect(all).toContain('my-app')
      expect(all.some(t => t.includes('medium'))).toBe(true)
      expect(all).toContain('engine-base')
      expect(await ui.find({ type: 'Raster' })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('三行的每一列宽度一致（网格对齐）', async ($, on) => {
  await start($, on)
  const ui = await mountHint($, 'terminal', 118)
  const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
  const widthOf = (k: string) => boxes.find((b: any) => b.key === k)?.props.width
  for (const c of [0, 1, 2]) {
    expect(widthOf('r1c' + c)).toBeDefined()
    expect(widthOf('r2c' + c)).toBe(widthOf('r1c' + c))
    expect(widthOf('r3c' + c)).toBe(widthOf('r1c' + c))
  }
  await ui.unmount()
})

test('工作中和闲置时，每一段的位置和宽度完全相同', async ($, on) => {
  await start($, on)
  const shape = async (working: boolean) => {
    const ui = await mountHint($, 'terminal', 118, working)
    const boxes = (await ui.findAll({ type: 'Box' })).map((b: any) => [b.key, b.props.width])
    const buttons = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    await ui.unmount()
    return JSON.stringify({ boxes, buttons })
  }
  expect(await shape(true)).toBe(await shape(false))
})

test('点项目名经 cmd start 打开文件夹；双击只开一次；点本周跑 /usage', async ($, on) => {
  const calls = await start($, on)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => a[0] === 'cmd.exe')
  expect(opens.length).toBe(1)
  expect(opens[0]).toEqual(['cmd.exe', '/d', '/c', 'start', 'usage hud', CWD])
  await ui.press({ key: 'btn-wk' })
  expect(calls.cmd).toContain('usage')
  await ui.unmount()
})

test('80 列 (macOS 默认窗口) 用中等版: 完整螃蟹 + 3 行 x 2 列，右列是三根用量条', async ($, on) => {
  await start($, on)
  for (const cols of [82, 90]) {
    const ui = await mountHint($, 'terminal', cols)
    const r: any = await ui.find({ type: 'Raster' })
    expect(r?.props?.rows).toBe(3)
    const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
    const keys = boxes.map((b: any) => b.key).sort()
    expect(keys).toEqual(['r1c0', 'r1c1', 'r2c0', 'r2c1', 'r3c0', 'r3c1'])
    const w = boxes.map((b: any) => b.props.width)
    expect(new Set(w).size).toBe(1)
    const all = await strings(ui)
    for (const s of all) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    for (const want of ['模型', '项目', '状态', '上下文', '5小时', '本周', 'my-app']) expect(all.some(s => s.includes(want)) ? 'ok' : 'missing ' + want).toBe('ok')
    await ui.unmount()
  }
})

test('很窄的终端用一行精简版；桌面端不画面板，只留引擎自己的提示行', async ($, on) => {
  await start($, on)
  const t = await mountHint($, 'terminal', 62)
  const r: any = await t.find({ type: 'Raster' })
  expect(r?.props?.rows).toBe(1)
  for (const s of await strings(t)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await t.unmount()
  const d = await mountHint($, 'desktop', 140)
  expect(await d.find({ type: 'Raster' })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /%/ })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await d.unmount()
})

test('每种工具跑的时候螃蟹动画和状态文字都能画出来', async ($, on) => {
  const seen: Record<string, string> = {}
  const cases: Array<[string, string]> = [
    ['Read', '读文件'],
    ['Edit', '改文件'],
    ['Bash', '跑命令'],
    ['WebSearch', '搜网页'],
    ['Agent', '派子代理'],
    ['TodoWrite', '记待办'],
    ['mcp__zotero__search', 'zotero:search'],
    ['mcp__Claude_Browser__resize_window', 'Claude_Browser:resize_window'],
  ]
  // 每个格子 = 3 个 u32: 字符 / 前景 / 背景; 字符只能是 空格 ▀ ▄
  const okChars = new Set([32, 0x2580, 0x2584])
  const check = (b64: string, cells: number) => {
    const bin = atob(b64)
    const words = new Uint32Array(Uint8Array.from(bin, c => c.charCodeAt(0)).buffer)
    expect(words.length).toBe(cells * 3)
    for (let i = 0; i < words.length; i += 3) expect(okChars.has(words[i]) ? 'ok' : 'bad ' + words[i]).toBe('ok')
  }
  for (const [tool, label] of cases) {
    for (const opts of [{}, { pct: 85, agents: 2 }, { pct: 97 }, { working: false, agents: 3 }]) {
      const r = previewScene(tool, opts)
      expect(r.label).toContain(label)
      r.frames.forEach((b64, i) => check(b64, i % 2 === 0 ? 15 * 3 : 8 * 1))
      // 动画: 24 帧里至少有 2 种不同的画面
      expect(new Set(r.frames.filter((_, i) => i % 2 === 0)).size > 1 ? 'animated' : 'static').toBe('animated')
    }
  }
})

test('token 统计: 读会话记录 (含子代理) 得到总数和输出数；本会话标签和折合花费', async ($, on) => {
  const calls = await start($, on)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[1]).toMatch(/scripts[\\/]count-tokens\.js$/)
  expect(node?.[2]).toBe('C:\\Users\\me\\.claude\\projects\\D--work-my-app\\abc-123.jsonl')
  let text = ''
  for (let i = 0; i < 5 && !text.includes('M'); i++) {
    const ui = await mountHint($, 'terminal', 124)
    const all = await strings(ui)
    text = all.find(s => s.includes(' out ') || s.includes('统计中')) ?? all.join(' | ')
    expect(all).toContain('token')
    expect(all.some(s => s.trim() === '本会话')).toBe(true)
    expect(all.some(s => s.startsWith('$3.21'))).toBe(true)
    await ui.unmount()
  }
  // 1646 + 716680 + 332073078 + 12632343 = 345,423,747
  expect(text).toContain('345.4M')
  expect(text).toContain('out 717k')
})

test('macOS: 会话记录在 ~/.claude 下、路径用 /；点项目名用 open 打开', async ($, on) => {
  const calls = await start($, on, MAC)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[1]).toMatch(/\/scripts\/count-tokens\.js$/)
  expect(node?.[2]).toBe('/Users/me/.claude/projects/-Users-me-my-app/abc-123.jsonl')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  expect(calls.run.filter(a => a[0] === 'open')).toEqual([['open', '/Users/me/my-app']])
  expect(calls.run.some(a => a[0] === 'cmd.exe')).toBe(false)
  await ui.unmount()
})

test('Linux: 设置了 CLAUDE_CONFIG_DIR 就在它下面找会话记录；xdg-open 打不开时改用 gio open', async ($, on) => {
  const calls = await start($, on, LINUX)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[2]).toBe('/home/me/.config/claude/projects/-home-me-my-app/abc-123.jsonl')
  expect(node?.[4]).toBe('/home/me/.config/claude/projects')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => ['xdg-open', 'gio', 'wslview'].includes(a[0]))
  expect(opens).toEqual([
    ['xdg-open', '/home/me/my-app'],
    ['gio', 'open', '/home/me/my-app'],
  ])
  await ui.unmount()
})

test('Claude 在终端里 cd 进子目录后：项目名、分支、会话记录、打开的文件夹都还按项目根目录', async ($, on) => {
  const CD: Sys = { root: CWD, cwd: CWD + '\\docs\\research', env: { USERPROFILE: 'C:\\Users\\me' } }
  const calls = await start($, on, CD)
  const node = calls.run.findIndex(a => a[0] === 'node')
  expect(calls.run[node]?.[2]).toBe('C:\\Users\\me\\.claude\\projects\\D--work-my-app\\abc-123.jsonl')
  const gitDirs = calls.run.map((a, i) => (a[0] === 'git' ? calls.dirs[i] : null)).filter(d => d !== null)
  expect(gitDirs.length > 0 && gitDirs.every(d => d === CWD)).toBe(true)
  const ui = await mountHint($, 'terminal', 140)
  const all = await strings(ui)
  expect(all).toContain('my-app')
  expect(all.includes('research')).toBe(false)
  await ui.press({ key: 'btn-project' })
  expect(calls.run.filter(a => a[0] === 'cmd.exe')).toEqual([['cmd.exe', '/d', '/c', 'start', 'usage hud', CWD]])
  await ui.unmount()
})

test('WSL: 点项目名时没有 wslview 就经 wslpath 交给 Windows 的 explorer.exe', async ($, on) => {
  const calls = await start($, on, WSL)
  expect(calls.run.find(a => a[0] === 'node')?.[2]).toBe('/home/me/.claude/projects/-home-me-my-app/abc-123.jsonl')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => ['xdg-open', 'gio', 'wslview', 'sh'].includes(a[0]))
  expect(opens).toEqual([
    ['wslview', '/home/me/my-app'],
    ['sh', '-c', 'explorer.exe "$(wslpath -w "$1")"; exit 0', 'sh', '/home/me/my-app'],
  ])
  await ui.unmount()
})

async function mountDesktop($: any, cols: number, isWorking = false) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'desktop',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols, rows: 40, isFullscreen: false },
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: cols, scroll: { top: 0, bodyRows: 10, totalRows: 4 }, view: {} },
  } as any)
}

test('客户端版: 螃蟹和仪表盘两张 SVG, 无底板无边框无链接行; 内容齐全、转义正确; 螃蟹图在同一状态下不变', async ($, on) => {
  await start($, on)
  let crabFirst = ''
  for (let i = 0; i < 3; i++) {
    const ui = await mountDesktop($, 110)
    const svgs: any[] = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(2)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    const crab = svgs.find(s => String(s.props.alt).includes('螃蟹'))
    const dash = svgs.find(s => !String(s.props.alt).includes('螃蟹'))
    expect(crab?.props.isInteractive).toBeUndefined()
    // SVG 必须带明确宽高, 否则客户端可能按默认 300x150 放大
    expect([crab?.props.width, crab?.props.height]).toEqual([80, 35])
    const src = String(dash?.props.source ?? '')
    for (const want of ['my-app', 'medium', '本周', '5小时', '上下文', '$3.21', 'token', '345.4M', 'out ', '717k'])
      expect(src.includes(want) ? 'ok' : 'missing ' + want).toBe('ok')
    // 不再画底板和边框
    expect(/stroke=/.test(src) || /<rect x="0\.5" y="0\.5"/.test(src) ? 'has frame' : 'no frame').toBe('no frame')
    expect(/stroke=/.test(String(crab?.props.source)) ? 'has frame' : 'no frame').toBe('no frame')
    expect(/&(?!amp;|lt;|gt;|quot;|#39;)/.test(src)).toBe(false)
    expect(src.length).toBeLessThan(131072)
    if (i === 0) crabFirst = String(crab?.props.source)
    else expect(String(crab?.props.source)).toBe(crabFirst)
    await ui.unmount()
  }
  // 很窄的客户端窗口: 自动只放一行用量条
  const narrow = await mountDesktop($, 55)
  const nd: any = (await narrow.findAll({ type: 'Svg' })).find((s: any) => !String(s.props.alt).includes('螃蟹'))
  expect(String(nd?.props.source)).toContain('height="22"')
  await narrow.unmount()
})

test('/hud top 改到输入框上方，上面空一行；有问卷时让位', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'hud', args: 'top' } as any)
  const band = await mountBand($, 140)
  expect(await band.find({ type: 'Raster' })).toBeDefined()
  const first: any = (await band.findAll({ type: 'Text' }))[0]
  expect(first.text).toBe(' ')
  await band.unmount()
  const hint = await mountHint($, 'terminal', 140)
  expect(await hint.find({ type: 'Raster' })).toBeUndefined()
  await hint.unmount()
  const survey = await mountBand($, 140, true)
  expect(await survey.find({ type: 'Raster' })).toBeUndefined()
  await survey.unmount()
  await $.command.run({ command: 'hud', args: 'bottom' } as any)
})

// ======================== v0.12 新功能 ========================

// 收据和看板里还会出现间隔点 ·
const SAFE2 = /^[\x20-\x7E\u4E00-\u9FFF，│█▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓·]*$/
const H = 3600_000
const iso = (ms: number) => new Date(ms).toISOString()
const lim = (kind: string, percentUsed: number, resetsAt: number) => ({ kind, percentUsed, resetsAt: iso(resetsAt) })
// 终端显示宽度 (中文 2 列)
const dwT = (s: string) => [...s].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)
// 一格里所有文字 + 按钮的总宽度
async function cellWidth(ui: any, key: string): Promise<number> {
  const box: any = (await ui.findAll({ type: 'Box' })).find((b: any) => b.key === key)
  let w = 0
  for (const c of box?.children ?? []) {
    if (typeof c === 'string') w += dwT(c)
    else if (c?.type === 'Button') w += dwT(String(c.props?.label ?? ''))
    else if (c?.type === 'Text') w += dwT((c.children ?? []).filter((x: any) => typeof x === 'string').join(''))
  }
  return w
}

async function mountTurn($: any, requestId: string, durationMs: number) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'terminal',
    component: 'TurnDuration',
    requestId,
    viewport: { columns: 140, rows: 40, isFullscreen: true },
    props: { word: 'Baked', durationMs },
  } as any)
}

async function mountPane($: any, surface: 'terminal' | 'desktop', cols: number) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface,
    component: 'Pane',
    requestId: 'hud-agents',
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '子代理', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { top: 0, bodyRows: 30, totalRows: 10 }, view: {} },
  } as any)
}

test('配速: 公式、情绪档位、窗口刚开始不外推、没读数不报警', () => {
  const now = 1_800_000_000_000
  // 5小时窗口已过 1h 用了 90%: 配速 4.5, 约 6.7 分钟后用完 -> 慌张
  const a = paceOf(lim('five_hour', 90, now + 4 * H), now)!
  expect(Math.abs((a.ratio ?? 0) - 4.5) < 1e-9).toBe(true)
  expect(Math.round((a.runOutIn ?? 0) / 60000)).toBe(7)
  expect(a.willRunOut).toBe(true)
  expect(moodOf(a)).toBe('panic')
  // 已过 2h 用了 50%: 配速 1.25, 2h 后用完 (重置还要 3h) -> 冒汗
  const b = paceOf(lim('five_hour', 50, now + 3 * H), now)!
  expect(Math.abs((b.ratio ?? 0) - 1.25) < 1e-9).toBe(true)
  expect(b.runOutIn).toBe(2 * H)
  expect(moodOf(b)).toBe('sweat')
  // 已过 3h 用了 23.5%: 配速 0.39 -> 悠闲
  const c = paceOf(lim('five_hour', 23.5, now + 2 * H), now)!
  expect(c.willRunOut).toBe(false)
  expect(moodOf(c)).toBe('chill')
  // 已过 2.5h 用了 45%: 配速 0.9 -> 正常
  expect(moodOf(paceOf(lim('five_hour', 45, now + 2.5 * H), now))).toBe('normal')
  // 本周用了 96% -> 慌张; 取两个里更紧张的
  const w = paceOf(lim('seven_day', 96, now + 3 * 24 * H), now)
  expect(moodOf(c, w)).toBe('panic')
  expect(moodOf(c, b)).toBe('sweat')
  // 负路径: 窗口才过 3 分钟 (不到 2%) 用了 3% -> 不外推, 不报警
  const early = paceOf(lim('five_hour', 3, now + 5 * H - 3 * 60000), now)!
  expect(early.ratio).toBeUndefined()
  expect(early.willRunOut).toBe(false)
  expect(moodOf(early)).toBe('normal')
  // 负路径: 没有重置时间 / 没有读数 / 不认识的窗口
  expect(paceOf({ kind: 'five_hour', percentUsed: 99 }, now)?.willRunOut).toBe(false)
  expect(paceOf({ kind: 'spend_limit', percentUsed: 80, resetsAt: iso(now + H) }, now)?.willRunOut).toBe(false)
  expect(moodOf(undefined, undefined)).toBe('normal')
})

test('配速预警上面板: 会用完时 5小时 那段变成红色 "后用完"; 精简版百分比变红; 不会用完时照旧 "后重置"', async ($, on) => {
  const now = Date.now()
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 50, now + 3 * H), lim('seven_day', 12, now + 3 * 24 * H)] }
  await start($, on, WIN, { usage: () => usage })
  const full = await mountHint($, 'terminal', 140)
  const warn = (await full.findAll({ type: 'Text' })).filter((t: any) => t.text.includes('后用完'))
  expect(warn.length).toBe(1)
  expect(warn[0].props.color).toBe('#f87171')
  expect(warn[0].text).toContain('2h00m后用完')
  expect((await full.findAll({ type: 'Text' })).some((t: any) => t.text.includes('后重置'))).toBe(true) // 本周照旧
  for (const s of await strings(full)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await full.unmount()
  const narrow = await mountHint($, 'terminal', 62)
  // 只有 5小时 那个百分比是红的 (上下文 82% 不是)
  const pctTexts = (await narrow.findAll({ type: 'Text' })).filter((t: any) => /^\d+%$/.test(t.text.trim()) && t.props.color === '#f87171')
  expect(pctTexts.length).toBe(1)
  await narrow.unmount()
  // 负路径: 配速正常时没有 "后用完"
  usage = { ...USAGE }
  const ok = await mountHint($, 'terminal', 140)
  expect((await ok.findAll({ type: 'Text' })).some((t: any) => t.text.includes('后用完'))).toBe(false)
  await ok.unmount()
})

test('螃蟹情绪: 悠闲戴墨镜、冒汗有汗滴、慌张举钳加 "!"; 客户端 SVG 也画出来', () => {
  const at = (px: number[][], x: number, y: number) => px[y]?.[x]
  const chill = previewPixels('', { working: false, mood: 'chill' })
  const C = chill.colors
  expect(chill.big.every(px => at(px, 3, 1) === C.shades && at(px, 7, 1) === C.shades)).toBe(true)
  // 负路径: 正常时没有墨镜
  expect(previewPixels('', { working: false, mood: 'normal' }).big.some(px => at(px, 3, 1) === C.shades)).toBe(false)
  const sweat = previewPixels('Read', { working: true, mood: 'sweat' })
  expect(sweat.big.some(px => at(px, 1, 0) === C.sweat || at(px, 1, 1) === C.sweat)).toBe(true)
  const panicIdle = previewPixels('', { working: false, mood: 'panic' })
  expect(panicIdle.big.some(px => at(px, 13, 0) === C.alarm && at(px, 13, 3) === C.alarm)).toBe(true)
  // 举钳: 左钳竖在 x=0 的第 0-1 行
  expect(panicIdle.big.every(px => at(px, 0, 0) === C.body || at(px, 0, 1) === C.body)).toBe(true)
  const panicWork = previewPixels('Bash', { working: true, mood: 'panic' })
  expect(panicWork.big.some(px => at(px, 1, 0) === C.alarm)).toBe(true)
  // 庆祝时不画情绪标记
  expect(previewPixels('', { working: false, celebrating: true, mood: 'panic' }).big.some(px => at(px, 1, 0) === C.alarm)).toBe(false)
  const svg = (mood: any, mode: any = 'idle') => crabSvg({ mode, kind: 'think', heat: 'ok', agents: 0, mood }, 5)
  expect(svg('chill')).toContain('#09090b')
  expect(svg('normal')).not.toContain('#09090b')
  expect(svg('sweat')).toContain('#60a5fa')
  expect(svg('panic')).toContain('#ef4444')
  expect(svg('panic', 'work')).toContain('#ef4444')
})

test('每轮收据: 引擎那行原样保留, 后面追加花费/改文件/工具次数; 对不上的行不显示', async ($, on) => {
  let t = Date.now() + 600_000
  let usage: any = { ...USAGE, cost: { usd: 1 } }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  // 负路径: 这一轮开始之前就画出来的行 (更早的回合)
  const old = await mountTurn($, 'msg-old', 9000)
  await old.unmount()
  t += 1000
  await $.turn.start({ text: 'hi', turnId: 'r-1' } as any)
  await $.tool.call({ tool: 'Edit', file_path: 'D:\\work\\my-app\\a.ts', old_string: 'x', new_string: 'y\nz' } as any)
  await $.tool.call({ tool: 'Write', file_path: 'D:\\work\\my-app\\b.ts', content: '1\n2\n3\n' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\work\\my-app\\a.ts' } as any)
  usage = { ...usage, cost: { usd: 1.42 } }
  t += 9000
  await $.turn.complete({ answer: '', durationMs: 9000, isAborted: false, turnId: 'r-1', reason: 'answer' } as any)
  t += 50
  const row = await mountTurn($, 'msg-r1', 9050)
  const texts = (await row.findAll({ type: 'Text' })).map((x: any) => x.text)
  expect(texts).toContain('engine-base')
  expect(texts).toContain(' · $0.42 · 改 2 个文件 +5 -1 · 工具 3 次')
  for (const s of texts) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await row.unmount()
  // 同一行重画还是同一张收据
  const again = await mountTurn($, 'msg-r1', 9050)
  expect((await again.findAll({ type: 'Text' })).some((x: any) => x.text.includes('$0.42'))).toBe(true)
  await again.unmount()
  // 负路径: 更早的那行、以及收据已经配给别的行之后新来的行, 都不显示
  for (const id of ['msg-old', 'msg-r1-dup']) {
    const r = await mountTurn($, id, 9000)
    expect((await r.findAll({ type: 'Text' })).map((x: any) => x.text)).toEqual(['engine-base'])
    await r.unmount()
  }
  // 负路径: 时长对不上 (30s vs 9s) 的行不显示
  t += 5000
  await $.turn.start({ text: 'again', turnId: 'r-2' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\work\\my-app\\a.ts' } as any)
  t += 9000
  await $.turn.complete({ answer: '', durationMs: 9000, isAborted: false, turnId: 'r-2', reason: 'answer' } as any)
  const off = await mountTurn($, 'msg-r2-wrong', 30000)
  expect((await off.findAll({ type: 'Text' })).map((x: any) => x.text)).toEqual(['engine-base'])
  await off.unmount()
  // 没花钱、没改文件的那段省掉
  const r2 = await mountTurn($, 'msg-r2', 9000)
  expect((await r2.findAll({ type: 'Text' })).map((x: any) => x.text)).toContain(' · 工具 1 次')
  await r2.unmount()
  // 什么都没有 -> 空串 (只留引擎那行)
  expect(receiptText({ turnId: 'x', startedAt: 0, completedAt: 0, durationMs: 0, usd: 0, files: 0, add: 0, del: 0, tools: 0 })).toBe('')
})

test('一键压缩: 上下文 >=75% 时三档都有 [压缩] 按钮, 点了跑 /compact 且防连点; 格子宽度不变', async ($, on) => {
  let usage: any = { ...USAGE }
  const calls = await start($, on, WIN, { usage: () => usage })
  const widths: Record<number, number> = {}
  for (const cols of [140, 82, 62]) {
    const ui = await mountHint($, 'terminal', cols)
    const btn: any = await ui.find({ type: 'Button', key: 'btn-compact' })
    expect(btn?.props.label).toBe('压缩')
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    if (cols !== 62) widths[cols] = await cellWidth(ui, cols === 140 ? 'r2c0' : 'r1c1')
    await ui.unmount()
  }
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-compact' })
  await ui.press({ key: 'btn-compact' })
  expect(calls.cmd.filter(c => c === 'compact').length).toBe(1)
  await ui.unmount()
  // 负路径: 50% 时没有按钮, 但那一格的总宽度和有按钮时一样
  usage = { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }
  for (const cols of [140, 82]) {
    const low = await mountHint($, 'terminal', cols)
    expect(await low.find({ type: 'Button', key: 'btn-compact' })).toBeUndefined()
    expect(await cellWidth(low, cols === 140 ? 'r2c0' : 'r1c1')).toBe(widths[cols])
    await low.unmount()
  }
})

test('额度恢复提醒: 用到 >=30% 后重置时刻已过才提醒一次, 不重复; 用量从高位掉到 <5% 也算', async ($, on) => {
  let t = Date.now() + 1_200_000
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 40, t + H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const calls = await start($, on, WIN, { usage: () => usage, now: () => t })
  const end = () => $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'z', reason: 'answer' } as any)
  const restored = () => calls.toasts.filter(x => x.includes('额度已恢复')).length
  await end()
  expect(restored()).toBe(0) // 负路径: 还没到重置时刻
  t += 2 * H // 读数没变 (闲着没请求), 但重置时刻已过
  await end()
  expect(calls.toasts).toContain('5 小时额度已恢复，可以继续了')
  await end()
  expect(restored()).toBe(1) // 不重复
  // 新窗口: 先低后高, 再掉到 <5%
  usage = { ...usage, rateLimits: [lim('five_hour', 2, t + 5 * H)] }
  await end()
  expect(restored()).toBe(1) // 负路径: 低位开始的新窗口不提醒
  usage = { ...usage, rateLimits: [lim('five_hour', 35, t + 5 * H)] }
  await end()
  usage = { ...usage, rateLimits: [lim('five_hour', 3, t + 5 * H)] }
  await end()
  expect(restored()).toBe(2)
})

test('子代理看板: 点 "+1代理" 或 /hud agents 打开侧边面板; 显示描述/时长/最后工具/状态; 5 分钟没动静标红; 结束后保留', async ($, on) => {
  let t = Date.now() + 1_800_000
  let list: any[] = [{ id: 'k1', description: '查文献', type: 'Explore', status: 'running' }]
  const calls = await start($, on, WIN, { agents: () => list, now: () => t })
  await $.classic.SubagentStart({ agent_id: 'k1', agent_type: 'Explore' } as any)
  const hint = await mountHint($, 'terminal', 140)
  const btn: any = await hint.find({ type: 'Button', key: 'btn-agents' })
  expect(btn?.props.label).toBe('+1代理')
  await hint.press({ key: 'btn-agents' })
  await hint.press({ key: 'btn-agents' })
  expect(calls.opens.length).toBe(1)
  expect(calls.opens[0]).toMatchObject({ id: 'hud-agents', closeOnEscape: true })
  await hint.unmount()
  await $.command.run({ command: 'hud', args: 'agents' } as any)
  expect(calls.opens.length).toBe(2)
  expect(calls.cmd.includes('agents')).toBe(false) // 没有去跑内置的 /agents
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await mountPane($, surface, 100)
    const all = await strings(pane)
    expect(all.some(s => s.includes('查文献'))).toBe(true)
    expect(all.some(s => s.includes('运行中'))).toBe(true)
    expect(all.some(s => s.includes('可能卡住'))).toBe(false)
    for (const s of all) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    expect(await pane.find({ type: 'Button', key: 'btn-agents-close' })).toBeDefined()
    await pane.unmount()
  }
  t += 6 * 60_000 // 6 分钟没有任何工具动作
  const stuck = await mountPane($, 'terminal', 100)
  const red = (await stuck.findAll({ type: 'Text' })).find((x: any) => x.text.includes('可能卡住'))
  expect(red?.props.color).toBe('#f87171')
  await stuck.unmount()
  // 结束: 保留在 "已结束" 里, 显示用时 (窄面板两行一个)
  await $.classic.SubagentStop({ agent_id: 'k1', agent_type: 'Explore', agent_transcript_path: '', stop_hook_active: false, last_assistant_message: '找到 3 篇' } as any)
  list = [{ id: 'k1', description: '查文献', type: 'Explore', status: 'completed' }]
  const done = await mountPane($, 'terminal', 44)
  const txt = await strings(done)
  expect(txt.some(s => s.includes('已完成'))).toBe(true)
  expect(txt.some(s => s.includes('已结束'))).toBe(true)
  expect(txt.some(s => s.includes('用时 6m00s'))).toBe(true)
  expect(txt.some(s => s.includes('可能卡住'))).toBe(false)
  await done.unmount()
  // 没有子代理在跑时状态格里没有那个按钮
  list = []
  const quiet = await mountHint($, 'terminal', 140)
  expect(await quiet.find({ type: 'Button', key: 'btn-agents' })).toBeUndefined()
  await quiet.unmount()
})

test('点档位文字跑 /effort, 双击只算一次; 五格保持彩色', async ($, on) => {
  const calls = await start($, on)
  for (const cols of [140, 82]) {
    const ui = await mountHint($, 'terminal', cols)
    const b: any = await ui.find({ type: 'Button', key: 'btn-effort' })
    expect(b?.props.label).toBe('medium')
    const pip: any = (await ui.findAll({ type: 'Text' })).find((x: any) => x.text === '▁')
    expect(pip?.props.color).toBe('#60a5fa')
    await ui.unmount()
  }
  // 精简版 (有位置时) 也能点
  await $.command.run({ command: 'hud' } as any)
  const c = await mountHint($, 'terminal', 120)
  expect(((await c.find({ type: 'Button', key: 'btn-effort' })) as any)?.props.label).toBe('medium')
  expect(await c.find({ type: 'Raster' }).then((r: any) => r?.props?.rows)).toBe(1)
  await c.unmount()
  await $.command.run({ command: 'hud' } as any)
  await $.command.run({ command: 'hud' } as any)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-effort' })
  await ui.press({ key: 'btn-effort' })
  expect(calls.cmd.filter(c => c === 'effort').length).toBe(1)
  await ui.unmount()
})

test('子代理小螃蟹: 1-3 只时每一帧都画出来 (干活时也画), 带眼睛和腿, 会动; 精简版第 8 列有小点; 客户端 SVG 也画', () => {
  const tools = ['Read', 'Edit', 'Bash', 'WebSearch', 'TodoWrite', 'Agent', '']
  for (const n of [1, 2, 3]) {
    for (const tool of tools) {
      for (const working of [true, false]) {
        const r = previewPixels(tool, { working, agents: n, frames: 24 })
        const C = r.colors
        const zone = (px: number[][]) => px.flatMap(row => row.slice(12, 15))
        // 每帧: 右侧 3 列里正好 n 只眼睛, 至少 n 条腿, 没有别的道具颜色
        for (const px of r.big) {
          const z = zone(px)
          expect(z.filter(c => c === C.kidEye).length).toBe(n)
          expect(z.filter(c => c === C.kidLeg).length >= n).toBe(true)
          expect(z.every(c => c === -1 || c === C.kid || c === C.kidEye || c === C.kidLeg)).toBe(true)
        }
        // 会动: 24 帧里右侧至少 2 种画面
        expect(new Set(r.big.map(px => JSON.stringify(zone(px)))).size > 1).toBe(true)
        // 精简版: 第 7 列空着隔开, 第 8 列每帧都有点
        for (const px of r.mini) {
          expect(px[0][6] === -1 && px[1][6] === -1).toBe(true)
          expect(px[0][7] !== -1 || px[1][7] !== -1).toBe(true)
        }
      }
    }
  }
  // 负路径: 没有子代理时右侧没有小螃蟹的眼睛
  const none = previewPixels('Read', { working: true, agents: 0 })
  expect(none.big.every(px => px.flat().every(c => c !== none.colors.kidEye))).toBe(true)
  // 客户端: 干活 / 闲着 / 睡觉 / 庆祝时都画 n 只, 每只有两只眼睛和两帧腿
  for (const n of [0, 1, 2, 3]) {
    for (const mode of ['work', 'idle', 'sleep', 'celebrate'] as const) {
      const svg = crabSvg({ mode, kind: 'read', heat: 'ok', agents: n }, 5)
      expect((svg.match(/class="kid"/g) ?? []).length).toBe(n)
      // 有子代理时右侧道具 (读文件的纸) 让位
      expect(svg.includes('#d4d4d8')).toBe(n === 0 && mode === 'work')
    }
  }
})

test('新按钮 ([压缩] / +1代理 / 档位) 放进去后, 从 68 到 200 列每一格的内容都不超出格子宽度', async ($, on) => {
  await start($, on)
  for (const cols of [68, 70, 82, 90, 97, 98, 100, 118, 140, 200]) {
    for (const working of [false, true]) {
      const ui = await mountHint($, 'terminal', cols, working)
      const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
      expect(boxes.length > 0).toBe(true)
      for (const b of boxes) {
        const w = await cellWidth(ui, b.key)
        expect(w <= b.props.width ? 'ok' : `${cols} 列 ${b.key}: 内容 ${w} > 格子 ${b.props.width}`).toBe('ok')
      }
      await ui.unmount()
    }
  }
})

test('配速只比线性快一点 (1.05) 不报警; 明显偏快 (1.3) 才算会用完', async () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  // 5 小时窗口过了一半 (还剩 2.5 小时), 按线性该用 50%
  const resetsAt = new Date(now + 2.5 * 3600_000).toISOString()
  const slight = paceOf({ kind: 'five_hour', percentUsed: 52.5, resetsAt }, now)
  expect(slight?.willRunOut).toBe(false)
  expect(moodOf(slight)).toBe('normal')
  const fast = paceOf({ kind: 'five_hour', percentUsed: 65, resetsAt }, now)
  expect(fast?.willRunOut).toBe(true)
  expect(moodOf(fast)).toBe('sweat')
})
