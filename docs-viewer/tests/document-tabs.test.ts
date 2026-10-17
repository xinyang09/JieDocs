import assert from 'node:assert/strict'
import test from 'node:test'
import { makeDocumentTabKey, readDocumentTabs, restoredActiveTab, saveDocumentTabs } from '../src/document-tabs.ts'

const tabs = [
  { key: makeDocumentTabKey('notes', 'note', 'first.md'), vault: 'notes', kind: 'note' as const, path: 'first.md', title: 'First' },
  { key: makeDocumentTabKey('notes', 'file', 'assets/image.png'), vault: 'notes', kind: 'file' as const, path: 'assets/image.png', title: 'Image' },
  { key: makeDocumentTabKey('notes', 'note', 'folder/second.md'), vault: 'notes', kind: 'note' as const, path: 'folder/second.md', title: 'Second' },
]

test('refresh restores every tab in order and keeps the selected tab', () => {
  const saved = JSON.stringify({ openTabs: saveDocumentTabs(tabs), activeTabKey: tabs[1].key })
  const workspace = JSON.parse(saved)
  const restored = readDocumentTabs(workspace.openTabs)!
  assert.deepEqual(restored.map((tab) => tab.path), tabs.map((tab) => tab.path))
  assert.equal(restoredActiveTab(restored, workspace.activeTabKey)?.key, tabs[1].key)
})

test('closing tabs survives refresh, including closing the final tab', () => {
  const remaining = tabs.filter((tab) => tab.key !== tabs[1].key)
  const restored = readDocumentTabs(JSON.parse(JSON.stringify(saveDocumentTabs(remaining))))!
  assert.equal(restored.length, 2)
  assert.equal(restoredActiveTab(restored, tabs[1].key)?.key, tabs[0].key)
  assert.deepEqual(readDocumentTabs([]), [])
  assert.equal(restoredActiveTab([]), undefined)
})

test('legacy workspaces are distinguished from intentionally empty tab lists', () => {
  assert.equal(readDocumentTabs(undefined), undefined)
  assert.equal(readDocumentTabs(null), undefined)
  assert.equal(readDocumentTabs({}), undefined)
})

test('invalid entries are ignored and duplicate keys are reconstructed safely', () => {
  const restored = readDocumentTabs([null, {}, { ...tabs[0], kind: 'invalid' }, { ...tabs[0], key: 'wrong' }, tabs[0], tabs[2]])!
  assert.deepEqual(restored.map((tab) => tab.key), [tabs[0].key, tabs[2].key])
})

test('persistence stores references only, not note bodies or skill content', () => {
  const saved = saveDocumentTabs([{ ...tabs[0], note: { content: 'private content' } }, { ...tabs[2], kind: 'skill' as const, skill: { id: 'skill-1', content: 'skill body' } }] as any)
  const serialized = JSON.stringify(saved)
  assert.ok(!serialized.includes('private content'))
  assert.ok(!serialized.includes('skill body'))
  assert.equal(readDocumentTabs(saved)?.[1].skillId, 'skill-1')
})

test('same paths in different vaults remain separate tabs', () => {
  const restored = readDocumentTabs([tabs[0], { ...tabs[0], vault: 'other' }])!
  assert.equal(restored.length, 2)
  assert.notEqual(restored[0].key, restored[1].key)
})
