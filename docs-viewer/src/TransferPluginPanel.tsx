import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import {
  createTransferProfile,
  deleteTransferProfile,
  FnsApiError,
  getTransferAdminProfiles,
  getTransferJobs,
  getTransferPluginInfo,
  getTransferProfiles,
  submitTransferJob,
  updateTransferProfile,
  type TransferJob,
  type TransferPluginInfo,
  type TransferProfile,
  type TransferProvider,
} from './api'
import type { Connection, Note, Vault } from './types'

type TransferPluginPanelProps = {
  connection: Connection
  vaults: Vault[]
  initialVault: string
  selectedNote: Note | null
  onClose: () => void
}

type TransferPanelTab = 'publish' | 'profiles' | 'jobs'

type CredentialField = {
  key: string
  label: string
  placeholder: string
  help: string
  required?: boolean
  secret?: boolean
}

type ProfileDraft = {
  id: string
  uid: string
  vault: string
  provider: TransferProvider
  allowLive: boolean
  credentials: Record<string, string>
  credentialStatus: Record<string, boolean>
}

const providerLabels: Record<TransferProvider, string> = {
  feishu: '飞书',
  notion: 'Notion',
}

const providerCredentialFields: Record<TransferProvider, CredentialField[]> = {
  feishu: [
    { key: 'TRANSFER_FEISHU_APP_ID', label: 'App ID', placeholder: '例如：cli_xxx', help: '飞书开放平台创建应用后获得的应用标识。', required: true },
    { key: 'TRANSFER_FEISHU_APP_SECRET', label: 'App Secret', placeholder: '填写飞书应用密钥', help: '对应飞书应用的密钥，保存后不会再次显示。', required: true, secret: true },
    { key: 'TRANSFER_FEISHU_USER_ACCESS_TOKEN', label: 'User Access Token', placeholder: '可选，填写用户访问令牌', help: '可选；需要以当前用户身份访问时填写。', secret: true },
    { key: 'TRANSFER_FEISHU_FOLDER_TOKEN', label: 'Folder Token', placeholder: '可选，填写目标文件夹 Token', help: '可选；指定飞书云文档的目标文件夹。', secret: true },
  ],
  notion: [
    { key: 'TRANSFER_NOTION_API_KEY', label: 'API Key', placeholder: '填写 Notion integration secret', help: 'Notion integration 创建后生成的 Internal Integration Secret。', required: true, secret: true },
    { key: 'TRANSFER_NOTION_PARENT_ID', label: 'Parent Page ID', placeholder: '填写目标父页面 ID', help: '允许该 integration 创建子页面的目标父页面 ID。', required: true },
  ],
}

function emptyProfileDraft(uid = ''): ProfileDraft {
  return {
    id: '',
    uid,
    vault: '',
    provider: 'feishu',
    allowLive: false,
    credentials: {},
    credentialStatus: {},
  }
}

function profileToDraft(profile: TransferProfile): ProfileDraft {
  return {
    id: profile.id,
    uid: profile.uid ? String(profile.uid) : '',
    vault: profile.vault,
    provider: profile.provider,
    allowLive: profile.allowLive,
    credentials: {},
    credentialStatus: { ...(profile.credentialStatus || {}) },
  }
}

function formatTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof FnsApiError || reason instanceof Error ? reason.message : fallback
}

function jobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '排队中',
    running: '执行中',
    'dry-run': 'Dry-run 完成',
    created: '已创建',
    unchanged: '未变化',
    failed: '失败',
    interrupted: '已中断',
    uncertain: '待确认',
  }
  return labels[status] || status
}

export default function TransferPluginPanel({
  connection,
  vaults,
  initialVault,
  selectedNote,
  onClose,
}: TransferPluginPanelProps) {
  const [activeTab, setActiveTab] = useState<TransferPanelTab>('publish')
  const [info, setInfo] = useState<TransferPluginInfo | null>(null)
  const [profiles, setProfiles] = useState<TransferProfile[]>([])
  const [managedProfiles, setManagedProfiles] = useState<TransferProfile[]>([])
  const [jobs, setJobs] = useState<TransferJob[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [targetVault, setTargetVault] = useState(initialVault)
  const [targetPath, setTargetPath] = useState(selectedNote?.path || '')
  const [live, setLive] = useState(false)
  const [force, setForce] = useState(false)
  const [draft, setDraft] = useState<ProfileDraft>(() => emptyProfileDraft(connection.user?.uid ? String(connection.user.uid) : ''))
  const [visibleCredentialKeys, setVisibleCredentialKeys] = useState<Record<string, boolean>>({})
  const [editingProfileId, setEditingProfileId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId)
  const liveAllowed = Boolean(selectedProfile?.allowLive && info?.livePublishing)
  const canPublish = Boolean(info?.enabled && selectedProfile && targetVault.trim() && targetPath.trim() && (!live || liveAllowed))
  const credentialFields = providerCredentialFields[draft.provider]
  const configuredCredentialCount = credentialFields.filter((field) => Boolean(draft.credentials[field.key]?.trim()) || Boolean(draft.credentialStatus[field.key])).length
  const liveCredentialsReady = credentialFields.filter((field) => field.required).every((field) => Boolean(draft.credentials[field.key]?.trim()) || Boolean(draft.credentialStatus[field.key]))
  const knownVaults = useMemo(() => vaults.map((vault) => vault.vault).filter(Boolean), [vaults])

  useEffect(() => {
    if (!targetVault && initialVault) setTargetVault(initialVault)
  }, [initialVault, targetVault])

  useEffect(() => {
    if (selectedNote?.path && !targetPath) setTargetPath(selectedNote.path)
  }, [selectedNote?.path, targetPath])

  useEffect(() => {
    if (!info?.livePublishing || !selectedProfile?.allowLive) setLive(false)
  }, [info?.livePublishing, selectedProfile?.allowLive])

  async function refreshData(showSpinner = true) {
    if (showSpinner) setIsRefreshing(true)
    setError('')
    try {
      const pluginInfo = await getTransferPluginInfo(connection)
      setInfo(pluginInfo)
      const results = await Promise.allSettled([
        pluginInfo.enabled ? getTransferProfiles(connection) : Promise.resolve([]),
        pluginInfo.enabled ? getTransferJobs(connection) : Promise.resolve([]),
        getTransferAdminProfiles(connection),
      ])
      const [profileResult, jobsResult, managedResult] = results
      if (profileResult.status === 'fulfilled') {
        const nextProfiles = profileResult.value
        setProfiles(nextProfiles)
        if (!nextProfiles.some((profile) => profile.id === selectedProfileId)) {
          setSelectedProfileId(nextProfiles[0]?.id || '')
          if (!targetVault && nextProfiles[0]) setTargetVault(nextProfiles[0].vault)
        }
      }
      if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value)
      if (managedResult.status === 'fulfilled') setManagedProfiles(managedResult.value)

      const firstFailure = [profileResult, jobsResult].find((result) => result.status === 'rejected')
      if (firstFailure?.status === 'rejected') setError(errorMessage(firstFailure.reason, '无法加载 Transfer 插件状态。'))
    } catch (reason) {
      setInfo(null)
      setError(errorMessage(reason, '无法加载 Transfer 插件状态。'))
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void refreshData(false)
  }, [connection.baseUrl, connection.token])

  function selectProfile(profileId: string) {
    setSelectedProfileId(profileId)
    const profile = profiles.find((item) => item.id === profileId)
    if (profile) {
      setTargetVault(profile.vault)
      if (!targetPath && selectedNote?.path) setTargetPath(selectedNote.path)
    } else {
      setLive(false)
    }
  }

  async function publish() {
    if (!selectedProfile || !targetVault.trim() || !targetPath.trim()) return
    setIsPublishing(true)
    setError('')
    setNotice('')
    try {
      const job = await submitTransferJob(connection, {
        profile: selectedProfile.id,
        vault: targetVault.trim(),
        path: targetPath.trim(),
        live,
        force,
      })
      setNotice(`任务 ${job.id} 已提交，默认以 ${live ? 'live' : 'dry-run'} 模式执行。`)
      setActiveTab('jobs')
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)])
    } catch (reason) {
      setError(errorMessage(reason, '提交 Transfer 任务失败。'))
    } finally {
      setIsPublishing(false)
    }
  }

  function startCreateProfile(clearMessages = true) {
    setEditingProfileId('')
    setDraft(emptyProfileDraft(connection.user?.uid ? String(connection.user.uid) : ''))
    setVisibleCredentialKeys({})
    if (clearMessages) {
      setError('')
      setNotice('')
    }
  }

  function startEditProfile(profile: TransferProfile) {
    setEditingProfileId(profile.id)
    setDraft(profileToDraft(profile))
    setVisibleCredentialKeys({})
    setError('')
    setNotice('')
  }

  function changeProvider(provider: TransferProvider) {
    setDraft((current) => ({ ...current, provider, credentials: {}, credentialStatus: {} }))
    setVisibleCredentialKeys({})
  }

  function credentialIsConfigured(field: CredentialField) {
    return Boolean(draft.credentials[field.key]?.trim()) || Boolean(draft.credentialStatus[field.key])
  }

  async function saveProfile() {
    const uid = Number.parseInt(draft.uid.trim(), 10)
    const id = draft.id.trim()
    const vault = draft.vault.trim()
    if (!id || !Number.isFinite(uid) || uid <= 0 || !vault) {
      setError('请填写有效的 Profile ID、UID 和 Vault。')
      return
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      setError('Profile ID 仅支持字母、数字、下划线和连字符，长度不超过 64 个字符。')
      return
    }
    const missingRequiredCredentials = credentialFields.filter((field) => field.required && !credentialIsConfigured(field))
    if (draft.allowLive && missingRequiredCredentials.length) {
      setError(`开启 Live 发布还需要填写：${missingRequiredCredentials.map((field) => field.label).join('、')}。`)
      return
    }
    const credentials = Object.fromEntries(
      Object.entries(draft.credentials)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value),
    )
    setIsSaving(true)
    setError('')
    setNotice('')
    try {
      const payload: TransferProfile = {
        id,
        uid,
        vault,
        provider: draft.provider,
        allowLive: draft.allowLive,
        credentials,
      }
      if (editingProfileId) {
        await updateTransferProfile(connection, editingProfileId, payload)
        setNotice(`Profile「${id}」已更新。`)
      } else {
        await createTransferProfile(connection, payload)
        setNotice(`Profile「${id}」已创建。`)
      }
      startCreateProfile(false)
      await refreshData(false)
    } catch (reason) {
      setError(errorMessage(reason, '保存 Profile 失败。'))
    } finally {
      setIsSaving(false)
    }
  }

  async function removeProfile(profile: TransferProfile) {
    if (!window.confirm(`确定删除 Profile「${profile.id}」吗？`)) return
    setIsSaving(true)
    setError('')
    setNotice('')
    try {
      await deleteTransferProfile(connection, profile.id)
      if (editingProfileId === profile.id) startCreateProfile()
      setNotice(`Profile「${profile.id}」已删除。`)
      await refreshData(false)
    } catch (reason) {
      setError(errorMessage(reason, '删除 Profile 失败。'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="platform-plugin-view transfer-plugin-view" aria-label="外部文档发布插件">
      <header className="platform-plugin-header">
        <div className="platform-plugin-heading">
          <button type="button" className="icon-button compact" onClick={onClose} aria-label="返回工作区" title="返回工作区">
            <X size={17} />
          </button>
          <span className="platform-plugin-icon"><Cloud size={20} /></span>
          <div>
            <p className="platform-plugin-kicker">平台增强插件</p>
            <h1>外部文档发布</h1>
            <span>通过 Transfer 将 Markdown 笔记创建到飞书或 Notion</span>
          </div>
        </div>
        <button type="button" className="secondary-button compact" onClick={() => void refreshData()} disabled={isRefreshing}>
          <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} /> 刷新
        </button>
      </header>

      {info ? (
        <div className={`transfer-runtime-banner ${info.enabled ? 'is-ready' : 'is-disabled'}`}>
          <span className="transfer-runtime-dot" aria-hidden="true" />
          <div>
            <strong>{info.enabled ? 'Transfer 运行时已启用' : 'Transfer 运行时未启用'}</strong>
            <span>{info.enabled ? `已加载 ${info.profileCount} 个 Profile · 支持 ${info.providers.map((provider) => providerLabels[provider]).join(' / ')}` : `请先在 ${info.runtimeConfigPath} 开启 transfer.enabled。`}</span>
          </div>
          <span className="transfer-runtime-mode">{info.livePublishing ? '可 Live 发布' : '仅 Dry-run'}</span>
        </div>
      ) : null}

      {error ? <div className="transfer-plugin-alert is-error"><AlertCircle size={15} /><span>{error}</span></div> : null}
      {notice ? <div className="transfer-plugin-alert is-success"><Check size={15} /><span>{notice}</span></div> : null}

      <nav className="transfer-plugin-tabs" aria-label="Transfer 插件配置区">
        {([
          ['publish', '发布笔记', Send],
          ['profiles', 'Profiles 配置', Settings2],
          ['jobs', '任务状态', RefreshCw],
        ] as const).map(([tab, label, Icon]) => (
          <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>
            <Icon size={14} /> {label}
            {tab === 'jobs' && jobs.length ? <span className="transfer-tab-count">{jobs.length}</span> : null}
          </button>
        ))}
      </nav>

      {isLoading ? (
        <div className="transfer-plugin-loading"><LoaderCircle size={18} className="spin" />正在加载插件状态…</div>
      ) : activeTab === 'publish' ? (
        <div className="transfer-plugin-content">
          <div className="transfer-plugin-card transfer-publish-card">
            <div className="transfer-plugin-card-heading">
              <div>
                <p className="transfer-plugin-eyebrow">当前动作</p>
                <h2>发布一篇 Markdown 笔记</h2>
              </div>
              <span className="transfer-dry-run-badge">默认 Dry-run</span>
            </div>
            <div className="transfer-form-grid">
              <label>
                <span>Profile</span>
                <select value={selectedProfileId} onChange={(event) => selectProfile(event.target.value)} disabled={!profiles.length}>
                  <option value="">{profiles.length ? '选择 Profile' : '暂无可用 Profile'}</option>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.id} · {providerLabels[profile.provider]}</option>)}
                </select>
              </label>
              <label>
                <span>Vault</span>
                <select value={targetVault} onChange={(event) => setTargetVault(event.target.value)}>
                  <option value="">选择 Vault</option>
                  {knownVaults.map((vault) => <option key={vault} value={vault}>{vault}</option>)}
                </select>
              </label>
              <label className="is-wide">
                <span>Markdown 路径</span>
                <input value={targetPath} onChange={(event) => setTargetPath(event.target.value)} placeholder="例如：docs/hello.md" />
                {selectedNote?.path ? <small>当前打开文档：{selectedNote.path}</small> : null}
              </label>
            </div>
            <div className="transfer-choice-row">
              <label className="transfer-check-control">
                <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} disabled={!selectedProfile?.allowLive || !info?.livePublishing} />
                <span>允许 Live 发布</span>
              </label>
              <label className="transfer-check-control">
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                <span>Force：冲突时创建新文档</span>
              </label>
              {selectedProfile && !selectedProfile.allowLive ? <small>当前 Profile 未开启 Live 权限</small> : null}
            </div>
            <div className="transfer-publish-actions">
              <p>服务端会读取所选笔记正文；凭证只在配置时提交并由服务端加密保存。</p>
              <button type="button" className="primary-button" onClick={() => void publish()} disabled={!canPublish || isPublishing}>
                {isPublishing ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
                {live ? '提交 Live 发布' : '提交 Dry-run'}
              </button>
            </div>
          </div>
          {!info?.enabled ? <div className="transfer-plugin-empty"><AlertCircle size={21} /><div><strong>插件运行时尚未开启</strong><span>当前仍可在“Profiles 配置”中保存凭证；开启 transfer.enabled 并重启服务后，才可以执行发布。</span></div></div> : null}
          {info?.enabled && !profiles.length ? <div className="transfer-plugin-empty"><Settings2 size={21} /><div><strong>还没有可用 Profile</strong><span>切换到“Profiles 配置”创建一个飞书或 Notion 发布配置。</span></div></div> : null}
        </div>
      ) : activeTab === 'profiles' ? (
        <div className="transfer-plugin-content transfer-profiles-content">
          <div className="transfer-plugin-card transfer-profile-editor-card">
            <div className="transfer-plugin-card-heading">
              <div>
                <p className="transfer-plugin-eyebrow">管理员配置</p>
                <h2>{editingProfileId ? `编辑 Profile「${editingProfileId}」` : '新增 Profile'}</h2>
              </div>
              {editingProfileId ? <button type="button" className="secondary-button compact" onClick={() => startCreateProfile()}>取消编辑</button> : null}
            </div>
            <div className="transfer-config-section">
              <div className="transfer-section-heading">
                <span className="transfer-section-index">01</span>
                <div><strong>基本信息</strong><span>先确定这个 Profile 服务哪个用户、哪个 Vault 和目标平台。</span></div>
              </div>
              <div className="transfer-form-grid">
                <label><span>Profile ID <em className="transfer-required-mark">必填</em></span><input value={draft.id} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} disabled={Boolean(editingProfileId)} placeholder="例如：team-feishu" /><small>仅支持字母、数字、下划线和连字符。</small></label>
                <label><span>UID <em className="transfer-required-mark">必填</em></span><input inputMode="numeric" value={draft.uid} onChange={(event) => setDraft((current) => ({ ...current, uid: event.target.value }))} placeholder="用户 UID" /><small>绑定可以使用此 Profile 的平台用户。</small></label>
                <label><span>Vault <em className="transfer-required-mark">必填</em></span><input value={draft.vault} onChange={(event) => setDraft((current) => ({ ...current, vault: event.target.value }))} placeholder="例如：工作笔记" /><small>发布时默认读取这个 Vault 的 Markdown。</small></label>
                <label><span>Provider <em className="transfer-required-mark">必填</em></span><select value={draft.provider} onChange={(event) => changeProvider(event.target.value as TransferProvider)}><option value="feishu">飞书</option><option value="notion">Notion</option></select><small>一个 Profile 只绑定一个外部文档平台。</small></label>
              </div>
            </div>
            <div className="transfer-config-section transfer-credentials-section">
              <div className="transfer-section-heading">
                <span className="transfer-section-index">02</span>
                <div><strong>{providerLabels[draft.provider]}凭证</strong><span>必填项用于 Live 发布，可选项按你的发布场景填写。</span></div>
                <span className={`transfer-credential-count ${liveCredentialsReady ? 'is-ready' : ''}`}>{configuredCredentialCount}/{credentialFields.length} 已配置</span>
              </div>
              <div className="transfer-credential-notice"><ShieldCheck size={17} /><div><strong>凭证安全存储</strong><span>页面不会回显已保存的真实凭证；编辑时留空，服务端会保留原值。</span></div></div>
              <div className="transfer-env-grid transfer-credential-grid">
                {credentialFields.map((field) => {
                  const configured = credentialIsConfigured(field)
                  const stored = Boolean(draft.credentialStatus[field.key])
                  const visible = Boolean(visibleCredentialKeys[field.key])
                  return <label key={field.key} className={`transfer-credential-field ${configured ? 'is-configured' : ''}`}>
                    <span className="transfer-field-label"><span>{field.label} {field.required ? <em className="transfer-required-mark">必填</em> : <em className="transfer-optional-mark">可选</em>}</span><span className={`transfer-field-status ${configured ? 'is-configured' : 'is-empty'}`}>{stored ? '已配置' : configured ? '待保存' : '未配置'}</span></span>
                    <span className="transfer-secret-input">
                      <input type={field.secret && !visible ? 'password' : 'text'} autoComplete="new-password" value={draft.credentials[field.key] || ''} onChange={(event) => setDraft((current) => ({ ...current, credentials: { ...current.credentials, [field.key]: event.target.value } }))} placeholder={stored ? '已配置，留空保持原值' : field.placeholder} />
                      {field.secret ? <button type="button" className="transfer-credential-visibility" onClick={() => setVisibleCredentialKeys((current) => ({ ...current, [field.key]: !current[field.key] }))} aria-label={visible ? `隐藏${field.label}` : `显示${field.label}`} title={visible ? '隐藏内容' : '显示内容'}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button> : null}
                    </span>
                    <small>{stored ? '留空即可保留当前值；填写新值会覆盖原值。' : field.help}</small>
                  </label>
                })}
              </div>
            </div>
            <div className="transfer-config-section transfer-live-section">
              <div className="transfer-section-heading">
                <span className="transfer-section-index">03</span>
                <div><strong>发布权限</strong><span>默认只允许 Dry-run，确认凭证可用后再开启 Live。</span></div>
              </div>
              <div className="transfer-live-setting">
                <label className="transfer-check-control"><input type="checkbox" checked={draft.allowLive} onChange={(event) => setDraft((current) => ({ ...current, allowLive: event.target.checked }))} /><span><strong>允许此 Profile 执行 Live 发布</strong><small>开启后，发布任务可以真正创建或更新外部文档。</small></span></label>
                <span className={`transfer-live-status ${draft.allowLive ? 'is-live' : ''}`}>{draft.allowLive ? 'Live 已授权' : '仅 Dry-run'}</span>
              </div>
            </div>
            <div className="transfer-form-footer">
              <div className="transfer-security-note"><ShieldCheck size={15} /><span>凭证使用服务端加密保存，只在执行发布时临时注入，不会写入任务记录或日志。</span></div>
              <div className="transfer-form-actions">{editingProfileId ? <button type="button" className="secondary-button compact" onClick={() => startCreateProfile()}>取消编辑</button> : null}<button type="button" className="primary-button" onClick={() => void saveProfile()} disabled={isSaving}>{isSaving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {editingProfileId ? '保存修改' : '创建 Profile'}</button></div>
            </div>
          </div>
          <div className="transfer-plugin-card">
            <div className="transfer-plugin-card-heading"><div><p className="transfer-plugin-eyebrow">已配置</p><h2>Profiles 列表</h2></div><button type="button" className="secondary-button compact" onClick={() => startCreateProfile()}><Plus size={14} /> 新建</button></div>
            {managedProfiles.length ? <div className="transfer-profile-list">{managedProfiles.map((profile) => { const configuredCount = Object.values(profile.credentialStatus || {}).filter(Boolean).length; return <article key={profile.id} className="transfer-profile-row"><div className="transfer-profile-row-main"><div className="transfer-profile-row-title"><strong>{profile.id}</strong><span className="transfer-provider-chip">{providerLabels[profile.provider]}</span><span className={`transfer-profile-state ${profile.allowLive ? 'is-live' : ''}`}>{profile.allowLive ? 'Live' : 'Dry-run'}</span></div><span className="transfer-profile-meta">UID {profile.uid} · Vault {profile.vault}</span><small>{configuredCount} 项凭证已配置{configuredCount === 0 ? '，编辑后补充凭证' : ''}</small></div><div className="transfer-row-actions"><button type="button" className="icon-button compact" onClick={() => startEditProfile(profile)} title="编辑 Profile" aria-label={`编辑 ${profile.id}`}><Pencil size={14} /></button><button type="button" className="icon-button compact is-danger" onClick={() => void removeProfile(profile)} title="删除 Profile" aria-label={`删除 ${profile.id}`}><Trash2 size={14} /></button></div></article> })}</div> : <div className="transfer-plugin-empty"><Settings2 size={21} /><div><strong>暂无 Profile</strong><span>创建后会显示在这里，页面不会展示任何真实凭证。</span></div></div>}
          </div>
        </div>
      ) : (
        <div className="transfer-plugin-content">
          <div className="transfer-plugin-card">
            <div className="transfer-plugin-card-heading"><div><p className="transfer-plugin-eyebrow">执行记录</p><h2>发布任务</h2></div><button type="button" className="secondary-button compact" onClick={() => void refreshData()} disabled={isRefreshing}><RefreshCw size={14} className={isRefreshing ? 'spin' : ''} /> 刷新</button></div>
            {jobs.length ? <div className="transfer-job-list">{jobs.map((job) => <article key={job.id} className="transfer-job-row"><div className="transfer-job-main"><div className="transfer-job-title"><strong>{job.path}</strong><span className={`transfer-job-status is-${job.status}`}>{jobStatusLabel(job.status)}</span></div><span>{job.profile} · {providerLabels[job.provider]} · {job.live ? 'Live' : 'Dry-run'} · {formatTime(job.createdAt)}</span>{job.failureMessage ? <small className="transfer-job-error">{job.failureMessage}</small> : null}{job.externalUrl ? <a href={job.externalUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> 打开外部文档</a> : null}</div><code>{job.id}</code></article>)}</div> : <div className="transfer-plugin-empty"><RefreshCw size={21} /><div><strong>暂无任务</strong><span>提交一次 Dry-run 后，任务状态会显示在这里。</span></div></div>}
          </div>
        </div>
      )}
    </section>
  )
}
