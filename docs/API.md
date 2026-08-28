# HTTP API

Koma analysis jobs are asynchronous. Submit a video, poll the job, then retrieve either the complete video-understanding result or only the requested JSON.

## Analysis access

When `ADMIN_PASSWORD` is configured, `POST /api/analysis-spec/generate`, `POST /api/analyze/url`, and `POST /api/analyze/upload` require both the existing `koma_admin` session created by `POST /api/admin/login` and the same-origin request header `x-koma-admin: 1`. With that header present, an unauthenticated request returns `401`; a missing or incorrect header returns `403`. After administrator sign-in, the Koma browser UI sends the HttpOnly cookie and request header automatically. API clients must preserve the cookie and add the header themselves.

When `ADMIN_PASSWORD` is empty, these three endpoints keep their account-free public behavior. Read-only job and replay endpoints are unchanged in either mode.

The submission examples below assume that public mode. In protected mode, sign in once and save the cookie:

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H 'content-type: application/json' \
  -H 'x-koma-admin: 1' \
  -c cookies.txt \
  -d '{"password":"YOUR_ADMIN_PASSWORD"}'
```

Then add `-b cookies.txt -H 'x-koma-admin: 1'` to each of the three protected requests.

## Build a JSON shape with AI

Use the configured vision provider to turn a natural-language request into an editable JSON example before submitting a video:

```bash
curl -X POST http://localhost:3000/api/analysis-spec/generate \
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

Errors are `400` for invalid input, `401` when protected analysis access lacks an administrator session, `403` when its request header is missing, `413` for an oversized body, `429` when the demo allowance is exhausted, `502` when the provider request fails or the repaired response is invalid, and `503` when the vision provider is unavailable or not configured.

## Video URL

```bash
curl -X POST http://localhost:3000/api/analyze/url \
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

The endpoint responds with `202`. The ID also forms the permanent, unguessable replay route `/jobs/JOB_ID`:

```json
{ "jobId": "..." }
```

With `ADMIN_PASSWORD` empty, URL submission is public. Koma does not yet comprehensively block redirects or hostnames that resolve to private or link-local addresses. Administrator authentication limits who can call this endpoint, but it is not an outbound network boundary; public deployments still need an egress policy or a trusted URL allowlist.

## Local upload

Multipart text fields must appear before the `video` file field:

```bash
curl -X POST 'http://localhost:3000/api/analyze/upload?lang=en' \
  -F 'instruction=Extract every product, price, and first appearance time' \
  -F 'outputSchema={"products":[{"name":"string","price":0,"atMs":0}]}' \
  -F 'artifactFormats=["json","csv"]' \
  -F 'video=@demo.mp4'
```

`instruction` is limited to 4,000 characters. `outputSchema` can be a JSON example or JSON Schema and is limited to 12,000 characters. `artifactFormats` accepts `json`, `csv`, `markdown`, `srt`, and `text`. All are optional; omit them for the default general summary. Put output-language requirements directly in `instruction`, for example: “Generate separate Chinese, English, and Japanese SRT subtitle files.”

## Retrieve results

```bash
curl http://localhost:3000/api/jobs/JOB_ID
```

When the job is done, `result.extractedData` contains the requested data. To retrieve that JSON value without Koma's title, chapters, and other wrapper fields:

```bash
curl http://localhost:3000/api/jobs/JOB_ID/extraction
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

Fetch `downloadUrl` to download the persisted file. Video and frame URLs use the same read-only job API. Koma currently generates text artifacts only; model-supplied base64 and binary files are not accepted.

## My jobs

The browser receives a one-year `koma_viewer` HttpOnly cookie when it first submits a job or opens its history. Koma stores only its digest and uses it to list and delete jobs created by that browser:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/my/jobs` | Read lightweight history for the browser's latest 100 jobs |
| `DELETE` | `/api/my/jobs/:id` | Permanently delete a job created by this browser; also requires `x-koma-user: 1` |

The public replay endpoint remains read-only. `DELETE /api/jobs/:id` returns `405`, so possessing only a job ID or shared link does not grant deletion. CLI clients that need ownership should persist the cookie, for example with curl's `-c cookies.txt -b cookies.txt`.

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
