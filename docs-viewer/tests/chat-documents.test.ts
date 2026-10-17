import assert from 'node:assert/strict'
import test from 'node:test'
import { chatDocumentKey, loadChatDocumentContext, maxChatDocumentBytes, readChatDocuments } from '../src/chat-documents.ts'
import { readChatHistory } from '../src/ai-chat.ts'

const documents = [{ vault: 'work', path: 'folder/one.md' }, { vault: 'personal', path: 'folder/one.md' }]

test('validates references, deduplicates per vault and persists metadata only', () => {
  const refs = readChatDocuments([null, {}, { vault: '', path: 'x' }, documents[0], documents[0], { ...documents[1], content: 'not stored' }])
  assert.deepEqual(refs, documents)
  assert.notEqual(chatDocumentKey(refs[0]), chatDocumentKey(refs[1]))
  const history = readChatHistory(JSON.stringify({ sessions: [{ id: 'chat', title: 'Chat', updatedAt: 1, documents: refs, messages: [{ role: 'user', content: 'Summarize', documents: refs }] }] }))
  assert.deepEqual(history.sessions[0].documents, documents)
  assert.deepEqual(history.sessions[0].messages[0].documents, documents)
  assert.deepEqual(readChatDocuments(undefined), [])
})

test('reads only explicitly selected documents, with fresh content and provenance', async () => {
  const readPaths: string[] = []
  const context = await loadChatDocumentContext(documents, async (document) => {
    readPaths.push(`${document.vault}/${document.path}`)
    return { content: `${document.vault} fresh content` }
  }, new AbortController().signal)
  assert.deepEqual(readPaths, ['work/folder/one.md', 'personal/folder/one.md'])
  assert.match(context, /fresh content/)
  assert.match(context, /folder\/one.md/)
  let called = false
  assert.equal(await loadChatDocumentContext([], async () => { called = true; return { content: '' } }, new AbortController().signal), '')
  assert.equal(called, false)
})

test('reply references survive reload independently of the current document selection', () => {
  const messages = [
    { role: 'user', content: 'Summarize', documents },
    { role: 'assistant', content: 'Summary', status: 'done', documents },
    { role: 'user', content: 'Hello', documents: [] },
    { role: 'assistant', content: 'Hi', status: 'done', documents: [] },
  ]
  const history = readChatHistory(JSON.stringify({ sessions: [{ id: 'chat', title: 'Chat', updatedAt: 1, documents: [], messages }] }))
  assert.deepEqual(history.sessions[0].messages[1].documents, documents)
  assert.deepEqual(history.sessions[0].messages[3].documents, [])
  assert.deepEqual(history.sessions[0].documents, [])
})

test('legacy replies inherit references from the preceding user message', () => {
  const history = readChatHistory(JSON.stringify({ sessions: [{ id: 'chat', title: 'Chat', updatedAt: 1, messages: [
    { role: 'user', content: 'Summarize', documents },
    { role: 'assistant', content: 'Summary', status: 'done' },
  ] }] }))
  assert.deepEqual(history.sessions[0].messages[1].documents, documents)
})

test('stops on unreadable documents instead of silently dropping a reference', async () => {
  await assert.rejects(loadChatDocumentContext(documents, async () => { throw new Error('denied') }, new AbortController().signal), /无法读取引用文档「work\/folder\/one.md」/)
})

test('rejects excessive or oversize references including multibyte content', async () => {
  await assert.rejects(loadChatDocumentContext(Array(6).fill(documents[0]), async () => ({ content: '' }), new AbortController().signal), /最多引用 5/)
  await assert.rejects(loadChatDocumentContext([documents[0]], async () => ({ content: '汉'.repeat(maxChatDocumentBytes / 2) }), new AbortController().signal), /超过 80 KB/)
})

test('cancelling document fetch prevents an AI-ready context from being returned', async () => {
  const controller = new AbortController()
  await assert.rejects(loadChatDocumentContext(documents, async () => {
    controller.abort()
    return { content: 'not sent' }
  }, controller.signal), { name: 'AbortError' })
})
