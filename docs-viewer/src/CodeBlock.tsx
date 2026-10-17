import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { cleanCodeLanguage, resolveCodeLanguage, highlightCode } from './syntax-highlight'
import { codeLanguageLabel, openCodeLanguageMenu } from './code-language-menu'

function LanguageMenu({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const closeMenu = useRef<ReturnType<typeof openCodeLanguageMenu> | undefined>(undefined)
  useEffect(() => () => closeMenu.current?.(), [])
  return <div className="code-language-menu">
    <button type="button" className="code-block-language-select" aria-label="选择代码语言" aria-haspopup="listbox" aria-expanded="false" onClick={(event) => {
      if (event.currentTarget.getAttribute('aria-expanded') === 'true') closeMenu.current?.()
      else closeMenu.current = openCodeLanguageMenu(event.currentTarget, value, onChange)
    }}>{codeLanguageLabel(value)}<ChevronDown size={13} /></button>
  </div>
}

export function HighlightedCodeBlock({ code, language, className }: { code: string; language?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const { activeLang } = useMemo(() => resolveCodeLanguage(code, language || className), [code, language, className])
  const [selectedLanguage, setSelectedLanguage] = useState(activeLang || 'text')
  useEffect(() => setSelectedLanguage(activeLang || 'text'), [activeLang])
  const highlightedCode = useMemo(() => selectedLanguage !== 'text' ? highlightCode(code, selectedLanguage) : '', [code, selectedLanguage])
  async function copyCode() { try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { setCopied(false) } }
  return <div className="code-block" data-lang={selectedLanguage}>
    <div className="code-block-header"><LanguageMenu value={selectedLanguage} onChange={setSelectedLanguage} /><button type="button" className={`code-block-copy-btn${copied ? ' is-copied' : ''}`} onClick={() => void copyCode()} aria-label="复制代码" title="复制代码">{copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? '已复制' : '复制'}</span></button></div>
    <pre tabIndex={0}><code className={`language-${selectedLanguage}`} dangerouslySetInnerHTML={highlightedCode ? { __html: highlightedCode } : undefined}>{highlightedCode ? undefined : code}</code></pre>
  </div>
}

export function CodeBlockComponent({ className, children, isBlock: isBlockProp, node: _node, ...props }: ComponentPropsWithoutRef<'code'> & { isBlock?: boolean; node?: unknown }) {
  const text = String(children).replace(/\n$/, '')
  const specifiedLanguage = cleanCodeLanguage(className)
  const isBlock = Boolean(isBlockProp || specifiedLanguage || text.includes('\n'))
  if (!isBlock) return <code className={className} {...props}>{children}</code>
  return <HighlightedCodeBlock code={text} language={specifiedLanguage} className={className} />
}
