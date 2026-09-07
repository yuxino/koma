# Configuration

Copy `.env.example` to `.env`. Without model credentials, Koma uses mock analysis data; Web submission still requires [GitHub sign-in](#github-sign-in).

AI work is split into two independently configurable stages:

- `ASR_PROVIDER` turns audio into timestamped subtitles.
- `VISION_PROVIDER` combines key frames and subtitles into a title, summary, chapters, and tags.
- For a custom request, `VISION_PROVIDER` also produces `extractedData` in the requested JSON shape.

The two providers can be mixed; Koma is not tied to Qwen.

Mock mode demonstrates summaries, chapters, and the timeline without inventing business data. Custom extraction therefore requires a real vision provider.

AI JSON-shape generation normally uses one vision-provider request. If that response is malformed or fails shape/path validation, Koma makes one stricter repair request before returning an invalid-output error.

## GitHub sign-in

Web analysis requires a GitHub account, even when the AI providers use mock data. The local CLI is independent of Web authentication.

Register a **GitHub App** for your deployment and configure its user authorization callback. Request no repository, organization, or account permissions, and disable webhooks; Koma only uses the authenticated public profile. A repository installation, App private key, and OAuth App are not needed for this login flow. See GitHub's [registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app) and [permission model](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

| Variable | Default | Description |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | empty | GitHub App client ID, not its numeric App ID |
| `GITHUB_CLIENT_SECRET` | empty | GitHub App client secret; server-side secret only |
| `GITHUB_CALLBACK_URL` | empty | Exact registered callback ending in `/api/auth/github/callback` |

For local `npm run dev`, register and set `http://localhost:5173/api/auth/github/callback`, then open the app at `http://localhost:5173`. Vite forwards `/api` to the server. Keep the hostname consistent; `localhost` and `127.0.0.1` do not share cookies. For production, use your HTTPS origin, for example `https://koma.yuxino.cn/api/auth/github/callback`. Callback URLs cannot contain credentials, a query, or a fragment; plain HTTP is accepted only for loopback development.

When using the repository GitHub Actions deployment, create the Secrets as `KOMA_GITHUB_CLIENT_ID`, `KOMA_GITHUB_CLIENT_SECRET`, and `KOMA_GITHUB_CALLBACK_URL`; the workflow maps them to the runtime variables above. GitHub Actions reserves Secret names starting with `GITHUB_`. See [Deployment](../DEPLOY.md).

Keep the client secret in the protected server environment or deployment secret store. Never put it in browser configuration or a `VITE_*` variable. Missing or invalid GitHub settings prevent new sign-ins; anonymous Web analysis is never enabled as a fallback. Configure providers separately for real analysis.

Koma uses single-use, browser-bound OAuth state and PKCE S256. Its own HttpOnly session lasts seven days; GitHub access tokens are used for profile lookup and are not stored. See the [authentication API](API.md#authentication) for session and sign-out behavior.

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

## Free-tier demo

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

Configure GitHub sign-in for demo users and `ADMIN_PASSWORD` for the separate operations console. Set `ANALYSIS_REQUIRE_ADMIN=true` when analysis also requires the administrator session. The daily limiter reduces request volume but is not authentication or an SSRF boundary.

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

Set `ADMIN_PASSWORD` to enable `/admin`, where an administrator can change providers, models, base URLs, and API keys. AI JSON generation, URL analysis, and upload analysis always require GitHub sign-in. With `ANALYSIS_REQUIRE_ADMIN=true`, the caller also needs the separate administrator session. Keys are encrypted with AES-256-GCM before being written to the database; the browser only receives a last-four-character hint. Set a separate stable random `KOMA_CONFIG_SECRET`; when omitted, Koma falls back to `ADMIN_PASSWORD` as the encryption key.

Local development uses `DB_DRIVER=sqlite` and `./data/koma.sqlite` by default. Production can use a dedicated MySQL database:

| Variable | Default | Description |
| --- | --- | --- |
| `ADMIN_PASSWORD` | empty | Enables the separate `/admin` console; does not replace GitHub sign-in |
| `ANALYSIS_REQUIRE_ADMIN` | `false` | With `ADMIN_PASSWORD` configured, additionally requires its session for AI JSON generation, URL/upload submission, and retry |
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
| `OSS_PUBLIC_BASE_URL` | empty | Leave empty for private workspaces; job downloads ignore this override and use signed URLs |
| `OSS_SIGNED_URL_SECONDS` | `900` | Signed replay URL lifetime, capped at one hour |

New jobs belong to the signed-in GitHub account. Replay, video, frames, and artifacts require that account or an administrator; owning a replay URL grants no access. Unclaimed legacy replay links retain their previous read-only access until their browser owner explicitly claims them. See [migration rules](ADMIN.md#existing-jobs-and-migration). Permanent deletion removes the task and its complete storage prefix.

Koma explicitly writes new OSS objects with a private ACL and privatizes a legacy job prefix before claiming it; shared bucket permissions stay unchanged. Leave `OSS_PUBLIC_BASE_URL` empty. Job downloads always check access and use signed URLs, even if that override is configured. Anyone holding a signed URL can use it until it expires. Claim cannot recall previously downloaded or cached public content, and an independently configured public CDN must not bypass origin-object access.

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
