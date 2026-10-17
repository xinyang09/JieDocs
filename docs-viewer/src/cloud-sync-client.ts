import type { Connection } from './types'

export type CloudSyncKind = 'note' | 'file' | 'folder' | 'setting'
export type CloudSyncResource = {
  kind: CloudSyncKind
  action: string
  path: string
  pathHash: string
  contentHash?: string
  version?: number
  size?: number
  ctime?: number
  mtime?: number
  lastTime?: number
}

export type CloudSyncPage = {
  protocolVersion: 2
  items: CloudSyncResource[]
  nextCursor: string
  hasMore: boolean
}

export type CloudSyncSession = {
  protocolVersion: 2
  sessionId: string
  deviceId: string
  vault: string
  snapshotRequired: boolean
  expiresAt: string
  readableKinds: Record<string, boolean>
  writableKinds: string[]
  maxPageSize: number
}

export type CloudSyncDevice = {
  id: string
  deviceId: string
  clientName: string
  clientType: string
  clientVersion: string
  version: number
  lastSeen: string
  revoked: boolean
}

export class CloudSyncError extends Error {
  constructor(message: string, readonly status: number, readonly data?: unknown) {
    super(message)
    this.name = 'CloudSyncError'
  }
}

export async function getCloudSyncStatus(connection: Connection): Promise<{ enabled: boolean }> {
  const value = connection.baseUrl.trim().replace(/\/$/, '')
  if (!value) return { enabled: false }
  try {
    const response = await fetch(`${value}/api/sync/status`, { headers: { Accept: 'application/json' } })
    const payload = await response.json() as CloudSyncResponse<{ enabled?: boolean }>
    return { enabled: response.ok && payload.status !== false && payload.data?.enabled === true }
  } catch {
    return { enabled: false }
  }
}

type CloudSyncResponse<T> = { status?: boolean; message?: string; data?: T; error?: string }
export type CloudSyncOperation = {
  requestId: string
  kind: 'note' | 'setting' | 'folder'
  action: 'create' | 'update'
  path: string
  pathHash?: string
  content?: string
  contentHash?: string
  baseContentHash?: string
  version?: number
  ctime?: number
  mtime?: number
}

function base(connection: Connection) {
  const value = connection.baseUrl.trim()
  if (!value) throw new CloudSyncError('未配置 FNS 服务地址。', 400)
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function headers(connection: Connection): HeadersInit {
  const token = connection.token.trim()
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
    'X-Client': connection.clientType || 'web',
    'X-Client-Name': 'FNS Cloud Sync Client',
    'X-Client-Version': '2',
  }
}

async function jsonRequest<T>(connection: Connection, path: string, options: RequestInit = {}): Promise<T> {
  if (!connection.token.trim()) throw new CloudSyncError('请先登录。', 401)
  const response = await fetch(`${base(connection)}${path}`, { ...options, headers: { ...headers(connection), ...(options.headers || {}) } })
  let payload: CloudSyncResponse<T> | null = null
  try { payload = await response.json() as CloudSyncResponse<T> } catch { /* handled below */ }
  if (!response.ok || !payload?.status) throw new CloudSyncError(payload?.message || payload?.error || `同步请求失败（HTTP ${response.status}）。`, response.status, payload?.data)
  return payload.data as T
}

export class CloudSyncClient {
  constructor(readonly connection: Connection, readonly vault: string, readonly deviceId: string) {}

  createSession(clientName = 'Cloud Sync Client', clientType = this.connection.clientType || 'web', clientVersion = '2', signal?: AbortSignal) {
    return jsonRequest<CloudSyncSession>(this.connection, '/api/sync/sessions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault: this.vault, deviceId: this.deviceId, clientName, clientType, clientVersion }) })
  }

  snapshot(sessionId: string, cursor = '', limit = 100, signal?: AbortSignal) {
    return this.page(sessionId, '/snapshot', cursor, limit, signal)
  }

  changes(sessionId: string, cursor: string, limit = 100, signal?: AbortSignal) {
    if (!cursor) throw new CloudSyncError('changes 需要上一次快照或差异页返回的 cursor。', 400)
    return this.page(sessionId, '/changes', cursor, limit, signal)
  }

  private page(sessionId: string, route: '/snapshot' | '/changes', cursor: string, limit: number, signal?: AbortSignal) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return jsonRequest<CloudSyncPage>(this.connection, `/api/sync/sessions/${encodeURIComponent(sessionId)}${route}?${params}`, { signal })
  }

  commit(sessionId: string, operation: CloudSyncOperation, signal?: AbortSignal) {
    return jsonRequest<{ status: string; kind: string; resource: unknown }>(this.connection, `/api/sync/sessions/${encodeURIComponent(sessionId)}/operations`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) })
  }

  async uploadAttachment(path: string, file: Blob, modifiedAt = Date.now(), signal?: AbortSignal) {
    if (!this.connection.token.trim()) throw new CloudSyncError('请先登录。', 401)
    const form = new FormData()
    form.set('vault', this.vault)
    form.set('path', path)
    form.set('ctime', String(modifiedAt))
    form.set('mtime', String(modifiedAt))
    form.set('file', file, path.split('/').pop() || 'attachment')
    const response = await fetch(`${base(this.connection)}/api/file`, { method: 'POST', headers: headers(this.connection), body: form, signal })
    const payload = await response.json() as CloudSyncResponse<unknown>
    if (!response.ok || !payload.status) throw new CloudSyncError(payload.message || '附件上传失败。', response.status, payload.data)
    return payload.data
  }

  async downloadAttachment(path: string, signal?: AbortSignal) {
    const response = await fetch(`${base(this.connection)}/api/file?vault=${encodeURIComponent(this.vault)}&path=${encodeURIComponent(path)}`, { headers: headers(this.connection), signal })
    if (!response.ok) throw new CloudSyncError(`附件下载失败（HTTP ${response.status}）。`, response.status)
    return response.blob()
  }

  deleteAttachment(path: string, pathHash?: string, signal?: AbortSignal) {
    return jsonRequest<unknown>(this.connection, '/api/file', { method: 'DELETE', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault: this.vault, path, pathHash }) })
  }

  createFolder(path: string, signal?: AbortSignal) {
    return jsonRequest<unknown>(this.connection, '/api/folder', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault: this.vault, path }) })
  }

  deleteFolder(path: string, pathHash?: string, signal?: AbortSignal) {
    return jsonRequest<unknown>(this.connection, '/api/folder', { method: 'DELETE', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault: this.vault, path, pathHash }) })
  }

  renameFile(oldPath: string, path: string, oldPathHash?: string, signal?: AbortSignal) {
    return jsonRequest<unknown>(this.connection, '/api/file/rename', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault: this.vault, oldPath, path, oldPathHash }) })
  }

  renameSetting(oldPath: string, path: string, oldPathHash?: string, signal?: AbortSignal) {
    return jsonRequest<unknown>(this.connection, '/api/setting/rename', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault: this.vault, oldPath, newPath: path, oldPathHash }) })
  }

  listDevices(signal?: AbortSignal) {
    return jsonRequest<CloudSyncDevice[]>(this.connection, `/api/sync/devices?vault=${encodeURIComponent(this.vault)}`, { signal })
  }

  renameDevice(deviceId: string, version: number, name: string, signal?: AbortSignal) {
    return jsonRequest<{ updated: boolean; version: number }>(this.connection, `/api/sync/devices/${encodeURIComponent(deviceId)}?vault=${encodeURIComponent(this.vault)}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, name }) })
  }

  revokeDevice(deviceId: string, version: number, signal?: AbortSignal) {
    return jsonRequest<{ updated: boolean; version: number }>(this.connection, `/api/sync/devices/${encodeURIComponent(deviceId)}?vault=${encodeURIComponent(this.vault)}`, { method: 'DELETE', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) })
  }

  connectWebSocket(): CloudSyncSocket {
    const url = new URL(`${base(this.connection)}/api/sync/ws`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('client', this.connection.clientType || 'web')
    url.searchParams.set('clientName', 'FNS Cloud Sync Client')
    url.searchParams.set('clientVersion', '2')
    return new CloudSyncSocket(url, this.connection.token, this.vault)
  }
}

export class CloudSyncSocket {
  private socket: WebSocket
  private authorization: Promise<void>

  constructor(url: URL, token: string, readonly vault: string) {
    this.socket = new WebSocket(url)
    this.authorization = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => this.socket.send(`Authorization|${token.replace(/^Bearer\s+/i, '')}`), { once: true })
      this.socket.addEventListener('message', (event) => {
        const [action, raw] = decodeFrame(String(event.data))
        if (action !== 'Authorization') return
        try {
          const response = JSON.parse(raw) as { status?: boolean; message?: string }
          if (response.status) resolve()
          else reject(new CloudSyncError(response.message || 'WebSocket 授权失败。', 401))
        } catch (error) { reject(error) }
      })
      this.socket.addEventListener('error', () => reject(new CloudSyncError('WebSocket 连接失败。', 503)), { once: true })
    })
  }

  async pull(sessionId: string, options: { cursor?: string; snapshot?: boolean; limit?: number } = {}): Promise<CloudSyncPage> {
    await this.authorization
    const request = { sessionId, cursor: options.cursor || '', snapshot: options.snapshot ?? !options.cursor, limit: Math.min(Math.max(options.limit || 100, 1), 500) }
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        const [action, raw] = decodeFrame(String(event.data))
        if (action !== 'CloudSyncPage') return
        this.socket.removeEventListener('message', onMessage)
        try {
          const response = JSON.parse(raw) as CloudSyncResponse<CloudSyncPage>
          if (!response.status) reject(new CloudSyncError(response.message || '同步拉取失败。', 409, response.data))
          else resolve(response.data as CloudSyncPage)
        } catch (error) { reject(error) }
      }
      this.socket.addEventListener('message', onMessage)
      this.socket.send(`CloudSyncPull|${JSON.stringify(request)}`)
    })
  }

  close() { this.socket.close(1000, 'client closed') }
}

function decodeFrame(value: string): [string, string] {
  const separator = value.indexOf('|')
  return separator < 0 ? [value, ''] : [value.slice(0, separator), value.slice(separator + 1)]
}
