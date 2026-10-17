import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, LoaderCircle, X } from 'lucide-react'
import { chatDocumentKey, type ChatDocument } from './chat-documents'
import type { ChatMessage } from './ai-chat'
import { fnsApi } from './api'
import type { Connection } from './types'
import { InlineMarkdownEditor } from './App'
import { EditorDocumentOutline } from './DocumentOutline'

export function ChatReferencePanel({ reply, selectedReply, connection }: {
  reply?: ChatMessage
  selectedReply: boolean
  connection: Connection
}) {
  const [expanded, setExpanded] = useState(true)
  const [preview, setPreview] = useState<(ChatDocument & { content: string; fileLinks?: Record<string, string> }) | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewDialog, setPreviewDialog] = useState<HTMLElement | null>(null)
  const [saveStatusTarget, setSaveStatusTarget] = useState<HTMLSpanElement | null>(null)
  const request = useRef<AbortController | null>(null)
  const sources = reply?.documents || []
  const hasDetails = Boolean(sources.length || reply?.knowledgeSearch)

  function closePreview() {
    request.current?.abort()
    setPreview(null)
  }

  useEffect(() => () => request.current?.abort(), [])

  useEffect(() => {
    if (!preview) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closePreview()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [preview])

  async function openPreview(source: ChatDocument) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPreview({ ...source, content: '' })
    setLoading(true)
    setError('')
    try {
      const note = await fnsApi.getNote(connection, source.vault, source.path, controller.signal)
      if (!controller.signal.aborted) setPreview({ ...source, content: note.content, fileLinks: note.fileLinks })
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取文档')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return <>
    <aside className="ai-reference-rail" aria-label="引用文档浮窗">
      <section className="ai-reference-card">
        <header className="ai-reference-header">
          <button type="button" className="ai-reference-heading" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-label={expanded ? '收起引用文档' : '展开引用文档'}>
            <span>AI 引用来源</span>{hasDetails ? <ChevronDown size={14} className={expanded ? 'is-expanded' : ''} /> : null}
          </button>
        </header>
        <p className="ai-reference-summary">{sources.length ? `本次回答引用了 ${sources.length} 篇文档` : reply?.status === 'pending' ? '正在检索回答来源…' : '本次回答暂无引用文档'}</p>
        {expanded && hasDetails ? <div className="ai-reference-body">
          <section aria-label="回答引用来源">
            {sources.length ? <ul className="ai-reference-list">{sources.map((source) => <li key={chatDocumentKey(source)}>
              <button type="button" className="ai-reference-document-button" onClick={() => void openPreview(source)} title={`预览文档：${source.vault}/${source.path}`}>
                <FileText size={16} /><span><strong>{source.path.split('/').pop()}</strong><small>{source.vault} / {source.path}</small></span>
              </button>
            </li>)}</ul> : <p className="ai-reference-empty">本次未检索到可引用的文档</p>}
          </section>
        </div> : null}
      </section>
    </aside>
    {preview ? <div className="ai-document-preview-backdrop">
      <article ref={setPreviewDialog} className="ai-document-preview-dialog ai-document-preview-edit-dialog" role="dialog" aria-modal="true" aria-label={preview.path}>
        <header>
          <div><strong>{preview.path.split('/').pop()}</strong><small>{preview.vault} / {preview.path}</small></div>
          <div className="ai-document-preview-actions">
            <span ref={setSaveStatusTarget} className="reader-meta-save-status" />
            <button type="button" className="icon-button compact" onClick={closePreview} aria-label="关闭文档编辑"><X size={17} /></button>
          </div>
        </header>
        {loading ? <div className="ai-document-preview-loading" role="status"><LoaderCircle className="spin" size={22} />正在加载文档…</div>
          : error ? <div className="ai-document-preview-content" role="alert"><p className="ai-document-preview-load-error">{error}</p><button type="button" className="secondary-button" onClick={() => void openPreview(preview)}>重新加载</button></div>
          : <>
            <InlineMarkdownEditor
              key={chatDocumentKey(preview)}
              content={preview.content.replace(/^---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, '')}
              connection={connection}
              vault={preview.vault}
              notePath={preview.path}
              fileLinks={preview.fileLinks}
              saveStatusTarget={saveStatusTarget}
              onSave={async (content) => {
                const frontmatter = /^---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(preview.content)?.[0] || ''
                await fnsApi.saveNote(connection, preview.vault, preview.path, `${frontmatter}${content}`)
              }}
            />
            <EditorDocumentOutline container={previewDialog} />
          </>}
      </article>
    </div> : null}
  </>
}
