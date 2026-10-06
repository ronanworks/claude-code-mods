<div align="center">

# claude-code-mods

**给 Claude Code 终端补上「客户端才有」的顺手功能**

会动的像素螃蟹用量面板 · 单击就开的 HTML 链接 · 带底色的代码卡片一键复制

[![License: MIT](https://img.shields.io/badge/License-MIT-d97757.svg)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.287%2B-d97757)
![Platform](https://img.shields.io/badge/tested%20on-Windows-0078d4)
![mods](https://img.shields.io/badge/Claude%20Code-mods-8a63d2)

<img src="assets/usage-hud.gif" alt="usage-hud：输入框下方的像素螃蟹用量面板" width="900">

</div>

## 这是什么

Claude Code 的 [mods](https://code.claude.com/docs/zh-CN/plugins/mods/overview) 是一种「函数钩子插件」：一个文件夹加几十行 TypeScript，就能改 Claude Code 自己画的界面。这个仓库有两个 mod，互不依赖，可以只装一个：

| mod | 做什么 |
|---|---|
| **usage-hud** | 输入框下方的用量面板。像素小螃蟹按 Claude 正在用的工具做动作；模型和思考档位、项目和分支、会话时长和花费、上下文 / 5 小时 / 本周用量、token 数，一眼看全 |
| **html-shelf** | 终端里 Claude 回复中的 `.html` 路径单击就用浏览器打开；代码块画成带底色的卡片，一键复制 |

## 快速开始

<img src="assets/quickstart.gif" alt="三步上手：克隆、写进 settings.json、启动 claude" width="900">

**1. 添加插件市场**（在你的终端里运行）

```bash
claude plugin marketplace add ronanworks/claude-code-mods
```

**2. 安装两个 mod**（只要一个就只装一个）

```bash
claude plugin install usage-hud@claude-code-mods
```

```bash
claude plugin install html-shelf@claude-code-mods
```

**3. 重新打开 claude**

运行 `/plugin`，标签下面那行灰字会写 `2 mods active` 和两个 mod 的名字。之后每个新会话（终端和桌面客户端）都会自动加载。

> 点击和悬停需要 Claude Code 的全屏渲染。没开的话，在 Claude Code 里运行 `/tui fullscreen`。

<details>
<summary>想改代码？用本地文件夹加载</summary>

克隆仓库后，把两个文件夹的绝对路径写进 `~/.claude/settings.json` 的 `env`。Windows 用 `;` 分隔，macOS / Linux 用 `:`。这样加载的 mod 在终端会话里一保存就重载。

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\claude-code-mods\\usage-hud;C:\\path\\to\\claude-code-mods\\html-shelf"
  }
}
```

只想试一次、不改设置：

```bash
claude --plugin-dir ./claude-code-mods/usage-hud --plugin-dir ./claude-code-mods/html-shelf
```

</details>

**更新**：在 Claude Code 里运行 `/plugin marketplace update claude-code-mods`。也可以在 `/plugin` → Marketplaces 里给这个市场打开自动更新。

**装之前想先看它做什么**：mod 以你的权限运行。克隆仓库后运行 `claude plugin validate ./usage-hud`，输出的 `hooks:` 和 `calls:` 两行列出它挂了哪些事件、调用了什么。

## usage-hud：会动的用量面板

面板是螃蟹加一个 3 行 × 3 列的网格，每列标签上下对齐：

| | 第 1 列 | 第 2 列 | 第 3 列 |
|---|---|---|---|
| 第 1 行 | 模型 + 思考档位 | 项目 + git 分支 | 本会话时长 + 花费 |
| 第 2 行 | 上下文用量 | 5 小时用量 | 本周用量 |
| 第 3 行 | 状态 | 用得最多的工具 | token 总数 + 输出（out） |

螃蟹会跟着 Claude 干活：

| Claude 在做 | 螃蟹在做 |
|---|---|
| 思考 | 眼睛往右看，冒出思考点点 |
| 读文件、搜索 | 看一页纸，扫描线上下移动 |
| 写文件、改文件 | 右钳敲击，纸上慢慢写满字 |
| 跑命令 | 双钳交替敲键盘，终端光标闪烁 |
| 上网 | 旋转的小地球 |
| 子代理在跑 | 身边跳动的小螃蟹 |
| 一轮结束 | 举钳跳跃，金色闪光 |
| 闲置 / 5 分钟没动 | 眨眼、左右张望 / 闭眼呼吸冒泡泡 |
| 上下文 ≥ 80% | 变红冒汗；≥ 95% 红色闪烁报警 |

面板上可以点：模型名 → `/model`，项目名 → 打开项目文件夹，上下文 → `/context`，5 小时 / 本周 → `/usage`，token → 明细。

| 命令 | 作用 |
|---|---|
| `/hud` | 完整 → 精简（一行）→ 隐藏，循环切换 |
| `/hud top`、`/hud bottom` | 面板放到输入框上方 / 下方（默认下方） |

在桌面客户端里，面板换成一张专用的 SVG 卡片（螃蟹 + 仪表盘），放在输入框上方，无边框，跟随浅色 / 深色主题：

<img src="assets/client.gif" alt="usage-hud 客户端版：桌面客户端输入框上方的 SVG 面板" width="900">

- 「花费」是按 API 标价折算的等价金额，和 `/cost` 同一口径。订阅用户不会真的被扣这笔钱。
- token 数来自会话记录（含子代理），读缓存也算在内，所以数字通常很大。

## html-shelf：可点的链接和代码卡片

<img src="assets/html-shelf.gif" alt="html-shelf：代码卡片一键复制、单击 HTML 链接用浏览器打开" width="900">

- 回复里出现的 `.html` 路径（裸路径、`` `代码` ``、`[文字](路径)` 都行）变成链接，单击用默认浏览器打开。文件真实存在才会变成链接。
- `/open` 打开最近一次提到或写出的 HTML，`/open 3` 打开倒数第 3 个。
- 每个代码块画成一张卡片：标题栏左边是语言名，右边是「复制」。鼠标移上去标题栏变亮、「复制」变橙色；单击复制，显示「已复制 ✓」。复制的是原文，末尾不带换行，粘进终端不会直接执行。
- 卡片颜色取自 Claude Code 当前主题，深色和浅色主题都合适。
- 代码卡片只在终端里画。桌面客户端本来就有复制按钮，不动。

## 环境要求

| 项目 | 说明 |
|---|---|
| Claude Code | 终端版 2.1.287 及以上，桌面客户端 2.1.286 及以上（官方对 mods 的要求）。在 2.1.289 上测试 |
| 系统 | 在 Windows 11 + Windows Terminal 上测试。macOS / Linux 没测过：打开文件和文件夹用的是 Windows 命令，这两项在别的系统上会失败；面板、复制不受影响 |
| 渲染 | 点击、悬停需要全屏渲染（`/tui fullscreen`） |
| 依赖 | Node.js（usage-hud 用一个小脚本统计 token）、git（显示分支） |

## 卸载

移除插件市场，会连同装过的 mod 一起卸载：

```bash
claude plugin marketplace remove claude-code-mods
```

用本地文件夹加载的，从 `CLAUDE_CODE_PLUGIN_DIRS` 里删掉对应路径，重新打开 claude 即可。

## 开发

检查和测试一个 mod：

```bash
claude plugin validate ./usage-hud
```

```bash
claude plugin test ./usage-hud
```

- 终端会话会监视 mod 文件夹，保存即重载。桌面客户端会话不会，要运行 `/reload-plugins`。
- 改完把 `plugin.json` 的 `version` 升一级：usage-hud 在客户端里发现版本变了，会自己重载一次。
- 终端里只用 ASCII、中文、`│ ─ ━ ✓` 和方块字符。`• ⏱ ↻ ✦` 这类字符在有些终端里宽度不定，会和旁边的字重叠。
- `node tools/preview-client.mjs`：不开客户端，直接生成客户端面板的预览页 `tools/out/client.html`。
- `tools/demo/`：README 里这些动图的生成脚本。

```
usage-hud/
  hooks/register.tsx        终端面板和各种事件
  hooks/desktop.ts          客户端面板（SVG）
  scripts/count-tokens.js   统计一个会话用掉的 token（含子代理）
html-shelf/
  hooks/register.tsx        链接、代码卡片、/open
tools/                      预览和动图脚本
assets/                     README 用的动图
```

## 许可证

[MIT](LICENSE) © 2026 Ronan

---

### English

Two [mods](https://code.claude.com/docs/en/plugins/mods/overview) for the Claude Code terminal UI:

- **usage-hud**: an animated pixel-crab usage panel under the prompt. It shows model and effort, project and branch, session time and cost, context / 5-hour / weekly usage, and tokens. The crab acts out the tool Claude is using.
- **html-shelf**: `.html` paths in replies become clickable and open in your browser. Code blocks are drawn as theme-aware cards with a one-click copy button.

**Quick start** (Claude Code 2.1.287+):

```bash
claude plugin marketplace add ronanworks/claude-code-mods
```

```bash
claude plugin install usage-hud@claude-code-mods
```

```bash
claude plugin install html-shelf@claude-code-mods
```

Restart `claude`. Clicking and hovering need fullscreen rendering (`/tui fullscreen`). The UI text is Chinese. Tested on Windows 11 with Claude Code 2.1.289; opening files and folders uses Windows commands, so those two actions don't work on macOS / Linux yet.
