<div align="center">
  <img src="public/koma-ponytail-portrait.webp" width="112" alt="Koma icon">
  <h1>Koma</h1>
  <p>Turn video into useful data.</p>
  <p><a href="README.zh-CN.md">简体中文</a></p>
</div>

Koma is a self-hosted AI video understanding app that turns local files and public video links into replayable results with summaries, chapters, subtitles, key frames, custom structured data, and downloadable text files.

## Features

- Upload a local video or paste a Douyin/Bilibili link. Install `yt-dlp` for YouTube and more sites.
- Combine speech and key frames into summaries, chapters, tags, subtitles, and frame descriptions.
- Jump from a chapter, tag, subtitle, or frame to the matching moment. Search the transcript and export the result as Markdown or subtitles as SRT.
- Start with study, interview/meeting, or product notes. Describe the fields you need, review the editable JSON structure before analysis, save it in the browser, and request JSON, CSV, Markdown, SRT, or TXT output.
- Sign in with GitHub to keep a private video workspace across browsers. Search and filter your recent jobs, reopen results, retry recoverable failures, or delete a job.
- With `ADMIN_PASSWORD` configured, `/admin` separately manages providers, encrypted API keys, and all jobs. GitHub sign-in does not grant administrator access.

## Quick start

Requires Node.js 22.13+. FFmpeg and ffprobe are bundled.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Web analysis requires GitHub sign-in: configure the server-side GitHub App credentials and callback described in [Configuration](docs/CONFIGURATION.md#github-sign-in). The local CLI does not require a GitHub account.

Without provider keys, Koma uses mock output instead of real transcription or vision analysis. Configure an ASR provider for real subtitles and a vision provider for real summaries, chapters, frame descriptions, custom JSON, and generated files. See [Configuration](docs/CONFIGURATION.md).

## Data and privacy

Koma sends audio to the configured speech provider and key frames plus transcript context to the configured vision provider. Videos, frames, results, and generated files remain stored until their owner or an administrator deletes the job. New account-owned jobs are private: their replay link, video, frames, and downloads require the owner or an administrator. Signing back in with the same GitHub account restores access across browsers. Custom analysis drafts and saved defaults remain local to that browser and are separated by account.

Older unclaimed replay links keep their previous read-only access. From the browser that submitted those jobs, you can explicitly move them into your account; this restricts future replay and stored-object access. Earlier downloads or cached public copies cannot be recalled. Jobs without proof of browser ownership are never automatically assigned. See [Administration](docs/ADMIN.md#existing-jobs-and-migration).

Uploads default to 500 MB and 15 minutes; login-only and subscription-only videos are unsupported, and fallback site availability depends on `yt-dlp` and each site's anti-bot behavior. `ADMIN_PASSWORD` protects `/admin`; `ANALYSIS_REQUIRE_ADMIN=true` requires an administrator session in addition to GitHub sign-in. The URL importer is not a complete SSRF boundary, so use an egress policy or trusted URL allowlist before exposing submission to untrusted users.

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
