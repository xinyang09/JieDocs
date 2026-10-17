import type { ApiResponse, ApiTokenCreated, Connection, FileSummary, FolderTree, Note, NoteSummary, Share, ShareListItem, User, Vault } from './types'
import { readChatModel, type ChatModel } from './ai-chat.ts'
import type { AIResult } from './ai-contract.ts'
import { executeAI, resolveAIEndpoint, FnsApiError } from './ai-stream.ts'

// Canonical AI execution now lives in ai-stream.ts. Re-exporting the client
// entry points keeps existing feature modules on the API facade while the
// legacy Pi helpers below remain available during rollout.
export {
  cancelAIRun,
  collectAIEvents,
  commitAIProposal,
  consumeAIStream,
  discardAIProposal,
  executeAI,
  FnsApiError,
  resolveAIEndpoint,
  undoAIProposal,
} from './ai-stream.ts'
export type { CommitResult } from './ai-stream.ts'

const transientStatuses = new Set([502, 503, 504, 522])
const safeMethods = new Set(['GET', 'HEAD'])

type RequestParams = Record<string, string | number | boolean | undefined>
type RequestBody = Record<string, unknown>
type RequestOptions = {
  signal?: AbortSignal
  body?: RequestBody
  method?: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT'
  params?: RequestParams
  requireAuth?: boolean
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function fetchWithRetry(url: string, init: RequestInit) {
  let lastNetworkError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    init.signal?.throwIfAborted()
    try {
      const response = await fetch(url, init)
      if (!transientStatuses.has(response.status) || attempt === 2) return response
    } catch (error) {
      init.signal?.throwIfAborted()
      lastNetworkError = error
      if (attempt === 2) throw error
    }
    await wait(350 * 2 ** attempt)
  }
  throw lastNetworkError || new Error('Request failed')
}

function endpoint(connection: Connection, path: string, params?: RequestParams) {
  const base = connection.baseUrl.trim() || window.location.origin
  const url = new URL(path, `${base.replace(/\/+$/, '')}/`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function requestHeaders(connection: Connection, includeAuth = true): HeadersInit {
  const token = connection.token.trim()
  const clientType = connection.clientType.trim() || 'FNS Docs Viewer'
  return {
    Accept: 'application/json',
    ...(includeAuth && token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
    'X-Client': clientType,
    'X-Client-Name': 'FNS Docs Viewer',
  }
}

export function fnsHeaders(connection: Connection) {
  return requestHeaders(connection)
}

export function fileEndpoint(connection: Connection, vault: string, path: string) {
  return endpoint(connection, '/api/file', { vault, path })
}

export function filePreviewEndpoint(connection: Connection, vault: string, path: string) {
  return endpoint(connection, '/api/file/preview', { vault, path })
}

export type UniverImportPayload = {
  kind: 'sheet' | 'doc' | 'slide'
  format: string
  fileName: string
  unitData: Record<string, unknown>
  sheetBlocks?: unknown
}

export function univerImportEndpoint(connection: Connection, vault: string, path: string) {
  return endpoint(connection, '/api/file/univer', { vault, path })
}

export async function importUniverFile(connection: Connection, vault: string, path: string): Promise<UniverImportPayload> {
  const response = await fetch(univerImportEndpoint(connection, vault, path), { headers: fnsHeaders(connection) })
  let payload: { status?: boolean; data?: UniverImportPayload; message?: string } | null = null
  try { payload = await response.json() as { status?: boolean; data?: UniverImportPayload; message?: string } } catch { /* handled below */ }
  if (!response.ok || !payload?.status || !payload.data) {
    throw new FnsApiError(payload?.message || `Office 文件导入失败（HTTP ${response.status}）。`)
  }
  return payload.data
}

export async function exportUniverFile(connection: Connection, payload: { vault: string; path: string; kind: 'sheet' | 'doc' | 'slide'; data: unknown }) {
  const response = await fetch(endpoint(connection, '/api/file/univer/export'), {
    method: 'POST',
    headers: { ...fnsHeaders(connection), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    let message = `Office 文件保存失败（HTTP ${response.status}）。`
    try {
      const body = await response.json() as { message?: string }
      if (body.message) message = body.message
    } catch { /* handled below */ }
    throw new FnsApiError(message)
  }
  const encodedOutputPath = response.headers.get('X-FNS-Output-Path')
  let outputPath = payload.path
  if (encodedOutputPath) {
    try {
      outputPath = decodeURIComponent(encodedOutputPath)
    } catch {
      outputPath = encodedOutputPath
    }
  }
  return {
    blob: await response.blob(),
    outputPath,
  }
}

export async function uploadFile(
  connection: Connection,
  vault: string,
  path: string,
  file: Blob,
  modifiedAt = Date.now(),
  options: { baseContentHash?: string } = {},
) {
  if (!connection.baseUrl.trim()) throw new FnsApiError('未配置 FNS 服务地址。请在连接设置中配置。')
  if (!connection.token.trim()) throw new FnsApiError('请先登录。')

  const form = new FormData()
  form.set('vault', vault)
  form.set('path', path)
  form.set('ctime', String(modifiedAt))
  form.set('mtime', String(modifiedAt))
  if (options.baseContentHash) form.set('baseContentHash', options.baseContentHash)
  form.set('file', file, path.split('/').pop() || 'attachment')
  const response = await fetch(endpoint(connection, '/api/file'), {
    method: 'POST',
    headers: fnsHeaders(connection),
    body: form,
  })
  let payload: ApiResponse<FileSummary> | null = null
  try { payload = await response.json() as ApiResponse<FileSummary> } catch { /* handled below */ }
  if (!response.ok || !payload?.status) {
    throw new FnsApiError(payload?.message || `文件保存失败（HTTP ${response.status}）。`)
  }
  return payload.data
}

export interface SkillItem {
  id: string
  key: string
  name: string
  description: string
  path: string
  source: 'workspace' | 'custom' | 'codex' | 'agents' | 'system' | string
  content?: string
}

export async function getAvailableSkills(connection?: Connection, signal?: AbortSignal): Promise<SkillItem[]>
export async function getAvailableSkills(signal?: AbortSignal, connection?: Connection): Promise<SkillItem[]>
export async function getAvailableSkills(first?: Connection | AbortSignal, second?: AbortSignal | Connection): Promise<SkillItem[]> {
  const connection = first && typeof first === 'object' && 'baseUrl' in first ? first as Connection : second && typeof second === 'object' && 'baseUrl' in second ? second as Connection : undefined
  const signal = first && typeof first === 'object' && !('baseUrl' in first) ? first as AbortSignal : second && typeof second === 'object' && !('baseUrl' in second) ? second as AbortSignal : undefined
  const endpointUrl = connection ? resolveAIEndpoint(connection, '/api/ai/skills') : (typeof window !== 'undefined' ? new URL('/api/ai/skills', window.location.origin).toString() : '/api/ai/skills')
  const response = await fetch(endpointUrl, {
    method: 'GET',
    credentials: 'same-origin',
    signal,
    headers: {
      'Accept': 'application/json',
      'X-Docs-Viewer': '1',
      ...(connection ? fnsHeaders(connection) : {}),
    },
  })
  if (!response.ok) {
    let payload: { message?: string } | null = null
    try { payload = await response.json() as { message?: string } } catch { /* handled below */ }
    throw new FnsApiError(payload?.message || `获取技能列表失败（HTTP ${response.status}）。`)
  }
  const data = (await response.json()) as { skills?: SkillItem[]; data?: { skills?: SkillItem[] } }
  return data.skills || data.data?.skills || []
}

export type TransferProvider = 'feishu' | 'notion'

export interface TransferPluginInfo {
  id: string
  name: string
  version: string
  mode: string
  surface?: string
  slot?: string
  providers: TransferProvider[]
  enabled: boolean
  livePublishing: boolean
  profileCount: number
  runtimeConfigPath: string
}

export interface TransferProfile {
  id: string
  uid?: number
  vault: string
  provider: TransferProvider
  allowLive: boolean
  env?: Record<string, string>
  credentials?: Record<string, string>
  credentialStatus?: Record<string, boolean>
}

export interface TransferJob {
  id: string
  uid: number
  vault: string
  path: string
  profile: string
  provider: TransferProvider
  live: boolean
  force: boolean
  contentSha256: string
  status: string
  externalId?: string
  externalUrl?: string
  failureCode?: string
  failureMessage?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
}

export function getTransferPluginInfo(connection: Connection) {
  return request<TransferPluginInfo>(connection, '/api/transfer/plugin')
}

export function getTransferProfiles(connection: Connection, vault?: string) {
  return request<TransferProfile[]>(connection, '/api/transfer/profiles', {
    params: vault ? { vault } : undefined,
  })
}

export function getTransferAdminProfiles(connection: Connection) {
  return request<TransferProfile[]>(connection, '/api/transfer/admin/profiles')
}

export function createTransferProfile(connection: Connection, profile: TransferProfile) {
  return request<TransferProfile>(connection, '/api/transfer/admin/profiles', {
    method: 'POST',
    body: { ...profile },
  })
}

export function updateTransferProfile(connection: Connection, id: string, profile: TransferProfile) {
  return request<TransferProfile>(connection, `/api/transfer/admin/profiles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { ...profile },
  })
}

export function deleteTransferProfile(connection: Connection, id: string) {
  return request<null>(connection, `/api/transfer/admin/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function submitTransferJob(connection: Connection, payload: { profile: string; vault: string; path: string; live: boolean; force: boolean }) {
  return request<TransferJob>(connection, '/api/transfer/jobs', {
    method: 'POST',
    body: payload,
  })
}

export async function getTransferJobs(connection: Connection, vault?: string) {
  const result = await request<{ list: TransferJob[] }>(connection, '/api/transfer/jobs', {
    params: { vault, page: 1, pageSize: 50 },
  })
  return result.list || []
}


export async function installSkill(payload: {
  name?: string
  title?: string
  description?: string
  content?: string
  url?: string
  repo?: string
}): Promise<{ message: string; skill: SkillItem; skills: SkillItem[] }> {
  const response = await fetch('/pi-skills/install', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Docs-Viewer': '1',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    let payloadErr: { message?: string } | null = null
    try { payloadErr = await response.json() as { message?: string } } catch {}
    throw new FnsApiError(payloadErr?.message || `安装技能失败（HTTP ${response.status}）。`)
  }
  return response.json()
}

export async function getAIModels(signal?: AbortSignal, connection?: Connection): Promise<ChatModel[]>
export async function getAIModels(connection?: Connection, signal?: AbortSignal): Promise<ChatModel[]>
export async function getAIModels(first?: AbortSignal | Connection, second?: AbortSignal | Connection): Promise<ChatModel[]> {
  const connection = first && typeof first === 'object' && 'baseUrl' in first ? first as Connection : second && typeof second === 'object' && 'baseUrl' in second ? second as Connection : undefined
  const signal = first && typeof first === 'object' && !('baseUrl' in first) ? first as AbortSignal : second && typeof second === 'object' && !('baseUrl' in second) ? second as AbortSignal : undefined
  const endpointUrl = connection ? resolveAIEndpoint(connection, '/api/ai/models') : (typeof window !== 'undefined' ? new URL('/api/ai/models', window.location.origin).toString() : '/api/ai/models')
  const response = await fetch(endpointUrl, { credentials: 'same-origin', cache: 'no-store', signal, headers: connection ? fnsHeaders(connection) : undefined })
  const payload = await response.json().catch(() => null)
  const models = Array.isArray(payload) ? payload : payload?.models || payload?.data?.models || payload?.data
  if (!response.ok || !Array.isArray(models)) throw new FnsApiError(aiErrorMessage(payload, '无法加载模型列表。'), { status: response.status, code: aiPayload(aiPayload(payload).error).code as string | undefined })
  return models.map(readChatModel).filter((model: ChatModel | undefined): model is ChatModel => Boolean(model))
}

/**
 * User-managed model provider metadata. Secrets are intentionally absent from
 * the response type; the API only exposes whether a credential is configured.
 */
export type AIProviderType = 'openai-compatible' | 'ollama' | string

export type AIProvider = {
  id: string
  version: number
  name: string
  type: AIProviderType
  baseUrl: string
  defaultModel: string
  enabled: boolean
  credentialConfigured: boolean
  createdAt?: string
  updatedAt?: string
}

export type AIProviderInput = {
  id?: string
  version?: number
  name: string
  type: AIProviderType
  baseUrl: string
  defaultModel: string
  enabled?: boolean
  /** Write-only. Never retain this value in model/session state. */
  apiKey?: string
}

export type AIProviderTestResult = {
  ok: boolean
  models?: ChatModel[]
  latencyMs?: number
}

function aiPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function aiData(value: unknown): unknown {
  const payload = aiPayload(value)
  return payload.data && typeof payload.data === 'object' ? payload.data : value
}

function aiErrorMessage(value: unknown, fallback: string) {
  const payload = aiPayload(value)
  const nested = aiPayload(payload.error)
  const data = aiPayload(payload.data)
  return typeof payload.message === 'string' && payload.message
    ? payload.message
    : typeof nested.message === 'string' && nested.message
      ? nested.message
      : typeof data.message === 'string' && data.message
        ? data.message
        : fallback
}

function readAIProvider(value: unknown): AIProvider | undefined {
  const item = aiPayload(value)
  if (typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim()) return undefined
  if (typeof item.type !== 'string' || !item.type.trim() || typeof item.baseUrl !== 'string') return undefined
  const defaultModel = typeof item.defaultModel === 'string' ? item.defaultModel : ''
  const result: AIProvider = {
    id: item.id.trim(),
    version: typeof item.version === 'number' && Number.isInteger(item.version) && item.version >= 1 ? item.version : 1,
    name: item.name.trim(),
    type: item.type.trim(),
    baseUrl: item.baseUrl.trim(),
    defaultModel,
    enabled: item.enabled !== false,
    credentialConfigured: item.credentialConfigured === true || item.hasApiKey === true,
  }
  if (typeof item.createdAt === 'string') result.createdAt = item.createdAt
  if (typeof item.updatedAt === 'string') result.updatedAt = item.updatedAt
  return result
}

function readAIProviderList(value: unknown): AIProvider[] {
  const data = aiData(value)
  const payload = aiPayload(data)
  const raw = Array.isArray(data) ? data : Array.isArray(payload.providers) ? payload.providers : []
  return raw.map(readAIProvider).filter((item): item is AIProvider => Boolean(item))
}

async function aiJSON<T>(connection: Connection, path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const endpointUrl = resolveAIEndpoint(connection, path)
  const response = await fetch(endpointUrl, {
    method: options.method || 'GET',
    signal: options.signal,
    credentials: 'same-origin',
    headers: {
      ...fnsHeaders(connection),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new FnsApiError(aiErrorMessage(payload, `AI 服务请求失败（HTTP ${response.status}）。`), { status: response.status, code: aiPayload(aiPayload(payload).error).code as string | undefined })
  return payload as T
}

export async function getAIProviders(connection: Connection, signal?: AbortSignal): Promise<AIProvider[]> {
  return readAIProviderList(await aiJSON<unknown>(connection, '/api/ai/providers', { signal }))
}

/** Discover the catalog using only the provider configuration saved on FNS. */
export async function discoverAIProviderModels(connection: Connection, id: string, signal?: AbortSignal): Promise<ChatModel[]> {
  if (!id.trim()) throw new FnsApiError('缺少模型服务 ID。')
  const payload = await aiJSON<unknown>(connection, `/api/ai/providers/${encodeURIComponent(id.trim())}/models`, { signal })
  const models = aiPayload(aiData(payload)).models
  if (!Array.isArray(models)) throw new FnsApiError('AI 服务返回的模型列表无效。')
  return models.map(readChatModel).filter((model: ChatModel | undefined): model is ChatModel => Boolean(model))
}

/** Create or update one provider. Empty apiKey on update keeps the old key. */
export async function saveAIProvider(connection: Connection, input: AIProviderInput, signal?: AbortSignal): Promise<AIProvider> {
  const id = input.id?.trim()
  const path = id ? `/api/ai/providers/${encodeURIComponent(id)}` : '/api/ai/providers'
  const payload = await aiJSON<unknown>(connection, path, { method: id ? 'PUT' : 'POST', signal, body: {
    ...input,
    ...(input.id ? { id } : {}),
  } })
  const data = aiData(payload)
  const provider = readAIProvider(aiPayload(data).provider || data)
  if (!provider) throw new FnsApiError('AI 服务返回的模型配置无效。')
  return provider
}

export async function deleteAIProvider(connection: Connection, id: string, version: number, signal?: AbortSignal): Promise<void> {
  if (!id.trim()) throw new FnsApiError('缺少模型服务 ID。')
  await aiJSON<unknown>(connection, `/api/ai/providers/${encodeURIComponent(id.trim())}?version=${encodeURIComponent(String(version))}`, { method: 'DELETE', signal })
}

export async function testAIProvider(connection: Connection, id: string, signal?: AbortSignal): Promise<AIProviderTestResult> {
  if (!id.trim()) throw new FnsApiError('缺少模型服务 ID。')
  const payload = await aiJSON<unknown>(connection, `/api/ai/providers/${encodeURIComponent(id.trim())}/test`, { method: 'POST', signal })
  const data = aiPayload(aiData(payload))
  const modelsValue = Array.isArray(data.models) ? data.models : []
  return {
    ok: data.ok === true,
    models: modelsValue.map(readChatModel).filter((model: ChatModel | undefined): model is ChatModel => Boolean(model)),
    latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
  }
}

/** Compatibility alias for older callers; new code should use getAIModels. */
export const getPiModels = getAIModels

export async function runPiAssistant(
  instruction: string,
  content: string,
  title = '',
  onChunk?: (text: string) => void,
  options?: {
    thinking?: boolean
    skills?: string[]
    signal?: AbortSignal
    model?: ChatModel
    connection?: Connection
    vault?: string
  }
) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const requestConnection: Connection = options?.connection || {
    baseUrl: origin,
    token: '',
    clientType: 'FNS Docs Viewer',
    defaultVault: 'main',
  }
  const vault = options?.vault || requestConnection.defaultVault || 'main'
  const clippedContent = content.slice(0, 200000)
  let latestText = ''
  const result = await executeAI(requestConnection, {
    action: { type: 'answer', instruction: `${title ? `当前文档：${title}\n\n` : ''}${instruction}`.slice(0, 4000) },
    context: {
      requestId: `legacy-${Date.now().toString(36)}`,
      vault,
      selection: { text: clippedContent, start: 0, end: clippedContent.length },
      references: [],
      queryScope: 'selection',
      locale: 'zh-CN',
      permissions: { noteRead: true, noteWrite: false, noteDelete: false },
    },
    options: { stream: Boolean(onChunk), thinking: options?.thinking ? 'high' : 'off', skillIds: options?.skills || [], model: options?.model },
    idempotencyKey: `legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }, {
    onEvent: (event) => {
      if (event.type === 'delta') {
        latestText = event.text.startsWith(latestText) ? event.text : `${latestText}${event.text}`
        onChunk?.(latestText)
      }
    },
  }, options?.signal)
  const answer = (result as AIResult).answer || latestText
  if (!answer) throw new FnsApiError('AI 没有返回可读内容。')
  if (answer !== latestText) onChunk?.(answer)
  return answer
}

function payloadError(payload: Partial<ApiResponse<unknown>> | null, fallback: string) {
  const details = Array.isArray(payload?.details) ? payload.details.join('；') : payload?.details
  return [payload?.message, details].filter(Boolean).join('：') || fallback
}

async function request<T>(connection: Connection, path: string, options: RequestOptions = {}) {
  const method = options.method || 'GET'
  const requireAuth = options.requireAuth ?? true
  if (!connection.baseUrl.trim()) throw new FnsApiError('未配置 FNS 服务地址。请在连接设置中配置。')
  if (requireAuth && !connection.token.trim()) throw new FnsApiError('请先登录。')

  const headers = new Headers(requestHeaders(connection, requireAuth))
  if (options.body) headers.set('Content-Type', 'application/json')
  const init: RequestInit = {
    method,
    headers,
    signal: options.signal,
    body: options.body ? JSON.stringify(options.body) : undefined,
  }

  let response: Response
  try {
    response = safeMethods.has(method)
      ? await fetchWithRetry(endpoint(connection, path, options.params), init)
      : await fetch(endpoint(connection, path, options.params), init)
  } catch {
    throw new FnsApiError('无法连接服务。请检查 FNS 地址是否可访问。')
  }

  let payload: ApiResponse<T> | null = null
  try {
    payload = (await response.json()) as ApiResponse<T>
  } catch {
    if (!response.ok) {
      throw new FnsApiError(
        response.status === 502
          ? '本地代理无法访问 FNS 服务。请确认服务地址和网络。'
          : response.status === 522
            ? 'FNS 源站暂时未响应（HTTP 522）。请稍后重试。'
            : `服务请求失败（HTTP ${response.status}）。`,
        { status: response.status },
      )
    }
    throw new FnsApiError(`服务返回了无法识别的响应（HTTP ${response.status}）。`, { status: response.status })
  }

  if (!response.ok || !payload.status) {
    // FNS returns application-level auth errors with HTTP 200 (for example
    // codes 307/308). Preserve both fields so callers can invalidate stale
    // sessions instead of rendering a task workspace that cannot read or
    // save anything.
    throw new FnsApiError(payloadError(payload, `服务请求失败（HTTP ${response.status}）。`), {
      status: response.status,
      code: payload?.code ? String(payload.code) : undefined,
    })
  }
  return payload.data
}

type PaginatedList<T> = {
  list: T[]
  pager?: {
    page: number
    pageSize: number
    totalRows: number
  }
}

async function getAllPages<T>(connection: Connection, endpointPath: string, params: RequestParams, signal?: AbortSignal) {
  const pageSize = 100
  const concurrentPages = 4
  const firstPage = await request<PaginatedList<T>>(connection, endpointPath, { params: { ...params, page: 1, pageSize }, signal })
  const items = [...(firstPage.list ?? [])]
  const totalRows = firstPage.pager?.totalRows ?? items.length
  const pages = Array.from({ length: Math.max(Math.ceil(totalRows / pageSize) - 1, 0) }, (_, index) => index + 2)

  for (let start = 0; start < pages.length; start += concurrentPages) {
    const batch = pages.slice(start, start + concurrentPages)
    const results = await Promise.all(batch.map((page) => request<PaginatedList<T>>(connection, endpointPath, { params: { ...params, page, pageSize }, signal })))
    items.push(...results.flatMap((result) => result.list ?? []))
  }

  return items
}

function getAllNotes(connection: Connection, vault: string, keyword = '', searchMode: 'content' | 'path' = 'content', signal?: AbortSignal) {
  return getAllPages<NoteSummary>(connection, '/api/notes', {
    vault,
    keyword,
    searchMode: keyword ? searchMode : undefined,
    sortBy: 'mtime',
    sortOrder: 'desc',
  }, signal)
}

async function searchNotes(connection: Connection, vault: string, keyword: string, signal?: AbortSignal) {
  const [contentMatches, pathMatches] = await Promise.all([
    getAllNotes(connection, vault, keyword, 'content', signal),
    getAllNotes(connection, vault, keyword, 'path', signal),
  ])
  return [...new Map([...contentMatches, ...pathMatches].map((note) => [note.pathHash || note.path, note])).values()]
}

function getFolderNotes(connection: Connection, vault: string, path = '') {
  return getAllPages<NoteSummary>(connection, '/api/folder/notes', {
    vault,
    path,
    sortBy: 'mtime',
    sortOrder: 'desc',
  })
}

function getFolderFiles(connection: Connection, vault: string, path = '') {
  return getAllPages<FileSummary>(connection, '/api/folder/files', {
    vault,
    path,
    sortBy: 'mtime',
    sortOrder: 'desc',
  })
}

function getAllFiles(connection: Connection, vault: string, keyword = '') {
  return getAllPages<FileSummary>(connection, '/api/files', {
    vault,
    keyword,
    sortBy: 'mtime',
    sortOrder: 'desc',
  })
}

export const fnsApi = {
  login: (connection: Connection, credentials: string, password: string) => request<User>(
    { ...connection, clientType: 'webgui' },
    '/api/user/login',
    {
      method: 'POST',
      requireAuth: false,
      body: { credentials, password, ...(connection.user?.tokenId ? { tokenId: connection.user.tokenId } : {}) },
    },
  ),
  logout: (connection: Connection) => request<null>(connection, '/api/auth/logout', { method: 'POST' }),
  getUserInfo: (connection: Connection) => request<User>(connection, '/api/user/info'),
  issueApiToken: (connection: Connection, options?: { clientType?: string; expiredDays?: number; vaults?: string }) => request<ApiTokenCreated>(connection, '/api/token', {
    method: 'POST',
    body: {
      clientType: options?.clientType || 'browser-extension',
      scope: 'rest',
      expiredDays: options?.expiredDays || 365,
      vaults: options?.vaults || '',
    },
  }),
  getVaults: (connection: Connection) => request<Vault[]>(connection, '/api/vault'),
  createVault: (connection: Connection, name: string) => request<Vault>(connection, '/api/vault', {
    method: 'POST',
    body: { vault: name.trim() },
  }),
  getNotes: getAllNotes,
  searchNotes,
  getFiles: getAllFiles,
  getFolderNotes,
  getFolderFiles,
  getNote: async (connection: Connection, vault: string, path: string, signal?: AbortSignal) => {
    const note = await request<Note>(connection, '/api/note', { params: { vault, path }, signal })
    // The detail endpoint omits size; derive bytes from the returned body.
    return { ...note, size: new TextEncoder().encode(note.content).length }
  },
  getFile: (connection: Connection, vault: string, path: string, signal?: AbortSignal) => request<FileSummary>(connection, '/api/file/info', {
    params: { vault, path },
    signal,
  }),
  saveNote: (connection: Connection, vault: string, path: string, content: string, options?: { createOnly?: boolean; pathHash?: string }) => request<Note>(connection, '/api/note', {
    method: 'POST',
    body: { vault, path, content, pathHash: options?.pathHash, createOnly: options?.createOnly },
  }),
  deleteNote: (connection: Connection, vault: string, path: string, pathHash?: string) => request<Note>(connection, '/api/note', {
    method: 'DELETE',
    body: { vault, path, pathHash },
  }),
  renameNote: (connection: Connection, vault: string, oldPath: string, path: string, oldPathHash?: string) => request<Note>(connection, '/api/note/rename', {
    method: 'POST',
    body: { vault, oldPath, path, oldPathHash },
  }),
  createShare: (connection: Connection, payload: { vault: string; path: string; pathHash: string; password?: string; expireAt?: number }) => request<Share>(connection, '/api/share', {
    method: 'POST',
    body: payload,
  }),
  queryShare: (connection: Connection, vault: string, path: string, pathHash: string) => request<Share>(connection, '/api/share', {
    params: { vault, path, pathHash },
  }),
  updateSharePassword: (connection: Connection, payload: { vault: string; path: string; pathHash: string; password?: string; expireAt?: number }) => request<null>(connection, '/api/share/password', {
    method: 'POST',
    body: payload,
  }),
  cancelShare: (connection: Connection, payload: { vault: string; id?: number; path?: string; pathHash?: string }) => request<null>(connection, '/api/share', {
    method: 'DELETE',
    body: payload,
  }),
  getShares: (connection: Connection) => getAllPages<ShareListItem>(connection, '/api/shares', { sort_by: 'created_at', sort_order: 'desc' }),
  createShortLink: (connection: Connection, payload: { vault: string; path: string; pathHash: string; url: string }) => request<string>(connection, '/api/share/short_link', {
    method: 'POST',
    body: payload,
  }),
  getFolderTree: (connection: Connection, vault: string) => request<FolderTree>(connection, '/api/folder/tree', { params: { vault, depth: 32 } }),
  createFolder: (connection: Connection, vault: string, path: string) => request<any>(connection, '/api/folder', {
    method: 'POST',
    body: { vault, path },
  }),
  deleteFolder: (connection: Connection, vault: string, path: string, pathHash?: string) => request<null>(connection, '/api/folder', {
    method: 'DELETE',
    body: { vault, path, pathHash },
  }),
  deleteFile: (connection: Connection, vault: string, path: string, pathHash?: string) => request<null>(connection, '/api/file', {
    method: 'DELETE',
    body: { vault, path, pathHash },
  }),
  renameFile: (connection: Connection, vault: string, oldPath: string, path: string, oldPathHash?: string) => request<any>(connection, '/api/file/rename', {
    method: 'POST',
    body: { vault, oldPath, path, oldPathHash },
  }),
}
