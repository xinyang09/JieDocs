import type { AICitation, AIAction, AIProposal, AIStreamEvent } from './ai-contract.ts'

export type AISurfaceEntrypoint = 'selection' | 'note' | 'global'
export type AISurfaceSelectionAction = 'ask' | 'rewrite' | 'shorten' | 'translate'
export type AISurfaceStatus = 'idle' | 'running' | 'answer' | 'proposal' | 'error' | 'cancelled'
export type AISurfaceSelection = { text: string; start: number; end: number; blockId?: string }

export type AISurfaceActions = {
  accept: boolean
  append: boolean
  copy: boolean
  retry: boolean
  discard: boolean
  undo: boolean
}

export type AISurfaceState = {
  entrypoint: AISurfaceEntrypoint
  contextLabel: string
  selection?: AISurfaceSelection
  status: AISurfaceStatus
  answer: string
  citations: AICitation[]
  proposal?: AIProposal
  proposalId?: string
  error?: { code?: string; message: string; retryable: boolean }
  requestId?: string
  actions: AISurfaceActions
}

export type AISurfaceEvent = AIStreamEvent | { type: 'start'; requestId?: string } | { type: 'proposal'; proposal?: AIProposal; proposalId?: string }

/** Map the editor's selection toolbar action to the canonical AI contract. */
export function selectionAIAction(action: AISurfaceSelectionAction | undefined, instruction: string): AIAction {
  switch (action) {
    case 'ask':
      return { type: 'answer', instruction }
    case 'translate':
      return { type: 'translate', target: 'selection', language: 'English', instruction }
    case 'shorten':
      return { type: 'rewrite', target: 'selection', instruction: `精简选区内容，保留关键信息。${instruction ? `\n${instruction}` : ''}` }
    default:
      return { type: 'rewrite', target: 'selection', instruction }
  }
}

function defaultActions(): AISurfaceActions {
  return { accept: false, append: false, copy: false, retry: false, discard: false, undo: false }
}

function actionState(state: AISurfaceState): AISurfaceActions {
  const hasAnswer = Boolean(state.answer)
  const hasProposal = Boolean(state.proposal || state.proposalId)
  const terminal = state.status !== 'running'
  return {
    accept: hasProposal && terminal,
    append: hasAnswer && terminal,
    copy: hasAnswer || hasProposal,
    retry: state.status === 'error' || state.status === 'cancelled',
    discard: hasProposal && terminal,
    undo: false,
  }
}

function contextLabel(entrypoint: AISurfaceEntrypoint, selection?: AISurfaceSelection) {
  if (entrypoint === 'selection' && selection) return `选区 · ${Math.max(0, selection.end - selection.start)} 个字符`
  if (entrypoint === 'note') return '当前文档'
  return '全局对话'
}

export function createAISurfaceState(input: { entrypoint: AISurfaceEntrypoint; selection?: AISurfaceSelection; requestId?: string }): AISurfaceState {
  const state: AISurfaceState = {
    entrypoint: input.entrypoint,
    contextLabel: contextLabel(input.entrypoint, input.selection),
    selection: input.selection,
    status: 'idle',
    answer: '',
    citations: [],
    requestId: input.requestId,
    actions: defaultActions(),
  }
  return { ...state, actions: actionState(state) }
}

export function reduceAISurfaceState(state: AISurfaceState, event: AISurfaceEvent): AISurfaceState {
  let next: AISurfaceState = { ...state }
  switch (event.type) {
    case 'start':
      next.status = 'running'
      next.requestId = event.requestId || state.requestId
      next.answer = ''
      next.citations = []
      next.proposal = undefined
      next.proposalId = undefined
      next.error = undefined
      break
    case 'meta':
      next.requestId = event.requestId
      break
    case 'context':
      break
    case 'delta':
      next.status = 'running'
      // The server emits deltas as append-only fragments. A compatibility
      // proxy may send the complete answer; detect that shape cheaply.
      next.answer = event.text.startsWith(next.answer) ? event.text : `${next.answer}${event.text}`
      break
    case 'citation':
      if (!next.citations.some((citation) => citation.vault === event.citation.vault && citation.path === event.citation.path && citation.excerpt === event.citation.excerpt)) next.citations = [...next.citations, event.citation]
      break
    case 'proposal':
      next.status = 'proposal'
      next.proposal = event.proposal
      next.proposalId = event.proposal?.id || ('proposalId' in event ? event.proposalId : undefined)
      break
    case 'usage':
      break
    case 'done':
      next.status = event.result.status === 'proposal' ? 'proposal' : event.result.status === 'cancelled' ? 'cancelled' : event.result.status === 'error' ? 'error' : 'answer'
      next.answer = event.result.answer ?? next.answer
      next.proposal = event.result.proposal ?? next.proposal
      next.proposalId = next.proposal?.id || next.proposalId
      next.citations = event.result.citations?.length ? event.result.citations : next.citations
      next.requestId = event.result.requestId || next.requestId
      next.error = event.result.error
      break
    case 'error':
      next.status = 'error'
      next.error = { code: event.code, message: event.message, retryable: event.retryable }
      break
  }
  return { ...next, actions: actionState(next) }
}

export function setAISurfaceUndoable(state: AISurfaceState, enabled: boolean) {
  return { ...state, actions: { ...state.actions, undo: enabled } }
}
