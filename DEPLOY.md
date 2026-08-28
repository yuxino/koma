# Deploy Koma

Koma can be deployed to a regular Linux server with GitHub Actions, PM2, and nginx.

Current setup: `koma.yuxino.cn → nginx → 127.0.0.1:3010 → Koma`.

## GitHub Secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Description |
| --- | --- |
| `SERVER_HOST` | Server IP |
| `SERVER_USER` | SSH user, usually `root` |
| `SERVER_PASSWORD` | SSH password |
| `ASR_PROVIDER` | For example `groq` or `dashscope` |
| `VISION_PROVIDER` | For example `openrouter`, `gemini`, or `dashscope` |
| `GROQ_API_KEY` | Groq key when using Groq ASR/vision |
| `OPENROUTER_API_KEY` | OpenRouter key when using OpenRouter vision |
| `DASHSCOPE_API_KEY` | DashScope key when using DashScope |
| `OPENAI_API_KEY` | OpenAI key when using OpenAI |
| `GEMINI_API_KEY` | Gemini key when using Gemini vision |
| `ASR_MODEL` | Optional provider-model override |
| `VISION_MODEL` | Optional provider-model override |
| `PUBLIC_BASE_URL` | Optional public URL for speaker diarization |
| `DEMO_REQUESTS_PER_IP_PER_DAY` | Optional public-demo daily allowance, such as `3` |
| `ADMIN_PASSWORD` | Enables `/admin` and requires its session for AI JSON generation and URL/upload submission; use a long random value |
| `KOMA_CONFIG_SECRET` | Stable random secret used to encrypt provider keys |
| `DB_DRIVER` | `mysql` in production, or leave empty for local SQLite |
| `DB_HOST` / `DB_PORT` | MySQL endpoint and port; keep the real endpoint in Secrets |
| `DB_USER` / `DB_PASSWORD` | MySQL account; use a dedicated account limited to `koma.*` after initial setup |
| `DB_NAME` | `koma` |
| `DB_SSL` | `true` when the database requires TLS |
| `DB_AUTO_CREATE` | `true` for first boot with a privileged account; `false` after pre-provisioning |
| `STORAGE_DRIVER` | `oss` for production |
| `OSS_REGION` | Existing Aliyun OSS region |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | Existing OSS credentials, stored only as Secrets |
| `OSS_BUCKET` | Existing bucket |
| `OSS_UPLOAD_PREFIX` | `koma` keeps this project in its own folder |
| `OSS_PUBLIC_BASE_URL` | Optional public/CDN base URL; omit for private signed URLs |

`SERVER_HOST`, `SERVER_USER`, and `SERVER_PASSWORD` are all required. The manual workflow fails before copying files when any of them is missing.

## Server Setup

Install Node.js 22.23.2+, PM2, and nginx. The deployment workflow uses the same Node.js patch version for its checks and managed runtime.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx
npm i -g pm2
```

Example nginx configuration:

This is only the upstream HTTP portion. Before exposing Koma publicly, terminate TLS in front of nginx or add a certificate-backed `listen 443 ssl` server and redirect port 80 to HTTPS. Never send `/admin` credentials or session cookies over public plain HTTP.

Setting `ADMIN_PASSWORD` prevents unauthenticated callers from generating AI JSON or submitting URL/upload analysis, which is the recommended mode for a private deployment. Leaving it empty keeps those endpoints public.

Authentication is not complete network isolation. Koma's URL importer does not yet comprehensively block redirects or hostnames that resolve to private or link-local addresses. Do not expose URL submission to untrusted users without an outbound network policy or a trusted URL allowlist. Rate limits reduce abuse volume but do not close this SSRF risk.

```nginx
server {
    listen 80;
    server_name koma.yuxino.cn;

    client_max_body_size 600m;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # This is a single trusted proxy. Overwrite, rather than append, so
        # clients cannot spoof the address used by Koma's demo rate limiter.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Save it as `/etc/nginx/sites-available/koma`, enable it, then reload nginx:

```bash
ln -s /etc/nginx/sites-available/koma /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## Deployment

Run the **Deploy Koma** workflow manually from the repository's Actions page. It checks and builds the application, copies the required files to `~/koma`, installs production dependencies, writes `.env`, stops the existing PM2 process, and starts the new build. This causes a brief interruption; the current workflow is not a zero-downtime deployment. A normal push to `main` runs CI only and never deploys production. Secrets are read when the workflow runs, so redeploy after adding or changing any runtime Secret. Concurrent manual runs are serialized so they cannot copy and restart Koma at the same time.

Equivalent PM2 command:

```bash
pm2 delete koma 2>/dev/null || true
pm2 start dist-server/index.js --name koma
pm2 save
```

## Docker

The Dockerfile is an alternative packaging path; the current production workflow above does not use it. With the default SQLite database and local object storage, mount `/app/data` from a persistent volume so recreating the container does not delete replay records or media:

```bash
docker build -t koma:local .
docker volume create koma-data
docker run --rm -p 3000:3000 --env-file .env \
  --mount type=volume,source=koma-data,target=/app/data \
  koma:local
```

Keep production credentials in an external environment file or secret manager; do not copy them into the image.

## Verify

```bash
curl https://koma.yuxino.cn/api/health
pm2 status
pm2 logs koma
```

Completed tasks survive service restarts: MySQL/SQLite stores complete replay records, while OSS/local storage keeps the source video, frames, and generated files under `koma/jobs/<id>/`. In-flight tasks are marked failed after a restart and can be resubmitted; they are not silently shown as running forever. See [Administration](docs/ADMIN.md) and [Configuration](docs/CONFIGURATION.md).
