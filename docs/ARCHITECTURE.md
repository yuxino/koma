# Source architecture

Koma keeps executable entrypoints small in location and groups implementation code by responsibility.
The Web app uses GitHub accounts for private workspaces and a separate password-protected operations console. The CLI composes the same analysis pipeline locally without browser authentication.

## Client

```text
src/client/
├── main.tsx                 # browser entrypoint and route selection
├── features/
│   ├── analyzer/            # signed-in workspace, analysis, and replay
│   └── admin/               # operations and provider administration
├── shared/                  # reusable formatting, errors, and progress helpers
└── styles/                  # shared and feature-level stylesheets
```

Feature code may depend on `shared` and `styles`. Shared code must not depend on a feature.

## Server

```text
src/server/
├── index.ts                 # HTTP composition root
├── cli.ts                   # CLI composition root
├── http/                    # request limits and endpoint-level tests
├── auth/                    # GitHub sessions, admin auth, and legacy viewer identity
├── application/             # job lifecycle and pipeline orchestration
├── analysis/                # model calls, schemas, and structured analysis
├── media/                   # URL resolution, download, ASR, and video processing
├── persistence/             # database, storage, and generated artifacts
├── config/                  # environment and provider configuration
└── shared/                  # small cross-layer primitives and contracts
```

Entry points compose the layers. Application code coordinates analysis, media, and persistence. Infrastructure code should not import HTTP entrypoints. Tests stay next to the code or layer they exercise.

Run `npm run check:structure` to verify that implementation files have not drifted back into the client or server roots.

## Identity and job access

The HTTP layer composes three independent identities: persistent GitHub account sessions, in-memory administrator sessions, and the legacy browser cookie used only to prove old-job ownership. New Web jobs use account ownership. Every job result and media route enforces the account or administrator check; legacy jobs keep their prior link access until explicitly claimed.

Account ownership is stored in an additive table, separate from legacy owner digests. Claiming first privatizes stored OSS objects, then adds immutable account ownership. New OSS writes set a private object ACL. Task downloads always issue signed URLs after access checks, including when a public storage base URL exists. The shared bucket policy is not changed, and previously downloaded or cached public copies cannot be recalled.

A retry creates a new job from the failed job's saved URL or retained media, with the original request and current providers. It does not restart or overwrite the old job. Account sessions and ownership survive restart; running work is marked interrupted rather than resumed automatically.

The client keeps custom-analysis drafts and saved defaults in browser storage, separated by GitHub account. Study, interview/meeting, and product presets provide starting points without an extra model call. AI-generated JSON stays in an editable review draft until confirmed, and request ordering prevents older responses from replacing newer drafts. The workspace searches the returned history, while transcript search and Markdown/SRT exports operate on the saved result without another model call.

See [ADR 0003](decisions/0003-github-workspaces.md), [HTTP API](API.md), and [migration rules](ADMIN.md#existing-jobs-and-migration) for the access and recovery contract.
