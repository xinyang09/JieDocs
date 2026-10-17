import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalApi } from './local-api.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
try {
  for (const line of readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = /^\s*([\w-]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const dist = resolve(root, 'dist')
const api = createLocalApi({
  databasePath: process.env.DOCS_VIEWER_DB_PATH || resolve(root, 'data/docs-viewer.sqlite'),
  baseUrl: process.env.FNS_BASE_URL || process.env.VITE_FNS_BASE_URL || 'http://127.0.0.1:9000',
  defaultVault: process.env.VITE_FNS_VAULT,
})
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
const server = createServer((req, res) => {
  api.middleware(req, res, () => {
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
      const filename = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!filename.startsWith(`${dist}${sep}`) || !(await stat(filename)).isFile()) {
        res.writeHead(404)
        res.end('Not found.')
        return
      }
      res.writeHead(200, {
        'Content-Type': mimeTypes[extname(filename)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      if (req.method === 'HEAD') res.end()
      else createReadStream(filename).on('error', () => res.destroy()).pipe(res)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(404)
      res.end('Not found. Run npm run build before starting the server.')
    })
  })
})
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4173)
server.on('close', api.close)
server.listen(port, host, () => console.log(`Docs Viewer: http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close()
    server.closeAllConnections()
  })
}
