<div align="center">
  <img src="docs/images/koma-readme-icon.png" width="112" alt="Koma icon">
  <h1>Koma</h1>
  <p>Turn video into useful data.</p>
  <p><a href="README.zh-CN.md">简体中文</a></p>
</div>

Koma turns a video into a replayable result with summaries, chapters, subtitles, key frames, structured data, and downloadable files.

## Features

- Upload a local video or paste a Douyin/Bilibili link. Install `yt-dlp` for YouTube and more sites.
- Combine audio and key frames into summaries, chapters, tags, subtitles, and scene captions.
- Jump from any chapter, tag, subtitle, or frame to the matching moment.
- Describe the data you need, let AI shape editable JSON, and reuse the saved browser configuration. API/CLI clients can still export JSON, CSV, Markdown, SRT, or TXT.
- Save replayable jobs, manage your own history, and configure providers from `/admin`.

## Quick start

Requires Node.js 22.13+. FFmpeg and ffprobe are bundled.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Without API keys, Koma runs in mock mode. AI-built JSON shapes, custom extraction, and generated files require a real vision provider. See [Configuration](docs/CONFIGURATION.md).

## Data and privacy

Koma sends audio to the configured speech provider and key frames plus transcript context to the configured vision provider. Videos, frames, results, and generated files remain stored for replay until the submitting browser or an administrator deletes the job. Anyone with the unguessable replay link can view it; clearing site data or switching browsers removes access to that browser's “My jobs” controls. See [Administration](docs/ADMIN.md) for the full data boundary.

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
