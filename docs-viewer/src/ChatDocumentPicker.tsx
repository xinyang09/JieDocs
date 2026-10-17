import { useEffect, useRef, useState } from 'react'
import { Check, FileText, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { fnsApi } from './api'
import { chatDocumentKey, maxChatDocuments, type ChatDocument } from './chat-documents'
import type { Connection, NoteSummary } from './types'
import './chat-documents.css'

export function ChatDocumentChips({ documents, disabled, label = '本次引用', onRemove }: {
  documents: ChatDocument[]
  disabled?: boolean
  label?: string
  onRemove: (document: ChatDocument) => void
}) {
  if (!documents.length) return null
  return <div className="ai-document-chips" aria-label={label}>
    {label ? <span className="ai-document-chip-label">{label}</span> : null}
    {documents.map((document) => <span className="ai-document-chip" key={chatDocumentKey(document)} title={`${document.vault}/${document.path}`}>
      <FileText size={13} /><span>{document.path.split('/').pop()}</span>
      <button type="button" disabled={disabled} onClick={() => onRemove(document)} aria-label={`移除引用文档：${document.path}`}><X size={12} /></button>
    </span>)}
  </div>
}

export function ChatDocumentPicker({ connection, vault, documents, disabled, onChange, onOpen, compact = false, iconOnly = false }: {
  connection: Connection
  vault: string
  documents: ChatDocument[]
  disabled: boolean
  onChange: (documents: ChatDocument[]) => void
  onOpen: () => void
  compact?: boolean
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const visible = notes.filter((note) => note.path.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setNotes([])
    setError('')
    setLoading(Boolean(vault))
    if (vault) void fnsApi.getNotes(connection, vault).then((result) => {
      if (!cancelled) setNotes(result)
    }).catch((reason: Error) => {
      if (!cancelled) setError(reason.message || '无法加载文档列表')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, connection, vault, revision])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  function toggleDocument(document: ChatDocument) {
    if (disabled) return
    const key = chatDocumentKey(document)
    onChange(documents.some((item) => chatDocumentKey(item) === key)
      ? documents.filter((item) => chatDocumentKey(item) !== key)
      : [...documents, document].slice(0, maxChatDocuments))
  }

  const triggerLabel = compact || iconOnly ? '添加引用文档' : '引用文档'

  return <div ref={wrapper} className={`ai-document-picker${compact ? ' is-reference-panel' : ''}`}>
    <button ref={trigger} type="button" className={`ai-document-trigger${iconOnly ? ' is-icon-only' : ''}`} disabled={disabled} aria-label={triggerLabel} title={iconOnly || compact ? triggerLabel : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) { onOpen(); setQuery('') }; setOpen((current) => !current) }}><Plus size={compact ? 18 : 15} />{compact || iconOnly ? null : <span>引用文档</span>}</button>
    {open ? <section className="ai-document-popover" role="dialog" aria-label="选择引用文档">
      <header><strong>引用文档</strong><button type="button" className="icon-button compact" onClick={() => { setOpen(false); trigger.current?.focus() }} aria-label="关闭文档选择"><X size={14} /></button></header>
      <p className="ai-document-scope">{vault || '未选择知识库'} · 已选 {documents.length}/{maxChatDocuments}</p>
      <label className="ai-document-search"><Search size={14} /><input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文档标题或路径" aria-label="搜索引用文档" /></label>
      <div className="ai-document-options">
        {loading ? <p className="ai-document-status" role="status"><LoaderCircle size={14} className="spin" />正在读取文档列表…</p> : error ? <p className="ai-document-status" role="alert">{error}</p> : !vault ? <p className="ai-document-status">请先在文档知识库中选择一个知识库。</p> : !visible.length ? <p className="ai-document-status">{query ? '没有匹配的文档' : '此知识库暂无文档'}</p> : visible.slice(0, 100).map((note) => {
          const document = { vault, path: note.path }
          const selected = documents.some((item) => chatDocumentKey(item) === chatDocumentKey(document))
          return <button type="button" key={note.path} className={`ai-document-option ${selected ? 'is-selected' : ''}`} aria-pressed={selected} disabled={disabled || (!selected && documents.length >= maxChatDocuments)} onClick={() => toggleDocument(document)}>
            <FileText size={16} /><span><strong>{note.path.split('/').pop()?.replace(/\.md$/i, '')}</strong><small>{note.path}</small></span>{selected ? <Check size={15} /> : null}
          </button>
        })}
        {visible.length > 100 ? <p className="ai-document-status">显示前 100 篇，请搜索以缩小范围。</p> : null}
      </div>
      <footer><small>仅发送你选中的文档，不会修改原文。</small><button type="button" disabled={loading} onClick={() => setRevision((current) => current + 1)}>刷新</button></footer>
    </section> : null}
  </div>
}
