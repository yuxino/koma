<div align="center">
  <img src="public/koma-readme-icon.png" width="112" alt="Koma icon">
  <h1>Koma</h1>
  <p>Turn video into useful data.</p>
  <p><a href="README.zh-CN.md">简体中文</a></p>
</div>

Koma turns a video into a replayable result with summaries, chapters, subtitles, key frames, structured data, and downloadable files.

## Features

- Upload a local video or paste a Douyin/Bilibili link. Install `yt-dlp` for YouTube and more sites.
- Combine audio and key frames into summaries, chapters, tags, subtitles, and scene captions.
- Jump from any chapter, tag, subtitle, or frame to the matching moment.
- Extract custom JSON and export JSON, CSV, Markdown, SRT, or TXT.
- Save replayable jobs, manage your own history, and configure providers from `/admin`.

## Quick start

Requires Node.js 22.13+. FFmpeg and ffprobe are bundled.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Without API keys, Koma runs in mock mode. Custom extraction and generated files require a real vision provider. See [Configuration](docs/CONFIGURATION.md).

## CLI

```bash
npm run build
node dist-server/cli.js demo.mp4 --lang en --json result.json
node dist-server/cli.js --help
```

## Docs

- [Configuration](docs/CONFIGURATION.md)
- [Administration](docs/ADMIN.md)
- [HTTP API](docs/API.md)
- [Deployment](DEPLOY.md)

<sub>Unofficial, non-commercial fan project. Not affiliated with or endorsed by CAPCOM.</sub>
