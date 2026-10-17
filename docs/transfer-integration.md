# Transfer 集成（平台插件）

这个平台增强插件把 Fast Note Sync 的单篇 Markdown 笔记发布给外部 [`sepao/transfer`](https://github.com/sepao/transfer) 项目，当前只支持手动、单向、create-only 发布。它以内嵌面板运行在统一文档工作台：打开 `/docs/`，选择左侧「平台增强」→「外部文档发布」。旧的 `/plugins/transfer/` 地址会自动跳转到该入口。

## 安全边界

- 页面直接填写飞书或 Notion 的真实配置，不需要填写环境变量名。
- 凭证通过认证 API 传输，并使用 AES-GCM 加密后保存到 `transfer_profiles` 表；数据库中不会保存明文。
- `GET /api/transfer/admin/profiles` 只返回 `credentialStatus`，不会返回 App Secret、Token 或 API Key。
- 编辑 Profile 时凭证不会回显；显示「已配置，留空保持原值」。
- 凭证只在执行 Live 发布时由服务端解密，并注入固定的子进程环境变量；不会写入 YAML、任务表、manifest、Python SQLite 映射或日志。
- 默认关闭 Transfer 运行时。运行时关闭时仍然可以在页面保存 Profile，开启并重启服务后才可以发布任务。
- 不把 `sepao/transfer` 源码复制进本仓库；通过 `project-path` 指向管理员准备好的 checkout。
- 服务重启不会自动重放 queued、running 或 live 任务。queued 任务标记为 `interrupted`，运行中的任务标记为 `uncertain`，需要人工检查外部状态。

## 1. 准备 Provider

先准备 `sepao/transfer` checkout，并按照它自己的文档安装依赖。Fast Note Sync 只负责调用本地 bridge，不会替你安装 Provider 依赖。

## 2. 服务端运行时配置

默认配置文件中的 `transfer` block 是关闭的。配置运行时路径：

```yaml
transfer:
    enabled: true
    python: python3
    bridge-root: /srv/fast-note-sync-service
    project-path: /srv/transfer
    state-dir: storage/transfer
    source-url: https://notes.example.com
    queue-capacity: 16
    timeout-seconds: 120
```

`source-url` 必须是稳定的 HTTP(S) 地址，不能带凭证、查询参数或 fragment。Profile 不需要写进 YAML；旧版 `transfer.profiles` 会在首次启动时迁移到 `transfer_profiles` 表，之后以工作台面板配置为准。

## 3. 页面直接配置

打开 `/docs/` →「平台增强」→「外部文档发布」→「Profiles 配置」。绑定 Profile ID、UID、Vault 和 Provider 后，填写对应 Provider 的真实配置：

### 飞书

- **App ID**：飞书应用的 App ID。
- **App Secret**：飞书应用密钥。
- **User Access Token**：可选，用户访问令牌。
- **Folder Token**：可选，目标文件夹 Token。

### Notion

- **API Key**：Notion integration secret。
- **Parent Page ID**：目标父页面 ID。

勾选「允许此 Profile 执行 Live 发布」后，服务端会校验该 Provider 的必填配置。飞书要求 App ID 和 App Secret；Notion 要求 API Key 和 Parent Page ID。可选字段留空即可。

新建 Profile 时填写真实值并保存。编辑已有 Profile 时不要粘贴旧值：已配置字段会显示状态，留空会保留原值；如果需要替换，只填写新的值。

页面保存的请求形态如下，值仅为示例占位符：

```json
{
  "id": "team-feishu",
  "uid": 1,
  "vault": "工作笔记",
  "provider": "feishu",
  "allowLive": true,
  "credentials": {
    "TRANSFER_FEISHU_APP_ID": "cli_example",
    "TRANSFER_FEISHU_APP_SECRET": "replace-with-your-secret"
  }
}
```

这些 `TRANSFER_*` 是服务端内部字段名，由页面自动选择；用户不需要填写或配置 `FNS_TRANSFER_*` 环境变量名。旧版 API 的 `env` 字段仍保留兼容读取，但新配置应使用 `credentials`。

## 4. 加密密钥备份

服务启动时会创建一个权限为 `0600` 的 Transfer 加密密钥文件：

- 设置 `FNS_TRANSFER_KEY_FILE` 时，使用该路径；
- 未设置时，使用配置文件所在目录下的 `.transfer.key`。

请把这个文件纳入安全备份，并限制只有服务进程用户可读。删除或丢失密钥文件后，已保存的 Provider 凭证无法解密；恢复原密钥文件后服务才能读取这些 Profile。密钥文件本身不要提交 Git 或写入镜像公开层。

## 5. 发布任务

在「发布笔记」中选择 Profile、Vault 和 Markdown 路径。默认是 Dry-run，不访问 Notion 或飞书；明确勾选 Live 后才会创建外部文档。当前不执行外部文档更新或删除：内容变化时默认返回冲突，使用 `force: true` 会创建新的外部文档。

客户端发布 API 仍然使用 `/api/transfer/jobs`；客户端不能选择外部目录、checkout、Python 可执行文件、环境变量名或提交正文：

```http
POST /api/transfer/jobs
Authorization: Bearer <token>
Content-Type: application/json

{"profile":"team-feishu","vault":"工作笔记","path":"docs/hello.md","live":false,"force":false}
```

任务表只保存 UID、Vault、路径、Provider、内容哈希、状态、外部 ID/URL、时间和脱敏错误信息，不保存正文或凭证。

## 6. 管理 API

接口仅允许 WebGUI 登录令牌访问，Profile 管理接口还要求管理员身份：

```http
GET    /api/transfer/plugin
GET    /api/transfer/admin/profiles
POST   /api/transfer/admin/profiles
PUT    /api/transfer/admin/profiles/<profile-id>
DELETE /api/transfer/admin/profiles/<profile-id>
```

管理列表返回类似以下状态，不返回真实凭证：

```json
{
  "id": "team-feishu",
  "provider": "feishu",
  "credentialStatus": {
    "TRANSFER_FEISHU_APP_ID": true,
    "TRANSFER_FEISHU_APP_SECRET": true,
    "TRANSFER_FEISHU_USER_ACCESS_TOKEN": false,
    "TRANSFER_FEISHU_FOLDER_TOKEN": true
  }
}
```

## 7. 命令行桥接与历史

服务端会启动固定的 `python -m integrations.transfer_bridge` 子进程，使用私有临时 manifest、固定工作目录、配置的 Provider Profile 和每任务超时。子进程不会继承未列入白名单的应用环境变量，也不会把凭证放进命令行参数。

查看指定 Profile 的 bridge 历史：

```bash
python3 -m integrations.transfer_bridge \
  --db storage/transfer/team-feishu/bridge.sqlite3 \
  --profile team-feishu \
  history --limit 20
```

复杂 Markdown（表格、Obsidian 双链、Callout、嵌入等）应先用 Dry-run 检查输入约束，再用小文档执行一次受控 Live 测试。
