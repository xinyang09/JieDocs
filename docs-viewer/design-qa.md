# Design QA

## 2026-10-15 — 标题浮动显示

- 桌面端规则：大纲不再占用阅读区第三列，恢复为右侧 24px 浮动入口；标题列表在悬停或键盘聚焦后以 240px 浮层展开，阅读区保留独立滚动。
- 响应式规则：1180px 及以下沿用现有隐藏大纲和双栏阅读布局；窄屏不新增横向滚动。
- 视觉回归：`docs-viewer/src/pearl-theme.css` 已覆盖旧的静态大纲覆盖样式，`npm run build` 通过并同步至 `frontend/docs`；macOS ARM64 Go 内嵌服务已重新编译。
- 自动化回归：`node --experimental-strip-types --test tests/markdown-outline.test.ts` — 7 passed, 0 failed。
- 浏览器边界：本地 `http://127.0.0.1:9000/docs/` 已加载重编译服务，但刷新后现有会话提示 `Auth token has expired`，因此没有伪造或修改凭据，也未宣称完成真实 Vault 文档态截图验证。

- source visual truth: selected "文档台" direction from this task (dark navigation shell, white reader canvas, lime accent, dense three-pane knowledge desk).
- implementation screenshot: `/Users/xinyang/workspace/jj-procect/fast-note-sync-service/docs-viewer/desktop-check.png`
- viewport: 1904 x 912 desktop; mobile companion check at 390 x 844 in `/Users/xinyang/workspace/jj-procect/fast-note-sync-service/docs-viewer/mobile-check.png`.
- state: initial, disconnected connection dialog open; sidebar interaction also checked.
- full-view comparison evidence: the captured desktop page presents the requested dark shell, three-pane reading desk, white document surface, contextual outline, and restrained lime state color.
- focused region comparison: connection dialog was inspected at desktop and mobile sizes; icon actions and visible input labels are legible, aligned, and do not overflow.

**Findings**

No actionable P0, P1, or P2 findings.

- [P3] Live FNS data state has not been captured.
  Location: vault selection, note list, attachment rendering.
  Evidence: no FNS server was listening at `http://127.0.0.1:9000` during validation.
  Impact: API code is compiled but requires a configured live service for end-to-end validation.
  Fix: enter a reachable FNS address and API token, then verify vault browsing, note loading, and authenticated inline attachments.

**Open Questions**

- The first supported release is intentionally read-only. Editing, creation, deletion, and write conflict UX are outside this release.

**Implementation Checklist**

- [x] Verify desktop layout and connection dialog.
- [x] Verify mobile layout and dialog width.
- [x] Verify sidebar collapse and restore control.
- [x] Build TypeScript and Vite production assets.
- [x] Read-only FNS client uses `/api/vault`, `/api/notes`, `/api/note`, `/api/folder/tree`, and authenticated `/api/file` for embedded images.

**Follow-up Polish**

- Add live service fixtures or a development mock for automated API-path testing.

Patches made since the previous QA pass: added authenticated Blob URL attachment loading for FNS embedded media.

final result: passed

## 2026-09-10 — 添加任务弹窗验收

This section records the current task composer; the initial read-only release notes above are historical.

- Preserved the existing compact form and theme. The document selector supports title/path search, a separate new-document action, and destination help text.
- Live browser check at 1123 × 1043: the task workspace loaded 215 tasks (138 open, 77 completed). The modal opened with no unrelated document preselected.
- Searching an existing document returned one matching result with its folder and the correct count. The menu extended past the modal edge without clipping.
- Pressing Enter selected the document, collapsed the menu, and updated the destination hint without submitting a task. No user notes or tasks were changed.
- Regression command: `node --experimental-strip-types --test tests/task-create.test.ts tests/task-document-picker.test.ts` — 10 passed, 0 failed. Covers source-content preservation, task insertion, folder-based creation, search/count limits, and viewport positioning calculations.
- Restored the existing merged service after finding port 9000 unavailable. `/docs/`, its referenced JS/CSS assets, and `/webgui/` returned HTTP 200 after restart.
- Verification boundary: further live checks for no-match/clear/Escape behavior and mobile rendering could not be completed after the browser connection lost its auth token. No new login credentials were read or changed. The viewport checks above are unit tests, not a mobile screenshot pass.


## 2026-10-07 — 模块化知识工作台重构验收

- 视觉方向：模块化控制室；石墨中性色为底，电光蓝作为主要操作强调。
- 已覆盖：首屏工作台、活动栏、目录/搜索/收藏/最近访问、阅读区与右侧大纲、任务、AI 对话/助手、技能、平台插件、2FA、登录、设置与通用弹窗。
- 新增：无文档选中时的工作台首页，包含文档/任务/收藏/AI 技能概览、最近访问和快速动作入口。
- 响应式：桌面三栏阅读布局；中屏收起大纲；窄屏活动栏移动到底部、目录改为抽屉并保留主题/设置/账号入口。
- 无障碍：统一 focus-visible 样式、触控尺寸与 `prefers-reduced-motion` 降级。
- 构建：`docs-viewer/npm run build` 通过；主包约 873 KB，Univer 保持独立懒加载 chunk。
- 浏览器：`http://127.0.0.1:9000/docs/` 已重启并加载新产物；登录页可见“文档台 / 把知识放在一个清晰的地方”品牌入口，默认主题为深色石墨。
- 验证边界：当前浏览器没有可用的 FNS 登录凭据，因此未进入真实 Vault 数据、文档阅读和任务数据态；未修改或读取任何账号密码。



## 2026-10-07 — 2FA 入口归入插件

- 移除左侧活动栏中的独立“2FA 验证码”主功能入口。
- 在“插件中心”中新增“2FA 验证码”插件卡片，与外部文档发布插件统一管理。
- 点击插件卡片仍打开原有 2FA 管理页，保留账户、验证码刷新、复制、添加、编辑和删除能力。
- 2FA 页面继续使用独立全屏工作区，不改变服务端接口和加密存储。

