# HTTP API

Koma analysis jobs are asynchronous. Submit a video, poll the job, then retrieve either the complete video-understanding result or only the requested JSON.

## Authentication

Web analysis, AI JSON generation, and personal history require GitHub sign-in. GitHub identity and administrator access are separate: signing into one never grants the other.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/session` | Read `{ enabled, authenticated, user, legacyJobCount }`; `user` is null when signed out |
| `GET` | `/api/auth/github?returnTo=/` | Start the browser authorization flow with the configured GitHub App |
| `GET` | `/api/auth/github/callback` | Validate the GitHub callback and create a Koma account session |
| `DELETE` | `/api/auth/session` | Revoke the current account session, clear its cookie, and return `204`; requires `X-Koma-Client: 1` |

A signed-in `user` contains `{ id, login, name, avatarUrl }`; `id` is the stable numeric GitHub ID represented as a string, and `name` can be null. `legacyJobCount` is zero while signed out and otherwise counts unclaimed jobs from the current legacy browser cookie. Session responses have `cache-control: no-store`.

The `koma_session` cookie is HttpOnly, SameSite=Lax, scoped to `/`, and Secure over HTTPS. Its seven-day expiry is absolute; the database stores a token hash. Logout revokes this browser's current session, not every device or the independent administrator session. Reauthentication replaces the current Koma session. GitHub tokens are used to fetch the public profile and are not persisted or returned to the browser.

OAuth attempts expire after ten minutes and use single-use state, an independent `koma_oauth` browser cookie, and PKCE S256. `returnTo` only accepts local paths and rejects external origins, protocol-relative URLs, and API routes. Cancellation, expired/invalid callbacks, and provider/configuration failures return to `/?auth=cancelled`, `/?auth=expired`, or `/?auth=unavailable`, respectively.

Login initiation is limited to 100 requests per IP per UTC day on a single server. Further attempts return `429` with `Retry-After` without creating another pending OAuth attempt. This limit is separate from the analysis demo allowance.

## Analysis access

`POST /api/analysis-spec/generate`, `POST /api/analyze/url`, `POST /api/analyze/upload`, and `POST /api/my/jobs/:id/retry` require a valid GitHub account session and `X-Koma-Client: 1`. Other account writes use the same header. Legacy `x-koma-user: 1` is accepted for compatibility. Cross-site Fetch Metadata or a supplied Origin that differs from the configured callback origin is rejected.

A missing/invalid request header returns `403`; with that check passed, no account session returns `401`. When both `ADMIN_PASSWORD` and `ANALYSIS_REQUIRE_ADMIN=true` are set, the same request must also carry a valid `koma_admin` session, or it returns `403`. An administrator session alone cannot submit a Web job. Administration writes retain their separate `x-koma-admin: 1` header.

The Koma UI sends cookies and headers automatically. The curl examples below assume `cookies.txt` already contains a valid Koma account session from the browser authorization flow; this API does not provide password, PAT, or machine-token login. In administrator-restricted mode, the cookie jar must also contain the administrator session. Use the [local CLI](../README.md#cli) to analyze files locally without Web authentication.

## Build a JSON shape with AI

Use the configured vision provider to turn a natural-language request into an editable JSON example before submitting a video:

```bash
curl -X POST http://localhost:3000/api/analysis-spec/generate \
  -b cookies.txt -H 'X-Koma-Client: 1' \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "Recognize license plates and return their city and province",
    "additions": ["Include supporting evidence and first appearance time"],
    "lang": "en"
  }'
```

The response is not a job and contains no video analysis. `outputSchema` is always an object or array suitable for review, editing, and later use with `/api/analyze/url` or `/api/analyze/upload`. `fieldDescriptions` explains every leaf field in the requested language and identifies whether it came from the primary request or a quick addition:

```json
{
  "outputSchema": {
    "plates": [
      { "plateNumber": "string", "city": "string", "province": "string", "evidence": "string", "atMs": 0 }
    ]
  },
  "fieldDescriptions": [
    { "path": "plates[].plateNumber", "label": "Plate number", "description": "The complete license plate recognized in the video", "source": "request" },
    { "path": "plates[].city", "label": "City", "description": "The city inferred from the recognized plate", "source": "request" },
    { "path": "plates[].province", "label": "Province", "description": "The province inferred from the recognized plate", "source": "request" },
    { "path": "plates[].evidence", "label": "Evidence", "description": "The visual evidence supporting the recognition", "source": "addition" },
    { "path": "plates[].atMs", "label": "First appearance", "description": "The first time the plate appears, in milliseconds", "source": "addition" }
  ]
}
```

At least one non-empty `instruction` or `additions` item is required; their combined content is limited to 4,000 characters. `additions` accepts up to eight strings. Every schema leaf has exactly one matching description path, with no extra or duplicate paths. `lang` is optional and accepts `en` or `zh`. The request body is limited to 16 KiB, and successful responses include `cache-control: no-store`.

The endpoint is available only when a real vision provider and its credentials are configured. It uses the same demo allowance as video analysis: invalid input is rejected before allowance is consumed. If the first model response is malformed or fails the JSON shape/path checks, Koma requests one complete repair response with stricter instructions. It returns `502` if that repair is still invalid; provider request failures are not retried.

Errors are `400` for invalid input, `401` when the account session is missing, `403` when a request guard or the optional administrator requirement fails, `413` for an oversized body, `429` when the demo allowance is exhausted, `502` when the provider request fails or the repaired response is invalid, and `503` when the vision provider is unavailable or not configured.

## Video URL

```bash
curl -X POST http://localhost:3000/api/analyze/url \
  -b cookies.txt -H 'X-Koma-Client: 1' \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://example.com/video.mp4",
    "lang": "en",
    "instruction": "Extract every product, price, and first appearance time",
    "outputSchema": {
      "products": [
        { "name": "string", "price": 0, "atMs": 0 }
      ]
    },
    "artifactFormats": ["json", "csv"]
  }'
```

The endpoint responds with `202`. The ID also forms the private replay route `/jobs/JOB_ID`:

```json
{ "jobId": "..." }
```

URL submission requires GitHub sign-in. Koma does not yet comprehensively block redirects or hostnames that resolve to private or link-local addresses. Authentication limits who can call this endpoint, but it is not an outbound network boundary; deployments admitting untrusted users still need an egress policy or a trusted URL allowlist.

## Local upload

Multipart text fields must appear before the `video` file field:

```bash
curl -X POST 'http://localhost:3000/api/analyze/upload?lang=en' \
  -b cookies.txt -H 'X-Koma-Client: 1' \
  -F 'instruction=Extract every product, price, and first appearance time' \
  -F 'outputSchema={"products":[{"name":"string","price":0,"atMs":0}]}' \
  -F 'artifactFormats=["json","csv"]' \
  -F 'video=@demo.mp4'
```

`instruction` is limited to 4,000 characters. `outputSchema` can be a JSON example or JSON Schema and is limited to 12,000 characters. `artifactFormats` accepts `json`, `csv`, `markdown`, `srt`, and `text`. All are optional; omit them for the default general summary. Put output-language requirements directly in `instruction`, for example: “Generate separate Chinese, English, and Japanese SRT subtitle files.”

## Retrieve results

For account-owned jobs, every job, extraction, artifact, video, and frame route checks the owner or administrator session. Signed-out and other-account requests receive `404`, just like a missing job. Unclaimed legacy links retain read-only access. Job responses include `owned`, `visibility` (`private` or `legacy-link`), and `retryable`.

```bash
curl -b cookies.txt http://localhost:3000/api/jobs/JOB_ID
```

When the job is done, `result.extractedData` contains the requested data. To retrieve that JSON value without Koma's title, chapters, and other wrapper fields:

```bash
curl -b cookies.txt http://localhost:3000/api/jobs/JOB_ID/extraction
```

This endpoint returns `extractedData` exactly. It returns `409` while the job is running and `404` when custom extraction was not requested or the job was deleted.

## Download generated files

`result.artifacts` in the job response contains metadata and a `downloadUrl`, not the potentially large file body:

```json
{
  "name": "products.csv",
  "format": "csv",
  "mimeType": "text/csv; charset=utf-8",
  "sizeBytes": 281,
  "downloadUrl": "/api/jobs/JOB_ID/artifacts/0"
}
```

Fetch `downloadUrl` with the authorized session to download the persisted file. Video and frame URLs use the same access checks. OSS responses redirect to a short-lived signed URL; anyone who obtains that URL can use it until expiry. Koma currently generates text artifacts only; model-supplied base64 and binary files are not accepted.

The browser also exports Markdown notes and SRT subtitles directly from the saved result, without another model request. These exports are separate from the model-generated `result.artifacts`.

## My jobs

Personal history follows the GitHub account across browsers. All routes below require its valid session; write routes additionally require `X-Koma-Client: 1`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/my/jobs` | Read the account's latest 200 jobs, with summary, duration, status, and `retryable` |
| `GET` | `/api/my/jobs/legacy` | List unclaimed jobs proven by this browser's existing `koma_viewer` cookie |
| `POST` | `/api/my/jobs/claim` | Explicitly transfer those browser-owned jobs into the signed-in account; returns `{ claimed }` |
| `POST` | `/api/my/jobs/:id/retry` | Create a new account-owned job from a recoverable failed job; returns `202` and `{ jobId }` |
| `DELETE` | `/api/my/jobs/:id` | Permanently delete a job owned by the signed-in account; returns `204` |

Claiming adds account ownership and restricts future replay and origin-object access. It does not recall previously downloaded files or cached public responses. It never assigns jobs from another browser or overrides an existing account owner. No valid legacy cookie means an empty list and zero claimed jobs; clearing that cookie cannot be undone by supplying a job ID. Claiming can return `503` if private object permissions cannot be applied, without assigning the jobs to the account.

Retry is available only for a failed job with a saved source URL or retained video. It copies the original language and analysis request, uses the currently configured providers, and keeps the original failed job. Retained media is preferred over downloading the URL again. A running/completed job, absent source, or unreadable retained video returns `409`; another account's job returns `404`. The normal analysis access checks and per-IP demo allowance also apply to retries. A saved URL may still expire or fail at the source site during the new analysis.

`DELETE /api/jobs/:id` returns `405`; use the account or administration delete route instead. Deleting a job removes both its persistent record and storage prefix. There is no API for making a new account-owned job public.

## Administration API

Administration endpoints are intended for the same-origin `/admin` console. After `ADMIN_PASSWORD` is configured, `POST /api/admin/login` creates an HttpOnly session. Every administration write also requires `x-koma-admin: 1` as a CSRF guard.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/session` | Check whether administration is enabled and authenticated |
| `POST` | `/api/admin/login` | Sign in as administrator |
| `DELETE` | `/api/admin/session` | Sign out |
| `GET` | `/api/admin/settings` | Read redacted provider settings |
| `PUT` | `/api/admin/settings` | Save providers, models, base URLs, and optional replacement keys |
| `POST` | `/api/admin/settings/reset` | Restore provider settings from server environment variables |
| `GET` | `/api/admin/jobs` | Read up to 200 persistent jobs |
| `GET` | `/api/admin/jobs/:id` | Read the complete request, provider snapshot, and result |
| `DELETE` | `/api/admin/jobs/:id` | Stop a job and permanently remove its database row and storage prefix |

Settings responses never include plaintext API keys; they only expose `keyConfigured` and a last-four-character `keyHint` such as `••••1234`.
