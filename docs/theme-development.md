# 自定义主题开发

WebGUI 提供主题工作室，用户可以在页面右下角打开它，导入、切换、导出和删除自定义主题。主题保存在当前浏览器的本地存储中，不会上传到服务端；因此同一主题需要在其他设备上重新导入。

## CSS 主题

创建一个 `.css` 文件即可直接覆盖 WebGUI 样式。颜色变量主题建议覆盖以下变量：

```css
html[data-color-scheme],
html.light[data-color-scheme],
html.dark[data-color-scheme] {
  --background: #101827;
  --foreground: #e5edf8;
  --primary: #7dd3fc;
  --primary-foreground: #082f49;
  --muted: #1e293b;
  --muted-foreground: #94a3b8;
  --border: #334155;
  --input: #1e293b;
  --ring: #7dd3fc;
}

body {
  font-family: "霞鹜文楷", sans-serif;
}
```

如果需要更深度的调整，可以覆盖按钮、卡片、编辑器等现有 DOM 样式。CSS 会在内置主题之后加载，主题作者可以使用 `html.dark` 和 `html.light` 为两种模式分别提供样式。

## JSON 主题

JSON 适合只定义颜色变量的主题。`name` 用于显示名称，`id` 可选且只能由字母、数字、下划线和短横线组成；`variables` 至少包含一个 CSS 自定义属性。

```json
{
  "id": "ocean-night",
  "name": "海夜",
  "variables": {
    "--background": "#101827",
    "--foreground": "#e5edf8",
    "--primary": "#7dd3fc",
    "--primary-foreground": "#082f49",
    "--muted": "#1e293b",
    "--muted-foreground": "#94a3b8",
    "--border": "#334155"
  }
}
```

导入后主题会立即启用，并在刷新页面后保持。每个文件最大 `256 KB`；CSS/JSON 内容由浏览器直接应用，请只导入自己信任的主题文件。
