import assert from 'node:assert/strict'
import test from 'node:test'
import { searchTaskDocuments, taskDocumentPickerPosition } from '../src/task-document-picker.ts'

test('opens below the input when space is available, independent of dialog bottom', () => {
  const result = taskDocumentPickerPosition({ top: 590, bottom: 628, left: 330, width: 490 }, { width: 1158, height: 1043 })
  assert.deepEqual(result, { top: 634, left: 330, width: 490, maxHeight: 286 })
})

test('opens above the input on a short viewport', () => {
  const result = taskDocumentPickerPosition({ top: 430, bottom: 468, left: 50, width: 480 }, { width: 600, height: 600 })
  assert.equal(result.top + result.maxHeight, 424)
  assert.equal(result.maxHeight, 286)
})

test('keeps the menu within narrow and very short viewports', () => {
  const result = taskDocumentPickerPosition({ top: 100, bottom: 138, left: 280, width: 490 }, { width: 320, height: 240 })
  assert.equal(result.width, 296)
  assert.ok(result.left >= 12)
  assert.ok(result.left + result.width <= 308)
  assert.ok(result.top >= 12)
  assert.ok(result.top + result.maxHeight <= 228)
  assert.ok(result.maxHeight < 140)
})

test('matches titles and folder paths without modifying the source list', () => {
  const paths = ['工作/项目周报.md', '个人/项目周报.md', 'Docs/Setup.md']
  assert.deepEqual(searchTaskDocuments(paths, ' 项目周报 '), { paths: paths.slice(0, 2), total: 2 })
  assert.deepEqual(searchTaskDocuments(paths, '工作/'), { paths: paths.slice(0, 1), total: 1 })
  assert.deepEqual(searchTaskDocuments(paths, 'setup'), { paths: paths.slice(2), total: 1 })
  assert.equal(paths.length, 3)
})

test('reports the match count instead of the whole vault count', () => {
  const paths = Array.from({ length: 1168 }, (_, i) => `资料/笔记-${i}.md`)
  assert.equal(searchTaskDocuments(paths, '').paths.length, 100)
  assert.equal(searchTaskDocuments(paths, '').total, 1168)
  assert.deepEqual(searchTaskDocuments(paths, '笔记-1167.md'), { paths: [paths[1167]], total: 1 })
  assert.deepEqual(searchTaskDocuments(paths, '不存在的文档'), { paths: [], total: 0 })
})
