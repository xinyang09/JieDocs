# Task Workspace Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the task entry into a dedicated task workspace with list, kanban, calendar, and gantt views while preserving folder scope, search, task toggling, and opening the source document.

**Architecture:** Keep task extraction and persistence in `docs-viewer/src/App.tsx`, extend `TaskItem` with optional scheduling metadata parsed from the task line, and render the existing task surface as a full task workspace when the task tab is active. Use CSS-only layout primitives for the four views so no dependency is added.

**Tech Stack:** React, TypeScript, Vite, existing CSS tokens, lucide-react icons.

**Spec:** Clicking 任务 should open task views such as list, kanban, gantt, and calendar; the task display should not be a cluttered flat list.

## Global Constraints

- Preserve existing task scanning, folder scope, keyword search, checkbox toggling, and source-document navigation.
- Do not add a new dependency.
- Keep task status legible with text and controls, not color alone.
- Tasks without dates remain visible in list/kanban and appear in an explicit “未排期” area for calendar/gantt.

### Task 1: Task workspace state and compact task data

**Files:**
- Modify: `docs-viewer/src/App.tsx`

- [x] Add a `TaskView` union and view state to `TaskPanel`.
- [x] Parse optional due dates from task text without changing the saved markdown line.
- [x] Group visible tasks by source document for the list view.
- [x] Build and type-check the existing task behavior.

### Task 2: List, kanban, calendar, and gantt renderers

**Files:**
- Modify: `docs-viewer/src/App.tsx`
- Modify: `docs-viewer/src/styles.css`

- [x] Add compact view tabs and a task workspace toolbar.
- [x] Render grouped list, three-column kanban, a date-based week calendar, and a date-based gantt timeline.
- [x] Keep each task clickable and its checkbox wired to the existing toggle handler.
- [x] Add explicit empty and unscheduled states.

### Task 3: Verification

**Files:**
- Modify: `frontend/docs/` generated assets if the existing build workflow requires copying them.

- [x] Run the docs viewer build.
- [x] Run the Go build used by the local service.
- [x] Check the task workspace in the running service and verify the view controls render.

### Task 4: Task priority

**Files:**
- Modify: `docs-viewer/src/App.tsx`
- Modify: `docs-viewer/src/styles.css`
- Modify: `frontend/docs/` generated assets

- [x] Parse compatible priority markers (`🔺`, `⏫`, `🔼`, `🔽`, `⏬`, `🔻`) without treating fenced code as tasks.
- [x] Render a compact priority selector on each task card.
- [x] Save priority changes back to the source Markdown while preserving checkbox state and line formatting.
- [x] Rebuild the docs viewer and restart the merged service.

### 2026-10-15 任务工具栏滚动修复

- [x] 恢复任务工作区单列 grid 的高度约束，列表、看板、日历和甘特图只滚动 `.tasks-view`，搜索、状态、视图切换和新增任务栏保持可见。
- [x] 窄屏工具栏按内容换行；空态和加载态保留内部滚动。
- [x] 27 项任务相关测试、前端生产构建与 macOS ARM64 服务构建通过，构建产物已同步并重启本地 9000 服务。
- [x] 实际页面验证桌面四视图滚动前后工具栏坐标不变、390px 手机列表滚动及无匹配结果状态。未执行任务或文档写入。

- [x] 2026-10-15 移除视图切换栏灰色容器背景与外框；前端及服务构建通过，本地四视图已验证透明背景、无边框及正常切换。

- [x] 2026-10-15 统一四视图切换栏前后间距与窄屏横向留白；前端和服务构建通过，实测 1423px 桌面及 390px 手机宽度下四视图工具栏高度、位置与内容起点一致。

- [x] 2026-10-15 删除日历视图按钮旧选中态的下划线、加粗和边框覆盖；前端及服务构建通过，实际页面四视图选中样式已逐项对比一致。

### 2026-10-16 任务入口默认视图

- [x] 首次扫描完成后，如果当前日期范围没有排期任务，自动打开按文档分组的列表，避免用户先面对空时间网格；用户主动选择日历、看板或时间轴后保持选择。
- [x] 前端生产构建、构建产物同步、macOS ARM64 服务重编译与重启通过；实际页面验证 186 项任务在无当前周排期时默认进入列表，仍可切换到看板、日历和甘特图。

### 2026-10-15 任务列表文件分组

- [x] 分组标题显示 Vault 内完整路径，支持长路径换行及当前筛选任务数。
- [x] 默认展开；原生标题按钮支持鼠标、Enter 和空格独立折叠，暴露 aria-expanded；面板内搜索和切换视图保留状态，折叠关闭优先级菜单。
- [x] 27 项任务测试、前端与 macOS ARM64 服务构建通过，本地服务已更新；验证独立折叠、键盘、搜索、跨视图、菜单关闭和 390px／320px 窄屏路径无溢出。

### 2026-10-15 任务搜索位置

- [x] 搜索框移到状态筛选之后并在顶部筛选栏右对齐，四种视图使用相同布局，窄屏沿用自然换行。
- [x] 前端及 macOS ARM64 服务构建、27 项任务测试通过，本地服务已更新；实际页面四视图搜索框均右对齐，搜索与清空正常，390px／320px 窄屏自然换行且无横向溢出。

### 2026-10-15 任务页顶部精简

- [x] 移除标题说明、待办总数、“我的任务”、刷新入口和右侧收起按钮，保留任务标题、状态筛选和搜索；左侧任务入口可重新打开。
- [x] 前端与 macOS ARM64 服务构建、27 项任务测试通过，本地服务已更新；实际页面验证顶部元素已移除，任务扫描与四视图操作正常。

### 2026-10-15 任务页面中文化
- [x] 将添加任务、日/周/月、筛选、日程列表、今天和任务时间轴等任务视图文案统一为中文，保留内部视图枚举。
- [x] 27 项任务测试、前端与 macOS ARM64 服务构建通过；实际验证四种视图、日历范围切换、筛选菜单和空态无英文任务文案。
- [x] 统一新增入口文案为“添加任务”；空任务状态的“创建第一条任务”保留为首次引导，二者调用同一任务创建流程。
