# Administration

Koma separates the product from operations:

- Visitors submit without an account and receive an unguessable `/jobs/<id>` replay link. The same browser can list and delete jobs it submitted under “My jobs.”
- `ADMIN_PASSWORD` protects the operations console without disabling visitor analysis. Set `ANALYSIS_REQUIRE_ADMIN=true` only when AI JSON generation plus URL and upload submissions should be private. Read-only replay links remain available to anyone who has the link.
- `/admin` is the protected operations console for providers, credentials, jobs, and permanent deletion.
- Job details show the saved result, extraction instruction, expected JSON shape, requested file formats, and the provider/model snapshot without keys.
- Koma does not include a public user-account system. Ownership uses a long-lived HttpOnly anonymous cookie and stores only its digest. Other people who receive a replay link can view it but cannot delete the job.
- Jobs created before anonymous ownership was introduced remain admin-only and cannot be claimed by a visitor browser.

## Enable the console

Set two deployment secrets:

```dotenv
ADMIN_PASSWORD=<random administrator password>
ANALYSIS_REQUIRE_ADMIN=false
KOMA_CONFIG_SECRET=<a separate stable random secret>
```

When `ADMIN_PASSWORD` is empty, administration is disabled. When configured, sign-in creates a 12-hour HttpOnly, SameSite=Strict cookie for `/admin`. Analysis submissions remain public unless `ANALYSIS_REQUIRE_ADMIN=true`; in that private mode, the same session protects the three analysis endpoints. Repeated failed logins are rate limited by IP.

This access check is suitable for a private, single-user deployment, but it does not validate outbound URL destinations. If analysis remains public, protect URL submission with an egress policy or trusted URL allowlist; the importer is not yet a complete SSRF boundary.

`KOMA_CONFIG_SECRET` encrypts provider API keys with AES-256-GCM. Keep it stable and separate from the login password. Plaintext keys are never returned by the browser, health endpoint, or job APIs.

## Database

SQLite is the zero-config local default. Production can use a dedicated MySQL schema:

```dotenv
DB_DRIVER=mysql
DB_HOST=<private endpoint>
DB_PORT=3306
DB_USER=<secret account>
DB_PASSWORD=<secret password>
DB_NAME=koma
DB_SSL=false
DB_AUTO_CREATE=true
```

With `DB_AUTO_CREATE=true`, the configured account may create the `koma` database and Koma creates `koma_settings`, `koma_jobs`, and the anonymous ownership table `koma_job_owners` on startup. For a least-privilege deployment, create the database once, grant only `koma.*`, and set `DB_AUTO_CREATE=false`.

The database contains encrypted provider settings plus the complete replay record: status, provider snapshot without keys, request, transcript, summary, chapters, tags, extracted JSON, artifact metadata, and storage object keys. It never stores plaintext provider keys or binary media.

The job table loads lightweight metadata. Koma reads a job's complete request and result only after an administrator opens its detail drawer, which also links to the full replay and generated files.

## Persistent storage

Local development:

```dotenv
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=./data/storage
```

Aliyun OSS production:

```dotenv
STORAGE_DRIVER=oss
OSS_REGION=<region>
OSS_ACCESS_KEY_ID=<secret>
OSS_ACCESS_KEY_SECRET=<secret>
OSS_BUCKET=<bucket>
OSS_UPLOAD_PREFIX=koma
OSS_SIGNED_URL_SECONDS=900
```

Each task owns `koma/jobs/<job-id>/`, containing `video/`, `frames/`, and `artifacts/`. Private buckets use short-lived signed download URLs. `OSS_PUBLIC_BASE_URL` is optional for a trusted public/CDN base URL.

Intermediate audio and working files are removed after processing. Source video, frames, results, and generated files remain until either their anonymous owner deletes the job from “My jobs” or an administrator deletes it. Deletion removes both the database row and every object under the job prefix.

Never commit real database or OSS credentials. Keep them in deployment secrets only.
