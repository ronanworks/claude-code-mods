import { test, expect, mock } from 'claude-code/testing'
import { previewScene, previewPixels, previewLane, laneTip, paceOf, moodOf, receiptText } from './register'
import { crabSvg, dashSvg } from './desktop'

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

type Calls = { run: string[][]; cmd: string[]; dirs: string[]; toasts: string[]; opens: any[]; clock?: any }
// 新功能的测试用: 可变的用量 / 子代理列表 / 手动拨的时钟 (只替换 clock.now, 定时器仍是空的)
// mockClock: 用 mock.clock(on) 从这个时刻起的内存时钟代替下面三个假时钟 (定时器会真的走, 测试拨 calls.clock)
type Opts = { usage?: () => any; agents?: () => any[]; now?: () => number; mockClock?: number }

function mocks(on: any, calls: Calls, sys: Sys = WIN, opts: Opts = {}) {
  // 存储用内存里的假存储: 测试里的 /hud top 不能写进用户真实的偏好文件
  mock.store(on)
  if (opts.mockClock !== undefined) calls.clock = mock.clock(on, { now: opts.mockClock })
  else {
    on('clock.now', async () => ({ value: opts.now ? opts.now() : Date.now() }))
    on('clock.every', async () => ({ value: undefined }))
    on('clock.after', async () => ({ value: undefined }))
  }
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
  on('classic.PermissionRequest', async () => ({}))
  on('classic.Notification', async () => ({}))
  on('session.compact', async () => ({ messages: [{ role: 'user', text: '(summary)', toolUses: [] }] }))
  on('prompt.edit', async ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
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

test('/hud top 改到输入框上方: 上面是螃蟹散步道 (关掉散步道时照旧空一行)；有问卷时让位', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'hud', args: 'top' } as any)
  const band = await mountBand($, 140)
  // 散步道 (140 宽 x 3 行) 在面板的螃蟹 (15 宽 x 3 行) 上面, 原来那行空行不要了 (悬停里藏着的打招呼螃蟹不算)
  const rasters: any[] = (await band.findAll({ type: 'Raster' })).filter((r: any) => r.key !== 'crab-lane-hi')
  expect(rasters.map(r => [r.props.columns, r.props.rows])).toEqual([
    [140, 3],
    [15, 3],
  ])
  await band.unmount()
  // /hud crab 关掉散步道: 照旧在面板上面空一行
  await $.command.run({ command: 'hud', args: 'crab off' } as any)
  const plain = await mountBand($, 140)
  expect(((await plain.findAll({ type: 'Text' }))[0] as any).text).toBe(' ')
  expect((await plain.findAll({ type: 'Raster' })).length).toBe(1)
  await plain.unmount()
  await $.command.run({ command: 'hud', args: 'crab on' } as any)
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
  // 本周窗口满 1 天才算配速: 才过 7h 用了 6% (按速度外推 4 天多用完) -> 不外推, 不报警; 23h 用了 30% 也不算
  const wk7h = paceOf(lim('seven_day', 6, now + 7 * 24 * H - 7 * H), now)!
  expect(wk7h.ratio).toBeUndefined()
  expect(wk7h.willRunOut).toBe(false)
  expect(moodOf(wk7h)).toBe('normal')
  expect(paceOf(lim('seven_day', 30, now + 7 * 24 * H - 23 * H), now)!.willRunOut).toBe(false)
  // 过了 25h 用了 30%: 配速 2.0, 约 58h 后用完 (重置还要 143h) -> 报警, 冒汗
  const wk25h = paceOf(lim('seven_day', 30, now + 7 * 24 * H - 25 * H), now)!
  expect(wk25h.willRunOut).toBe(true)
  expect(moodOf(wk25h)).toBe('sweat')
  // 已过比例 (时间刻度用): 1h/5h = 0.2; 3 天/7 天; 窗口刚开始不外推也照样有 (0.01); 用量不到 1% 也有
  expect(Math.abs((a.elapsedFrac ?? -1) - 0.2) < 1e-9).toBe(true)
  expect(Math.abs((w?.elapsedFrac ?? -1) - 4 / 7) < 1e-9).toBe(true)
  expect(Math.abs((early.elapsedFrac ?? -1) - 0.01) < 1e-9).toBe(true)
  expect(Math.abs((paceOf(lim('five_hour', 0, now + 4 * H), now)?.elapsedFrac ?? -1) - 0.2) < 1e-9).toBe(true)
  // 重置时刻已过 -> 1; 重置时间比窗口还远 (时钟不准) -> 夹到 0
  expect(paceOf(lim('five_hour', 40, now - H), now)?.elapsedFrac).toBe(1)
  expect(paceOf(lim('five_hour', 40, now + 6 * H), now)?.elapsedFrac).toBe(0)
  // 负路径: 没有重置时间 / 没有读数 / 不认识的窗口
  expect(paceOf({ kind: 'five_hour', percentUsed: 99 }, now)?.willRunOut).toBe(false)
  expect(paceOf({ kind: 'five_hour', percentUsed: 99 }, now)?.elapsedFrac).toBeUndefined()
  expect(paceOf({ kind: 'spend_limit', percentUsed: 80, resetsAt: iso(now + H) }, now)?.willRunOut).toBe(false)
  expect(paceOf({ kind: 'spend_limit', percentUsed: 80, resetsAt: iso(now + H) }, now)?.elapsedFrac).toBeUndefined()
  expect(moodOf(undefined, undefined)).toBe('normal')
})

test('配速预警上面板: 会用完时 5小时 的百分比变红, 写红色 "30m用完" (放不下换 "2h用完", 再放不下照常写暗色重置倒计时); 红色的时间一定带 "用完"; 没有 "后重置"', async ($, on) => {
  const t = Date.now()
  // 5小时: 已过 2h 用了 80% -> 30 分钟后用完 ("30m用完" 正好 7 列); 本周: 已过 4 天用了 12% -> 不报警, 3 天后重置
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const noOld = async (ui: any) => {
    for (const x of await ui.findAll({ type: 'Text' })) {
      expect(/后重置|后用完|约/.test(x.text) ? 'old text: ' + x.text : 'ok').toBe('ok')
      // 只有一个时间的红字会被看成重置倒计时: 红色的时间必须带 "用完"
      if (x.props.color === '#f87171' && /\d+[mhd]/.test(x.text)) expect(x.text.includes('用完') ? 'ok' : 'bare red time: ' + x.text).toBe('ok')
    }
  }
  // 完整版 (140 列, 附加 7 列) 和中等版 (90 列, 附加 11 列): "30m用完"
  for (const cols of [140, 90]) {
    const ui = await mountHint($, 'terminal', cols)
    const h5 = await meterOf(ui, 'h5')
    expect(h5.extra?.text).toBe('30m用完')
    expect(h5.extra?.color).toBe('#f87171')
    expect(h5.extra?.bold).toBe(true)
    expect(h5.pct?.color).toBe('#f87171')
    expect(h5.pct?.bold).toBe(true)
    // 本周照旧: 暗色倒计时, 百分比不是红的
    const wk = await meterOf(ui, 'wk')
    expect(wk.extra?.text).toBe('3d0h')
    expect(wk.extra?.color).toBe('#71717a')
    expect(wk.pct?.color === '#f87171').toBe(false)
    // 只有 5小时 那段写了 "用完"
    expect((await ui.findAll({ type: 'Text' })).filter((x: any) => x.text.includes('用完')).length).toBe(1)
    await noOld(ui)
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    await ui.unmount()
  }
  // 中等版窄的时候 (82 列, 附加 5 列) 连 "30m用完" 也放不下: 照常写暗色的重置倒计时 (3h00m), 只有百分比红
  const mid = await mountHint($, 'terminal', 82)
  const m5 = await meterOf(mid, 'h5')
  expect(m5.extra?.text).toBe('3h00m')
  expect(m5.extra?.color).toBe('#71717a')
  expect(m5.pct?.color).toBe('#f87171')
  await noOld(mid)
  await mid.unmount()
  // 精简版: 只有 5小时 那个百分比是红的 (上下文 82% 不是)
  const narrow = await mountHint($, 'terminal', 62)
  const pctTexts = (await narrow.findAll({ type: 'Text' })).filter((x: any) => /^\d+%$/.test(x.text.trim()) && x.props.color === '#f87171')
  expect(pctTexts.length).toBe(1)
  await narrow.unmount()
  // 用完还早 (2 小时后): 完整版 7 列放不下 "2h00m用完" -> 换粗一点的红色 "2h用完"; 中等版 11 列放得下
  usage = { ...USAGE, rateLimits: [lim('five_hour', 50, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const late = await mountHint($, 'terminal', 140)
  const l5 = await meterOf(late, 'h5')
  expect(l5.extra?.text).toBe('2h用完')
  expect(l5.extra?.color).toBe('#f87171')
  await noOld(late)
  await late.unmount()
  // 本周会用完 (过了 30h 用了 25%, 3 天多后用完): 完整版写红色 "3d用完", 不写光秃秃的 "3d18h"
  usage = { ...USAGE, rateLimits: [lim('five_hour', 10, t + 4 * H), lim('seven_day', 25, t + 7 * 24 * H - 30 * H)] }
  const wkWarn = await mountHint($, 'terminal', 140)
  const ww = await meterOf(wkWarn, 'wk')
  expect(ww.extra?.text).toBe('3d用完')
  expect(ww.extra?.color).toBe('#f87171')
  expect(ww.pct?.color).toBe('#f87171')
  await noOld(wkWarn)
  await wkWarn.unmount()
  // 负路径 (用户截图那种): 本周才过 7h 用了 6% -> 不满 1 天不预警: 暗色重置倒计时 "6d17h", 百分比不红
  usage = { ...USAGE, rateLimits: [lim('five_hour', 10, t + 4 * H), lim('seven_day', 6, t + 7 * 24 * H - 7 * H)] }
  const wkEarly = await mountHint($, 'terminal', 140)
  const we = await meterOf(wkEarly, 'wk')
  expect(we.extra?.text).toBe('6d17h')
  expect(we.extra?.color).toBe('#71717a')
  expect(we.pct?.color === '#f87171').toBe(false)
  await wkEarly.unmount()
  usage = { ...USAGE, rateLimits: [lim('five_hour', 50, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const late90 = await mountHint($, 'terminal', 90)
  expect((await meterOf(late90, 'h5')).extra?.text).toBe('2h00m用完')
  await late90.unmount()
  // 负路径: 配速正常时没有 "用完", 百分比不红, 文字只是暗色的重置倒计时
  usage = { ...USAGE, rateLimits: [lim('five_hour', 23.5, t + 2 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  for (const cols of [140, 90, 62]) {
    const ok = await mountHint($, 'terminal', cols)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => x.text.includes('用完'))).toBe(false)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => /^\d+%$/.test(x.text.trim()) && x.props.color === '#f87171')).toBe(false)
    if (cols !== 62) {
      const o5 = await meterOf(ok, 'h5')
      expect(o5.extra?.text).toBe('2h00m')
      expect(o5.extra?.color).toBe('#71717a')
    }
    await noOld(ok)
    await ok.unmount()
  }
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
    // 只留引擎自己的 x 和 Esc, 不再画我们自己的 "关闭"
    expect(await pane.find({ type: 'Button', key: 'btn-agents-close' })).toBeUndefined()
    expect((await pane.findAll({ type: 'Button' })).length).toBe(0)
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

test('终端面板不再画子代理小螃蟹 (0.14 起搬到散步道); 客户端 SVG 仍画 n 只', () => {
  const tools = ['Read', 'Edit', 'Bash', 'WebSearch', 'TodoWrite', 'Agent', '']
  for (const tool of tools) {
    for (const working of [true, false]) {
      const none = previewPixels(tool, { working, agents: 0, frames: 24 })
      for (const n of [1, 2, 3]) {
        const r = previewPixels(tool, { working, agents: n, frames: 24 })
        const C = r.colors
        // 大面板和精简版里都没有小螃蟹的颜色, 画面和没有子代理时逐帧相同
        for (const px of [...r.big, ...r.mini]) expect(px.flat().some(c => c === C.kid || c === C.kidLeg || c === C.kidEye)).toBe(false)
        expect(JSON.stringify(r.big)).toBe(JSON.stringify(none.big))
        expect(JSON.stringify(r.mini)).toBe(JSON.stringify(none.mini))
      }
    }
  }
  // 客户端 (不动): 干活 / 闲着 / 睡觉 / 庆祝时都画 n 只
  for (const n of [0, 1, 2, 3]) {
    for (const mode of ['work', 'idle', 'sleep', 'celebrate'] as const) {
      const svg = crabSvg({ mode, kind: 'read', heat: 'ok', agents: n }, 5)
      expect((svg.match(/class="kid"/g) ?? []).length).toBe(n)
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

// ======================== v0.13: 时间刻度 / 宽度 ========================

// 一根用量条所在的那一格 (三档都按开头的标签按钮找: 上下文 btn-ctx / 精简版压缩时 btn-compact, 5小时 btn-h5, 本周 btn-wk)
// 返回: 条的每一格 (字符 + 颜色)、百分比、附加文字、百分比前面有几列、整格内容宽度
// (界面树里 Text 不带 key, 所以按格子里的子元素顺序认); boxes = 先取好的 Box 列表 (一次画面只取一次, 省时间)
const textOf = (c: any) => (typeof c === 'string' ? c : (c?.children ?? []).filter((x: any) => typeof x === 'string').join(''))
const widthOf = (c: any) => (c?.type === 'Button' ? dwT(String(c.props?.label ?? '')) : dwT(textOf(c)))
function meterIn(boxes: any[], k: 'ctx' | 'h5' | 'wk') {
  const btns = k === 'ctx' ? ['btn-ctx', 'btn-compact'] : ['btn-' + k]
  const box: any = boxes.find((b: any) => {
    const c0: any = (b.children ?? [])[0]
    return c0?.type === 'Button' && btns.includes(String(c0.props?.key))
  })
  const kids: any[] = box?.children ?? []
  const cells = kids.filter(c => c?.type === 'Text' && /^[━│]$/.test(textOf(c))).map(c => ({ text: textOf(c), color: c.props?.color }))
  const pi = kids.findIndex(c => c?.type === 'Text' && /^\s*(\d+%|--)$/.test(textOf(c)))
  let pctAt = 0
  for (let i = 0; i < pi; i++) pctAt += widthOf(kids[i])
  const el = (c: any) => (c ? { text: textOf(c).trim(), color: c.props?.color, bold: c.props?.bold } : undefined)
  return {
    box: box?.key as string | undefined,
    boxW: box?.props?.width as number | undefined,
    used: kids.reduce((w: number, c: any) => w + widthOf(c), 0),
    cells,
    pct: el(kids[pi]),
    extra: pi >= 0 && kids[pi + 1]?.type === 'Text' ? el(kids[pi + 1]) : undefined,
    pctAt: pi >= 0 ? pctAt : -1,
  }
}
const meterOf = async (ui: any, k: 'ctx' | 'h5' | 'wk') => meterIn(await ui.findAll({ type: 'Box' }), k)
async function tickOf(ui: any, k: 'ctx' | 'h5' | 'wk') {
  const { cells } = await meterOf(ui, k)
  return { bw: cells.length, idx: cells.map((c: any, i: number) => (c.text === '│' ? i : -1)).filter((i: number) => i >= 0), cells }
}

test('时间刻度: 5小时/本周 的条里正好一道亮色 │, 位置 = 已过时间/窗口 (四舍五入到格), 随时间右移; 条长不变; 上下文没有; 三档都有', async ($, on) => {
  let t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const set = (...ls: any[]) => (usage = { ...USAGE, rateLimits: ls })
  for (const cols of [200, 140, 118, 105, 100, 90, 82, 65]) {
    const seen: number[] = []
    // 5小时 已过 1h (0.2) -> 4h (0.8); 本周 已过 1 天 -> 6 天
    for (const [hrs, days] of [
      [1, 1],
      [4, 6],
    ]) {
      set(lim('five_hour', 23.5, t + (5 - hrs) * H), lim('seven_day', 12, t + (7 - days) * 24 * H))
      const ui = await mountHint($, 'terminal', cols)
      const a = await tickOf(ui, 'h5')
      expect(a.bw >= 3).toBe(true)
      expect(a.idx).toEqual([Math.min(a.bw - 1, Math.round((hrs / 5) * a.bw))])
      expect(a.cells[a.idx[0]].color).toBe('#e5e5e5')
      // 刻度替换那一格的 ━, 条的总格数不变
      expect(a.cells.filter((c: any) => c.text === '━').length).toBe(a.bw - 1)
      const w = await tickOf(ui, 'wk')
      expect(w.idx).toEqual([Math.min(w.bw - 1, Math.round((days / 7) * w.bw))])
      expect(w.cells[w.idx[0]].color).toBe('#e5e5e5')
      // 负路径: 上下文那根没有刻度
      const c = await tickOf(ui, 'ctx')
      expect(c.bw > 0 && c.idx.length === 0).toBe(true)
      for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      seen.push(a.idx[0])
      await ui.unmount()
    }
    expect(seen[1] > seen[0] ? 'ok' : `${cols} 列: 刻度没有右移 ${seen}`).toBe('ok')
  }
  // 刻度在彩色段里 (用量超过时间) 和暗色段里 (用量落后) 都是同一种亮色; 140 列 5小时 的条 17 格
  // 百分比有滚动过渡: 多画几次, 等 5小时 的数字停到目标值再看彩色段
  const settled = async (want: string) => {
    for (let i = 0; i < 40; i++) {
      const ui = await mountHint($, 'terminal', 140)
      if ((await meterOf(ui, 'h5')).pct?.text === want) return ui
      await ui.unmount()
    }
    throw new Error('5小时 的百分比没有停到 ' + want)
  }
  set(lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H))
  const ahead = await settled('80%')
  const ah = await tickOf(ahead, 'h5')
  expect(ah.bw).toBe(17)
  expect(ah.idx).toEqual([7]) // 0.4 x 17 = 6.8 -> 7
  expect(ah.cells[ah.idx[0] - 1].color === '#3f3f46').toBe(false) // 前一格是彩色
  expect(ah.cells[ah.idx[0] + 1].color === '#3f3f46').toBe(false) // 后一格也是彩色 (80% 已经超过刻度)
  await ahead.unmount()
  set(lim('five_hour', 10, t + 1 * H), lim('seven_day', 12, t + 3 * 24 * H))
  const behind = await settled('10%')
  const bh = await tickOf(behind, 'h5')
  expect(bh.idx).toEqual([14]) // 0.8 x 17 = 13.6 -> 14
  expect(bh.cells[bh.idx[0] - 1].color).toBe('#3f3f46')
  expect(bh.cells[bh.idx[0]].color).toBe('#e5e5e5')
  await behind.unmount()
  // >=90% 用量条呼吸闪烁时, 刻度不跟着变色
  set(lim('five_hour', 95, t + 1 * H), lim('seven_day', 12, t + 3 * 24 * H))
  for (let i = 0; i < 3; i++) {
    const hot = await mountHint($, 'terminal', 140)
    const hh = await tickOf(hot, 'h5')
    expect(hh.cells[hh.idx[0]].color).toBe('#e5e5e5')
    await hot.unmount()
  }
  // 窗口刚开始 (过了 3 分钟, 配速不外推) 刻度照样画; 用量只占第 0 格那 1 格彩色时, 刻度让到第 1 格, 不盖住彩色
  set(lim('five_hour', 3, t + 5 * H - 3 * 60000), lim('seven_day', 12, t + 3 * 24 * H))
  const early = await settled('3%')
  const eh = await tickOf(early, 'h5')
  expect(eh.idx).toEqual([1])
  expect(['#3f3f46', '#e5e5e5'].includes(eh.cells[0].color)).toBe(false)
  await early.unmount()
  // 负路径: 用量 0% (没有彩色格) -> 刻度留在第 0 格
  set(lim('five_hour', 0, t + 5 * H - 3 * 60000), lim('seven_day', 12, t + 3 * 24 * H))
  const empty = await settled('0%')
  expect((await tickOf(empty, 'h5')).idx).toEqual([0])
  await empty.unmount()
  // 负路径: 没有重置时间 -> 不画刻度
  set({ kind: 'five_hour', percentUsed: 40 }, lim('seven_day', 12, t + 3 * 24 * H))
  for (const cols of [140, 82, 65]) {
    const none = await mountHint($, 'terminal', cols)
    const nh = await tickOf(none, 'h5')
    expect(nh.bw > 0 && nh.idx.length === 0).toBe(true)
    expect((await tickOf(none, 'wk')).idx.length).toBe(1)
    await none.unmount()
  }
})

// 宽度测试用的三种读数: 上下文 82% (有 [压缩] 按钮) / 5小时 会用完 / 上下文 50% (没按钮)
const widthUsages = (t: number) => [
  { ...USAGE },
  { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] },
  { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } },
]

// 注意: 面板宽度 = 终端列数 - 2, 所以 98 列起是完整版, 68-97 列是中等版
test('完整版: 上下文 / 5小时 / 本周 三格总宽都正好等于列宽; 5小时/本周 附加 7 列, 省下的给条', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  for (const u of widthUsages(t)) {
    usage = u
    for (const cols of [98, 104, 105, 117, 119, 140, 200]) {
      for (const working of [false, true]) {
        const ui = await mountHint($, 'terminal', cols, working)
        const boxes = await ui.findAll({ type: 'Box' })
        const ms = [meterIn(boxes, 'ctx'), meterIn(boxes, 'h5'), meterIn(boxes, 'wk')]
        expect(ms.map(m => m.box)).toEqual(['r2c0', 'r2c1', 'r2c2'])
        for (const m of ms) expect(m.used === m.boxW ? 'ok' : `${cols} 列 ${m.box}: 内容 ${m.used} != 列宽 ${m.boxW}`).toBe('ok')
        // 条长 = 列宽 - 标签 7 - 百分比 5 - 1 - 附加; 上下文附加 11 列时 5小时/本周 用 7 列;
        // 上下文的条不到 6 格、退到 5 列时, 三格都用 5 列 (条一样长, 不比 0.12 短)
        const inner = (ms[0].boxW ?? 0) - 7
        const wantCtx = inner - 17 >= 6 ? inner - 17 : inner - 11
        const wantLim = inner - 17 >= 6 ? inner - 13 : inner - 11
        expect(ms.map(m => m.cells.length)).toEqual([wantCtx, wantLim, wantLim])
        // 上下文附加 11 列时 (119 列起), 5小时/本周 的条比它长 4 格
        if (cols >= 119) expect(ms[1].cells.length - ms[0].cells.length).toBe(4)
        expect(ms[1].cells.length >= 5).toBe(true)
        await ui.unmount()
      }
    }
  }
})

test('中等版: 右列三根条一样长, 百分比竖着对齐, 每格总宽等于列宽', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  for (const u of widthUsages(t)) {
    usage = u
    for (const cols of [68, 76, 82, 90, 97]) {
      for (const working of [false, true]) {
        const ui = await mountHint($, 'terminal', cols, working)
        const boxes = await ui.findAll({ type: 'Box' })
        const ms = [meterIn(boxes, 'ctx'), meterIn(boxes, 'h5'), meterIn(boxes, 'wk')]
        expect(ms.map(m => m.box)).toEqual(['r1c1', 'r2c1', 'r3c1'])
        const lens = ms.map(m => m.cells.length)
        expect(lens[0] >= 3 && new Set(lens).size === 1 ? 'ok' : `${cols} 列 条长 ${lens}`).toBe('ok')
        const offs = ms.map(m => m.pctAt)
        expect(offs[0] > 0 && new Set(offs).size === 1 ? 'ok' : `${cols} 列 百分比位置 ${offs}`).toBe('ok')
        for (const m of ms) expect(m.used === m.boxW ? 'ok' : `${cols} 列 ${m.box}: 内容 ${m.used} != 列宽 ${m.boxW}`).toBe('ok')
        await ui.unmount()
      }
    }
  }
})

test('客户端仪表盘: 5小时/本周 的条上有亮色细竖线刻度 (略高出条, 随已过时间右移); 文字 "2h00m" / 红色 "30m 用完"; 没有 "后重置"', async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const dash = async (cols: number) => {
    const ui = await mountDesktop($, cols)
    const d: any = (await ui.findAll({ type: 'Svg' })).find((s: any) => !String(s.props.alt).includes('螃蟹'))
    const src = String(d?.props.source ?? '')
    await ui.unmount()
    return src
  }
  const redSpans = (src: string) => (src.match(/<tspan fill="#f87171"/g) ?? []).length
  const warn = await dash(140)
  expect((warn.match(/class="tick"/g) ?? []).length).toBe(2)
  expect(warn).toContain('30m 用完')
  expect(warn).toContain('3d0h')
  expect(redSpans(warn)).toBe(2) // 5小时 的百分比 + "30m 用完"
  expect(/后重置|后用完|约/.test(warn)).toBe(false)
  // 窄的时候缩写也留着 "用完" ("4d12h 用完" -> "4d 用完"), 不出现光秃秃的红色时间 (会被看成重置倒计时)
  const redTexts = (src: string) => [...src.matchAll(/<tspan fill="#f87171"[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1].trim())
  const seenRed = new Set<string>()
  for (const width of [900, 760, 640, 560, 480, 420, 360]) {
    const svg = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, five: { pct: 30, extra: '1h54m' }, week: { pct: 6, extra: '4d12h 用完', warn: true, tick: 0.04 }, status: { text: '', tone: 'idle' }, tools: '', tokenTotal: '', tokenOutput: '' }, { width })
    for (const r of redTexts(svg)) {
      expect(/^\d+%$/.test(r) || r.includes('用完') ? 'ok' : `${width}px: bare red "${r}"`).toBe('ok')
      seenRed.add(r)
    }
  }
  expect(seenRed.has('4d12h 用完')).toBe(true)
  // 负路径: 配速正常 -> 没有 "用完", 没有红字; 刻度照样有
  usage = { ...USAGE }
  const ok = await dash(140)
  expect(ok).toContain('2h00m')
  expect(ok.includes('用完')).toBe(false)
  expect(redSpans(ok)).toBe(0)
  expect((ok.match(/class="tick"/g) ?? []).length).toBe(2)
  expect(/后重置/.test(ok)).toBe(false)
  // 一行精简版也有刻度
  const narrow = await dash(55)
  expect((narrow.match(/class="tick"/g) ?? []).length).toBe(2)
  // 直接画: 刻度比条高, 在条的范围内, 已过比例越大越靠右; 不给 tick 不画
  const one = (tick?: number) => {
    const m = { pct: 30, extra: '1h54m', tick }
    const svg = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, five: m, week: { pct: 3, extra: '' }, status: { text: '', tone: 'idle' }, tools: '', tokenTotal: '', tokenOutput: '' }, { width: 900 })
    const tk = svg.match(/<rect class="tick" x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" fill="#e5e5e5"\/>/)
    return { svg, tk }
  }
  const a = one(0.2)
  const b = one(0.8)
  expect(a.tk && b.tk ? 'ok' : 'no tick').toBe('ok')
  expect(Number(b.tk![1]) > Number(a.tk![1])).toBe(true)
  // 条: y-6 高 5; 刻度: y-7.5 高 8 (上下各高出 1.5)
  const bar = a.svg.match(/<rect x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="5" rx="2.5" fill="#3a3a40"\/>/g) ?? []
  expect(bar.length).toBe(3)
  const fiveBar = bar[1].match(/x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)"/)!
  const [bx, by, bw] = [Number(fiveBar[1]), Number(fiveBar[2]), Number(fiveBar[3])]
  for (const r of [a, b, one(0), one(1)]) {
    const [tx, ty, tw, th] = r.tk!.slice(1).map(Number)
    expect(ty < by && ty + th > by + 5).toBe(true)
    expect(tx >= bx - 0.05 && tx + tw <= bx + bw + 0.05).toBe(true)
  }
  expect(Math.abs(Number(a.tk![1]) + 0.75 - (bx + bw * 0.2)) < 0.1).toBe(true)
  expect(one(undefined).tk).toBeNull()
  expect(one(undefined).svg.includes('class="tick"')).toBe(false)
  expect(one(undefined).svg.includes('后重置')).toBe(false)
})

// ======================== v0.14 / v0.15: 螃蟹散步道 (输入框正上方的横栏) ========================

// 散步道里还会出现气泡的「」和 ！
const SAFE3 = /^[\x20-\x7E一-鿿，│█▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓·「」！]*$/
const KID_C = 0xf2a07b
const BODY = 0xd97757
const EYE = 0x1c1917

async function mountAbove($: any, cols: number, maxRows: number, o: { working?: boolean; fullscreen?: boolean; survey?: boolean } = {}) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols + 5, rows: 40, isFullscreen: o.fullscreen ?? true },
    props: { hasSurvey: !!o.survey, isWorking: !!o.working, maxRows, bodyColumns: cols, scroll: { top: 0, bodyRows: maxRows, totalRows: 3 }, view: {} },
  } as any)
}
// 散步道的根 Box 和它的子元素: 主 Raster + 叠在上面的文字 (事件气泡 / +N) + 跟着大螃蟹的悬停区域
async function laneOf(ui: any) {
  const root: any = (await ui.findAll({ type: 'Box' })).find((b: any) => b.key === 'crab-lane')
  const kids: any[] = root?.children ?? []
  const raster = kids.find(c => c?.type === 'Raster')
  const box = (b: any) => ({
    left: b.props?.left ?? 0,
    top: b.props?.top ?? 0,
    width: b.props?.width,
    hidden: b.props?.display === 'none',
    hover: b.hover ?? b.props?.hover,
    text: (b.children ?? []).map((t: any) => textOf(t)).join(''),
    color: (b.children ?? [])[0]?.props?.color,
    children: b.children ?? [],
  })
  const overs = kids.filter(c => c?.type === 'Box' && !c.props?.key).map(box)
  const me = kids.find(c => c?.type === 'Box' && c.props?.key === 'crab-lane-me')
  return { root, raster, overs, me: me ? { ...box(me), height: me.props?.height, inner: (me.children ?? []).map(box) } : undefined, say: overs.find(o => o.text.startsWith('「')) }
}
// Raster 的格子 -> 像素颜色 (每格上下两个像素; -1 = 空; 盲文粒子当空格)
function rasterPx(r: any): number[][] {
  const cols = r.props.columns
  const rows = r.props.rows
  const words = new Uint32Array(Uint8Array.from(atob(r.props.cells), c => c.charCodeAt(0)).buffer)
  const px: number[][] = Array.from({ length: rows * 2 }, () => new Array(cols).fill(-1))
  for (let i = 0; i < cols * rows; i++) {
    const [ch, fg, bg] = [words[i * 3], words[i * 3 + 1], words[i * 3 + 2]]
    const y = Math.floor(i / cols) * 2
    const x = i % cols
    if (ch === 0x2580) {
      px[y][x] = fg
      if (bg !== 0x01000000) px[y + 1][x] = bg
    } else if (ch === 0x2584) px[y + 1][x] = fg
  }
  return px
}
// 数小螃蟹: 某一行像素里浅橙色的连续段 (两只之间至少空 1 格); 3 行版看第 4 行 (身体最宽那行), 2 行版第 2 行, 1 行版第 0 行
function kidCount(px: number[][], rows: number): number {
  const row = px[rows === 3 ? 4 : rows === 2 ? 2 : 0]
  let n = 0
  row.forEach((c, x) => {
    if (c === KID_C && row[x - 1] !== KID_C) n++
  })
  return n
}
// 大螃蟹占的列 (身体色; 小螃蟹是浅一号的颜色, 不算)
const crabCols = (px: number[][]) => new Set(px.flatMap(row => row.map((c, x) => (c === BODY ? x : -1)).filter(x => x >= 0)))
const decode = (b64: string) => new Uint32Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer)

test('散步道: maxRows >= 3 画 3 行版, 不够退到 2 / 1 行, 0 行不画; 宽度不超过 bodyColumns; 没有 Button; 问卷时让位', async ($, on) => {
  await start($, on, WIN, { usage: () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }) })
  for (const cols of [40, 100, 200]) {
    for (const [maxRows, rows] of [
      [10, 3],
      [3, 3],
      [2, 2],
      [1, 1],
    ]) {
      const ui = await mountAbove($, cols, maxRows)
      const l = await laneOf(ui)
      expect(l.root?.props.width <= cols).toBe(true)
      expect([l.raster?.props.columns, l.raster?.props.rows]).toEqual([cols, rows])
      for (const o of l.overs) expect(o.left + dwT(o.text) <= cols ? 'ok' : `${cols}: "${o.text}" 超出`).toBe('ok')
      // 横栏里不放 Button (空输入框里按数字会按到它)
      expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
      for (const s of await strings(ui)) expect(SAFE3.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      await ui.unmount()
    }
  }
  const zero = await mountAbove($, 100, 0)
  expect(await zero.find({ type: 'Raster' })).toBeUndefined()
  expect(await zero.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await zero.unmount()
  const survey = await mountAbove($, 100, 10, { survey: true })
  expect(await survey.find({ type: 'Raster' })).toBeUndefined()
  await survey.unmount()
})

test('散步道悬停: 以大螃蟹的格子为悬停区域, 里面藏着举钳打招呼的螃蟹 + 旁边的气泡 (用量摘要 + 小贴士); 不再有整行提示; 气泡在横栏里且不压螃蟹', async ($, on) => {
  // 用 mock.clock: 默认的假时钟挡不住定时器, 螃蟹会按真实时间在测试中途走动, 气泡那一侧的宽度就跟着变
  // 小贴士按分钟轮换 (5 条长短不一), 每一条都试到; 重置时间也按这个时钟算
  const T0 = 1_900_000_200_000 - (1_900_000_200_000 % 300_000) // 第 0 条小贴士那一分钟的开头
  let now = T0
  const usage = () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits: [lim('five_hour', 24, now + 2 * H), lim('seven_day', 12, now + 3 * 24 * H)] })
  const { clock } = await start($, on, WIN, { mockClock: T0 + 1000, agents: () => [], usage })
  for (let k = 0; k < 5; k++) {
    await clock.set(T0 + k * 60_000 + 1000)
    now = clock.now()
    for (const [cols, rows, bw] of [
      [120, 3, 12],
      [40, 3, 12],
      [120, 2, 9],
      [60, 1, 9],
    ]) {
      const ui = await mountAbove($, cols, rows, { fullscreen: true })
      const l = await laneOf(ui)
      const at = `第 ${k} 条小贴士, ${cols} 列 ${rows} 行`
      // 不再有盖住整个顶行的提示行
      expect(l.overs.some(o => o.hidden)).toBe(false)
      const me = l.me!
      expect([me.width, me.height]).toEqual([bw, rows])
      // 悬停区域跟着大螃蟹: 正好是螃蟹占的那几格
      const crab = crabCols(rasterPx(l.raster))
      expect([...crab].every(x => x >= me.left && x < me.left + bw) ? 'ok' : at + ': 螃蟹不在悬停区域里').toBe('ok')
      // 打招呼的螃蟹: 平时藏着, 悬停时显示, 和螃蟹一样大, 盖在它上面
      const hi = me.inner.find(b => b.children[0]?.type === 'Raster')!
      expect(hi.hidden && hi.hover?.display === 'flex' && hi.left === 0 && hi.top === 0).toBe(true)
      const hr = hi.children[0]
      expect([hr.props.columns, hr.props.rows]).toEqual([bw, rows])
      if (rows === 3) expect(rasterPx(hr)[0][11]).toBe(BODY) // 右钳举起
      // 气泡: 平时藏着; 在横栏的宽度里; 不压大螃蟹的格子; 内容是用量摘要开头
      const tip = me.inner.find(b => b.children[0]?.type === 'Text')!
      expect(tip.hidden && tip.hover?.display === 'flex').toBe(true)
      const x0 = me.left + tip.left
      expect(x0 >= 0 && x0 + dwT(tip.text) <= cols ? 'ok' : `${at}: 气泡 ${x0}+${dwT(tip.text)} 出了横栏`).toBe('ok')
      expect(x0 + dwT(tip.text) <= me.left || x0 >= me.left + bw ? 'ok' : at + ': 气泡压到螃蟹').toBe('ok')
      expect(tip.text.startsWith('上下文 50%') ? 'ok' : `${at}: "${tip.text}"`).toBe('ok')
      // 120 列 (气泡那一侧至少 53 格): 不管轮到哪条小贴士、螃蟹走到哪, 都带着小贴士 (放不下就截短, 不整条丢掉)
      // 更窄时: 那一侧放得下 "摘要 + 小贴士 /hud" 开头就要带着
      const room = Math.max(cols - (me.left + bw + 1), me.left - 1)
      const tipMin = dwT('上下文 50% · 5小时 24% · 本周 12% · 小贴士 /hud ') + 3
      if (cols >= 120 || room >= tipMin) expect(tip.text.includes('小贴士 /hud') ? 'ok' : `${at}: 气泡这边有 ${room} 格, 却没有小贴士 "${tip.text}"`).toBe('ok')
      await ui.unmount()
    }
  }
  // 不是全屏 (没有鼠标): 没有悬停区域
  const main = await mountAbove($, 120, 3, { fullscreen: false })
  const l = await laneOf(main)
  expect(l.raster).toBeDefined()
  expect(l.me).toBeUndefined()
  await main.unmount()
})

test('悬停气泡的写法: 每条小贴士、每种宽度都放得下; 先省时间, 再把小贴士截短, 最后才只留摘要', () => {
  const T0 = 1_900_000_200_000 - (1_900_000_200_000 % 300_000)
  for (let k = 0; k < 5; k++) {
    const now = T0 + k * 60_000 + 1000
    const five = lim('five_hour', 24, now + 2 * H)
    const week = lim('seven_day', 12, now + 3 * 24 * H)
    const fit = laneTip(50, five, week, paceOf(five, now), paceOf(week, now), now)
    const noTime = '上下文 50% · 5小时 24% · 本周 12%'
    const tipMin = dwT(noTime + ' · 小贴士 /hud ') + 3
    for (let room = 4; room <= 140; room++) {
      const t = fit(room)
      expect(dwT(t) <= room ? 'ok' : `第 ${k} 条, ${room} 格: "${t}" 放不下`).toBe('ok')
      // "上下文 50%" 占 10 格, 截短时末尾还有 "..": 12 格起开头完整
      if (room >= 12) expect(t.startsWith('上下文 50%') ? 'ok' : `第 ${k} 条, ${room} 格: "${t}"`).toBe('ok')
      // 摘要 + "小贴士 /hud" 开头放得下时, 一定带着小贴士 (以前长的小贴士放不下就整条丢掉, 按分钟时有时无)
      if (room >= tipMin) expect(t.includes('小贴士 /hud') ? 'ok' : `第 ${k} 条, ${room} 格: 没有小贴士 "${t}"`).toBe('ok')
    }
    // 全文放得下就给全文 (带时间)
    expect(fit(140).includes('2h00m 重置') && fit(140).includes('小贴士 /hud')).toBe(true)
  }
})

test('散步道: N 个子代理画 N 只小螃蟹 (3 行版 9 格宽、2 行版 3 格宽), 互不重叠也不贴住, 和大螃蟹隔开; 每帧最多挪 1 格; 碰到两端掉头; 放不下记 +N', { timeoutMs: 30_000 }, () => {
  for (const rows of [3, 2] as const) {
    for (const n of [1, 3, 5]) {
      for (const mood of ['chill', 'panic'] as const) {
        const ids = Array.from({ length: n }, (_, i) => 'k' + i)
        const r = previewLane({ w: 90, rows, frames: 400, working: true, mood, running: () => ids })
        const dirs = new Set<number>()
        r.frames.forEach((fr, f) => {
          expect(fr.kids.length).toBe(n)
          const xs = [fr.bx, ...fr.kids.map(k => k.x)]
          expect(fr.bx >= 0 && fr.bx + r.bw <= 90).toBe(true)
          for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i] >= r.kw + 1 ? 'ok' : `rows=${rows} n=${n} f=${f} 挨得太近 ${xs}`).toBe('ok')
          if (f > 0) {
            const prev = [r.frames[f - 1].bx, ...r.frames[f - 1].kids.map(k => k.x)]
            xs.forEach((x, i) => expect(Math.abs(x - prev[i]) <= 1).toBe(true))
          }
          dirs.add(fr.dir)
        })
        expect(dirs.size).toBe(2)
        const last = r.frames[r.frames.length - 1]
        if (last.kids.every(k => k.x >= 0)) expect(kidCount(last.px, rows)).toBe(n)
      }
    }
  }
  const many = previewLane({ w: 60, frames: 5, running: () => Array.from({ length: 12 }, (_, i) => 'k' + i) })
  expect(many.frames[4].kids.length).toBe(many.cap)
  expect(many.frames[4].hidden).toBe(12 - many.cap)
})

test('大螃蟹一直有动静: 主会话或子代理在跑都走 (速度跟心情); 全闲时隔 20-40 秒溜达 3-8 格再东张西望; 睡着闭眼', () => {
  const moves = (o: any) => {
    const r = previewLane({ w: 120, frames: 120, ...o })
    return r.frames.filter((fr, f) => f > 0 && fr.bx !== r.frames[f - 1].bx).length
  }
  // 只有子代理在跑 (主会话闲着): 大螃蟹照样走
  expect(moves({ working: false, running: () => ['a'] }) > 20).toBe(true)
  const m = ['chill', 'normal', 'sweat', 'panic'].map(mood => moves({ working: true, mood }))
  expect(m[0] < m[1] && m[1] < m[2] && m[2] < m[3] ? 'ok' : 'speeds ' + m).toBe('ok')
  // 全闲: 前 20 秒不动; 之后溜达一次 3-8 格, 走完停下东张西望
  const idle = previewLane({ w: 80, frames: 420, working: false })
  const stepAt = idle.frames.map((fr, f) => (f && fr.bx !== idle.frames[f - 1].bx ? f : -1)).filter(f => f >= 0)
  expect(stepAt[0] >= 133 && stepAt[0] <= 270 ? 'ok' : 'first stroll at ' + stepAt[0]).toBe('ok')
  const first = stepAt.filter(f => f < stepAt[0] + 30)
  expect(first.length >= 3 && first.length <= 8).toBe(true)
  const stop = first[first.length - 1]
  expect(idle.frames[stop + 2].pose).toBe('idle')
  // 东张西望: 停下后几帧里眼睛左右换
  const eyesAt = (fr: any) => JSON.stringify(fr.px.map((row: number[]) => row.map((c, x) => (c === EYE ? x : -1)).filter(x => x >= 0)))
  expect(new Set(idle.frames.slice(stop + 1, stop + 20).map(eyesAt)).size > 1).toBe(true)
  // 睡着: 一直闭眼 (没有深色眼睛像素), 不走
  const sleep = previewLane({ w: 60, frames: 60, working: false, sleeping: true })
  expect(sleep.frames.every(fr => fr.pose === 'sleep' && fr.px.flat().every(c => c !== EYE))).toBe(true)
  expect(new Set(sleep.frames.map(fr => fr.bx)).size).toBe(1)
})

test('散步道: 打字时停下低头 (眼睛往下), 停手约 1.5 秒恢复; 发出消息跳一下, 落地冒尘土', () => {
  // 第 10-29 帧在打字
  const r = previewLane({ w: 80, frames: 50, working: true, typing: f => f >= 10 && f < 30 })
  for (let f = 11; f < 30; f++) {
    expect(r.frames[f].pose).toBe('type')
    expect(r.frames[f].bx).toBe(r.frames[10].bx)
  }
  const eyeRows = (fr: any) => fr.px.map((row: number[], y: number) => (row.includes(EYE) ? y : -1)).filter((y: number) => y >= 0)
  expect(eyeRows(r.frames[20]).every((y: number) => y >= 3)).toBe(true) // 低头: 眼睛在第 3 行 (平时第 1-2 行)
  expect(r.frames[35].pose).toBe('walk')
  expect(r.frames[49].bx !== r.frames[30].bx).toBe(true)
  // 发出消息: 4 帧的跳 (蹲 / 腾空 / 腾空 / 落地), 腾空时不画腿, 落地那帧冒尘土
  const j = previewLane({ w: 80, frames: 12, working: false, jumpAt: 3 })
  expect(j.frames.slice(3, 7).map(fr => fr.pose)).toEqual(['jump', 'jump', 'jump', 'jump'])
  expect(j.frames[2].pt.length).toBe(0)
  expect(j.frames[6].pt.length > 0).toBe(true)
  expect(j.frames[7].pose).toBe('idle')
  const bottom = (fr: any) => fr.px[5].filter((c: number) => c === BODY).length
  expect(bottom(j.frames[4])).toBe(0) // 腾空: 最下面一行没有腿
})

test('粒子: 不超过 16 个, 都在横栏里, 只画在空格子里 (盲文字符), 每帧最多挪 1 个点位, 颜色不跳; 走路和庆祝有, 静止没有', { timeoutMs: 30_000 }, () => {
  const check = (r: any, label: string) => {
    let any = 0
    r.frames.forEach((fr: any, f: number) => {
      expect(fr.pt.length <= r.max).toBe(true)
      for (const p of fr.pt) expect(p.x >= 0 && p.y >= 0 && p.x < 80 * 2 && p.y < 12).toBe(true)
      // 盲文只出现在没有螃蟹像素的格子里
      const w = decode(fr.cells)
      for (let i = 0; i < w.length / 3; i++) {
        const ch = w[i * 3]
        if (ch >= 0x2800 && ch <= 0x28ff) {
          any++
          expect(ch > 0x2800).toBe(true)
          const x = i % 80
          const row = Math.floor(i / 80)
          expect(fr.px[row * 2][x] === -1 && fr.px[row * 2 + 1][x] === -1).toBe(true)
        } else expect([32, 0x2580, 0x2584].includes(ch) ? 'ok' : `${label}: 字符 ${ch.toString(16)}`).toBe('ok')
      }
      // 每个粒子都从上一帧同一个粒子走 1 个点位过来 (颜色不变, 只是变暗)
      if (f > 0)
        for (const q of fr.pt) {
          if (q.age === 0) continue
          const from = r.frames[f - 1].pt.find((p: any) => p.age === q.age - 1 && p.color === q.color && Math.abs(p.x - q.x) + Math.abs(p.y - q.y) <= 1)
          expect(from ? 'ok' : `${label} f=${f}: 粒子跳了`).toBe('ok')
        }
    })
    return any
  }
  expect(check(previewLane({ w: 80, frames: 200, working: true }), 'walk') > 0).toBe(true)
  expect(check(previewLane({ w: 80, frames: 200, working: true, mood: 'panic', running: () => ['a', 'b'] }), 'trot') > 0).toBe(true)
  const cel = previewLane({ w: 80, frames: 20, working: false, celebrating: f => f >= 2 && f < 12 })
  expect(check(cel, 'celebrate') > 0).toBe(true)
  expect(cel.frames[3].pt.some((p: any) => p.color === mix(cel.colors.spark))).toBe(true)
  // 静止 (闲着趴着, 还没到溜达的时候): 一个粒子都没有
  const rest = previewLane({ w: 80, frames: 120, working: false })
  expect(rest.frames.every(fr => fr.pt.length === 0)).toBe(true)
  // 子代理离场: 跳出顶边的地方冒一小团
  const leave = previewLane({ w: 80, frames: 60, working: false, running: f => (f < 5 ? ['a', 'b'] : ['a']) })
  const gone = leave.frames.findIndex((fr, f) => f > 5 && fr.kids.length === 1)
  expect(gone > 0 && leave.frames[gone].pt.some((p: any) => p.y <= 1)).toBe(true)
})
// 金色闪光的基础色 (和代码里一样: 金色往深灰混 25%)
function mix(c: number): number {
  const d = 0x27272a
  const ch = (s: number) => Math.round(((c >> s) & 255) * 0.75 + ((d >> s) & 255) * 0.25)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

test('散步道: 子代理结束后那只挥手约 1.5 秒, 然后离场 (3 行版往上跳出顶边, 2 行版走上面那行; 不和队里的重叠); 1 行版挥完直接消失', () => {
  const end = 20
  const r3 = previewLane({ w: 90, frames: 60, working: true, running: f => (f < end ? ['a', 'b', 'c'] : ['a', 'c']) })
  const st = (r: any, f: number) => r.frames[f].kids.find((k: any) => k.id === 'b')?.state ?? (r.frames[f].gone.some((k: any) => k.id === 'b') ? 'exit' : 'none')
  expect(st(r3, end - 1)).toBe('walk')
  for (let f = end; f < end + 9; f++) expect(st(r3, f)).toBe('wave')
  expect(st(r3, end + 11)).toBe('hop')
  const out3 = r3.frames.findIndex((fr, f) => f > end && st(r3, f) === 'none')
  expect(out3 > 0 && (out3 - end) * 150 <= 3000).toBe(true)
  // 跳的时候还占着队里的位置: 后面那只不会滑到它身下
  for (let f = end; f < out3; f++) {
    const xs = [r3.frames[f].bx, ...r3.frames[f].kids.map(k => k.x)]
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i] >= 10).toBe(true)
  }
  const r2 = previewLane({ w: 80, rows: 2, frames: 120, working: true, running: f => (f < end ? ['a', 'b', 'c'] : ['a', 'c']) })
  expect(st(r2, end + 11)).toBe('exit')
  const out2 = r2.frames.findIndex((fr, f) => f > end && st(r2, f) === 'none')
  expect(out2 > 0 && (out2 - end) * 150 <= 10_000).toBe(true)
  const one = previewLane({ w: 80, rows: 1, frames: 40, working: true, running: f => (f < end ? ['a', 'b'] : ['a']) })
  expect(kidCount(one.frames[end + 12].px, 1)).toBe(1)
})

test('散步道接上真的子代理: 3 个运行中画 3 只; 只有子代理在跑时大螃蟹也在走; 结束的那只几秒内离场 (mock.clock)', async ($, on) => {
  const T = 1_900_000_000_000
  let list: any[] = ['a', 'b', 'c'].map(id => ({ id, description: id, type: 'Explore', status: 'running' }))
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => list, usage: () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }) })
  const look = async () => {
    const ui = await mountAbove($, 110, 3)
    const l = await laneOf(ui)
    await ui.unmount()
    return { n: kidCount(rasterPx(l.raster), 3), x: l.me?.left }
  }
  await look()
  await clock.advance(4000) // 让队伍走进横栏
  const a = await look()
  expect(a.n).toBe(3)
  await clock.advance(1500)
  expect((await look()).x !== a.x).toBe(true) // 主会话没在跑, 大螃蟹照样在走
  list = list.map(k => (k.id === 'b' ? { ...k, status: 'completed' } : k))
  await look()
  await clock.advance(5000)
  expect((await look()).n).toBe(2)
})

test('5 分钟没有任何动静才睡; 子代理在跑不算闲; 打字时停下, 约 1.5 秒后接着走 (mock.clock)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let list: any[] = []
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => list, usage: () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }) })
  const peek = async () => {
    const ui = await mountAbove($, 110, 3)
    const l = await laneOf(ui)
    await ui.unmount()
    return { open: rasterPx(l.raster).flat().includes(EYE), x: l.me?.left }
  }
  await clock.advance(4 * 60_000)
  expect((await peek()).open).toBe(true)
  await clock.advance(61_500)
  expect((await peek()).open).toBe(false) // 5 分钟没动静: 睡着 (闭眼)
  const typed = (text: string) => $.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: 'x' } as any)
  await typed('')
  expect((await peek()).open).toBe(true) // 打字把它叫醒 (低头看输入框)
  // 子代理在跑: 大螃蟹走; 打字的那 1.5 秒里停下, 之后接着走
  list = [{ id: 'k', description: 'k', type: 'Explore', status: 'running' }]
  await peek()
  await clock.advance(1500)
  const x1 = (await peek()).x
  await clock.advance(900)
  expect((await peek()).x !== x1).toBe(true)
  await typed('x')
  const t0 = (await peek()).x
  await clock.advance(1200)
  expect((await peek()).x).toBe(t0)
  await clock.advance(1500)
  expect((await peek()).x !== t0).toBe(true)
  // 子代理一直在跑: 6 分钟后也没睡, 还在走
  await clock.advance(6 * 60_000)
  const x2 = (await peek()).x
  await clock.advance(900)
  expect((await peek()).x !== x2).toBe(true)
})

test('气泡: 一轮结束「搞定 12s」约 5 秒后消失 (mock.clock); 新的顶掉旧的 (压缩完了 / 额度刷新了)', async ($, on) => {
  const T = 1_900_000_000_000
  let usage: any = { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits: [lim('five_hour', 40, T + 30_000), lim('seven_day', 12, T + 3 * 24 * H)] }
  const calls = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => usage })
  const clock = calls.clock
  const bubble = async () => {
    const ui = await mountAbove($, 120, 2)
    const l = await laneOf(ui)
    await ui.unmount()
    return l.say
  }
  expect(await bubble()).toBeUndefined()
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(12_000)
  await $.turn.complete({ answer: '', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  const b = await bubble()
  expect(b?.text).toBe('「搞定 12s」')
  // 气泡跟着大螃蟹, 在它旁边, 不出横栏, 不压螃蟹
  expect(b && b.left + dwT(b.text) <= 120).toBe(true)
  const shot = await mountAbove($, 120, 2)
  const crab = crabCols(rasterPx((await laneOf(shot)).raster))
  await shot.unmount()
  expect([...crab].some(x => b && x >= b.left && x < b.left + dwT(b.text))).toBe(false)
  await clock.advance(4000)
  expect((await bubble())?.text).toBe('「搞定 12s」')
  await clock.advance(1500)
  expect(await bubble()).toBeUndefined()
  // 压缩完成
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
  expect((await bubble())?.text).toBe('「压缩完了」')
  // 额度重置 (约每 6 秒查一次, 和弹 toast 是同一次): 新的顶掉旧的
  expect(calls.toasts.some(x => x.includes('额度已恢复'))).toBe(false)
  await clock.advance(14_000)
  expect(calls.toasts).toContain('5 小时额度已恢复，可以继续了')
  expect((await bubble())?.text).toBe('「额度刷新了」')
})

test('气泡: 配速变成会用完说一次红色「慢点！…用完」(每个窗口一次); 上下文第一次到 75% 说「上下文快满了」; 等你批准权限说「等你点头」', async ($, on) => {
  const T = 1_900_000_000_000
  let usage: any = { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits: [lim('five_hour', 10, T + 3 * H), lim('seven_day', 12, T + 3 * 24 * H)] }
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => usage })
  const bubble = async () => {
    const ui = await mountAbove($, 120, 2)
    const l = await laneOf(ui)
    await ui.unmount()
    return l.say
  }
  expect(await bubble()).toBeUndefined()
  // 5小时 已过 2h 用到 50% -> 2 小时后用完
  usage = { ...usage, rateLimits: [lim('five_hour', 50, T + 3 * H), lim('seven_day', 12, T + 3 * 24 * H)] }
  const slow = await bubble()
  expect(slow?.text).toBe('「慢点！2h00m用完」')
  expect(slow?.color).toBe('#f87171')
  await clock.advance(5500)
  // 同一个窗口里不再说
  expect(await bubble()).toBeUndefined()
  // 上下文第一次到 75%
  usage = { ...usage, context: { tokens: 160_000, window: 200_000, percent: 80 } }
  expect((await bubble())?.text).toBe('「上下文快满了」')
  await clock.advance(5500)
  expect(await bubble()).toBeUndefined()
  // 等你批准权限
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any)
  expect((await bubble())?.text).toBe('「等你点头」')
  await clock.advance(5500)
  // 负路径: 别的通知不说; 权限通知照样说
  await $.classic.Notification({ message: 'idle', notification_type: 'idle_prompt' } as any)
  expect(await bubble()).toBeUndefined()
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as any)
  expect((await bubble())?.text).toBe('「等你点头」')
})

test('/hud crab 关掉后横栏里不画散步道 (存进 store, 重开会话也记得), 再开回来', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'hud', args: 'crab' } as any)
  const off = await mountAbove($, 100, 2)
  expect(await off.find({ type: 'Raster' })).toBeUndefined()
  await off.unmount()
  // 重新开始会话: 从 store 读回 "关"
  await $.session.start({ cwd: CWD } as any)
  const still = await mountAbove($, 100, 2)
  expect(await still.find({ type: 'Raster' })).toBeUndefined()
  await still.unmount()
  await $.command.run({ command: 'hud', args: 'crab on' } as any)
  const on2 = await mountAbove($, 100, 2)
  expect((await laneOf(on2)).raster).toBeDefined()
  await on2.unmount()
})

test('/hud top: 散步道在面板上面, 用面板剩下的行 (按 3 / 2 / 1 / 0 退档); 总高度不超过 maxRows', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'hud', args: 'top' } as any)
  for (const [maxRows, laneRows] of [
    [10, 3],
    [6, 3],
    [5, 2],
    [4, 1],
    [3, 0],
  ]) {
    const ui = await mountAbove($, 140, maxRows)
    // 悬停里藏着的打招呼螃蟹不算行
    const rasters: any[] = (await ui.findAll({ type: 'Raster' })).filter((r: any) => r.key !== 'crab-lane-hi')
    const rows = rasters.map(r => r.props.rows)
    expect(rows).toEqual(laneRows ? [laneRows, 3] : [3])
    expect(rows.reduce((a, b) => a + b, 0) <= maxRows).toBe(true)
    await ui.unmount()
  }
  await $.command.run({ command: 'hud', args: 'bottom' } as any)
})

test('发出消息 (prompt.submit): 螃蟹蹲一下、腾空 (不画腿)、落地冒尘土, 然后回到趴着 (mock.clock)', async ($, on) => {
  const T = 1_900_000_000_000
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }) })
  const shot = async () => {
    const ui = await mountAbove($, 110, 3)
    const l = await laneOf(ui)
    await ui.unmount()
    const px = rasterPx(l.raster)
    const cols = [...crabCols(px)]
    // 大螃蟹最上 / 最下一行像素: 趴着 0-4, 蹲和落地 1-5 (身体放低一格), 腾空 0-3 (不画腿)
    const ys = px.map((row, y) => (cols.some(x => row[x] === BODY) ? y : -1)).filter(y => y >= 0)
    const braille = [...decode(l.raster.props.cells)].filter((c, i) => i % 3 === 0 && c > 0x2800 && c <= 0x28ff).length
    return { span: [ys[0], ys[ys.length - 1]], braille }
  }
  await shot()
  await clock.advance(450)
  const before = await shot()
  expect(before).toEqual({ span: [0, 4], braille: 0 }) // 趴着, 没有粒子
  const r: any = await $.prompt.submit({ text: 'hi' } as any)
  expect(r.text).toBe('hi') // 原样往下传
  expect((await shot()).span).toEqual([1, 5]) // 蹲
  await clock.advance(150)
  expect((await shot()).span).toEqual([0, 3]) // 腾空: 不画腿
  await clock.advance(300)
  const land = await shot()
  expect(land.span).toEqual([1, 5]) // 落地
  expect(land.braille > 0).toBe(true) // 脚边冒尘土
  await clock.advance(1200)
  expect(await shot()).toEqual({ span: [0, 4], braille: 0 })
})
