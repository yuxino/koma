# Output Field Clarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every quick addition and confirmed JSON field understandable before a video analysis starts.

**Architecture:** Keep the existing prompt-first workflow and JSON editor. Add a small client-side schema summarizer for JSON examples, render its field paths, meanings, and value types inline in the form, and expose each suggestion's scope without relying on hover.

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
