// usage-hud: 统计一个会话已经用掉的 token (含子代理)
// 用法: node count-tokens.js <猜测的会话记录.jsonl> [会话id] [projects 根目录]
//   会话记录按"启动时的目录"存放; 工作目录中途 cd 过的话猜测会落空, 这时按会话 id 在各项目目录里找
// 读主记录 + 同名文件夹下 subagents\*.jsonl; 同一次回复会写成多行, 按 message.id 去重
// 输出一行 JSON: {"found":true,"input":..,"output":..,"cacheRead":..,"cacheWrite":..,"responses":..,"path":..}
const fs = require('fs')
const path = require('path')
const readline = require('readline')

let main = process.argv[2] || ''
const id = process.argv[3] || ''
const root = process.argv[4] || ''
if ((!main || !fs.existsSync(main)) && id && root) {
  try {
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, id + '.jsonl')
      if (fs.existsSync(p)) {
        main = p
        break
      }
    }
  } catch {}
}
const files = []
if (main && fs.existsSync(main)) files.push(main)
const subDir = path.join(main.replace(/\.jsonl$/i, ''), 'subagents')
try {
  for (const f of fs.readdirSync(subDir)) if (f.endsWith('.jsonl')) files.push(path.join(subDir, f))
} catch {}

const byId = new Map()
async function readFile(f) {
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.indexOf('usage') < 0) continue
    let j
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    const m = j && j.message
    if (!m || !m.usage) continue
    const key = (m.id || '') + '|' + (j.requestId || '') + '|' + (m.id ? '' : f + ':' + byId.size)
    byId.set(key, m.usage) // 同一回复的后一行覆盖前一行 (输出数以最后一行为准)
  }
}

;(async () => {
  for (const f of files) await readFile(f)
  const t = { found: files.length > 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, responses: byId.size, files: files.length, path: main }
  for (const u of byId.values()) {
    t.input += u.input_tokens || 0
    t.output += u.output_tokens || 0
    t.cacheRead += u.cache_read_input_tokens || 0
    t.cacheWrite += u.cache_creation_input_tokens || 0
  }
  process.stdout.write(JSON.stringify(t))
})()
