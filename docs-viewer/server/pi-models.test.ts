import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePiModels } from './pi-models.ts'

test('parses CLI models without headers, diagnostics, duplicates or credentials', () => {
  const output = 'provider model context max-out thinking images\nwarning: diagnostic\n\x1b[32mfirst shared-model 128K 8K yes no\x1b[0m\nfirst shared-model 128K 8K yes no\nsecond shared-model 128K 8K no yes\n'
  assert.deepEqual(parsePiModels(output), [{ provider: 'first', id: 'shared-model' }, { provider: 'second', id: 'shared-model' }])
  assert.deepEqual(parsePiModels('No models available'), [])
})
