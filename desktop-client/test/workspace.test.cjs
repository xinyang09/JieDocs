const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const path = require('path')
const { resolveWorkspaceRoot } = require('../workspace.cjs')

test('uses an explicitly configured workspace when supplied', () => {
  const configured = path.join(os.tmpdir(), 'fns-configured-workspace')
  assert.equal(resolveWorkspaceRoot({ env: { FNS_LOCAL_VAULT: configured }, cwd: '/tmp/other-space' }), path.resolve(configured))
})

test('starts without a workspace when no folder was selected', () => {
  assert.equal(resolveWorkspaceRoot({ env: {} }), '')
})
