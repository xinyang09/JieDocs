import assert from 'node:assert/strict'
import test from 'node:test'
import { appendMarkdownTask } from '../src/task-create.ts'
import {
  readTaskDates,
  toggleMarkdownTaskLine,
  withoutTaskCompletionDate,
  withTaskCompletionDate,
  withTaskCreationDate,
} from '../src/task-dates.ts'

const now = new Date(2026, 8, 10, 0, 30)

test('new task dates are persisted and survive reading the saved Markdown', () => {
  const content = appendMarkdownTask('# 旧笔记\n\n- [ ] 历史任务\n', '整理资料', now)
  const rawText = content.trimEnd().split('\n').at(-1)!.replace('- [ ] ', '')
  assert.deepEqual(readTaskDates(rawText, '工作/项目.md'), {
    text: '整理资料',
    createdDate: '2026-09-10',
    completedDate: undefined,
    dueDate: undefined,
  })
  assert.ok(content.includes('- [ ] 历史任务\n'))
})

test('uses the local calendar day even around midnight', () => {
  assert.equal(withTaskCreationDate('任务', now), '任务 ➕ 2026-09-10')
  assert.equal(withTaskCreationDate('任务', new Date(2026, 8, 10, 23, 30)), '任务 ➕ 2026-09-10')
})

test('creation dates never override due dates or dated document grouping', () => {
  assert.deepEqual(readTaskDates('发布 ➕ 2026-09-10 📅 2026-09-20'), {
    text: '发布 📅 2026-09-20',
    createdDate: '2026-09-10',
    completedDate: undefined,
    dueDate: '2026-09-20',
  })
  assert.equal(readTaskDates('任务 ➕ 2026-09-10', '日记/2026-09-15.md').dueDate, '2026-09-15')
})

test('does not invent creation dates for legacy tasks', () => {
  assert.equal(readTaskDates('历史任务', '2026-01-01.md').createdDate, undefined)
  assert.equal(readTaskDates('历史任务 ➕ 2026-02-30').createdDate, undefined)
  assert.equal(readTaskDates('历史任务 ➕ 2024-02-29').createdDate, '2024-02-29')
})

test('preserves explicit dates and adds no duplicate metadata', () => {
  const text = '历史任务 ➕ 2025-12-27 ⏫'
  assert.equal(withTaskCreationDate(text, now), text)
  assert.equal(readTaskDates('任务 ➕️ 2026-09-10').createdDate, '2026-09-10')
})

test('reads an explicit task time range without changing the task text', () => {
  assert.deepEqual(readTaskDates('评审文档 📅 2026-09-20 ⏰ 09:30-17:45'), {
    text: '评审文档 📅 2026-09-20',
    createdDate: undefined,
    completedDate: undefined,
    dueDate: '2026-09-20',
    startTime: '09:30',
    endTime: '17:45',
  })
  assert.deepEqual(readTaskDates('早会 ⏰️ 09:00'), {
    text: '早会',
    createdDate: undefined,
    completedDate: undefined,
    dueDate: undefined,
    startTime: '09:00',
  })
})

test('keeps only the start time when an explicit range ends too early', () => {
  assert.deepEqual(readTaskDates('值班 📅 2026-09-20 ⏰ 18:00-09:00'), {
    text: '值班 📅 2026-09-20',
    createdDate: undefined,
    completedDate: undefined,
    dueDate: '2026-09-20',
    startTime: '18:00',
  })
  assert.equal(readTaskDates('值班 ⏰ 24:00-25:00').text, '值班 ⏰ 24:00-25:00')
})

test('keeps priorities and completion changes independent of creation dates', () => {
  for (const priority of ['🔺', '⏫', '🔼', '🔽', '⏬', '🔻']) {
    const content = appendMarkdownTask('', `任务 ${priority}`, now)
    assert.ok(content.endsWith(`➕ 2026-09-10 ${priority}\n`))
    const completed = content.replace('[ ]', '[x]')
    assert.equal(readTaskDates(completed.slice(6).trim()).createdDate, '2026-09-10')
  }
})

test('records and reads task completion dates', () => {
  const completedText = withTaskCompletionDate('整理需求 ➕ 2026-09-08 ⏫', now)
  assert.equal(completedText, '整理需求 ➕ 2026-09-08 ✅ 2026-09-10 ⏫')

  const parsed = readTaskDates(completedText)
  assert.equal(parsed.createdDate, '2026-09-08')
  assert.equal(parsed.completedDate, '2026-09-10')
  assert.equal(parsed.dueDate, undefined)
})

test('updates existing completion date when marked completed again', () => {
  const updated = withTaskCompletionDate('整理需求 ✅ 2026-09-01 ⏫', now)
  assert.equal(updated, '整理需求 ✅ 2026-09-10 ⏫')
})

test('removes completion date when task is reopened', () => {
  const reopened = withoutTaskCompletionDate('整理需求 ➕ 2026-09-08 ✅ 2026-09-10 ⏫')
  assert.equal(reopened, '整理需求 ➕ 2026-09-08 ⏫')

  const reopenedSimple = withoutTaskCompletionDate('简单任务 ✅ 2026-09-10')
  assert.equal(reopenedSimple, '简单任务')
})

test('toggleMarkdownTaskLine marks task completed with date and preserves indentation and priority', () => {
  const original = '  - [ ] 撰写报告 ➕ 2026-09-08 🔺'
  const completedLine = toggleMarkdownTaskLine(original, true, now)
  assert.equal(completedLine, '  - [x] 撰写报告 ➕ 2026-09-08 ✅ 2026-09-10 🔺')

  const reopenedLine = toggleMarkdownTaskLine(completedLine, false)
  assert.equal(reopenedLine, '  - [ ] 撰写报告 ➕ 2026-09-08 🔺')
})

test('toggleMarkdownTaskLine supports other bullet formats and non-task passthrough', () => {
  assert.equal(toggleMarkdownTaskLine('* [ ] 任务', true, now), '* [x] 任务 ✅ 2026-09-10')
  assert.equal(toggleMarkdownTaskLine('+ [X] 任务 ✅ 2026-09-09', false), '+ [ ] 任务')
  assert.equal(toggleMarkdownTaskLine('## 不是任务', true, now), '## 不是任务')
})
