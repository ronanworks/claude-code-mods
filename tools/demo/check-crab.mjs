// 校验: lib/crab.js 画出的螃蟹和 usage-hud 源码画出的完全一样 (逐帧比对 encode 后的终端格子)
// 用法: node tools/demo/check-crab.mjs
//   源码一侧: 从 usage-hud/hooks/register.tsx 里按标记切出 COL/DEF/mix/heat/toolKind 和 "像素画" 一节, 去掉类型后执行 (只读)
//   负路径: 把移植版里一个像素坐标故意改坏, 必须报出不一致, 否则本脚本判失败
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const src = readFileSync(new URL('../../usage-hud/hooks/register.tsx', import.meta.url), 'utf8')
const port = readFileSync(new URL('./lib/crab.js', import.meta.url), 'utf8')

function cut(re, what) {
  const m = src.match(re)
  if (!m) throw new Error('源码里找不到 ' + what + ' (源码结构变了?)')
  return m[0]
}
const pieces = [
  'let frame = 0',
  cut(/^const SPRITE_W = .*$/m, 'SPRITE_W'),
  cut(/^const MINI_W = .*$/m, 'MINI_W'),
  cut(/^const COL = \{[\s\S]*?\n\}/m, 'COL'),
  cut(/^const DEF = .*$/m, 'DEF'),
  cut(/^function mix\([\s\S]*?\n\}/m, 'mix'),
  cut(/^function heat\([\s\S]*?\n\}/m, 'heat'),
  cut(/^type ToolKind[\s\S]*?^function toolKind\([\s\S]*?\n\}/m, 'toolKind'),
  cut(/\/\/ -{16} 像素画 -{16}[\s\S]*?(?=\nconst KAOMOJI)/, '像素画一节'),
  'export function __setFrame(f) { frame = f }',
  'export { scenePx, miniPx, encode, toolKind }',
]
const toUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const real = await import(toUrl(stripTypeScriptTypes(pieces.join('\n'))))
const mine = await import(toUrl(port))

const TOOLS = ['', 'Read', 'Grep', 'Write', 'Edit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Agent', 'TodoWrite', 'mcp__x__y']
function compare(a, label) {
  let cases = 0
  let bad = 0
  const first = []
  for (const tool of TOOLS) {
    if (a.toolKind(tool) !== real.toolKind(tool)) {
      bad++
      first.push(`toolKind(${tool})`)
    }
    for (const mode of ['work', 'celebrate', 'sleep', 'idle']) {
      for (const pct of [30, 85, 97]) {
        for (const agents of [0, 2]) {
          const s = { working: mode === 'work', kind: real.toolKind(tool), pct, celebrating: mode === 'celebrate', sleeping: mode === 'sleep', agents }
          for (let f = 0; f < 200; f++) {
            real.__setFrame(f)
            a.setFrame(f)
            const want = real.encode(real.scenePx(s), 15, 3) + '|' + real.encode(real.miniPx(s), 8, 1)
            const got = a.encode(a.scenePx(s), 15, 3) + '|' + a.encode(a.miniPx(s), 8, 1)
            cases++
            if (want !== got) {
              bad++
              if (first.length < 3) first.push(`${tool || '(思考)'} ${mode} pct=${pct} agents=${agents} frame=${f}`)
            }
          }
        }
      }
    }
  }
  console.log(`${label}: ${cases} 帧比对, ${bad} 处不一致${first.length ? ' 例: ' + first.join('; ') : ''}`)
  return bad
}

const bad = compare(mine, '移植版 lib/crab.js vs 源码')
// 负路径: 纸的位置往下挪一格
const broken = port.replace('rect(p, 12, 1, 3, 4, COL.paper)', 'rect(p, 12, 2, 3, 4, COL.paper)')
if (broken === port) throw new Error('负路径没改到东西')
const badBroken = compare(await import(toUrl(broken)), '故意改坏的版本 (负路径)')
if (bad !== 0) {
  console.error('失败: 移植版和源码不一致')
  process.exit(1)
}
if (badBroken === 0) {
  console.error('失败: 改坏的版本没被发现, 校验无效')
  process.exit(1)
}
console.log('通过: 移植版与源码逐帧一致; 负路径能报出不一致')
