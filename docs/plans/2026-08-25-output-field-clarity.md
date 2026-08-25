# Output Field Clarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every quick addition and confirmed JSON field understandable before a video analysis starts.

**Architecture:** Keep the existing prompt-first workflow and JSON editor. Generate the JSON example and path-matched human explanations in one provider call, persist those explanations with the browser draft, and render them by origin before confirmation. Keep the client-side schema summarizer as a safe fallback for manually edited or legacy JSON.

**Tech Stack:** React 19, TypeScript, CSS, Vitest

---

### Task 1: Summarize JSON example fields

**Files:**
- Create: `src/client/output-schema-summary.ts`
- Create: `src/client/output-schema-summary.test.ts`

**Step 1:** Write focused tests for nested objects, arrays, value types, localized meanings, invalid JSON, and long schemas.

**Step 2:** Run the focused test and confirm it fails because the helper does not exist.

**Step 3:** Implement a bounded, dependency-free traversal that returns leaf field paths, localized meanings, and value types.

**Step 4:** Run the focused test and confirm it passes.

### Task 2: Expose suggestion scope and confirmed fields

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/atelier-public.css`

**Step 1:** Replace ambiguous automatic-JSON copy with explicit unknown/confirmed-field states and clearer actions.

**Step 2:** Render each quick addition's description inside its control so pointer hover is not required.

**Step 3:** Render confirmed field summaries inline, with the JSON editor available as a secondary action and no page navigation.

**Step 4:** Add compact and mobile styles that preserve the project's monochrome visual language.

**Step 5:** Treat generated or edited JSON as a candidate. Show its human-readable field preview before confirmation, keep the applied structure unchanged on cancel, and make JSON editing return to the preview before it can be applied.

### Task 3: Verify behavior and presentation

**Files:**
- Verify: `src/client/output-schema-summary.test.ts`
- Verify: `src/client/App.tsx`
- Verify: `src/client/atelier-public.css`

**Step 1:** Run the client-focused tests and typecheck.

**Step 2:** Build the client.

**Step 3:** Launch the local interface, exercise empty and configured field states, and inspect desktop and mobile screenshots.

**Step 4:** Fix any visual or interaction regressions before delivery.

### Task 4: Generate authoritative field explanations

**Files:**
- Modify: `src/server/analysis-spec-ai.ts`
- Modify: `src/server/analysis-spec-ai.test.ts`
- Modify: `src/server/index.ts`
- Modify: `docs/API.md`
- Modify: `docs/API.zh-CN.md`

**Step 1:** Write failing parser and prompt tests requiring one explanation for every output-schema leaf, including localized label, concrete description, and `request` or `addition` origin.

**Step 2:** Update the generation prompt to keep the user's request and quick additions separate, require every explicit request item, and return explanations in the requested interface language.

**Step 3:** Validate generated paths against the actual JSON example and reject missing, duplicate, or extra explanations as invalid provider output.

**Step 4:** Accept optional quick-addition instructions in the HTTP endpoint without breaking existing instruction-only callers, and document the expanded request and response.

### Task 5: Persist and present explanation metadata

**Files:**
- Modify: `src/client/analysis-config.ts`
- Modify: `src/client/analysis-config.test.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/atelier-public.css`

**Step 1:** Write failing storage tests for sanitized optional field explanations and backward-compatible version-1 drafts.

**Step 2:** Keep generated explanations with the candidate and persist them only after final field confirmation.

**Step 3:** Match explanations to current schema paths, discard stale metadata after manual edits, and retain the existing name-based fallback for unmatched fields.

**Step 4:** Group the review into “From your request” and “From quick additions”, showing the AI label, concrete explanation, path, and value type.

**Step 5:** Run focused server/client tests, typecheck, build, then verify a real generation and responsive review flow in the browser.
