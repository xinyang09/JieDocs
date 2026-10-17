# 用户自定义模型 API

## 目标

让每个已登录用户在文档台设置自己的模型服务，而不要求平台固定依赖 Pi。首个可配置类型为 OpenAI 兼容 Chat Completions API，同时保留 Pi 作为默认的本地执行器。

## 范围

- 用户可以创建、读取摘要、更新、删除和测试自己的模型服务配置。
- 配置包含名称、类型、Base URL、API Key、默认模型和启用状态；当前协议为 OpenAI 兼容 Chat Completions，并保留 Ollama 兼容地址类型。
- API Key 只能由服务端使用配置目录独立的 `.ai.key`（可由 `FNS_AI_KEY_FILE` 指定）进行 AES-GCM 加密保存；任何响应、日志、审计和前端本地存储都不得返回明文。
- AI 执行根据用户选定的 provider profile 解析执行器，权限、上下文、引用、配额、审计、SSE 和 Proposal/CAS 继续由平台负责。
- Pi 继续作为兼容 provider；旧 `/pi-*` 路由保持弃用兼容。
- OpenAI 兼容执行器支持 JSON 和 SSE 响应，并通过一次 delta 事件兼容现有 SSE 客户端；服务端默认拒绝私有网络地址，需要管理员显式设置 `FNS_AI_ALLOW_PRIVATE_ENDPOINTS=true` 才允许本地 Ollama。

## 不在范围内

- 不允许浏览器直接携带用户 API Key 调用第三方服务。
- 不在本次改造中实现多文档原子 Proposal。
- 不改变文档权限和写入 CAS 语义。
- 不强制迁移已有 Pi 模型选择记录；旧选择仍可继续使用。

## 验收标准

1. 未配置自定义服务时，已有 Pi AI 流程保持可用。
2. 配置 OpenAI 兼容服务后，用户可以从 AI 模型列表选择该服务的默认模型并执行问答或 Proposal；未选择模型时按启用配置的名称/ID 稳定选择默认服务。
3. API Key 在数据库中为独立密钥保护的加密密文，GET、列表、错误和日志中只出现 `hasApiKey` 或掩码状态。
4. 用户只能读取和修改自己的配置；未登录请求被拒绝。
5. 自定义服务不可用时，返回稳定的 provider unavailable 错误，不影响笔记、同步和文件功能。
6. Go 测试覆盖密钥不回显、配置隔离、OpenAI 兼容响应解析和执行器选择；前端测试覆盖模型摘要读取和自定义模型选择。
