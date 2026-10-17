import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import test from 'node:test'
import { createLocalApi, extractPiText } from './local-api.ts'

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler)
  return new Promise<{ server: ReturnType<typeof createServer>; url: string }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('server did not bind'))
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

async function close(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

test('extractPiText extracts final text from agent_end without repeating streaming updates', () => {
  const output = [
    '{"type":"session","version":3}',
    '{"type":"turn_start"}',
    '{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"你好"}]}}',
    '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"你好"}]}}',
    '{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"你好！"}]}}',
    '{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"你好！请问有什么"}]}}',
    '{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"你好！请问有什么我可以帮您的？"}]}}',
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"你好！请问有什么我可以帮您的？"},{"type":"thinking","thinking":"abc"}]}}',
    '{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"你好！请问有什么我可以帮您的？"}]}}',
    '{"type":"agent_end","messages":[{"role":"user","content":[{"type":"text","text":"你好"}]},{"role":"assistant","content":[{"type":"text","text":"你好！请问有什么我可以帮您的？"}]}]}',
  ].join('\n')
  assert.equal(extractPiText(output), '你好！请问有什么我可以帮您的？')
})

test('extractPiText handles partial stream ending on message_update if truncated', () => {
  const output = [
    '{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"部分内容1"}]}}',
    '{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"部分内容1和2"}]}}',
  ].join('\n')
  assert.equal(extractPiText(output), '部分内容1和2')
})

test('extractPiText supports assistant string content', () => {
  assert.equal(extractPiText('{"role":"assistant","content":"完成"}'), '完成')
})

test('canonical AI routes proxy through the session connection and preserve auth', async () => {
  const received: { path?: string; authorization?: string; idempotencyKey?: string; lastEventId?: string; body?: string } = {}
  const upstream = await listen((req, res) => {
    received.path = req.url
    received.authorization = req.headers.authorization
    received.idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined
    received.lastEventId = typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : undefined
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      received.body = Buffer.concat(chunks).toString('utf8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { requestId: 'r1', status: 'answer', answer: 'ok', citations: [] } }))
    })
  })
  const api = createLocalApi({ databasePath: ':memory:', baseUrl: upstream.url })
  const local = await listen((req, res) => api.middleware(req, res, () => {
    res.writeHead(404)
    res.end()
  }))

  try {
    const configResponse = await fetch(`${local.url}/viewer-config`, { headers: { 'X-Docs-Viewer': '1' } })
    assert.equal(configResponse.status, 200)
    const cookie = configResponse.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(cookie)
    const connection = JSON.stringify({ baseUrl: upstream.url, token: 'session-token', clientType: 'webgui', defaultVault: 'main' })
    const update = await fetch(`${local.url}/viewer-config`, {
      method: 'PUT',
      headers: { 'X-Docs-Viewer': '1', 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ key: 'fns-docs-viewer.connection', value: connection }),
    })
    assert.equal(update.status, 200)

    const response = await fetch(`${local.url}/api/ai/execute`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': 'test-1', 'Last-Event-ID': 'event-7' },
      body: JSON.stringify({ action: { type: 'answer', instruction: 'hello' }, idempotencyKey: 'test-1' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: { requestId: 'r1', status: 'answer', answer: 'ok', citations: [] } })
    assert.equal(received.path, '/api/ai/execute')
    assert.equal(received.authorization, 'Bearer session-token')
    assert.equal(received.idempotencyKey, 'test-1')
    assert.equal(received.lastEventId, 'event-7')
    assert.match(received.body || '', /"idempotencyKey":"test-1"/)
  } finally {
    api.close()
    await close(local.server)
    await close(upstream.server)
  }
})

test('legacy skill installation rejects network sources', async () => {
  const api = createLocalApi({ databasePath: ':memory:', baseUrl: 'http://127.0.0.1:1' })
  const local = await listen((req, res) => api.middleware(req, res, () => {
    res.writeHead(404)
    res.end()
  }))
  try {
    const configResponse = await fetch(`${local.url}/viewer-config`, { headers: { 'X-Docs-Viewer': '1' } })
    const cookie = configResponse.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(cookie)
    const response = await fetch(`${local.url}/pi-skills/install`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Docs-Viewer': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'remote', url: 'https://github.com/example/skill' }),
    })
    assert.equal(response.status, 400)
    assert.match(String((await response.json() as { message?: string }).message), /不支持联网安装/)
  } finally {
    api.close()
    await close(local.server)
  }
})
