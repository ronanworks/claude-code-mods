// 校验: 演示里移植的代码和 usage-hud 源码算出来的完全一样
//   1. 螃蟹: lib/crab.js 的 scenePx / miniPx 逐帧比对 encode 后的终端格子
//      覆盖 12 种工具 x 工作/庆祝/睡觉/闲置 x 情绪 (无/悠闲/正常/冒汗/慌张) x 子代理 0-3 只 x 上下文 30/85/97% x 160 帧
//   2. 配速和收据: lib/hud.js 的 paceOf / moodOf / limitExtra / receiptText 在一组输入上逐个比对
// 用法: node tools/demo/check-crab.mjs
//   源码一侧: 从 usage-hud/hooks/register.tsx 里按标记切出对应函数, 去掉类型后执行 (只读)
//   负路径: 把移植版故意改坏几处 (纸的位置 / 小螃蟹形状 / 墨镜 / 配速阈值), 每处都必须报出不一致, 否则本脚本判失败
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const src = readFileSync(new URL('../../usage-hud/hooks/register.tsx', import.meta.url), 'utf8')
const crabPort = readFileSync(new URL('./lib/crab.js', import.meta.url), 'utf8')
const hudPort = readFileSync(new URL('./lib/hud.js', import.meta.url), 'utf8')

function cut(re, what) {
  const m = src.match(re)
  if (!m) throw new Error('源码里找不到 ' + what + ' (源码结构变了?)')
  return m[0].replace(/^export /gm, '')
}
const pieces = [
  'let frame = 0',
  cut(/^const SPRITE_W = .*$/m, 'SPRITE_W'),
  cut(/^const MINI_W = .*$/m, 'MINI_W'),
  cut(/^const WINDOW_MS[\s\S]*?$/m, 'WINDOW_MS'),
  cut(/^const MIN_ELAPSED_FRAC = .*$/m, 'MIN_ELAPSED_FRAC'),
  cut(/^const PANIC_RUNOUT_MS = .*$/m, 'PANIC_RUNOUT_MS'),
  cut(/^const PACE_WARN = .*$/m, 'PACE_WARN'),
  cut(/^const COL = \{[\s\S]*?\n\}/m, 'COL'),
  cut(/^const DEF = .*$/m, 'DEF'),
  cut(/^function mix\([\s\S]*?\n\}/m, 'mix'),
  cut(/^function heat\([\s\S]*?\n\}/m, 'heat'),
  cut(/^function isWide\([\s\S]*?\n\}/m, 'isWide'),
  cut(/^function dw\([\s\S]*?\n\}/m, 'dw'),
  cut(/^const padR = .*$/m, 'padR'),
  cut(/^function durShort\([\s\S]*?\n\}/m, 'durShort'),
  cut(/\/\/ -{16} 配速 \(纯函数\) -{16}[\s\S]*?(?=\nfunction addTok)/, '配速一节'),
  cut(/^type ToolKind[\s\S]*?^function toolKind\([\s\S]*?\n\}/m, 'toolKind'),
  cut(/\/\/ -{16} 像素画 -{16}[\s\S]*?(?=\nconst KAOMOJI)/, '像素画一节'),
  cut(/^export function receiptText\([\s\S]*?\n\}/m, 'receiptText'),
  'export function __setFrame(f) { frame = f }',
  'export { scenePx, miniPx, encode, toolKind, paceOf, moodOf, limitExtra, receiptText }',
]
const toUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const real = await import(toUrl(stripTypeScriptTypes(pieces.join('\n'))))
const mineCrab = await import(toUrl(crabPort))
// hud.js 依赖 ./cells.js 和 ./crab.js: 换成绝对地址再载入
const fixImports = (code, crabCode) =>
  code
    .replace("from './cells.js'", `from '${new URL('./lib/cells.js', import.meta.url).href}'`)
    .replace("from './crab.js'", `from '${toUrl(crabCode)}'`)
const mineHud = await import(toUrl(fixImports(hudPort, crabPort)))

// ---------------- 1. 螃蟹 ----------------
const TOOLS = ['', 'Read', 'Grep', 'Write', 'Edit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Agent', 'TodoWrite', 'mcp__x__y']
const MOODS = [undefined, 'chill', 'normal', 'sweat', 'panic']
function compareCrab(a, label) {
  let cases = 0
  let bad = 0
  const first = []
  for (const tool of TOOLS) {
    if (a.toolKind(tool) !== real.toolKind(tool)) {
      bad++
      first.push(`toolKind(${tool})`)
    }
    for (const mode of ['work', 'celebrate', 'sleep', 'idle']) {
      for (const mood of MOODS) {
        for (const pct of [30, 85, 97]) {
          for (const agents of [0, 1, 2, 3]) {
            const s = { working: mode === 'work', kind: real.toolKind(tool), pct, celebrating: mode === 'celebrate', sleeping: mode === 'sleep', agents, mood }
            for (let f = 0; f < 160; f++) {
              real.__setFrame(f)
              a.setFrame(f)
              const want = real.encode(real.scenePx(s), 15, 3) + '|' + real.encode(real.miniPx(s), 8, 1)
              const got = a.encode(a.scenePx(s), 15, 3) + '|' + a.encode(a.miniPx(s), 8, 1)
              cases++
              if (want !== got) {
                bad++
                if (first.length < 3) first.push(`${tool || '(思考)'} ${mode} 情绪=${mood ?? '无'} 上下文=${pct}% 子代理=${agents} 帧=${f}`)
              }
            }
          }
        }
      }
    }
  }
  console.log(`螃蟹 ${label}: ${cases} 帧比对, ${bad} 处不一致${first.length ? ' 例: ' + first.join('; ') : ''}`)
  return bad
}

// ---------------- 2. 配速和收据 ----------------
const NOW = 1_800_000_000_000
const WIN = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000, spend_limit: 3600_000 }
function limits() {
  const out = [undefined, { kind: 'five_hour', percentUsed: 50 }]
  for (const kind of Object.keys(WIN))
    for (const pct of [0, 0.5, 1, 3, 4.6, 5, 10, 23, 40, 60, 81, 90, 95, 99, 100, 120])
      for (const frac of [-0.1, 0, 0.001, 0.01, 0.03, 0.1, 0.25, 0.5, 0.8, 0.96, 0.99, 1, 1.2])
        out.push({ kind, percentUsed: pct, resetsAt: new Date(NOW + WIN[kind] * frac).toISOString() })
  return out
}
function comparePace(a, label) {
  let cases = 0
  let bad = 0
  const first = []
  const check = (name, want, got) => {
    cases++
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      bad++
      if (first.length < 3) first.push(name)
    }
  }
  const ls = limits()
  for (const l of ls) {
    const pr = real.paceOf(l, NOW)
    const pm = a.paceOf(l, NOW)
    check('paceOf ' + JSON.stringify(l), pr, pm)
    check('moodOf ' + JSON.stringify(l), real.moodOf(pr), a.moodOf(pm))
    for (const w of [5, 11]) check(`limitExtra(${w}) ` + JSON.stringify(l), real.limitExtra(pr, w), a.limitExtra(pm, w))
  }
  // 两个窗口取更紧张的那个
  for (let i = 0; i < ls.length; i += 7) for (let j = 1; j < ls.length; j += 11) check('moodOf 两个', real.moodOf(real.paceOf(ls[i], NOW), real.paceOf(ls[j], NOW)), a.moodOf(a.paceOf(ls[i], NOW), a.paceOf(ls[j], NOW)))
  check('moodOf 无', real.moodOf(undefined, undefined), a.moodOf(undefined, undefined))
  for (const usd of [undefined, 0, 0.004, 0.005, 0.42, 3.5])
    for (const files of [0, 1, 2])
      for (const [add, del] of [[0, 0], [32, 0], [5, 1]])
        for (const tools of [0, 1, 9]) {
          const r = { turnId: 'x', startedAt: 0, completedAt: 0, durationMs: 0, usd, files, add, del, tools }
          check('receiptText ' + JSON.stringify(r), real.receiptText(r), a.receiptText(r))
        }
  console.log(`配速/收据 ${label}: ${cases} 项比对, ${bad} 处不一致${first.length ? ' 例: ' + first.join('; ').slice(0, 300) : ''}`)
  return bad
}

const bad = compareCrab(mineCrab, '移植版 vs 源码') + comparePace(mineHud, '移植版 vs 源码')

// ---------------- 负路径 ----------------
const MUTANTS = [
  ['纸的位置下移一格', 'crab', 'rect(p, 12, 1, 3, 4, COL.paper)', 'rect(p, 12, 2, 3, 4, COL.paper)'],
  ['小螃蟹换一种形状', 'crab', "['C.C', 'CEC', 'L.L'],", "['CCC', 'CEC', 'L.L'],"],
  ['墨镜鼻梁挪一格', 'crab', 'rect(p, 5, y, 2, 1, COL.bridge)', 'rect(p, 6, y, 2, 1, COL.bridge)'],
  ['配速报警阈值改成 1.2', 'hud', 'const PACE_WARN = 1.15', 'const PACE_WARN = 1.2'],
  ['收据去掉 +/- 行数', 'hud', "(r.add || r.del ? ' +' + r.add + ' -' + r.del : '')", "''"],
]
let undetected = 0
for (const [name, which, from, to] of MUTANTS) {
  const code = which === 'crab' ? crabPort : hudPort
  if (!code.includes(from)) throw new Error('负路径没改到东西: ' + name)
  const broken = code.replace(from, to)
  const n =
    which === 'crab'
      ? compareCrab(await import(toUrl(broken)), '负路径「' + name + '」')
      : comparePace(await import(toUrl(fixImports(broken, crabPort))), '负路径「' + name + '」')
  if (n === 0) {
    console.error('  这个改坏的版本没被发现: ' + name)
    undetected++
  }
}
if (bad !== 0) {
  console.error('失败: 移植版和源码不一致')
  process.exit(1)
}
if (undetected) {
  console.error('失败: 有改坏的版本没被发现, 校验无效')
  process.exit(1)
}
console.log('通过: 移植版与源码逐帧/逐项一致; ' + MUTANTS.length + ' 个负路径都报出了不一致')
