import assert from 'node:assert/strict'
import test from 'node:test'
import { filterAICommands, moveAICommand, parseSlashCommand } from '../src/ai-command-palette.ts'

test('filters and parses slash commands', () => {
  assert.equal(filterAICommands('/改写').length, 1)
  const parsed = parseSlashCommand('/rewrite 保留语气')
  assert.equal(parsed?.command.id, 'rewrite')
  assert.equal(parsed?.instruction, '保留语气')
})
test('keeps palette keyboard index in bounds', () => {
  assert.equal(moveAICommand(0, 'up', 3), 0)
  assert.equal(moveAICommand(2, 'down', 3), 2)
})
