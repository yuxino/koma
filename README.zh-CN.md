<div align="center">
  <img src="public/koma-companion-girl.png" width="112" alt="Koma 图标">
  <h1>Koma</h1>
  <p>把视频变成可以使用的数据。</p>
  <p><a href="README.md">English</a></p>
</div>

Koma 是一个可自行部署的 AI 视频理解应用，把本地视频或公开视频链接整理成可回看、可定位的结果，包括总结、章节、字幕、关键帧、结构化数据和可下载文本文件。

## 功能

- 上传本地视频，或粘贴抖音、B 站链接；安装 `yt-dlp` 后可支持 YouTube 等更多站点。
- 结合声音与关键帧，生成总结、章节、标签、字幕和画面描述。
- 点击章节、标签、字幕或关键帧，跳到视频对应位置；搜索字幕，下载 Markdown 笔记或 SRT 字幕。
- 可从课程笔记、访谈/会议、产品整理开始；直接描述需要哪些字段，在分析前审阅可编辑 JSON，保存在浏览器中复用，并按需生成 JSON、CSV、Markdown、SRT 或 TXT。
- 用 GitHub 登录个人视频工作区，换浏览器也能找回记录；搜索、筛选最近的任务，回看结果，重试可恢复的失败任务，或删除不再需要的内容。
- 配置 `ADMIN_PASSWORD` 后，管理员可在独立的 `/admin` 后台管理 Provider、加密的 API Key 和全部任务；GitHub 登录不会赋予管理员权限。

## 快速开始

需要 Node.js 22.13+；FFmpeg 和 ffprobe 已内置。

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。网页分析需要先用 GitHub 登录，请按[配置说明](docs/CONFIGURATION.zh-CN.md#github-登录)设置服务端的 GitHub App 凭据和回调地址。本地 CLI 无需 GitHub 账号。

不配置 Provider Key 时，Koma 会返回演示数据，不会真实转写或理解视频。真实字幕需要配置 ASR Provider；真实总结、章节、画面描述、自定义 JSON 和生成文件需要配置视觉 Provider。详见[配置说明](docs/CONFIGURATION.zh-CN.md)。

## 数据与隐私

Koma 会把音频发送给已配置的听写服务，并把关键帧与字幕上下文发送给已配置的视觉模型。原视频、关键帧、结果和生成文件会一直保存，直到所有者或管理员删除。新账号任务是私有的：回看链接、视频、关键帧和下载文件都需要所有者或管理员身份。更换浏览器后，用同一个 GitHub 账号登录即可找回记录；自定义分析草稿和已保存的默认配置仍保存在当前浏览器，并按账号区分。

尚未认领的旧回看链接保留原来的只读访问方式。在当初提交任务的浏览器中，可以明确选择把这些记录转入自己的账号；转入后会限制后续回看和存储对象访问，但不能收回此前下载或缓存的公开内容。无法证明浏览器归属的记录不会自动分配给任何人。详见[旧任务与迁移](docs/ADMIN.zh-CN.md#旧任务与迁移)。

默认最多上传 500 MB、15 分钟的视频；目前不支持需要登录或会员权限的视频，其他站点的支持情况取决于 `yt-dlp` 版本和目标站点的反爬策略。`ADMIN_PASSWORD` 保护 `/admin`，`ANALYSIS_REQUIRE_ADMIN=true` 可在 GitHub 登录之外再要求管理员身份。URL 导入并不是完整的 SSRF 防线，向不可信用户开放提交前应配置出站网络策略或可信 URL 白名单。

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
