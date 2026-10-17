import { useState, useMemo, type ComponentPropsWithoutRef } from 'react'
import { Check, Copy } from 'lucide-react'
import Prism from 'prismjs'

// 1. Core grammars & base dependencies
import 'prismjs/components/prism-clike.js'
import 'prismjs/components/prism-markup.js'
import 'prismjs/components/prism-css.js'
import 'prismjs/components/prism-javascript.js'

// 2. Languages depending on javascript / markup
import 'prismjs/components/prism-typescript.js'
import 'prismjs/components/prism-jsx.js'
import 'prismjs/components/prism-tsx.js'
import 'prismjs/components/prism-markup-templating.js'

// 3. Languages depending on clike
import 'prismjs/components/prism-c.js'
import 'prismjs/components/prism-cpp.js'
import 'prismjs/components/prism-csharp.js'
import 'prismjs/components/prism-java.js'
import 'prismjs/components/prism-php.js'
import 'prismjs/components/prism-kotlin.js'
import 'prismjs/components/prism-swift.js'
import 'prismjs/components/prism-dart.js'
import 'prismjs/components/prism-scala.js'
import 'prismjs/components/prism-groovy.js'

// 4. Other key languages & configuration formats
import 'prismjs/components/prism-python.js'
import 'prismjs/components/prism-bash.js'
import 'prismjs/components/prism-ruby.js'
import 'prismjs/components/prism-docker.js'
import 'prismjs/components/prism-json.js'
import 'prismjs/components/prism-json5.js'
import 'prismjs/components/prism-yaml.js'
import 'prismjs/components/prism-sql.js'
import 'prismjs/components/prism-go.js'
import 'prismjs/components/prism-rust.js'
import 'prismjs/components/prism-scss.js'
import 'prismjs/components/prism-less.js'
import 'prismjs/components/prism-toml.js'
import 'prismjs/components/prism-ini.js'
import 'prismjs/components/prism-powershell.js'
import 'prismjs/components/prism-nginx.js'
import 'prismjs/components/prism-makefile.js'
import 'prismjs/components/prism-lua.js'
import 'prismjs/components/prism-r.js'
import 'prismjs/components/prism-perl.js'
import 'prismjs/components/prism-regex.js'
import 'prismjs/components/prism-visual-basic.js'
import 'prismjs/components/prism-git.js'
import 'prismjs/components/prism-markdown.js'
import 'prismjs/components/prism-diff.js'

export const prismLanguageAliases: Record<string, string> = {
  // Web
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  svelte: 'markup',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  json: 'json',
  json5: 'json5',
  jsonc: 'json',

  // Backend / Systems
  py: 'python',
  python: 'python',
  python3: 'python',
  py3: 'python',
  rb: 'ruby',
  ruby: 'ruby',
  shell: 'bash',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  console: 'bash',
  terminal: 'bash',
  golang: 'go',
  go: 'go',
  rs: 'rust',
  rust: 'rust',
  c: 'c',
  cpp: 'cpp',
  cplusplus: 'cpp',
  'c++': 'cpp',
  cs: 'csharp',
  csharp: 'csharp',
  'c#': 'csharp',
  dotnet: 'csharp',
  java: 'java',
  php: 'php',
  kt: 'kotlin',
  kotlin: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  flutter: 'dart',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  perl: 'perl',
  pl: 'perl',
  groovy: 'groovy',
  gradle: 'groovy',
  vb: 'visual-basic',
  vba: 'visual-basic',

  // Config / Data / Infra
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  config: 'ini',
  properties: 'ini',
  docker: 'docker',
  dockerfile: 'docker',
  sql: 'sql',
  mysql: 'sql',
  pgsql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  sqlite: 'sql',
  ps1: 'powershell',
  powershell: 'powershell',
  ps: 'powershell',
  nginx: 'nginx',
  nginxconf: 'nginx',
  makefile: 'makefile',
  make: 'makefile',
  mk: 'makefile',
  git: 'git',
  gitignore: 'git',
  diff: 'diff',
  patch: 'diff',
  md: 'markdown',
  markdown: 'markdown',
}

/**
 * Normalizes raw code block language strings (e.g. from ```python {1-3} or language-json:data.json)
 */
export function cleanCodeLanguage(raw?: string): string {
  if (!raw) return ''
  return raw
    .trim()
    .replace(/^language-/, '')
    .split(/[\s:{[(]/)[0]
    .toLowerCase()
}

/**
 * Heuristically infers the programming language from code text when not explicitly specified
 */
export function inferCodeLanguage(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''

  // JSON
  if (/^[{\[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // not strict JSON, continue
    }
  }

  // HTML / XML
  if (/^(?:<!DOCTYPE|<html|<\?xml|<div|<svg|<template)\b/i.test(trimmed)) {
    return 'markup'
  }

  // Bash / Shell
  if (/^\s*(?:#!\/(?:usr\/)?bin\/(?:bash|sh|zsh)|curl\s+|wget\s+|npm\s+(?:run|install|i|test)|pnpm\s+|yarn\s+|git\s+(?:commit|push|pull|status|checkout|add)|docker\s+|kubectl\s+|brew\s+|chmod\s+|sudo\s+|export\s+\w+=|echo\s+)/m.test(trimmed)) {
    return 'bash'
  }

  // Python
  if (/^\s*(?:def\s+\w+\s*\(|class\s+\w+.*:|import\s+[\w.]+(\s+as\s+\w+)?|from\s+[\w.]+\s+import|if\s+__name__\s*==\s*['"]__main__['"]|for\s+\w+\s+in\s+.*:|print\s*\(|@(?:app|router)\.\w+\()/m.test(trimmed)) {
    return 'python'
  }

  // TypeScript / JavaScript
  if (/^\s*(?:import\s+.*\s+from\s+['"]|export\s+(?:default\s+|const\s+|function\s+|class\s+|interface\s+|type\s+)|function\s+\w+\s*\(|const\s+\w+\s*[:=]|let\s+\w+\s*[:=]|console\.(?:log|error|warn)\()/m.test(trimmed)) {
    if (/\b(?:interface|type\s+\w+\s*=|as\s+(?:string|number|boolean|any|unknown))\b|:\s*(?:string|number|boolean|void)\b/.test(trimmed)) {
      return 'typescript'
    }
    return 'javascript'
  }

  // Go
  if (/^\s*(?:package\s+\w+|func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s*)?\w+\s*\(|import\s*(?:\(\s*[\s\S]*?\)|"[^"]+"))/m.test(trimmed)) {
    return 'go'
  }

  // Rust
  if (/^\s*(?:fn\s+main\s*\(|pub\s+(?:fn|struct|enum|trait)|impl(?:\s+.*)?\s+for|use\s+std::|let\s+mut\s+)/m.test(trimmed)) {
    return 'rust'
  }

  // SQL
  if (/^\s*(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(trimmed)) {
    return 'sql'
  }

  // CSS
  if (/^\s*(?:@media|@keyframes|\.[a-zA-Z0-9_-]+\s*\{|#[a-zA-Z0-9_-]+\s*\{|[a-z0-9_-]+\s*:\s*[^;]+;)/m.test(trimmed) && /\{[\s\S]*\}/.test(trimmed)) {
    return 'css'
  }

  // YAML
  if (/^\s*(?:[\w-]+:\s*[\w"']+|-\s+[\w-]+:)/m.test(trimmed)) {
    return 'yaml'
  }

  return ''
}

/**
 * Highlights a block of code using Prism.js. Returns empty string if grammar not found or highlight fails.
 */
export function highlightCode(text: string, language?: string): string {
  if (!text) return ''
  const cleanLang = cleanCodeLanguage(language)
  const normalizedLanguage = prismLanguageAliases[cleanLang] || cleanLang
  if (!normalizedLanguage) return ''
  const grammar = Prism.languages[normalizedLanguage]
  if (!grammar) return ''
  try {
    return Prism.highlight(text, grammar, normalizedLanguage)
  } catch (err) {
    console.warn('Highlight failed for language', normalizedLanguage, err)
    return ''
  }
}

/**
 * Resolves the effective language for a code block, handling generic tags and mismatched tags (e.g. ```yaml for python code).
 */
export function resolveCodeLanguage(text: string, rawLanguage?: string): { activeLang: string; displayLang: string } {
  const cleanLang = cleanCodeLanguage(rawLanguage)
  const inferredLang = inferCodeLanguage(text)

  // 1. Generic or missing language tag -> use inferred
  if (!cleanLang || ['text', 'txt', 'plain', 'plaintext', 'none', 'raw', 'code'].includes(cleanLang)) {
    const active = inferredLang || ''
    return { activeLang: active, displayLang: active || cleanLang || 'text' }
  }

  // 2. Mismatched markup/config tag where content is unambiguously programming code
  // E.g. Note 619 had ```yaml for FastAPI Python code (`from fastapi import ...`)
  if (['yaml', 'yml', 'markdown', 'md', 'html', 'xml', 'ini', 'conf'].includes(cleanLang) && inferredLang && inferredLang !== cleanLang) {
    return { activeLang: inferredLang, displayLang: inferredLang }
  }

  // 3. If the specified language grammar doesn't exist in Prism, fallback to inferred
  const normalized = prismLanguageAliases[cleanLang] || cleanLang
  if (!Prism.languages[normalized]) {
    const active = inferredLang || ''
    return { activeLang: active, displayLang: active || cleanLang }
  }

  return { activeLang: cleanLang, displayLang: cleanLang }
}

/**
 * Renders an accessible HTML code block string with syntax highlighting and copy button
 */
export function renderCodeBlockHtml(text: string, rawLanguage?: string, isEditable = false): string {
  const { activeLang, displayLang } = resolveCodeLanguage(text, rawLanguage)
  const highlightedCode = activeLang ? highlightCode(text, activeLang) : ''
  const escapedCode = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const codeContent = highlightedCode || escapedCode
  const langClass = activeLang ? ` class="language-${activeLang}"` : ''
  const copySvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
  const languageControl = isEditable ? `<div class="code-language-menu"><button type="button" class="code-block-language-select" data-action="open-code-language" aria-label="选择代码语言" aria-haspopup="listbox" aria-expanded="false"><span data-code-language-label>${displayLang}</span><span aria-hidden="true">⌄</span></button></div>` : `<span class="code-block-lang">${displayLang}</span>`
  return `<div class="code-block" data-lang="${displayLang}"><div class="code-block-header"${isEditable ? ' contenteditable="false"' : ''}>${languageControl}<button type="button" class="code-block-copy-btn" data-action="copy-code" title="复制代码" aria-label="复制代码">${copySvg}<span>复制</span></button></div><pre tabIndex="0"><code${langClass}>${codeContent}</code></pre></div>`
}
