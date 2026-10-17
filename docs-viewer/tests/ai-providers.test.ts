import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteAIProvider, discoverAIProviderModels, getAIModels, getAIProviders, saveAIProvider, testAIProvider } from '../src/api.ts'

const connection = {
  baseUrl: 'https://notes.example.test',
  token: 'token-1',
  clientType: 'Docs Viewer',
  defaultVault: 'main',
}

function jsonResponse(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => payload } as unknown as Response
}

test('provider list exposes metadata but never a credential', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => jsonResponse({ providers: [{ id: 'p1', name: '我的 API', type: 'openai-compatible', baseUrl: 'https://api.example.test/v1', defaultModel: 'gpt-mini', enabled: true, version: 3, credentialConfigured: true, apiKey: 'should-not-be-read' }] })
  const providers = await getAIProviders(connection)
  assert.deepEqual(providers, [{ id: 'p1', name: '我的 API', type: 'openai-compatible', baseUrl: 'https://api.example.test/v1', defaultModel: 'gpt-mini', enabled: true, version: 3, credentialConfigured: true }])
  assert.equal('apiKey' in providers[0], false)
})

test('saving and deleting a provider use versioned routes and write-only key', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init })
    if (String(input).includes('/test')) return jsonResponse({ ok: true, models: [{ provider: 'custom:p1', id: 'gpt-mini' }], latencyMs: 12 })
    if (init?.method === 'DELETE') return jsonResponse({ status: true })
    return jsonResponse({ provider: { id: 'p1', name: '我的 API', type: 'openai-compatible', baseUrl: 'https://api.example.test/v1', defaultModel: 'gpt-mini', enabled: true, version: 4, credentialConfigured: true } })
  }
  const saved = await saveAIProvider(connection, { id: 'p1', version: 3, name: '我的 API', type: 'openai-compatible', baseUrl: 'https://api.example.test/v1', defaultModel: 'gpt-mini', apiKey: 'secret' })
  assert.equal(saved.version, 4)
  assert.equal(requests[0].url, 'https://notes.example.test/api/ai/providers/p1')
  assert.equal(JSON.parse(String(requests[0].init?.body)).apiKey, 'secret')
  const tested = await testAIProvider(connection, 'p1')
  assert.deepEqual(tested.models, [{ provider: 'custom:p1', id: 'gpt-mini' }])
  await deleteAIProvider(connection, 'p1', 4)
  assert.match(requests[2].url, /\/api\/ai\/providers\/p1\?version=4$/)
})

test('discovery requests the saved provider catalog with auth and abort signal, returning only model summaries', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const controller = new AbortController()
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://notes.example.test/api/ai/providers/service%2Fone/models')
    assert.equal(init?.method, 'GET')
    assert.equal(init?.signal, controller.signal)
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer token-1')
    assert.equal(init?.body, undefined)
    return jsonResponse({ data: { models: [
      { provider: 'custom:service/one', id: 'real-model', displayName: 'Real Model', providerName: '我的 API', apiKey: 'never-return-this', baseUrl: 'https://private.example.test' },
      { provider: 'custom:service/one', id: 'another-model' },
      { provider: '', id: 'invalid' },
    ] } })
  }
  const models = await discoverAIProviderModels(connection, ' service/one ', controller.signal)
  assert.deepEqual(models, [
    { provider: 'custom:service/one', id: 'real-model', displayName: 'Real Model', providerName: '我的 API' },
    { provider: 'custom:service/one', id: 'another-model' },
  ])
  assert.equal(JSON.stringify(models).includes('never-return-this'), false)
})

test('discovery rejects missing provider IDs before sending a request', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => { assert.fail('an empty provider ID must not make a request') }
  await assert.rejects(() => discoverAIProviderModels(connection, '  '), /缺少模型服务 ID/)
})

test('discovery accepts an empty catalog but rejects a malformed catalog', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => jsonResponse({ models: [] })
  assert.deepEqual(await discoverAIProviderModels(connection, 'p1'), [])
  globalThis.fetch = async () => jsonResponse({ models: null })
  await assert.rejects(() => discoverAIProviderModels(connection, 'p1'), /模型列表无效/)
})

test('discovery and aggregate model loading preserve safe nested API errors', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => jsonResponse({ error: { code: 'ai_provider_unavailable', message: '模型服务暂时不可用，请稍后重试。' } }, 502)
  for (const load of [() => discoverAIProviderModels(connection, 'p1'), () => getAIModels(connection)]) {
    await assert.rejects(load, (reason: unknown) => {
      assert.equal((reason as Error).message, '模型服务暂时不可用，请稍后重试。')
      assert.equal((reason as { status: number }).status, 502)
      assert.equal((reason as { code: string }).code, 'ai_provider_unavailable')
      return true
    })
  }
})
