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
type Sys = { cwd: string; root?: string; env: Record<string, string>; mac?: boolean; broken?: string[]; files?: string[] }
const WIN: Sys = { cwd: 'D:\\proj', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me' } }
const MAC: Sys = { cwd: '/Users/me/proj', env: { HOME: '/Users/me' }, mac: true }
const LINUX: Sys = { cwd: '/home/me/proj', env: { HOME: '/home/me' }, broken: ['xdg-open'] }
const WSL: Sys = { cwd: '/home/me/proj', env: { HOME: '/home/me', WSL_DISTRO_NAME: 'Ubuntu-22.04' }, broken: ['wslview'] }

function mocks(on: any, sys: Sys = WIN) {
  const log = { opened: [] as unknown[], copied: [] as string[], toasts: [] as string[] }
  on('session.cwd', async () => ({ value: sys.cwd }))
  on('session.root', async () => ({ value: sys.root ?? sys.cwd }))
  on('env.get', async ($: any, e: any) => ({ value: sys.env[String(e.name ?? e)] }))
  on('fs.exists', async ($: any, e: any) => {
    const p = String(e.path ?? e)
    // 测试跑在 Windows 上, 引擎可能把 /System/... 规整成本机写法, 只比结尾
    if (/[\\/]System[\\/]Library[\\/]CoreServices$/.test(p)) return { value: !!sys.mac }
    if (sys.files) return { value: sys.files.some(f => f.toLowerCase() === p.toLowerCase()) }
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
  on('ui.render', async ($: any, e: any) => $.ui.resolve(e).Text({ children: ['engine-base'] }))
  return log
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
  const buttons: any[] = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['复制', '复制'])

  await ui.press({ key: 'copy-1' })
  await ui.press({ key: 'copy-2' })
  expect(log.copied).toEqual(['claude --resume "my-session"', 'Get-ChildItem .\\docs\nGet-Content a.txt'])
  // 复制后按钮位置换成"已复制 ✓", 1.8 秒后恢复
  await ui.redraw()
  expect(await ui.findAll({ type: 'Text', text: '已复制 ✓' })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await clock.advance(2_000)
  await ui.redraw()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)

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
  expect(await t.findAll({ type: 'Button' })).toHaveLength(0)
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
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
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
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
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
