import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, LoaderCircle, Plus, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { runPiAssistant } from './api'
import type { Connection } from './types'
import './inline-ai.css'

export type InlineAiAction = 'ask' | 'rewrite' | 'shorten' | 'translate'

export type InlineAiRequest = {
  id: number
  text: string
  action: InlineAiAction
  /** UTF-16 range in the complete raw Markdown document when available. */
  start?: number
  end?: number
}

type InlineAiAssistantProps = {
  request: InlineAiRequest
  noteTitle: string
  onReplaceSelection: (selected: string, replacement: string) => Promise<void>
  onAppendResult: (content: string) => Promise<void>
  onClose: () => void
  connection?: Connection
  vault?: string
}

const actionLabels: Record<InlineAiAction, string> = {
  ask: '问 AI',
  rewrite: '改写',
  shorten: '精简',
  translate: '翻译',
}

function makeInstruction(action: InlineAiAction, selected: string, noteTitle: string, customInstruction = '') {
  const instruction = customInstruction.trim() || ({
    ask: '解释这段内容，并指出其中最值得注意的地方。',
    rewrite: '改写这段文字，让表达更清晰、自然，保留原意。',
    shorten: '把这段文字精简到原长度的 50% 左右，保留关键信息。',
    translate: '将这段文字翻译成英文。',
  } satisfies Record<InlineAiAction, string>)[action]
  const outputRule = action === 'ask'
    ? '可以分点回答，但要直接回答问题。'
    : '只返回处理后的文本，不要解释、客套话或 Markdown 代码围栏。'
  return `你正在编辑一篇名为“${noteTitle}”的笔记。\n\n【任务】\n${instruction}\n\n【选中文本】\n${selected}\n\n【输出要求】\n${outputRule}`
}

export default function InlineAiAssistant({ request, noteTitle, onReplaceSelection, onAppendResult, onClose, connection, vault }: InlineAiAssistantProps) {
  const [action, setAction] = useState<InlineAiAction>(request.action)
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error' | 'applied'>('idle')
  const [error, setError] = useState('')
  const [isCopied, setIsCopied] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [appliedLabel, setAppliedLabel] = useState('已替换选区')
  const requestRef = useRef<AbortController | null>(null)
  const selectedPreview = useMemo(() => request.text.replace(/\s+/g, ' ').trim(), [request.text])
  const isEditableAction = action !== 'ask'

  async function generate(nextAction = action) {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setStatus('running')
    setError('')
    setResult('')
    setIsCopied(false)
    try {
      const text = await runPiAssistant(
        makeInstruction(nextAction, request.text, noteTitle, instruction),
        '',
        noteTitle,
        undefined,
        { signal: controller.signal, connection, vault },
      )
      if (!controller.signal.aborted) {
        setResult(text.trim())
        setStatus('done')
      }
    } catch (reason) {
      if (controller.signal.aborted) return
      setError(reason instanceof Error ? reason.message : 'AI 请求失败，请稍后重试。')
      setStatus('error')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }

  useEffect(() => {
    setAction(request.action)
    setInstruction('')
    void generate(request.action)
    return () => requestRef.current?.abort()
    // The request id is the explicit reset boundary for a new selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id])

  async function applyResult() {
    if (!result.trim() || !isEditableAction || isApplying) return
    setIsApplying(true)
    setError('')
    try {
      await onReplaceSelection(request.text, result.trim())
      setAppliedLabel('已替换选区')
      setStatus('applied')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '应用修改失败，请重新选择后再试。')
    } finally {
      setIsApplying(false)
    }
  }

  async function copyResult() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setIsCopied(true)
      window.setTimeout(() => setIsCopied(false), 1600)
    } catch {
      setError('复制失败，请手动选择结果文本。')
    }
  }

  async function appendResult() {
    if (!result.trim() || isApplying) return
    setIsApplying(true)
    setError('')
    try {
      await onAppendResult(result.trim())
      setAppliedLabel('已插入文末')
      setStatus('applied')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '插入文末失败。')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <aside className="inline-ai-panel" aria-label="选区 AI 助手">
      <header className="inline-ai-panel-header">
        <div className="inline-ai-panel-title"><span className="inline-ai-panel-icon"><Sparkles size={14} /></span><div><strong>AI 编辑</strong><small>选中文本 · {actionLabels[action]}</small></div></div>
        <button type="button" className="inline-ai-icon-button" onClick={onClose} aria-label="关闭 AI 编辑"><X size={15} /></button>
      </header>
      <div className="inline-ai-panel-body">
        <div className="inline-ai-action-tabs" role="tablist" aria-label="AI 操作">
          {(Object.keys(actionLabels) as InlineAiAction[]).map((item) => (
            <button type="button" role="tab" aria-selected={action === item} className={action === item ? 'is-active' : ''} key={item} onClick={() => { setAction(item); void generate(item) }} disabled={status === 'running'}>{actionLabels[item]}</button>
          ))}
        </div>
        <div className="inline-ai-selection-preview"><span>选中文本</span><p>{selectedPreview || '（空文本）'}</p></div>
        <label className="inline-ai-instruction"><span>补充要求 <em>可选</em></span><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void generate() } }} placeholder="告诉 AI 你希望怎么处理…" rows={2} disabled={status === 'running'} /></label>
        <div className="inline-ai-result-label"><span>{status === 'applied' ? '已应用到笔记' : isEditableAction ? '修改预览' : 'AI 回复'}</span>{status === 'running' ? <span className="inline-ai-running"><LoaderCircle size={12} className="spin" />生成中</span> : null}</div>
        <div className={`inline-ai-result ${status === 'running' ? 'is-running' : ''}`} aria-live="polite">
          {status === 'running' && !result ? <span className="inline-ai-placeholder"><LoaderCircle size={15} className="spin" />正在生成建议…</span> : result || (status === 'error' ? '没有生成结果。' : 'AI 的结果会显示在这里。')}
        </div>
        {error ? <p className="inline-ai-error" role="alert">{error}</p> : null}
      </div>
      <footer className="inline-ai-panel-footer">
        {status === 'applied' ? <span className="inline-ai-applied"><Check size={13} />{appliedLabel}</span> : <>
          <button type="button" className="inline-ai-secondary" onClick={() => void generate()} disabled={status === 'running'}><RefreshCw size={13} />重试</button>
          {result ? <button type="button" className="inline-ai-secondary" onClick={() => void copyResult()} disabled={status === 'running'}>{isCopied ? <Check size={13} /> : <Clipboard size={13} />}{isCopied ? '已复制' : '复制'}</button> : null}
          {isEditableAction ? <button type="button" className="inline-ai-primary" onClick={() => void applyResult()} disabled={!result || status === 'running' || isApplying}><Check size={13} />{isApplying ? '写入中' : '替换选区'}</button> : null}
          {action === 'ask' && result ? <button type="button" className="inline-ai-secondary" onClick={() => void appendResult()} disabled={isApplying}><Plus size={13} />插入文末</button> : null}
        </>}
        <span className="inline-ai-shortcut"><Send size={11} />⌘/Ctrl + Enter 生成</span>
      </footer>
    </aside>
  )
}
