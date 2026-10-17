# AI Document Create and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create and delete Markdown articles directly from the AI dialog while keeping the existing document tree, tabs, cache, and AI execution history consistent.

**Architecture:** Add deterministic intent parsing for article creation and deletion before the normal AI answer path. The AI dialog delegates mutations to the parent workspace, which already owns note API calls and document navigation; successful operations update the same caches, tabs, and tree used by normal document actions. Creation uses the AI response as generated Markdown when a body is requested, while direct title/content commands can complete without a second model call.

**Tech Stack:** React, TypeScript, Vite, existing `fnsApi.saveNote`/`deleteNote`, Node test runner, Go service static asset deployment.

**Spec:** Current user request: “需要支持可以创建，删除文章”。

## Global Constraints

- Preserve existing document editing and ordinary chat behavior.
- Do not add a second confirmation flow for explicit AI commands.
- Never delete a document unless the user message contains an explicit delete/remove intent and a resolvable target.
- Keep document paths inside the selected Vault and normalize Markdown extensions consistently.
- Reuse existing cache, tab, and tree update functions instead of duplicating workspace state logic.

---

### Task 1: Define safe CRUD intent parsing

**Files:**
- Modify: `docs-viewer/src/ai-edit.ts`
- Test: `docs-viewer/tests/ai-edit.test.ts`

**Interfaces:**
- Produces `parseDocumentCreateIntent(text): { path: string; content: string } | null` and `parseDocumentDeleteIntent(text): { path: string } | null`.
- Existing `isDocumentEditIntent` continues to classify ordinary edits and questions.

- [ ] **Step 1: Write failing tests** for explicit create commands, delete commands, extension normalization, and refusal when no target is present.
- [ ] **Step 2: Run the focused AI edit tests** and verify the new parser tests fail.
- [ ] **Step 3: Implement minimal parsing** using Chinese and English create/delete verbs, quoted or trailing paths, and conservative target validation.
- [ ] **Step 4: Run the focused tests** and verify all parser cases pass.

### Task 2: Wire workspace-owned create/delete mutations

**Files:**
- Modify: `docs-viewer/src/App.tsx`
- Modify: `docs-viewer/src/ai-edit.ts`

**Interfaces:**
- `PiAssistantProps` receives `onCreateDocument(path, content): Promise<Note>` and `onDeleteDocument(path): Promise<void>`.
- `PiAssistantDialog` calls these callbacks only after parsed intent is explicit and records operation progress in the existing process display.

- [ ] **Step 1: Add parent callbacks** that call existing note APIs and update caches, folder notes, tree, tabs, and selected note using the same state helpers as normal document operations.
- [ ] **Step 2: Pass callbacks into the AI dialog** at its existing render site without changing ordinary document actions.
- [ ] **Step 3: Add create/delete branches before normal edit/answer handling**, including a clear success status and error state in the conversation.
- [ ] **Step 4: For creation requests without supplied body, ask the configured model for Markdown content and save the returned result; for explicit body commands, save directly.
- [ ] **Step 5: Verify existing edit and chat flows still compile and the dialog shows the operation process.

### Task 3: Add regression coverage and deploy

**Files:**
- Modify: `docs-viewer/tests/ai-edit.test.ts`
- Modify: `docs-viewer/src/styles.css` only if the CRUD status needs an existing style token
- Build output: `frontend/docs/`

**Interfaces:**
- No public API changes beyond the internal AI dialog callbacks.

- [ ] **Step 1: Run `npm run build` in `docs-viewer`.
- [ ] **Step 2: Run `node --experimental-strip-types --test tests/*.test.ts` and require all tests to pass.
- [ ] **Step 3: Copy `docs-viewer/dist/.` into `frontend/docs/`.
- [ ] **Step 4: Rebuild and restart the Go service on port `9000`.
- [ ] **Step 5: Confirm the served bundle contains the create/delete behavior and no stale build output.
