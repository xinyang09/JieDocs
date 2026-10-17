import assert from 'node:assert/strict'
import test from 'node:test'
import { aiLimits } from '../src/ai-contract.ts'
import { buildEditorAIContext, normalizeAIPath, summarizeContext } from '../src/ai-context.ts'

test('builds an editor context with normalized paths and CRLF selection offsets', () => {
  const context = buildEditorAIContext({
    requestId: 'r1',
    vault: ' main\\ ',
    activeNote: { path: './folder\\note.md', content: 'one\r\ntwo\r\nthree', contentHash: 'hash-1', version: 7 },
    selection: { start: 5, end: 10 },
    selectedDocuments: [
      { vault: 'main', path: 'refs/guide.md', title: 'Guide', excerpt: 'reference body', contentHash: 'hash-2' },
      { vault: 'main', path: 'refs/guide.md', excerpt: 'duplicate' },
    ],
  })
  assert.equal(context.vault, 'main')
  assert.equal(context.note?.path, 'folder/note.md')
  assert.equal(context.selection?.text, 'two\r\n')
  assert.deepEqual(context.references, [{ vault: 'main', path: 'refs/guide.md', title: 'Guide', excerpt: 'reference body', contentHash: 'hash-2' }])
  assert.equal(normalizeAIPath('../secret.md'), '')
})

test('context summary never includes full note or reference content', () => {
  const summary = summarizeContext({
    requestId: 'r1',
    vault: 'main',
    note: { path: 'guide.md', content: 'content should not appear', contentHash: 'h', version: 1 },
    references: [{ vault: 'main', path: 'guide.md', title: 'Guide', excerpt: 'content' }],
    queryScope: 'references',
    locale: 'zh-CN',
    permissions: { noteRead: true, noteWrite: false, noteDelete: false },
  })
  assert.match(summary, /guide\.md/)
  assert.doesNotMatch(summary, /content should not appear/)
  assert.doesNotMatch(summary, /excerpt/)
})

test('deduplicates references and applies per-reference and aggregate bounds', () => {
  const context = buildEditorAIContext({
    vault: 'main',
    selectedDocuments: Array.from({ length: aiLimits.references + 3 }, (_, index) => ({
      vault: 'main',
      path: `note-${index}.md`,
      content: 'x'.repeat(aiLimits.referenceContent + 100),
    })),
  })
  assert.equal(context.references.length, aiLimits.context / aiLimits.referenceContent)
  assert.ok(context.references.every((reference) => (reference.excerpt?.length || 0) <= aiLimits.referenceContent))
  const total = context.references.reduce((size, reference) => size + (reference.excerpt?.length || 0), 0)
  assert.ok(total <= aiLimits.context)
})
