# Fast Note Sync 浏览器剪藏插件

这是一个无需构建步骤的 Chrome/Edge Manifest V3 扩展，支持：

- 工具栏按钮打开剪藏面板；
- 右键菜单“剪藏到 Fast Note Sync”；
- `Alt+Shift+S` 快捷键剪藏当前页面；
- 优先保存选中文本，否则提取 `article`、`main` 或页面正文；
- 通过现有 `POST /api/note` 接口写入 Markdown 笔记；
- 通过现有 `GET /api/vault` 接口加载 Vault 列表。

## 使用

1. 打开扩展设置，填写服务地址（例如 `https://notes.example.com`）和登录后获得的 Authorization Token。
2. 选择默认 Vault。
3. 在 Chrome/Edge 打开 `chrome://extensions` / `edge://extensions`，开启开发者模式，加载本目录。
4. 在任意网页点击扩展图标，或右键选择剪藏。

插件只使用现有 API，不会保存用户名或密码；Token 使用浏览器 `storage.sync` 保存。服务端需要允许扩展来源的 CORS 请求；本服务已有 `Authorization`、`Content-Type` 等请求头支持。

## 从后台签发剪藏 Token

登录后台后，可以在「令牌管理」中点击创建令牌；也可以调用专用接口快速签发最小权限 Token：

```bash
curl -X POST "https://你的服务地址/api/token/browser-extension" \
  -H "Authorization: Bearer 你的后台登录 Token" \
  -H "X-Client: webgui" \
  -H "Content-Type: application/json" \
  -d '{"expiredDays":365,"vaults":"你的 Vault"}'
```

响应中的 `data.token` 只返回一次，将它复制到插件设置中的 Authorization Token。请求中的 `vaults` 可选；不填写时不限制 Vault。
