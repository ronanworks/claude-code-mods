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
// toolGate: 工具调用等它放行才结束 (测 "工具在跑时" 用)
type Opts = { usage?: () => any; agents?: () => any[]; now?: () => number; mockClock?: number; store?: Record<string, unknown>; toolGate?: () => Promise<void> }

function mocks(on: any, calls: Calls, sys: Sys = WIN, opts: Opts = {}) {
  // 存储用内存里的假存储: 测试里的 /hud top 不能写进用户真实的偏好文件
  mock.store(on, opts.store)
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
  on('tool.call', async () => {
    if (opts.toolGate) await opts.toolGate()
    return { result: {}, text: 'ok' }
  })
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

test('面板在输入框下方，引擎自己的提示行保留；有档位、本周用量；面板里没有螃蟹 (螃蟹在上方的散步道)', async ($, on) => {
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
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
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

// v0.16: 面板去掉螃蟹那 15+2 列后各档分界前移 17 列: 完整版 81 列起, 中等版 51-80 列, 精简版不到 51 列
//   (旧测试里的列数减 17, 格子几何完全不变)
test('80 列 (macOS 默认窗口) 用中等版: 3 行 x 2 列 (没有螃蟹)，右列是三根用量条', async ($, on) => {
  await start($, on)
  for (const cols of [65, 73, 80]) {
    const ui = await mountHint($, 'terminal', cols)
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
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

test('很窄的终端用一行精简版 (没有螃蟹)；桌面端不画面板，只留引擎自己的提示行', async ($, on) => {
  await start($, on)
  const t = await mountHint($, 'terminal', 45)
  expect(await t.find({ type: 'Raster' })).toBeUndefined()
  expect((await t.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-ctx')).toBe(true)
  expect((await t.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-crab')).toBe(false)
  for (const s of await strings(t)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await t.unmount()
  const d = await mountHint($, 'desktop', 140)
  expect(await d.find({ type: 'Raster' })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /%/ })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await d.unmount()
})

test('每种工具跑的时候大螃蟹的精灵 (散步道里那只) 和状态文字都能画出来', async ($, on) => {
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

test('/hud top / bottom 不再挪面板: 只回一句话, 不写 store; 面板照旧在输入框下方, 横栏里只有散步道; 有问卷时让位', async ($, on) => {
  await start($, on)
  for (const arg of ['top', 'bottom']) {
    const r: any = await $.command.run({ command: 'hud', args: arg } as any)
    expect(String(r?.text ?? r?.value?.text ?? JSON.stringify(r))).toContain('终端版面板固定在输入框下方，螃蟹在上方')
  }
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Box' })).some((b: any) => b.key === 'r1c0')).toBe(true)
  await hint.unmount()
  // 横栏 (AbovePrompt) 里只有散步道 (Client): 天空行 + 3 行版 = 4 行, 没有面板的格子, 没有 Button
  const band = await mountBand($, 140)
  const cl: any = await band.find({ type: 'Client' })
  expect([cl?.props.width, cl?.props.height]).toEqual([140, 4])
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  expect((await band.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))).toBe(false)
  expect((await band.findAll({ type: 'Button' })).length).toBe(0)
  await band.unmount()
  const survey = await mountBand($, 140, true)
  expect(await survey.find({ type: 'Client' })).toBeUndefined()
  await survey.unmount()
})

test('store 里以前存的 position=above (测试曾写进用户的 Mac) 一律忽略: 面板照旧在输入框下方', async ($, on) => {
  await start($, on, WIN, { store: { position: 'above' } })
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Box' })).some((b: any) => b.key === 'r1c0')).toBe(true)
  await hint.unmount()
  const band = await mountBand($, 140)
  expect((await band.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))).toBe(false)
  await band.unmount()
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
  // 完整版 (140 列, 附加 7 列) 和中等版 (73 列, 附加 11 列): "30m用完"
  for (const cols of [140, 73]) {
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
  // 中等版窄的时候 (65 列, 附加 5 列) 连 "30m用完" 也放不下: 照常写暗色的重置倒计时 (3h00m), 只有百分比红
  const mid = await mountHint($, 'terminal', 65)
  const m5 = await meterOf(mid, 'h5')
  expect(m5.extra?.text).toBe('3h00m')
  expect(m5.extra?.color).toBe('#71717a')
  expect(m5.pct?.color).toBe('#f87171')
  await noOld(mid)
  await mid.unmount()
  // 精简版: 只有 5小时 那个百分比是红的 (上下文 82% 不是)
  const narrow = await mountHint($, 'terminal', 45)
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
  const late90 = await mountHint($, 'terminal', 73)
  expect((await meterOf(late90, 'h5')).extra?.text).toBe('2h00m用完')
  await late90.unmount()
  // 负路径: 配速正常时没有 "用完", 百分比不红, 文字只是暗色的重置倒计时
  usage = { ...USAGE, rateLimits: [lim('five_hour', 23.5, t + 2 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  for (const cols of [140, 73, 45]) {
    const ok = await mountHint($, 'terminal', cols)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => x.text.includes('用完'))).toBe(false)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => /^\d+%$/.test(x.text.trim()) && x.props.color === '#f87171')).toBe(false)
    if (cols !== 45) {
      const o5 = await meterOf(ok, 'h5')
      expect(o5.extra?.text).toBe('2h00m')
      expect(o5.extra?.color).toBe('#71717a')
    }
    await noOld(ok)
    await ok.unmount()
  }
})

test('大螃蟹的精灵 (散步道里那只) 的情绪: 悠闲戴墨镜、冒汗有汗滴、慌张举钳加 "!"; 客户端 SVG 也画出来', () => {
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
  for (const cols of [140, 65, 45]) {
    const ui = await mountHint($, 'terminal', cols)
    const btn: any = await ui.find({ type: 'Button', key: 'btn-compact' })
    expect(btn?.props.label).toBe('压缩')
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    if (cols !== 45) widths[cols] = await cellWidth(ui, cols === 140 ? 'r2c0' : 'r1c1')
    await ui.unmount()
  }
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-compact' })
  await ui.press({ key: 'btn-compact' })
  expect(calls.cmd.filter(c => c === 'compact').length).toBe(1)
  await ui.unmount()
  // 负路径: 50% 时没有按钮, 但那一格的总宽度和有按钮时一样
  usage = { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }
  for (const cols of [140, 65]) {
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
  for (const cols of [140, 65]) {
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
  expect((await c.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-ctx')).toBe(true) // 精简版 (一行, 没有螃蟹)
  expect(await c.find({ type: 'Raster' })).toBeUndefined()
  await c.unmount()
  await $.command.run({ command: 'hud' } as any)
  await $.command.run({ command: 'hud' } as any)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-effort' })
  await ui.press({ key: 'btn-effort' })
  expect(calls.cmd.filter(c => c === 'effort').length).toBe(1)
  await ui.unmount()
})

test('大螃蟹的精灵 (面板那套, v0.16 起画在散步道里) 不带子代理小螃蟹; 客户端 SVG 仍画 n 只', () => {
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

test('新按钮 ([压缩] / +1代理 / 档位) 放进去后, 从 51 到 200 列每一格的内容都不超出格子宽度', async ($, on) => {
  await start($, on)
  for (const cols of [51, 53, 65, 70, 73, 80, 81, 83, 101, 118, 123, 140, 200]) {
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
  // 列数 = 旧版 (有螃蟹时) 的列数减 17, 格子几何不变; 48 列是精简版 (一行放不下本周, 只看 5小时)
  for (const cols of [183, 123, 101, 88, 83, 73, 65, 48]) {
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
      if (cols >= 51) {
        const w = await tickOf(ui, 'wk')
        expect(w.idx).toEqual([Math.min(w.bw - 1, Math.round((days / 7) * w.bw))])
        expect(w.cells[w.idx[0]].color).toBe('#e5e5e5')
      }
      // 负路径: 上下文那根没有刻度
      const c = await tickOf(ui, 'ctx')
      expect(c.bw > 0 && c.idx.length === 0).toBe(true)
      for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      seen.push(a.idx[0])
      await ui.unmount()
    }
    expect(seen[1] > seen[0] ? 'ok' : `${cols} 列: 刻度没有右移 ${seen}`).toBe('ok')
  }
  // 刻度在彩色段里 (用量超过时间) 和暗色段里 (用量落后) 都是同一种亮色; 123 列 (旧版 140 列) 5小时 的条 17 格
  // 百分比有滚动过渡: 多画几次, 等 5小时 的数字停到目标值再看彩色段
  const settled = async (want: string) => {
    for (let i = 0; i < 40; i++) {
      const ui = await mountHint($, 'terminal', 123)
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
    const hot = await mountHint($, 'terminal', 123)
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
  for (const cols of [123, 65, 48]) {
    const none = await mountHint($, 'terminal', cols)
    const nh = await tickOf(none, 'h5')
    expect(nh.bw > 0 && nh.idx.length === 0).toBe(true)
    if (cols >= 51) expect((await tickOf(none, 'wk')).idx.length).toBe(1)
    await none.unmount()
  }
})

// 宽度测试用的三种读数: 上下文 82% (有 [压缩] 按钮) / 5小时 会用完 / 上下文 50% (没按钮)
const widthUsages = (t: number) => [
  { ...USAGE },
  { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] },
  { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } },
]

// 注意: 面板宽度 = 终端列数 - 2, 所以 81 列起是完整版, 51-80 列是中等版 (v0.16 面板没有螃蟹, 比旧版各少 17 列)
test('完整版: 上下文 / 5小时 / 本周 三格总宽都正好等于列宽; 5小时/本周 附加 7 列, 省下的给条', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  for (const u of widthUsages(t)) {
    usage = u
    for (const cols of [81, 87, 88, 100, 102, 123, 183]) {
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
        // 上下文附加 11 列时 (102 列起), 5小时/本周 的条比它长 4 格
        if (cols >= 102) expect(ms[1].cells.length - ms[0].cells.length).toBe(4)
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
    for (const cols of [51, 59, 65, 73, 80]) {
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

// ======================== v0.14-v0.16: 螃蟹散步道 (输入框正上方的横栏; v0.16 起是 Client 模块 walkway.tsx) ========================

// 散步道里还会出现气泡的「」和 ！, 以及盲文点粒子
const SAFE3 = /^[\x20-\x7E一-鿿，│█▀▄▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓·「」！⠁-⣿]*$/
const KID_C = 0xf2a07b
const KID_L = 0xa4553d
const BODY = 0xd97757
const EYE = 0x1c1917
const isBraille = (ch: string) => ch.length > 0 && ch.codePointAt(0)! > 0x2800 && ch.codePointAt(0)! <= 0x28ff
const popcount = (n: number) => n.toString(2).replace(/0/g, '').length

async function mountAbove($: any, cols: number, maxRows: number, o: { working?: boolean; fullscreen?: boolean; survey?: boolean } = {}) {
  return $.ui.mount({
    plugin: 'usage-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols + 5, rows: 40, isFullscreen: o.fullscreen ?? true },
    props: { hasSurvey: !!o.survey, isWorking: !!o.working, maxRows, bodyColumns: cols, scroll: { top: 0, bodyRows: maxRows, totalRows: 4 }, view: {} },
  } as any)
}
// Client 画出来的散步道: 每行一个 Box, 里面几段 Text -> 还原成每一格 (字符 + 颜色) 和半格像素
type WCell = { ch: string; fg?: number; bg?: number }
async function walkOf(ui: any) {
  const client: any = await ui.find({ type: 'Client' })
  const root: any = await ui.find({ in: 'walkway', type: 'Box', key: 'walk' })
  const num = (c?: string) => (c ? parseInt(c.slice(1), 16) : undefined)
  const rows: WCell[][] = (root?.children ?? []).map((row: any) => {
    const cells: WCell[] = []
    for (const t of row.children ?? []) {
      const fg = num(t.props?.color)
      const bg = num(t.props?.backgroundColor)
      for (const ch of (t.children ?? []).filter((x: any) => typeof x === 'string').join('')) {
        cells.push({ ch, fg, bg })
        if (dwT(ch) === 2) cells.push({ ch: '', fg, bg })
      }
    }
    return cells
  })
  const px: number[][] = []
  for (const r of rows) {
    px.push(r.map(c => (c.ch === '▀' ? (c.fg ?? -1) : -1)))
    px.push(r.map(c => (c.ch === '▀' ? (c.bg ?? -1) : c.ch === '▄' ? (c.fg ?? -1) : -1)))
  }
  const text = rows.map(r => r.map(c => c.ch).join(''))
  const dots = rows.map(r => r.filter(c => isBraille(c.ch)).reduce((n, c) => n + popcount(c.ch.codePointAt(0)! - 0x2800), 0))
  // 大螃蟹的身体在哪几列 (身体色; 小螃蟹浅一号、道具别的颜色都不算)
  const crab = [...new Set(px.flatMap(row => row.map((c, x) => (c === BODY ? x : -1)).filter(x => x >= 0)))].sort((a, b) => a - b)
  return { client, rows, px, text, dots, crab, bx: crab.length ? crab[0] : -1 }
}
// 数小螃蟹: 某一行像素里浅橙色的连续段 (两只之间至少空 1 格)
function kidCount(px: number[][], y: number): number {
  const row = px[y] ?? []
  let n = 0
  row.forEach((c, x) => {
    if (c === KID_C && row[x - 1] !== KID_C) n++
  })
  return n
}
const decode = (b64: string) => new Uint32Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer)
const mixDark = (c: number, t: number) => {
  const d = 0x27272a
  const ch = (s: number) => Math.round(((c >> s) & 255) * (1 - t) + ((d >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
const lowUsage = () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } })

test('散步道按 maxRows 退档: >=4 天空行 + 3 行版, 3 天空行 + 2 行版, 2 只有 2 行版, 1 行版, 0 不画; 天空行平时是空的; 宽度不超过 bodyColumns; 没有 Button; 问卷时让位', async ($, on) => {
  await start($, on, WIN, { usage: lowUsage, agents: () => [] })
  for (const cols of [40, 100, 200]) {
    for (const [maxRows, total, sky] of [
      [10, 4, true],
      [4, 4, true],
      [3, 3, true],
      [2, 2, false],
      [1, 1, false],
    ] as Array<[number, number, boolean]>) {
      const ui = await mountAbove($, cols, maxRows)
      const w = await walkOf(ui)
      expect([w.client?.props.width, w.client?.props.height]).toEqual([cols, total])
      expect(w.rows.length).toBe(total)
      for (const r of w.rows) expect(r.length <= cols ? 'ok' : `${cols}: 一行 ${r.length} 格`).toBe('ok')
      // 天空行: 闲着时一个像素都没有 (把上面的正文和螃蟹隔开)
      if (sky) expect(w.text[0].trim()).toBe('')
      expect(w.crab.length > 0).toBe(true)
      expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
      expect((await ui.findAll({ type: 'Button', in: 'walkway' })).length).toBe(0)
      for (const s of w.text) expect(SAFE3.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      await ui.unmount()
    }
  }
  const zero = await mountAbove($, 100, 0)
  expect(await zero.find({ type: 'Client' })).toBeUndefined()
  expect(await zero.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await zero.unmount()
  const survey = await mountAbove($, 100, 10, { survey: true })
  expect(await survey.find({ type: 'Client' })).toBeUndefined()
  await survey.unmount()
})

test('悬停: 指针停到大螃蟹上 -> 立刻停下举钳, 气泡 (用量摘要 + 小贴士) 在停下那一刻定好位置和全文, 不压螃蟹也不出横栏; 离开约 0.5 秒后接着走; 队伍也停', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_200_000
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [{ id: 'k', description: 'k', type: 'x', status: 'running' }] })
  for (const [cols, maxRows] of [
    [120, 4],
    [70, 4],
    [120, 3],
  ]) {
    const ui = await mountAbove($, cols, maxRows)
    await clock.advance(10)
    await ui.advance(3000) // 子代理在跑: 大螃蟹在走
    const w0 = await walkOf(ui)
    await ui.advance(450)
    const w1 = await walkOf(ui)
    expect(w1.bx !== w0.bx).toBe(true)
    // 指针移到大螃蟹的格子上
    const top = maxRows >= 3 ? 1 : 0
    await ui.pointer({ type: 'move', x: w1.bx + 2, y: top + 1, in: 'walkway' } as any)
    const h0 = await walkOf(ui)
    const tipRow = h0.text[top]
    expect(tipRow.includes('上下文 50%') ? 'ok' : `${cols}x${maxRows}: 没有气泡 "${tipRow}"`).toBe('ok')
    await ui.advance(1500)
    const h1 = await walkOf(ui)
    expect(h1.bx).toBe(h0.bx) // 停着
    expect(h1.text[top]).toBe(h0.text[top]) // 气泡不重算
    // 气泡不压螃蟹: 气泡那几格 (字的颜色, 连着的一段) 没有螃蟹的身体
    const cellsTop = h1.rows[top]
    const start0 = cellsTop.findIndex(c => c.ch === '上')
    let end0 = start0
    while (end0 < cellsTop.length && cellsTop[end0].fg === 0xd4d4d8 && !'▀▄'.includes(cellsTop[end0].ch || 'x')) end0++
    expect(start0 >= 0 && end0 > start0).toBe(true)
    expect(h1.crab.some(x => x >= start0 && x < end0) ? `${cols}x${maxRows}: 气泡 ${start0}-${end0} 压到螃蟹 ${h1.crab}` : 'ok').toBe('ok')
    expect(end0 <= cols).toBe(true)
    if (maxRows >= 4) expect(h1.px[top * 2][h1.bx + 11]).toBe(BODY) // 3 行版: 右钳举到最上面一行
    // 队伍也停: 小螃蟹的像素不动
    expect(JSON.stringify(h1.px.map(r => r.map(c => (c === KID_C ? 1 : 0))))).toBe(JSON.stringify(h0.px.map(r => r.map(c => (c === KID_C ? 1 : 0)))))
    // 指针离开: 约 0.5 秒后接着走, 气泡收起
    await ui.pointer({ type: 'leave', x: w1.bx + 2, y: top + 1, in: 'walkway' } as any)
    await ui.advance(300)
    expect((await walkOf(ui)).bx).toBe(h0.bx)
    await ui.advance(1200)
    const after = await walkOf(ui)
    expect(after.bx !== h0.bx).toBe(true)
    expect(after.text[top].includes('上下文 50%')).toBe(false)
    // 按下不做任何事 (不会停, 也不报错)
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'walkway' } as any)
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'walkway' } as any)
    await ui.unmount()
  }
})

test('悬停: 指针在横栏别处时大螃蟹不停 (闲着时眼睛看过去); 不是全屏也照样能画 (没有指针事件就没有悬停)', async ($, on) => {
  const T = 1_900_000_200_000
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [{ id: 'k', description: 'k', type: 'x', status: 'running' }] })
  const ui = await mountAbove($, 120, 4)
  await clock.advance(10)
  await ui.advance(1500)
  const w0 = await walkOf(ui)
  await ui.pointer({ type: 'move', x: w0.bx > 40 ? 2 : 117, y: 2, in: 'walkway' } as any)
  await ui.advance(900)
  expect((await walkOf(ui)).bx !== w0.bx).toBe(true)
  await ui.unmount()
  const main = await mountAbove($, 120, 4, { fullscreen: false })
  expect((await walkOf(main)).crab.length > 0).toBe(true)
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
      if (room >= tipMin) expect(t.includes('小贴士 /hud') ? 'ok' : `第 ${k} 条, ${room} 格: 没有小贴士 "${t}"`).toBe('ok')
    }
    expect(fit(140).includes('2h00m 重置') && fit(140).includes('小贴士 /hud')).toBe(true)
  }
})

test('大螃蟹就是面板那只: 有工具在跑时停下原地做这个工具的动作, 道具画在右边 (读文件看纸 / 跑命令终端 / 上网地球); 在想时照旧走, 头顶冒思考点点进天空行', () => {
  const props: Array<[string, number]> = [
    ['read', 0xd4d4d8],
    ['edit', 0xd4d4d8],
    ['bash', 0x3f3f46],
    ['web', 0x3b82f6],
  ]
  for (const [tool, color] of props) {
    const r = previewLane({ w: 80, sky: true, frames: 30, working: true, tool: f => (f >= 10 ? (tool as any) : '') })
    // 工具开始后: 停下, 姿势是 tool
    for (let f = 11; f < 30; f++) {
      expect(r.frames[f].pose).toBe('tool')
      expect(r.frames[f].bx).toBe(r.frames[11].bx)
    }
    // 道具在螃蟹右边 3 列 (bx+12..14), 和面板里一样
    const fr = r.frames[20]
    const zone = fr.px.flatMap(row => row.slice(fr.bx + 12, fr.bx + 15))
    expect(zone.includes(color) ? 'ok' : `${tool}: 道具区没有 ${color.toString(16)}`).toBe('ok')
    // 走路的时候道具区是空的
    const wf = r.frames[5]
    expect(wf.pose).toBe('walk')
    expect(wf.px.flatMap(row => row.slice(wf.bx + 12, wf.bx + 15)).every(c => c === -1)).toBe(true)
  }
  // 小螃蟹在大螃蟹用工具时停下, 原地慢慢跳 (每 5 帧起落一次)
  const k = previewLane({ w: 90, sky: true, frames: 60, working: true, running: () => ['a', 'b'], tool: f => (f >= 30 ? 'read' : '') })
  const kidTop = (fr: any) => fr.px.findIndex((row: number[]) => row.includes(KID_C))
  const tops = k.frames.slice(32, 60).map(kidTop)
  expect(new Set(tops).size).toBe(2)
  let same = 0
  for (let i = 1; i < tops.length; i++) if (tops[i] === tops[i - 1]) same++
  expect(same * 2 > tops.length).toBe(true) // 慢: 相邻帧大多不变
  expect(new Set(k.frames.slice(32, 60).map(fr => fr.kids.map(q => q.x).join(','))).size).toBe(1) // 不走
  // 在想 (主会话在跑, 没有工具): 走, 头顶冒思考点点, 往上飘进天空行
  const t = previewLane({ w: 80, sky: true, frames: 60, working: true, tool: '' })
  const thought = mixDark(t.colors.thought, 0.2)
  expect(t.frames.some(fr => fr.pt.some(p => p.color === thought && p.y < 0 && p.sky))).toBe(true)
  expect(t.frames.some(fr => fr.bx !== t.frames[0].bx)).toBe(true)
  // 没有天空行: 不冒点点
  const n = previewLane({ w: 80, frames: 60, working: true, tool: '' })
  expect(n.frames.every(fr => fr.pt.every(p => p.color !== thought))).toBe(true)
})

test('情绪照面板: 悠闲闲着戴墨镜, 冒汗有汗滴, 慌张出 "!", 上下文 >=80% 身体变红; 一轮结束举钳; 睡着闭眼', () => {
  const at = (px: number[][], x: number, y: number) => px[y]?.[x]
  const chill = previewLane({ w: 60, frames: 10, working: false, mood: 'chill' })
  expect(chill.frames.every(fr => at(fr.px, fr.bx + 3, 1) === 0x09090b)).toBe(true) // 墨镜
  const sweat = previewLane({ w: 60, frames: 24, working: true, mood: 'sweat' })
  expect(sweat.frames.some(fr => fr.px.flat().includes(0x60a5fa))).toBe(true) // 汗滴
  const panic = previewLane({ w: 60, frames: 24, working: false, mood: 'panic' })
  expect(panic.frames.some(fr => fr.px.flat().includes(0xef4444))).toBe(true) // "!"
  const hot = previewLane({ w: 60, frames: 4, working: false, pct: 85 })
  expect(hot.frames[0].px.flat().includes(0xe5484d) && !hot.frames[0].px.flat().includes(BODY)).toBe(true)
  const cel = previewLane({ w: 60, frames: 6, working: false, celebrating: true })
  expect(cel.frames.every(fr => at(fr.px, fr.bx, 0) === BODY || at(fr.px, fr.bx, 1) === BODY)).toBe(true) // 左钳举起
  const sleep = previewLane({ w: 60, frames: 30, working: false, sleeping: true })
  expect(sleep.frames.every(fr => fr.pose === 'sleep' && !fr.px.flat().includes(EYE))).toBe(true)
})

test('小螃蟹: 7x4 (比大螃蟹小一大截), 眼睛四周都是身体, 看前面时也只在身体里挪; N 只互不重叠也不贴住; 每帧最多挪 1 格; 碰到两端整队掉头; 放不下记 +N', { timeoutMs: 30_000 }, () => {
  for (const n of [1, 3, 5]) {
    for (const mood of ['chill', 'panic'] as const) {
      const ids = Array.from({ length: n }, (_, i) => 'k' + i)
      const r = previewLane({ w: 100, sky: true, frames: 300, working: true, mood, running: () => ids })
      const dirs = new Set<number>()
      r.frames.forEach((fr, f) => {
        expect(fr.kids.length).toBe(n)
        const xs = [fr.bx, ...fr.kids.map(k => k.x)]
        for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i] >= r.kw + 1 ? 'ok' : `n=${n} f=${f} 挨得太近 ${xs}`).toBe('ok')
        if (f > 0) {
          const prev = [r.frames[f - 1].bx, ...r.frames[f - 1].kids.map(k => k.x)]
          xs.forEach((x, i) => expect(Math.abs(x - prev[i]) <= 1).toBe(true))
        }
        dirs.add(fr.dir)
        // 每只小螃蟹的眼睛: 上下左右都是身体
        for (const k of fr.kids) {
          if (k.x < 1 || k.state !== 'walk') continue
          const eyes: Array<[number, number]> = []
          fr.px.forEach((row, y) => row.forEach((c, x) => c === EYE && x >= k.x && x < k.x + 7 && eyes.push([x, y])))
          expect(eyes.length).toBe(2)
          for (const [x, y] of eyes) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(fr.px[y + dy][x + dx]).toBe(KID_C)
        }
      })
      expect(dirs.size).toBe(2)
    }
  }
  expect(previewLane({ w: 100, sky: true, frames: 1 }).kw).toBe(7)
  const many = previewLane({ w: 60, sky: true, frames: 5, running: () => Array.from({ length: 12 }, (_, i) => 'k' + i) })
  expect(many.frames[4].kids.length).toBe(many.cap)
  expect(many.frames[4].hidden).toBe(12 - many.cap)
})

test('大螃蟹一直有动静: 主会话或子代理在跑都走 (速度跟心情); 全闲时隔 20-40 秒溜达 3-8 格再东张西望', () => {
  const moves = (o: any) => {
    const r = previewLane({ w: 120, sky: true, frames: 120, ...o })
    return r.frames.filter((fr, f) => f > 0 && fr.bx !== r.frames[f - 1].bx).length
  }
  expect(moves({ working: false, running: () => ['a'] }) > 20).toBe(true)
  const m = ['chill', 'normal', 'sweat', 'panic'].map(mood => moves({ working: true, mood }))
  expect(m[0] < m[1] && m[1] < m[2] && m[2] < m[3] ? 'ok' : 'speeds ' + m).toBe('ok')
  const idle = previewLane({ w: 80, sky: true, frames: 420, working: false })
  const stepAt = idle.frames.map((fr, f) => (f && fr.bx !== idle.frames[f - 1].bx ? f : -1)).filter(f => f >= 0)
  expect(stepAt[0] >= 133 && stepAt[0] <= 270 ? 'ok' : 'first stroll at ' + stepAt[0]).toBe('ok')
  const first = stepAt.filter(f => f < stepAt[0] + 30)
  expect(first.length >= 3 && first.length <= 8).toBe(true)
  const stop = first[first.length - 1]
  expect(idle.frames[stop + 2].pose).toBe('idle')
  const eyesAt = (fr: any) => JSON.stringify(fr.px.map((row: number[]) => row.map((c, x) => (c === EYE ? x : -1)).filter(x => x >= 0)))
  expect(new Set(idle.frames.slice(stop + 1, stop + 20).map(eyesAt)).size > 1).toBe(true)
})

test('散步道: 打字时停下低头 (眼睛往下), 停手约 1.5 秒恢复; 发出消息跳一下 (蹲 / 腾空 / 落地), 落地冒尘土', () => {
  const r = previewLane({ w: 80, sky: true, frames: 50, working: true, typing: f => f >= 10 && f < 30 })
  for (let f = 11; f < 30; f++) {
    expect(r.frames[f].pose).toBe('type')
    expect(r.frames[f].bx).toBe(r.frames[10].bx)
  }
  const eyeRows = (fr: any) => fr.px.map((row: number[], y: number) => (row.includes(EYE) ? y : -1)).filter((y: number) => y >= 0)
  expect(eyeRows(r.frames[20]).every((y: number) => y >= 2 + 3)).toBe(true) // 天空行 2 像素 + 低头: 眼睛在螃蟹区第 3 行
  expect(r.frames[35].pose).toBe('walk')
  const j = previewLane({ w: 80, sky: true, frames: 12, working: false, jumpAt: 3 })
  expect(j.frames.slice(3, 7).map(fr => fr.pose)).toEqual(['jump', 'jump', 'jump', 'jump'])
  expect(j.frames[2].pt.length).toBe(0)
  const landed = j.frames[6].pt.filter(p => p.color === j.dust).length
  expect(landed >= 4 && landed <= 6).toBe(true) // 落地冒 4-6 粒
  expect(j.frames[7].pose).toBe('idle')
  expect(j.frames[4].px[2 + 5].filter(c => c === BODY).length).toBe(0) // 腾空: 最下面一行没有腿
})

test('粒子: 走路时同时 3-5 粒尘土 (小跑 5-7 粒), 方向散开不排成一行; 不超过 24 个; 都在横栏里; 只有往上飘的进天空行; 只画在空格子里; 每帧最多挪 1 个点位, 颜色不跳; 静止时没有', { timeoutMs: 30_000 }, () => {
  const dustCount = (fr: any, dust: number) => fr.pt.filter((p: any) => p.color === dust).length
  for (const [mood, lo, hi] of [
    ['normal', 3, 5],
    ['panic', 5, 7],
  ] as Array<[any, number, number]>) {
    const r = previewLane({ w: 100, sky: true, frames: 120, working: true, mood, tool: '' })
    const counts = r.frames.slice(20).map(fr => dustCount(fr, r.dust))
    const ok = counts.filter(c => c >= lo && c <= hi).length
    expect(ok >= counts.length * 0.8 ? 'ok' : `${mood}: 只有 ${ok}/${counts.length} 帧在 ${lo}-${hi} 粒 (${counts.join(',')})`).toBe('ok')
    // 不全在同一行
    expect(r.frames.slice(20).some(fr => new Set(fr.pt.filter((p: any) => p.color === r.dust).map((p: any) => p.y >> 2)).size > 1 || new Set(fr.pt.map((p: any) => p.y)).size > 1)).toBe(true)
  }
  const check = (r: any, label: string) => {
    let any = 0
    r.frames.forEach((fr: any, f: number) => {
      expect(fr.pt.length <= r.max).toBe(true)
      for (const p of fr.pt) {
        expect(p.x >= 0 && p.x < 100 * 2 && p.y < 12 && p.y >= -4).toBe(true)
        if (p.y < 0) expect(p.sky ? 'ok' : `${label}: 尘土进了天空行`).toBe('ok')
      }
      const w = decode(fr.cells)
      for (let i = 0; i < w.length / 3; i++) {
        const ch = w[i * 3]
        if (ch >= 0x2800 && ch <= 0x28ff) {
          any++
          expect(ch > 0x2800).toBe(true)
          const x = i % 100
          const row = Math.floor(i / 100)
          expect(fr.px[row * 2][x] === -1 && fr.px[row * 2 + 1][x] === -1).toBe(true)
        }
      }
      if (f > 0)
        for (const q of fr.pt) {
          if (q.age === 0) continue
          const from = r.frames[f - 1].pt.find((p: any) => p.age === q.age - 1 && p.color === q.color && Math.abs(p.x - q.x) + Math.abs(p.y - q.y) <= 1)
          expect(from ? 'ok' : `${label} f=${f}: 粒子跳了`).toBe('ok')
        }
    })
    return any
  }
  expect(check(previewLane({ w: 100, sky: true, frames: 150, working: true }), 'walk') > 0).toBe(true)
  expect(check(previewLane({ w: 100, sky: true, frames: 150, working: true, mood: 'panic', running: () => ['a', 'b'] }), 'trot') > 0).toBe(true)
  const cel = previewLane({ w: 100, sky: true, frames: 20, working: false, celebrating: f => f >= 2 && f < 12 })
  expect(check(cel, 'celebrate') > 0).toBe(true)
  const gold = mixDark(cel.colors.spark, 0.25)
  const peak = Math.max(...cel.frames.map(fr => fr.pt.filter((p: any) => p.color === gold).length))
  expect(peak >= 6 && peak <= 10 ? 'ok' : '庆祝闪光最多 ' + peak).toBe('ok')
  expect(cel.frames.some(fr => fr.pt.some((p: any) => p.color === gold && p.y < 0))).toBe(true) // 往上飘进天空行
  // 静止 (闲着趴着, 还没到溜达的时候): 一个粒子都没有
  expect(previewLane({ w: 100, sky: true, frames: 120, working: false }).frames.every(fr => fr.pt.length === 0)).toBe(true)
  // 小螃蟹离场: 跳出顶边的地方冒一小团 (4-6 粒)
  const leave = previewLane({ w: 100, sky: true, frames: 60, working: false, running: f => (f < 5 ? ['a', 'b'] : ['a']) })
  const gone = leave.frames.findIndex((fr, f) => f > 5 && fr.kids.length === 1)
  const puff = leave.frames[gone].pt.filter((p: any) => p.color === leave.dust && p.age === 0 && p.y <= 1).length
  expect(gone > 0 && puff >= 4 && puff <= 6).toBe(true)
})

test('粒子接上真的横栏 (mock.clock + 散步道帧钟): 主会话在跑时连续 100 帧, 热身之后至少 80% 的帧里同时有 3-5 粒尘土, 而且不全在同一行', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_200_000
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [] })
  const ui = await mountAbove($, 140, 4, { working: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(10)
  const counts: number[] = []
  const rows: number[] = []
  for (let i = 0; i < 100; i++) {
    await ui.advance(150)
    const w = await walkOf(ui)
    // 尘土 = 天空行以下的盲文点 (天空行里只有思考点点)
    counts.push(w.dots.slice(1).reduce((a, b) => a + b, 0))
    rows.push(w.dots.slice(1).filter(n => n > 0).length)
  }
  const warm = counts.slice(15)
  const ok = warm.filter(c => c >= 3 && c <= 5).length
  expect(ok >= warm.length * 0.8 ? 'ok' : `只有 ${ok}/${warm.length} 帧在 3-5 粒 (${warm.join(',')})`).toBe('ok')
  expect(rows.slice(15).some(n => n > 1)).toBe(true)
  await ui.unmount()
})

test('散步道: 子代理结束后那只挥手约 1.5 秒, 然后离场 (3 行版往上跳出顶边, 2 行版走上面那行; 不和队里的重叠); 1 行版挥完直接消失', () => {
  const end = 20
  const r3 = previewLane({ w: 90, sky: true, frames: 60, working: true, running: f => (f < end ? ['a', 'b', 'c'] : ['a', 'c']) })
  const st = (r: any, f: number) => r.frames[f].kids.find((k: any) => k.id === 'b')?.state ?? (r.frames[f].gone.some((k: any) => k.id === 'b') ? 'exit' : 'none')
  expect(st(r3, end - 1)).toBe('walk')
  for (let f = end; f < end + 9; f++) expect(st(r3, f)).toBe('wave')
  expect(st(r3, end + 11)).toBe('hop')
  const out3 = r3.frames.findIndex((fr, f) => f > end && st(r3, f) === 'none')
  expect(out3 > 0 && (out3 - end) * 150 <= 3000).toBe(true)
  for (let f = end; f < out3; f++) {
    const xs = [r3.frames[f].bx, ...r3.frames[f].kids.map(k => k.x)]
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i] >= 8).toBe(true)
  }
  // 跳出去的那只不进天空行
  for (let f = end; f < out3; f++) expect(r3.frames[f].px[0].concat(r3.frames[f].px[1]).includes(KID_C)).toBe(false)
  const r2 = previewLane({ w: 80, rows: 2, frames: 120, working: true, running: f => (f < end ? ['a', 'b', 'c'] : ['a', 'c']) })
  expect(st(r2, end + 11)).toBe('exit')
  const out2 = r2.frames.findIndex((fr, f) => f > end && st(r2, f) === 'none')
  expect(out2 > 0 && (out2 - end) * 150 <= 10_000).toBe(true)
  const one = previewLane({ w: 80, rows: 1, frames: 40, working: true, running: f => (f < end ? ['a', 'b'] : ['a']) })
  expect(kidCount(one.frames[end + 12].px, 0)).toBe(1)
})

test('散步道接上真的子代理: 3 个运行中画 3 只; 只有子代理在跑时大螃蟹也在走; 结束的那只几秒内离场 (mock.clock + 散步道帧钟)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let list: any[] = ['a', 'b', 'c'].map(id => ({ id, description: id, type: 'Explore', status: 'running' }))
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => list, usage: lowUsage })
  const ui = await mountAbove($, 110, 4)
  await clock.advance(10)
  await ui.advance(3000)
  const a = await walkOf(ui)
  expect(kidCount(a.px, 2 + 4)).toBe(3) // 天空行 2 像素 + 小螃蟹第 3 行 (最宽那行下面一行)
  await ui.advance(1500)
  expect((await walkOf(ui)).bx !== a.bx).toBe(true)
  list = list.map(k => (k.id === 'b' ? { ...k, status: 'completed' } : k))
  await clock.advance(200) // hooks 每帧重画 (有子代理时), 子代理列表跟着更新
  await ui.advance(5000)
  expect(kidCount((await walkOf(ui)).px, 2 + 4)).toBe(2)
  await ui.unmount()
})

test('5 分钟没有任何动静才睡; 子代理在跑不算闲; 打字时停下, 约 1.5 秒后接着走 (mock.clock + 散步道帧钟)', { timeoutMs: 60_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let list: any[] = []
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => list, usage: lowUsage })
  const ui = await mountAbove($, 110, 4)
  const peek = async () => {
    const w = await walkOf(ui)
    return { open: w.px.flat().includes(EYE), x: w.bx }
  }
  await ui.advance(4 * 60_000)
  expect((await peek()).open).toBe(true)
  await ui.advance(61_500)
  expect((await peek()).open).toBe(false) // 5 分钟没动静: 睡着 (闭眼)
  const typed = (text: string) => $.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: 'x' } as any)
  await clock.advance(1000)
  await typed('')
  await ui.advance(150)
  expect((await peek()).open).toBe(true) // 打字把它叫醒 (低头看输入框)
  // 子代理在跑: 大螃蟹走; 打字的那 1.5 秒里停下, 之后接着走
  list = [{ id: 'k', description: 'k', type: 'Explore', status: 'running' }]
  await $.classic.SubagentStart({ agent_id: 'k', agent_type: 'Explore' } as any)
  await clock.advance(200)
  await ui.advance(1800)
  const x1 = (await peek()).x
  await ui.advance(900)
  expect((await peek()).x !== x1).toBe(true)
  await clock.advance(1000)
  await typed('x')
  await ui.advance(150)
  const t0 = (await peek()).x
  await ui.advance(1050)
  expect((await peek()).x).toBe(t0)
  await ui.advance(1500)
  expect((await peek()).x !== t0).toBe(true)
  // 子代理一直在跑: 6 分钟后也没睡, 还在走
  await ui.advance(6 * 60_000)
  const x2 = (await peek()).x
  await ui.advance(900)
  expect((await peek()).x !== x2).toBe(true)
  await ui.unmount()
})

test('气泡: 一轮结束「搞定 12s」, 约 5 秒后消失; 新的顶掉旧的 (压缩完了 / 额度刷新了); 放在螃蟹旁边, 不压螃蟹, 不进天空行', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let usage: any = { ...lowUsage(), rateLimits: [lim('five_hour', 40, T + 30_000), lim('seven_day', 12, T + 3 * 24 * H)] }
  const calls = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => usage })
  const clock = calls.clock
  const ui = await mountAbove($, 120, 4)
  const bubble = async () => {
    const w = await walkOf(ui)
    const row = w.text.findIndex(t => t.includes('「'))
    if (row < 0) return undefined
    const x = [...w.text[row]].findIndex(ch => ch === '「')
    const text = w.text[row].slice(w.text[row].indexOf('「'), w.text[row].indexOf('」') + 1)
    const start0 = w.rows[row].findIndex(c => c.ch === '「')
    return { row, x, text, start: start0, crab: w.crab }
  }
  await ui.advance(300)
  expect(await bubble()).toBeUndefined()
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(12_000)
  await $.turn.complete({ answer: '', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await clock.advance(2_200) // v0.16.2: 结束后约 2 秒没有新的一段才算做完
  await ui.advance(150)
  const b = await bubble()
  expect(b?.text).toBe('「搞定 12s」')
  expect(b?.row).toBe(1) // 螃蟹区第一行, 不进天空行
  expect(b!.crab.some(x => x >= b!.start && x < b!.start + dwT(b!.text))).toBe(false)
  await ui.advance(3900)
  expect((await bubble())?.text).toBe('「搞定 12s」')
  await ui.advance(1500)
  expect(await bubble()).toBeUndefined()
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
  await clock.advance(200)
  await ui.advance(150)
  expect((await bubble())?.text).toBe('「压缩完了」')
  expect(calls.toasts.some(x => x.includes('额度已恢复'))).toBe(false)
  await clock.advance(20_000) // 重置时刻 (T+30s) 过了, 约每 6 秒查一次
  expect(calls.toasts).toContain('5 小时额度已恢复，可以继续了')
  await ui.advance(150)
  expect((await bubble())?.text).toBe('「额度刷新了」')
  await ui.unmount()
})

test('气泡: 配速变成会用完说一次红色「慢点！…用完」(每个窗口一次); 上下文第一次到 75% 说「上下文快满了」; 等你批准权限说「等你点头」', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let usage: any = { ...lowUsage(), rateLimits: [lim('five_hour', 10, T + 3 * H), lim('seven_day', 12, T + 3 * 24 * H)] }
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => usage })
  const ui = await mountAbove($, 120, 4)
  const bubble = async () => {
    await clock.advance(200) // hooks 重画, 推新 props
    await ui.advance(150)
    const w = await walkOf(ui)
    const row = w.text.findIndex(t => t.includes('「'))
    if (row < 0) return undefined
    const t = w.text[row]
    const i = w.rows[row].findIndex(c => c.ch === '「')
    return { text: t.slice(t.indexOf('「'), t.indexOf('」') + 1), color: w.rows[row][i].fg }
  }
  expect(await bubble()).toBeUndefined()
  usage = { ...usage, rateLimits: [lim('five_hour', 50, T + 3 * H), lim('seven_day', 12, T + 3 * 24 * H)] }
  await ui.redraw()
  const slow = await bubble()
  expect(slow?.text).toBe('「慢点！2h00m用完」')
  expect(slow?.color).toBe(0xf87171)
  await ui.advance(5500)
  expect(await bubble()).toBeUndefined()
  usage = { ...usage, context: { tokens: 160_000, window: 200_000, percent: 80 } }
  await ui.redraw()
  expect((await bubble())?.text).toBe('「上下文快满了」')
  await ui.advance(5500)
  expect(await bubble()).toBeUndefined()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any)
  expect((await bubble())?.text).toBe('「等你点头」')
  await ui.advance(5500)
  await $.classic.Notification({ message: 'idle', notification_type: 'idle_prompt' } as any)
  expect(await bubble()).toBeUndefined()
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as any)
  expect((await bubble())?.text).toBe('「等你点头」')
  await ui.unmount()
})

test('/hud crab 关掉后横栏里不画散步道 (存进 store, 重开会话也记得), 再开回来', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'hud', args: 'crab' } as any)
  const off = await mountAbove($, 100, 4)
  expect(await off.find({ type: 'Client' })).toBeUndefined()
  await off.unmount()
  await $.session.start({ cwd: CWD } as any)
  const still = await mountAbove($, 100, 4)
  expect(await still.find({ type: 'Client' })).toBeUndefined()
  await still.unmount()
  await $.command.run({ command: 'hud', args: 'crab on' } as any)
  const on2 = await mountAbove($, 100, 4)
  expect(await on2.find({ type: 'Client' })).toBeDefined()
  await on2.unmount()
})

test('发出消息 (prompt.submit): 螃蟹蹲一下、腾空 (不画腿)、落地冒尘土, 然后回到趴着 (mock.clock + 散步道帧钟)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: lowUsage })
  const ui = await mountAbove($, 110, 4)
  const shot = async () => {
    const w = await walkOf(ui)
    // 大螃蟹最上 / 最下一行像素 (螃蟹区里, 去掉天空行的 2 像素): 趴着 0-4, 蹲和落地 1-5, 腾空 0-3
    const ys = w.px.map((row, y) => (row.some(c => c === BODY) ? y - 2 : -99)).filter(y => y >= 0)
    return { span: [ys[0], ys[ys.length - 1]], dots: w.dots.reduce((a, b) => a + b, 0) }
  }
  await ui.advance(600)
  expect(await shot()).toEqual({ span: [0, 4], dots: 0 })
  const r: any = await $.prompt.submit({ text: 'hi' } as any)
  expect(r.text).toBe('hi')
  await ui.advance(150)
  expect((await shot()).span).toEqual([1, 5]) // 蹲
  await ui.advance(150)
  expect((await shot()).span).toEqual([0, 3]) // 腾空: 不画腿
  await ui.advance(300)
  const land = await shot()
  expect(land.span).toEqual([1, 5])
  expect(land.dots > 0).toBe(true)
  await ui.advance(1500)
  expect(await shot()).toEqual({ span: [0, 4], dots: 0 })
  await ui.unmount()
})

test('工具在跑时 (接上真的横栏): 大螃蟹停下原地做这个工具的动作, 道具画在右边; 工具结束后接着走 (mock.clock + 散步道帧钟)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_200_000
  let open: () => void = () => {}
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [], toolGate: () => new Promise<void>(r => (open = r)) })
  const ui = await mountAbove($, 100, 4, { working: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(10)
  await ui.advance(1500)
  for (const [tool, color] of [
    ['Read', 0xd4d4d8],
    ['Bash', 0x3f3f46],
    ['WebSearch', 0x3b82f6],
  ] as Array<[string, number]>) {
    const call = $.tool.call({ tool, file_path: 'D:\work\my-app\a.ts', command: 'ls', query: 'x' } as any)
    await clock.settle()
    await ui.advance(300)
    const a = await walkOf(ui)
    await ui.advance(900)
    const b = await walkOf(ui)
    expect(b.bx).toBe(a.bx) // 停下
    const zone = b.px.flatMap(row => row.slice(b.bx + 12, b.bx + 15))
    expect(zone.includes(color) ? 'ok' : `${tool}: 螃蟹右边没有道具`).toBe('ok')
    open()
    await call
    await ui.advance(1500)
    expect((await walkOf(ui)).bx !== b.bx).toBe(true) // 工具结束: 接着走 (在想)
  }
  await ui.unmount()
})

// ======================== v0.16.1 / v0.16.2: 后台子代理 (一次提问里主线程结束好几段) ========================
// Claude Code 2.1.289 默认把 Agent 子代理放到后台. 子代理结束后, 它的结果作为一次 prompt.submit 送回主线程
// (origin.kind = 'task-notification'): 主线程闲着时另起一段, 正在跑时塞进这一段 (带 turnId).
// 一次提问 = 从用户自己发消息 (composer) 起; 做完 = 最后一段结束、没有子代理在跑、等约 2 秒没有新的一段
async function bgSetup($: any, on: any) {
  const T = 1_900_000_000_000
  let list: any[] = []
  let usd = 1
  const calls = await start($, on, WIN, { mockClock: T, agents: () => list, usage: () => ({ ...lowUsage(), cost: { usd } }) })
  const clock = calls.clock
  const band = await mountAbove($, 120, 4)
  const props = async () => ((await band.find({ type: 'Client' })) as any)?.props.props
  const kid = (id: string, status = 'running') => ({ id, description: id, type: 'general-purpose', status })
  const ids = new Set<string>()
  const setStatus = () => (list = [...ids].map(id => kid(id, ended.has(id) ? 'completed' : 'running')))
  const ended = new Set<string>()
  return {
    clock,
    band,
    props,
    spend: (d: number) => (usd += d),
    // 用户自己回车 / 后台子代理的结果送回来 (闲着时 or 塞进正在跑的一段)
    userSays: (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as any),
    notice: (intoTurn?: string) => $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' }, ...(intoTurn ? { turnId: intoTurn } : {}) } as any),
    // 主线程派一个后台子代理: Agent 工具马上返回 ("Backgrounded agent"), 子代理接着在后台跑
    spawn: async (id: string) => {
      await $.tool.call({ tool: 'Agent', description: id, prompt: id, run_in_background: true } as any)
      ids.add(id)
      setStatus()
      await $.classic.SubagentStart({ agent_id: id, agent_type: 'general-purpose' } as any)
    },
    finish: async (id: string) => {
      ended.add(id)
      setStatus()
      await $.classic.SubagentStop({ agent_id: id, agent_type: 'general-purpose', agent_transcript_path: '', stop_hook_active: false, last_assistant_message: 'ok' } as any)
    },
  }
}
const done = (turnId: string, durationMs: number) => ({ answer: '', durationMs, isAborted: false, turnId, reason: 'answer' }) as any
const rowText = async ($: any, id: string, durationMs: number) => {
  const r = await mountTurn($, id, durationMs)
  const texts = (await r.findAll({ type: 'Text' })).map((x: any) => x.text)
  await r.unmount()
  return texts.find((t: string) => t.startsWith(' · ')) ?? ''
}

test('实测 1 的顺序: 主线程停下等 2 个子代理, 每结束一个送一次结果 -> 只庆祝一次, N = 整次提问; 最后一行配合计; 送结果不让螃蟹跳', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('读 a.txt 和 b.txt')
  expect((await b.props()).jumpSeq).toBe(p0.jumpSeq + 1) // 用户回车: 跳一下
  await $.turn.start({ text: '读 a.txt 和 b.txt', turnId: 't1' } as any)
  await b.spawn('k1')
  await b.spawn('k2')
  b.spend(0.17)
  await b.clock.advance(13_000)
  await $.turn.complete(done('t1', 13_000)) // "Waiting for 2 background agents to finish"
  expect(await rowText($, 'row-1', 13_000)).toBe(' · $0.17 · 工具 2 次') // 这一段
  await b.clock.advance(2_000)
  await b.finish('k1')
  await b.notice() // k1 的结果送回来 (主线程闲着: 另起一段)
  await $.turn.start({ text: '<task-notification>', turnId: 't2' } as any)
  b.spend(0.01)
  await b.clock.advance(1_000)
  await $.turn.complete(done('t2', 1_000)) // "Worked for 1s"
  expect(await rowText($, 'row-2', 1_000)).toBe(' · $0.01')
  await b.clock.advance(3_000)
  await b.finish('k2') // 最后一个子代理结束, 它的结果还没送到: 不能先庆祝 (等待放宽到约 10 秒)
  await b.clock.advance(3_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.notice()
  await $.turn.start({ text: '<task-notification>', turnId: 't3' } as any)
  await $.tool.call({ tool: 'Write', file_path: CWD + '/summary.md', content: ['1', '2', '3', ''].join(String.fromCharCode(10)) } as any)
  b.spend(0.06)
  await b.clock.advance(5_000)
  await $.turn.complete(done('t3', 5_000))
  // 最后一行: 引擎写整次提问的时长 13+2+1+3+3+5 = 27 秒 -> 整次提问的合计
  expect(await rowText($, 'row-3', 27_000)).toBe(' · $0.24 · 改 1 个文件 +3 -0 · 工具 3 次')
  // 防抖: 刚结束时还不庆祝, 约 2 秒后庆祝一次
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.say?.text).toBe('「搞定 27s」')
  expect(p.jumpSeq).toBe(p0.jumpSeq + 1) // 两次送结果都没让螃蟹跳
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Text' })).some((x: any) => x.text.includes('上一轮 27s，3 次工具'))).toBe(true)
  await hint.unmount()
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('实测 2 的顺序: 主线程不停、先后派 4 个子代理, 最后一个结束时主线程刚好结束一段, 随后来了结果 -> 只庆祝一次, N = 34s; 两行收据各配各的; 迟到的通知不再庆祝', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('把四个文件都读一遍')
  await $.turn.start({ text: '把四个文件都读一遍', turnId: 'm1' } as any)
  await b.spawn('a1')
  await b.spawn('b1')
  await b.clock.advance(5_000)
  await b.finish('a1')
  await b.finish('b1')
  await b.notice('m1') // 结果塞进正在跑的这一段
  await b.notice('m1')
  await b.spawn('a2')
  await b.spawn('b2')
  await b.clock.advance(10_000)
  await b.finish('a2')
  await b.notice('m1')
  b.spend(0.2)
  await b.clock.advance(15_000)
  await b.finish('b2') // 最后一个子代理和这一段同时结束
  await $.turn.complete(done('m1', 30_000)) // "Churned for 30s"
  expect(await rowText($, 'row-30s', 30_000)).toBe(' · $0.20 · 工具 4 次')
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // 0.16.1 在这里提前庆祝了 "搞定 31s"
  await b.notice() // b2 的结果送回来, 主线程又跑一段
  await $.turn.start({ text: '<task-notification>', turnId: 'm2' } as any)
  b.spend(0.01)
  await b.clock.advance(3_000)
  await $.turn.complete(done('m2', 3_000)) // "Churned for 34s"
  expect(await rowText($, 'row-34s', 34_000)).toBe(' · $0.21 · 工具 4 次') // 合计
  await b.clock.advance(2_100)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.say?.text).toBe('「搞定 34s」')
  expect(p.jumpSeq).toBe(p0.jumpSeq + 1) // 只有用户回车那一下
  // 庆祝之后又来了迟到的通知: 接着记账, 不再庆祝
  await b.notice()
  await $.turn.start({ text: '<task-notification>', turnId: 'm3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('m3', 1_000))
  await b.clock.advance(12_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('子代理跑完之前用户又发了新消息 -> 上一次提问作废; 旧子代理的结果后来送到算新提问的接续; 只庆祝一次, N 从新消息算起', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('第一个问题')
  await $.turn.start({ text: '第一个问题', turnId: 'q1' } as any)
  await b.spawn('k1')
  await b.clock.advance(10_000)
  await $.turn.complete(done('q1', 10_000))
  await b.clock.advance(5_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.userSays('第二个问题') // 子代理还在跑, 用户发了新消息: 第一个问题作废
  await $.turn.start({ text: '第二个问题', turnId: 'q2' } as any)
  await b.clock.advance(2_000)
  await $.turn.complete(done('q2', 2_000))
  await b.clock.advance(3_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // k1 还在跑: 先不庆祝
  await b.finish('k1')
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // k1 的结果还没送到
  await b.notice() // 主线程闲着: 结果另起一段, 算第二个问题的接续, 不是新提问
  await $.turn.start({ text: '<task-notification>', turnId: 'q3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('q3', 1_000))
  await b.clock.advance(2_100)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1) // 只庆祝一次
  expect(p.say?.text).toBe('「搞定 7s」') // 从第二个问题算到最后一段结束 (2 + 3 + 1 + 1), 不是从第一个问题算起的 22 秒
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('子代理的结果塞进正在跑的一段 (带 turnId): 这一段结束后约 2 秒庆祝 (欠的通知已到, 不等 10 秒); N = 整次提问; 送结果不跳', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('查一下 c.txt')
  await $.turn.start({ text: '查一下 c.txt', turnId: 'm1' } as any)
  await b.spawn('k1')
  await b.clock.advance(4_000)
  await b.finish('k1')
  const p1 = await b.props()
  await b.notice('m1') // 主线程还在跑: 结果直接塞进这一段, 不会另起一段
  expect((await b.props()).jumpSeq).toBe(p1.jumpSeq)
  await b.clock.advance(2_000)
  await $.turn.complete(done('m1', 6_000))
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.say?.text).toBe('「搞定 6s」')
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('没有子代理的普通提问: 结束后约 2 秒庆祝一次; 结束前再说一句会取消这次等待 (说的是新提问, 从新的算)', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('你好')
  await $.turn.start({ text: '你好', turnId: 'n1' } as any)
  b.spend(0.02)
  await b.clock.advance(3_000)
  await $.turn.complete(done('n1', 3_000))
  expect(await rowText($, 'row-n1', 3_000)).toBe(' · $0.02')
  await b.clock.advance(1_500)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(700)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  expect((await b.props()).say?.text).toBe('「搞定 3s」')
  // 第二个问题: 结束后 1 秒内用户又说了一句 -> 第二个问题不庆祝, 第三个做完才庆祝
  await b.userSays('再来')
  await $.turn.start({ text: '再来', turnId: 'n2' } as any)
  await b.clock.advance(2_000)
  await $.turn.complete(done('n2', 2_000))
  await b.clock.advance(1_000)
  await b.userSays('还有')
  await $.turn.start({ text: '还有', turnId: 'n3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('n3', 1_000))
  await b.clock.advance(2_100)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 2)
  expect((await b.props()).say?.text).toBe('「搞定 1s」')
  await b.band.unmount()
})

// v0.16.2: token 只算主线程和认得的子代理; 引擎自己的分叉 (压缩 / 记忆) 带的 id 谁的列表里都没有, 不算
test('token: 主线程 + 认得的子代理才算, 先到的子代理用量等认出来再补上, 认不出的分叉不算', async ($, on) => {
  const IN: Record<string, number> = { '': 100, 'fork-x': 200, k1: 40 }
  on('turn.step', async function* ($: any, e: any) {
    const n = IN[String(e.agentId ?? '')] ?? 0
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: n, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }
  } as any)
  // 统计脚本跑不起来: 底数为 0, 面板只显示本次启动以来的实时累计, 数字小到能逐个核对
  const calls = await start($, on, { ...WIN, broken: ['node'] }, { agents: () => [] })
  const step = async (agentId?: string) => {
    const it: any = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as any)
    while (!(await it.next()).done) {}
  }
  const detail = async () => {
    const ui = await mountHint($, 'terminal', 140)
    calls.toasts.length = 0
    await ui.press({ key: 'btn-token' })
    await ui.unmount()
    return calls.toasts.find(x => x.includes('token：')) ?? '(没有明细)'
  }
  await step() // 主线程 100
  await step('k1') // 子代理还没登记: 先记着
  await step('fork-x') // 引擎自己的分叉: 一直认不出来
  expect(await detail()).toContain('新输入 100，输出 1')
  await $.classic.SubagentStart({ agent_id: 'k1', agent_type: 'general-purpose' } as any)
  expect(await detail()).toContain('新输入 140，输出 2')
  await step('k1') // 认出来以后直接算
  expect(await detail()).toContain('新输入 180，输出 3')
})
