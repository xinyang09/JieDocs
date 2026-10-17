const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

function startCli(root, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'local-cli.cjs'), '--root', root], { env: { ...process.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  const events = []
  const waiters = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const event = JSON.parse(line)
      const waiter = waiters.get(event.type)
      if (waiter) { waiters.delete(event.type); waiter(event) } else events.push(event)
    }
  })
  const waitFor = (type) => new Promise((resolve, reject) => {
    const queued = events.findIndex((event) => event.type === type)
    if (queued >= 0) return resolve(events.splice(queued, 1)[0])
    const timer = setTimeout(() => { waiters.delete(type); reject(new Error(`等待 ${type} 超时`)) }, 3000)
    waiters.set(type, (event) => { clearTimeout(timer); resolve(event) })
  })
  return { child, waitFor }
}

test('local CLI serves and switches the local Markdown workspace', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fns-cli-test-'))
  const first = path.join(root, 'first')
  const second = path.join(root, 'second')
  fs.mkdirSync(first)
  fs.mkdirSync(second)
  fs.writeFileSync(path.join(first, 'first.md'), '# first\n')
  fs.writeFileSync(path.join(second, 'second.md'), '# second\n')
  const cli = startCli(first)
  try {
    const ready = await cli.waitFor('ready')
    const firstVault = await fetch(`${ready.baseUrl}/api/vault`).then((response) => response.json())
    assert.equal(firstVault.data[0].vault, 'first')

    cli.child.stdin.write(`${JSON.stringify({ op: 'set-root', root: second })}\n`)
    const changed = await cli.waitFor('root-changed')
    assert.equal(changed.root, second)
    const notes = await fetch(`${ready.baseUrl}/api/notes`).then((response) => response.json())
    assert.deepEqual(notes.data.list.map((item) => item.path), ['second.md'])
  } finally {
    cli.child.kill('SIGTERM')
    await new Promise((resolve) => cli.child.once('exit', resolve))
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('local AI endpoint runs the computer-local agent in the selected workspace', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fns-agent-test-'))
  const agent = path.join(root, 'fake-agent')
  fs.writeFileSync(agent, '#!/bin/sh\nprintf \'{"type":"message_end","message":{"role":"assistant","content":"本地智能体回答"}}\\n\'\n')
  fs.chmodSync(agent, 0o755)
  const cli = startCli(root, { FNS_LOCAL_AGENT: agent })
  try {
    const ready = await cli.waitFor('ready')
    const response = await fetch(`${ready.baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: { type: 'answer', instruction: '回答问题' },
        context: { requestId: 'agent-test', selection: { text: '本地文档' }, references: [], permissions: { noteRead: true, noteWrite: false, noteDelete: false } },
        options: { stream: false },
        idempotencyKey: 'agent-test',
      }),
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.data.answer, '本地智能体回答')
  } finally {
    cli.child.kill('SIGTERM')
    await new Promise((resolve) => cli.child.once('exit', resolve))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
