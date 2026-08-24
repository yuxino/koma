# JSON Analysis Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Koma's mutually exclusive output presets with a reusable prompt-first analysis configuration that lets AI generate an editable JSON shape.

**Architecture:** The browser owns a versioned local draft and optional default configuration containing the user's request, composable suggestion IDs, and JSON shape. A new small server endpoint reuses the configured vision provider to turn the effective natural-language request into a validated JSON example; the video-analysis API remains backward compatible and continues to accept `artifactFormats`, but the public UI stops asking for file formats before analysis.

**Tech Stack:** React 19, TypeScript, Fastify, Vitest, browser `localStorage`, OpenAI-compatible chat-completion providers, plain CSS.

---

### Task 1: Persist the browser analysis configuration

**Files:**
- Create: `src/client/analysis-config.ts`
- Test: `src/client/analysis-config.test.ts`

**Step 1: Write the failing tests**

Cover an empty store, valid versioned state, corrupted JSON, unknown versions, invalid suggestion IDs, oversized fields, automatic draft updates, saving a default, and restoring a default.

**Step 2: Run the focused test**

Run: `npm test -- --run src/client/analysis-config.test.ts`

Expected: FAIL because the persistence module does not exist.

**Step 3: Implement the versioned state**

Use this public shape:

```ts
interface AnalysisDraft {
  instruction: string;
  suggestionIds: string[];
  outputSchema: string;
}

interface StoredAnalysisConfig {
  version: 1;
  draft: AnalysisDraft;
  defaultConfig?: AnalysisDraft;
}
```

Expose safe load/save helpers against a small `StorageLike` interface. Reject malformed values without throwing, clamp strings to the same client/server limits, de-duplicate allowed suggestion IDs, and never store video URLs or files.

**Step 4: Run the focused test**

Expected: PASS.

### Task 2: Reuse provider chat completion

**Files:**
- Create: `src/server/chat-completion.ts`
- Test: `src/server/chat-completion.test.ts`
- Modify: `src/server/analysis.ts`

**Step 1: Write the failing tests**

Verify URL normalization, bearer authentication, OpenRouter headers, model/temperature/token payloads, timeout signal handling, string and array response content, and sanitized upstream errors.

**Step 2: Implement the helper**

Create one provider-neutral helper that accepts text or multimodal user content and returns the model message content. Keep provider credentials server-side and use `config.aiTimeoutMs`.

**Step 3: Replace the duplicated request in video analysis**

Keep the existing prompt, content, model, token limit, retry behavior, and result normalization unchanged.

**Step 4: Run focused regression tests**

Run: `npm test -- --run src/server/chat-completion.test.ts src/server/analysis.test.ts`

Expected: PASS.

### Task 3: Generate and validate a JSON shape with AI

**Files:**
- Create: `src/server/analysis-spec-ai.ts`
- Test: `src/server/analysis-spec-ai.test.ts`
- Modify: `src/server/index.ts`

**Step 1: Write failing generation tests**

Cover valid JSON, fenced JSON, provider content arrays, missing `outputSchema`, scalar roots, over-complex structures, mock provider, missing credentials, and upstream failures.

**Step 2: Implement the generator**

Prompt the model to return only:

```json
{"outputSchema":{"items":[{"name":"string","atMs":0}]}}
```

Treat the user's request as untrusted data, preserve it unchanged, require lower-camel-case keys, and use example placeholders instead of invented business values. Validate the result through `parseAnalysisSpec` before returning it.

**Step 3: Add the HTTP endpoint**

Add `POST /api/analysis-spec/generate` with a 16 KB route body limit. Validate the request before consuming the existing demo allowance, return `cache-control: no-store`, and map mock/unconfigured providers to 503, invalid upstream output to 502, and quota exhaustion to 429.

**Step 4: Run focused backend tests**

Expected: PASS.

### Task 4: Replace presets with a prompt-first configuration UI

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/atelier-public.css`

**Step 1: Remove misleading choices**

Delete the three large single-select preset cards, `activePreset`, and the public artifact-format selector. Keep backend/API compatibility for old jobs and programmatic callers.

**Step 2: Add the request composer**

Render one textarea titled “这次想得到什么 / What do you want from this video?”. Keep the empty state valid and explain that the normal summary, chapters, and subtitles still run.

Render “提取信息 / 双语字幕 / 整理报告” as small independent suggestion toggles. Store their IDs separately and combine their language-specific instructions with the free-form request only when generating a JSON shape or submitting analysis.

**Step 3: Add explicit AI generation**

Add “整理成 JSON / Build JSON” beside the request. Reject an empty effective request with a nearby explanation. Preserve the current request and JSON on network/model failure. Confirm before replacing a non-empty JSON shape. Keep generated JSON in the editor draft until the user applies it, lock configuration/submission while generation is running, and ignore aborted or superseded responses.

**Step 4: Turn the advanced dialog into a JSON editor**

Keep a dependency-free monospace editor with live validation, format, clear, valid/error status, and keyboard/focus behavior. Empty JSON means the analysis model may choose the shape.

**Step 5: Add reusable browser configuration**

Hydrate from local storage once, auto-save changes, show “saved in this browser”, and add “Set as default” plus “Restore default”. Never clear this configuration when returning home or starting another analysis.

**Step 6: Update request submission**

Submit only the combined `instruction` and parsed `outputSchema` from the public UI. Do not send `artifactFormats` unless a future UI explicitly restores that feature.

### Task 5: Update product and API documentation

**Files:**
- Modify: `docs/plans/2026-08-24-frame-atelier-design.md`
- Modify: `docs/API.md`
- Modify: `docs/API.zh-CN.md`

**Step 1: Replace the obsolete preset requirement**

Document the prompt-first, composable-suggestion, editable-JSON, browser-persistence flow. State that export format is not a mutually exclusive analysis mode.

**Step 2: Document the generation endpoint**

Add request, response, availability, validation, and error behavior in both API languages.

### Task 6: Verify behavior and presentation

**Files:**
- Verify all modified files

**Step 1: Run focused tests while implementing**

Run each new test file before and after its implementation.

**Step 2: Run the full check**

Run: `npm run check`

Expected: all tests, type checks, and production builds pass.

**Step 3: Browser QA**

Check 1440×900, 768×1024, and 390×844. Verify empty/default state, multiple suggestions, restored draft/default, AI loading/failure/success, invalid JSON, formatting, clear, keyboard focus, and submit payload.

**Step 4: Final diff review**

Run `git diff --check`, confirm no generated screenshots or browser session files remain, and ensure unrelated mascot assets are untouched.
