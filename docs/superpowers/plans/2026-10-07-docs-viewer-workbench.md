# Docs Viewer 模块化知识工作台重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将 `docs-viewer` 全量前台重构为石墨中性色 + 电光蓝的现代知识工作台，覆盖登录、主壳层、目录、阅读区、任务、AI、技能、设置、弹窗和移动端。

**Architecture:** 保留现有 React/Vite 数据和交互逻辑，采用 CSS token 与结构化覆盖层重塑视觉层级；仅在需要支撑新层级的地方增补轻量语义类名和默认状态。平台主壳层继续使用 `platform-container` / `platform-activity-bar` / `platform-main` / `workspace`，避免拆分大型 App.tsx 带来的行为回归。

**Tech Stack:** React 18, TypeScript, Vite, CSS custom properties, lucide-react, existing FNS API/state layer.

**Spec:** `PRODUCT.md` 与已确认设计 brief（模块化控制室；石墨中性色 + 电光蓝；允许更激进的布局调整）。

## Global Constraints

- 保留现有文档、任务、AI、技能、2FA、插件、分享、上传、编辑、设置与登录行为。
- 颜色策略使用石墨中性色为主、单一电光蓝为操作强调，保证正文与占位文本可读。
- 桌面端使用活动栏 + 可收起目录 + 阅读/工具区；窄屏保持所有入口可达。
- 动效必须提供 `prefers-reduced-motion` 降级；焦点态、键盘操作和触控尺寸保持可访问。
- 不改动后端和根目录既有未提交业务改动；只修改 `docs-viewer` 前端与本计划/验收文档。

---

### Task 1: 统一设计 token 与全局基线

**Files:**
- Modify: `docs-viewer/src/styles.css:1-220`
- Modify: `docs-viewer/src/App.tsx:181-190`

**Interfaces:**
- Produces the shared `--canvas`, `--surface`, `--chrome`, `--accent`, `--ink`, `--muted`, `--border`, `--shadow-*` tokens used by every existing module.
- Keeps `SystemSettings.theme` and `document.documentElement.dataset.theme` behavior unchanged.

- [x] **Step 1: Set the default workspace appearance**
  - Change `defaultSystemSettings.theme` from `light` to `dark` so first-run users see the selected graphite workspace.
  - Keep explicit light/system settings and local storage migration intact.

- [x] **Step 2: Replace token values and aliases**
  - Use near-black graphite canvas (#0d1117 range), layered slate surfaces, electric blue accent (#3b82f6 / #60a5fa dark), and high-contrast ink.
  - Keep all existing aliases (`--ink-secondary`, `--shell-card`, `--surface-sunken`, etc.) mapped to the same ladder.

- [x] **Step 3: Establish global focus, selection, scroll and reduced-motion rules**
  - Add a shared `:focus-visible` treatment, touch-safe minimums for icon buttons, and a reduced-motion media query that disables transitions/animations while preserving visibility.

- [x] **Step 4: Run the frontend build**
  - Run `npm run build` from `docs-viewer`.
  - Expected: Vite build passes; Univer remains in its own lazy chunk.

---

### Task 2: Recompose the desktop workbench shell

**Files:**
- Modify: `docs-viewer/src/styles.css:240-900`
- Modify: `docs-viewer/src/App.tsx:8710-9160` only if a semantic class is needed.

**Interfaces:**
- Preserves the existing `platform-activity-bar`, `activity-nav-item`, `topbar`, `sidebar`, and `workspace` DOM.
- Keeps `handleTabClick`, account menu, theme toggle, and document tabs as-is.

- [x] **Step 1: Style the activity rail**
  - Set a 68px rail with compact brand mark, active blue tile, badge alignment, tooltip contrast, and utility/account group pinned to the bottom.
  - Keep the mobile rail horizontally scrollable with safe-area padding.

- [x] **Step 2: Style the command topbar**
  - Make the topbar a 58px graphite command strip with breadcrumb/document tabs on the left, a centered search/command affordance, and primary new-document action on the right where existing controls exist.
  - Preserve document tab keyboard activation and close actions.

- [x] **Step 3: Style sidebar and workspace geometry**
  - Use a 300px desktop directory pane, a minmax reader column, and a 280px outline/tool column when present.
  - Add clear active-row treatment, quiet separators, sticky sidebar header, and internal scrolling with `min-height: 0`.

- [x] **Step 4: Validate shell states**
  - Check files/search/tasks/skills/AI/2FA/plugin tabs and collapsed sidebar state at 1440px and 1024px widths.

---

### Task 3: Upgrade reader, outline and document interaction surfaces

**Files:**
- Modify: `docs-viewer/src/styles.css:2400-3300`
- Modify: `docs-viewer/src/DocumentOutline.tsx` only if the new outline grouping needs a class; otherwise leave markup unchanged.

**Interfaces:**
- Keeps `.reader-area`, `.reader-meta`, `.document-reader`, `.document-outline`, inline editor, spreadsheet editor and file preview behavior intact.

- [x] **Step 1: Create the reading canvas**
  - Give the reader a restrained surface, 68–74ch text measure, stronger title hierarchy, calm metadata row, and blue links/selection.
  - Remove heavy nested shadows and colored side-stripe decoration.

- [x] **Step 2: Style outline and reading tools**
  - Make the outline a quiet right rail with active heading indicator, compact controls, and readable empty state.
  - Style reader actions, tabs, save states, code blocks, tables and image previews to share the token ladder.

- [x] **Step 3: Style loading/error/empty states**
  - Use skeletons with low-contrast graphite surfaces, explicit error actions, and centered empty-state copy without layout jumps.

- [x] **Step 4: Run build and inspect a Markdown note**
  - Confirm reader and inline editor compile and preserve headings, task checkboxes, tables and code blocks.

---

### Task 4: Align task, AI, skills and plugin workspaces

**Files:**
- Modify: `docs-viewer/src/styles.css:1160-2400` and relevant module blocks near the end.
- Modify: `docs-viewer/src/ai-chat.css`, `docs-viewer/src/xdb.css`, `docs-viewer/src/twofa.css` only for token compatibility if needed.

**Interfaces:**
- Leaves task board/list/calendar/gantt, `AiChatWorkspace`, `PiAssistantDialog`, XDB, Transfer, 2FA and skill install callbacks unchanged.

- [x] **Step 1: Make tasks scan-friendly**
  - Use compact filter chips, a clear two-column task layout, restrained priority colors, and a calm board/card treatment.
  - Preserve task toggles, priority menus, add-task dialog and document picker.

- [x] **Step 2: Make AI surfaces feel native**
  - Use blue/cyan signal only for AI affordances, with message bubbles and composer aligned to the same spacing and radius system.
  - Keep model picker, history menu, skills popover and cancel/send behavior intact.

- [x] **Step 3: Normalize secondary workspaces**
  - Bring skills, platform plugins, XDB and 2FA modules onto the same surface/border/typography tokens.
  - Ensure cards never fall back to transparent backgrounds.

- [x] **Step 4: Validate high-density states**
  - Open tasks, AI chat, skills, plugin and 2FA views; verify scroll containers and dialogs do not clip.

---

### Task 5: Redesign login, settings and modal states

**Files:**
- Modify: `docs-viewer/src/styles.css:3400-4300`
- Modify: `docs-viewer/src/App.tsx:3950-4040` only if an extra class is needed.

**Interfaces:**
- Keeps `LoginDialog`, `SettingsDialog`, `DocumentEditorDialog`, folder/move/share/install dialogs and all callbacks intact.

- [x] **Step 1: Style login as a focused entry state**
  - Use a split graphite backdrop with a compact brand panel and a high-contrast form surface, while retaining required-login behavior and validation copy.

- [x] **Step 2: Style settings as a navigable command surface**
  - Give settings a two-column layout (section rail + content) on desktop and one-column stack on mobile.
  - Keep theme, density, reader size, outline, directory sort, cache and connection controls intact.

- [x] **Step 3: Normalize dialogs and overlays**
  - Use one modal backdrop layer, consistent 12px radius, predictable z-index order, readable form fields, and primary/secondary button hierarchy.
  - Preserve portal-based menus and keyboard focus.

- [x] **Step 4: Validate modal edge cases**
  - Check login error, editor save error, add task, install skill, share and settings on narrow viewport.

---

### Task 6: Responsive behavior and visual QA

**Files:**
- Modify: `docs-viewer/src/styles.css`
- Modify: `docs-viewer/design-qa.md` with new acceptance notes/screenshots if needed.

**Interfaces:**
- No API or persistence changes.

- [x] **Step 1: Add responsive breakpoints**
  - At <= 1024px reduce sidebar width and hide secondary outline; at <= 820px move rail to bottom and turn sidebar into a scrim-backed drawer; at <= 560px stack modal fields and keep actions full-width.

- [x] **Step 2: Add accessibility and reduced-motion QA**
  - Verify all interactive rail items remain reachable, focus rings are visible, and motion is disabled under `prefers-reduced-motion`.

- [x] **Step 3: Build and verify in browser**
  - Run `npm run build` and use the existing local `http://127.0.0.1:9000/docs/` tab to inspect desktop and mobile states.
  - Capture updated screenshots into `docs-viewer/desktop-check.png` and `docs-viewer/mobile-check.png` only if the local server and browser verification are available.

- [x] **Step 4: Summarize verification**
  - Record build result, viewport checks and any known limitation in `docs-viewer/design-qa.md`.

