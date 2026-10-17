import { useMemo, useReducer, useRef, useState } from 'react'
import { Check, Clipboard, LoaderCircle, RefreshCw, Send, X } from 'lucide-react'
import type { Connection } from './types.ts'
import type { AIAction, AIProposal } from './ai-contract.ts'
import { buildEditorAIContext } from './ai-context.ts'
import { executeAI } from './ai-stream.ts'
import { createAISurfaceState, reduceAISurfaceState, selectionAIAction, type AISurfaceEntrypoint, type AISurfaceSelection, type AISurfaceSelectionAction, type AISurfaceState } from './ai-surface-state.ts'
import type { NoteSnapshot } from './ai-proposals.ts'
import './ai-surface.css'

export type AiSurfaceProps = {
  connection: Connection
  vault: string
  note?: NoteSnapshot
  selection?: AISurfaceSelection
  selectionAction?: AISurfaceSelectionAction
  entrypoint: AISurfaceEntrypoint
  onCommit: (proposal: AIProposal) => Promise<void>
  onAppend?: (answer: string) => Promise<void>
  onClose?: () => void
}

function idempotencyKey() {
  try { return `ai-${crypto.randomUUID()}` } catch { return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

function initialState(props: AiSurfaceProps) {
  return createAISurfaceState({ entrypoint: props.entrypoint, selection: props.selection })
}

function actionFor(props: AiSurfaceProps, instruction: string): AIAction {
  if (props.entrypoint === 'selection' && props.selection) return selectionAIAction(props.selectionAction, instruction)
  return { type: 'answer', instruction }
}

export default function AiSurface(props: AiSurfaceProps) {
  const [state, dispatch] = useReducer(reduceAISurfaceState, props, initialState)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const context = useMemo(() => buildEditorAIContext({
    vault: props.vault,
    activeNote: props.note?.path ? props.note as { path: string; content: string; contentHash: string; version: number } : undefined,
    selection: props.selection,
  }), [props.vault, props.note, props.selection])

  async function run() {
    const text = instruction.trim()
    if (!text || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    dispatch({ type: 'start', requestId: context.requestId })
    try {
      await executeAI(props.connection, {
        action: actionFor(props, text),
        context,
        options: { stream: true },
        idempotencyKey: idempotencyKey(),
      }, { onEvent: (event) => dispatch(event) }, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) dispatch({ type: 'error', code: 'request_failed', message: error instanceof Error ? error.message : 'AI 请求失败。', retryable: true })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function copyAnswer() {
    if (!state.answer) return
    await navigator.clipboard?.writeText(state.answer)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  async function acceptProposal() {
    if (!state.proposal || busy) return
    setBusy(true)
    try { await props.onCommit(state.proposal) } finally { setBusy(false) }
  }

  async function appendAnswer() {
    if (!state.answer || !props.onAppend || busy) return
    setBusy(true)
    try { await props.onAppend(state.answer) } finally { setBusy(false) }
  }

  const proposal = state.proposal
  return <aside className="ai-surface" aria-label="AI 工作区">
    <header className="ai-surface-header">
      <div><strong>AI 助手</strong><span className="ai-surface-context">{state.contextLabel}</span></div>
      {props.onClose ? <button type="button" className="icon-button compact" onClick={props.onClose} aria-label="关闭 AI 助手"><X size={15} /></button> : null}
    </header>
    <div className="ai-surface-log" role="log" aria-live="polite" aria-label="AI 回复">
      {state.status === 'idle' ? <p className="ai-surface-empty">输入问题，AI 会基于当前上下文回答。</p> : null}
      {state.answer ? <div className="ai-surface-answer">{state.answer}</div> : null}
      {state.status === 'running' && !state.answer ? <p className="ai-surface-pending"><LoaderCircle size={15} className="spin" />正在生成…</p> : null}
      {state.error ? <p className="ai-surface-error" role="alert">{state.error.message}</p> : null}
      {state.citations.length ? <div className="ai-surface-citations" aria-label="引用来源">{state.citations.map((citation) => <span key={`${citation.vault}/${citation.path}`}>{citation.vault}/{citation.path}</span>)}</div> : null}
      {proposal ? <section className="ai-surface-proposal" aria-label="修改预览"><strong>修改预览</strong><p>{proposal.summary}</p><div className="ai-surface-proposal-actions"><button type="button" onClick={() => void acceptProposal()} disabled={!state.actions.accept || busy}><Check size={14} />接受修改</button><button type="button" onClick={() => dispatch({ type: 'start' })} disabled={busy}>重新生成</button></div></section> : null}
    </div>
    <footer className="ai-surface-composer">
      <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={4000} rows={3} disabled={busy} placeholder={props.entrypoint === 'selection' ? '告诉 AI 如何改写选区…' : '问 AI 一个问题…'} aria-label="AI 指令" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void run() } }} />
      <div className="ai-surface-toolbar"><span>{state.contextLabel}</span><div><button type="button" onClick={() => void copyAnswer()} disabled={!state.actions.copy} aria-label="复制 AI 回复">{copied ? <Check size={14} /> : <Clipboard size={14} />}</button>{props.onAppend ? <button type="button" onClick={() => void appendAnswer()} disabled={!state.actions.append}>插入文末</button> : null}{busy ? <button type="button" onClick={() => abortRef.current?.abort()} aria-label="停止生成"><X size={14} /></button> : <button type="button" onClick={() => void run()} disabled={!instruction.trim()} aria-label="发送 AI 指令"><Send size={14} /></button>}</div></div>
    </footer>
  </aside>
}
