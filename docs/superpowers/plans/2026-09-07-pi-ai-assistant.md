# Pi AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local Pi-powered AI assistant to the docs viewer for note summarization, polishing, and custom instructions.

**Architecture:** The browser sends a bounded prompt and current note content to the local docs-viewer server. The server validates the same-origin session, runs Pi in print/JSON mode, extracts assistant text, and returns it without exposing model credentials to the browser. The reader gets a compact assistant panel with copy and replace actions.

**Tech Stack:** Node.js local server, React/TypeScript, existing CSS tokens, Pi CLI (`pi -p ... --mode json`).

**Spec:** User-confirmed Pi local backend for the existing docs viewer.

## Global Constraints

- Do not change the FNS API or stored Markdown format.
- Do not send model credentials to the browser.
- Bound prompt and note sizes to protect the local process.
- Keep the feature optional when Pi is not installed.

### Task 1: Local Pi endpoint

**Files:**
- Modify: `docs-viewer/server/local-api.ts`
- Test: `docs-viewer/server/local-api.test.ts`

- [x] Add a same-origin `POST /pi-ai` route with JSON `{ instruction, content, title? }`.
- [x] Spawn `pi -p <prompt> --mode json`, enforce a 90-second timeout, parse JSON event output, and return `{ text }`.
- [x] Return clear 400/404/502 errors for invalid input, missing Pi, or failed execution.
- [x] Add unit coverage for validation and output extraction.

### Task 2: Browser API and assistant panel

**Files:**
- Modify: `docs-viewer/src/api.ts`
- Modify: `docs-viewer/src/App.tsx`
- Modify: `docs-viewer/src/styles.css`

- [x] Add `runPiAssistant(instruction, content, title)` to the API client.
- [x] Add an AI action button beside note actions and a panel with summary, polish, and custom instruction modes.
- [x] Render loading/error/result states; support copy result and replace the inline editor content when editing.
- [x] Match existing Notion-like dialog/panel styles and keyboard semantics.

### Task 3: Verification and documentation

**Files:**
- Modify: `docs-viewer/README.md`

- [x] Document Pi installation, provider/model configuration, and feature behavior.
- [x] Run `npx tsc -b --noEmit`, `npm run build`, and server tests.
- [x] Verify the endpoint returns a useful error when Pi is unavailable.
