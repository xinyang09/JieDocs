import assert from 'node:assert/strict'
import test from 'node:test'
import { rawNoteSelectionRange } from '../src/ai-selection.ts'

test('maps body selections after frontmatter to complete raw note offsets', () => {
  const content = '---\ntitle: Demo\n---\r\none\r\ntwo'
  const range = rawNoteSelectionRange(content, { text: 'two', start: 5, end: 8 })
  const normalized = content.replace(/\r\n/g, '\n')
  assert.equal(normalized.slice(range.start, range.end), 'two')
  assert.equal(range.start, normalized.indexOf('two'))
})

test('uses supplied offsets to disambiguate repeated raw text', () => {
  const content = '---\ntitle: Demo\n---\nfoo foo'
  const bodyOffset = content.indexOf('foo')
  const range = rawNoteSelectionRange(content, { text: 'foo', start: 4, end: 7 })
  assert.equal(content.slice(range.start, range.end), 'foo')
  assert.equal(range.start, bodyOffset + 4)
})
