# Administration

Koma separates account ownership from operations:

- GitHub sign-in opens a personal workspace. Web submissions and AI JSON generation require a signed-in account.
- New jobs are private. The owner and an authenticated administrator can read their replay, video, key frames, extracted JSON, and generated files. A job ID alone grants no access, and there is no public-sharing switch for new jobs.
- `/admin` uses its own password and session to manage providers, credentials, all jobs, and permanent deletion. GitHub users do not become administrators.
- Job details show saved results, instructions, expected JSON, requested file formats, and the provider/model snapshot without keys.
- `ANALYSIS_REQUIRE_ADMIN=true`, when `ADMIN_PASSWORD` is configured, additionally requires an administrator session for AI JSON generation, analysis submissions, and retry. It does not replace GitHub sign-in.

## Existing jobs and migration

Existing data is preserved, with no automatic assignment to the first person who signs in:

| Record | Access after upgrade | Migration |
| --- | --- | --- |
| New GitHub-account job | Owner or administrator only | Already private |
| Old job with a browser-owner digest | Its unclaimed replay link retains read-only access | Sign in using the original browser and explicitly claim its old jobs |
| Old job without a browser-owner digest | Its existing replay access remains unchanged; administration manages it | Cannot be claimed through the personal workspace |

`GET /api/my/jobs/legacy` lists only unclaimed jobs proven by the current `koma_viewer` cookie. `POST /api/my/jobs/claim` assigns those jobs to the signed-in account and makes them private; existing link recipients then lose future replay access. Previously downloaded or cached public copies cannot be recalled, and already issued signed URLs remain usable until expiry. It never claims jobs from another browser, overwrites an account owner, or assigns orphan records. Clearing the original browser cookie prevents this self-service claim; knowing a job ID is insufficient. See the [API](API.md#my-jobs).

Before upgrading, back up the database and persistent storage and pause submissions while taking a consistent recovery snapshot. Startup adds account, session, OAuth-attempt, account-ownership, and retry-source tables; it preserves the old job and browser-owner records. An interrupted analysis is marked failed after restart. A failed account job can be retried if its source URL or retained video is available; this creates a new job and preserves the old record.

The schema migration is additive, but an older server does not understand private account ownership. **Do not roll back to that server with job and media routes exposed.** Keep the service in maintenance mode while restoring a consistent database/storage snapshot or fixing forward, and restore public traffic only when account-aware access checks are in place. Preserve post-upgrade data separately before any snapshot restoration. Deleting the new ownership tables is not a privacy-safe rollback.

## Enable the console

Set the administrator password and a separate encryption secret:

```dotenv
ADMIN_PASSWORD=<random administrator password>
ANALYSIS_REQUIRE_ADMIN=false
KOMA_CONFIG_SECRET=<a separate stable random secret>
```

When `ADMIN_PASSWORD` is empty, administration is disabled. When configured, administrator sign-in creates a separate 12-hour HttpOnly, SameSite=Strict cookie, scoped to `/`; its in-memory session expires on restart. Repeated failed logins are rate limited by IP. GitHub account sessions are stored in the database, last seven days, and remain independent. Signing out of one identity does not sign out the other.

Authentication does not validate outbound URL destinations. Before admitting untrusted users, protect URL submission with an egress policy or trusted URL allowlist; the importer is not yet a complete SSRF boundary.

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

With `DB_AUTO_CREATE=true`, the configured account may create the `koma` database. Koma creates `koma_settings`, `koma_jobs`, and legacy `koma_job_owners` plus `koma_accounts`, `koma_account_sessions`, `koma_oauth_attempts`, `koma_job_accounts`, and `koma_job_sources` on startup. For a least-privilege deployment, create the database once, grant only the required privileges on `koma.*`, and set `DB_AUTO_CREATE=false`; table creation is still required for upgrades.

The database contains encrypted provider settings plus the complete replay record: status, provider snapshot without keys, request, transcript, summary, chapters, tags, extracted JSON, artifact metadata, and storage object keys. It never stores plaintext provider keys or binary media. Account records contain the GitHub numeric ID, current login, display name, and avatar URL. Session tokens, OAuth state, and the temporary browser binding are stored as hashes; the short-lived PKCE verifier is server-side. GitHub access tokens and refresh tokens are not persisted.

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

Each task owns `koma/jobs/<job-id>/`, containing `video/`, `frames/`, and `artifacts/`. New uploads explicitly set each OSS object to private, and claim sets every object under the legacy job prefix to private before assigning the account. The shared bucket policy is unchanged. Leave `OSS_PUBLIC_BASE_URL` empty; task download routes always request signed URLs rather than using this public override. Download authorization is checked by Koma before it issues a short-lived signed URL; anyone holding that signed URL can use it until expiry. Do not expose the same objects through a public CDN.

Intermediate audio and working files are removed after processing. Source video, frames, results, and generated files remain until either their account owner deletes the job from “My jobs” or an administrator deletes it. Deletion removes both the database row and every object under the job prefix.

Never commit real database or OSS credentials. Keep them in deployment secrets only.
