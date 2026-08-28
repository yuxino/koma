# Configuration

Copy `.env.example` to `.env`. Without model credentials, Koma still runs the complete pipeline with mock data.

AI work is split into two independently configurable stages:

- `ASR_PROVIDER` turns audio into timestamped subtitles.
- `VISION_PROVIDER` combines key frames and subtitles into a title, summary, chapters, and tags.
- For a custom request, `VISION_PROVIDER` also produces `extractedData` in the requested JSON shape.

The two providers can be mixed; Koma is not tied to Qwen.

Mock mode demonstrates summaries, chapters, and the timeline without inventing business data. Custom extraction therefore requires a real vision provider.

AI JSON-shape generation normally uses one vision-provider request. If that response is malformed or fails shape/path validation, Koma makes one stricter repair request before returning an invalid-output error.

## Provider presets

| Stage | Provider | Default model | Key |
| --- | --- | --- | --- |
| ASR | `dashscope` | `fun-asr-flash-2026-06-15` | `DASHSCOPE_API_KEY` |
| ASR | `groq` | `whisper-large-v3-turbo` | `GROQ_API_KEY` |
| ASR | `openai` | `whisper-1` | `OPENAI_API_KEY` |
| ASR | `openai-compatible` | custom | `ASR_API_KEY` |
| Vision | `dashscope` | `qwen3-vl-flash` | `DASHSCOPE_API_KEY` |
| Vision | `openai` | `gpt-4.1-mini` | `OPENAI_API_KEY` |
| Vision | `gemini` | `gemini-2.5-flash` | `GEMINI_API_KEY` |
| Vision | `openrouter` | `openrouter/free` | `OPENROUTER_API_KEY` |
| Vision | `groq` | `meta-llama/llama-4-scout-17b-16e-instruct` | `GROQ_API_KEY` |
| Vision | `openai-compatible` | custom | `VISION_API_KEY` |

Override any preset with `ASR_MODEL`, `VISION_MODEL`, `ASR_BASE_URL`, or `VISION_BASE_URL`. A provider model rename does not require a code change.

## Free-tier public demo

The repository includes `.env.demo.example`:

```bash
cp .env.demo.example .env
```

Add two server-side keys:

```dotenv
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

This combination uses:

- [Groq Speech to Text](https://console.groq.com/docs/speech-to-text) for multilingual Whisper transcription with segment timestamps. Koma's audio chunks stay below Groq's 25 MB free-tier per-file limit.
- [OpenRouter Free Models Router](https://openrouter.ai/openrouter/free), which selects a currently available free model capable of image input.

Free services still require account keys; there is no dependable anonymous, unlimited AI endpoint. Keys stay on the Koma server and never reach the browser. Because account-level quotas are limited, the demo template defaults to three-minute videos, three submissions per IP per UTC day, and one concurrent job. Results are persistent, so administrators should review storage usage and delete unwanted demos from `/admin`.

Set `ADMIN_PASSWORD` for a private single-user deployment. Leaving it empty keeps AI JSON generation and both analysis submission endpoints public; the daily limiter reduces request volume but is not authentication or an SSRF boundary.

The built-in rate limiter is intended for a single-node demo. Multi-instance deployments should rate-limit at the gateway or in shared storage. Before setting `TRUST_PROXY=true` behind nginx, make sure the proxy overwrites client-supplied `X-Forwarded-For`.

## Common combinations

### DashScope for both stages

```dotenv
ASR_PROVIDER=dashscope
VISION_PROVIDER=dashscope
DASHSCOPE_API_KEY=...
```

### Groq transcription + OpenRouter free vision

```dotenv
ASR_PROVIDER=groq
GROQ_API_KEY=...
VISION_PROVIDER=openrouter
OPENROUTER_API_KEY=...
```

### Gemini vision + Groq transcription

```dotenv
ASR_PROVIDER=groq
GROQ_API_KEY=...
VISION_PROVIDER=gemini
GEMINI_API_KEY=...
```

### Any OpenAI-compatible service

```dotenv
ASR_PROVIDER=openai-compatible
ASR_API_KEY=...
ASR_BASE_URL=https://example.com/v1
ASR_MODEL=whisper-model

VISION_PROVIDER=openai-compatible
VISION_API_KEY=...
VISION_BASE_URL=https://example.com/v1
VISION_MODEL=vision-model
```

Vision services must support `POST /chat/completions` and `image_url`. Transcription services must support `POST /audio/transcriptions`, multipart uploads, and `verbose_json` segment timestamps.

## Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `ASR_PROVIDER` | `mock` without a key | `mock`, `dashscope`, `groq`, `openai`, or `openai-compatible` |
| `ASR_API_KEY` | provider key | Custom/override transcription key |
| `ASR_BASE_URL` | provider preset | Custom/override transcription API URL |
| `ASR_MODEL` | provider preset | Transcription model |
| `VISION_PROVIDER` | `mock` without a key | `mock`, `dashscope`, `openai`, `gemini`, `openrouter`, `groq`, or `openai-compatible` |
| `VISION_API_KEY` | provider key | Custom/override vision key |
| `VISION_BASE_URL` | provider preset | Custom/override vision API URL |
| `VISION_MODEL` | provider preset | Vision-language model |
| `AI_TIMEOUT_MS` | `120000` | AI request timeout |
| `PUBLIC_BASE_URL` | empty | Public service URL; only needed by DashScope diarization |
| `ASR_DIARIZATION` | off / automatic | `on` or `off`; currently DashScope-only |
| `MAX_UPLOAD_BYTES` | `524288000` | Maximum upload size (500 MB) |
| `MAX_DURATION_SECONDS` | `900` | Maximum duration (15 minutes) |
| `FRAME_WIDTH` | `1280` | Key frame width |
| `FRAME_SCENE_THRESHOLD` | `0.4` | Scene-change threshold (0–1) |
| `MAX_FRAMES` | `18` | Maximum extracted key frames |
| `VISION_MAX_FRAMES` | `10` | Frames sent to vision; capped at five for Groq |
| `VISION_TRANSCRIPT_CHARS` | `30000` | Transcript characters sent to vision |
| `VISION_MAX_TOKENS` | `2000` | Vision output limit |
| `ARTIFACT_MAX_TOKENS` | `6000` | Vision output limit when file artifacts are explicitly requested; ordinary summaries keep the smaller limit above |
| `MAX_CONCURRENT_JOBS` | `2` | Concurrent analysis jobs |
| `DEMO_REQUESTS_PER_IP_PER_DAY` | `0` | Single-node daily submissions per IP; 0 disables it |
| `TRUST_PROXY` | `false` | Trust the reverse proxy's client IP |

Legacy `ANALYSIS_PROVIDER=openai-compatible` remains accepted, but new deployments should use `VISION_PROVIDER`.

## Administration and database

Set `ADMIN_PASSWORD` to enable `/admin`, where an administrator can change providers, models, base URLs, and API keys. The same administrator session is then required by AI JSON generation, URL analysis, and upload analysis. Leave it empty only when those submission endpoints should remain public. Keys are encrypted with AES-256-GCM before being written to the database; the browser only receives a last-four-character hint. Set a separate stable random `KOMA_CONFIG_SECRET`; when omitted, Koma falls back to `ADMIN_PASSWORD` as the encryption key.

Local development uses `DB_DRIVER=sqlite` and `./data/koma.sqlite` by default. Production can use a dedicated MySQL database:

| Variable | Default | Description |
| --- | --- | --- |
| `ADMIN_PASSWORD` | empty | Enables `/admin` and protects AI JSON generation plus URL/upload submission; when empty, `/admin` is disabled and the submission endpoints are public |
| `KOMA_CONFIG_SECRET` | `ADMIN_PASSWORD` | Provider-settings encryption secret; set it separately in production |
| `DB_DRIVER` | `sqlite` | `sqlite` or `mysql` |
| `KOMA_DATABASE_PATH` | `./data/koma.sqlite` | SQLite file path |
| `DB_HOST` | empty | MySQL host; never commit a real value |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` / `DB_PASSWORD` | empty | Use a dedicated account limited to `koma.*` |
| `DB_NAME` | `koma` | MySQL database name |
| `DB_SSL` | `false` | Require TLS for the database connection |
| `DB_CONNECTION_LIMIT` | `5` | MySQL connection-pool size |
| `DB_AUTO_CREATE` | `true` | Create `DB_NAME` on startup; set false for a pre-provisioned least-privilege database |

The database stores encrypted provider settings and complete JSON replay records. It stores object keys, not binary video/frame/file bodies. See [Administration](ADMIN.md) for deployment details.

## Persistent storage

| Variable | Default | Description |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` or `oss` |
| `LOCAL_STORAGE_PATH` | `./data/storage` | Persistent local object root |
| `OSS_REGION` | empty | Aliyun OSS region |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | empty | Server-only OSS credentials |
| `OSS_BUCKET` | empty | OSS bucket |
| `OSS_UPLOAD_PREFIX` | `koma` | Namespace; jobs use `koma/jobs/<id>/` |
| `OSS_PUBLIC_BASE_URL` | empty | Optional trusted public/CDN base URL; otherwise signed URLs are used |
| `OSS_SIGNED_URL_SECONDS` | `900` | Signed replay URL lifetime, capped at one hour |

Public job links are permanent and read-only for anyone who only has the link. The submitting browser can list and delete its own jobs through an HttpOnly anonymous identity; `/admin` can manage every job. Permanent deletion removes the task and its complete storage prefix.

## Processing pipeline

1. Resolve a supported video URL or accept a local upload.
2. Use FFmpeg to extract representative frames.
3. Transcribe audio with the selected ASR provider.
4. Analyze key frames and subtitles with the selected vision provider.
5. Store the source video, frames, and generated files; persist the complete result record; then delete intermediate audio and the working directory.

## Supported sites

Native parsing is available for Douyin and Bilibili (`BV` and `b23.tv` links).

When yt-dlp is installed, it is used as a fallback for sites such as YouTube, TikTok, Xiaohongshu, Weibo, and Tencent Video. Availability depends on the installed yt-dlp version and each site's anti-bot behavior.

Douyin image posts, login- or subscription-only content, and Kuaishou are not currently supported.
