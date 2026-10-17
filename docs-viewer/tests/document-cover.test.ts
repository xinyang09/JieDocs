import test from 'node:test'
import assert from 'node:assert/strict'
import { coverUploadPath, updateFrontmatterCover } from '../src/document-cover.ts'

test('adds a cover field without changing markdown body', () => {
  const source = '# 标题\n\n正文\n'
  assert.equal(updateFrontmatterCover(source, '标题-cover.webp'), '---\ncover: 标题-cover.webp\n---\n\n# 标题\n\n正文\n')
})

test('replaces and removes cover while preserving existing frontmatter and CRLF', () => {
  const source = '---\r\ntitle: 记录\r\ntags: [日记]\r\ncoverImage: old.jpg\r\n---\r\n\r\n# 标题\r\n'
  assert.equal(updateFrontmatterCover(source, 'new.png'), '---\r\ntitle: 记录\r\ntags: [日记]\r\ncover: new.png\r\n---\r\n\r\n# 标题\r\n')
  assert.equal(updateFrontmatterCover(source), '---\r\ntitle: 记录\r\ntags: [日记]\r\n---\r\n\r\n# 标题\r\n')
})

test('removing the only cover removes the empty frontmatter block', () => {
  assert.equal(updateFrontmatterCover('---\ncover: old.jpg\n---\n\n正文\n'), '\n正文\n')
})

test('removes the legacy image alias when clearing a cover', () => {
  assert.equal(updateFrontmatterCover('---\nimage: old.jpg\n---\n\n正文\n'), '\n正文\n')
})

test('uses the note folder and a stable, safe cover filename', () => {
  assert.equal(coverUploadPath('读书笔记/周末 计划.md', 'hero.PNG'), '读书笔记/周末-计划-cover.png')
})
