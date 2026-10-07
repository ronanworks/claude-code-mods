// Claude Code 终端界面 (深色主题) 的示意画法: 会话记录、输入框、提示行、转圈提示
// 这些是引擎自己的界面, 不是 mod 的; 按常见样子近似, 颜色用主题色
export const C = {
  text: '#ffffff',
  inactive: 'rgb(153,153,153)',
  claude: 'rgb(215,119,87)',
  success: 'rgb(78,186,101)',
  link: 'rgb(177,185,249)',
  userBg: 'rgb(55,55,55)',
  border: 'rgb(136,136,136)',
  termBg: '#0c0c0c',
}

// 会话记录; 每条前空一行。返回下一行
//   { kind:'user', text }  { kind:'text', text, first }  { kind:'tool', name, args, state:'run'|'ok', result:[行], blink }
//   工具行: 运行中圆点灰色闪烁, 成功后变绿; 结果行以 ⎿ 开头 (引擎界面, 近似)
export function transcript(g, row, items, opts = {}) {
  const cols = g.cols
  for (const it of items) {
    row += 1
    it.row = row // 这一条从哪一行开始 (给悬停范围用)
    if (it.kind === 'user') {
      g.bg(row, 0, cols, C.userBg)
      g.runs(row, 0, [
        ['> ', { fg: C.inactive, bg: C.userBg }],
        [it.text, { fg: C.text, bg: C.userBg }],
      ])
      row += 1
    } else if (it.kind === 'text') {
      const lines = Array.isArray(it.text) ? it.text : [it.text]
      lines.forEach((line, i) => {
        if (Array.isArray(line)) g.runs(row, 2, line)
        else g.text(row, 2, line, { fg: C.text })
        if (i === 0 && it.first !== false) g.text(row, 0, '●', { fg: C.text })
        row += 1
      })
    } else if (it.kind === 'tool') {
      const dot = it.state === 'ok' ? C.success : it.blink ? '#3a3a3a' : C.inactive
      g.text(row, 0, '●', { fg: dot })
      let c = g.text(row, 2, it.name, { fg: C.text, bold: true })
      c = g.text(row, c, '(' + it.args + ')', { fg: C.text })
      if (it.after) g.runs(row, c + (it.afterGap ?? 2), it.after) // 工具行后面追加的东西 (html-shelf 的 "打开")
      it.afterCol = c + (it.afterGap ?? 2)
      row += 1
      for (const r of it.result ?? []) {
        g.text(row, 2, '⎿', { fg: C.inactive })
        g.text(row, 5, r, { fg: C.inactive })
        row += 1
      }
    } else if (it.kind === 'turn') {
      // 每轮结束那行 (引擎的 TurnDuration: ✻ Baked for 9s), 后面可以接 usage-hud 的收据 (dimColor)
      const c = g.text(row, 0, '✻ ' + it.text, { fg: C.inactive })
      if (it.receipt) g.text(row, c, it.receipt, { fg: '#868686' })
      row += 1
    }
    it.endRow = row - 1
  }
  return row
}

// 圆角输入框 (占 3 行): 返回框内文字起点列
export function inputBox(g, row, text, cursorOn) {
  const cols = g.cols
  g.text(row, 0, '╭' + '─'.repeat(cols - 2) + '╮', { fg: C.border })
  g.text(row + 1, 0, '│', { fg: C.border })
  g.text(row + 1, cols - 1, '│', { fg: C.border })
  g.text(row + 2, 0, '╰' + '─'.repeat(cols - 2) + '╯', { fg: C.border })
  g.text(row + 1, 2, '>', { fg: C.text })
  const c = g.text(row + 1, 4, text, { fg: C.text })
  if (cursorOn) {
    g.bg(row + 1, c, c + 1, C.text)
  }
  return c
}

// 引擎自己的提示行 (? for shortcuts)
export function hint(g, row, text = '? for shortcuts') {
  g.text(row, 2, text, { fg: C.inactive })
}

// 工作中的转圈提示: ✻ Thinking… (3s · esc to interrupt)
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
export function spinner(g, row, t, secs, verb = 'Thinking') {
  const glyph = SPIN[Math.floor(t / 0.12) % SPIN.length]
  g.text(row, 0, glyph, { fg: C.claude })
  const c = g.text(row, 2, verb + '…', { fg: C.claude })
  g.text(row, c + 1, '(' + secs + 's · esc to interrupt)', { fg: C.inactive })
}

