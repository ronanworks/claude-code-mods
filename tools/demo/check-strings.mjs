// 校验: 演示脚本和场景里不出现本机路径 / 内部项目名 / 用户名 (GIF 画面里的文字全部来自这些源文件)
// 用法: node tools/demo/check-strings.mjs
//   扫描 tools/demo 下的 .html .js .mjs .md (不含 out/); 负路径: 先拿一段故意带禁词的文字自测, 必须报出来
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m)
// 通用禁词按片段拼出来, 免得本文件自己命中: 用户目录、品牌图形 (启动吉祥物的块字符、订阅档位名)
const COMMON = [
  ['C:', '\\', 'Users'],
  ['C:', '\\\\', 'Users'],
  ['C:', '/', 'Users'],
  ['▐', '▛'],
  ['▜', '▌'],
  ['Claude ', 'Max'],
].map(p => p.join(''))
// 你自己的本机路径、项目名、用户名写在 banned.local.txt (一行一个, 已 gitignore, 不会进仓库)
let LOCAL = []
try {
  LOCAL = readFileSync(join(HERE, 'banned.local.txt'), 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'))
} catch {
  console.log('提示: 没有 banned.local.txt, 只查通用禁词')
}
const BANNED = [...COMMON, ...LOCAL].map(w => new RegExp(esc(w), 'i'))

function scan(text) {
  const hits = []
  text.split(/\r?\n/).forEach((line, i) => {
    for (const re of BANNED) if (re.test(line)) hits.push({ line: i + 1, word: re.source, text: line.trim().slice(0, 100) })
  })
  return hits
}

// 负路径
const sample = ['const p = "C:', '\\', 'Users', '\\', 'someone\\.claude"'].join('')
if (scan(sample).length === 0) {
  console.error('失败: 自测样本里的禁词没被发现, 校验无效')
  process.exit(1)
}
console.log('负路径: 自测样本报出 ' + scan(sample).length + ' 处, 校验有效')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'out' || name === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(html|js|mjs|md)$/.test(name)) out.push(p)
  }
  return out
}
let bad = 0
const files = walk(HERE)
for (const f of files) {
  const hits = scan(readFileSync(f, 'utf8'))
  for (const h of hits) {
    bad++
    console.log(`${relative(HERE, f)}:${h.line}  [${h.word}]  ${h.text}`)
  }
}
console.log(`扫描 ${files.length} 个文件, ${bad} 处命中`)
process.exit(bad ? 1 : 0)
