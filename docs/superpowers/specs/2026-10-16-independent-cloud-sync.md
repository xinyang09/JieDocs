# 独立云同步 MVP 规格

## 状态

实验原型修正中（2026-10-17）。用户已确认 Web、API、桌面和移动客户端，以及 Markdown、附件、目录和配置范围。`docs-module` 负责本地 Markdown 文档，云同步是其可选能力；Web 只有服务端能力开关开启后才访问远程 API。第一轮编译和既有测试不代表独立同步完成验收。

## 目标

在保留现有 Obsidian/FNS WebSocket 协议兼容性的前提下，为独立 `docs-module`、Web、API 和后续桌面/移动客户端提供一套与 Obsidian 插件解耦的云同步协议。macOS 客户端默认读取本地 Markdown；用户显式开启云同步后才可以登录、选择 Vault、注册设备、获取初始快照、按游标读取变更、提交带 CAS 校验的单项写入。Web 端先检查服务端能力门禁，未开启时不读取远程文档 API。

## 范围

- 数据：Markdown 笔记、附件文件、目录和 `.obsidian` 配置。
- 认证：复用现有用户认证、令牌撤销和 Vault 权限；新接口不接受客户端上下文作为权限证明。
- 一致性：每次写入都携带当前 `version` 与 `contentHash`（文件同时携带 `pathHash`），服务端冲突时返回当前版本和哈希，不静默覆盖。
- 增量：SyncLog 是异步且允许丢弃的审计日志，不用于同步游标。服务端持久化会话元数据快照和不可变差异批次；游标定位批次与偏移，扫描中发生的变化在下次对比中补齐。删除由快照差异识别，包括已物理删除的资源；重命名体现为旧路径删除与新路径写入。过期返回 `cursor_expired`，客户端重新快照。该协议保证最终状态收敛，不提供每次中间修改的事件回放。
- 实时：新增同步 WebSocket 仅推送已提交的资源变更；旧 `/api/user/sync` 和旧 action 保持行为不变。
- 设备：每个用户的设备 ID 在服务端按 UID 隔离，支持列出、重命名和撤销；撤销后新请求和实时连接都必须失效。

## 接口草案

### 会话

`POST /api/sync/sessions`

```json
{"vault":"Personal","deviceId":"macbook-1","clientName":"Docs","clientType":"web","clientVersion":"0.1.0"}
```

响应返回 `sessionId`、`deviceId`、`vault`、`cursor` 和 `snapshotRequired`。服务端校验 Vault 访问权并创建或更新当前 UID 的设备记录。

`DELETE /api/sync/sessions/{sessionId}` 只关闭会话，不删除 Vault 内容。

### 快照和增量

`GET /api/sync/sessions/{sessionId}/snapshot?cursor=&limit=` 返回持久化批次中的稳定排序资源清单和内容版本。附件内容继续使用现有文件下载/分片接口。

`GET /api/sync/sessions/{sessionId}/changes?cursor=v2:<batch-id>:<offset>&limit=` 返回：

```json
{"cursor":"42","nextCursor":"47","hasMore":false,"changes":[{"kind":"note","action":"modify","path":"a.md","version":3,"contentHash":"..."}]}
```

删除事件保留路径和哈希，资源不存在时不能重新读取出内容；每条响应都带 `vault`、`deviceId` 和游标。

### 单项提交

`POST /api/sync/sessions/{sessionId}/operations`

```json
{"kind":"note","action":"upsert","path":"a.md","content":"...","version":3,"baseContentHash":"...","contentHash":"...","pathHash":"..."}
```

当前只接受单项 Markdown 笔记创建/更新。成功返回新版本、哈希和结果；CAS 失败返回 `409` 与 `conflict` 数据，包含服务端当前版本/哈希和可重新读取的资源标识。更新笔记时 `baseContentHash` 必须是客户端读取到的旧哈希，`contentHash` 是新内容哈希。附件必须先通过现有上传/分片接口落盘，不能只提交附件元数据。

### 独立 WebSocket 批次拉取

`GET /api/sync/ws?client=desktop&clientName=...&clientVersion=...` 完成现有认证握手后，客户端发送 `CloudSyncPull` 请求快照或差异页，服务端返回 `CloudSyncPage`。该通道只拉取持久化批次，不回放每次中间修改；旧 `/api/user/sync` action 保持兼容。

### 设备管理

`GET /api/sync/devices`、`PATCH /api/sync/devices/{deviceId}`、`DELETE /api/sync/devices/{deviceId}`。响应只返回设备摘要和最后访问时间，不返回令牌明文。

## 失败、冲突和回滚

- 未登录、Vault 不存在、Vault 无权限和设备已撤销分别返回现有认证/权限错误码或稳定的 `sync_*` 错误码。
- 游标格式错误或已过期返回 `cursor_expired`，客户端丢弃本地游标并重新请求快照。
- CAS 冲突保留服务端内容，返回 409；客户端可重新读取、合并后再次提交。
- 同一 `requestId` 的重复提交必须幂等；服务端不能因网络重试重复写入历史或文件。
- 已成功写入的单项操作可以沿用现有历史/回收站恢复；会话删除和设备撤销不删除 Vault 内容。
- 当前不承诺多文档原子事务、跨 Vault 事务、端到端加密和计费配额。

## 验证要求

- 服务层覆盖设备隔离、游标排序/过期、单项 CAS 成功/冲突、重复 requestId 幂等和撤销后的拒绝。
- 路由层覆盖认证、Vault 权限、错误码、响应不泄露令牌和 WebSocket 断线重连游标。
- `docs/SyncProtocol.md` 增加新协议；`PRODUCT.md` 与 `docs-viewer/PRODUCT.md` 只描述已验证行为，明确旧协议兼容和当前限制。
- 更新平台《平台功能记录》时标为“实验中/已验证”，只有完整端到端测试通过后才能改为“已上线”。
