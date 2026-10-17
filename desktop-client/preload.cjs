const { contextBridge, ipcRenderer } = require('electron')

function readRuntime() {
  const argument = process.argv.find((value) => value.startsWith('--fns-runtime='))
  if (!argument) return null
  try { return JSON.parse(Buffer.from(argument.slice('--fns-runtime='.length), 'base64').toString('utf8')) } catch { return null }
}

function resolveBaseUrl() {
  const runtime = readRuntime()
  if (runtime?.baseUrl) return runtime.baseUrl
  const configured = process.env.FNS_DESKTOP_BASE_URL || process.env.FNS_DOCS_URL || process.env.FNS_BASE_URL || 'http://127.0.0.1:9000'
  try {
    const url = new URL(configured)
    url.pathname = url.pathname.replace(/\/docs\/?$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return 'http://127.0.0.1:9000'
  }
}

contextBridge.exposeInMainWorld('fnsDesktop', {
  isDesktop: true,
  isLocal: Boolean(readRuntime()?.isLocal),
  baseUrl: resolveBaseUrl(),
  token: readRuntime()?.token || '',
  localVault: readRuntime()?.localVault || '',
  localRoot: readRuntime()?.localRoot || '',
  localAgent: Boolean(readRuntime()?.isLocal),
  openLocalFolder: () => ipcRenderer.invoke('fns-open-local-folder'),
  listLocalAgents: () => ipcRenderer.invoke('fns-list-local-agents'),
  getLocalAgentState: () => ipcRenderer.invoke('fns-get-local-agent-state'),
  selectLocalAgent: (command) => ipcRenderer.invoke('fns-select-local-agent', command),
})
