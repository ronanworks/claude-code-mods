import type { Register } from 'claude-code'

// html-shelf: 让终端里 Claude 的回复更顺手
//   1. 回复里的文件路径 (裸路径 / `代码` / [文字](路径) / ~/路径) 变成链接, 全屏终端里单击打开
//      (文件必须真实存在才变链接; 一条回复最多查 40 个路径):
//      网页 html/htm → 浏览器; 文档 md/pdf/txt/json/csv/xlsx/docx/pptx 等、图片、音视频 → 默认程序;
//      `代码` 或 [文字](路径) 里真实存在的文件夹 → 文件管理器;
//      脚本和可执行文件 (bat/cmd/ps1/sh/exe/py/vbs 等) 不运行, 只在文件夹里选中它
//   2. 终端里每个写完的代码块 (```) 画成一张卡片: 标题栏 (语言名 + 填入 + 复制) 和代码区
//      各用主题里的一种底色, 跟着深色/浅色主题走; 鼠标移上去标题栏变亮、按钮变橙;
//      复制 = 代码原文进剪贴板 (末尾不带换行), 之后 1.8 秒显示绿色"已复制 ✓";
//      填入 = 只有一条命令的 shell 代码块, 以 ! 开头填进输入框, 按回车才运行
//   3. 终端里鼠标停在 Claude 的回复上, 右上角出现"复制全文" (复制这段回复的 markdown 原文)
//   4. 终端里 Write / Edit 写完的文件, 工具行后面有"打开"
//   5. /open       打开最近一次提到或写出的文件
//      /open 3     打开倒数第 3 个;  /open list  列出最近 10 个, 单击打开; Claude 工作时也能用
//   客户端 (desktop) 自带复制按钮和文件链接: 只保留原来的 HTML 链接, 其余功能只在终端

const MAX_RECENT = 50
const LIST_SIZE = 10
const MAX_CHECKS = 40 // 一条回复最多查 40 个路径, 别拖慢渲染
const MISS_MS = 3_000 // "不存在"只记 3 秒: 文件可能稍后才写出
const MAX_PART = 9_000 // Markdown 一次最多画 10000 字, 超了就交给引擎原样画
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// 能点开的文件类型
const HTML_EXT = ['html', 'htm']
const DOC_EXT = ['md', 'markdown', 'pdf', 'txt', 'log', 'json', 'csv', 'tsv', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt']
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
const MEDIA_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'wav']
// 脚本和可执行文件: 单击只在文件夹里选中, 绝不直接运行 (Windows 上 .js / .vbs 双击会被系统执行)
const SCRIPT_EXT = [
  'bat', 'cmd', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'command', 'exe', 'msi',
  'py', 'pyw', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'reg', 'lnk', 'jar', 'appimage',
]
const HTML = new Set(HTML_EXT)
const SCRIPT = new Set(SCRIPT_EXT)
const LINKABLE = new Set([...HTML_EXT, ...DOC_EXT, ...IMAGE_EXT, ...MEDIA_EXT, ...SCRIPT_EXT])

const PATH_CHARS = String.raw`[^\s"'\x60()（）<>\[\]{}|,，。：；、！？*]`
type ExtRule = { bare: RegExp; span: RegExp; has: RegExp; set: Set<string> }
function extRule(list: string[]): ExtRule {
  const alt = [...list].sort((a, b) => b.length - a.length).join('|')
  return {
    bare: new RegExp(`(?:[A-Za-z]:[\\\\/])?${PATH_CHARS}+?\\.(?:${alt})(?![\\w.])`, 'gi'),
    span: new RegExp(`\`([^\`\\n]+\\.(?:${alt}))\``, 'gi'),
    has: new RegExp(`\\.(?:${alt})(?![\\w])`, 'i'),
    set: new Set(list),
  }
}
const WIDE = extRule([...LINKABLE]) // 终端: 所有支持的类型
const NARROW = extRule(HTML_EXT) // 客户端: 维持原来只认 HTML
const MD_LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g
const ANY_SPAN = /`([^`\n]+)`/g
const DIR_HINT = /`[^`\n]*[\\/][^`\n]*`|\]\([^)\s]*[\\/][^)\s]*\)/
const FENCE = /^( {0,12})(`{3,}|~{3,})(.*)$/
const HAS_FENCE = /^ {0,12}(```|~~~)/m
// 卡片颜色用主题键, 深色/浅色主题各自有值 (深色: 标题栏 55 灰, 悬停 70 灰, 代码区 38 灰)
const CARD_HEAD = 'userMessageBackground'
const CARD_HEAD_HOVER = 'userMessageBackgroundHover'
const CARD_BODY = 'composerSidebarBackground'
const PRESS_HOVER = { color: 'claude', bold: true, dimColor: false }
const COPIED_MS = 1_800

// 代码块语言 → 哪种 shell 的命令; shell / console 不指明, 算通用
type ShellKind = 'bash' | 'powershell' | 'cmd' | 'any'
const SHELL_LANGS: Record<string, ShellKind> = {
  bash: 'bash', sh: 'bash', zsh: 'bash', shell: 'any', console: 'any',
  powershell: 'powershell', ps1: 'powershell', pwsh: 'powershell', cmd: 'cmd', bat: 'cmd',
}
const SHELL_NAME: Record<ShellKind, string> = { bash: 'bash', powershell: 'PowerShell', cmd: 'cmd', any: 'shell' }

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
const missCache = new Map<string, number>() // 刚查过不存在的路径 → 查的时间
const dirSet = new Set<string>() // 查到是文件夹的路径
const seen = new Set<string>() // 已记进 /open 列表的 `${消息 id}|${路径}`: 重画同一条回复不打乱顺序
const copied = new Set<string>() // 刚复制过的: `${消息 id}:${第几块}` / `${消息 id}:all`

type Part =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; code: string; indent: number; fenced: string }
type Found = { abs: string; isDir: boolean }
// 一条回复共用的查找额度和结果 (同一路径只查一次)
type Budget = { left: number; memo: Map<string, Found | null> }
const newBudget = (): Budget => ({ left: MAX_CHECKS, memo: new Map() })

const winPath = (p: string) => p.replace(/\//g, '\\')
// 去掉末尾的 / 或 \ (盘符根 C:\ 和 / 保留)
const trimSep = (p: string) => p.replace(/(?<=[^\\/:])[\\/]+$/, '')
const baseName = (p: string) => trimSep(p).split(/[\\/]/).pop() ?? p
const extOf = (p: string) => (/\.([A-Za-z0-9]+)$/.exec(trimSep(p))?.[1] ?? '').toLowerCase()
// 去重和缓存用的键: Linux 文件名分大小写, Windows / macOS 默认不分
const keyOf = (abs: string) => (os === 'linux' ? trimSep(abs) : trimSep(abs).toLowerCase())
const isUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^file:/i.test(s)

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
  return 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function remember(abs: string) {
  recent = [abs, ...recent.filter(p => keyOf(p) !== keyOf(abs))].slice(0, MAX_RECENT)
}

// 回复里提到的路径记进 /open 列表: 同一条回复里每个路径只记一次, 先提到的排在最前
function noteFound(rid: string, found: Found[]) {
  if (seen.size > 5_000) seen.clear()
  for (const f of [...found].reverse()) {
    const k = rid + '|' + keyOf(f.abs)
    if (seen.has(k)) continue
    seen.add(k)
    remember(f.abs)
  }
}

async function exists($: any, abs: string): Promise<boolean> {
  const key = keyOf(abs)
  if (existCache.get(key)) return true
  const missed = missCache.get(key)
  if (missed !== undefined && Date.now() - missed < MISS_MS) return false
  let ok = false
  try {
    ok = await $.fs.exists(abs)
  } catch {}
  // "存在"一直记着; "不存在"只记几秒 (文件可能稍后才写出)
  if (ok) existCache.set(key, true)
  else missCache.set(key, Date.now())
  return ok
}

async function isDirectory($: any, abs: string): Promise<boolean> {
  const key = keyOf(abs)
  if (dirSet.has(key)) return true
  try {
    const st = await $.fs.stat(abs)
    if (st?.kind === 'dir') {
      dirSet.add(key)
      return true
    }
  } catch {}
  return false
}

// 看着像文件夹路径: 有 / 或 \, 不是网址, 没有通配符; 带空格的只认绝对路径; 末段像文件名 (a.tsx) 的不查
function dirLike(s: string): boolean {
  if (s.length > 260 || isUrl(s) || /[*?<>|"]/.test(s) || !/[\\/]/.test(s)) return false
  if (/\s/.test(s) && !/^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|file:)/i.test(s)) return false
  return !/\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(trimSep(s))
}

// Windows 上从 Claude Code 隐藏启动的 explorer.exe 开出来的文件夹窗口是看不见的,
// 所以文件夹和非 HTML 文件经 cmd 的 start 转一手 (和 usage-hud 同一做法, 已在本机验证);
// 路径里有 cmd 会误解的字符时改用 PowerShell 的 Start-Process
function utf16Base64(s: string): string {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    bytes.push(c & 255, c >> 8)
  }
  return (new Uint8Array(bytes) as any).toBase64()
}
const psQuote = (s: string) => "'" + s.replace(/'/g, "''") + "'"

async function runPowerShell($: any, script: string) {
  const r = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', utf16Base64(script)], {
    timeoutMs: 20_000,
  })
  if (r && r.exitCode !== 0) throw new Error('PowerShell 退出码 ' + r.exitCode + ' ' + String(r.stderr ?? '').slice(0, 80))
}

async function startWindows($: any, abs: string) {
  if (/^[^&^|<>()%!"]+$/.test(abs)) {
    const r = await $.process.run(['cmd.exe', '/d', '/c', 'start', 'html shelf', abs], { timeoutMs: 10_000 })
    if (r && r.exitCode !== 0) throw new Error('cmd start 退出码 ' + r.exitCode)
  } else await runPowerShell($, 'Start-Process -FilePath ' + psQuote(abs))
}

// 在文件夹里选中它: Windows 用 PowerShell 的 Start-Process 拉起 explorer.exe /select,"路径"
// (本机实测: 窗口可见且选中; 直接跑 explorer.exe /select 会开出看不见的窗口),
// macOS 用 open -R, Linux 打开它所在的文件夹
async function reveal($: any, abs: string) {
  if (os === 'windows') {
    await runPowerShell($, "Start-Process -FilePath 'explorer.exe' -ArgumentList " + psQuote('/select,"' + abs + '"'))
    return
  }
  if (os === 'mac') {
    if (await ranOk($, ['open', '-R', abs])) return
    throw new Error('没能打开, 试过: open -R')
  }
  await openPosix($, abs.replace(/\/[^/]*$/, '') || '/', os)
}

// 单击链接 / 打开按钮 / /open 都走这里: 按类型决定怎么开
async function act($: any, target: string) {
  try {
    await useOS($)
    const abs = trimSep(target)
    const name = baseName(abs)
    const ext = extOf(abs)
    if (SCRIPT.has(ext)) {
      await reveal($, abs)
      $.ui.toast('已在文件夹里选中: ' + name + '（脚本不会直接运行）')
      return
    }
    const isDir = dirSet.has(keyOf(abs)) || (!LINKABLE.has(ext) && (await isDirectory($, abs)))
    if (HTML.has(ext) && !isDir) {
      // Windows: explorer.exe 用默认浏览器打开, 不经过 shell, 路径里有空格和 & 也安全
      if (os === 'windows') await $.process.run(['explorer.exe', abs], { timeoutMs: 10_000 })
      else await openPosix($, abs, os)
      $.ui.toast('已用浏览器打开: ' + name)
      return
    }
    if (os === 'windows') await startWindows($, abs)
    else await openPosix($, abs, os)
    $.ui.toast((isDir ? '已打开文件夹: ' : '已打开: ') + name)
  } catch (err) {
    $.ui.toast('打开失败: ' + String(err))
  }
}

// 把一段 markdown 里的文件路径改写成 file:/// 链接; 代码块 (```) 里的不动.
// wide = 终端 (所有类型 + 文件夹), 否则只认 HTML
async function linkify(
  $: any,
  text: string,
  wide: boolean,
  budget: Budget = newBudget(),
): Promise<{ text: string; hrefs: string[]; found: Found[] }> {
  await useOS($)
  const rule = wide ? WIDE : NARROW
  const hrefs: string[] = []
  const found: Found[] = []
  const slots: string[] = []
  const hold = (s: string) => `\u0000${slots.push(s) - 1}\u0000`

  // 找到真实存在的文件 (或文件夹) 才返回; 额度用完就不再查
  async function locate(raw: string, wantDir: boolean): Promise<Found | null> {
    const memoKey = (wantDir ? 'd:' : 'f:') + raw
    if (budget.memo.has(memoKey)) return budget.memo.get(memoKey) ?? null
    let hit: Found | null = null
    if (budget.left > 0) {
      budget.left -= 1
      for (const abs of candidates(raw)) {
        if (!(await exists($, abs))) continue
        if (wantDir && !(await isDirectory($, abs))) continue
        hit = { abs: wantDir ? trimSep(abs) : abs, isDir: wantDir }
        break
      }
    }
    budget.memo.set(memoKey, hit)
    return hit
  }

  async function link(raw: string, label: string, allowDir: boolean): Promise<string | undefined> {
    if (isUrl(raw)) return undefined
    const hasExt = rule.set.has(extOf(raw))
    if (!hasExt && !(allowDir && wide && dirLike(raw))) return undefined
    const hit = await locate(raw, !hasExt)
    if (!hit) return undefined
    const href = toHref(hit.abs)
    hrefs.push(href)
    found.push(hit)
    return `[${label}](${href})`
  }

  // 每次复制一份正则: 循环里要等查文件, 几条回复同时在画时共用一个 lastIndex 会互相打乱
  async function replaceAsync(s: string, shared: RegExp, fn: (m: RegExpExecArray) => Promise<string>) {
    const re = new RegExp(shared.source, shared.flags)
    let out = ''
    let last = 0
    for (let m = re.exec(s); m; m = re.exec(s)) {
      out += s.slice(last, m.index) + (await fn(m))
      last = m.index + m[0].length
    }
    return out + s.slice(last)
  }

  const parts = text.split(/(```[\s\S]*?```)/g)
  for (let i = 0; i < parts.length; i += 2) {
    let s = parts[i] ?? ''
    // 已有的 markdown 链接: 只换目标 (网址原样留着, 也不再被当成裸路径)
    s = await replaceAsync(s, MD_LINK, async m => hold((await link(m[2] ?? '', m[1] ?? '', true)) ?? m[0]))
    // `路径` (文件或文件夹)
    s = await replaceAsync(s, wide ? ANY_SPAN : rule.span, async m => {
      const raw = m[1] ?? ''
      return hold((await link(raw, '`' + raw + '`', true)) ?? m[0])
    })
    // 裸路径 (只认带后缀的文件)
    s = await replaceAsync(s, rule.bare, async m => hold((await link(m[0], m[0], false)) ?? m[0]))
    parts[i] = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)] ?? '')
  }
  return { text: parts.join(''), hrefs, found }
}

// 这段文字里可能有能点开的路径 (先粗筛, 免得每条回复都去查文件)
function mayLink(text: string, wide: boolean): boolean {
  return wide ? WIDE.has.test(text) || DIR_HINT.test(text) : NARROW.has.test(text)
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

// 整段文字去掉所有非空行共有的缩进 (相对缩进和代码块原样保留)
function dedentAll(text: string): string {
  const lines = trimBlankLines(text.replace(/\r\n/g, '\n')).split('\n')
  const widths = lines.filter(l => l.trim()).map(l => /^ */.exec(l)?.[0].length ?? 0)
  const n = widths.length ? Math.min(...widths) : 0
  return lines.map(l => dedent(l, n)).join('\n')
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
    const m = FENCE.exec(lines[i] ?? '')
    // ``` 后面的说明里再有反引号, 是行内代码, 不是代码块
    if (!m || (m[2]?.[0] === '`' && (m[3] ?? '').includes('`'))) {
      prose.push(lines[i] ?? '')
      continue
    }
    const indent = (m[1] ?? '').length
    const mark = m[2] ?? '```'
    // 收尾的围栏: 同一种符号, 不短于开头
    const close = new RegExp('^ *' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}[ \\t]*$')
    let j = i + 1
    while (j < lines.length && !close.test(lines[j] ?? '')) j++
    if (j >= lines.length) {
      prose.push(...lines.slice(i))
      break
    }
    flush()
    // 列表里缩进的代码块: 按开头围栏的缩进去掉每行前面的空格
    const body = lines.slice(i + 1, j).map(l => dedent(l, indent))
    const info = (m[3] ?? '').trim()
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

// shell 代码块里只有一条命令时取出它, 否则 undefined (不显示"填入"):
// 行尾续行符 (bash \ / PowerShell ` / cmd ^) 拼成一行; 空行、整行注释不算;
// 有提示符 ($ / PS C:\>) 的块只取带提示符的行 (其余是输出); here-doc 不算单行
function oneCommand(code: string, kind: ShellKind): string | undefined {
  const cont = kind === 'powershell' ? '`' : kind === 'cmd' ? '^' : '\\'
  const logical: string[] = []
  let buf = ''
  for (const raw of code.split('\n')) {
    const line = buf ? raw.trim() : raw.replace(/\s+$/, '')
    if (line.endsWith(cont)) {
      buf += line.slice(0, -1).replace(/\s+$/, '') + ' '
      continue
    }
    logical.push(buf + line)
    buf = ''
  }
  if (buf) return undefined // 最后一行还在续行: 命令没写完
  const isComment = (l: string) => (kind === 'cmd' ? /^(?:@?rem\b|::)/i.test(l) : l.startsWith('#'))
  let cmds = logical.map(l => l.trim()).filter(l => l && !isComment(l))
  const prompt =
    kind === 'any' ? /^(?:PS [^>]*>|[$%>])\s+/ : kind === 'powershell' ? /^PS [^>]*>\s+/ : kind === 'bash' ? /^[$%]\s+/ : undefined
  if (prompt && cmds.some(l => prompt.test(l))) cmds = cmds.filter(l => prompt.test(l)).map(l => l.replace(prompt, ''))
  if (cmds.length !== 1) return undefined
  const c = (cmds[0] ?? '').trim()
  if (!c || /<<-?\s*['"]?\w/.test(c)) return undefined
  return c
}

function preview(code: string): string {
  const lines = code.split('\n')
  const first = (lines[0] ?? '').trim()
  const head = first.length > 36 ? first.slice(0, 36) + '...' : first
  return lines.length > 1 ? `${head} 等 ${lines.length} 行` : head
}

function markCopied($: any, id: string, isOn: boolean) {
  if (isOn) copied.add(id)
  else copied.delete(id)
  $.ui.invalidate('ui.render')
}

async function copyText($: any, id: string, text: string, surface: any, done: string) {
  try {
    const r = await $.ui.copy({ text, surface })
    if (r?.isCopied) {
      markCopied($, id, true)
      $.ui.toast(done)
      $.clock.after(COPIED_MS, () => markCopied($, id, false))
    } else {
      $.ui.toast('没复制上 (' + String(r?.reason ?? '原因不明') + '), 可以改用 /copy')
    }
  } catch (err) {
    $.ui.toast('复制失败: ' + String(err))
  }
}

// 这台机器上 ! 开头的输入用哪个 shell 跑: 环境变量 CLAUDE_CODE_USE_POWERSHELL_TOOL 优先,
// 其次设置里的 defaultShell, 都没有时 Windows = PowerShell, macOS / Linux = bash
async function bangShell($: any): Promise<'bash' | 'powershell'> {
  await useOS($)
  const flag = String((await $.env.get('CLAUDE_CODE_USE_POWERSHELL_TOOL')) ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(flag)) return 'powershell'
  if (['0', 'false', 'no', 'off'].includes(flag)) return 'bash'
  try {
    const s: any = await $.settings.read()
    if (s?.defaultShell === 'bash' || s?.defaultShell === 'powershell') return s.defaultShell
  } catch {}
  return os === 'windows' ? 'powershell' : 'bash'
}

// 填入: 以 ! 开头放进输入框 (替换原有草稿), 不提交; 代码块语言和 ! 用的 shell 对不上时提醒
async function fillPrompt($: any, cmd: string, kind: ShellKind) {
  try {
    // 输入框里有打了一半的字就不覆盖 (fill 默认 replace 会清掉草稿)
    let draft = ''
    try {
      draft = String((await $.prompt.read())?.text ?? '')
    } catch {}
    if (draft.trim()) {
      $.ui.toast('输入框里有没发出的字, 没覆盖; 清空后再点"填入", 或者用"复制"')
      return
    }
    const r = await $.prompt.fill({ text: '!' + cmd })
    if (!r?.isFilled) {
      const why = r?.refusal === 'dialog' ? '有对话框占着键盘' : r?.refusal === 'no_composer' ? '这里没有输入框' : '输入框没接收'
      $.ui.toast('没填进去: ' + why + ', 可以改用"复制"')
      return
    }
    const shell = await bangShell($)
    const clash = kind !== 'any' && kind !== shell
    $.ui.toast(
      '已填入输入框，按回车运行' +
        (clash ? ` · 注意: 这是 ${SHELL_NAME[kind]} 命令, 你的 ! 用 ${SHELL_NAME[shell]} 运行` : ''),
    )
  } catch (err) {
    $.ui.toast('填入失败: ' + String(err))
  }
}

// 一个代码块的卡片: 标题栏 (语言名 … 填入 复制) + 代码区; key 让整张卡片成为悬停范围
function codeCard($: any, els: any, p: Extract<Part, { kind: 'code' }>, n: number, rid: string, gap: number) {
  const { Box, Text, Button, Code } = els
  const id = `${rid}:${n}`
  const lang = p.lang.slice(0, 20)
  const kind = SHELL_LANGS[p.lang.toLowerCase()]
  const cmd = kind ? oneCommand(p.code, kind) : undefined
  const actions: any[] = []
  if (kind && cmd)
    actions.push(
      <Button
        key={`fill-${n}`}
        plain
        dimColor
        label="填入"
        hover={PRESS_HOVER}
        onPress={() => fillPrompt($, cmd, kind)}
      />,
    )
  if (copied.has(id)) actions.push(<Text color="success">已复制 ✓</Text>)
  else
    actions.push(
      <Button
        key={`copy-${n}`}
        plain
        dimColor
        label="复制"
        hover={PRESS_HOVER}
        onPress={press => copyText($, id, p.code, press.surface, '已复制: ' + preview(p.code))}
      />,
    )
  const head: any[] = []
  if (lang) head.push(<Text color="inactive">{lang}</Text>)
  head.push(
    <Box flexDirection="row" gap={2}>
      {actions}
    </Box>,
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

type Drawn = { tree: any; coverRight: number }

// 终端里带代码块的回复: 自己分段画, 文字段照常, 代码块画成卡片;
// 返回 undefined = 不归这里画 (没有写完的代码块, 或某段太长)
async function drawWithCopy($: any, e: any, props: { text: string; isFirstOfReply: boolean }, budget: Budget) {
  const parts = splitCode(props.text)
  if (!parts.some(p => p.kind === 'code' && p.code.trim())) return undefined
  if (parts.some(p => (p.kind === 'prose' ? p.text : p.fenced).length > MAX_PART)) return undefined

  const els = $.ui.resolve(e)
  const { Box, Text, Markdown } = els
  const rid = String(e.requestId ?? '')
  const rows: any[] = []
  let n = 0
  let coverRight = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    const gap = i === 0 ? 0 : 1
    if (p.kind === 'prose') {
      let md = <Markdown text={p.text} />
      if (mayLink(p.text, true)) {
        const { text, hrefs, found } = await linkify($, p.text, true, budget)
        if (hrefs.length) {
          noteFound(rid, found)
          md = (
            <Markdown
              key={`html-links-${rid}-${i}`}
              text={text}
              pressableLinks={hrefs}
              onLinkPress={link => act($, absolute(link.href))}
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
    // 回复第一行就是卡片标题栏时, "复制全文"往左让开卡片自己的按钮 (右内边距 2 + 已复制 ✓ 8 格 + 填入 6 格)
    if (i === 0) {
      const kind = SHELL_LANGS[p.lang.toLowerCase()]
      coverRight = 2 + 8 + (kind && oneCommand(p.code, kind) ? 6 : 0) + 1
    }
    rows.push(codeCard($, els, p, n, rid, gap))
  }
  const tree = (
    <Box flexDirection="row">
      <Text>{props.isFirstOfReply ? '● ' : '  '}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {rows}
      </Box>
    </Box>
  )
  return { tree, coverRight } as Drawn
}

// 没有代码块 (或交给引擎画代码块) 的回复: 有能点开的路径就换成可点击的 Markdown
async function drawLinked($: any, e: any, props: { text: string; isFirstOfReply: boolean }, wide: boolean, budget?: Budget) {
  if (props.text.length > MAX_PART || !mayLink(props.text, wide)) return undefined
  const { text, hrefs, found } = await linkify($, props.text, wide, budget)
  if (hrefs.length === 0) return undefined
  noteFound(String(e.requestId ?? ''), found)

  const { Box, Text, Markdown } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      <Text>{props.isFirstOfReply ? '● ' : '  '}</Text>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown
          key={'html-links-' + (e.requestId ?? '')}
          text={text}
          pressableLinks={hrefs}
          onLinkPress={link => act($, absolute(link.href))}
        />
      </Box>
    </Box>
  )
}

// 整条回复包一层 (带 key = 悬停范围), 右上角叠一个平时隐藏的"复制全文"; 不挤动原来的排版.
// 小底块用代码区的深灰 (盖在卡片标题栏上也看得清), 指到它上面变成标题栏的灰
function withCopyAll($: any, e: any, tree: any, text: string, coverRight: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const id = `${String(e.requestId ?? '')}:all`
  const isCopied = copied.has(id)
  const body = dedentAll(text)
  // 刚复制过: 不等悬停, 直接显示"已复制 ✓" (引擎不许给本来就显示的 Box 再加 hover 显示)
  const shown = isCopied ? { display: 'flex' as const } : { display: 'none' as const, hover: { display: 'flex' as const } }
  return (
    <Box key="reply" flexDirection="column">
      {tree}
      <Box position="absolute" top={0} right={coverRight} {...shown}>
        <Box key="copy-all-chip" paddingX={1} backgroundColor={CARD_BODY} hover={{ backgroundColor: CARD_HEAD }}>
          {isCopied ? (
            <Text color="success">已复制 ✓</Text>
          ) : (
            <Button
              key="copy-all"
              plain
              dimColor
              label="复制全文"
              hover={PRESS_HOVER}
              onPress={press => copyText($, id, body, press.surface, '已复制全文 (' + body.split('\n').length + ' 行)')}
            />
          )}
        </Box>
      </Box>
    </Box>
  )
}

// /open list 的文字: 带序号的链接, 后面跟所在目录 (项目里的写相对路径)
function listText(): string {
  const esc = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1')
  const rows = recent.slice(0, LIST_SIZE).map((abs, i) => {
    const dir = abs.slice(0, abs.length - baseName(abs).length).replace(/[\\/]+$/, '')
    const rootKey = root ? keyOf(root) : ''
    let where = dir
    if (rootKey && keyOf(dir) === rootKey) where = ''
    else if (rootKey && keyOf(dir).startsWith(rootKey + (os === 'windows' ? '\\' : '/'))) where = dir.slice(trimSep(root).length + 1)
    return `${i + 1}. [${esc(baseName(abs))}](${toHref(abs)})` + (where ? ` · \`${where.replace(/`/g, "'")}\`` : '')
  })
  return '最近的文件（单击打开，也可以 /open 序号）：\n\n' + rows.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await useOS($)
    try {
      await $.command.register({
        name: 'open',
        description: '打开最近提到或写出的文件（/open 2 = 倒数第 2 个，/open list = 列出最近 10 个）',
        argumentHint: '[N | list]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('html-shelf: /open 注册失败 ' + String(err))
    }
    return next(e)
  })

  on('command.run', { command: 'open' }, async ($, e) => {
    await useOS($)
    const arg = String(e.args || '').trim().toLowerCase()
    if (arg === 'list' || arg === 'ls' || arg === 'l') {
      if (!recent.length) return { text: '还没有可打开的文件。' }
      return { text: listText() }
    }
    const n = parseInt(arg || '1', 10) || 1
    const abs = recent[n - 1]
    if (!abs) return { text: recent.length ? `没有倒数第 ${n} 个（最近只有 ${recent.length} 个，/open list 看列表）。` : '还没有可打开的文件。' }
    await act($, abs)
    return {}
  })

  // /open list 的输出行: 终端里链接单击就打开
  on('ui.render', { component: 'CommandOutput', props: { command: 'open' } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored) return next(e)
    const hrefs = [...e.props.text.matchAll(/\]\((file:\/\/[^)\s]+)\)/g)].map(m => m[1] ?? '')
    if (!hrefs.length || e.props.text.length > MAX_PART) return next(e)
    await useOS($)
    const { Box, Markdown } = $.ui.resolve(e)
    return (
      <Box paddingLeft={2}>
        <Markdown key="open-list" text={e.props.text} pressableLinks={hrefs} onLinkPress={link => act($, absolute(link.href))} />
      </Box>
    )
  })

  // 智能体写出支持的文件时记下来, /open 直接能开
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = ((e as any).file_path ?? (e as any).notebook_path) as string | undefined
    if (FILE_TOOLS.has(e.tool) && path && LINKABLE.has(extOf(path)) && ran.deny === undefined && !ran.isError) {
      await useOS($)
      const abs = absolute(path)
      existCache.set(keyOf(abs), true)
      remember(abs)
    }
    return ran
  })

  // 工具行: Write / Edit 写完的文件后面加"打开" (只在终端; 引擎原样画的那行不动)
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (e.surface !== 'terminal' || !FILE_TOOLS.has(p.tool) || p.isRunning || p.isErrored || p.isInterrupted) return next(e)
    const input = (p.input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
    const raw = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
    if (typeof raw !== 'string' || !LINKABLE.has(extOf(raw))) return next(e)
    await useOS($)
    const abs = absolute(raw)
    const base = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box key="tool-row" flexDirection="row" alignItems="flex-start">
        {base}
        <Box marginLeft={2} flexShrink={0}>
          <Button key="open-file" plain dimColor label="打开" hover={PRESS_HOVER} onPress={() => act($, abs)} />
        </Box>
      </Box>
    )
  })

  // Claude 的回复
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const props = e.props as { text: string; isFirstOfReply: boolean }
    if (!props?.text) return next(e)

    // 客户端: 维持原样, 只把 HTML 路径换成链接
    if (e.surface !== 'terminal') return (await drawLinked($, e, props, false)) ?? next(e)

    // 终端: 有写完的代码块就分段画成卡片 (路径链接一起处理); 否则只换链接; 都不需要就交给引擎;
    // 最后统一包一层"复制全文"
    const budget = newBudget()
    let drawn: Drawn | undefined
    if (HAS_FENCE.test(props.text)) drawn = await drawWithCopy($, e, props, budget)
    if (!drawn) {
      const linked = await drawLinked($, e, props, true, budget)
      if (linked) drawn = { tree: linked, coverRight: 0 }
    }
    const tree = drawn ? drawn.tree : await next(e)
    return withCopyAll($, e, tree, props.text, drawn?.coverRight ?? 0)
  })
}
