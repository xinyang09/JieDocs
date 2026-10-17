# FNS Docs macOS 客户端

这是 `docs-viewer` Web 客户端的 macOS 发布入口，把同一份 Web 构建产物放进应用包内，直接加载本地页面并通过 preload 访问 API，不维护另一套桌面 UI。

开发启动：

```bash
npm install
env -u ELECTRON_RUN_AS_NODE -u NODE_PATH \
  FNS_DESKTOP_BASE_URL=http://127.0.0.1:9000 npm run dev
```

打包 Apple Silicon：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_PATH npm run build:mac
```

不设置服务地址时，桌面端使用本地 Markdown API，并通过电脑本地智能体执行 AI；默认工作空间是当前空间根目录。当前空间根目录优先从 `FNS_LOCAL_VAULT`、`FNS_DESKTOP_WORKSPACE_ROOT` 或 `FNS_WORKSPACE_ROOT` 读取，否则从启动目录向上查找空间标记。Finder 直接启动时使用 `~/Documents/FastNoteSync`。用户可以点击“打开本地目录”或从“文件 → 选择本地工作空间…”切换到其它目录，切换会同时更新 Markdown 读取范围和本地智能体工作目录。

本地智能体默认使用 `pi`，可用 `FNS_LOCAL_AGENT` 或 `PI_BIN` 指定兼容的本地智能体命令；执行时固定使用当前工作空间作为 `cwd`、关闭工具和会话继承，并保留文档内容的不可信边界。云端模式使用 `FNS_DESKTOP_BASE_URL` 和 `FNS_DESKTOP_TOKEN`，不弹账号密码登录框。云同步仍然只是 docs 内的同步功能；桌面端和 Web 端使用同一套页面能力。

桌面端设置中的“智能体”会扫描 `PATH`、`FNS_LOCAL_AGENT`、`PI_BIN` 和 Mirasim 安装目录，显示已检测的 Pi、Claude Code、Codex、Kimi Code、Gemini CLI 等命令。当前内置执行适配器只支持 Pi JSON 协议；其它命令会显示为已检测，等对应适配器接入后才能选择。
