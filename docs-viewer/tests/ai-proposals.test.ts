import assert from 'node:assert/strict'
import test from 'node:test'
import { applyProposal, canUndoProposal, makeSelectionProposal, ProposalConflictError } from '../src/ai-proposals.ts'

const proposalFor = (hash = 'h1', version = 3) => ({
  id: 'p1', action: 'rewrite' as const,
  base: [{ vault: 'main', path: 'a.md', contentHash: hash, version }],
  operations: [{ op: 'replace-range' as const, start: 17, end: 20, text: 'new' }],
  summary: '改写选区', expiresAt: new Date(Date.now() + 1000).toISOString(),
})

test('preserves frontmatter and replaces only the selected range', () => {
  const result = applyProposal({ content: '---\ntitle: A\n---\nold\nkeep', contentHash: 'h1', version: 3 }, proposalFor())
  assert.equal(result.content, '---\ntitle: A\n---\nnew\nkeep')
})

test('rejects a stale base before applying any operation', () => {
  assert.throws(() => applyProposal({ content: 'current', contentHash: 'h2', version: 4 }, proposalFor('h1', 3)), ProposalConflictError)
})

test('preserves CRLF while applying normalized UTF-16 offsets', () => {
  const proposal = { ...proposalFor(), operations: [{ op: 'replace-range' as const, start: 2, end: 5, text: 'new' }] }
  const result = applyProposal({ content: 'a\r\nold\r\nkeep', contentHash: 'h1', version: 3 }, proposal)
  assert.equal(result.content, 'a\r\nnew\r\nkeep')
})

test('applies replace ranges using JavaScript UTF-16 offsets around emoji', () => {
  const content = '😀 old'
  const proposal = { ...proposalFor(), operations: [{ op: 'replace-range' as const, start: 3, end: 6, text: 'new' }] }
  const result = applyProposal({ content, contentHash: 'h1', version: 3 }, proposal)
  assert.equal(result.content, '😀 new')
})

test('builds a guarded selection proposal and checks undo baseline', () => {
  const proposal = makeSelectionProposal({ content: 'old', contentHash: 'h1', version: 1, vault: 'main', path: 'a.md' }, { start: 0, end: 3 }, 'new')
  assert.deepEqual(proposal.operations, [{ op: 'replace-range', start: 0, end: 3, text: 'new' }])
  assert.equal(canUndoProposal({ content: 'new', contentHash: 'h2', version: 2 }, { targets: [{ vault: 'main', path: 'a.md', contentHash: 'h2', version: 2 }] }), true)
})
