from __future__ import annotations

import json
import posixpath
import re
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]

MOVES: dict[str, str] = {
    # Client entrypoint stays at src/client/main.tsx. Product code is grouped by feature.
    "src/client/App.tsx": "src/client/features/analyzer/App.tsx",
    "src/client/analysis-config.ts": "src/client/features/analyzer/analysis-config.ts",
    "src/client/analysis-config.test.ts": "src/client/features/analyzer/analysis-config.test.ts",
    "src/client/output-schema-summary.ts": "src/client/features/analyzer/output-schema-summary.ts",
    "src/client/output-schema-summary.test.ts": "src/client/features/analyzer/output-schema-summary.test.ts",
    "src/client/AdminApp.tsx": "src/client/features/admin/AdminApp.tsx",
    "src/client/errors.ts": "src/client/shared/errors.ts",
    "src/client/errors.test.ts": "src/client/shared/errors.test.ts",
    "src/client/format.ts": "src/client/shared/format.ts",
    "src/client/format.test.ts": "src/client/shared/format.test.ts",
    "src/client/progress.ts": "src/client/shared/progress.ts",
    "src/client/progress.test.ts": "src/client/shared/progress.test.ts",
    "src/client/atelier-admin.css": "src/client/styles/atelier-admin.css",
    "src/client/atelier-foundation.css": "src/client/styles/atelier-foundation.css",
    "src/client/atelier-public.css": "src/client/styles/atelier-public.css",

    # Server entrypoints stay at src/server/index.ts and src/server/cli.ts.
    "src/server/admin-auth.ts": "src/server/auth/admin-auth.ts",
    "src/server/admin-auth.test.ts": "src/server/auth/admin-auth.test.ts",
    "src/server/viewer-session.ts": "src/server/auth/viewer-session.ts",
    "src/server/viewer-session.test.ts": "src/server/auth/viewer-session.test.ts",

    "src/server/config.ts": "src/server/config/config.ts",
    "src/server/config.test.ts": "src/server/config/config.test.ts",
    "src/server/deployment-env.test.ts": "src/server/config/deployment-env.test.ts",

    "src/server/jobs.ts": "src/server/application/jobs.ts",
    "src/server/jobs.test.ts": "src/server/application/jobs.test.ts",
    "src/server/pipeline.ts": "src/server/application/pipeline.ts",
    "src/server/pipeline.test.ts": "src/server/application/pipeline.test.ts",
    "src/server/pipeline-fallback.test.ts": "src/server/application/pipeline-fallback.test.ts",

    "src/server/analysis.ts": "src/server/analysis/analysis.ts",
    "src/server/analysis.test.ts": "src/server/analysis/analysis.test.ts",
    "src/server/analysis-spec.ts": "src/server/analysis/analysis-spec.ts",
    "src/server/analysis-spec.test.ts": "src/server/analysis/analysis-spec.test.ts",
    "src/server/analysis-spec-ai.ts": "src/server/analysis/analysis-spec-ai.ts",
    "src/server/analysis-spec-ai.test.ts": "src/server/analysis/analysis-spec-ai.test.ts",
    "src/server/chat-completion.ts": "src/server/analysis/chat-completion.ts",
    "src/server/chat-completion.test.ts": "src/server/analysis/chat-completion.test.ts",
    "src/server/provider-runtime.ts": "src/server/analysis/provider-runtime.ts",
    "src/server/provider-runtime.test.ts": "src/server/analysis/provider-runtime.test.ts",

    "src/server/asr.ts": "src/server/media/asr.ts",
    "src/server/asr.test.ts": "src/server/media/asr.test.ts",
    "src/server/download.ts": "src/server/media/download.ts",
    "src/server/resolver.ts": "src/server/media/resolver.ts",
    "src/server/resolver.test.ts": "src/server/media/resolver.test.ts",
    "src/server/temp-audio.ts": "src/server/media/temp-audio.ts",
    "src/server/url-source.ts": "src/server/media/url-source.ts",
    "src/server/url-source.test.ts": "src/server/media/url-source.test.ts",
    "src/server/video.ts": "src/server/media/video.ts",
    "src/server/video.test.ts": "src/server/media/video.test.ts",
    "src/server/video-stream.ts": "src/server/media/video-stream.ts",
    "src/server/video-stream.test.ts": "src/server/media/video-stream.test.ts",

    "src/server/database.ts": "src/server/persistence/database.ts",
    "src/server/database.test.ts": "src/server/persistence/database.test.ts",
    "src/server/storage.ts": "src/server/persistence/storage.ts",
    "src/server/storage.test.ts": "src/server/persistence/storage.test.ts",
    "src/server/artifacts.ts": "src/server/persistence/artifacts.ts",
    "src/server/artifacts.test.ts": "src/server/persistence/artifacts.test.ts",

    "src/server/rate-limit.ts": "src/server/http/rate-limit.ts",
    "src/server/rate-limit.test.ts": "src/server/http/rate-limit.test.ts",
    "src/server/analysis-access.test.ts": "src/server/http/analysis-access.test.ts",
    "src/server/http-limits.test.ts": "src/server/http/http-limits.test.ts",

    "src/server/semaphore.ts": "src/server/shared/semaphore.ts",
    "src/server/semaphore.test.ts": "src/server/shared/semaphore.test.ts",
    "src/server/types.ts": "src/server/shared/types.ts",
}

MODULE_PATTERN = re.compile(
    r"(?P<prefix>(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+))"
    r"(?P<quote>[\"'])(?P<spec>\.{1,2}/[^\"']+)(?P=quote)"
)
MOCK_PATTERN = re.compile(
    r"(?P<prefix>\b(?:vi|jest)\.(?:mock|doMock|unmock|importActual|importMock)\(\s*)"
    r"(?P<quote>[\"'])(?P<spec>\.{1,2}/[^\"']+)(?P=quote)"
)


def normalize(path: PurePosixPath | str) -> str:
    return posixpath.normpath(str(path))


def original_target(current_old: str, specifier: str, original_files: set[str]) -> str:
    raw = normalize(PurePosixPath(current_old).parent / specifier)
    suffix = PurePosixPath(specifier).suffix

    if suffix == ".js":
        candidates = [
            str(PurePosixPath(raw).with_suffix(".ts")),
            str(PurePosixPath(raw).with_suffix(".tsx")),
            raw,
        ]
    elif suffix == ".jsx":
        candidates = [
            str(PurePosixPath(raw).with_suffix(".tsx")),
            str(PurePosixPath(raw).with_suffix(".jsx")),
            raw,
        ]
    elif suffix:
        candidates = [raw]
    else:
        base = PurePosixPath(raw)
        candidates = [
            str(base.with_suffix(".ts")),
            str(base.with_suffix(".tsx")),
            str(base.with_suffix(".js")),
            str(base.with_suffix(".jsx")),
            str(base / "index.ts"),
            str(base / "index.tsx"),
            raw,
        ]

    return next((candidate for candidate in candidates if candidate in original_files), raw)


def module_specifier(current_new: str, target_new: str, old_specifier: str) -> str:
    target = PurePosixPath(target_new)
    old_suffix = PurePosixPath(old_specifier).suffix

    if old_suffix == ".js" and target.suffix in {".ts", ".tsx"}:
        visible_target = target.with_suffix(".js")
    elif old_suffix == ".jsx" and target.suffix == ".tsx":
        visible_target = target.with_suffix(".jsx")
    elif not old_suffix and target.suffix in {".ts", ".tsx", ".js", ".jsx"}:
        visible_target = target.with_suffix("")
    else:
        visible_target = target

    start = str(PurePosixPath(current_new).parent) or "."
    relative = posixpath.relpath(str(visible_target), start=start)
    return relative if relative.startswith(".") else f"./{relative}"


def rewrite_modules(text: str, current_new: str, current_old: str, original_files: set[str]) -> str:
    def replace(match: re.Match[str]) -> str:
        specifier = match.group("spec")
        target_old = original_target(current_old, specifier, original_files)
        target_new = MOVES.get(target_old, target_old)
        rewritten = module_specifier(current_new, target_new, specifier)
        return f'{match.group("prefix")}{match.group("quote")}{rewritten}{match.group("quote")}'

    text = MODULE_PATTERN.sub(replace, text)
    return MOCK_PATTERN.sub(replace, text)


def write_layout_check() -> None:
    content = '''import { readdir } from "node:fs/promises";

const roots = [
  {
    path: "src/client",
    allowedFiles: new Set(["main.tsx"]),
    requiredDirectories: ["features", "shared", "styles"]
  },
  {
    path: "src/server",
    allowedFiles: new Set(["index.ts", "cli.ts"]),
    requiredDirectories: ["analysis", "application", "auth", "config", "http", "media", "persistence", "shared"]
  }
];

const errors = [];

for (const root of roots) {
  const entries = await readdir(root.path, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));

  for (const directory of root.requiredDirectories) {
    if (!names.has(directory)) errors.push(`${root.path}/${directory} is missing`);
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
    if (!root.allowedFiles.has(entry.name)) {
      errors.push(`${root.path}/${entry.name} should live in a feature or layer directory`);
    }
  }
}

if (errors.length > 0) {
  console.error("Source layout check failed:\\n" + errors.map((error) => `- ${error}`).join("\\n"));
  process.exit(1);
}

console.log("Source layout check passed.");
'''
    destination = ROOT / "scripts/check-source-layout.mjs"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")


def write_architecture_doc() -> None:
    content = '''# Source architecture

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
'''
    destination = ROOT / "docs/ARCHITECTURE.md"
    destination.write_text(content, encoding="utf-8")


def update_package_json() -> None:
    path = ROOT / "package.json"
    package = json.loads(path.read_text(encoding="utf-8"))
    scripts = package.setdefault("scripts", {})
    scripts["check:structure"] = "node scripts/check-source-layout.mjs"
    existing_check = scripts.get("check", "")
    if "check:structure" not in existing_check:
        scripts["check"] = f"npm run check:structure && {existing_check}".rstrip(" &")
    path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    original_files = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "src").rglob("*")
        if path.is_file()
    }

    missing = [source for source in MOVES if source not in original_files]
    if missing:
        raise SystemExit("Missing move sources:\n" + "\n".join(f"- {path}" for path in missing))

    collisions = [destination for destination in MOVES.values() if (ROOT / destination).exists()]
    if collisions:
        raise SystemExit("Move destinations already exist:\n" + "\n".join(f"- {path}" for path in collisions))

    for source, destination in MOVES.items():
        source_path = ROOT / source
        destination_path = ROOT / destination
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.rename(destination_path)

    inverse_moves = {destination: source for source, destination in MOVES.items()}
    for path in (ROOT / "src").rglob("*"):
        if not path.is_file() or path.suffix not in {".ts", ".tsx"}:
            continue
        current_new = path.relative_to(ROOT).as_posix()
        current_old = inverse_moves.get(current_new, current_new)
        original = path.read_text(encoding="utf-8")
        rewritten = rewrite_modules(original, current_new, current_old, original_files)
        if rewritten != original:
            path.write_text(rewritten, encoding="utf-8")

    write_layout_check()
    write_architecture_doc()
    update_package_json()

    # Remove the one-shot automation from the resulting commit.
    for helper in [
        ROOT / ".github/scripts/refactor_layering.py",
        ROOT / ".github/workflows/refactor-layering.yml",
    ]:
        helper.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
