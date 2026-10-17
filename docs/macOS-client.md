# macOS 客户端

macOS 客户端是 `desktop-client/` 对现有 `docs-viewer/` Web 客户端的桌面打包。它把同一份 Web 构建产物放进应用包内，通过 preload 桥接访问 FNS API；文档台、搜索、任务、预览、AI、设置和同步设备等能力共用同一套页面、路由和接口，不再把远程 `/docs/` 页面嵌进窗口。

交互方向参考 [Flowix](https://github.com/text2future/flowix)：桌面窗口优先承载本地 Markdown / 知识库工作台、目录浏览、全文搜索、附件和配置入口。当前桌面壳使用 Electron；`docs-module/` 是独立的本地 Markdown 核心，负责后续接入本地 Vault 读写。云同步只是 docs 中的一个可选功能，服务端的 `app.cloud-sync-enabled` 只控制同步 session、device、batch 和同步 WebSocket 接口，不会关闭普通 docs API 或 Web 页面。

## 启动 macOS 桌面客户端

先启动服务端（默认地址为 `http://127.0.0.1:9000`），然后运行：

```bash
cd desktop-client
npm install
env -u ELECTRON_RUN_AS_NODE -u NODE_PATH \
  FNS_DOCS_URL=http://127.0.0.1:9000/docs/ npm run dev
```

`FNS_DOCS_URL` 或 `FNS_DESKTOP_BASE_URL` 指向 FNS API 服务地址即可，例如 `http://127.0.0.1:9000`；桌面端的页面始终从应用包内加载，API 地址由 preload 注入。

## 构建安装包

Apple Silicon：

```bash
cd desktop-client
env -u ELECTRON_RUN_AS_NODE -u NODE_PATH npm run build:mac
```

产物会写入 `desktop-client/dist/`，包含 `.dmg` 和 `.zip`。当前构建目标为 macOS arm64；Intel 构建需要在 `package.json` 的 electron-builder target 中增加对应架构。

## 本地 Markdown 和云同步边界

- `docs-module/` 提供独立的本地 Markdown 文档核心；桌面端本地模式以当前空间根目录作为默认工作空间，并使用电脑本地智能体执行 AI，用户也可以点击“打开本地目录”或使用“文件 → 选择本地工作空间…”切换其它 Markdown 文件夹后读取并写回。
- 设置 `FNS_DESKTOP_BASE_URL` 后，桌面端连接云端 FNS API；云同步用于把本地 Vault 同步到云端，以及让其它开启云同步的客户端读取同一云端 Vault。关闭云同步时，本地 Markdown 能力继续可用。
- Markdown、附件、目录和配置的同步接口使用服务端 CAS 校验；冲突返回可处理结果，不静默覆盖内容。

## 既有客户端接入

此外，macOS 用户仍可使用：

- 在 macOS 版 Obsidian 中安装 [Obsidian Fast Note Sync Plugin](https://github.com/haierkeys/obsidian-fast-note-sync)。
- 使用基于 FNS WebSocket 协议的 [go-fast-note-sync](https://github.com/erichll/go-fast-note-sync) 后台同步程序。

## 服务端在 macOS 上运行

发布包按 CPU 架构区分：

- Apple Silicon：`fast-note-sync-service-<version>-darwin-arm64.tar.gz`
- Intel：`fast-note-sync-service-<version>-darwin-amd64.tar.gz`

从源码构建两个 macOS 架构：

```bash
make build-macos
```

产物会写入 `build/darwin_arm64/` 和 `build/darwin_amd64/`。

也可以使用仓库中的安装脚本。脚本会根据 `uname` 选择 Darwin 架构，并创建 Launchd 服务：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/haierkeys/fast-note-sync-service/master/scripts/quest_install.sh)
```

本地开发启动可以使用仓库根目录的 `start.sh`。脚本会按自身所在目录寻找二进制和 `config/config.yaml`，也支持通过 `FNS_BIN`、`FNS_CONFIG`、`FNS_LOG` 覆盖路径，因此不依赖某个用户的 checkout 路径。

## 旧 WebSocket 客户端的连接要求

客户端使用 `GET /api/user/sync` 建立 WebSocket 连接，并在 URL 或请求头中声明客户端类型。客户端类型必须和 Token scope 的 `c:` 匹配；例如 `GoFastNoteSync` 客户端应使用包含 `p:ws c:GoFastNoteSync f:*` 的 Token。

连接后按顺序发送：

```text
Authorization|<token>
ClientInfo|{"name":"MacBook","version":"1.0.0","type":"GoFastNoteSync","isDesktop":true,"isMacOS":true,"offlineSyncStrategy":"newTimeMerge"}
```

`ClientInfo` 的 `isMacOS` 只用于设备信息记录和展示，不会改变笔记、文件夹、附件或配置同步接口。客户端仍需实现 FNS WebSocket 协议中的 `NoteSync`、`FolderSync`、`FileSync` 和 `SettingSync` 等动作，完整字段见 [WebSocket API](ws_api.md)。
