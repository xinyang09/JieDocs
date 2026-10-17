import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AIStreamParser,
  parseAIStreamEvent,
  splitSSEData,
  validateAIExecuteRequest,
  validateAIStreamEvent,
  validateProposalCommit,
} from '../src/ai-contract.ts'

const answer = (instruction = 'Explain this note') => ({
  idempotencyKey: 'k1',
  action: { type: 'answer', instruction },
})

test('rejects an instruction over 4000 characters and an empty instruction', () => {
  assert.throws(() => validateAIExecuteRequest(answer('x'.repeat(4001))))
  assert.throws(() => validateAIExecuteRequest(answer('')))
  assert.throws(() => validateAIExecuteRequest({ action: { type: 'answer', instruction: 'ok' }, idempotencyKey: ' ' }))
})

test('applies UTF-8 byte limits consistently for multi-byte instructions', () => {
  const exact = '中'.repeat(2000) // 6000 UTF-8 bytes, over the 4000-byte limit
  assert.throws(() => validateAIExecuteRequest(answer(exact)))
  assert.doesNotThrow(() => validateAIExecuteRequest(answer('中'.repeat(1300))))
})

test('rejects unknown action and patch discriminators', () => {
  assert.throws(() => validateAIExecuteRequest({ action: { type: 'shell', instruction: 'run' }, idempotencyKey: 'k1' }))
  assert.equal(parseAIStreamEvent('data: {"type":"proposal","proposal":{"id":"p1","action":"answer","base":[],"operations":[{"op":"shell"}],"summary":"x","expiresAt":"2026-10-07T00:00:00Z"}}'), undefined)
  assert.throws(() => validateAIStreamEvent({ type: 'unknown' }))
})

test('enforces reference, skill, context and proposal limits', () => {
  assert.throws(() => validateAIExecuteRequest({ ...answer(), context: { requestId: 'r', vault: 'main', references: Array.from({ length: 21 }, () => ({ vault: 'main', path: 'x' })), queryScope: 'references', locale: 'en', permissions: { noteRead: true, noteWrite: false, noteDelete: false } } }))
  assert.throws(() => validateAIExecuteRequest({ ...answer(), options: { skillIds: Array.from({ length: 9 }, (_, i) => `s${i}`) } }))
  assert.throws(() => validateAIExecuteRequest({ ...answer(), context: { requestId: 'r', vault: 'main', references: [], queryScope: 'references', locale: 'en', permissions: { noteRead: true, noteWrite: false, noteDelete: false }, selection: { text: 'x', start: 4, end: 2 } } }))
  assert.throws(() => validateProposalCommit({ targets: [], confirmToken: '', idempotencyKey: 'k1' }))
})

test('parses a proposal event without accepting unknown operations', () => {
  const event = parseAIStreamEvent('data: {"type":"proposal","proposal":{"id":"p1","action":"rewrite","base":[],"operations":[],"summary":"rewrite","expiresAt":"2026-10-07T00:00:00Z"}}')
  assert.equal(event?.type, 'proposal')
  assert.equal(parseAIStreamEvent('data: {"type":"proposal","proposal":{"id":"p1","action":"rewrite","base":[],"operations":[{"op":"shell"}],"summary":"rewrite","expiresAt":"2026-10-07T00:00:00Z"}}'), undefined)
})

test('parses SSE data split at arbitrary chunk boundaries', () => {
  const frames = [
    'event: meta\ndata: {"type":"meta","requestId":"r1","tools":[]}\n\n',
    'data: {"type":"delta","text":"hello"}\n\n',
    'data: {"type":"error","code":"timeout","message":"retry","retryable":true}\n\n',
  ]
  const input = frames.join('')
  const chunks = Array.from({ length: input.length }, (_, i) => input.slice(i, i + 1))
  const events = splitSSEData(chunks)
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'error'])
  const parser = new AIStreamParser()
  assert.deepEqual(parser.push(input.slice(0, 14)), [])
  assert.deepEqual(parser.push(input.slice(14)).map((event) => event.type), ['meta', 'delta', 'error'])
  assert.equal(parser.end().length, 0)
})

test('normalizes only omitted zero-value fields from older Go SSE frames', () => {
  assert.deepEqual(parseAIStreamEvent('data: {"type":"meta","id":"run-1","sequence":0,"requestId":"r1"}'), {
    type: 'meta', id: 'run-1', sequence: 0, requestId: 'r1', tools: [],
  })
  assert.deepEqual(parseAIStreamEvent('data: {"type":"error","id":"run-1","sequence":1,"code":"provider_failed","message":"模型服务请求失败"}'), {
    type: 'error', id: 'run-1', sequence: 1, code: 'provider_failed', message: '模型服务请求失败', retryable: false,
  })
})

test('continues rejecting invalid fields in older Go SSE frames', () => {
  for (const retryable of [null, 'false', 0]) {
    assert.equal(parseAIStreamEvent(`data: ${JSON.stringify({ type: 'error', code: 'failed', message: '失败', retryable })}`), undefined)
  }
  for (const tools of [null, 'read', [7]]) {
    assert.equal(parseAIStreamEvent(`data: ${JSON.stringify({ type: 'meta', requestId: 'r1', tools })}`), undefined)
  }
  assert.equal(parseAIStreamEvent('data: {"type":"error","message":"失败"}'), undefined)
  assert.equal(parseAIStreamEvent('data: {"type":"error","code":"failed"}'), undefined)
  assert.equal(parseAIStreamEvent('data: {"type":"meta"}'), undefined)
  assert.throws(() => validateAIStreamEvent({ type: 'error', code: 'failed', message: '失败' }))
  assert.throws(() => validateAIStreamEvent({ type: 'meta', requestId: 'r1' }))
})
