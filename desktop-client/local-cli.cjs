#!/usr/bin/env node

// The desktop shell talks to local files through this small, separately
// launched CLI process. Keeping the file API out of Electron's main process
// makes the local workspace replaceable and gives packaged clients the same
// boundary as a user supplied local CLI.
const readline = require('readline')
const path = require('path')
const { startLocalApi } = require('./local-api.cjs')

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || '' : ''
}

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

async function main() {
  const initialRoot = argumentValue('--root')
  const api = await startLocalApi(initialRoot || null)
  writeEvent({ type: 'ready', baseUrl: api.baseUrl, root: api.root || '', agent: api.agent })

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  let stopping = false
  input.on('line', (line) => {
    let command
    try { command = JSON.parse(line) } catch { writeEvent({ type: 'error', message: '本地 CLI 控制消息格式无效' }); return }
    try {
      if (command?.op === 'set-root' && typeof command.root === 'string' && command.root.trim()) {
        api.setRoot(path.resolve(command.root))
        writeEvent({ type: 'root-changed', root: api.root })
        return
      }
      if (command?.op === 'set-agent' && command.agent && (typeof command.agent === 'string' || typeof command.agent === 'object')) {
        api.setAgent(command.agent)
        writeEvent({ type: 'agent-changed', agent: api.agent })
        return
      }
      writeEvent({ type: 'error', message: '本地控制消息不受支持' })
    } catch (error) {
      writeEvent({ type: 'error', message: error instanceof Error ? error.message : '无法切换本地工作空间' })
    }
  })

  const close = async () => {
    if (stopping) return
    stopping = true
    input.close()
    await api.close()
    process.exit(0)
  }
  input.on('close', () => { void close() })
  process.once('SIGTERM', () => { void close() })
  process.once('SIGINT', () => { void close() })
}

void main().catch((error) => {
  writeEvent({ type: 'error', message: error instanceof Error ? error.message : '本地 CLI 启动失败' })
  process.exitCode = 1
})
