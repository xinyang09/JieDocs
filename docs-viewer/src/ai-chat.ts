import { readChatDocuments, type ChatDocument } from './chat-documents.ts'
import { readKnowledgeSearch, type KnowledgeSearch } from './chat-knowledge.ts'

/**
 * A model reference is deliberately small: the provider value is an opaque
 * server-side identifier (for example `custom:profile-id`) and never carries
 * a base URL or credential. The optional display fields are metadata returned
 * by the model catalog and are safe to keep in local chat history.
 */
export type ChatModel = {
  provider: string
  id: string
  displayName?: string
  providerName?: string
}

export function readChatModel(value: unknown): ChatModel | undefined {
  if (!value || typeof value !== 'object') return undefined
  const model = value as Partial<ChatModel>
  if (typeof model.provider !== 'string' || !model.provider || typeof model.id !== 'string' || !model.id) return undefined
  const result: ChatModel = { provider: model.provider, id: model.id }
  if (typeof model.displayName === 'string' && model.displayName) result.displayName = model.displayName
  if (typeof model.providerName === 'string' && model.providerName) result.providerName = model.providerName
  return result
}

export function chatModelKey(model?: ChatModel) {
  return model ? JSON.stringify([model.provider, model.id]) : ''
}

export function chatModelLabel(model: ChatModel) {
  return model.displayName || model.id
}

export function chatModelProviderLabel(model: ChatModel) {
  if (model.providerName) return model.providerName
  return model.provider.startsWith('custom:') ? `自定义 API · ${model.provider.slice('custom:'.length)}` : model.provider
}

function readChatProcess(value: unknown) {
  return Array.isArray(value)
    ? value.filter((step): step is string => typeof step === 'string' && Boolean(step.trim())).map((step) => step.trim().slice(0, 80)).slice(0, 8)
    : undefined
}

function readChatTools(value: unknown, documents: ChatDocument[], knowledgeSearch?: KnowledgeSearch) {
  const tools = Array.isArray(value) ? value.filter((tool): tool is string => typeof tool === 'string' && Boolean(tool.trim())).slice(0, 8) : []
  if (tools.length > 0 || (!documents.length && !knowledgeSearch)) return tools
  return knowledgeSearch ? ['知识库检索', '文档读取'] : ['文档读取']
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  status?: 'pending' | 'done' | 'error' | 'stopped'
  error?: string
  documents?: ChatDocument[]
  knowledgeSearch?: KnowledgeSearch
  tools?: string[]
  process?: string[]
}

export type ChatSession = {
  id: string
  title: string
  titleEdited?: boolean
  updatedAt: number
  messages: ChatMessage[]
  model?: ChatModel
  documents?: ChatDocument[]
}

export type ChatHistory = { sessions: ChatSession[]; activeId: string; model?: ChatModel }

export const maxChatTitleLength = 80

export function renameChatSession(session: ChatSession, title: string) {
  const nextTitle = title.trim().slice(0, maxChatTitleLength)
  if (!nextTitle || nextTitle === session.title) return session
  return { ...session, title: nextTitle, titleEdited: true }
}

export function chatSessionTitle(session: ChatSession, content: string) {
  return session.titleEdited || session.messages.length ? session.title : content.slice(0, 24)
}

export function chatSessionMarkdown(session: ChatSession) {
  const sections = [`# ${session.title}`]
  for (const message of session.messages) {
    const fallback = message.status === 'pending' ? '正在生成…' : message.status === 'stopped' ? '已停止生成。' : message.error ? `请求失败：${message.error}` : ''
    const content = message.content || fallback
    if (!content.trim() && !message.documents?.length && !message.knowledgeSearch) continue
    const lines = [`## ${message.role === 'user' ? '你' : 'AI'}`]
    if (message.documents?.length) lines.push(`引用文档：${message.documents.map((document) => `${document.vault}/${document.path}`).join('、')}`)
    if (message.knowledgeSearch) lines.push(`检索知识库：${message.knowledgeSearch.vault}（匹配 ${message.knowledgeSearch.matched} 篇，引用 ${message.knowledgeSearch.included} 篇）`)
    if (message.tools?.length) lines.push(`使用工具：${message.tools.join('、')}`)
    if (message.process?.length) lines.push(`执行过程：${message.process.join(' → ')}`)
    if (content) lines.push('', content)
    sections.push(lines.join('\n'))
  }
  return `${sections.join('\n\n---\n\n')}\n`
}

export function readChatHistory(raw: string | null): ChatHistory {
  try {
    const value = JSON.parse(raw || '{}')
    const sessions: ChatSession[] = []
    for (const session of Array.isArray(value?.sessions) ? value.sessions : []) {
      if (!session || typeof session.id !== 'string' || !session.id || sessions.some((item) => item.id === session.id)
        || typeof session.title !== 'string' || !Number.isFinite(session.updatedAt) || !Array.isArray(session.messages)) continue
      const messages: ChatMessage[] = session.messages
        .filter((message: ChatMessage | null) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
        .map((message: ChatMessage, index: number, all: ChatMessage[]) => {
          const documents = message.documents === undefined && message.role === 'assistant'
            ? readChatDocuments(all[index - 1]?.documents)
            : readChatDocuments(message.documents)
          return {
            role: message.role,
            content: message.content,
            status: message.status === 'pending' || message.status === 'stopped' ? 'stopped' : message.status === 'error' ? 'error' : 'done',
            error: typeof message.error === 'string' ? message.error : undefined,
            documents,
            knowledgeSearch: readKnowledgeSearch(message.knowledgeSearch),
            tools: readChatTools(message.tools, documents, readKnowledgeSearch(message.knowledgeSearch)),
            process: readChatProcess(message.process),
          }
        })
      sessions.push({ id: session.id, title: session.title, titleEdited: session.titleEdited === true, updatedAt: session.updatedAt, messages, model: readChatModel(session.model), documents: readChatDocuments(session.documents) })
    }
    return { sessions, activeId: sessions.some((session) => session.id === value.activeId) ? value.activeId : sessions[0]?.id || '', model: readChatModel(value.model) }
  } catch {
    return { sessions: [], activeId: '' }
  }
}

export function chatInstruction(messages: ChatMessage[], content: string) {
  const history = messages.filter((message) => message.role === 'user' || message.status === 'done')
    .slice(-6).map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.slice(0, 1000)}`).join('\n')
  return `${history ? `${history}\n` : ''}User: ${content.slice(0, 4000)}\nAssistant:`
}
