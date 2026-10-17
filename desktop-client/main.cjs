const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron')
const { resolveWorkspaceRoot } = require('./workspace.cjs')
const { discoverLocalAgents } = require('./agent-discovery.cjs')

function configuredRemoteBase() {
  const configured = process.env.FNS_DESKTOP_BASE_URL || process.env.FNS_DOCS_URL || process.env.FNS_BASE_URL
  if (!configured) return ''
  try {
    const url = new URL(configured)
    url.pathname = url.pathname.replace(/\/docs\/?$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function runtimeArgument(runtime) {
  return `--fns-runtime=${Buffer.from(JSON.stringify(runtime)).toString('base64')}`
}

function createWindow(runtime) {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    title: 'JieDocs',
    backgroundColor: '#f6f8f7',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [runtimeArgument(runtime)],
    },
  })

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[JieDocs renderer] ${message} (${sourceId}:${line})`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[JieDocs renderer] process gone: ${details.reason || 'unknown'}`)
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  void window.loadFile(path.join(__dirname, 'web', 'index.html'))
  return window
}

function cliCommand() {
  const configured = process.env.FNS_DESKTOP_CLI || process.env.FNS_LOCAL_CLI || process.env.FNS_CLI_PATH || process.env.FNS_CLI
  if (!configured) return { command: process.execPath, args: [path.join(__dirname, 'local-cli.cjs')] }
  if (/\.(?:c?m?js|ts)$/i.test(configured)) return { command: process.execPath, args: [path.resolve(configured)] }
  return { command: configured, args: [] }
}

function startLocalCli(root) {
  if (root) fs.mkdirSync(root, { recursive: true })
  const configured = cliCommand()
  const child = spawn(configured.command, [...configured.args, ...(root ? ['--root', root] : [])], {
    cwd: root || process.cwd(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let buffer = ''
  const waiters = new Map()
  const queued = new Map()
  const waitFor = (type, timeout = 10000) => new Promise((resolve, reject) => {
    const pending = queued.get(type)
    if (pending?.length) {
      queued.set(type, pending.slice(1))
      resolve(pending[0])
      return
    }
    const list = waiters.get(type) || []
    const entry = {
      resolve: (event) => { clearTimeout(timer); resolve(event) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    }
    const timer = setTimeout(() => {
      const current = waiters.get(type) || []
      const remaining = current.filter((item) => item !== entry)
      if (remaining.length) waiters.set(type, remaining)
      else waiters.delete(type)
      reject(new Error(`等待本地 CLI 的 ${type} 事件超时`))
    }, timeout)
    list.push(entry)
    waiters.set(type, list)
  })
  const dispatch = (event) => {
    const list = waiters.get(event.type)
    if (!list?.length) {
      const pending = queued.get(event.type) || []
      pending.push(event)
      queued.set(event.type, pending)
      return
    }
    waiters.delete(event.type)
    list.forEach(({ resolve }) => resolve(event))
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try { dispatch(JSON.parse(line)) } catch { /* CLI output is intentionally ignored unless it is JSON. */ }
    }
  })
  const failPending = (error) => {
    for (const list of waiters.values()) list.forEach(({ reject }) => reject(error))
    waiters.clear()
  }
  child.once('error', (error) => failPending(error))
  child.once('exit', (code, signal) => failPending(new Error(`本地 CLI 已退出（${signal || code || '未知错误'}）`)))

  const ready = Promise.race([
    waitFor('ready'),
    waitFor('error').then((event) => { throw new Error(event.message || '本地 CLI 启动失败') }),
  ])
  const api = ready.then((event) => ({
    child,
    baseUrl: event.baseUrl,
    get root() { return event.root || root },
    get agent() { return event.agent || process.env.FNS_LOCAL_AGENT || process.env.PI_BIN || 'pi' },
    async setRoot(nextRoot) {
      const absoluteRoot = path.resolve(nextRoot)
      child.stdin.write(`${JSON.stringify({ op: 'set-root', root: absoluteRoot })}\n`)
      const changed = await Promise.race([
        waitFor('root-changed'),
        waitFor('error').then((event) => { throw new Error(event.message || '无法切换本地工作空间') }),
      ])
      event.root = changed.root
      return changed.root
    },
    async setAgent(nextAgent) {
      const command = String(nextAgent || '').trim()
      if (!command) throw new Error('请选择一个本地智能体')
      child.stdin.write(`${JSON.stringify({ op: 'set-agent', agent: command })}\n`)
      const changed = await Promise.race([
        waitFor('agent-changed'),
        waitFor('error').then((event) => { throw new Error(event.message || '无法切换本地智能体') }),
      ])
      event.agent = changed.agent
      return changed.agent
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode) return
      child.kill('SIGTERM')
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    },
  }))
  return { child, ready, api }
}

function installMenu(runtime, localCli, window) {
  if (!runtime.isLocal) return
  const chooseLocalFolder = async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const root = await localCli.setRoot(result.filePaths[0])
    runtime.localRoot = root
    runtime.localVault = path.basename(root)
    window.webContents.reload()
    return { root, vault: path.basename(root) }
  }
  ipcMain.handle('fns-open-local-folder', chooseLocalFolder)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: '文件', submenu: [{
      label: '选择本地工作空间…',
      click: chooseLocalFolder,
    }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
}

function installAgentIpc(runtime, localCli) {
  if (!runtime.isLocal) return
  const snapshot = () => {
    const agents = discoverLocalAgents()
    const current = localCli.agent || {}
    const currentCommand = typeof current === 'string' ? current : current.command
    const currentId = typeof current === 'string' ? current : current.id
    const selected = agents.find((agent) => agent.command === currentCommand || agent.id === currentId)
    return { agents, selected: selected?.command || currentCommand || '' }
  }
  ipcMain.handle('fns-list-local-agents', snapshot)
  ipcMain.handle('fns-get-local-agent-state', () => ({ root: localCli.root || '', agent: localCli.agent, ...snapshot() }))
  ipcMain.handle('fns-select-local-agent', async (_event, command) => {
    const agents = discoverLocalAgents()
    const selected = agents.find((agent) => agent.command === command)
    if (!selected) throw new Error('未检测到所选本地智能体')
    if (!selected.supported) throw new Error('当前桌面 AI 适配器暂不支持该智能体，请选择 Pi 兼容命令')
    const agent = await localCli.setAgent(selected.command)
    runtime.localAgent = agent
    return { agent, ...snapshot(), selected: agent }
  })
}

let localCliProcess = null

app.whenReady().then(async () => {
  app.setName('JieDocs')
  const remoteBase = configuredRemoteBase()
  if (remoteBase) {
    const runtime = { isDesktop: true, isLocal: false, baseUrl: remoteBase, token: process.env.FNS_DESKTOP_TOKEN || process.env.FNS_API_TOKEN || '' }
    const window = createWindow(runtime)
    installMenu(runtime, null, window)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(runtime)
    })
    return
  }

  // Do not infer a workspace from the process cwd or the host project. The
  // desktop starts empty until the user explicitly chooses a Markdown folder.
  const root = ''
  const localCli = startLocalCli(root)
  localCliProcess = localCli
  const cli = await localCli.api
  const runtime = {
    isDesktop: true,
    isLocal: true,
    baseUrl: cli.baseUrl,
    localRoot: cli.root,
    localVault: cli.root ? path.basename(cli.root) : '',
    localAgent: cli.agent,
  }
  const window = createWindow(runtime)
  installMenu(runtime, cli, window)
  installAgentIpc(runtime, cli)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(runtime)
  })
}).catch((error) => {
  dialog.showErrorBox('无法启动本地工作空间', error instanceof Error ? error.message : '本地 CLI 启动失败')
  app.quit()
})

app.on('before-quit', () => {
  const processHandle = localCliProcess
  if (!processHandle) return
  localCliProcess = null
  void processHandle.api.then((cli) => cli.stop()).catch(() => processHandle.child.kill('SIGTERM'))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

module.exports = { cliCommand, resolveWorkspaceRoot }
