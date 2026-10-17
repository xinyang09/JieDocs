# Inline WYSIWYG Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Markdown edit dialog with an inline, page-level editor that preserves Markdown storage.

**Architecture:** Keep the existing Markdown string as the source of truth. Add an inline edit view beside the existing reader, using a contenteditable surface for direct editing and a small command toolbar. Convert edited HTML back to Markdown on save with a focused serializer for supported block types.

**Tech Stack:** React, TypeScript, existing ReactMarkdown renderer, existing CSS tokens.

## Global Constraints

- Do not change the FNS API or stored file format.
- Preserve the existing modal editor until the inline editor is verified.
- Keep keyboard accessibility and mobile layout functional.

### Task 1: Inline editor shell

**Files:** `docs-viewer/src/App.tsx`, `docs-viewer/src/styles.css`

- [ ] Add inline editing state and render an editor article in the reader area.
- [ ] Add save/cancel controls to the document metadata bar.
- [ ] Keep the current dialog as fallback for new documents.
- [ ] Run `npm run build`.

### Task 2: Formatting and serialization

**Files:** `docs-viewer/src/App.tsx`, `docs-viewer/src/styles.css`

- [ ] Add toolbar actions for bold, italic, headings, lists, quote, and code.
- [ ] Serialize supported contenteditable blocks back to Markdown.
- [ ] Verify round-trip behavior with representative Markdown.
- [ ] Run `npm run build` and inspect the running page.
