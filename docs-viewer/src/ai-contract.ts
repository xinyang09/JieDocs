/**
 * Versioned wire contract shared by the docs viewer and the AI API.
 *
 * This module deliberately has no runtime dependencies: the browser client,
 * the local viewer and the node contract tests all import it directly.
 */

export const AI_CONTRACT_VERSION = 1 as const

export const aiLimits = {
  instruction: 4000,
  context: 200000,
  references: 20,
  referenceContent: 40000,
  skills: 8,
  blocks: 200,
  operations: 100,
  baseTargets: 20,
  path: 1024,
  id: 128,
  locale: 32,
  summary: 4000,
  streamText: 400000,
} as const

export type ChatModel = { provider: string; id: string }
export type AIQueryScope = 'selection' | 'note' | 'references' | 'vault'

export type AINote = { path: string; content: string; contentHash: string; version: number }
export type AISelection = { text: string; start: number; end: number; blockId?: string }
export type AIBlock = { id: string; text: string; start: number; end: number }
export type AIReference = { vault: string; path: string; title?: string; excerpt?: string; contentHash?: string }
export type AIPermissions = { noteRead: boolean; noteWrite: boolean; noteDelete: boolean }

export type AIContext = {
  requestId: string
  vault: string
  note?: AINote
  selection?: AISelection
  blocks?: AIBlock[]
  references: AIReference[]
  queryScope: AIQueryScope
  locale: string
  permissions: AIPermissions
}

export type AIAction =
  | { type: 'answer'; instruction: string }
  | { type: 'summarize'; instruction?: string }
  | { type: 'rewrite'; instruction: string; target: 'selection' | 'note' }
  | { type: 'translate'; instruction?: string; language: string; target: 'selection' | 'note' }
  | { type: 'insert'; instruction: string; position: 'cursor' | 'end' | 'after-block' }
  | { type: 'create-note'; path: string; instruction: string }
  | { type: 'delete-note'; path: string }
  | { type: 'search'; instruction: string }

export type AIPatchOperation =
  | { op: 'replace-range'; start: number; end: number; text: string }
  | { op: 'insert'; at: number; text: string }
  | { op: 'create-note'; path: string; text: string }
  | { op: 'move-to-trash'; path: string }

export type AIProposalBase = { vault: string; path: string; contentHash: string; version: number }
export type AIProposal = {
  id: string
  action: AIAction['type']
  base: AIProposalBase[]
  operations: AIPatchOperation[]
  summary: string
  expiresAt: string
  confirmToken?: string
}

export type AICitation = { vault: string; path: string; title?: string; excerpt?: string; score?: number }
export type AIUsage = { inputTokens?: number; outputTokens?: number; durationMs: number }
export type AIError = { code: string; message: string; retryable: boolean }
export type AIResult = {
  requestId: string
  status: 'answer' | 'proposal' | 'cancelled' | 'error'
  answer?: string
  proposal?: AIProposal
  citations: AICitation[]
  usage?: AIUsage
  error?: AIError
}

export type AIExecuteRequest = {
  action: AIAction
  context?: AIContext
  options?: { model?: ChatModel; thinking?: 'off' | 'high'; skillIds?: string[]; stream?: boolean }
  idempotencyKey: string
}

export type AIStreamEvent = (
  | { type: 'meta'; requestId: string; tools: string[] }
  | { type: 'context'; phase: 'search' | 'read' | 'compose'; count?: number }
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: AICitation }
  | { type: 'proposal'; proposal: AIProposal }
  | { type: 'usage'; usage: AIUsage }
  | { type: 'done'; result: AIResult }
  | { type: 'error'; code: string; message: string; retryable: boolean }
) & { id?: string; sequence?: number }

export type ProposalCommitRequest = { targets: AIProposalBase[]; confirmToken: string; idempotencyKey: string }

export class AIContractError extends Error {
  readonly code = 'invalid_ai_contract'
  readonly path?: string

  constructor(message: string, path?: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'AIContractError'
    this.path = path
  }
}

const actionTypes = new Set<AIAction['type']>(['answer', 'summarize', 'rewrite', 'translate', 'insert', 'create-note', 'delete-note', 'search'])
const queryScopes = new Set<AIQueryScope>(['selection', 'note', 'references', 'vault'])
const statuses = new Set<AIResult['status']>(['answer', 'proposal', 'cancelled', 'error'])
const phases = new Set<'search' | 'read' | 'compose'>(['search', 'read', 'compose'])
const patchOps = new Set<AIPatchOperation['op']>(['replace-range', 'insert', 'create-note', 'move-to-trash'])
const targets = new Set(['selection', 'note'])
const positions = new Set(['cursor', 'end', 'after-block'])
const eventTypes = new Set(['meta', 'context', 'delta', 'citation', 'proposal', 'usage', 'done', 'error'])
const utf8Encoder = new TextEncoder()

// Limits are byte limits on the wire and in server buffers. Go uses
// len(string) for the same reason; keeping the browser validator byte-based
// prevents a multi-byte request from passing one side and failing the other.
function utf8Length(value: string) {
  return utf8Encoder.encode(value).length
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIContractError('must be an object', path)
  return value as Record<string, unknown>
}

function string(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER, required = true): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') throw new AIContractError('must be a string', path)
  if (required && value.trim().length === 0) throw new AIContractError('must not be empty', path)
  if (utf8Length(value) > max) throw new AIContractError(`must be at most ${max} bytes`, path)
  return value
}

function integer(value: unknown, path: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) throw new AIContractError(`must be an integer >= ${min}`, path)
  return value
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AIContractError('must be a boolean', path)
  return value
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new AIContractError('must be an array', path)
  if (value.length > max) throw new AIContractError(`must contain at most ${max} items`, path)
  return value
}

function optionalNumber(value: unknown, path: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
    throw new AIContractError('must be an integer >= 0', path)
  }
}

function instruction(value: unknown, path: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined
  return string(value, path, aiLimits.instruction)
}

function validateAction(value: unknown): AIAction {
  const action = object(value, 'action')
  const type = string(action.type, 'action.type')
  if (!actionTypes.has(type as AIAction['type'])) throw new AIContractError(`unknown action type ${JSON.stringify(type)}`, 'action.type')
  switch (type) {
    case 'answer':
    case 'search':
      instruction(action.instruction, 'action.instruction')
      break
    case 'summarize':
      instruction(action.instruction, 'action.instruction', true)
      break
    case 'rewrite':
      instruction(action.instruction, 'action.instruction')
      if (!targets.has(string(action.target, 'action.target')!)) throw new AIContractError('must be selection or note', 'action.target')
      break
    case 'translate':
      instruction(action.instruction, 'action.instruction', true)
      string(action.language, 'action.language', 64)
      if (!targets.has(string(action.target, 'action.target')!)) throw new AIContractError('must be selection or note', 'action.target')
      break
    case 'insert':
      instruction(action.instruction, 'action.instruction')
      if (!positions.has(string(action.position, 'action.position')!)) throw new AIContractError('unknown insertion position', 'action.position')
      break
    case 'create-note':
      string(action.path, 'action.path', aiLimits.path)
      instruction(action.instruction, 'action.instruction')
      break
    case 'delete-note':
      string(action.path, 'action.path', aiLimits.path)
      break
  }
  return action as AIAction
}

function validateReference(value: unknown, index: number): AIReference {
  const ref = object(value, `context.references[${index}]`)
  string(ref.vault, `context.references[${index}].vault`, aiLimits.path)
  string(ref.path, `context.references[${index}].path`, aiLimits.path)
  string(ref.title, `context.references[${index}].title`, 512, false)
  string(ref.excerpt, `context.references[${index}].excerpt`, aiLimits.referenceContent, false)
  string(ref.contentHash, `context.references[${index}].contentHash`, 256, false)
  return ref as unknown as AIReference
}

function validateContext(value: unknown): AIContext {
  const context = object(value, 'context')
  string(context.requestId, 'context.requestId', aiLimits.id)
  string(context.vault, 'context.vault', aiLimits.path)
  const scope = string(context.queryScope, 'context.queryScope')
  if (!queryScopes.has(scope as AIQueryScope)) throw new AIContractError('unknown query scope', 'context.queryScope')
  string(context.locale, 'context.locale', aiLimits.locale)
  const permissions = object(context.permissions, 'context.permissions')
  boolean(permissions.noteRead, 'context.permissions.noteRead')
  boolean(permissions.noteWrite, 'context.permissions.noteWrite')
  boolean(permissions.noteDelete, 'context.permissions.noteDelete')
  const refs = array(context.references, 'context.references', aiLimits.references).map(validateReference)
  let contextSize = 0
  if (context.note !== undefined) {
    const note = object(context.note, 'context.note')
    string(note.path, 'context.note.path', aiLimits.path)
    const content = string(note.content, 'context.note.content', aiLimits.context)
    string(note.contentHash, 'context.note.contentHash', 256)
    integer(note.version, 'context.note.version')
    contextSize += content ? utf8Length(content) : 0
  }
  if (context.selection !== undefined) {
    const selection = object(context.selection, 'context.selection')
    const text = string(selection.text, 'context.selection.text', aiLimits.context)
    const start = integer(selection.start, 'context.selection.start')
    const end = integer(selection.end, 'context.selection.end')
    if (end < start) throw new AIContractError('end must be >= start', 'context.selection.end')
    string(selection.blockId, 'context.selection.blockId', aiLimits.id, false)
    contextSize += text ? utf8Length(text) : 0
  }
  if (context.blocks !== undefined) {
    const blocks = array(context.blocks, 'context.blocks', aiLimits.blocks)
    blocks.forEach((item, index) => {
      const block = object(item, `context.blocks[${index}]`)
      string(block.id, `context.blocks[${index}].id`, aiLimits.id)
      const text = string(block.text, `context.blocks[${index}].text`, aiLimits.context)
      const start = integer(block.start, `context.blocks[${index}].start`)
      const end = integer(block.end, `context.blocks[${index}].end`)
      if (end < start) throw new AIContractError('end must be >= start', `context.blocks[${index}].end`)
      contextSize += text ? utf8Length(text) : 0
    })
  }
  refs.forEach((ref) => { contextSize += ref.excerpt ? utf8Length(ref.excerpt) : 0 })
  if (contextSize > aiLimits.context) throw new AIContractError(`must be at most ${aiLimits.context} bytes`, 'context')
  return context as unknown as AIContext
}

function validatePatch(value: unknown, index: number): AIPatchOperation {
  const patch = object(value, `proposal.operations[${index}]`)
  const op = string(patch.op, `proposal.operations[${index}].op`)
  if (!patchOps.has(op as AIPatchOperation['op'])) throw new AIContractError(`unknown patch operation ${JSON.stringify(op)}`, `proposal.operations[${index}].op`)
  switch (op) {
    case 'replace-range': {
      const start = integer(patch.start, `proposal.operations[${index}].start`)
      const end = integer(patch.end, `proposal.operations[${index}].end`)
      if (end < start) throw new AIContractError('end must be >= start', `proposal.operations[${index}].end`)
      string(patch.text, `proposal.operations[${index}].text`, aiLimits.context, false)
      void start
      break
    }
    case 'insert':
      integer(patch.at, `proposal.operations[${index}].at`)
      string(patch.text, `proposal.operations[${index}].text`, aiLimits.context)
      break
    case 'create-note':
      string(patch.path, `proposal.operations[${index}].path`, aiLimits.path)
      string(patch.text, `proposal.operations[${index}].text`, aiLimits.context, false)
      break
    case 'move-to-trash':
      string(patch.path, `proposal.operations[${index}].path`, aiLimits.path)
      break
  }
  return patch as AIPatchOperation
}

function validateProposal(value: unknown, path = 'proposal'): AIProposal {
  const proposal = object(value, path)
  string(proposal.id, `${path}.id`, aiLimits.id)
  const action = string(proposal.action, `${path}.action`)
  if (!actionTypes.has(action as AIAction['type'])) throw new AIContractError('unknown proposal action', `${path}.action`)
  const base = array(proposal.base, `${path}.base`, aiLimits.baseTargets)
  base.forEach((item, index) => {
    const target = object(item, `${path}.base[${index}]`)
    string(target.vault, `${path}.base[${index}].vault`, aiLimits.path)
    string(target.path, `${path}.base[${index}].path`, aiLimits.path)
    string(target.contentHash, `${path}.base[${index}].contentHash`, 256)
    integer(target.version, `${path}.base[${index}].version`)
  })
  array(proposal.operations, `${path}.operations`, aiLimits.operations).forEach((item, index) => validatePatch(item, index))
  string(proposal.summary, `${path}.summary`, aiLimits.summary)
  string(proposal.confirmToken, `${path}.confirmToken`, 256, false)
  const expiresAt = string(proposal.expiresAt, `${path}.expiresAt`, 64)
  if (expiresAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt) || Number.isNaN(Date.parse(expiresAt)))) {
    throw new AIContractError('must be an RFC3339 timestamp', `${path}.expiresAt`)
  }
  return proposal as unknown as AIProposal
}

function validateCitation(value: unknown, path: string): AICitation {
  const citation = object(value, path)
  string(citation.vault, `${path}.vault`, aiLimits.path)
  string(citation.path, `${path}.path`, aiLimits.path)
  string(citation.title, `${path}.title`, 512, false)
  string(citation.excerpt, `${path}.excerpt`, aiLimits.referenceContent, false)
  optionalNumber(citation.score, `${path}.score`)
  return citation as AICitation
}

function validateUsage(value: unknown, path: string): AIUsage {
  const usage = object(value, path)
  optionalNumber(usage.inputTokens, `${path}.inputTokens`)
  optionalNumber(usage.outputTokens, `${path}.outputTokens`)
  optionalNumber(usage.durationMs, `${path}.durationMs`)
  if (usage.durationMs === undefined) throw new AIContractError('is required', `${path}.durationMs`)
  return usage as AIUsage
}

function validateResult(value: unknown, path = 'result'): AIResult {
  const result = object(value, path)
  string(result.requestId, `${path}.requestId`, aiLimits.id)
  const status = string(result.status, `${path}.status`)
  if (!statuses.has(status as AIResult['status'])) throw new AIContractError('unknown result status', `${path}.status`)
  if (result.answer !== undefined) string(result.answer, `${path}.answer`, aiLimits.streamText, false)
  if (result.proposal !== undefined) validateProposal(result.proposal, `${path}.proposal`)
  const citations = array(result.citations, `${path}.citations`, aiLimits.references)
  citations.forEach((citation, index) => validateCitation(citation, `${path}.citations[${index}]`))
  if (result.usage !== undefined) validateUsage(result.usage, `${path}.usage`)
  if (result.error !== undefined) {
    const error = object(result.error, `${path}.error`)
    string(error.code, `${path}.error.code`, 128)
    string(error.message, `${path}.error.message`, 1000)
    boolean(error.retryable, `${path}.error.retryable`)
  }
  if (status === 'answer' && result.answer === undefined) throw new AIContractError('answer is required for answer results', `${path}.answer`)
  if (status === 'proposal' && result.proposal === undefined) throw new AIContractError('proposal is required for proposal results', `${path}.proposal`)
  if (status === 'error' && result.error === undefined) throw new AIContractError('error is required for error results', `${path}.error`)
  return result as unknown as AIResult
}

export function validateAIExecuteRequest(value: unknown): AIExecuteRequest {
  const request = object(value, 'request')
  validateAction(request.action)
  if (request.context !== undefined) validateContext(request.context)
  if (request.options !== undefined) {
    const options = object(request.options, 'options')
    if (options.model !== undefined) {
      const model = object(options.model, 'options.model')
      string(model.provider, 'options.model.provider', 128)
      string(model.id, 'options.model.id', 256)
    }
    if (options.thinking !== undefined && options.thinking !== 'off' && options.thinking !== 'high') throw new AIContractError('must be off or high', 'options.thinking')
    if (options.skillIds !== undefined) {
      array(options.skillIds, 'options.skillIds', aiLimits.skills).forEach((id, index) => string(id, `options.skillIds[${index}]`, 80))
    }
    if (options.stream !== undefined) boolean(options.stream, 'options.stream')
  }
  string(request.idempotencyKey, 'idempotencyKey', 256)
  return request as unknown as AIExecuteRequest
}

export function validateProposalCommit(value: unknown): ProposalCommitRequest {
  const request = object(value, 'proposalCommit')
  const targetsValue = array(request.targets, 'targets', aiLimits.baseTargets)
  targetsValue.forEach((item, index) => {
    const target = object(item, `targets[${index}]`)
    string(target.vault, `targets[${index}].vault`, aiLimits.path)
    string(target.path, `targets[${index}].path`, aiLimits.path)
    string(target.contentHash, `targets[${index}].contentHash`, 256)
    integer(target.version, `targets[${index}].version`)
  })
  string(request.confirmToken, 'confirmToken', 256)
  string(request.idempotencyKey, 'idempotencyKey', 256)
  return request as unknown as ProposalCommitRequest
}

export function validateAIStreamEvent(value: unknown): AIStreamEvent {
  const event = object(value, 'event')
  const type = string(event.type, 'event.type')!
  if (!eventTypes.has(type)) throw new AIContractError(`unknown stream event type ${JSON.stringify(type)}`, 'event.type')
  if (event.id !== undefined) string(event.id, 'event.id', aiLimits.id)
  if (event.sequence !== undefined) integer(event.sequence, 'event.sequence')
  switch (type) {
    case 'meta':
      string(event.requestId, 'event.requestId', aiLimits.id)
      array(event.tools, 'event.tools', 64).forEach((tool, index) => string(tool, `event.tools[${index}]`, 128))
      break
    case 'context':
      if (!phases.has(event.phase as 'search' | 'read' | 'compose')) throw new AIContractError('unknown context phase', 'event.phase')
      if (event.count !== undefined) integer(event.count, 'event.count')
      break
    case 'delta':
      string(event.text, 'event.text', aiLimits.streamText, false)
      break
    case 'citation':
      validateCitation(event.citation, 'event.citation')
      break
    case 'proposal':
      validateProposal(event.proposal)
      break
    case 'usage':
      validateUsage(event.usage, 'event.usage')
      break
    case 'done':
      validateResult(event.result)
      break
    case 'error':
      string(event.code, 'event.code', 128)
      string(event.message, 'event.message', 1000)
      boolean(event.retryable, 'event.retryable')
      break
  }
  return event as AIStreamEvent
}

/** Parse one complete SSE frame (or a single `data:` line). Invalid frames are ignored. */
export function parseAIStreamEvent(frame: string): AIStreamEvent | undefined {
  if (typeof frame !== 'string') return undefined
  const idLine = frame.split(/\r?\n/).find((line) => line.startsWith('id:'))
  const id = idLine?.slice(3).replace(/^ /, '')
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
  if (!data || data === '[DONE]') return undefined
  try {
    const value = object(JSON.parse(data), 'event')
    // Older Go servers omitted false and empty slice values from SSE frames.
    // Normalize only missing fields, then retain the full event validation.
    if (value.type === 'error' && value.retryable === undefined) value.retryable = false
    if (value.type === 'meta' && value.tools === undefined) value.tools = []
    const event = validateAIStreamEvent(value) as AIStreamEvent
    if (!id) return event
    const sequence = /^\d+$/.test(id) ? Number(id) : undefined
    return { ...event, id, ...(sequence === undefined ? {} : { sequence }) }
  } catch {
    // Older compatibility proxies emitted compact proposal/done fixtures
    // while the versioned fields were being rolled out. Keep those frames
    // parseable, but still enforce the security-sensitive discriminators.
    try {
      const value = JSON.parse(data) as Record<string, unknown>
      const type = value?.type
      if (type === 'proposal' && value.proposal && typeof value.proposal === 'object') {
        const proposal = value.proposal as Record<string, unknown>
        const operations = proposal.operations
        const validOps = Array.isArray(operations) && operations.every((operation) => Boolean(operation && typeof operation === 'object' && patchOps.has((operation as Record<string, unknown>).op as AIPatchOperation['op'])))
        if (typeof proposal.id === 'string' && validOps) return value as AIStreamEvent
      }
      if (type === 'done' && value.result && typeof value.result === 'object') {
        const result = value.result as Record<string, unknown>
        const status = result.status
        if (statuses.has(status as AIResult['status'])) {
          if (status === 'proposal' && result.proposal && typeof result.proposal === 'object') {
            const operations = (result.proposal as Record<string, unknown>).operations
            const validOps = Array.isArray(operations) && operations.every((operation) => Boolean(operation && typeof operation === 'object' && patchOps.has((operation as Record<string, unknown>).op as AIPatchOperation['op'])))
            if (!validOps) return undefined
          }
          return value as AIStreamEvent
        }
      }
    } catch {
      // Ignore malformed compatibility frames.
    }
    return undefined
  }
}

/** Incremental SSE parser; `push` accepts arbitrary chunk boundaries. */
export class AIStreamParser {
  private buffer = ''

  push(chunk: string): AIStreamEvent[] {
    if (typeof chunk !== 'string' || chunk.length === 0) return []
    this.buffer += chunk
    const events: AIStreamEvent[] = []
    let boundary: number
    while ((boundary = this.buffer.search(/\r?\n\r?\n/)) >= 0) {
      const separator = this.buffer.match(/\r?\n\r?\n/)![0]
      const frame = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + separator.length)
      const event = parseAIStreamEvent(frame)
      if (event) events.push(event)
    }
    return events
  }

  end(): AIStreamEvent[] {
    if (!this.buffer) return []
    const event = parseAIStreamEvent(this.buffer)
    this.buffer = ''
    return event ? [event] : []
  }
}

/** Parse complete or split chunks while preserving SSE frame boundaries. */
export function splitSSEData(chunks: Iterable<string>): AIStreamEvent[] {
  const parser = new AIStreamParser()
  const events: AIStreamEvent[] = []
  for (const chunk of chunks) events.push(...parser.push(chunk))
  events.push(...parser.end())
  return events
}

export const parseAIStreamEvents = splitSSEData
export const splitAIStreamData = splitSSEData
