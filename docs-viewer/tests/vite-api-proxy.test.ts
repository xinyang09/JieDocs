import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer, preview } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))

function upgrade(url: string) {
  return new Promise<void>((resolveUpgrade, reject) => {
    const req = request(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    })
    req.setTimeout(3000, () => req.destroy(new Error('WebSocket upgrade timed out')))
    req.once('error', reject)
    req.once('response', (response) => {
      response.resume()
      reject(new Error(`Expected WebSocket upgrade, received ${response.statusCode}`))
    })
    req.once('upgrade', (response, socket) => {
      socket.destroy()
      assert.equal(response.statusCode, 101)
      resolveUpgrade()
    })
    req.end()
  })
}

test('dev and preview forward canonical HTTP and WebSocket APIs to the configured FNS service', async (t) => {
  const received: { path?: string; host?: string; client?: string; authorization?: string; body?: string }[] = []
  const sockets = new Set<Socket>()
  const upstream = createHttpServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      received.push({
        path: req.url,
        host: req.headers.host,
        client: req.headers['x-client'] as string | undefined,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.writeHead(req.url === '/api/user/login' ? 200 : 401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: req.url === '/api/user/login' ? 'login reached FNS' : 'FNS authentication required' }))
    })
  })
  upstream.on('upgrade', (req, socket) => {
    received.push({ path: req.url, host: req.headers.host })
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  })
  upstream.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen))
  const address = upstream.address()
  assert.ok(address && typeof address !== 'string')
  const upstreamHost = `127.0.0.1:${address.port}`
  const dist = await mkdtemp(resolve(tmpdir(), 'fns-vite-proxy-'))
  await writeFile(resolve(dist, 'index.html'), '<html><body>Proxy test</body></html>')
  const previousCwd = process.cwd()
  const previousBaseUrl = process.env.FNS_BASE_URL
  const previousDatabase = process.env.DOCS_VIEWER_DB_PATH
  process.chdir(root)
  process.env.FNS_BASE_URL = `http://${upstreamHost}`
  process.env.DOCS_VIEWER_DB_PATH = ':memory:'

  try {
    for (const mode of ['dev', 'preview'] as const) {
      await t.test(mode, async () => {
        const config = {
          root,
          configFile: resolve(root, 'vite.config.ts'),
          mode: 'test',
          logLevel: 'silent' as const,
          build: { outDir: dist },
          server: { host: '127.0.0.1', port: 0 },
          preview: { host: '127.0.0.1', port: 0 },
          optimizeDeps: { noDiscovery: true },
        }
        const vite = mode === 'dev' ? await createServer(config) : await preview(config)
        if ('listen' in vite) await vite.listen()
        const httpServer = vite.httpServer
        assert.ok(httpServer)
        const viewerAddress = httpServer.address()
        assert.ok(viewerAddress && typeof viewerAddress !== 'string')
        const origin = `http://127.0.0.1:${viewerAddress.port}`
        try {
          const body = JSON.stringify({ credentials: 'test-user', password: 'test-password' })
          const login = await fetch(`${origin}/api/user/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client': 'webgui' },
            body,
          })
          assert.equal(login.status, 200)
          assert.deepEqual(await login.json(), { message: 'login reached FNS' })
          assert.deepEqual(received.at(-1), { path: '/api/user/login', host: upstreamHost, client: 'webgui', authorization: undefined, body })

          const vault = await fetch(`${origin}/api/vault?limit=1`, { headers: { Authorization: 'Bearer integration-test-token' } })
          assert.equal(vault.status, 401)
          assert.deepEqual(await vault.json(), { message: 'FNS authentication required' })
          assert.equal(received.at(-1)?.path, '/api/vault?limit=1')
          assert.equal(received.at(-1)?.authorization, 'Bearer integration-test-token')

          // No local session cookie: canonical AI must still reach FNS auth.
          const ai = await fetch(`${origin}/api/ai/providers`)
          assert.equal(ai.status, 401)
          assert.deepEqual(await ai.json(), { message: 'FNS authentication required' })
          assert.equal(received.at(-1)?.path, '/api/ai/providers')

          await upgrade(`${origin}/api/user/sync?client=webgui`)
          assert.equal(received.at(-1)?.path, '/api/user/sync?client=webgui')
          assert.equal(received.at(-1)?.host, upstreamHost)
        } finally {
          if ('close' in vite) await vite.close()
          else {
            httpServer.closeAllConnections()
            await new Promise<void>((resolveClose, reject) => httpServer.close((error) => error ? reject(error) : resolveClose()))
          }
        }
      })
    }
  } finally {
    process.chdir(previousCwd)
    if (previousBaseUrl === undefined) delete process.env.FNS_BASE_URL
    else process.env.FNS_BASE_URL = previousBaseUrl
    if (previousDatabase === undefined) delete process.env.DOCS_VIEWER_DB_PATH
    else process.env.DOCS_VIEWER_DB_PATH = previousDatabase
    for (const socket of sockets) socket.destroy()
    upstream.closeAllConnections()
    await new Promise<void>((resolveClose) => upstream.close(() => resolveClose()))
    await rm(dist, { recursive: true, force: true })
  }
})
