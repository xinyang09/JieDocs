import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, Eye, EyeOff, LoaderCircle, Pencil, Plus, RefreshCw, Server, Trash2, X } from 'lucide-react'
import { deleteAIProvider, discoverAIProviderModels, getAIProviders, saveAIProvider, testAIProvider, type AIProvider, type AIProviderInput } from './api'
import type { ChatModel } from './ai-chat'
import type { Connection } from './types'

type Draft = AIProviderInput & { id?: string }

const emptyDraft: Draft = {
  name: '',
  type: 'openai-compatible',
  baseUrl: '',
  defaultModel: '',
  enabled: true,
  apiKey: '',
}

function draftFromProvider(provider: AIProvider): Draft {
  return {
    id: provider.id,
    version: provider.version,
    name: provider.name,
    type: provider.type,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    enabled: provider.enabled,
    // Never hydrate a secret from the server. An empty value means keep the
    // existing credential when updating an already configured provider.
    apiKey: '',
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function AiProviderSettings({ connection }: { connection: Connection }) {
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftError, setDraftError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deleting, setDeleting] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [discoveredModels, setDiscoveredModels] = useState<ChatModel[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const [discoveryComplete, setDiscoveryComplete] = useState(false)
  const [discoveryProviderId, setDiscoveryProviderId] = useState('')
  const discoveryController = useRef<AbortController | null>(null)
  const savedProvider = providers.find((provider) => provider.id === draft?.id)
  const discoveryIsCurrent = savedProvider?.id === discoveryProviderId
  const discoveryNeedsSave = Boolean(draft && savedProvider && (
    draft.baseUrl.trim().replace(/\/+$/, '') !== savedProvider.baseUrl.replace(/\/+$/, '')
    || draft.type !== savedProvider.type
    || Boolean(draft.apiKey?.trim())
    || draft.enabled !== savedProvider.enabled
  ))

  async function loadProviders(signal?: AbortSignal) {
    setError('')
    const items = await getAIProviders(connection, signal)
    setProviders(items)
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void loadProviders(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法加载 AI 模型服务。')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
    // The connection identity is stable for one logged-in workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.baseUrl, connection.user?.uid])

  async function discoverModels(id: string) {
    discoveryController.current?.abort()
    const controller = new AbortController()
    discoveryController.current = controller
    setDiscoveryProviderId(id)
    setDiscoveredModels([])
    setDiscoveryError('')
    setDiscoveryComplete(false)
    setDiscovering(true)
    try {
      const models = await discoverAIProviderModels(connection, id, controller.signal)
      if (!controller.signal.aborted) {
        setDiscoveredModels(models)
        setDiscoveryComplete(true)
      }
    } catch (reason) {
      if (!controller.signal.aborted) setDiscoveryError(reason instanceof Error ? reason.message : '无法发现模型，请重试。')
    } finally {
      if (!controller.signal.aborted) setDiscovering(false)
    }
  }

  useEffect(() => {
    setDiscoveredModels([])
    setDiscoveryError('')
    setDiscoveryComplete(false)
    setDiscovering(false)
    if (savedProvider) void discoverModels(savedProvider.id)
    return () => discoveryController.current?.abort()
    // Discovery always uses the saved version, never the unsaved API Key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedProvider?.id, savedProvider?.version, connection.baseUrl, connection.user?.uid])

  function updateDraft(changes: Partial<Draft>) {
    setDraft((current) => current ? { ...current, ...changes } : current)
    setDraftError('')
    setNotice('')
  }

  function beginCreate() {
    setDraft({ ...emptyDraft })
    setDraftError('')
    setNotice('')
    setShowKey(false)
  }

  function beginEdit(provider: AIProvider) {
    setDraft(draftFromProvider(provider))
    setDraftError('')
    setNotice('')
    setShowKey(false)
  }

  function closeEditor() {
    if (saving || testing) return
    setDraft(null)
    setDraftError('')
  }

  async function save() {
    if (!draft || saving || testing) return
    const name = draft.name.trim()
    const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '')
    const defaultModel = draft.defaultModel.trim()
    if (!name) { setDraftError('请输入服务名称。'); return }
    if (!isHttpUrl(baseUrl)) { setDraftError('请输入以 http:// 或 https:// 开头的服务地址。'); return }
    if (!defaultModel) { setDraftError('请输入默认模型 ID。'); return }
    setSaving(true)
    setDraftError('')
    setNotice('')
    try {
      const saved = await saveAIProvider(connection, {
        ...draft,
        name,
        baseUrl,
        defaultModel,
        apiKey: draft.apiKey?.trim() || undefined,
      })
      setProviders((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current])
      setDraft(draftFromProvider(saved))
      setShowKey(false)
      setNotice('模型服务已保存。API Key 仅在服务端加密保存，不会写入浏览器历史。')
      window.dispatchEvent(new CustomEvent('ai-providers-changed'))
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : '保存模型服务失败。')
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    if (!draft?.id || saving || testing) return
    setTesting(true)
    setDraftError('')
    setNotice('')
    try {
      const result = await testAIProvider(connection, draft.id)
      setNotice(result.ok
        ? `默认模型连接成功${result.latencyMs === undefined ? '' : ` · ${result.latencyMs} ms`}`
        : '服务返回了不可用状态，请检查配置。')
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : '连接测试失败。')
    } finally {
      setTesting(false)
    }
  }

  async function remove(provider: AIProvider) {
    if (deleting || !window.confirm(`删除模型服务“${provider.name}”？已有对话会保留，但之后不能继续使用该服务。`)) return
    setDeleting(provider.id)
    setError('')
    try {
      await deleteAIProvider(connection, provider.id, provider.version)
      setProviders((current) => current.filter((item) => item.id !== provider.id))
      if (draft?.id === provider.id) closeEditor()
      setNotice('模型服务已删除。')
      window.dispatchEvent(new CustomEvent('ai-providers-changed'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除模型服务失败。')
    } finally {
      setDeleting('')
    }
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await loadProviders()
      window.dispatchEvent(new CustomEvent('ai-providers-changed'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '刷新模型服务失败。') } finally { setRefreshing(false) }
  }

  return <section className="ai-provider-settings" aria-label="AI 模型服务">
    <div className="settings-section-heading ai-provider-settings-heading">
      <div><h3>AI 模型服务</h3><small>接入你自己的 OpenAI 兼容接口或本地 Ollama，服务密钥由 FNS 负责保存。</small></div>
      <div className="ai-provider-heading-actions"><button type="button" className="icon-button compact" onClick={() => void refresh()} disabled={refreshing || loading} title="刷新模型服务" aria-label="刷新模型服务"><RefreshCw size={14} className={refreshing ? 'spin' : undefined} /></button><button type="button" className="secondary-button" onClick={beginCreate} disabled={Boolean(draft)}><Plus size={14} />添加服务</button></div>
    </div>

    {error ? <p className="dialog-error" role="alert"><CircleAlert size={14} />{error}</p> : null}
    {notice ? <p className="ai-provider-notice" role="status"><Check size={14} />{notice}</p> : null}

    {loading ? <div className="ai-provider-empty"><LoaderCircle size={20} className="spin" /><span>正在加载模型服务…</span></div> : providers.length ? <div className="ai-provider-list">
      {providers.map((provider) => <article className={`ai-provider-card ${provider.enabled ? '' : 'is-disabled'}`} key={provider.id}>
        <div className="ai-provider-card-icon"><Server size={17} /></div>
        <div className="ai-provider-card-main"><div className="ai-provider-card-title"><strong>{provider.name}</strong><span className="ai-provider-type">{provider.type === 'ollama' ? 'Ollama' : 'OpenAI 兼容'}</span>{provider.enabled ? <span className="ai-provider-status is-enabled">已启用</span> : <span className="ai-provider-status">已停用</span>}</div><small>{provider.baseUrl}</small><span className="ai-provider-card-meta">默认模型：{provider.defaultModel || '未设置'} · {provider.credentialConfigured ? 'API Key 已配置' : '未配置 API Key'}</span></div>
        <div className="ai-provider-card-actions"><button type="button" className="icon-button compact" onClick={() => beginEdit(provider)} aria-label={`编辑 ${provider.name}`} title="编辑"><Pencil size={14} /></button><button type="button" className="icon-button compact is-danger" onClick={() => void remove(provider)} disabled={deleting === provider.id} aria-label={`删除 ${provider.name}`} title="删除">{deleting === provider.id ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}</button></div>
      </article>)}
    </div> : <div className="ai-provider-empty"><Server size={23} /><strong>还没有模型服务</strong><span>添加一个模型 API 后，可在 AI 对话输入框旁选择模型。</span><button type="button" className="secondary-button" onClick={beginCreate}><Plus size={14} />添加第一个服务</button></div>}

    {draft ? <div className="ai-provider-editor" role="dialog" aria-label={draft.id ? '编辑 AI 模型服务' : '添加 AI 模型服务'}>
      <div className="ai-provider-editor-header"><div><span className="ai-dialog-eyebrow">MODEL API</span><h4>{draft.id ? '编辑模型服务' : '添加模型服务'}</h4></div><button type="button" className="icon-button compact" onClick={closeEditor} disabled={saving || testing} aria-label="关闭编辑"><X size={15} /></button></div>
      <div className="ai-provider-editor-grid">
        <label className="settings-field"><span>服务名称</span><input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} maxLength={80} placeholder="例如：我的 GPT" autoFocus /></label>
        <label className="settings-field"><span>协议</span><select value={draft.type} onChange={(event) => updateDraft({ type: event.target.value })}><option value="openai-compatible">OpenAI 兼容</option><option value="ollama">Ollama</option></select></label>
        <label className="settings-field ai-provider-editor-wide"><span>API 地址</span><input value={draft.baseUrl} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder={draft.type === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'https://api.example.com/v1'} inputMode="url" /></label>
        <label className="settings-field"><span>默认模型 ID</span><input value={draft.defaultModel} onChange={(event) => updateDraft({ defaultModel: event.target.value })} placeholder="例如：gpt-4o-mini" /></label>
        <label className="settings-field"><span>API Key {draft.id && '(留空保留现有密钥)'}</span><span className="ai-provider-secret-input"><input value={draft.apiKey || ''} onChange={(event) => updateDraft({ apiKey: event.target.value })} type={showKey ? 'text' : 'password'} autoComplete="new-password" placeholder={draft.id && providers.find((item) => item.id === draft.id)?.credentialConfigured ? '已配置，输入新值可替换' : '输入 API Key'} /><button type="button" className="icon-button compact" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></span></label>
        <label className="ai-provider-enabled"><input type="checkbox" checked={draft.enabled !== false} onChange={(event) => updateDraft({ enabled: event.target.checked })} />启用此模型服务</label>
      </div>
      <div className="ai-provider-tested-models" aria-label="服务模型目录">
        <span>可用模型{discoveryIsCurrent && discoveryComplete && !discoveryNeedsSave ? `（${discoveredModels.length}）` : ''}</span>
        {!draft.id ? <p>保存服务后可自动发现模型。</p> : discoveryNeedsSave ? <p>服务连接配置已修改，请先保存，再发现模型。</p> : <>
          <button type="button" className="secondary-button" onClick={() => void discoverModels(draft.id!)} disabled={discovering || saving || testing}>{discovering ? <><LoaderCircle size={14} className="spin" />正在发现模型…</> : <><RefreshCw size={14} />{discoveryComplete ? '刷新模型' : '发现模型'}</>}</button>
          {discoveryIsCurrent && discoveryError ? <p className="dialog-error" role="alert"><CircleAlert size={14} />{discoveryError}</p> : null}
          {discoveryIsCurrent && discoveryComplete ? discoveredModels.length ? <><p>点击模型填入默认模型，保存服务后生效。</p><div>{discoveredModels.map((model) => <button key={`${model.provider}:${model.id}`} type="button" title={model.id} disabled={saving || testing} onClick={() => updateDraft({ defaultModel: model.id })} aria-pressed={draft.defaultModel === model.id}>{model.id}</button>)}</div></> : <p role="status">服务未返回可用模型，可以刷新重试或手动填写默认模型 ID。</p> : null}
        </>}
      </div>
      {draftError ? <p className="dialog-error" role="alert"><CircleAlert size={14} />{draftError}</p> : null}
      <div className="ai-provider-editor-actions"><button type="button" className="secondary-button" onClick={closeEditor} disabled={saving || testing}>取消</button>{draft.id ? <button type="button" className="secondary-button" onClick={() => void test()} disabled={saving || testing} title="使用已保存的默认模型测试，未保存的修改不会发送。">{testing ? <><LoaderCircle size={14} className="spin" />测试中</> : '测试已保存模型'}</button> : null}<button type="button" className="primary-button" onClick={() => void save()} disabled={saving || testing}>{saving ? <><LoaderCircle size={14} className="spin" />保存中</> : <><Check size={14} />保存服务</>}</button></div>
    </div> : null}
    <p className="ai-provider-security-note">API Key 只用于服务端调用，不会写入浏览器 localStorage、对话历史或模型选择记录。</p>
  </section>
}
