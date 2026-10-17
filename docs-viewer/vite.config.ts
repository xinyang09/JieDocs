import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { createLocalApi } from './server/local-api.ts'

function localViewerApi(env: Record<string, string>) {
  const api = createLocalApi({
    databasePath: env.DOCS_VIEWER_DB_PATH || resolve(process.cwd(), 'data/docs-viewer.sqlite'),
    baseUrl: env.FNS_BASE_URL || env.VITE_FNS_BASE_URL || 'http://127.0.0.1:9000',
    defaultVault: env.VITE_FNS_VAULT,
  })
  const middleware: typeof api.middleware = (req, res, next) => {
    const path = (req.url || '/').split('?')[0]
    // Canonical APIs use the configured FNS upstream, including AI requests
    // that do not have a legacy local-viewer session cookie.
    if (path === '/api' || path.startsWith('/api/')) return next()
    api.middleware(req, res, next)
  }

  return {
    name: 'docs-viewer-local-api',
    configureServer(server: { middlewares: { use: (handler: typeof api.middleware) => void } }) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server: { middlewares: { use: (handler: typeof api.middleware) => void } }) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = {
    '/api': {
      target: env.FNS_BASE_URL || env.VITE_FNS_BASE_URL || 'http://127.0.0.1:9000',
      changeOrigin: true,
      ws: true,
    },
  }
  return {
    base: env.VITE_DESKTOP_BUILD === '1' ? './' : '/docs/',
    plugins: [react(), localViewerApi(env)],
    server: {
      host: '127.0.0.1',
      port: 4173,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy,
    },
  }
})
