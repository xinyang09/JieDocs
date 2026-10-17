import type { Connection } from './types.ts'
import type {
  AIExecuteRequest,
  AIProposal,
  AIResult,
  AIStreamEvent,
  ProposalCommitRequest,
} from './ai-contract.ts'
import {
  AIStreamParser,
  parseAIStreamEvent,
  splitSSEData,
  validateAIExecuteRequest,
  validateProposalCommit,
} from './ai-contract.ts'

export class FnsApiError extends Error {
  readonly status?: number
  readonly code?: string
  readonly retryable?: boolean

  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean } = {}) {
    super(message)
    this.name = 'FnsApiError'
    this.status = options.status
    this.code = options.code
    this.retryable = options.retryable
  }
}

export type AIEventHandlers = { onEvent?: (event: AIStreamEvent) => void }

function sameOriginProxyAvailable() {
  return typeof window !== 'undefined' && typeof window.location?.origin === 'string' && Boolean(window.location.origin)
}

/** Resolve canonical AI endpoints without leaking an auth token to another origin. */
export function resolveAIEndpoint(connection: Connection, route = '/api/ai/execute') {
  const path = route.startsWith('/') ? route : `/${route}`
  const base = connection.baseUrl.trim()
  if (!base) throw new FnsApiError('未配置 FNS 服务地址。')
  // The embedded docs viewer exposes a same-origin proxy. A separately
  // configured FNS/WebGUI host must remain direct so its auth and cookies are
  // sent to the intended server rather than to the page origin.
  if (sameOriginProxyAvailable()) {
    try {
      if (new URL(base).origin === window.location.origin) return new URL(path, window.location.origin).toString()
    } catch {
      // Fall through to URL's normal validation below.
    }
  }
  return new URL(path, `${base.replace(/\/+$/, '')}/`).toString()
}

function requestHeaders(connection: Connection, accept: string) {
  const token = connection.token.trim()
  const client = connection.clientType.trim() || 'FNS Docs Viewer'
  return {
    Accept: accept,
    'Content-Type': 'application/json',
    'X-Client': client,
    'X-Client-Name': 'FNS Docs Viewer',
    ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
  }
}

function headerValue(response: Response, name: string) {
  return response.headers.get(name) || undefined
}

async function readError(response: Response) {
  let message = `AI 请求失败（HTTP ${response.status}）。`
  let code: string | undefined
  let retryable: boolean | undefined
  try {
    const payload = await response.json() as { message?: string; code?: string; data?: { message?: string; code?: string }; error?: { message?: string; code?: string; retryable?: boolean } }
    message = payload.message || payload.data?.message || payload.error?.message || message
    code = payload.code || payload.data?.code || payload.error?.code
    retryable = payload.error?.retryable
  } catch {
    // An empty/non-JSON body still carries a useful HTTP status.
  }
  throw new FnsApiError(message, { status: response.status, code, retryable })
}

function eventResult(event: AIStreamEvent): AIResult | undefined {
  return event.type === 'done' ? event.result : undefined
}

/** Parse complete SSE chunks. Invalid and heartbeat frames are ignored. */
export function collectAIEvents(chunks: string[]): AIStreamEvent[] {
  return splitSSEData(chunks)
}

/** Consume an already-decoded SSE body and return its terminal result. */
export async function consumeAIStream(chunks: AsyncIterable<string>, handlers: AIEventHandlers = {}): Promise<AIResult> {
  const parser = new AIStreamParser()
  let result: AIResult | undefined
  let terminalError: FnsApiError | undefined
  for await (const chunk of chunks) {
    for (const event of parser.push(chunk)) {
      handlers.onEvent?.(event)
      if (event.type === 'error') {
        terminalError = new FnsApiError(event.message, { code: event.code, retryable: event.retryable })
        break
      }
      result = eventResult(event) || result
    }
    if (terminalError) break
  }
  if (terminalError) throw terminalError
  for (const event of parser.end()) {
    handlers.onEvent?.(event)
    if (event.type === 'error') throw new FnsApiError(event.message, { code: event.code, retryable: event.retryable })
    result = eventResult(event) || result
  }
  if (!result) throw new FnsApiError('AI 流在完成前断开，未收到 done 事件。', { code: 'stream_incomplete', retryable: true })
  return result
}

async function decodeJSONResult(response: Response): Promise<AIResult> {
  let value: unknown
  try { value = await response.json() } catch { throw new FnsApiError('AI 返回了无法识别的响应。', { status: response.status }) }
  const payload = value && typeof value === 'object' ? value as { data?: AIResult; result?: AIResult } : {}
  const result = payload.data || payload.result || value
  if (!result || typeof result !== 'object') throw new FnsApiError('AI 返回了空结果。', { status: response.status })
  return result as AIResult
}

async function consumeResponse(response: Response, handlers: AIEventHandlers, signal?: AbortSignal) {
  if (!response.body) return decodeJSONResult(response)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  async function* chunks() {
    try {
      while (true) {
        signal?.throwIfAborted()
        const next = await reader.read()
        if (next.done) break
        yield decoder.decode(next.value, { stream: true })
      }
      const tail = decoder.decode()
      if (tail) yield tail
    } finally {
      reader.releaseLock()
    }
  }
  return consumeAIStream(chunks(), handlers)
}

/** Execute one action. A single reconnect is attempted after a partial stream. */
export async function executeAI(
  connection: Connection,
  request: AIExecuteRequest,
  handlers: AIEventHandlers = {},
  signal?: AbortSignal,
): Promise<AIResult> {
  validateAIExecuteRequest(request)
  const endpoint = resolveAIEndpoint(connection)
  let lastEventId = ''
  let lastSequence = -1
  let retried = false
  while (true) {
    signal?.throwIfAborted()
    const headers: Record<string, string> = requestHeaders(connection, 'text/event-stream, application/json')
    headers['Idempotency-Key'] = request.idempotencyKey
    if (lastEventId) headers['Last-Event-ID'] = lastEventId
    let response: Response
    try {
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(request), signal })
    } catch (error) {
      if (signal?.aborted) throw error
      if (!retried && lastEventId) { retried = true; continue }
      throw new FnsApiError('无法连接 AI 服务。', { code: 'network_error', retryable: true })
    }
    if (!response.ok) await readError(response)
    if (!response.headers.get('content-type')?.includes('text/event-stream')) return decodeJSONResult(response)
    try {
      const result = await consumeResponse(response, {
        onEvent: (event) => {
          const eventId = event.id || (event.sequence !== undefined ? String(event.sequence) : '')
          if (event.sequence !== undefined && event.sequence <= lastSequence) return
          if (event.sequence !== undefined) lastSequence = event.sequence
          if (eventId) lastEventId = eventId
          if (event.type !== 'done' && event.type !== 'error') handlers.onEvent?.(event)
          else handlers.onEvent?.(event)
        },
      }, signal)
      return result
    } catch (error) {
      if (error instanceof FnsApiError && error.code === 'stream_incomplete' && !retried && lastEventId) {
        retried = true
        continue
      }
      throw error
    }
  }
}

export type CommitResult = { proposalId?: string; status?: string; [key: string]: unknown }

async function proposalRequest<T>(connection: Connection, proposalId: string, action: 'commit' | 'discard' | 'undo', body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!proposalId.trim()) throw new FnsApiError('缺少 proposal ID。')
  const endpoint = resolveAIEndpoint(connection, `/api/ai/proposals/${encodeURIComponent(proposalId)}/${action}`)
  const headers: Record<string, string> = requestHeaders(connection, 'application/json')
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : `${action}:${proposalId}:${Date.now()}`
  headers['Idempotency-Key'] = idempotencyKey
  const response = await fetch(endpoint, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined, signal })
  if (!response.ok) await readError(response)
  const payload = await response.json().catch(() => null) as { data?: T } | T | null
  if (payload && typeof payload === 'object' && 'data' in payload && payload.data !== undefined) return payload.data as T
  return payload as T
}

export function commitAIProposal(connection: Connection, proposalId: string, request: ProposalCommitRequest, signal?: AbortSignal) {
  validateProposalCommit(request)
  return proposalRequest<CommitResult>(connection, proposalId, 'commit', request as unknown as Record<string, unknown>, signal)
}

export function discardAIProposal(connection: Connection, proposalId: string, idempotencyKey = `discard:${proposalId}:${Date.now()}`, signal?: AbortSignal) {
  return proposalRequest<CommitResult>(connection, proposalId, 'discard', { idempotencyKey }, signal)
}

export function undoAIProposal(connection: Connection, proposalId: string, request: { idempotencyKey: string }, signal?: AbortSignal) {
  if (!request.idempotencyKey.trim()) throw new FnsApiError('缺少撤销幂等键。')
  return proposalRequest<CommitResult>(connection, proposalId, 'undo', request, signal)
}

export async function cancelAIRun(connection: Connection, runId: string, signal?: AbortSignal) {
  if (!runId.trim()) return
  const endpoint = resolveAIEndpoint(connection, `/api/ai/runs/${encodeURIComponent(runId)}`)
  const response = await fetch(endpoint, { method: 'DELETE', headers: requestHeaders(connection, 'application/json'), signal })
  if (!response.ok) await readError(response)
}

export { parseAIStreamEvent }
export type { AIProposal, AIResult }
