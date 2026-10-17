export type Vault = {
  id: number
  vault: string
  noteCount: number
  updatedAt?: string
}

export type NoteSummary = {
  id: number
  path: string
  pathHash: string
  mtime: number
  size: number
  updatedAt?: string
}

export type Note = NoteSummary & {
  content: string
  contentHash: string
  version: number
  ctime: number
  fileLinks?: Record<string, string>
}

export type FileSummary = {
  id: number
  path: string
  pathHash: string
  contentHash?: string
  mtime: number
  size: number
  ctime?: number
  updatedAt?: string
}

export type LibraryItem =
  | (NoteSummary & { kind: 'note' })
  | (FileSummary & { kind: 'file' })

export type FolderNode = {
  path: string
  name: string
  noteCount: number
  fileCount: number
  children?: FolderNode[]
}

export type FolderTree = {
  folders: FolderNode[]
  rootNoteCount: number
  rootFileCount: number
}

export type Connection = {
  baseUrl: string
  token: string
  clientType: string
  defaultVault: string
  user?: User
}

export type User = {
  uid: number
  email?: string
  username: string
  token?: string
  tokenId?: number
  avatar?: string
  isDeleted?: boolean
  updatedAt?: string
  createdAt?: string
}

export type ApiToken = {
  id: number
  clientType: string
  scope: string
  vaults?: string
  expiredAt?: string
  createdAt?: string
}

export type ApiTokenCreated = ApiToken & {
  token: string
}

export type Share = {
  id: number
  type: 'note' | 'file' | string
  token: string
  isPassword: boolean
  expiresAt?: string
  shortLink?: string
  baseUrl: string
}

export type ShareListItem = {
  id: number
  title: string
  url: string
  notePath: string
  vaultName: string
  isPassword: boolean
  status: number
  viewCount: number
  lastViewedAt?: string
  expiresAt?: string
  shortLink?: string
  createdAt?: string
  updatedAt?: string
  baseUrl: string
}

export type ApiResponse<T> = {
  code: number
  status: boolean
  message: string
  data: T
  details?: string | string[]
}
