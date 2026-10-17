import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, CircleAlert, Copy, Eye, EyeOff, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import type { Connection } from './types'
import { formatCode, remainingSeconds, twoFARequest, type TwoFAAccount, type TwoFAInput, type TwoFASnapshot } from './twofa-api'
import './twofa.css'

const emptyInput: TwoFAInput = { name: '', account: '', secret: '', algorithm: 'SHA1', digits: 6, period: 30 }

function AccountDialog({ entry, busy, error, onClose, onSave }: {
  entry: TwoFAAccount | null; busy: boolean; error: string; onClose: () => void; onSave: (input: TwoFAInput) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<TwoFAInput>(() => entry ? { name: entry.name, account: entry.account, secret: '', algorithm: entry.algorithm, digits: entry.digits, period: entry.period } : { ...emptyInput })
  const [showSecret, setShowSecret] = useState(false)
  const isLink = input.secret.trim().startsWith('otpauth://')
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { previousFocus?.focus() }
  }, [])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!busy) onSave({ ...input, secret: input.secret.trim() })
  }
  return <dialog ref={dialog} className="twofa-dialog" aria-labelledby="twofa-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={submit}>
      <header><div><h2 id="twofa-dialog-title">{entry ? '编辑 2FA 账户' : '添加 2FA 账户'}</h2><p>保存网站提供的设置密钥，随时查看动态验证码。</p></div><button type="button" className="twofa-icon" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <fieldset disabled={busy}>
        <label>名称{isLink ? '（留空时从链接读取）' : ''}<input autoFocus value={input.name} required={!isLink} maxLength={200} placeholder="例如 GitHub、Google" onChange={(event) => setInput({ ...input, name: event.target.value })} /></label>
        <label>账号（选填）<input value={input.account} maxLength={320} placeholder="邮箱或用户名，方便区分多个账户" autoComplete="off" onChange={(event) => setInput({ ...input, account: event.target.value })} /></label>
        <label>密钥或 otpauth 链接
          <span className="twofa-secret-input"><input type={showSecret ? 'text' : 'password'} value={input.secret} required={!entry} maxLength={4096} placeholder={entry ? '留空保留原密钥' : '粘贴 Base32 密钥或 otpauth://totp/…'} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="twofa-secret-help" onChange={(event) => setInput({ ...input, secret: event.target.value })} /><button type="button" className="twofa-icon" aria-label={showSecret ? '隐藏输入密钥' : '显示输入密钥'} aria-pressed={showSecret} onClick={() => setShowSecret(!showSecret)}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
          <small id="twofa-secret-help">{entry ? '已保存的密钥不会回显。填写新密钥将替换原密钥。' : '请填写设置密钥，而不是 6 位验证码或恢复代码。不支持 HOTP。'}</small>
        </label>
        {isLink ? <p className="twofa-link-hint">算法、位数和刷新周期以链接参数为准。</p> : <details className="twofa-advanced"><summary>高级设置 <span>默认 SHA1 · 6 位 · 30 秒</span></summary><div>
          <label>算法<select value={input.algorithm} onChange={(event) => setInput({ ...input, algorithm: event.target.value })}><option>SHA1</option><option>SHA256</option><option>SHA512</option></select></label>
          <label>验证码位数<select value={input.digits} onChange={(event) => setInput({ ...input, digits: Number(event.target.value) })}><option value={6}>6 位</option><option value={8}>8 位</option></select></label>
          <label>周期（秒）<input type="number" min={1} max={300} required value={input.period} onChange={(event) => setInput({ ...input, period: Number(event.target.value) })} /></label>
        </div></details>}
        <p className="twofa-security-note"><ShieldCheck size={14} />密钥在服务端加密保存，仅当前登录账号可访问。</p>
      </fieldset>
      {error ? <p className="twofa-error" role="alert"><CircleAlert size={16} />{error}</p> : null}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="twofa-primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="twofa-spin" /> : <Check size={15} />}{busy ? '正在保存…' : entry ? '保存修改' : '添加账户'}</button></footer>
    </form>
  </dialog>
}

function DeleteDialog({ entry, busy, error, onClose, onDelete }: { entry: TwoFAAccount; busy: boolean; error: string; onClose: () => void; onDelete: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { previousFocus?.focus() }
  }, [])
  return <dialog ref={dialog} className="twofa-dialog" aria-labelledby="twofa-delete-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2 id="twofa-delete-title">删除「{entry.name}」？</h2></header>
    <p className="twofa-delete-warning">删除后将无法在这里生成该账户的验证码，且无法撤销。请先确认已在其他验证器中保存密钥，或持有网站的恢复代码。</p>
    {error ? <p className="twofa-error" role="alert">{error}</p> : null}
    <footer><button autoFocus disabled={busy} onClick={onClose}>取消</button><button className="twofa-danger" disabled={busy} onClick={onDelete}>{busy ? '正在删除…' : '确认删除'}</button></footer>
  </dialog>
}

export default function TwoFAPage({ connection, onClose }: { connection: Connection; onClose?: () => void }) {
  const [accounts, setAccounts] = useState<TwoFAAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(0)
  const [editor, setEditor] = useState<{ entry: TwoFAAccount | null } | null>(null)
  const [deleting, setDeleting] = useState<TwoFAAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState('')
  const snapshot = useRef<TwoFASnapshot | null>(null)
  const clock = useRef({ serverTime: 0, receivedAt: 0 })
  const listRequest = useRef<AbortController | null>(null)
  const mutationRequest = useRef<AbortController | null>(null)
  const lastAttempt = useRef(0)
  const mounted = useRef(false)
  const clockNow = useCallback(() => clock.current.serverTime + performance.now() - clock.current.receivedAt, [])
  const refresh = useCallback(async () => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    lastAttempt.current = performance.now()
    setLoading(true)
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    try {
      const started = performance.now()
      const data = await twoFARequest<TwoFASnapshot>(connection, 'GET', '', undefined, controller.signal)
      if (!mounted.current || listRequest.current !== controller) return
      clock.current = { serverTime: data.serverTime + (performance.now() - started) / 2, receivedAt: performance.now() }
      snapshot.current = data
      setAccounts(data.accounts)
      setNow(clockNow())
      setError('')
    } catch (failure) {
      if (mounted.current && listRequest.current === controller) {
        snapshot.current = null
        setAccounts([])
        setError(controller.signal.aborted ? '请求超时，请检查网络后重试。' : failure instanceof Error ? failure.message : '无法加载验证码，请重试。')
      }
    } finally {
      window.clearTimeout(timeout)
      if (listRequest.current === controller) {
        listRequest.current = null
        if (mounted.current) setLoading(false)
      }
    }
  }, [connection.token, connection.baseUrl, connection.clientType, clockNow])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const current = clockNow()
      setNow(current)
      const expired = !snapshot.current || snapshot.current.accounts.some((entry) => entry.expiresAt <= current)
      if (expired && !listRequest.current && performance.now() - lastAttempt.current >= 3000) void refresh()
    }, 250)
    function onVisibility() {
      if (document.hidden) {
        snapshot.current = null
        setAccounts([])
        listRequest.current?.abort()
        listRequest.current = null
      } else void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      listRequest.current?.abort()
      mutationRequest.current?.abort()
    }
  }, [refresh, clockNow])
  useEffect(() => {
    if (!notice && !copied) return
    const timer = window.setTimeout(() => { setNotice(''); setCopied('') }, 3000)
    return () => window.clearTimeout(timer)
  }, [notice, copied])
  async function mutate(method: 'POST' | 'PUT' | 'DELETE', id: string, input?: TwoFAInput) {
    if (mutationRequest.current) return
    const controller = new AbortController()
    mutationRequest.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    setBusy(true)
    setFormError('')
    try {
      await twoFARequest(connection, method, id, input, controller.signal)
      if (!mounted.current) return
      setEditor(null)
      setDeleting(null)
      setNotice(method === 'DELETE' ? '账户已删除' : '账户已保存')
      await refresh()
    } catch (failure) {
      if (mounted.current) setFormError(controller.signal.aborted ? '请求超时，结果可能已保存。请关闭弹窗并刷新列表确认后再操作。' : failure instanceof Error ? failure.message : '操作失败，请重试。')
    } finally {
      window.clearTimeout(timeout)
      mutationRequest.current = null
      if (mounted.current) setBusy(false)
    }
  }
  async function copy(entry: TwoFAAccount) {
    if (entry.expiresAt <= clockNow()) { void refresh(); return }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(entry.code)
      else {
        const textarea = document.createElement('textarea')
        textarea.value = entry.code
        textarea.className = 'visually-hidden'
        document.body.append(textarea)
        try { textarea.select(); if (!document.execCommand('copy')) throw new Error('Clipboard unavailable') } finally { textarea.remove() }
      }
      if (mounted.current) { setCopied(entry.id); setNotice('验证码已复制') }
    } catch { if (mounted.current) setNotice('无法访问剪贴板，请手动选择并复制验证码。') }
  }
  const filtered = accounts.filter((entry) => `${entry.name} ${entry.account}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="twofa-page" aria-labelledby="twofa-page-title">
    <div className="twofa-page-header">
      <div><h1 id="twofa-page-title"><ShieldCheck size={21} />2FA 验证码</h1><p>在一个地方管理账户，安全获取动态验证码。</p></div>
      <div className="twofa-page-actions">
        <button type="button" className="twofa-primary" onClick={() => { setFormError(''); setEditor({ entry: null }) }}><Plus size={16} />添加账户</button>
        {onClose ? <button type="button" className="twofa-close-plugin" onClick={onClose}><X size={16} />关闭插件</button> : null}
      </div>
    </div>
    <div className="twofa-toolbar"><label className="twofa-search"><Search size={16} /><input aria-label="搜索 2FA 账户" placeholder="搜索名称或账号" value={query} onChange={(event) => setQuery(event.target.value)} />{query ? <button className="twofa-icon" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button> : null}</label><span>{query ? `${filtered.length} / ${accounts.length}` : accounts.length} 个账户</span><button className="twofa-icon" onClick={() => void refresh()} disabled={loading} aria-label="刷新验证码" title="刷新验证码"><RefreshCw size={16} className={loading ? 'twofa-spin' : ''} /></button></div>
    <div className="twofa-feedback" role="status">{notice}</div>
    {error ? <div className="twofa-error" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => void refresh()} disabled={loading}>重试</button></div> : null}
    <div className="twofa-account-area" aria-busy={loading}>
      {loading && !accounts.length ? <div className="twofa-empty"><LoaderCircle className="twofa-spin" size={26} /><h2>正在加载验证码…</h2></div> : !error && !filtered.length ? <div className="twofa-empty"><KeyRound size={32} /><h2>{query ? '没有找到匹配账户' : '添加你的第一个 2FA 账户'}</h2><p>{query ? '试试其他名称或账号，或清空搜索。' : '粘贴网站的设置密钥或 otpauth 链接，即可开始生成验证码。'}</p><button onClick={() => { if (query) setQuery(''); else { setFormError(''); setEditor({ entry: null }) } }}>{query ? '清空搜索' : '添加账户'}</button></div> : <div className="twofa-grid">
        {filtered.map((entry) => {
          const remaining = remainingSeconds(entry.expiresAt, now)
          const expired = remaining === 0
          return <article key={entry.id} className={`twofa-account ${remaining <= 5 ? 'is-expiring' : ''}`}>
            <header><div className="twofa-account-avatar" aria-hidden="true">{Array.from(entry.name)[0]?.toUpperCase()}</div><div className="twofa-account-label"><h2 title={entry.name}>{entry.name}</h2><p title={entry.account}>{entry.account || '未填写账号'}</p></div><button className="twofa-icon" aria-label={`编辑 ${entry.name}`} title="编辑账户" onClick={() => { setFormError(''); setEditor({ entry }) }}><Pencil size={15} /></button><button className="twofa-icon" aria-label={`删除 ${entry.name}`} title="删除账户" onClick={() => { setFormError(''); setDeleting(entry) }}><Trash2 size={15} /></button></header>
            <div className="twofa-code-row"><span className="twofa-code" aria-label={expired ? '验证码已过期，正在刷新' : `${entry.name} 验证码 ${entry.code}`}>{expired ? '··· ···' : formatCode(entry.code)}</span><button className="twofa-copy" disabled={expired} onClick={() => void copy(entry)} aria-label={`复制 ${entry.name} 验证码`}>{copied === entry.id ? <Check size={16} /> : <Copy size={16} />}{copied === entry.id ? '已复制' : '复制'}</button></div>
            <footer><span>{entry.algorithm} · {entry.digits} 位</span><div className="twofa-countdown"><span>{expired ? '正在刷新…' : `${remaining} 秒后更新`}</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${Math.min(100, remaining / entry.period * 100)} 100`} /></svg></div></footer>
          </article>
        })}
      </div>}
    </div>
    <p className="twofa-page-note"><ShieldCheck size={14} />密钥加密存储 · 验证码按服务器时间自动更新 · 请保留网站恢复代码</p>
    {editor ? <AccountDialog entry={editor.entry} busy={busy} error={formError} onClose={() => setEditor(null)} onSave={(input) => void mutate(editor.entry ? 'PUT' : 'POST', editor.entry?.id || '', input)} /> : null}
    {deleting ? <DeleteDialog entry={deleting} busy={busy} error={formError} onClose={() => setDeleting(null)} onDelete={() => void mutate('DELETE', deleting.id)} /> : null}
  </section>
}
