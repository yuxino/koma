<div align="center">
  <img src="public/koma-readme-icon.png" width="112" alt="Koma 图标">
  <h1>Koma</h1>
  <p>把视频变成可以使用的数据。</p>
  <p><a href="README.md">English</a></p>
</div>

Koma 把视频整理成可回看、可定位、可下载的结果，包括总结、章节、字幕、关键帧、结构化数据和文件。

## 功能

- 上传本地视频，或粘贴抖音、B 站链接；安装 `yt-dlp` 后可支持 YouTube 等更多站点。
- 结合声音与关键帧，生成总结、章节、标签、字幕和画面描述。
- 点击章节、标签、字幕或关键帧，直接跳到视频对应位置。
- 直接描述想要的数据，让 AI 整理成可编辑 JSON，并复用浏览器保存的配置；API/CLI 仍可导出 JSON、CSV、Markdown、SRT 或 TXT。
- 永久保存任务和回看链接；当前浏览器管理自己的任务，管理员从 `/admin` 管理全局配置。

## 快速开始

需要 Node.js 22.13+；FFmpeg 和 ffprobe 已内置。

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。

不配置 API Key 时，Koma 使用 mock 模式运行。AI 整理 JSON、自定义提取和文件生成需要真实视觉模型，详见[配置说明](docs/CONFIGURATION.zh-CN.md)。

## CLI

```bash
npm run build
node dist-server/cli.js demo.mp4 --lang zh --json result.json
node dist-server/cli.js --help
```

## 文档

- [配置](docs/CONFIGURATION.zh-CN.md)
- [管理平台](docs/ADMIN.zh-CN.md)
- [HTTP API](docs/API.zh-CN.md)
- [部署](DEPLOY.md)

<sub>非官方、非商用同人项目，与 CAPCOM 无关联，也未获得其背书。</sub>
