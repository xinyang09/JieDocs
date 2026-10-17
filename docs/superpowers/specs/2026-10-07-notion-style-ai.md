# Notion 式 AI 协作规格

## 目标

为文档台提供一个以文档为中心的 AI 协作层。用户可以在当前文档、选中文本、块、指定引用文档或整个 Vault 上提问，也可以让 AI 生成修改建议、创建文章和整理知识。所有会改变文档的动作先生成可检查的 proposal/patch，用户确认后才提交；提交使用文档版本或内容哈希做并发保护，并支持一次撤销。

模型通过服务端 provider 抽象执行：用户配置的 OpenAI 兼容服务或 Ollama 优先，Pi 作为可选的本地兼容执行器。模型选择、上下文组装、权限、技能、限流、引用和写入确认由 FNS AI 编排层负责，浏览器不直接拼接 Pi 命令或传递技能文件路径。

## 交互与信息架构

1. 编辑器内选中文本后出现轻量工具条：问 AI、改写、精简、翻译、解释。工具条只负责选择动作和上下文，不创建第二套会话。
2. 编辑器输入 `/` 打开命令菜单，提供总结本页、提取待办、生成大纲、改写选区、插入引用、创建文档等命令。命令菜单支持键盘上下键和回车。
3. 右侧 AI 工作区是统一会话容器。选区助手、整篇文档助手和全局 AI 对话都写入同一套消息模型；从不同入口打开时自动带上当前上下文标签。
4. AI 回答显示来源卡片。来源至少包含 Vault、文档路径、标题和匹配片段；无法给出来源时显示“基于当前输入”，不伪造引用。
5. 改写、翻译、精简、插入、创建和删除都显示预览。预览支持接受、追加到文末、复制、重新生成、放弃；接受前显示影响的文档和块数量。
6. 接受 proposal 时，如果文档内容已变化，客户端必须拒绝静默覆盖并要求重新生成。提交成功后提供撤销入口；撤销同样检查当前内容是否仍等于 AI 写入后的版本。
7. 删除文档是高风险动作：AI 只能提出删除 proposal，用户在文档名和路径确认后才能提交，默认进入回收站 API，不直接物理删除。
8. 模型、技能和知识库范围放在工作区底部工具栏。模型不可用、知识库未选择、配额耗尽和 Pi 未安装都显示可恢复提示。

## 统一数据协议

前端和后端共享以下语义，字段名以 TypeScript 为主，Go 端使用等价结构体。

```ts
export type AIContext = {
  requestId: string
  vault: string
  note?: { path: string; content: string; contentHash: string; version: number }
  selection?: { text: string; start: number; end: number; blockId?: string }
  blocks?: Array<{ id: string; text: string; start: number; end: number }>
  references: Array<{ vault: string; path: string; title?: string; excerpt?: string; contentHash?: string }>
  queryScope: 'selection' | 'note' | 'references' | 'vault'
  locale: string
  permissions: { noteRead: boolean; noteWrite: boolean; noteDelete: boolean }
}

export type AIAction =
  | { type: 'answer'; instruction: string }
  | { type: 'summarize'; instruction?: string }
  | { type: 'rewrite'; instruction: string; target: 'selection' | 'note' }
  | { type: 'translate'; instruction?: string; language: string; target: 'selection' | 'note' }
  | { type: 'insert'; instruction: string; position: 'cursor' | 'end' | 'after-block' }
  | { type: 'create-note'; path: string; instruction: string }
  | { type: 'delete-note'; path: string }
  | { type: 'search'; instruction: string }

export type AIPatchOperation =
  | { op: 'replace-range'; start: number; end: number; text: string }
  | { op: 'insert'; at: number; text: string }
  | { op: 'create-note'; path: string; text: string }
  | { op: 'move-to-trash'; path: string }

export type AIProposal = {
  id: string
  action: AIAction['type']
  base: Array<{ vault: string; path: string; contentHash: string; version: number }>
  operations: AIPatchOperation[]
  summary: string
  expiresAt: string
}

export type AIResult = {
  requestId: string
  status: 'answer' | 'proposal' | 'cancelled' | 'error'
  answer?: string
  proposal?: AIProposal
  citations: Array<{ vault: string; path: string; title?: string; excerpt?: string; score?: number }>
  usage?: { inputTokens?: number; outputTokens?: number; durationMs: number }
  error?: { code: string; message: string; retryable: boolean }
}
```

## HTTP 与 SSE

统一入口为 `POST /api/ai/execute`，请求体为 `{ action, context, options }`。`options` 只接受 `model: { provider, id }`、`thinking: 'off'|'high'`、`skillIds: string[]` 和 `stream: boolean`。服务端以当前登录用户和 Vault 权限重新校验 context，不信任浏览器提供的权限字段或文件内容哈希。

每次执行请求都必须携带 `Idempotency-Key`；同一用户、同一路由和同一 key 在 24 小时内返回原始结果，不重复启动 Pi、不重复计费、不重复提交。流式响应使用 `text/event-stream`，每个事件是一行 `data: <JSON>`，同时发送 `id:` 序号并支持 `Last-Event-ID` 重连：

```text
event: meta
data: {"type":"meta","requestId":"...","tools":["文档读取"]}

event: context
data: {"type":"context","phase":"search","count":4}

event: delta
data: {"type":"delta","text":"部分回答"}
event: citation
data: {"type":"citation","citation":{"vault":"main","path":"guide.md","excerpt":"..."}}
event: proposal
data: {"type":"proposal","proposal":{...}}
event: usage
data: {"type":"usage","usage":{"inputTokens":120,"outputTokens":80,"durationMs":1200}}

event: done
data: {"type":"done","result":{...}}
```

服务端每 20 秒发送一次 heartbeat 注释，断线或取消必须关闭并回收 Pi 子进程。错误统一为 `{ type: 'error', code, message, retryable }`，HTTP 400 表示请求协议或大小错误，401/403 表示认证或 Vault 权限错误，409 表示 proposal 基线过期，429 表示并发或配额限制，502/504 表示 Pi 执行失败或超时。

写入使用 `POST /api/ai/proposals/:id/commit`，放弃使用 `POST /api/ai/proposals/:id/discard`，撤销使用 `POST /api/ai/proposals/:id/undo`，取消运行使用 `DELETE /api/ai/runs/:id`。提交请求携带每个目标的 `contentHash`、`version` 和一次性 `confirmToken`，服务端在同一事务内再次读取、比较、写入和记录审计事件；重复的 Idempotency-Key 返回原结果。proposal 默认 30 分钟过期，过期后只能重新生成。

模型列表和技能列表分别使用受保护的 `GET /api/ai/models`、`GET /api/ai/skills`。自定义模型目录由服务端使用当前 UID 已保存的服务和加密凭据读取，OpenAI 兼容服务请求 `/models`，Ollama 请求 `/api/tags`；不把手填默认模型当作发现结果。设置中的已保存服务通过 `GET /api/ai/providers/:id/models` 读取目录，沿用 `config_r`，选择目录模型只更新草稿，保存仍需 `version` CAS；发现不读取笔记、不自动修改默认模型、不返回密钥或原始上游错误。模型目录为空、失败或当前会话模型不在列表时明确提示，用户显式选择后才切换。技能请求只传稳定的 `skillIds`，服务端把 ID 映射到固定白名单目录；在线 URL、任意绝对路径和 `..` 路径不进入执行参数。

## 安全、配额和审计

- 所有 AI 路由进入现有 API 认证、CSRF/same-origin 校验、Vault 权限和方法限流链路；开启独立 WebGUI 端口时也必须挂载相同保护，不能因为前端来自 WebGUI 就绕过认证。旧根路径只能作为带认证和弃用响应头的短期别名，不能裸启动 Pi。
- 单次 instruction 最多 4,000 字符，单篇上下文最多 200,000 字符，引用最多 20 篇，每篇引用最多 40,000 字符，技能最多 8 个；服务端读取请求体时使用硬上限。
- 每用户并发请求最多 2 个，每日默认 200 次；计数在请求通过权限校验后、启动 Pi 前原子增加，失败和取消仍记录消耗。
- Pi 子进程默认 90 秒超时，stdout/stderr 有明确缓冲上限；日志只记录 requestId、action、耗时、错误码和 token 统计，不记录正文、技能内容和模型密钥。
- `create-note` 和 `move-to-trash` 记录操作者、Vault、路径、基线哈希、proposalId、结果和时间。引用文档被视为不可信资料，模型输出不能改变动作白名单、权限或工具参数。审计记录保留 90 天，管理员可导出脱敏统计。

## 持久化与兼容

第一阶段保留浏览器端会话历史，但将 `localStorage` 结构迁移为 `{ version: 2, sessions, activeId }`，消息增加 `requestId`、`contextSummary`、`citations` 和 `proposalId` 可选字段；旧格式读入时补默认值。proposal 不依赖浏览器持久化，刷新后标记为已失效。第一阶段明确不引入服务端会话正文表；后续若要跨设备同步，再新增 `ai_conversations`、`ai_messages`、`ai_runs`、`ai_proposals`、`ai_citations` 和 `ai_usage`，默认只保存摘要/哈希并提供删除与导出语义。

服务端新增 AI 审计表和可选的每日配额表，不改变 Markdown 文件格式和现有笔记 API。旧 `/pi-ai`、`/pi-models`、`/pi-skills` 路径在过渡期保留为仅本地 docs-viewer 兼容层，内部转发到统一服务；完成迁移后返回带迁移提示的 410。

## 验收指标与发布

- 普通问题首个 delta 的 p95 小于 4 秒；单次请求在 90 秒内明确完成、取消或失败。
- proposal 接受成功率至少 99%，任何基线哈希不匹配都不能覆盖用户后续编辑。
- 引用回答的来源卡片与实际发送的文档集合一致；无来源回答不显示伪造引用。
- 未认证用户、无 Vault 权限用户和超出配额用户不能启动 Pi 子进程。
- 旧会话迁移后标题、消息顺序、复制和重新生成行为保持不变。

发布分四阶段：先上线协议和观测但隐藏写入；再切换回答与选区改写；随后开放跨文档引用、`/` 命令和创建/回收站 proposal；最后下线旧根路径并开放按 Vault 的配额配置。
