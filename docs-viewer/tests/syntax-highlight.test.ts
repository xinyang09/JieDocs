import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanCodeLanguage,
  inferCodeLanguage,
  highlightCode,
  renderCodeBlockHtml,
  resolveCodeLanguage,
} from '../src/syntax-highlight.ts'

test('cleanCodeLanguage strips prefixes and extra attributes', () => {
  assert.equal(cleanCodeLanguage('language-javascript'), 'javascript')
  assert.equal(cleanCodeLanguage('language-python {1-3}'), 'python')
  assert.equal(cleanCodeLanguage('json:data.json'), 'json')
  assert.equal(cleanCodeLanguage('ts filename="app.ts"'), 'ts')
  assert.equal(cleanCodeLanguage('BASH'), 'bash')
  assert.equal(cleanCodeLanguage(''), '')
  assert.equal(cleanCodeLanguage(undefined), '')
})

test('inferCodeLanguage detects languages accurately', () => {
  assert.equal(inferCodeLanguage('{\n  "name": "fast-note"\n}'), 'json')
  assert.equal(inferCodeLanguage('def greet(name):\n    print(f"hello {name}")'), 'python')
  assert.equal(inferCodeLanguage('const sum = (a: number, b: number): number => a + b'), 'typescript')
  assert.equal(inferCodeLanguage('function run() {\n  console.log("ok");\n}'), 'javascript')
  assert.equal(inferCodeLanguage('#!/usr/bin/env bash\necho "Hello"'), 'bash')
  assert.equal(inferCodeLanguage('curl -X GET https://example.com/api'), 'bash')
  assert.equal(inferCodeLanguage('SELECT * FROM users WHERE active = 1'), 'sql')
  assert.equal(inferCodeLanguage('package main\n\nfunc main() {}'), 'go')
  assert.equal(inferCodeLanguage('fn main() {\n    let mut x = 1;\n}'), 'rust')
  assert.equal(inferCodeLanguage('server:\n  port: 9000'), 'yaml')
})

test('highlightCode highlights supported languages with token spans', () => {
  const jsHtml = highlightCode('const a = 123;', 'js')
  assert.ok(jsHtml.includes('token keyword'), 'JS should contain keyword token')
  assert.ok(jsHtml.includes('token number'), 'JS should contain number token')

  const pyHtml = highlightCode('def hello():\n    return "world"', 'py')
  assert.ok(pyHtml.includes('token keyword'), 'Python should contain keyword token')
  assert.ok(pyHtml.includes('token function'), 'Python should contain function token')

  const bashHtml = highlightCode('#!/bin/bash\necho "hello"', 'bash')
  assert.ok(bashHtml.includes('token shebang'), 'Bash should contain shebang token')

  const jsonHtml = highlightCode('{\n  "key": true\n}', 'json')
  assert.ok(jsonHtml.includes('token property'), 'JSON should contain property token')
  assert.ok(jsonHtml.includes('token boolean'), 'JSON should contain boolean token')

  const diffHtml = highlightCode('-old line\n+new line', 'diff')
  assert.ok(diffHtml.includes('token deleted') || diffHtml.includes('token prefix deleted'), 'Diff should contain deleted token')
  assert.ok(diffHtml.includes('token inserted') || diffHtml.includes('token prefix inserted'), 'Diff should contain inserted token')
})

test('renderCodeBlockHtml generates valid HTML with copy button and code classes', () => {
  const html = renderCodeBlockHtml('const x = 1;', 'typescript', true)
  assert.ok(html.includes('class="code-block"'), 'Should contain code-block class')
  assert.ok(html.includes('data-lang="typescript"'), 'Should store data-lang')
  assert.ok(html.includes('class="code-block-header" contenteditable="false"'), 'Header should be contenteditable=false for editable blocks')
  assert.ok(html.includes('class="code-block-copy-btn"'), 'Should contain copy button')
  assert.ok(html.includes('class="language-typescript"'), 'Should set language class on code')
  assert.ok(html.includes('token keyword'), 'Should have token spans')
})

test('renderCodeBlockHtml handles language fallback and inference', () => {
  const inferredHtml = renderCodeBlockHtml('curl -fsSL https://get.pnpm.io/install.sh | sh', '', true)
  assert.ok(inferredHtml.includes('data-action="open-code-language"'), 'Should provide a language selector for editable blocks')
  assert.ok(inferredHtml.includes('data-code-language-label>bash</span>'), 'Should show inferred bash language')
  assert.ok(!inferredHtml.includes('<select'), 'Should not use a native select')
  assert.ok(!inferredHtml.includes('role="listbox"'), 'Should render the listbox outside the code block')
  assert.ok(inferredHtml.includes('token function'), 'Should highlight inferred bash')
})
test("resolveCodeLanguage fixes mismatched yaml/markdown tags for python code", () => {
  const pythonSnippet = "from fastapi import FastAPI, HTTPException\napp = FastAPI()"
  const resolved = resolveCodeLanguage(pythonSnippet, "yaml")
  assert.equal(resolved.activeLang, "python")
  assert.equal(resolved.displayLang, "python")

  const html = renderCodeBlockHtml(pythonSnippet, "yaml", true)
  assert.ok(html.includes("data-lang=\"python\""), "Should correct data-lang to python")
  assert.ok(html.includes("token keyword"), "Should contain python keyword tokens")
  assert.ok(html.includes("from"), "Should contain code")
})
