# 用户自定义模型 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个用户提供可持久化的 OpenAI 兼容模型 API 配置，同时保留 Pi 作为可选执行器。

**Architecture:** 平台继续负责认证、Vault 上下文、引用、配额、审计、SSE 和 Proposal/CAS。新增用户级 provider 配置存储和执行器工厂；Pi 与 OpenAI 兼容 API 都实现统一的生成接口，浏览器只传 provider profile ID 与模型 ID，不接触密钥。

**Tech Stack:** Go、Gin、GORM、SQLite/现有数据库、AES-GCM、React、TypeScript、Vite。

**Spec:** `docs/superpowers/specs/2026-10-07-custom-model-api.md`

## Global Constraints

- API Key 只能服务端加密保存，任何接口响应、日志和前端持久化都不得包含明文。
- 用户配置必须按 UID 隔离，并复用现有认证和 AI 权限检查。
- 保留 `PiExecutor` 的兼容调用和旧 `/pi-*` 路由。
- 不改变 Proposal、版本/hash CAS 和引用服务端重读行为。
- 不执行会覆盖工作区既有未提交改动的 Git 操作。

### Task 1: Provider 配置模型和加密存储

**Files:**
- Create: `internal/model/ai_provider.go`
- Create: `internal/ai/provider_store.go`
- Create: `internal/ai/provider_store_test.go`
- Modify: `internal/app/services.go`
- Modify: `internal/model/model.go`

- [x] 定义按 UID 隔离的 provider 配置，存储 type、name、base URL、默认模型、enabled 和 API Key 密文。
- [x] 使用配置目录独立的 `.ai.key`（可用 `FNS_AI_KEY_FILE` 指定）保护 AES-GCM 密钥，响应模型只返回 `hasApiKey`。
- [x] 写测试覆盖加密密文不含明文、用户隔离、空 API Key 更新保留旧密钥和并发版本冲突。
- [x] 注册 AutoMigrate/版本迁移并将 store 注入 AI service。

### Task 2: 通用执行器和 OpenAI 兼容适配器

**Files:**
- Create: `internal/ai/openai_executor.go`
- Create: `internal/ai/openai_executor_test.go`
- Modify: `internal/ai/pi_executor.go`
- Modify: `internal/ai/contract.go`

- [x] 保留 `PiExecutor` 统一执行器接口，新增 OpenAI 兼容执行器。
- [x] 实现 OpenAI 兼容 `/chat/completions` 请求、认证、超时、错误映射和 JSON/SSE 响应解析。
- [x] 支持一次 delta 回调，让现有 SSE 客户端无需改变协议。
- [x] 对 Base URL、模型名和响应大小做限制，默认拒绝私有网络地址并禁止重定向。

### Task 3: AI service provider 解析和 API 路由

**Files:**
- Modify: `internal/service/ai_service.go`
- Modify: `internal/routers/api_router/handler_ai.go`
- Modify: `internal/routers/router_api.go`
- Create: `internal/routers/api_router/handler_ai_provider_test.go`

- [x] 增加按 UID 创建执行器的 resolver；无自定义配置时继续使用 Pi。
- [x] 新增 `GET/POST/PUT/DELETE /api/ai/providers` 和 `POST /api/ai/providers/:id/test`。
- [x] 新增摘要模型列表，响应只包含 profile ID、名称、模型 ID、启用状态和 `hasApiKey`。
- [x] 保持 `/api/ai/execute` 的权限、引用、配额、审计、Proposal/CAS 和错误语义。
- [x] 测试认证、用户隔离、密钥不回显、配置保存和执行器选择。

### Task 4: 前端设置和模型选择

**Files:**
- Modify: `docs-viewer/src/api.ts`
- Modify: `docs-viewer/src/ai-chat.ts`
- Modify: `docs-viewer/src/AiChatWorkspace.tsx`
- Modify: `docs-viewer/src/App.tsx`
- Modify: `docs-viewer/src/styles.css`
- Modify: `docs-viewer/src/ai-chat.css`
- Test: `docs-viewer/tests/ai-chat.test.ts`

- [x] 在系统设置新增 AI 模型服务面板，支持添加、编辑、删除、启用和测试连接。
- [x] 前端只保存 profile ID 和模型摘要，API Key 不写入 localStorage 或对话历史。
- [x] 将模型选择器改为读取 provider profile 摘要，同时兼容已有 Pi 模型记录。
- [x] 覆盖 AI 对话和选区助手两个入口。
- [x] 增加客户端测试，验证配置响应不含密钥和旧模型记录可继续读取。

### Task 5: 文档和验证

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-10-07-notion-style-ai.md`
- Modify: `docs/README.zh-CN.md`
- Modify: platform Page `平台功能记录`

- [x] 记录 provider 配置、密钥边界、Pi 兼容状态和失败行为。
- [x] 运行 Go 全量测试、AI race 测试、Node/server 测试和前端构建。
- [x] 在平台功能页面新增“用户自定义模型 API”复选框状态。
