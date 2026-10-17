import assert from 'node:assert/strict'
import test from 'node:test'
import { codeLanguageMenuPosition, codeLanguageOptions, codeLanguageLabel } from '../src/code-language-menu.ts'

test('code language menu flips upward when the viewport bottom is too close', () => {
  const position = codeLanguageMenuPosition({ left: 100, top: 900, bottom: 930 }, { width: 1172, height: 1043 })
  assert.equal(position.top, 614)
  assert.equal(position.maxHeight, 280)
})

test('code language menu stays within narrow viewport edges', () => {
  const position = codeLanguageMenuPosition({ left: 300, top: 10, bottom: 30 }, { width: 320, height: 640 })
  assert.equal(position.left, 122)
  assert.equal(position.width, 190)
  assert.equal(position.top, 36)
})

test('code language options expose labels for the custom listbox', () => {
  assert.ok(codeLanguageOptions.length >= 20)
  assert.equal(codeLanguageLabel('javascript'), 'JavaScript')
  assert.equal(codeLanguageLabel('unknown'), 'unknown')
})
