# 演示动图生成脚本

`assets/` 里的四张 GIF（`usage-hud.gif`、`html-shelf.gif`、`quickstart.gif`、`client.gif`）都由这里的脚本生成。每张图是 `scenes/` 里的一个 HTML 页面，页面提供 `renderFrame(t)`，按时间直接算出画面。`render.mjs` 用无头 Chrome（DevTools 协议）按 2 倍像素逐帧截图，再用 ffmpeg（`palettegen` / `paletteuse`）缩回 1 倍合成 GIF。螃蟹和面板网格是从 `usage-hud/hooks/register.tsx` 移植的（`lib/crab.js`、`lib/hud.js`），客户端版直接调用 `usage-hud/hooks/desktop.ts` 的 `crabSvg` / `dashSvg`。

```bash
node tools/demo/render.mjs                 # 全部重新生成 (约 5 分钟)
node tools/demo/render.mjs html-shelf      # 只做一张
node tools/demo/render.mjs --gif-only      # 用已有的帧重新合成
node tools/demo/check-crab.mjs             # 校验移植的螃蟹和源码逐帧一致
node tools/demo/check-strings.mjs          # 校验脚本里没有本机路径和内部名字
```

`scenes/_smoke.html` 是管线冒烟场景（`node tools/demo/render.mjs _smoke`），名字以 `_` 开头的场景输出只留在 `out/`，不进 `assets/`。需要 Node 23 以上、Chrome 或 Edge、ffmpeg。找不到时设置环境变量 `CHROME_PATH` / `FFMPEG_PATH`。中间帧、抽查帧（`out/check/`）和尺寸清单（`out/manifest.json`）都在 `out/` 里，不进仓库。字体用系统里的 Cascadia Mono 和 Microsoft YaHei。
