import assert from 'node:assert/strict'
import test from 'node:test'
import { appendMarkdownTask, nextTaskDocumentPath } from '../src/task-create.ts'

const createdAt = new Date(2026, 8, 10, 0, 30)

test('creates one incomplete task and rejects empty input', () => {
  assert.equal(appendMarkdownTask('', '  整理会议记录  ', createdAt), '- [ ] 整理会议记录 ➕ 2026-09-10\n')
  assert.throws(() => appendMarkdownTask('原文', '  '), /请输入/)
  assert.equal(appendMarkdownTask('', '整理\n记录', createdAt), '- [ ] 整理 记录 ➕ 2026-09-10\n')
})

test('preserves the complete original document, including whitespace and CRLF', () => {
  for (const original of ['# 笔记', '# 笔记\n', '# 笔记\n\n', '# 笔记  \n\n\n', '# 笔记\r\n\r\n']) {
    const result = appendMarkdownTask(original, '添加任务 ⏫', createdAt)
    assert.ok(result.startsWith(original))
    assert.equal(result.match(/- \[ \] 添加任务 ➕ 2026-09-10 ⏫/g)?.length, 1)
    if (original.includes('\r\n')) assert.ok(result.endsWith('- [ ] 添加任务 ➕ 2026-09-10 ⏫\r\n'))
  }
})

test('keeps existing completion, priorities and source links unchanged', () => {
  const original = '- [x] 完成事项 🔽\n- [ ] [相关笔记](资料.md) ⏫\n'
  assert.equal(appendMarkdownTask(original, '下一步', createdAt), `${original}\n- [ ] 下一步 ➕ 2026-09-10\n`)
})

test('persists an explicit date and time range before a priority marker', () => {
  const result = appendMarkdownTask('', '准备发布 ⏫', createdAt, {
    dueDate: '2026-09-20',
    startTime: '09:30',
    endTime: '17:45',
  })
  assert.equal(result, '- [ ] 准备发布 ➕ 2026-09-10 📅 2026-09-20 ⏰ 09:30-17:45 ⏫\n')
})

test('persists a start time without inventing a due date or end time', () => {
  const result = appendMarkdownTask('', '电话沟通', createdAt, { startTime: '09:00' })
  assert.equal(result, '- [ ] 电话沟通 ➕ 2026-09-10 ⏰ 09:00\n')
})

test('does not append a task into an unclosed fenced code block', () => {
  assert.throws(() => appendMarkdownTask('```bash\necho hello', '任务'), /未闭合/)
  assert.throws(() => appendMarkdownTask('~~~~\n~~~\n', '任务'), /未闭合/)
  assert.throws(() => appendMarkdownTask('```\n~~~\n', '任务'), /未闭合/)
  assert.ok(appendMarkdownTask('````\n```\n````\n', '任务', createdAt).endsWith('- [ ] 任务 ➕ 2026-09-10\n'))
  assert.ok(appendMarkdownTask('~~~text\n示例\n~~~\n', '任务', createdAt).endsWith('- [ ] 任务 ➕ 2026-09-10\n'))
})

test('creates new notes in the selected folder without collisions', () => {
  assert.equal(nextTaskDocumentPath('', []), '任务.md')
  assert.equal(nextTaskDocumentPath('/工作/项目/', []), '工作/项目/任务.md')
  assert.equal(nextTaskDocumentPath('工作', ['工作/任务.md', '工作/任务 1.md']), '工作/任务 2.md')
  assert.equal(nextTaskDocumentPath('', ['其他/任务.md']), '任务.md')
})
