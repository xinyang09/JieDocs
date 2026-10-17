# Transfer Publisher Platform Plugin

这是 Fast Note Sync 的平台增强插件，负责把 Markdown 笔记通过 `sepao/transfer` create-only 发布到飞书或 Notion。它以内嵌面板的形式运行在统一文档工作台中，不创建独立插件页面。

- 工作台入口：`/docs/` → 左侧「平台增强」→「外部文档发布」
- 插件清单：`/plugins/transfer/manifest.json`
- Profile 配置保存在服务端 `transfer_profiles` 表
- 页面直接填写飞书 / Notion 真实配置，不填写环境变量名
- Provider 凭证使用 AES-GCM 加密保存，管理列表只显示「已配置」状态
- 编辑时密钥不会回显，留空表示保留原值
- 旧版 `transfer.profiles` YAML 会在首次启动时迁移到数据库

服务端仍需要在 `config.yaml` 中设置 Transfer 运行时和 `project-path`。运行时关闭时也可以先在页面保存 Profile；开启 `transfer.enabled` 并重启后才可以执行发布。加密密钥文件默认为配置文件目录下的 `.transfer.key`，也可以通过 `FNS_TRANSFER_KEY_FILE` 指定，必须纳入安全备份。

具体配置、API 和 Provider 要求见 [`docs/transfer-integration.md`](../../docs/transfer-integration.md)。
