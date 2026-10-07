import type { Register } from 'claude-code'

// html-shelf: 让终端里 Claude 的回复更顺手
//   1. 回复里的 .html 路径 (裸路径 / `代码` / [文字](路径) / ~/路径) 变成链接,
//      全屏终端里单击 = 用默认浏览器打开 (文件必须真实存在才变链接);
//      Windows 用 explorer.exe, macOS 用 open, Linux 用 xdg-open (不行再试 gio open / wslview)
//   2. 终端里每个写完的代码块 (```) 画成一张卡片: 标题栏 (语言名 + 复制) 和代码区
//      各用主题里的一种底色, 跟着深色/浅色主题走; 鼠标移上去标题栏变亮、"复制"变橙,
//      单击 = 代码原文进剪贴板 (末尾不带换行, 粘进 PowerShell 不会直接执行),
//      之后 1.8 秒显示绿色"已复制 ✓"; 客户端自带复制按钮, 不动; 没闭合的代码块不加
//   3. /open      打开最近一次提到或写出的 HTML
//      /open 3    打开倒数第 3 个; Claude 工作时也能用

const MAX_RECENT = 50
const MAX_PART = 9_000 // Markdown 一次最多画 10000 字, 超了就交给引擎原样画
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const PATH_CHARS = String.raw`[^\s"'\x60()（）<>\[\]{}|,，。：；、！？*]`
const BARE_PATH = new RegExp(`(?:[A-Za-z]:[\\\\/])?${PATH_CHARS}+?\\.html?(?![\\w.])`, 'gi')
const MD_LINK = /\[([^\]\n]*)\]\(([^)\s]+\.html?)\)/gi
const CODE_SPAN = /`([^`\n]+\.html?)`/gi
const FENCE = /^( {0,12})(`{3,}|~{3,})(.*)$/
const HAS_FENCE = /^ {0,12}(```|~~~)/m
// 卡片颜色用主题键, 深色/浅色主题各自有值 (深色: 标题栏 55 灰, 悬停 70 灰, 代码区 38 灰)
const CARD_HEAD = 'userMessageBackground'
const CARD_HEAD_HOVER = 'userMessageBackgroundHover'
const CARD_BODY = 'composerSidebarBackground'
const COPIED_MS = 1_800

// ---- 跨平台 (usage-hud 里有同样一份; 带 $ 的函数必须写在本文件里, 不能 import) ----
type OS = 'windows' | 'mac' | 'linux'

// 按工作目录缓存: 同一个目录只判断一次, 换了目录 (或测试里换了系统) 再判断
let knownOS: { key: string; os: OS } | undefined

// 判断顺序: 环境变量 OS=Windows_NT (Windows 自带) → 路径像 C:\ → 有 /System/Library/CoreServices 就是 macOS → 其余按 Linux
async function detectOS($: any, dir: string): Promise<OS> {
  if (knownOS && knownOS.key === dir) return knownOS.os
  let found: OS = 'linux'
  try {
    if ((await $.env.get('OS')) === 'Windows_NT' || /^[A-Za-z]:[\\/]/.test(dir)) found = 'windows'
    else if (await $.fs.exists('/System/Library/CoreServices')) found = 'mac'
  } catch {}
  knownOS = { key: dir, os: found }
  return found
}

// 用户主目录: Windows 用 USERPROFILE, 其余用 HOME
async function homeDir($: any, sys: OS): Promise<string> {
  const h = (sys === 'windows' ? await $.env.get('USERPROFILE') : '') || (await $.env.get('HOME')) || ''
  return h.replace(/[\\/]+$/, '')
}

// 跑一个命令, 退出码 0 算成功; 命令不存在会抛错, 也算失败
async function ranOk($: any, argv: string[]): Promise<boolean> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 10_000 })
    return r.exitCode === 0
  } catch {
    return false
  }
}

// WSL 里一般没有 Linux 的浏览器和文件管理器: 交给 Windows 那边的默认程序.
// 先试 wslview (wslu 包), 再经 wslpath 把路径转成 Windows 写法交给 explorer.exe
// (explorer.exe 成功也常返回 1, 所以 exit 0); 网址直接交给 explorer.exe
function wslTries(target: string): string[][] {
  const viaExplorer = /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
    ? ['sh', '-c', 'explorer.exe "$1"; exit 0', 'sh', target]
    : ['sh', '-c', 'explorer.exe "$(wslpath -w "$1")"; exit 0', 'sh', target]
  return [['wslview', target], viaExplorer]
}

// macOS / Linux: 用系统默认程序打开 (文件 → 默认应用, 文件夹 → 文件管理器, 网址 → 浏览器); 都不行就抛错
async function openPosix($: any, target: string, sys: OS): Promise<void> {
  const tries: string[][] = []
  if (sys === 'mac') tries.push(['open', target])
  else {
    if (await $.env.get('WSL_DISTRO_NAME')) tries.push(...wslTries(target))
    tries.push(['xdg-open', target], ['gio', 'open', target])
  }
  for (const argv of tries) if (await ranOk($, argv)) return
  throw new Error('没能打开, 试过: ' + tries.map(a => (a[0] === 'sh' ? 'explorer.exe' : a[0])).join(' / '))
}
// ---- 跨平台 完 ----

// 两个目录: 回复里的相对路径大多相对项目根目录写, 但 Claude 在终端里 cd 之后当前目录会变
let root = '' // 项目根目录 ($.session.root): 会话开始的地方, 终端里 cd 不会改它
let cwd = '' // 当前目录 ($.session.cwd): 跟着终端里的 cd 变
let os: OS = 'windows' // useOS() 之后才准
let home = '' // macOS / Linux 展开 ~/ 用
let recent: string[] = [] // 绝对路径, 最新在前
const existCache = new Map<string, boolean>()
const copied = new Set<string>() // 刚复制过的代码块: `${消息 id}:${第几块}`

type Part =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; code: string; indent: number; fenced: string }

const winPath = (p: string) => p.replace(/\//g, '\\')
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
// 去重和缓存用的键: Linux 文件名分大小写, Windows / macOS 默认不分
const keyOf = (abs: string) => (os === 'linux' ? abs : abs.toLowerCase())

// 先弄清在哪个系统上: 路径怎么拼、用什么命令打开都看它
async function useOS($: any) {
  cwd = (await $.session.cwd()) || cwd
  try {
    root = (await $.session.root()) || root
  } catch {}
  os = await detectOS($, root || cwd)
  home = os === 'windows' ? '' : await homeDir($, os)
}

// 相对路径按 base 拼成绝对路径 (默认项目根目录); 绝对路径、file:// 链接原样转成本系统写法
function absolute(p: string, base = root || cwd): string {
  let s = p.replace(/^file:\/\/(localhost)?/i, '') // file:///C:/x → /C:/x, file:///home/x → /home/x
  try {
    s = decodeURIComponent(s)
  } catch {}
  if (os === 'windows') {
    s = winPath(s.replace(/^\/(?=[A-Za-z]:)/, ''))
    if (/^[a-zA-Z]:[\\/]|^[\\/]{2}/.test(s)) return s
    return winPath(base.replace(/[\\/]+$/, '') + '\\' + s.replace(/^\.[\\/]/, ''))
  }
  if (s.startsWith('~/') && home) s = home + s.slice(1)
  if (s.startsWith('/')) return s
  return base.replace(/\/+$/, '') + '/' + s.replace(/^\.\//, '')
}

// 一个路径可能指向的文件: 先按项目根目录, 再按当前目录 (Claude cd 进子目录后写的相对路径)
function candidates(p: string): string[] {
  const list = [absolute(p, root || cwd)]
  if (root && cwd) {
    const alt = absolute(p, cwd)
    if (keyOf(alt) !== keyOf(list[0])) list.push(alt)
  }
  return list
}

function toHref(abs: string): string {
  const path = os === 'windows' ? '/' + abs.replace(/\\/g, '/') : abs
  return 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

function remember(abs: string) {
  recent = [abs, ...recent.filter(p => keyOf(p) !== keyOf(abs))].slice(0, MAX_RECENT)
}

async function exists($: any, abs: string): Promise<boolean> {
  const key = keyOf(abs)
  if (existCache.get(key)) return true
  let ok = false
  try {
    ok = await $.fs.exists(abs)
  } catch {}
  // 只缓存"存在", 不存在的下次再查 (文件可能稍后才写出)
  if (ok) existCache.set(key, true)
  return ok
}

async function openFile($: any, abs: string) {
  try {
    await useOS($)
    // Windows: explorer.exe 用系统默认程序打开, 不经过 shell, 路径里有空格和 & 也安全
    if (os === 'windows') await $.process.run(['explorer.exe', abs], { timeoutMs: 10_000 })
    else await openPosix($, abs, os)
    $.ui.toast('已用浏览器打开: ' + baseName(abs))
  } catch (err) {
    $.ui.toast('打开失败: ' + String(err))
  }
}

// 把一段 markdown 里的 HTML 路径改写成 file:/// 链接; 代码块 (```) 里的不动
async function linkify($: any, text: string): Promise<{ text: string; hrefs: string[]; found: string[] }> {
  await useOS($)
  const hrefs: string[] = []
  const found: string[] = []
  const slots: string[] = []
  const hold = (s: string) => `\u0000${slots.push(s) - 1}\u0000`

  async function link(raw: string, label: string): Promise<string | undefined> {
    for (const abs of candidates(raw)) {
      if (!(await exists($, abs))) continue
      const href = toHref(abs)
      hrefs.push(href)
      found.push(abs)
      return `[${label}](${href})`
    }
    return undefined
  }

  async function replaceAsync(s: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string>) {
    let out = ''
    let last = 0
    re.lastIndex = 0
    for (let m = re.exec(s); m; m = re.exec(s)) {
      out += s.slice(last, m.index) + (await fn(m))
      last = m.index + m[0].length
    }
    return out + s.slice(last)
  }

  const parts = text.split(/(```[\s\S]*?```)/g)
  for (let i = 0; i < parts.length; i += 2) {
    let s = parts[i]
    // 已有的 markdown 链接: 只换目标
    s = await replaceAsync(s, MD_LINK, async m => hold((await link(m[2], m[1])) ?? m[0]))
    // `路径.html`
    s = await replaceAsync(s, CODE_SPAN, async m => hold((await link(m[1], '`' + m[1] + '`')) ?? m[0]))
    // 裸路径
    s = await replaceAsync(s, BARE_PATH, async m => hold((await link(m[0], m[0])) ?? m[0]))
    parts[i] = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)])
  }
  return { text: parts.join(''), hrefs, found }
}

// 头尾整行的空白去掉; 行内的缩进和空格不动
function trimBlankLines(s: string): string {
  return s.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
}

function dedent(line: string, n: number): string {
  let k = 0
  while (k < n && line[k] === ' ') k++
  return line.slice(k)
}

// 把回复切成 文字 / 代码块 两种段; 没闭合的代码块 (还在流式输出) 留在文字里
function splitCode(text: string): Part[] {
  const lines = text.split(/\r?\n/)
  const parts: Part[] = []
  let prose: string[] = []
  const flush = () => {
    const s = trimBlankLines(prose.join('\n'))
    if (s.trim()) parts.push({ kind: 'prose', text: s })
    prose = []
  }
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i])
    // ``` 后面的说明里再有反引号, 是行内代码, 不是代码块
    if (!m || (m[2][0] === '`' && m[3].includes('`'))) {
      prose.push(lines[i])
      continue
    }
    const indent = m[1].length
    const mark = m[2]
    // 收尾的围栏: 同一种符号, 不短于开头
    const close = new RegExp('^ *' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}[ \\t]*$')
    let j = i + 1
    while (j < lines.length && !close.test(lines[j])) j++
    if (j >= lines.length) {
      prose.push(...lines.slice(i))
      break
    }
    flush()
    // 列表里缩进的代码块: 按开头围栏的缩进去掉每行前面的空格
    const body = lines.slice(i + 1, j).map(l => dedent(l, indent))
    const info = m[3].trim()
    parts.push({
      kind: 'code',
      lang: info.split(/\s+/)[0] ?? '',
      code: trimBlankLines(body.join('\n')),
      indent,
      fenced: [mark + info, ...body, mark].join('\n'),
    })
    i = j
  }
  flush()
  return parts
}

function preview(code: string): string {
  const lines = code.split('\n')
  const first = lines[0].trim()
  const head = first.length > 36 ? first.slice(0, 36) + '...' : first
  return lines.length > 1 ? `${head} 等 ${lines.length} 行` : head
}

function markCopied($: any, id: string, isOn: boolean) {
  if (isOn) copied.add(id)
  else copied.delete(id)
  $.ui.invalidate('ui.render')
}

async function copyCode($: any, id: string, code: string, surface: any) {
  try {
    const r = await $.ui.copy({ text: code, surface })
    if (r?.isCopied) {
      markCopied($, id, true)
      $.ui.toast('已复制: ' + preview(code))
      $.clock.after(COPIED_MS, () => markCopied($, id, false))
    } else {
      $.ui.toast('没复制上 (' + String(r?.reason ?? '原因不明') + '), 可以改用 /copy')
    }
  } catch (err) {
    $.ui.toast('复制失败: ' + String(err))
  }
}

// 一个代码块的卡片: 标题栏 (语言名 … 复制) + 代码区; key 让整张卡片成为悬停范围
function codeCard($: any, els: any, p: Extract<Part, { kind: 'code' }>, n: number, rid: string, gap: number) {
  const { Box, Text, Button, Code } = els
  const id = `${rid}:${n}`
  const lang = p.lang.slice(0, 20)
  const head: any[] = []
  if (lang) head.push(<Text color="inactive">{lang}</Text>)
  if (copied.has(id)) head.push(<Text color="success">已复制 ✓</Text>)
  else
    head.push(
      <Button
        key={`copy-${n}`}
        plain
        dimColor
        label="复制"
        hover={{ color: 'claude', bold: true, dimColor: false }}
        onPress={press => copyCode($, id, p.code, press.surface)}
      />,
    )
  return (
    <Box key={`code-${n}`} flexDirection="column" marginTop={gap} marginLeft={p.indent} backgroundColor={CARD_BODY}>
      <Box
        flexDirection="row"
        justifyContent={lang ? 'space-between' : 'flex-end'}
        paddingX={2}
        backgroundColor={CARD_HEAD}
        hover={{ backgroundColor: CARD_HEAD_HOVER }}
      >
        {head}
      </Box>
      <Box paddingX={2} paddingBottom={1}>
        {lang ? <Code source={p.code} language={lang} /> : <Code source={p.code} />}
      </Box>
    </Box>
  )
}

// 终端里带代码块的回复: 自己分段画, 文字段照常, 代码块画成卡片;
// 返回 undefined = 不归这里画 (没有写完的代码块, 或某段太长)
async function drawWithCopy($: any, e: any, props: { text: string; isFirstOfReply: boolean }) {
  const parts = splitCode(props.text)
  if (!parts.some(p => p.kind === 'code' && p.code.trim())) return undefined
  if (parts.some(p => (p.kind === 'prose' ? p.text : p.fenced).length > MAX_PART)) return undefined

  const els = $.ui.resolve(e)
  const { Box, Text, Markdown } = els
  const rid = String(e.requestId ?? '')
  const rows: any[] = []
  let n = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const gap = i === 0 ? 0 : 1
    if (p.kind === 'prose') {
      let md = <Markdown text={p.text} />
      if (/\.html?/i.test(p.text)) {
        const { text, hrefs, found } = await linkify($, p.text)
        if (hrefs.length) {
          for (const abs of [...found].reverse()) remember(abs)
          md = (
            <Markdown
              key={`html-links-${rid}-${i}`}
              text={text}
              pressableLinks={hrefs}
              onLinkPress={link => openFile($, absolute(link.href))}
            />
          )
        }
      }
      rows.push(<Box marginTop={gap}>{md}</Box>)
      continue
    }
    if (!p.code.trim()) {
      rows.push(
        <Box marginTop={gap} marginLeft={p.indent}>
          <Markdown text={p.fenced} />
        </Box>,
      )
      continue
    }
    n += 1
    rows.push(codeCard($, els, p, n, rid, gap))
  }
  return (
    <Box flexDirection="row">
      <Text>{props.isFirstOfReply ? '● ' : '  '}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {rows}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await useOS($)
    try {
      await $.command.register({
        name: 'open',
        description: '用浏览器打开最近提到的 HTML（/open 2 = 倒数第 2 个）',
        argumentHint: '[N]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('html-shelf: /open 注册失败 ' + String(err))
    }
    return next(e)
  })

  on('command.run', { command: 'open' }, async ($, e) => {
    const n = parseInt(String(e.args || '1').trim(), 10) || 1
    const abs = recent[n - 1]
    if (!abs) return { text: '还没有可打开的 HTML。' }
    await openFile($, abs)
    return {}
  })

  // 智能体写出 HTML 时记下来, /open 直接能开
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = (e as any).file_path as string | undefined
    if (FILE_TOOLS.has(e.tool) && path && /\.html?$/i.test(path) && ran.deny === undefined && !ran.isError) {
      await useOS($)
      const abs = absolute(path)
      existCache.set(keyOf(abs), true)
      remember(abs)
    }
    return ran
  })

  // Claude 的回复
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const props = e.props as { text: string; isFirstOfReply: boolean }
    if (!props?.text) return next(e)

    // 终端: 有写完的代码块就分段画, 代码块上方加复制按钮 (HTML 链接一起处理)
    if (e.surface === 'terminal' && HAS_FENCE.test(props.text)) {
      const drawn = await drawWithCopy($, e, props)
      if (drawn) return drawn
    }

    // 其余: 有 HTML 路径就换成可点击的 Markdown, 否则原样交给引擎
    if (props.text.length > MAX_PART || !/\.html?/i.test(props.text)) return next(e)

    const { text, hrefs, found } = await linkify($, props.text)
    if (hrefs.length === 0) return next(e)
    for (const abs of [...found].reverse()) remember(abs)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text>{props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexDirection="column" flexGrow={1}>
          <Markdown
            key={'html-links-' + (e.requestId ?? '')}
            text={text}
            pressableLinks={hrefs}
            onLinkPress={link => openFile($, absolute(link.href))}
          />
        </Box>
      </Box>
    )
  })
}
