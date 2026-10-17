import assert from 'node:assert/strict'
import test from 'node:test'
import { createAISurfaceState, reduceAISurfaceState, selectionAIAction } from '../src/ai-surface-state.ts'

test('selection state exposes proposal actions after a proposal event', () => {
  const initial = createAISurfaceState({ entrypoint: 'selection', selection: { text: 'old', start: 0, end: 3 } })
  const next = reduceAISurfaceState(initial, { type: 'proposal', proposalId: 'p1' })
  assert.equal(next.contextLabel, '选区 · 3 个字符')
  assert.equal(next.actions.accept, true)
})

test('deltas accumulate and done closes a run', () => {
  let state = createAISurfaceState({ entrypoint: 'global' })
  state = reduceAISurfaceState(state, { type: 'start', requestId: 'r1' })
  state = reduceAISurfaceState(state, { type: 'delta', text: '你' })
  state = reduceAISurfaceState(state, { type: 'delta', text: '好' })
  state = reduceAISurfaceState(state, { type: 'done', result: { requestId: 'r1', status: 'answer', answer: '你好', citations: [] } })
  assert.equal(state.answer, '你好')
  assert.equal(state.status, 'answer')
  assert.equal(state.actions.copy, true)
})

test('preserves selection toolbar actions when building canonical AI actions', () => {
  assert.deepEqual(selectionAIAction('ask', '解释'), { type: 'answer', instruction: '解释' })
  assert.deepEqual(selectionAIAction('rewrite', '改清楚'), { type: 'rewrite', target: 'selection', instruction: '改清楚' })
  assert.deepEqual(selectionAIAction('shorten', ''), { type: 'rewrite', target: 'selection', instruction: '精简选区内容，保留关键信息。' })
  assert.deepEqual(selectionAIAction('translate', '翻译'), { type: 'translate', target: 'selection', language: 'English', instruction: '翻译' })
})
