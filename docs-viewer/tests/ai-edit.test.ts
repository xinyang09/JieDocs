import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDocumentInstruction, cleanMarkdownText, isDocumentEditIntent, parseDocumentCreateIntent, parseDocumentDeleteIntent, prepareDocumentEdit, recombineDocument, splitFrontmatter } from '../src/ai-edit.ts'

test('cleans a complete markdown wrapper without touching inner code fences', () => {
  const wrapped = '```markdown\n# 标题\n\n```bash\necho ok\n```\n```\n'
  assert.equal(cleanMarkdownText(wrapped), '# 标题\n\n```bash\necho ok\n```')
})

test('keeps a real code fence when it is not an outer markdown wrapper', () => {
  const code = '# 示例\n\n```bash\necho ok\n```\n'
  assert.equal(cleanMarkdownText(code), code)
})

test('preserves frontmatter while rebuilding the edited body', () => {
  const original = '---\ntitle: Demo\ntags: [one]\n---\n\n# 旧标题\n正文\n'
  const result = prepareDocumentEdit(original, '# 新标题\n正文')
  assert.equal(result.status, 'changed')
  assert.equal(result.content, '---\ntitle: Demo\ntags: [one]\n---\n\n# 新标题\n正文')
  assert.deepEqual(splitFrontmatter(result.content), {
    frontmatter: '---\ntitle: Demo\ntags: [one]\n---\n\n',
    body: '# 新标题\n正文',
  })
  assert.equal(recombineDocument('---\ntitle: Demo\n---', '# 标题'), '---\ntitle: Demo\n---\n\n# 标题')
})

test('recognizes meaningful edit instructions but not questions', () => {
  assert.equal(isDocumentEditIntent('怎么修改标题？'), false)
  assert.equal(isDocumentEditIntent('把标题改成产品方案'), true)
  assert.equal(isDocumentEditIntent('总结要点'), false)
})

test('does not propose a write when the generated document is unchanged or empty', () => {
  const original = '---\ntitle: Demo\n---\n\n# 标题\n正文\n'
  assert.deepEqual(prepareDocumentEdit(original, '# 标题\n正文\n'), { status: 'unchanged', content: original })
  assert.deepEqual(prepareDocumentEdit(original, '```markdown\n# 标题\n正文\n```'), { status: 'unchanged', content: original })
  assert.deepEqual(prepareDocumentEdit(original, '```markdown\n\n```'), { status: 'empty', content: original })
})

test('applies an append-line instruction without rewriting the existing document', () => {
  const original = '---\ntitle: Demo\n---\n\n# 标题\n原有内容\n'
  const result = applyDocumentInstruction(original, '在最后增加一行 123')
  assert.deepEqual(result, { status: 'changed', content: original + '123\n', summary: '已在文档末尾新增：123' })
})

test('applies a title change while preserving the rest of the document', () => {
  const original = '# 旧标题\n\n正文\n```bash\necho ok\n```\n'
  const result = applyDocumentInstruction(original, '把标题改成新标题')
  assert.equal(result.status, 'changed')
  if (result.status === 'changed') assert.equal(result.content, '# 新标题\n\n正文\n```bash\necho ok\n```\n')
})

test('parses explicit article creation with an optional body', () => {
  assert.deepEqual(parseDocumentCreateIntent('创建文章 项目复盘，内容是 # 项目复盘\n\n结论'), {
    path: '项目复盘.md',
    content: '# 项目复盘\n\n结论',
  })
  assert.deepEqual(parseDocumentCreateIntent('新建文档 `docs/guide.md`'), { path: 'docs/guide.md' })
})

test('parses current and named article deletion conservatively', () => {
  assert.deepEqual(parseDocumentDeleteIntent('删除当前文章'), { path: '' })
  assert.deepEqual(parseDocumentDeleteIntent('请删除文章 项目复盘.md'), { path: '项目复盘.md' })
  assert.equal(parseDocumentDeleteIntent('删除文章中的一行标题'), null)
  assert.equal(parseDocumentDeleteIntent('删除这个'), null)
})

test('accepts natural-language article creation verbs', () => {
  assert.deepEqual(parseDocumentCreateIntent('撰写文章 API 使用指南'), { path: 'API 使用指南.md' })
  assert.deepEqual(parseDocumentCreateIntent('生成一篇文章 部署手册'), { path: '部署手册.md' })
})
