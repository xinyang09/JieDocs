import assert from 'node:assert/strict'
import test from 'node:test'
import { collectAIEvents, commitAIProposal, consumeAIStream, executeAI } from '../src/ai-stream.ts'

const done = 'data: {"type":"done","result":{"requestId":"r1","status":"answer","answer":"ok","citations":[]}}\n\n'

test('handles split SSE frames and preserves proposal events', async () => {
  const proposal = 'data: {"type":"proposal","proposal":{"id":"p1","action":"rewrite","base":[],"operations":[],"summary":"rewrite","expiresAt":"2026-10-07T00:00:00Z"}}\n\n'
  const events = collectAIEvents(['data: {"type":"delta","text":"a"}\n', '\n', proposal, done])
  assert.deepEqual(events.map((event) => event.type), ['delta', 'proposal', 'done'])
  const result = await consumeAIStream((async function* () { yield 'data: {"type":"delta","text":"a"}\n\n'; yield done })())
  assert.equal(result.answer, 'ok')
})

test('keeps compact compatibility proposal fixtures while rejecting unknown operations', () => {
  assert.equal(collectAIEvents(['data: {"type":"proposal","proposal":{"id":"p1","operations":[]}}\n\n'])[0]?.type, 'proposal')
  assert.equal(collectAIEvents(['data: {"type":"proposal","proposal":{"id":"p1","operations":[{"op":"shell"}]}}\n\n']).length, 0)
  assert.equal(collectAIEvents(['data: {"type":"done","result":{"status":"proposal","proposal":{"operations":[{"op":"shell"}]}}}\n\n']).length, 0)
})

test('preserves explicit retryability and server error details', async () => {
  for (const retryable of [false, true]) {
    const event = { type: 'error', code: 'pi_timeout', message: '超时', retryable }
    await assert.rejects(() => consumeAIStream((async function* () { yield `data: ${JSON.stringify(event)}\n\n` })()), {
      name: 'FnsApiError', code: 'pi_timeout', message: '超时', retryable,
    })
  }
})

test('surfaces errors from older Go streams instead of reporting a missing done event', async () => {
  const events: string[] = []
  await assert.rejects(() => consumeAIStream((async function* () {
    yield 'data: {"type":"meta","id":"run-1","sequence":0,"requestId":"r1"}\n\n'
    yield 'data: {"type":"error","id":"run-1","sequence":1,"requestId":"r1","code":"provider_failed","message":"模型服务请求失败"}\n\n'
  })(), { onEvent: (event) => events.push(event.type) }), {
    name: 'FnsApiError', code: 'provider_failed', message: '模型服务请求失败', retryable: false,
  })
  assert.deepEqual(events, ['meta', 'error'])
})

test('still rejects a genuinely incomplete stream without a terminal event', async () => {
  const events: string[] = []
  await assert.rejects(() => consumeAIStream((async function* () {
    yield 'data: {"type":"meta","id":"run-1","sequence":0,"requestId":"r1"}\n\n'
    yield 'data: {"type":"delta","text":"部分回答"}\n\n'
  })(), { onEvent: (event) => events.push(event.type) }), {
    name: 'FnsApiError', code: 'stream_incomplete', retryable: true,
  })
  assert.deepEqual(events, ['meta', 'delta'])
})

test('executeAI sends auth and idempotency headers and consumes JSON fallback', async () => {
  const originalFetch = globalThis.fetch
  const calls: RequestInit[] = []
  globalThis.fetch = async (_input, init) => {
    calls.push(init || {})
    return new Response(JSON.stringify({ requestId: 'r1', status: 'answer', answer: 'ok', citations: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await executeAI({ baseUrl: 'http://fns.test', token: 'token', clientType: 'test', defaultVault: 'main' }, { action: { type: 'answer', instruction: 'hi' }, idempotencyKey: 'k1' })
    assert.equal(result.answer, 'ok')
    const headers = new Headers(calls[0].headers)
    assert.equal(headers.get('Idempotency-Key'), 'k1')
    assert.equal(headers.get('Authorization'), 'Bearer token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reconnects once with Last-Event-ID after a partial stream', async () => {
  const originalFetch = globalThis.fetch
  const headers: Headers[] = []
  let attempt = 0
  globalThis.fetch = async (_input, init) => {
    headers.push(new Headers(init?.headers))
    attempt += 1
    if (attempt === 1) return new Response('id: 7\ndata: {"type":"delta","text":"partial"}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    return new Response(done, { headers: { 'content-type': 'text/event-stream' } })
  }
  try {
    const result = await executeAI({ baseUrl: 'http://fns.test', token: '', clientType: 'test', defaultVault: 'main' }, { action: { type: 'answer', instruction: 'hi' }, idempotencyKey: 'k2' })
    assert.equal(result.answer, 'ok')
    assert.equal(headers[1].get('Last-Event-ID'), '7')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('surfaces proposal conflicts without retrying commits', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ code: 'proposal_conflict', message: '基线已变化' }), { status: 409, headers: { 'content-type': 'application/json' } })
  }
  try {
    await assert.rejects(() => commitAIProposal({ baseUrl: 'http://fns.test', token: '', clientType: 'test', defaultVault: 'main' }, 'p1', { targets: [], confirmToken: 't', idempotencyKey: 'k3' }), /基线已变化/)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
