# WebSocket 同步协议前端对接说明 (版本 1.1)

本协议描述了最新调整后的同步流程，前端在对接 `NoteSync`, `FolderSync`, `SettingSync` 和 `FileSync` 时需遵循以下规范。

## 1. 核心变更概览

- **Request**: 所有同步请求需携带 `context` 字符串。
- **Response**: 同步结果不再合并返回，改为 **先返回统计结束消息 (End)，后发送逐条详情消息**。
- **Context**: 所有下发的同步响应都将原样透传请求中的 `context`。

## 2. 交互流程示例

以 **笔记同步 (NoteSync)** 为例：

### Step 1: 前端发起同步请求
前端需生成一个唯一的 `context`（如随机 UUID 或时间戳），用于标识本次同步任务。

**Action**: `NoteSync`
**Data**:
```json
{
  "context": "sync_task_001",
  "vault": "MyNotes",
  "lastTime": 1708800000000,
  "notes": [...]
}
```

### Step 2: 服务端返回统计消息 (End)
服务端在扫描完变更后，会立刻发送一个 End 确认消息。该消息**不再包含明细列表**，仅用于告知统计数据。

**ActionType**: `NoteSyncEnd`
**Response**:
```json
{
  "code": 200,
  "status": true,
  "message": "success",
  "vault": "MyNotes",
  "context": "sync_task_001",
  "data": {
    "lastTime": 1708900000000,
    "needUploadCount": 2,
    "needModifyCount": 1,
    "needSyncMtimeCount": 0,
    "needDeleteCount": 1
  }
}
```

### Step 3: 服务端逐条推送明细消息
随后，服务端会将具体的变更动作通过独立的 WebSocket 消息下发。

- **明细消息 1 (修改笔记)**
  **ActionType**: `NoteSyncModify`
  **Response**: `{ "context": "sync_task_001", "data": { "path": "test.md", "content": "..." }, ... }`

- **明细消息 2 (删除笔记)**
  **ActionType**: `NoteSyncDelete`
  **Response**: `{ "context": "sync_task_001", "data": { "path": "old.md" }, ... }`

## 3. 响应消息结构 (Res)

所有 WebSocket 响应均遵循以下标准结构：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | int | 业务状态码 (200 为成功) |
| `status` | bool | 成功状态 |
| `message` | string | 状态描述 |
| `data` | any | 业务数据载体 |
| `vault` | string | 保险库名称 (透传) |
| `context` | string | **任务上下文标识 (透传)** |

## 4. 前端集成建议

1. **并行处理**: 由于统计消息 (End) 提前到达，前端可以先更新同步进度 UI，随后监听后续的明细推送并动态更新本地缓存。
2. **任务匹配**: 在 WebSocket 的全局消息监听器中，建议通过响应体中的 `context` 字段来匹配本次同步请求的回调逻辑或状态。
3. **计数校验**: 前端可以通过 `SyncEnd` 消息中的 `needXXXCount` 来验证后续是否收到了足额的详情推送。

## 5. 受影响的接口 Action

| 模块 | 同步请求 Action | 统计结束消息 Type | 明细推送消息 Type |
| :--- | :--- | :--- | :--- |
| **笔记** | `NoteSync` | `NoteSyncEnd` | `NoteSyncModify`, `NoteSyncDelete`, `NoteSyncMtime`, `NoteSyncNeedPush` |
| **文件夹** | `FolderSync` | `FolderSyncEnd` | `FolderSyncModify`, `FolderSyncDelete` |
| **设置** | `SettingSync` | `SettingSyncEnd` | `SettingSyncModify`, `SettingSyncDelete`, `SettingSyncMtime`, `SettingSyncNeedUpload` |
| **文件/附件** | `FileSync` | `FileSyncEnd` | `FileSyncUpdate`, `FileSyncDelete`, `FileSyncMtime`, `FileUpload` |

---
*注：请确保前端代码能够兼容处理同一 `context` 下接连收到的多条消息。*

## 独立云同步 REST MVP（实验中，协议 v2）

面向 Web、桌面和移动客户端的独立同步入口使用 `/api/sync/*`，与旧版 Obsidian WebSocket action 并行存在。`docs-module` 和 macOS 宿主默认读取本地 Markdown；云同步是 docs 能力中的一个可选同步功能，不决定其它文档功能是否可用。Web 和 macOS 使用同一套 docs UI；客户端开启云同步后再用当前用户令牌创建会话：

```http
POST /api/sync/sessions
Authorization: <token>
Content-Type: application/json

{"vault":"Personal","deviceId":"macbook-1","clientName":"Docs","clientType":"desktop","clientVersion":"0.1.0"}
```

会话成功后可调用：

- `GET /api/sync/sessions/{sessionId}/snapshot?limit=100` 获取 Markdown、附件、目录和配置的元数据快照；正文和二进制内容继续通过现有 `/api/note`、`/api/file` 及分片上传下载接口读取。
- `GET /api/sync/sessions/{sessionId}/changes?cursor=<v2 批次游标>&limit=100` 获取快照之后的最终状态差异。服务端持久化批次，`nextCursor` 只在当前页已返回后推进；扫描期间发生的变化会在后续批次补齐，游标过期返回 410 并要求重新快照。
- `POST /api/sync/sessions/{sessionId}/operations` 支持单项 Markdown 笔记、`.obsidian` 配置和目录创建。笔记更新必须携带 `version`、旧内容的 `baseContentHash` 和新内容的 `contentHash`，配置更新使用 `baseContentHash` SQL CAS；冲突返回 HTTP 409，客户端应重新读取并合并后重试。目录重命名继续使用既有目录接口。附件内容必须先走现有上传/分片接口，本接口不会伪造附件记录。
- `GET /api/sync/devices?vault=...` 查看当前用户的设备摘要，`PATCH /api/sync/devices/{deviceId}?vault=...` 重命名，`DELETE /api/sync/devices/{deviceId}?vault=...` 撤销设备。请求携带设备 `version`，撤销会使其会话失效但不会删除 Vault 内容。

游标是服务端持久化的 `v2:<batch-id>:<offset>` 批次游标，服务重启后仍可继续。重复提交必须携带同一个 `requestId` 和相同请求摘要，服务端返回同一结果；若写入结果不确定返回 409，客户端不得盲目重放。该入口当前仍为实验能力，独立 WebSocket 推送和跨文档原子事务尚未宣称上线。

独立 WebSocket 批次拉取入口为 `/api/sync/ws?client=desktop&clientName=...&clientVersion=...`，沿用现有授权握手。客户端发送 `CloudSyncPull|{"sessionId":"...","snapshot":true,"limit":100}` 获取快照，或发送 `CloudSyncPull|{"sessionId":"...","cursor":"v2:<batch-id>:100","limit":100}` 获取后续差异；服务端返回 `CloudSyncPage|<response>`。该通道只拉取持久化批次，不推送每次中间修改，旧 `/api/user/sync` action 不变。

## TypeScript 客户端

`docs-viewer/src/cloud-sync-client.ts` 提供 Web、桌面和移动端可复用的 `CloudSyncClient`：

```ts
const client = new CloudSyncClient(connection, 'Personal', 'desktop-01')
const session = await client.createSession('My Desktop', 'desktop', '2')
let page = await client.snapshot(session.sessionId)
while (page.hasMore) page = await client.snapshot(session.sessionId, page.nextCursor)
const socket = client.connectWebSocket()
const next = await socket.pull(session.sessionId, { cursor: page.nextCursor })
await client.uploadAttachment('images/logo.png', blob)
socket.close()
```

SDK 负责认证头、HTTP 错误、游标页、requestId 写入、附件上传/下载、目录和文件操作以及 WebSocket frame 解码；客户端仍需持久化 `sessionId`、`nextCursor` 和资源冲突处理状态。
