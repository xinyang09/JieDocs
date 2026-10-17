const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { discoverLocalAgents } = require('../agent-discovery.cjs')

test('discovers Pi and marks it as the supported local agent adapter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fns-agent-discovery-'))
  const pi = path.join(dir, 'pi')
  fs.writeFileSync(pi, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(pi, 0o755)
  try {
    const agents = discoverLocalAgents({ env: { PATH: dir } })
    assert.equal(agents[0].id, 'pi')
    assert.equal(agents[0].label, 'Pi')
    assert.equal(agents[0].command, pi)
    assert.equal(agents[0].adapter, 'pi')
    assert.equal(agents[0].supported, true)
    assert.equal(agents[0].detected, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
