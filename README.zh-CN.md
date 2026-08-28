# Koma

[English](README.md)

Koma 是一个可自行部署的 AI 视频理解应用，把本地视频或公开视频链接整理成可回看、可定位的结果，包括总结、章节、字幕、关键帧、结构化数据和可下载文本文件。

## 核心能力

- 上传本地视频，或粘贴抖音、B 站链接；安装 `yt-dlp` 后可支持 YouTube 等更多站点。
- 结合声音与关键帧，生成总结、章节、标签、字幕和画面描述。
- 点击章节、标签、字幕或关键帧，跳到视频对应位置。
- 直接描述需要哪些字段，在分析前审阅可编辑 JSON，保存在浏览器中复用，并按需生成 JSON、CSV、Markdown、SRT 或 TXT。
- 在同一浏览器重新打开或删除自己提交的任务；配置 `ADMIN_PASSWORD` 后，管理员可在 `/admin` 管理 Provider、加密的 API Key 和全部任务。

## 快速开始

需要 Node.js 22.13+；FFmpeg 和 ffprobe 已内置。

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。

不配置 Provider Key 时，Koma 会返回演示数据，不会真实转写或理解视频。真实字幕需要配置 ASR Provider；真实总结、章节、画面描述、自定义 JSON 和生成文件需要配置视觉 Provider。详见[配置说明](docs/CONFIGURATION.zh-CN.md)。

## 隐私与限制

- Koma 会把音频发送给已配置的听写服务，并把关键帧与字幕上下文发送给已配置的视觉模型。
- 原视频、关键帧、结果和生成文件会一直保存，直到提交任务的浏览器或管理员删除；拿到不可猜回看链接的人都可以查看结果。清除站点数据或更换浏览器后，将失去原浏览器“我的任务”里的管理入口。
- 默认最多上传 500 MB、15 分钟的视频。目前不支持需要登录或会员权限的视频；其他站点的支持情况取决于已安装的 `yt-dlp` 版本和目标站点的反爬策略。
- 未配置 `ADMIN_PASSWORD` 时，`/admin` 不可用，AI JSON 生成以及文件/地址提交接口保持公开。URL 导入并不是完整的 SSRF 防线；向不可信用户开放提交前，应配置出站网络策略或可信 URL 白名单。完整边界见[管理平台](docs/ADMIN.zh-CN.md)。

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
