import { test, expect, mock } from 'claude-code/testing'

const TEXT = '路线文档写好了：\n\n`docs/research/2026-10-04_weekly-report.html`（双击打开）\n\n不存在的 nothere.html 不变链接。'

const CODE_MSG = [
  '先运行这条：',
  '',
  '```bash',
  'claude --resume "my-session"',
  '```',
  '',
  '再看结果：',
  '',
  '```powershell',
  'Get-ChildItem .\\docs',
  'Get-Content a.txt',
  '',
  '```',
  '',
  '完成。',
].join('\n')

const MIXED = [
  '报告在 `docs/report.html`。',
  '',
  '1. 打开终端，运行：',
  '   ```bash',
  '   cd D:\\proj',
  '   npm test',
  '   ```',
  '2. 看结果',
].join('\n')

const NESTED = ['示例：', '````markdown', '```bash', 'echo hi', '```', '````', '~~~', 'plain tilde', '~~~'].join('\n')

// 模拟三种系统: 工作目录、环境变量、是不是 macOS、打不开的命令 (退出码 3)
// root = 项目根目录; files = 只有这些文件存在 (不给就按文件名猜)
type Sys = {
  cwd: string
  root?: string
  env: Record<string, string>
  mac?: boolean
  broken?: string[]
  files?: string[]
  dirs?: string[]
  settings?: Record<string, unknown>
  draft?: string // 输入框里已有的字
}
const WIN: Sys = { cwd: 'D:\\proj', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me' } }
const MAC: Sys = { cwd: '/Users/me/proj', env: { HOME: '/Users/me' }, mac: true }
const LINUX: Sys = { cwd: '/home/me/proj', env: { HOME: '/home/me' }, broken: ['xdg-open'] }
const WSL: Sys = { cwd: '/home/me/proj', env: { HOME: '/home/me', WSL_DISTRO_NAME: 'Ubuntu-22.04' }, broken: ['wslview'] }

// 比路径时不管斜杠方向和盘符 (测试跑在 Windows 上, 引擎可能把 /Users/... 规整成本机写法)
const same = (a: string, b: string) => {
  const n = (s: string) => s.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '').toLowerCase()
  return n(a) === n(b)
}

function mocks(on: any, sys: Sys = WIN) {
  const log = { opened: [] as unknown[], copied: [] as string[], toasts: [] as string[], filled: [] as string[], checked: [] as string[] }
  on('session.cwd', async () => ({ value: sys.cwd }))
  on('session.root', async () => ({ value: sys.root ?? sys.cwd }))
  on('env.get', async ($: any, e: any) => ({ value: sys.env[String(e.name ?? e)] }))
  on('fs.exists', async ($: any, e: any) => {
    const p = String(e.path ?? e)
    // 测试跑在 Windows 上, 引擎可能把 /System/... 规整成本机写法, 只比结尾
    if (/[\\/]System[\\/]Library[\\/]CoreServices$/.test(p)) return { value: !!sys.mac }
    log.checked.push(p)
    if (sys.files) return { value: [...sys.files, ...(sys.dirs ?? [])].some(f => same(f, p)) }
    return { value: /weekly-report|report\.html$|notes[\\/]a\.html$/.test(p) }
  })
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv ?? e
    log.opened.push(argv)
    return { value: { exitCode: sys.broken?.includes(argv[0]) ? 3 : 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', async ($: any, e: any) => {
    log.toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.copy', async ($: any, e: any) => {
    log.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('fs.stat', async ($: any, e: any) => {
    const p = String(e.path ?? e)
    const isDir = (sys.dirs ?? []).some(d => same(d, p))
    return { value: { kind: isDir ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false } }
  })
  on('prompt.fill', async ($: any, e: any) => {
    log.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.read', async () => ({ value: { text: sys.draft ?? '', cursor: (sys.draft ?? '').length } }))
  on('settings.read', async () => ({ value: sys.settings ?? {} }))
  on('ui.render', async ($: any, e: any) => $.ui.resolve(e).Text({ children: ['engine-base'] }))
  return log
}

// 代码卡片自己的"复制"按钮 (v0.6 起卡片上还有"填入", 整条回复还有"复制全文", 数按钮时只数这种)
async function copyButtons(ui: any): Promise<any[]> {
  return (await ui.findAll({ type: 'Button' })).filter((b: any) => /^copy-\d+$/.test(b.key ?? ''))
}

async function mount($: any, surface: string, requestId: string, text: string) {
  return $.ui.mount({
    plugin: 'html-shelf',
    surface,
    component: 'AssistantMessage',
    requestId,
    props: { text, isFirstOfReply: true },
  } as any)
}

test('回复里的 html 路径变成可点击链接，单击用 explorer 打开', async ($, on) => {
  const log = mocks(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface, 'm1', TEXT)
    const md: any = await ui.find({ type: 'Markdown' } as any)
    expect(md).toBeDefined()
    expect(md.text).toContain('](file:///D:/proj/docs/research/')
    expect(md.text).toContain('不存在的 nothere.html 不变链接')
    const href = md.text.match(/\((file:[^)]+)\)/)[1]
    await ui.press({ key: 'html-links-m1', link: { href } })
    await ui.unmount()
  }
  expect(log.opened.length).toBe(2)
  expect(JSON.stringify(log.opened[0])).toContain('D:\\\\proj\\\\docs\\\\research\\\\2026-10-04_weekly-report.html')
})

test('终端里代码块画成卡片，复制的是原文且末尾不带换行', async ($, on) => {
  const log = mocks(on)
  const clock = mock.clock(on)
  const ui = await mount($, 'terminal', 'm2', CODE_MSG)
  // 两张卡片: 代码区和标题栏各有主题底色, 语言名在标题栏
  const boxes: any[] = await ui.findAll({ type: 'Box' })
  const cards = boxes.filter(b => /^code-\d$/.test(b.key ?? ''))
  expect(cards.map(b => b.props.backgroundColor)).toEqual(['composerSidebarBackground', 'composerSidebarBackground'])
  expect(boxes.filter(b => b.props.backgroundColor === 'userMessageBackground')).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: 'powershell' })).toBeDefined()
  const codes: string[] = (await ui.findAll({ type: 'Code' })).map((c: any) => c.text)
  expect(codes).toEqual(['claude --resume "my-session"', 'Get-ChildItem .\\docs\nGet-Content a.txt'])
  const buttons: any[] = await copyButtons(ui)
  expect(buttons.map(b => b.props.label)).toEqual(['Copy', 'Copy'])

  await ui.press({ key: 'copy-1' })
  await ui.press({ key: 'copy-2' })
  expect(log.copied).toEqual(['claude --resume "my-session"', 'Get-ChildItem .\\docs\nGet-Content a.txt'])
  // 复制后按钮位置换成"已复制 ✓", 1.8 秒后恢复
  await ui.redraw()
  expect(await ui.findAll({ type: 'Text', text: 'Copied ✓' })).toHaveLength(2)
  expect(await copyButtons(ui)).toHaveLength(0)
  await clock.advance(2_000)
  await ui.redraw()
  expect(await copyButtons(ui)).toHaveLength(2)

  const mds: string[] = (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.text)
  expect(mds.some(t => t.includes('先运行这条'))).toBe(true)
  expect(mds.some(t => t.includes('完成。'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'engine-base' })).toBeUndefined()
  await ui.unmount()
})

test('客户端不加按钮；还没输出完的代码块也不加', async ($, on) => {
  mocks(on)
  const d = await mount($, 'desktop', 'm3', CODE_MSG)
  expect(await d.findAll({ type: 'Button' })).toHaveLength(0)
  expect(await d.find({ type: 'Text', text: 'engine-base' })).toBeDefined()
  await d.unmount()
  const t = await mount($, 'terminal', 'm3b', '马上给你命令：\n\n```bash\nnpm run bu')
  expect(await copyButtons(t)).toHaveLength(0)
  expect(await t.find({ type: 'Text', text: 'engine-base' })).toBeDefined()
  await t.unmount()
})

test('同一条回复里 HTML 链接和列表里的代码块都能用', async ($, on) => {
  const log = mocks(on)
  mock.clock(on)
  const ui = await mount($, 'terminal', 'm4', MIXED)
  const md: any = await ui.find({ key: 'html-links-m4-0' } as any)
  expect(md).toBeDefined()
  expect(md.text).toContain('](file:///D:/proj/docs/')
  const href = md.text.match(/\((file:[^)]+)\)/)[1]
  await ui.press({ key: 'html-links-m4-0', link: { href } })
  expect(JSON.stringify(log.opened[0])).toContain('report.html')
  // 列表里缩进 3 格的代码块: 卡片跟着缩进, 复制出来的不带缩进
  expect(await copyButtons(ui)).toHaveLength(1)
  await ui.press({ key: 'copy-1' })
  expect(log.copied).toEqual(['cd D:\\proj\nnpm test'])
  const card: any = (await ui.findAll({ type: 'Box' })).find((b: any) => b.key === 'code-1')
  expect(card.props.marginLeft).toBe(3)
  const mds: string[] = (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.text)
  expect(mds).toContain('2. 看结果')
  await ui.unmount()
})

test('四个反引号包住的代码块、~~~ 代码块都按整块复制', async ($, on) => {
  const log = mocks(on)
  mock.clock(on)
  const ui = await mount($, 'terminal', 'm5', NESTED)
  expect(await copyButtons(ui)).toHaveLength(2)
  await ui.press({ key: 'copy-1' })
  await ui.press({ key: 'copy-2' })
  expect(log.copied).toEqual(['```bash\necho hi\n```', 'plain tilde'])
  await ui.unmount()
})

const POSIX_TEXT = '报告在 `docs/report.html`，笔记在 ~/notes/a.html 。'

test('macOS: 相对路径和 ~ 路径都变成 file:// 链接，单击用 open 打开', async ($, on) => {
  const log = mocks(on, MAC)
  const ui = await mount($, 'terminal', 'm6', POSIX_TEXT)
  const md: any = await ui.find({ type: 'Markdown' } as any)
  expect(md.text).toContain('](file:///Users/me/proj/docs/report.html)')
  expect(md.text).toContain('](file:///Users/me/notes/a.html)')
  await ui.press({ key: 'html-links-m6', link: { href: 'file:///Users/me/proj/docs/report.html' } })
  expect(log.opened).toEqual([['open', '/Users/me/proj/docs/report.html']])
  await ui.unmount()
})

test('Linux: xdg-open 打不开时改用 gio open；路径区分大小写', async ($, on) => {
  const log = mocks(on, LINUX)
  const ui = await mount($, 'terminal', 'm7', POSIX_TEXT)
  const md: any = await ui.find({ type: 'Markdown' } as any)
  expect(md.text).toContain('](file:///home/me/proj/docs/report.html)')
  expect(md.text).toContain('](file:///home/me/notes/a.html)')
  await ui.press({ key: 'html-links-m7', link: { href: 'file:///home/me/notes/a.html' } })
  expect(log.opened).toEqual([
    ['xdg-open', '/home/me/notes/a.html'],
    ['gio', 'open', '/home/me/notes/a.html'],
  ])
  await ui.unmount()
})

test('Claude 在终端里 cd 进子目录后：相对路径先按项目根目录找，找不到再按当前目录找', async ($, on) => {
  const CD: Sys = {
    root: 'D:\\proj',
    cwd: 'D:\\proj\\docs\\research',
    env: { OS: 'Windows_NT' },
    files: ['D:\\proj\\docs\\research\\report-zh.html', 'D:\\proj\\docs\\research\\notes.html'],
  }
  const log = mocks(on, CD)
  const ui = await mount($, 'terminal', 'm9', '已写好：`docs/research/report-zh.html`（双击打开），草稿在 `notes.html`。')
  const md: any = await ui.find({ type: 'Markdown' } as any)
  expect(md.text).toContain('](file:///D:/proj/docs/research/report-zh.html)')
  expect(md.text).toContain('](file:///D:/proj/docs/research/notes.html)')
  await ui.press({ key: 'html-links-m9', link: { href: 'file:///D:/proj/docs/research/report-zh.html' } })
  expect(log.opened).toEqual([['explorer.exe', 'D:\\proj\\docs\\research\\report-zh.html']])
  await ui.unmount()
})

test('WSL: 没有 wslview 时经 wslpath 交给 Windows 的 explorer.exe 打开', async ($, on) => {
  const log = mocks(on, WSL)
  const ui = await mount($, 'terminal', 'm8', POSIX_TEXT)
  await ui.press({ key: 'html-links-m8', link: { href: 'file:///home/me/proj/docs/report.html' } })
  const p = '/home/me/proj/docs/report.html'
  expect(log.opened).toEqual([
    ['wslview', p],
    ['sh', '-c', 'explorer.exe "$(wslpath -w "$1")"; exit 0', 'sh', p],
  ])
  await ui.unmount()
})

// ---- v0.6 新功能 ----

// PowerShell -EncodedCommand 的参数解回原文 (UTF-16LE + base64)
function decodePs(b64: string): string {
  const bin = atob(b64)
  let s = ''
  for (let i = 0; i + 1 < bin.length; i += 2) s += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
  return s
}

// 画出来的树里第一个 position=absolute 的 Box (hover 只在树里看得到, find 的 props 里没有)
function placedBox(node: any): any {
  if (!node || typeof node !== 'object') return undefined
  if (node.type === 'Box' && node.props?.position === 'absolute') return node
  for (const c of node.children ?? []) {
    const hit = placedBox(c)
    if (hit) return hit
  }
  return undefined
}

const hrefsOf = (md: any): string[] => [...String(md.text).matchAll(/\]\((file:[^)]+)\)/g)].map(m => m[1] as string)

test('更多文件类型和文件夹能点开；脚本只在文件夹里选中不运行；源码文件不变链接', async ($, on) => {
  const SYS: Sys = {
    cwd: 'D:\\proj',
    env: { OS: 'Windows_NT' },
    files: ['D:\\proj\\out\\cut v2.mp4', 'D:\\proj\\docs\\script.docx', 'D:\\proj\\tools\\run.bat', 'D:\\proj\\refs\\frame.png'],
    dirs: ['D:\\proj\\footage\\day1'],
  }
  const log = mocks(on, SYS)
  const text = [
    '剪好的片子 `out/cut v2.mp4`，台本在 docs/script.docx，',
    '素材文件夹 `footage/day1`，运行 `tools/run.bat` 就行。',
    '[参考图](D:/proj/refs/frame.png)，源码 `hooks/register.tsx` 不变链接。',
  ].join('\n')
  const ui = await mount($, 'terminal', 'm10', text)
  const md: any = await ui.find({ key: 'html-links-m10' } as any)
  expect(md.text).toContain('[`out/cut v2.mp4`](file:///D:/proj/out/cut%20v2.mp4)')
  expect(md.text).toContain('[docs/script.docx](file:///D:/proj/docs/script.docx)')
  expect(md.text).toContain('[`footage/day1`](file:///D:/proj/footage/day1)')
  expect(md.text).toContain('[参考图](file:///D:/proj/refs/frame.png)')
  expect(md.text).toContain('源码 `hooks/register.tsx` 不变链接')
  expect(hrefsOf(md)).toHaveLength(5)

  for (const href of hrefsOf(md)) await ui.press({ key: 'html-links-m10', link: { href } })
  const start = (p: string) => ['cmd.exe', '/d', '/c', 'start', 'html shelf', p]
  expect(log.opened).toContainEqual(start('D:\\proj\\out\\cut v2.mp4'))
  expect(log.opened).toContainEqual(start('D:\\proj\\docs\\script.docx'))
  expect(log.opened).toContainEqual(start('D:\\proj\\footage\\day1'))
  expect(log.opened).toContainEqual(start('D:\\proj\\refs\\frame.png'))
  // 脚本: PowerShell 拉起 explorer.exe /select,"路径", 不是直接运行
  const ps = (log.opened as string[][]).find(a => a[0] === 'powershell.exe') as string[]
  expect(ps.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(decodePs(ps[4] as string)).toBe("Start-Process -FilePath 'explorer.exe' -ArgumentList '/select,\"D:\\proj\\tools\\run.bat\"'")
  expect((log.opened as string[][]).some(a => a.includes('D:\\proj\\tools\\run.bat'))).toBe(false)
  expect(log.toasts.some(t => t.includes('已在文件夹里选中: run.bat（脚本不会直接运行）'))).toBe(true)
  expect(log.toasts.some(t => t.includes('已打开文件夹: day1'))).toBe(true)
  await ui.unmount()
})

test('一条回复最多查 40 个路径；客户端仍只认 HTML', async ($, on) => {
  const log = mocks(on, { cwd: 'D:\\cap', env: { OS: 'Windows_NT' }, files: ['D:\\cap\\a.pdf'] })
  const many = Array.from({ length: 60 }, (_, i) => `missing-${i}.md`).join(' ')
  const ui = await mount($, 'terminal', 'm11', many)
  expect(log.checked.filter(p => p.includes('missing-')).length).toBe(40)
  await ui.unmount()
  const d = await mount($, 'desktop', 'm11d', '报告 `a.pdf` 在这里')
  expect(await d.find({ type: 'Markdown' } as any)).toBeUndefined()
  expect(await d.find({ type: 'Text', text: 'engine-base' })).toBeDefined()
  await d.unmount()
})

test('macOS: 脚本用 open -R 在访达里选中', async ($, on) => {
  const log = mocks(on, { ...MAC, files: ['/Users/me/proj/run.sh'] })
  const ui = await mount($, 'terminal', 'm12', '运行 `run.sh`')
  await ui.press({ key: 'html-links-m12', link: { href: 'file:///Users/me/proj/run.sh' } })
  expect(log.opened).toEqual([['open', '-R', '/Users/me/proj/run.sh']])
  await ui.unmount()
})

test('/open list 列出最近的文件，单击打开；/open N 打开倒数第 N 个', async ($, on) => {
  const log = mocks(on, { cwd: 'D:\\lst', env: { OS: 'Windows_NT' }, files: ['D:\\lst\\notes\\plan.md', 'D:\\lst\\cut.mov'] })
  const ui = await mount($, 'terminal', 'm13', '计划在 `notes/plan.md`，样片 cut.mov')
  await ui.unmount()
  const r: any = await $.command.run({ command: 'open', args: 'list' } as any)
  const lines = String(r.text).split('\n')
  expect(lines[2]).toBe('1. [plan.md](file:///D:/lst/notes/plan.md) · `notes`')
  expect(lines[3]).toBe('2. [cut.mov](file:///D:/lst/cut.mov)')

  const out = await $.ui.mount({
    plugin: 'html-shelf',
    surface: 'terminal',
    component: 'CommandOutput',
    requestId: 'c1',
    props: { command: 'open', args: 'list', text: r.text, isErrored: false },
  } as any)
  await out.press({ key: 'open-list', link: { href: 'file:///D:/lst/cut.mov' } })
  expect(log.opened).toEqual([['cmd.exe', '/d', '/c', 'start', 'html shelf', 'D:\\lst\\cut.mov']])
  await out.unmount()
  const outD = await $.ui.mount({
    plugin: 'html-shelf',
    surface: 'desktop',
    component: 'CommandOutput',
    requestId: 'c2',
    props: { command: 'open', args: 'list', text: r.text, isErrored: false },
  } as any)
  expect(await outD.find({ key: 'open-list' } as any)).toBeUndefined()
  await outD.unmount()

  await $.command.run({ command: 'open', args: '1' } as any)
  expect(log.opened[1]).toEqual(['cmd.exe', '/d', '/c', 'start', 'html shelf', 'D:\\lst\\notes\\plan.md'])
})

const FILL_MSG = [
  '```powershell',
  'Get-ChildItem .\\docs | Select-Object -First 3',
  '```',
  '',
  '```bash',
  '# 先装依赖',
  'npm install \\',
  '  --save-dev vite',
  '```',
  '',
  '```bash',
  'cd D:\\proj',
  'npm test',
  '```',
  '',
  '```python',
  'print(1)',
  '```',
].join('\n')

test('shell 代码块只有一条命令时有"填入"：以 ! 开头填进输入框；语言和 ! 的 shell 对不上时提醒', async ($, on) => {
  const log = mocks(on)
  const ui = await mount($, 'terminal', 'm14', FILL_MSG)
  const fills: any[] = (await ui.findAll({ type: 'Button' })).filter((b: any) => /^fill-/.test(b.key ?? ''))
  // 第 3 块两条命令、第 4 块 python: 没有"填入"
  expect(fills.map(b => b.key)).toEqual(['fill-1', 'fill-2'])
  await ui.press({ key: 'fill-1' })
  await ui.press({ key: 'fill-2' })
  expect(log.filled).toEqual(['!Get-ChildItem .\\docs | Select-Object -First 3', '!npm install --save-dev vite'])
  expect(log.toasts[0]).toContain('已填入输入框，按回车运行')
  expect(log.toasts[0]).not.toContain('注意')
  // Windows 上 ! 默认用 PowerShell: bash 块提醒
  expect(log.toasts[1]).toContain('注意: 这是 bash 命令, 你的 ! 用 PowerShell 运行')
  await ui.unmount()
  const d = await mount($, 'desktop', 'm14d', FILL_MSG)
  expect(await d.findAll({ type: 'Button' })).toHaveLength(0)
  await d.unmount()
})

test('输入框里有没发出的字时，"填入"不覆盖草稿', async ($, on) => {
  const log = mocks(on, { ...WIN, draft: '帮我看看这个报错' })
  const ui = await mount($, 'terminal', 'm14b', FILL_MSG)
  await ui.press({ key: 'fill-1' })
  expect(log.filled).toEqual([])
  expect(log.toasts[0]).toContain('没覆盖')
  await ui.unmount()
})

test('设置里 defaultShell=bash 时，bash 块不提醒、PowerShell 块提醒', async ($, on) => {
  const log = mocks(on, { ...WIN, settings: { defaultShell: 'bash' } })
  const ui = await mount($, 'terminal', 'm15', FILL_MSG)
  await ui.press({ key: 'fill-1' })
  await ui.press({ key: 'fill-2' })
  expect(log.toasts[0]).toContain('注意: 这是 PowerShell 命令, 你的 ! 用 bash 运行')
  expect(log.toasts[1]).not.toContain('注意')
  await ui.unmount()
})

test('终端里每条回复右上角有悬停才出现的"复制全文"，复制去掉公共缩进的原文', async ($, on) => {
  const log = mocks(on)
  const clock = mock.clock(on)
  // 引擎自己画的回复: 原样包一层
  const ui = await mount($, 'terminal', 'm16', '  第一行\n    缩进的第二行\n\n  第三行\n')
  expect(await ui.find({ type: 'Text', text: 'engine-base' })).toBeDefined()
  const boxes: any[] = await ui.findAll({ type: 'Box' })
  expect(boxes[0].key).toBe('reply')
  const overlay: any = placedBox(await ui.drawn())
  expect(overlay.props).toMatchObject({ position: 'absolute', top: 0, right: 0, display: 'none' })
  expect(overlay.hover).toEqual({ display: 'flex' })
  await ui.press({ key: 'copy-all' })
  expect(log.copied).toEqual(['第一行\n  缩进的第二行\n\n第三行'])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Copied ✓' })).toBeDefined()
  expect(await ui.find({ key: 'copy-all' } as any)).toBeUndefined()
  await clock.advance(2_000)
  await ui.redraw()
  expect(await ui.find({ key: 'copy-all' } as any)).toBeDefined()
  await ui.unmount()

  // 本 mod 自己画的回复 (第一行就是代码卡片): 按钮往左让开卡片的"填入 复制"
  const c = await mount($, 'terminal', 'm17', '```bash\nnpm test\n```\n\n跑完看结果。')
  const placed: any = (await c.findAll({ type: 'Box' })).find((b: any) => b.props.position === 'absolute')
  expect(placed.props.right).toBe(19)
  await c.press({ key: 'copy-all' })
  expect(log.copied[1]).toBe('```bash\nnpm test\n```\n\n跑完看结果。')
  await c.unmount()

  const d = await mount($, 'desktop', 'm16d', '  第一行')
  expect(await d.find({ key: 'copy-all' } as any)).toBeUndefined()
  await d.unmount()
})

const TOOL_ROW = {
  tool_use_id: 'tu1',
  tool: 'Write',
  input: { file_path: 'D:\\proj\\docs\\storyboard.pdf', content: 'x' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { type: 'create', filePath: 'D:\\proj\\docs\\storyboard.pdf' },
}

test('Write / Edit 写完的文件，工具行后面有"打开"；没写完、出错、不支持的类型不加', async ($, on) => {
  const log = mocks(on)
  const ui = await $.ui.mount({ plugin: 'html-shelf', surface: 'terminal', component: 'ToolUse', requestId: 'tu1', props: TOOL_ROW } as any)
  expect(await ui.find({ type: 'Text', text: 'engine-base' })).toBeDefined()
  expect((await ui.find({ key: 'open-file' } as any))?.props.label).toBe('Open')
  await ui.press({ key: 'open-file' })
  expect(log.opened).toEqual([['cmd.exe', '/d', '/c', 'start', 'html shelf', 'D:\\proj\\docs\\storyboard.pdf']])
  await ui.redraw({ ...TOOL_ROW, isRunning: true, output: undefined } as any)
  expect(await ui.find({ key: 'open-file' } as any)).toBeUndefined()
  await ui.redraw({ ...TOOL_ROW, isErrored: true } as any)
  expect(await ui.find({ key: 'open-file' } as any)).toBeUndefined()
  await ui.redraw({ ...TOOL_ROW, tool: 'Edit', input: { file_path: 'D:\\proj\\src\\a.tsx' } } as any)
  expect(await ui.find({ key: 'open-file' } as any)).toBeUndefined()
  await ui.unmount()
  const d = await $.ui.mount({ plugin: 'html-shelf', surface: 'desktop', component: 'ToolUse', requestId: 'tu2', props: TOOL_ROW } as any)
  expect(await d.find({ key: 'open-file' } as any)).toBeUndefined()
  await d.unmount()
})

test('没标语言、但只有一行命令的代码块也有 Insert；命令已带 ! 时不再多加；一行普通文字没有', async ($, on) => {
  const log = mocks(on)
  const MSG = [
    '开机自启被权限检查拦下了，需要你自己执行一次：',
    '',
    '```',
    '! powershell -ExecutionPolicy Bypass -File scripts\label_service\install_autostart.ps1',
    '```',
    '',
    '```',
    'git status',
    '```',
    '',
    '```',
    '这只是一句说明文字',
    '```',
  ].join('\n')
  const ui = await mount($, 'terminal', 'm20', MSG)
  const fills: any[] = (await ui.findAll({ type: 'Button' })).filter((b: any) => /^fill-/.test(b.key ?? ''))
  expect(fills.map(b => b.key)).toEqual(['fill-1', 'fill-2'])
  expect(fills.map(b => b.props.label)).toEqual(['Insert', 'Insert'])
  await ui.press({ key: 'fill-1' })
  await ui.press({ key: 'fill-2' })
  expect(log.filled).toEqual(['!powershell -ExecutionPolicy Bypass -File scripts\label_service\install_autostart.ps1', '!git status'])
  // 代码区上下各空一行 (不贴着标题栏)
  const card: any = (await ui.findAll({ type: 'Box' })).find((b: any) => b.key === 'code-1')
  expect(card).toBeDefined()
  const bodies = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.paddingY === 1 && b.props.paddingX === 2)
  expect(bodies.length).toBe(3)
  await ui.unmount()
})
