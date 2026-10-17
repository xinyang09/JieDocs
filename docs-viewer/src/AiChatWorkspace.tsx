import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowDown, Check, ChevronDown, Copy, Download, FileText, History, LoaderCircle, MessageCircle, Pencil, Plus, Search, Send, Sparkles, Square, Trash2, Wrench, X } from 'lucide-react'
import { fnsApi, getAIModels, runPiAssistant } from './api'
import { ChatReferencePanel } from './ChatReferencePanel'
import { ChatDocumentPicker } from './ChatDocumentPicker'
import { VoiceInput } from './VoiceInput'
import { appendSpeechDraft } from './speech-input'
import { searchChatKnowledge } from './chat-knowledge'
import { chatDocumentKey, loadChatDocumentContext, type ChatDocument } from './chat-documents'
import type { Connection } from './types'
import { chatInstruction, chatModelKey, chatModelLabel, chatModelProviderLabel, chatSessionMarkdown, chatSessionTitle, maxChatTitleLength, readChatHistory, renameChatSession, type ChatHistory, type ChatMessage, type ChatSession, type ChatModel } from './ai-chat'
import './ai-chat.css'
import './chat-documents.css'

export default function AiChatWorkspace({ storageKey, connection, vault }: { storageKey: string; connection: Connection; vault: string }) {
  const [history, setHistory] = useState<ChatHistory>(() => {
    try { return readChatHistory(localStorage.getItem(storageKey)) } catch { return readChatHistory(null) }
  })
  const [draft, setDraft] = useState('')
  const [voiceActive, setVoiceActive] = useState(false)
  const [query, setQuery] = useState('')
  const [runningId, setRunningId] = useState('')
  const [contextStatus, setContextStatus] = useState('')
  const [storageError, setStorageError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState('')
  const [editingTitle, setEditingTitle] = useState('')
  const [models, setModels] = useState<ChatModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelsError, setModelsError] = useState('')
  const [modelsRevision, setModelsRevision] = useState(0)
  const [showModelPopover, setShowModelPopover] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(true)
  const [pendingDocuments, setPendingDocuments] = useState<ChatDocument[]>([])
  const [referenceIndex, setReferenceIndex] = useState<number | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const request = useRef<AbortController | null>(null)
  const messageList = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const modelPopover = useRef<HTMLDivElement>(null)
  const activeSession = history.sessions.find((session) => session.id === history.activeId)
  const selectedDocuments = activeSession ? activeSession.documents || [] : pendingDocuments
  const referenceReply = referenceIndex === null ? [...(activeSession?.messages || [])].reverse().find((message) => message.role === 'assistant') : activeSession?.messages[referenceIndex]
  const selectedModel = activeSession ? activeSession.model : history.model
  const selectedModelKey = chatModelKey(selectedModel)
  const modelUnavailable = Boolean(selectedModel && !modelsLoading && !modelsError && !models.some((model) => chatModelKey(model) === selectedModelKey))
  const visibleModels = models.filter((model) => `${model.provider} ${model.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()))
  const visibleSessions = history.sessions.filter((session) => session.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => right.updatedAt - left.updatedAt)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(history))
      setStorageError('')
    } catch { setStorageError('无法保存历史对话，浏览器存储空间可能不足。本次对话仍可继续。') }
  }, [history, storageKey])

  useEffect(() => () => { request.current?.abort() }, [])

  useEffect(() => {
    setReferenceIndex(null)
    setEditingSessionId('')
    setEditingTitle('')
  }, [history.activeId])

  useEffect(() => {
    const controller = new AbortController()
    setModelsLoading(true)
    setModelsError('')
    void getAIModels(connection, controller.signal).then((available) => {
      if (!controller.signal.aborted) setModels(available)
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setModelsError(error.message)
    }).finally(() => {
      if (!controller.signal.aborted) setModelsLoading(false)
    })
    return () => controller.abort()
  }, [connection, modelsRevision])

  useEffect(() => {
    const refresh = () => setModelsRevision((current) => current + 1)
    window.addEventListener('ai-providers-changed', refresh)
    return () => window.removeEventListener('ai-providers-changed', refresh)
  }, [])

  function changeModel(key: string) {
    if (request.current) return
    const model = models.find((item) => chatModelKey(item) === key)
    setHistory((current) => ({ ...current, model, sessions: current.sessions.map((session) => session.id === current.activeId ? { ...session, model } : session) }))
    setShowModelPopover(false)
    setModelQuery('')
  }

  useEffect(() => {
    const list = messageList.current
    if (!list) return
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    if (distanceFromBottom < 180) list.scrollTop = list.scrollHeight
  }, [activeSession])

  useEffect(() => {
    const list = messageList.current
    if (!list) return
    const updateScrollState = () => setShowScrollToLatest(list.scrollHeight - list.scrollTop - list.clientHeight > 180)
    list.addEventListener('scroll', updateScrollState, { passive: true })
    updateScrollState()
    return () => list.removeEventListener('scroll', updateScrollState)
  }, [history.activeId])

  useEffect(() => {
    if (!showModelPopover) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!modelPopover.current?.contains(event.target as Node)) setShowModelPopover(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [showModelPopover])

  function createSession() {
    const session: ChatSession = { id: crypto.randomUUID(), title: '新对话', updatedAt: Date.now(), messages: [], model: history.model }
    setHistory((current) => ({ ...current, sessions: [session, ...current.sessions], activeId: session.id }))
    setPendingDocuments([])
    setDraft('')
    setQuery('')
    setShowHistory(false)
    composer.current?.focus()
  }

  function beginRename(session: ChatSession) {
    if (session.id === runningId) return
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
  }

  function commitRename(session: ChatSession) {
    if (editingSessionId !== session.id) return
    const renamed = renameChatSession(session, editingTitle)
    if (renamed !== session) {
      setHistory((current) => ({
        ...current,
        sessions: current.sessions.map((item) => item.id === session.id ? renamed : item),
      }))
    }
    setEditingSessionId('')
    setEditingTitle('')
  }

  function exportCurrentSession() {
    if (!activeSession?.messages.length || runningId) return
    const filename = `${activeSession.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'AI对话'}.md`
    const blob = new Blob([chatSessionMarkdown(activeSession)], { type: 'text/markdown;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }

  async function copyMessage(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIndex(index)
      window.setTimeout(() => setCopiedIndex((current) => current === index ? null : current), 1600)
    } catch {
      setCopiedIndex(null)
    }
  }

  function scrollToLatest() {
    messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' })
    setShowScrollToLatest(false)
  }

  function deleteSession(session: ChatSession) {
    if (session.id === runningId || !window.confirm(`删除“${session.title}”及其全部消息？此操作无法撤销。`)) return
    const deletingActiveSession = history.activeId === session.id
    setHistory((current) => {
      const sessions = current.sessions.filter((item) => item.id !== session.id)
      return { ...current, sessions, activeId: current.activeId === session.id ? sessions[0]?.id || '' : current.activeId }
    })
    if (deletingActiveSession && history.sessions.length === 1) setPendingDocuments([])
  }

  function changeDocuments(documents: ChatDocument[]) {
    if (!activeSession) {
      setPendingDocuments(documents)
      return
    }
    setHistory((current) => ({
      ...current,
      sessions: current.sessions.map((session) => session.id === current.activeId ? { ...session, documents } : session),
    }))
  }

  async function sendMessage(retryIndex?: number) {
    if (request.current || modelUnavailable || voiceActive) return
    const retryContent = retryIndex === undefined ? '' : activeSession?.messages[retryIndex - 1]?.content || ''
    const content = (retryIndex === undefined ? draft : retryContent).trim()
    if (!content) return
    const session = activeSession || { id: crypto.randomUUID(), title: '新对话', updatedAt: Date.now(), messages: [], model: selectedModel }
    const previous = retryIndex === undefined ? session.messages : session.messages.slice(0, retryIndex - 1)
    const documents = [...(retryIndex === undefined ? selectedDocuments : session.messages[retryIndex - 1]?.documents || [])]
    const initialProcess = documents.length
      ? ['准备请求', '读取引用文档']
      : useKnowledgeBase
        ? ['准备请求', '检索知识库']
        : ['准备请求', '分析问题']
    const nextMessages: ChatMessage[] = [...previous, { role: 'user', content, documents }, { role: 'assistant', content: '', status: 'pending', process: initialProcess }]
    const nextSession = { ...session, title: chatSessionTitle(session, content), updatedAt: Date.now(), messages: nextMessages, documents }
    const controller = new AbortController()
    request.current = controller
    setRunningId(session.id)
    setContextStatus(documents.length ? '正在读取引用文档…' : '正在检索整个知识库…')
    setReferenceIndex(null)
    setHistory((current) => ({ ...current, activeId: session.id, sessions: [nextSession, ...current.sessions.filter((item) => item.id !== session.id)] }))
    setDraft('')

    function updateReply(patch: Partial<ChatMessage>) {
      setHistory((current) => ({ ...current, sessions: current.sessions.map((item) => item.id !== session.id ? item : {
        ...item, messages: item.messages.map((message, index) => index === nextMessages.length - 1 ? { ...message, ...patch } : message),
      }) }))
    }

    try {
      const knowledge = documents.length || !useKnowledgeBase ? undefined : await searchChatKnowledge(vault, content, {
        list: (signal) => fnsApi.getNotes(connection, vault, '', 'content', signal),
        search: (keyword, signal) => fnsApi.searchNotes(connection, vault, keyword, signal),
        read: (document, signal) => fnsApi.getNote(connection, document.vault, document.path, signal),
      }, controller.signal)
      const documentContext = knowledge ? knowledge.context : documents.length ? await loadChatDocumentContext(documents, (document) => fnsApi.getNote(connection, document.vault, document.path, controller.signal), controller.signal) : ''
      controller.signal.throwIfAborted()
      setContextStatus('')
      const contextStep = knowledge || documents.length ? '整理参考内容' : '整理上下文'
      updateReply({ documents: knowledge?.documents || documents, knowledgeSearch: knowledge?.search, tools: documents.length ? ['文档读取'] : useKnowledgeBase ? ['知识库检索', '文档读取'] : [], process: [...initialProcess, contextStep, '生成回答'] })
      const result = await runPiAssistant(chatInstruction(previous, content), documentContext, '',
        (text) => updateReply({ content: text }), { signal: controller.signal, model: selectedModel, connection, vault })
      updateReply({ content: result, status: 'done', process: [...initialProcess, '整理参考内容', '生成回答', '已完成'] })
    } catch (reason) {
      updateReply(controller.signal.aborted
        ? { status: 'stopped', process: [...initialProcess, '已停止'] }
        : { status: 'error', process: [...initialProcess, '请求失败'], error: reason instanceof Error ? reason.message : 'AI 请求失败，请稍后重试。' })
    } finally {
      request.current = null
      setRunningId('')
      setContextStatus('')
    }
  }

  return <div className={`ai-chat-workspace ${showHistory ? 'is-history-open' : ''}`}>
    <aside className="ai-chat-history" aria-label="AI 历史对话">
      <header className="ai-chat-history-header"><h2><MessageCircle size={17} />AI 对话</h2><button type="button" className="icon-button compact ai-history-close" onClick={() => setShowHistory(false)} aria-label="关闭历史对话"><X size={16} /></button></header>
      <button type="button" className="ai-new-chat-button" onClick={createSession}><Plus size={15} />新建对话</button>
      <label className="ai-history-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索历史对话" aria-label="搜索历史对话" /></label>
      <div className="ai-history-label">历史对话 <span>{history.sessions.length}</span></div>
      <div className="ai-session-list">{visibleSessions.map((session) => <div key={session.id} className={`ai-session-row ${session.id === history.activeId ? 'is-active' : ''}${editingSessionId === session.id ? ' is-renaming' : ''}`}>
        {editingSessionId === session.id ? <>
          <input autoFocus type="text" className="ai-session-rename" value={editingTitle} maxLength={maxChatTitleLength} aria-label={`重命名对话：${session.title}`} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } if (event.key === 'Escape') { event.preventDefault(); setEditingSessionId(''); setEditingTitle('') } }} onBlur={() => commitRename(session)} />
          <button type="button" className="icon-button compact ai-rename-chat" onMouseDown={(event) => event.preventDefault()} onClick={() => commitRename(session)} title="保存标题" aria-label="保存标题"><Check size={13} /></button>
          <button type="button" className="icon-button compact ai-delete-chat" onMouseDown={(event) => event.preventDefault()} onClick={() => { setEditingSessionId(''); setEditingTitle('') }} title="取消重命名" aria-label="取消重命名"><X size={13} /></button>
        </> : <>
          <button type="button" className="ai-session-item" aria-current={session.id === history.activeId ? 'true' : undefined} onClick={() => { setHistory((current) => ({ ...current, activeId: session.id })); setDraft(''); setShowHistory(false) }}>
            {runningId === session.id ? <LoaderCircle size={15} className="spin" /> : <MessageCircle size={15} />}
            <span><strong title={session.title}>{session.title}</strong><small>{new Date(session.updatedAt).toLocaleDateString('zh-CN')}</small></span>
          </button>
          <button type="button" className="icon-button compact ai-rename-chat" disabled={session.id === runningId} onClick={() => beginRename(session)} title="重命名对话" aria-label={`重命名对话：${session.title}`}><Pencil size={13} /></button>
          <button type="button" className="icon-button compact ai-delete-chat" disabled={session.id === runningId} onClick={() => deleteSession(session)} title="删除对话" aria-label={`删除对话：${session.title}`}><Trash2 size={13} /></button>
        </>}
      </div>)}</div>
      {!visibleSessions.length ? <p className="ai-history-empty">{query ? '没有匹配的对话' : '开始提问后，对话会保存在这里。'}</p> : null}
      <p className="ai-history-footer">历史记录仅保存在当前浏览器</p>
    </aside>
    {showHistory ? <button type="button" className="ai-history-scrim" onClick={() => setShowHistory(false)} aria-label="收起历史对话" /> : null}
    <section className="ai-chat-main" aria-label="AI 对话窗口">
      <header className="ai-chat-main-header"><button type="button" className="icon-button ai-history-toggle" onClick={() => setShowHistory(true)} aria-label="查看历史对话"><History size={18} /></button><h1>{activeSession?.title || '新对话'}</h1><button type="button" className="icon-button compact ai-export-chat" disabled={!activeSession?.messages.length || Boolean(runningId)} onClick={exportCurrentSession} title="导出对话" aria-label="导出当前对话"><Download size={15} /></button><span className="ai-chat-status">{runningId === history.activeId && runningId ? '正在生成…' : 'AI 助手'}</span></header>
      {modelsError || modelUnavailable || (!modelsLoading && !models.length) ? <p className="ai-chat-error" role="status">{modelsError || (modelUnavailable ? '当前模型已不可用，请重新选择。不会自动切换到其他模型。' : '暂无可选模型，请在设置中配置模型 API 后刷新列表。')}</p> : null}
      {storageError ? <p className="ai-chat-error" role="alert">{storageError}</p> : null}
      <div className="ai-chat-content-layout">
      <div className="ai-chat-conversation">
      <div ref={messageList} className="ai-message-list" role="log" aria-label="对话消息" aria-live="polite" aria-busy={Boolean(runningId && runningId === history.activeId)} onScroll={() => setShowScrollToLatest(messageList.current ? messageList.current.scrollHeight - messageList.current.scrollTop - messageList.current.clientHeight > 180 : false)}>
        {activeSession?.messages.length ? activeSession.messages.map((message, index) => <div className={`ai-chat-message ${message.role}`} key={`${activeSession.id}-${index}`}>
          <div className="ai-avatar" aria-label={message.role === 'assistant' ? 'AI' : '你'}>{message.role === 'assistant' ? <Sparkles size={15} /> : '你'}</div>
          <div className="ai-message-content">{message.role === 'assistant' && message.process?.length ? <div className={`ai-execution-process${message.status === 'pending' ? ' is-running' : ''}`} aria-label="AI 执行过程"><div className="ai-execution-process-heading"><Sparkles size={12} /><span>执行过程</span></div><ol>{message.process.map((step, stepIndex) => <li key={`${step}-${stepIndex}`} className={message.status === 'pending' && stepIndex === message.process!.length - 1 ? 'is-active' : 'is-done'}><span className="ai-execution-process-marker">{message.status === 'pending' && stepIndex === message.process!.length - 1 ? <LoaderCircle size={11} className="spin" /> : <Check size={11} />}</span><span>{step}</span></li>)}</ol></div> : null}{message.role === 'assistant' && message.tools?.length ? <div className="ai-message-tools" aria-label="使用的工具"><Wrench size={12} />{message.tools.map((tool) => <span key={tool}>{tool}</span>)}</div> : null}{message.knowledgeSearch ? <div className="ai-knowledge-status" aria-label="知识库检索结果">已检索知识库「{message.knowledgeSearch.vault}」 · 匹配 {message.knowledgeSearch.matched} 篇 · 引用 {message.knowledgeSearch.included} 篇</div> : null}{message.role === 'user' && message.documents?.length ? <div className="ai-message-documents" aria-label="问题引用的文档">{message.documents.map((document) => <span key={chatDocumentKey(document)} title={`${document.vault}/${document.path}`}><FileText size={12} />{document.path.split('/').pop()}</span>)}</div> : null}<div className="ai-bubble">{message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : message.content}{message.status === 'pending' && !message.content ? <span className="ai-pending"><LoaderCircle size={14} className="spin" />{contextStatus && runningId === history.activeId ? contextStatus : '正在思考…'}</span> : null}</div>
            {message.role === 'assistant' && message.content && message.status !== 'pending' ? <div className="ai-message-actions"><button type="button" onClick={() => void copyMessage(message.content, index)}><span>{copiedIndex === index ? <Check size={12} /> : <Copy size={12} />}{copiedIndex === index ? '已复制' : '复制'}</span></button>{message.status === 'done' ? <button type="button" disabled={Boolean(runningId)} onClick={() => void sendMessage(index)}>重新生成</button> : null}</div> : null}
            {message.role === 'assistant' && (message.documents?.length || message.knowledgeSearch) ? <button type="button" className="ai-reference-jump" onClick={() => setReferenceIndex(index)}><FileText size={13} />查看引用来源（{message.documents?.length || 0}）</button> : null}
            {message.status === 'error' || message.status === 'stopped' ? <div className="ai-reply-status"><span role={message.status === 'error' ? 'alert' : undefined}>{message.status === 'error' ? message.error || 'AI 请求失败' : '生成已停止'}{message.content ? '（已保留部分回复）' : ''}</span><button type="button" disabled={Boolean(runningId)} onClick={() => void sendMessage(index)}>重新生成</button></div> : null}
          </div>
        </div>) : <div className="ai-chat-empty-state"><div className="ai-empty-icon"><Sparkles size={24} /></div><h3>有什么想聊的？</h3><p>提问、整理思路，或粘贴笔记内容开始讨论。</p><div className="ai-chat-suggestions">{['帮我整理一个想法', '总结一段笔记', '润色一段文字'].map((text) => <button type="button" key={text} onClick={() => { setDraft(text); composer.current?.focus() }}>{text}</button>)}</div></div>}
      </div>
      {showScrollToLatest ? <button type="button" className="ai-scroll-latest" onClick={scrollToLatest}><ArrowDown size={14} />回到最新</button> : null}
      <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}>
        {selectedDocuments.length ? <div className="ai-document-chips" aria-label="已选择的引用文档"><span className="ai-document-chip-label">本次引用</span>{selectedDocuments.map((document) => <span className="ai-document-chip" key={chatDocumentKey(document)} title={`${document.vault}/${document.path}`}><FileText size={13} /><span>{document.path.split('/').pop()}</span><button type="button" disabled={Boolean(runningId)} onClick={() => changeDocuments(selectedDocuments.filter((item) => chatDocumentKey(item) !== chatDocumentKey(document)))} aria-label={`移除引用文档：${document.path}`}><X size={12} /></button></span>)}<button type="button" className="ai-document-clear" disabled={Boolean(runningId)} onClick={() => changeDocuments([])}>清空</button></div> : null}
        <textarea ref={composer} value={draft} maxLength={4000} rows={3} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void sendMessage() } }} placeholder="输入消息，或粘贴需要讨论的内容…" aria-label="输入 AI 消息" />
        <div className="ai-composer-actions"><div className="ai-composer-tools"><ChatDocumentPicker connection={connection} vault={vault} documents={selectedDocuments} disabled={Boolean(runningId)} onChange={changeDocuments} onOpen={() => setShowModelPopover(false)} /><button type="button" className={`ai-knowledge-toggle ${useKnowledgeBase ? 'is-enabled' : ''}`} disabled={Boolean(runningId) || !vault || selectedDocuments.length > 0} onClick={() => setUseKnowledgeBase((current) => !current)} aria-pressed={useKnowledgeBase} title={selectedDocuments.length ? '已选择指定文档，发送时不会检索整个知识库' : useKnowledgeBase ? '关闭知识库检索' : '开启知识库检索'}><span className="ai-knowledge-toggle-dot" />知识库：{selectedDocuments.length ? '指定文档' : useKnowledgeBase ? '已开启' : '已关闭'}</button><button type="button" className="ai-model-inline-trigger" disabled={Boolean(runningId) || modelsLoading} onClick={() => setShowModelPopover((current) => !current)} aria-label="选择 AI 模型" aria-expanded={showModelPopover}><span>{modelsLoading ? '加载模型…' : selectedModel ? chatModelLabel(selectedModel) : '自动'}</span><ChevronDown size={14} /></button>{showModelPopover ? <div ref={modelPopover} className="ai-model-popover" role="dialog" aria-label="选择模型"><div className="ai-model-popover-heading"><strong>选择模型</strong><button type="button" className="icon-button compact" onClick={() => setShowModelPopover(false)} aria-label="关闭模型选择"><X size={14} /></button></div><label className="ai-model-dialog-search"><Search size={14} /><input autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="搜索模型" aria-label="搜索模型" /></label><div className="ai-model-options"><button type="button" className={`ai-model-option ${!selectedModel ? 'is-selected' : ''}`} onClick={() => changeModel('')}><div className="ai-model-option-mark">{!selectedModel ? '✓' : ''}</div><span><strong>自动</strong></span></button>{Array.from(new Set(visibleModels.map((model) => chatModelProviderLabel(model)))).map((providerLabel) => <div className="ai-model-group" key={providerLabel}><h3>{providerLabel}</h3>{visibleModels.filter((model) => chatModelProviderLabel(model) === providerLabel).map((model) => <button type="button" className={`ai-model-option ${chatModelKey(model) === selectedModelKey ? 'is-selected' : ''}`} key={chatModelKey(model)} onClick={() => changeModel(chatModelKey(model))}><div className="ai-model-option-mark">{chatModelKey(model) === selectedModelKey ? '✓' : ''}</div><span><strong>{chatModelLabel(model)}</strong>{chatModelLabel(model) !== model.id ? <small>{model.id}</small> : null}</span></button>)}</div>)}</div><button type="button" className="ai-model-popover-refresh" onClick={() => setModelsRevision((current) => current + 1)} disabled={Boolean(runningId)}>刷新模型列表</button></div> : null}</div><small className="ai-composer-shortcut">{runningId && runningId !== history.activeId ? '另一段对话正在生成，请稍候' : 'Enter 发送 · Shift + Enter 换行'}</small><small className={`ai-composer-count${draft.length >= 3800 ? ' is-near-limit' : ''}`} aria-live="polite">{draft.length}/4000</small><div className="ai-send-actions"><VoiceInput key={history.activeId} disabled={Boolean(runningId) || draft.length >= 4000} onActiveChange={setVoiceActive} onTranscript={(text) => { setDraft((current) => appendSpeechDraft(current, text)); composer.current?.focus() }} />{runningId ? <button type="button" className="ai-send-button" onClick={() => request.current?.abort()} aria-label="停止生成" title="停止生成"><Square size={15} /></button> : <button type="submit" className="ai-send-button" disabled={!draft.trim() || modelUnavailable || voiceActive} aria-label="发送消息" title="发送消息"><Send size={17} /></button>}</div></div>
        <p className="ai-composer-hint">{selectedDocuments.length ? '仅使用已选文档' : useKnowledgeBase ? `自动检索当前知识库${vault ? `「${vault}」` : '（请先选择知识库）'}` : '知识库检索已关闭，当前为普通对话'}，相关内容将发送给所选 AI 模型；不会修改笔记。</p>
      </form>
      </div>
      <ChatReferencePanel key={`${history.activeId}:${referenceIndex}`} reply={referenceReply} selectedReply={referenceIndex !== null} connection={connection} />
      </div>
    </section>
  </div>
}
