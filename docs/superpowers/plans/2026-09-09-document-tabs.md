# Document Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Open documents in switchable top-level tabs instead of replacing the current document view.

**Architecture:** Keep the existing selectedNote/selectedFile state as the active document source, add a lightweight open-tab registry keyed by vault/kind/path, and synchronize tab metadata whenever the active document changes. Opening an item activates an existing tab or creates a new one; closing a tab selects a neighboring tab and clears the reader only when no tabs remain.

**Tech Stack:** React, TypeScript, Vite, existing Docs viewer CSS.

**Spec:** User request: change the current document header into tab functionality.

## Global Constraints

- Preserve existing autosave, locking, search, directory, AI, and document actions.
- Do not change backend APIs or persisted note content.
- Keep the current active document readable and editable exactly as before.

### Task 1: Tab state and document activation

**Files:**
- Modify: `docs-viewer/src/App.tsx`

- [x] Add a `DocumentTab` type and `openTabs`/`activeTabKey` state.
- [x] Add helpers to create keys, activate loaded tabs, and close tabs.
- [x] Update `openLibraryItem`, `openNote`, `openFile`, and `openSkill` so selecting an item creates/activates the matching tab while retaining current loading behavior.
- [x] Synchronize active tab metadata after note/file changes, renames, and saves.

### Task 2: Topbar tab UI

**Files:**
- Modify: `docs-viewer/src/App.tsx`
- Modify: `docs-viewer/src/styles.css`

- [x] Replace the single-document breadcrumb presentation with a horizontally scrollable tab strip when tabs exist.
- [x] Render document type icons, active state, close buttons, and a tooltip/path for each tab.
- [x] Keep vault breadcrumb visible when there are no tabs and keep search/new-document controls unchanged.
- [x] Add responsive styles for narrow widths and keyboard focus states.

### Task 3: Build and runtime verification

**Files:**
- Modify: `frontend/docs/` generated assets

- [x] Run `npm --prefix docs-viewer run build`.
- [x] Copy `docs-viewer/dist` to `frontend/docs`.
- [x] Run `go build -o /tmp/fast-note-sync-service .`, restart the local service, and verify `/docs/` returns HTTP 200 and the new tab bundle is served.
