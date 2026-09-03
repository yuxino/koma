# Source architecture

Koma keeps executable entrypoints small in location and groups implementation code by responsibility.
The current refactor changes file placement only; runtime behavior and public HTTP contracts stay unchanged.

## Client

```text
src/client/
├── main.tsx                 # browser entrypoint and route selection
├── features/
│   ├── analyzer/            # public analysis experience
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
├── auth/                    # admin and viewer identity
├── application/             # job lifecycle and pipeline orchestration
├── analysis/                # model calls, schemas, and structured analysis
├── media/                   # URL resolution, download, ASR, and video processing
├── persistence/             # database, storage, and generated artifacts
├── config/                  # environment and provider configuration
└── shared/                  # small cross-layer primitives and contracts
```

Entry points compose the layers. Application code coordinates analysis, media, and persistence. Infrastructure code should not import HTTP entrypoints. Tests stay next to the code or layer they exercise.

Run `npm run check:structure` to verify that implementation files have not drifted back into the client or server roots.
