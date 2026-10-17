import assert from 'node:assert/strict'
import test from 'node:test'
import { extractHeadings, slugify, getNodeText } from '../src/markdown-outline.ts'

test('extracts basic markdown headings levels 1 to 6', () => {
  const md = `
# 标题一
正文段落
## 标题二
### 标题三
#### 标题四
##### 标题五
###### 标题六
`
  const headings = extractHeadings(md)
  assert.equal(headings.length, 6)
  assert.deepEqual(headings.map((h) => ({ level: h.level, text: h.text, id: h.id })), [
    { level: 1, text: '标题一', id: '标题一' },
    { level: 2, text: '标题二', id: '标题二' },
    { level: 3, text: '标题三', id: '标题三' },
    { level: 4, text: '标题四', id: '标题四' },
    { level: 5, text: '标题五', id: '标题五' },
    { level: 6, text: '标题六', id: '标题六' },
  ])
})

test('ignores code comments inside fenced code blocks (backticks and tildes)', () => {
  const md = `
# 项目概述

\`\`\`python
# 快速上手
import fns

# 初始化客户端
client = fns.Client()
\`\`\`

## 部署说明

~~~bash
# 快速上手
curl -sSL http://127.0.0.1:9000 | bash
# 启动服务
./start.sh
~~~

### 结束语
`
  const headings = extractHeadings(md)
  assert.equal(headings.length, 3)
  assert.deepEqual(headings.map((h) => h.text), [
    '项目概述',
    '部署说明',
    '结束语',
  ])
})

test('ignores comments inside indented code blocks', () => {
  const md = `
# 快速上手指南

    # 4 空格缩进代码块中的注释
    const x = 1

\t# 制表符缩进代码块中的注释
\techo 123

## 下一步
`
  const headings = extractHeadings(md)
  assert.equal(headings.length, 2)
  assert.deepEqual(headings.map((h) => h.text), ['快速上手指南', '下一步'])
})

test('handles nested code fences of different lengths correctly', () => {
  const md = `
# 外层标题

\`\`\`\`markdown
这里是 markdown 示例代码块：
\`\`\`python
# 这是内部的 python 注释
def foo():
    pass
\`\`\`
\`\`\`\`

## 最终章节
`
  const headings = extractHeadings(md)
  assert.equal(headings.length, 2)
  assert.deepEqual(headings.map((h) => h.text), ['外层标题', '最终章节'])
})

test('ignores comments inside HTML comments and YAML frontmatter', () => {
  const md = `---
title: 测试页面
# frontmatter 中的注释
author: admin
---
<!--
# HTML 注释中的标题
-->

# 实际标题

<!-- # 单行 HTML 注释 -->

## 二级标题
`
  const headings = extractHeadings(md)
  assert.equal(headings.length, 2)
  assert.deepEqual(headings.map((h) => h.text), ['实际标题', '二级标题'])
})

test('strips formatting and trailing hashes correctly', () => {
  const md = `
# **粗体标题** 与 *斜体* 和 \`代码\`
## 规范标题 ##
### 学习 C#
#### 学习 C# ####
`
  const headings = extractHeadings(md)
  assert.equal(headings.length, 4)
  assert.equal(headings[0].text, '粗体标题 与 斜体 和 代码')
  assert.equal(headings[1].text, '规范标题')
  assert.equal(headings[2].text, '学习 C#')
  assert.equal(headings[3].text, '学习 C#')
})

test('getNodeText extracts text from nested elements', () => {
  assert.equal(getNodeText('纯文本'), '纯文本')
  assert.equal(getNodeText(['列表', 123]), '列表123')
  assert.equal(getNodeText({ props: { children: ['父级', { props: { children: '子级' } }] } }), '父级子级')
  assert.equal(getNodeText(null), '')
})
