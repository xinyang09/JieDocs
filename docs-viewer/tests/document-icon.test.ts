import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DOCUMENT_ICON_STORAGE_KEY,
  clearDocumentIcon,
  documentIconCategories,
  documentIconKey,
  findDocumentIconOptions,
  getDocumentIcon,
  getDocumentIconFromMap,
  isDocumentIcon,
  loadDocumentIcons,
  migrateDocumentIcon,
  migrateDocumentIconInMap,
  normalizeDocumentIcon,
  persistDocumentIcons,
  removeDocumentIconsUnderPath,
  setDocumentIcon,
  writeDocumentIcon,
  type DocumentIconRef,
  type DocumentIconStorage,
} from '../src/document-icon.ts'

class MemoryStorage implements DocumentIconStorage {
  private values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const note = (vault: string, path: string): DocumentIconRef => ({ vault, kind: 'note', path })

test('provides a broad categorized catalog with searchable names', () => {
  const options = documentIconCategories.flatMap((category) => category.icons)
  const uniqueIcons = new Set(options.map(([icon]) => icon))
  assert.ok(uniqueIcons.size >= 200)
  assert.ok(documentIconCategories.every((category) => new Set(category.icons.map(([icon]) => icon)).size === category.icons.length))
  assert.ok(options.every(([icon, name]) => normalizeDocumentIcon(icon) === icon && name.trim().length > 0))
  assert.equal(findDocumentIconOptions('', 'all').length, uniqueIcons.size)
  assert.ok(findDocumentIconOptions('办公', 'common').some(([icon]) => icon === '🏢'))
  assert.ok(findDocumentIconOptions('', 'nature').some(([icon]) => icon === '🌱'))
})

test('accepts one emoji grapheme, including ZWJ, flag and skin-tone sequences', () => {
  for (const icon of ['😀', '👨‍👩‍👧‍👦', '🏳️‍🌈', '🇨🇳', '👍🏽', '1️⃣', '❤️']) {
    assert.equal(normalizeDocumentIcon(icon), icon)
    assert.equal(isDocumentIcon(icon), true)
  }
  assert.equal(normalizeDocumentIcon('  😀  '), '😀')
})

test('rejects empty, non-emoji, multiple graphemes and standalone keycap characters', () => {
  for (const value of ['', '   ', '文档', 'hello😀', '😀😀', '1', '#', null, 42]) {
    assert.equal(normalizeDocumentIcon(value), null, String(value))
    assert.equal(isDocumentIcon(value), false, String(value))
  }
})

test('uses vault, kind and path together for isolated storage entries', () => {
  const storage = new MemoryStorage()
  const samePathOtherVault = note('archive', 'guide.md')
  const samePathOtherKind: DocumentIconRef = { vault: 'main', kind: 'file', path: 'guide.md' }

  assert.notEqual(documentIconKey(note('main', 'guide.md')), documentIconKey(samePathOtherVault))
  assert.notEqual(documentIconKey(note('main', 'guide.md')), documentIconKey(samePathOtherKind))
  assert.equal(setDocumentIcon(note('main', 'guide.md'), '📘', storage), true)
  assert.equal(setDocumentIcon(samePathOtherVault, '🗄️', storage), true)
  assert.equal(getDocumentIcon(note('main', 'guide.md'), storage), '📘')
  assert.equal(getDocumentIcon(samePathOtherVault, storage), '🗄️')
  assert.equal(getDocumentIcon(samePathOtherKind, storage), null)
})

test('normalizes path separators and surrounding slashes without changing vault identity', () => {
  assert.equal(documentIconKey(note('main', '/notes\\guide.md/')), documentIconKey(note('main', 'notes/guide.md')))
  assert.notEqual(documentIconKey(note('/main/', 'notes/guide.md')), documentIconKey(note('main', 'notes/guide.md')))
})

test('invalid updates do not overwrite the current icon', () => {
  const storage = new MemoryStorage()
  const ref = note('main', 'guide.md')
  assert.equal(setDocumentIcon(ref, '📘', storage), true)
  assert.equal(setDocumentIcon(ref, 'not an emoji', storage), false)
  assert.equal(getDocumentIcon(ref, storage), '📘')
})

test('clears one icon and removes the empty storage record', () => {
  const storage = new MemoryStorage()
  const ref = note('main', 'guide.md')
  assert.equal(setDocumentIcon(ref, '📘', storage), true)
  assert.equal(clearDocumentIcon(ref, storage), true)
  assert.equal(getDocumentIcon(ref, storage), null)
  assert.equal(storage.getItem(DOCUMENT_ICON_STORAGE_KEY), null)
  assert.equal(clearDocumentIcon(ref, storage), true)
})

test('migrates an icon across rename or move while removing stale destination data', () => {
  const storage = new MemoryStorage()
  const from = note('main', 'drafts/guide.md')
  const to = note('main', 'published/guide.md')
  assert.equal(setDocumentIcon(from, '📝', storage), true)
  assert.equal(setDocumentIcon(to, '📚', storage), true)
  assert.equal(migrateDocumentIcon(from, to, storage), '📝')
  assert.equal(getDocumentIcon(from, storage), null)
  assert.equal(getDocumentIcon(to, storage), '📝')
})

test('migration keeps a missing source untouched and supports vault changes', () => {
  const storage = new MemoryStorage()
  const from = note('main', 'guide.md')
  const to = note('archive', 'guide.md')
  assert.equal(migrateDocumentIcon(from, to, storage), null)
  assert.equal(storage.getItem(DOCUMENT_ICON_STORAGE_KEY), null)
  assert.equal(setDocumentIcon(from, '📘', storage), true)
  assert.equal(migrateDocumentIcon(from, to, storage), '📘')
  assert.equal(getDocumentIcon(from, storage), null)
  assert.equal(getDocumentIcon(to, storage), '📘')
})

test('ignores malformed and invalid persisted entries', () => {
  const storage = new MemoryStorage()
  const ref = note('main', 'guide.md')
  storage.setItem(DOCUMENT_ICON_STORAGE_KEY, JSON.stringify({
    [documentIconKey(ref)]: '📘',
    'bad-entry': 'plain text',
  }))
  assert.equal(getDocumentIcon(ref, storage), '📘')
  assert.equal(getDocumentIcon(note('main', 'bad-entry'), storage), null)

  storage.setItem(DOCUMENT_ICON_STORAGE_KEY, '{not-json')
  assert.equal(getDocumentIcon(ref, storage), null)
})

test('frontend map updates isolate entries and do not mutate the input', () => {
  const original = {}
  const next = writeDocumentIcon(original, 'main', 'note', '/notes\\guide.md/', '📘')
  assert.deepEqual(original, {})
  assert.equal(getDocumentIconFromMap(next, 'main', 'note', 'notes/guide.md'), '📘')
  assert.equal(getDocumentIconFromMap(next, 'other', 'note', 'notes/guide.md'), undefined)
  assert.equal(getDocumentIconFromMap(next, 'main', 'file', 'notes/guide.md'), undefined)
  assert.equal(writeDocumentIcon(next, 'main', 'note', 'notes/guide.md', 'invalid'), next)
  assert.equal(getDocumentIconFromMap(writeDocumentIcon(next, 'main', 'note', 'notes/guide.md'), 'main', 'note', 'notes/guide.md'), undefined)
})

test('frontend map migration moves only the specified document', () => {
  const original = writeDocumentIcon({}, 'main', 'note', 'old.md', '📝')
  const migrated = migrateDocumentIconInMap(original, 'main', 'note', 'old.md', 'notes/new.md')
  assert.equal(getDocumentIconFromMap(original, 'main', 'note', 'old.md'), '📝')
  assert.equal(getDocumentIconFromMap(migrated, 'main', 'note', 'old.md'), undefined)
  assert.equal(getDocumentIconFromMap(migrated, 'main', 'note', 'notes/new.md'), '📝')
  assert.equal(migrateDocumentIconInMap(original, 'main', 'file', 'old.md', 'new.md'), original)
})

test('removing a folder removes descendants but preserves siblings and other vaults', () => {
  let entries = writeDocumentIcon({}, 'main', 'folder', 'notes', '📁')
  entries = writeDocumentIcon(entries, 'main', 'note', 'notes/a.md', '📘')
  entries = writeDocumentIcon(entries, 'main', 'file', 'notes/images/a.png', '🖼️')
  entries = writeDocumentIcon(entries, 'main', 'note', 'notes-other/a.md', '📒')
  entries = writeDocumentIcon(entries, 'other', 'note', 'notes/a.md', '📚')

  const next = removeDocumentIconsUnderPath(entries, 'main', '/notes/')
  assert.equal(getDocumentIconFromMap(entries, 'main', 'folder', 'notes'), '📁')
  assert.equal(getDocumentIconFromMap(next, 'main', 'folder', 'notes'), undefined)
  assert.equal(getDocumentIconFromMap(next, 'main', 'note', 'notes/a.md'), undefined)
  assert.equal(getDocumentIconFromMap(next, 'main', 'file', 'notes/images/a.png'), undefined)
  assert.equal(getDocumentIconFromMap(next, 'main', 'note', 'notes-other/a.md'), '📒')
  assert.equal(getDocumentIconFromMap(next, 'other', 'note', 'notes/a.md'), '📚')
})

test('frontend maps persist and load without storing document contents', () => {
  const storage = new MemoryStorage()
  const entries = writeDocumentIcon({}, 'main', 'note', 'guide.md', '📘')
  assert.equal(persistDocumentIcons(storage, entries), true)
  assert.deepEqual(loadDocumentIcons(storage), entries)
  assert.equal(persistDocumentIcons(storage, {}), true)
  assert.equal(storage.getItem(DOCUMENT_ICON_STORAGE_KEY), null)
  assert.deepEqual(loadDocumentIcons(storage), {})
})

test('unavailable storage reports failed writes without throwing', () => {
  const storage: DocumentIconStorage = {
    getItem() { throw new Error('unavailable') },
    setItem() { throw new Error('unavailable') },
    removeItem() { throw new Error('unavailable') },
  }
  assert.equal(getDocumentIcon(note('main', 'guide.md'), storage), null)
  assert.equal(setDocumentIcon(note('main', 'guide.md'), '📘', storage), false)
  assert.equal(persistDocumentIcons(storage, {}), false)
})
