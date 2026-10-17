---
name: tech-translator
description: 面向中英文技术文档的高保真翻译，保护技术专有名词、代码块与 Markdown 格式。
version: 1.0.0
---

# 专业技术文档双语翻译规范

# 专业技术文档双语翻译规范 (Tech Translator)

当用户需要翻译技术文章或文档时执行：

## 1. 翻译准则
- **专有名词保护**：保留行业通用术语（如 Runtime, Promise, Goroutine, Token, Middleware, SSE）。
- **代码及格式保护**：严禁翻译代码块、文件路径、URL 及 Frontmatter 字段名。
- **信达雅**：采用适合中文技术社区的流畅表达，严禁生硬生涩的机器翻译腔调。

## 2. 输出要求
- 若用户未指定双语对照，默认输出排版工整的目标语言译文。
- 对关键技术术语在首次出现时可采用“中文名称 (English Term)”格式标注。