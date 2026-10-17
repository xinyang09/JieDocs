import assert from 'node:assert/strict'
import test from 'node:test'
import { chatModelKey, chatSessionMarkdown, chatSessionTitle, maxChatTitleLength, readChatHistory, readChatModel, renameChatSession } from '../src/ai-chat.ts'

test('model selections survive history persistence separately for each conversation', () => {
  const first = { provider: 'first', id: 'same-model' }
  const second = { provider: 'second', id: 'same-model' }
  const sessions = [first, second].map((model, index) => ({ id: String(index), title: 'Chat', updatedAt: 1, messages: [], model }))
  const restored = readChatHistory(JSON.stringify({ sessions, activeId: '1', model: first }))
  assert.deepEqual(restored.sessions.map((session) => session.model), [first, second])
  assert.deepEqual(restored.model, first)
  assert.equal(restored.activeId, '1')
  assert.notEqual(chatModelKey(first), chatModelKey(second))
})

test('legacy conversations use Pi default and invalid saved models are discarded', () => {
  const restored = readChatHistory(JSON.stringify({ sessions: [{ id: 'old', title: 'Chat', updatedAt: 1, messages: [] }] }))
  assert.equal(restored.sessions[0].model, undefined)
  assert.equal(chatModelKey(restored.model), '')
  for (const model of [null, 'model', { provider: 'p' }, { provider: '', id: 'm' }, { provider: 'p', id: 3 }]) assert.equal(readChatModel(model), undefined)
  assert.deepEqual(readChatModel({ provider: 'p', id: 'm', apiKey: 'not persisted' }), { provider: 'p', id: 'm' })
})

test('renamed conversations keep their title when the first message is sent', () => {
  const session = { id: 'chat', title: '部署排障', updatedAt: 1, messages: [] }
  const renamed = renameChatSession(session, '  部署排障  ')
  assert.equal(renamed, session)
  const custom = renameChatSession(session, ` ${'自定义标题'.repeat(30)} `)
  assert.equal(custom.title.length, maxChatTitleLength)
  assert.equal(custom.titleEdited, true)
  assert.equal(chatSessionTitle(custom, '第一条问题'), custom.title)
  assert.equal(chatSessionTitle(session, '第一条问题'), '第一条问题')
})

test('exports conversation content with tools and provenance without collapsing markdown', () => {
  const markdown = chatSessionMarkdown({
    id: 'chat', title: '知识库问答', updatedAt: 1, messages: [
      { role: 'user', content: '总结文档', documents: [{ vault: 'vPara', path: 'guide.md' }] },
      { role: 'assistant', content: '这是总结。\n\n```js\nconst value = 1\n\nconsole.log(value)\n```', status: 'done', documents: [{ vault: 'vPara', path: 'guide.md' }], tools: ['文档读取'], process: ['准备请求', '读取引用文档', '整理参考内容', '生成回答', '已完成'] },
    ],
  })
  assert.match(markdown, /^# 知识库问答/m)
  assert.match(markdown, /引用文档：vPara\/guide\.md/)
  assert.match(markdown, /使用工具：文档读取/)
  assert.match(markdown, /执行过程：准备请求 → 读取引用文档 → 整理参考内容 → 生成回答 → 已完成/)
  assert.match(markdown, /const value = 1\n\nconsole\.log\(value\)/)
})
