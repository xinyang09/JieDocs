import type { AIProposal, AIPatchOperation } from './ai-contract.ts'
import type { CommitResult } from './ai-stream.ts'

export type NoteSnapshot = {
  vault?: string
  path?: string
  content: string
  contentHash: string
  version: number
}

export type SelectionRange = { text?: string; start: number; end: number; blockId?: string }

export class ProposalConflictError extends Error {
  constructor(message = '文档基线已变化，请刷新后重新生成。') {
    super(message)
    this.name = 'ProposalConflictError'
  }
}

export class ProposalApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProposalApplyError'
  }
}

function validRange(start: number, end: number) {
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start
}

function compareBase(snapshot: NoteSnapshot, proposal: AIProposal) {
  const base = proposal.base.find((target) => (!snapshot.vault || target.vault === snapshot.vault) && (!snapshot.path || target.path === snapshot.path)) || proposal.base[0]
  if (!base || base.contentHash !== snapshot.contentHash || base.version !== snapshot.version) throw new ProposalConflictError()
}

function operationStart(operation: AIPatchOperation) {
  if (operation.op === 'replace-range') return operation.start
  if (operation.op === 'insert') return operation.at
  return Number.POSITIVE_INFINITY
}

function operationEnd(operation: AIPatchOperation) {
  if (operation.op === 'replace-range') return operation.end
  if (operation.op === 'insert') return operation.at
  return Number.POSITIVE_INFINITY
}

/** Build the one-range replacement used by selection rewrite/translate actions. */
export function makeSelectionProposal(snapshot: NoteSnapshot, selection: SelectionRange, generated: string): AIProposal {
  if (!validRange(selection.start, selection.end)) throw new ProposalApplyError('选区范围无效。')
  const normalized = snapshot.content.replace(/\r\n/g, '\n')
  if (selection.end > normalized.length) throw new ProposalApplyError('选区超出当前文档。')
  const base = [{
    vault: snapshot.vault || 'main',
    path: snapshot.path || 'current.md',
    contentHash: snapshot.contentHash,
    version: snapshot.version,
  }]
  return {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    action: 'rewrite',
    base,
    operations: [{ op: 'replace-range', start: selection.start, end: selection.end, text: generated }],
    summary: '改写选中文本',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }
}

/** Apply a server proposal only when the client still has its exact baseline. */
export function applyProposal(snapshot: NoteSnapshot, proposal: AIProposal): { content: string; changedPaths: string[] } {
  compareBase(snapshot, proposal)
  // Proposal offsets are JavaScript UTF-16 positions in the LF-normalized
  // document. Restore the note's original line endings after patching.
  const original = snapshot.content
  let content = original.replace(/\r\n/g, '\n')
  const edits = proposal.operations.filter((operation): operation is Extract<AIPatchOperation, { op: 'replace-range' | 'insert' }> => operation.op === 'replace-range' || operation.op === 'insert')
  for (const operation of edits) {
    const start = operationStart(operation)
    const end = operationEnd(operation)
    if (!validRange(start, end) || end > content.length) throw new ProposalApplyError('proposal 的范围超出当前文档。')
  }
  const sorted = [...edits].sort((left, right) => operationStart(right) - operationStart(left))
  for (let index = 0; index < sorted.length; index += 1) {
    const operation = sorted[index]
    const start = operationStart(operation)
    const end = operationEnd(operation)
    const previous = sorted[index - 1]
    if (previous && end > operationStart(previous)) throw new ProposalApplyError('proposal 包含重叠的编辑范围。')
    content = content.slice(0, start) + (operation.op === 'replace-range' || operation.op === 'insert' ? operation.text : '') + content.slice(end)
  }
  const changedPaths = new Set<string>()
  for (const operation of proposal.operations) {
    if (operation.op === 'create-note' || operation.op === 'move-to-trash') changedPaths.add(operation.path)
  }
  if (snapshot.path) changedPaths.add(snapshot.path)
  if (original.includes('\r\n')) {
    content = content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  }
  return { content, changedPaths: [...changedPaths] }
}

/** Undo is safe only while the note still equals the version produced by the commit. */
export function canUndoProposal(current: NoteSnapshot, committed: CommitResult): boolean {
  const target = (committed.targets as Array<{ vault?: string; path?: string; contentHash?: string; version?: number }> | undefined)?.find((item) => (!current.vault || item.vault === current.vault) && (!current.path || item.path === current.path))
    || committed.target as { contentHash?: string; version?: number } | undefined
  if (!target) return false
  return target.contentHash === current.contentHash && target.version === current.version
}

export function proposalOperationSummary(proposal: AIProposal) {
  const operations = proposal.operations
  if (operations.some((operation) => operation.op === 'move-to-trash')) return '移入回收站'
  if (operations.some((operation) => operation.op === 'create-note')) return '创建文档'
  if (operations.some((operation) => operation.op === 'replace-range')) return '替换选区'
  if (operations.some((operation) => operation.op === 'insert')) return '插入内容'
  return proposal.summary
}

// Keep this reference in the module so future clients can validate before
// rendering a proposal received over SSE without importing implementation code.
export type { AIProposal, AIPatchOperation }
