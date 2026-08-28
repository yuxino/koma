# Koma

[简体中文](README.zh-CN.md)

Koma is a self-hosted AI video understanding app that turns local files and public video links into replayable results with summaries, chapters, subtitles, key frames, custom structured data, and downloadable text files.

## Core capabilities

- Upload a local video or paste a Douyin/Bilibili link. Install `yt-dlp` for YouTube and more sites.
- Combine speech and key frames into summaries, chapters, tags, subtitles, and frame descriptions.
- Jump from a chapter, tag, subtitle, or frame to the matching moment.
- Describe the fields you need, review the editable JSON structure before analysis, save it in the browser, and request JSON, CSV, Markdown, SRT, or TXT output.
- Reopen or delete jobs submitted from the same browser. With `ADMIN_PASSWORD` configured, `/admin` manages providers, encrypted API keys, and all jobs.

## Quick start

Requires Node.js 22.13+. FFmpeg and ffprobe are bundled.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Without provider keys, Koma uses mock output instead of real transcription or vision analysis. Configure an ASR provider for real subtitles and a vision provider for real summaries, chapters, frame descriptions, custom JSON, and generated files. See [Configuration](docs/CONFIGURATION.md).

## Privacy and limits

- Koma sends audio to the configured speech provider, and key frames plus transcript context to the configured vision provider.
- Videos, frames, results, and generated files remain stored until the submitting browser or an administrator deletes the job. Anyone with the unguessable replay link can view it; clearing site data or switching browsers removes access to that browser's “My jobs” controls.
- Uploads default to 500 MB and 15 minutes. Login-only and subscription-only videos are not supported; fallback site support depends on the installed `yt-dlp` version and each site's anti-bot behavior.
- Without `ADMIN_PASSWORD`, `/admin` is disabled while AI JSON generation and upload/URL submission remain public. The URL importer is not a complete SSRF boundary; use an egress policy or trusted URL allowlist before exposing submission to untrusted users. See [Administration](docs/ADMIN.md).

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
