import React, { cloneElement, isValidElement, useEffect, useMemo, useState } from 'react'
import { CodeBlockComponent } from './CodeBlock'
import type { CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fnsApi, fileEndpoint, fnsHeaders } from './api'
import type { Connection, Note } from './types'
import { dateValue, field, metricValue, noteRow, parseXdb, selectRows, summaryRow } from './xdb'
import type { RecordValue, XdbRow } from './xdb'
import './xdb.css'

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const title = (view: RecordValue) => String(view.name || '未命名')
const display = (value: unknown): string => value == null ? '—' : Array.isArray(value) ? value.map(item => typeof item === 'object' ? `${item.status === ' ' ? '☐' : '☑'} ${item.content}` : String(item)).join('\n') : typeof value === 'object' ? JSON.stringify(value) : String(value)

type Context = { connection: Connection; rows: XdbRow[]; open: (row: XdbRow) => void; load: (path: string) => Promise<RecordValue>; ancestry: string[] }

function Notice({ children }: { children: React.ReactNode }) { return <p className="xdb-empty" role="status">{children}</p> }

function TableView({ rows, view, config, open }: { rows: XdbRow[]; view: RecordValue; config: RecordValue; open: Context['open'] }) {
  const [page, setPage] = useState(0)
  const fields: string[] = view.visibleFields || config.fields?.map((item: RecordValue) => item.name) || ['file.basename']
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 30) - 1))
  return <><div className="xdb-table-scroll"><table><thead><tr>{fields.map(name => <th key={name}>{({ 'file.basename': '名称', 'file.ctime': '创建时间', 'file.mtime': '修改时间', 'file.tasks': '任务', content: '内容', status: '状态' } as Record<string, string>)[name] || name}</th>)}</tr></thead><tbody>{rows.slice(current * 30, (current + 1) * 30).map((row, index) => <tr key={`${row.file.path}-${index}`}>{fields.map((name, column) => <td key={name}>{column === 0 ? <button className="xdb-note-link" onClick={() => open(row)}>{display(field(row, name))}</button> : name === 'file.ctime' || name === 'file.mtime' ? dateValue(field(row, name))?.toLocaleString('zh-CN') || '—' : display(field(row, name))}</td>)}</tr>)}</tbody></table></div>{!rows.length && <Notice>没有符合筛选条件的记录</Notice>}<footer className="xdb-toolbar"><small>共 {rows.length} 条</small><button disabled={!current} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {Math.max(1, Math.ceil(rows.length / 30))}</span><button disabled={(current + 1) * 30 >= rows.length} onClick={() => setPage(current + 1)}>下一页</button></footer></>
}

function CalendarView({ rows, view, open }: { rows: XdbRow[]; view: RecordValue; open: Context['open'] }) {
  const [cursor, setCursor] = useState(() => new Date())
  const mode = view.options?.viewType || 'month'
  const startField = view.options?.startField || 'file.basename'
  const dates = rows.map(row => ({ row, date: dateValue(field(row, startField)) }))
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), mode === 'month' ? 1 : cursor.getDate())
  if (mode !== 'day') first.setDate(first.getDate() - (first.getDay() + (view.options?.weekStartsOn === 'monday' ? 6 : 0)) % 7)
  const days = Array.from({ length: mode === 'day' ? 1 : mode === 'week' ? 7 : 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index))
  function move(direction: number) { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + (mode === 'month' ? direction : 0), mode === 'month' ? 1 : cursor.getDate() + direction * (mode === 'week' ? 7 : 1))) }
  return <><div className="xdb-toolbar"><button aria-label="上一时间段" onClick={() => move(-1)}>‹</button><strong>{cursor.toLocaleDateString('zh-CN')}</strong><button aria-label="下一时间段" onClick={() => move(1)}>›</button><button onClick={() => setCursor(new Date())}>今天</button></div><div className={`xdb-calendar ${mode === 'day' ? 'xdb-calendar-day' : ''}`}>{days.map(day => <div className={`xdb-calendar-cell ${dayKey(day) === dayKey(new Date()) ? 'is-today' : ''}`} key={dayKey(day)}><time>{day.getDate()} <small>{day.toLocaleDateString('zh-CN', { weekday: 'short' })}</small></time>{dates.filter(item => item.date && dayKey(item.date) === dayKey(day)).map(({ row }, index) => <button key={`${row.file.path}-${index}`} onClick={() => open(row)}>{row.status !== undefined ? display(row.content) : row.file.basename}</button>)}</div>)}</div>{dates.some(item => !item.date) && <small className="xdb-footnote">{dates.filter(item => !item.date).length} 条记录缺少有效日期，未排入日历。</small>}</>
}


const xdbMarkdownComponents = {
  img: () => null,
  pre: ({ children }: { children?: React.ReactNode }) => {
    const child = Array.isArray(children) ? children[0] : children
    return isValidElement(child) ? cloneElement(child, { isBlock: true } as any) : <pre>{children}</pre>
  },
  code: (props: any) => <CodeBlockComponent {...props} />,
}

function DatePage({ rows, view, open }: { rows: XdbRow[]; view: RecordValue; open: Context['open'] }) {
  const [date, setDate] = useState(dayKey(new Date()))
  const folder = view.options?.folder
  const matches = rows.filter(row => (!folder || row.file.parent === folder) && row.file.basename === date)
  return <><div className="xdb-toolbar"><input aria-label={`${title(view)}日期`} type="date" value={date} onChange={event => setDate(event.target.value)} /><button onClick={() => setDate(dayKey(new Date()))}>今天</button></div>{matches.length ? matches.map(row => <article className="xdb-date-note" key={row.file.path}><button className="xdb-note-link" onClick={() => open(row)}>{row.file.basename}</button><ReactMarkdown remarkPlugins={[remarkGfm]} components={xdbMarkdownComponents}>{row.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')}</ReactMarkdown></article>) : <Notice>该日期暂无笔记{folder ? ` · ${folder}` : ''}（只读模式不会创建文件）</Notice>}</>
}

function Clock({ view }: { view: RecordValue }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])
  return <div className="xdb-clock"><strong>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', ...(view.options?.showSeconds ? { second: '2-digit' } : {}) })}</strong>{view.options?.showDate !== false && <span>{now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>}{view.options?.showProgress && <progress aria-label="今日进度" max={86400} value={now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()} />}</div>
}

function Reference({ view, context }: { view: RecordValue; context: Context }) {
  const raw = String(view.options?.targetLink || '')
  const path = raw.replace(/^\[\[|\]\]$/g, '').split('|')[0]
  const [state, setState] = useState<{ data?: RecordValue; error?: string }>({})
  const invalid = context.ancestry.includes(path) || context.ancestry.length >= 6 || !/\.xdb$/i.test(path)
  useEffect(() => { let active = true; setState({}); if (!invalid) context.load(path).then(data => { if (active) setState({ data }) }).catch(error => { if (active) setState({ error: String(error.message) }) }); return () => { active = false } }, [path, invalid, context.load])
  if (invalid) return <Notice>引用无效或存在循环：{path}</Notice>
  if (state.error) return <Notice>引用加载失败：{state.error}</Notice>
  return state.data ? <ViewGroup config={state.data} context={{ ...context, ancestry: [...context.ancestry, path] }} /> : <Notice>正在加载引用…</Notice>
}

function View({ view, config, context }: { view: RecordValue; config: RecordValue; context: Context }) {
  if (view.type === 'group') return <ViewGroup config={config} parent={view} context={context} />
  if (view.type === 'reference') return <Reference view={view} context={context} />
  if (view.type === 'time-banner') return <Clock view={view} />
  if (view.type === 'button') return <div className="xdb-action"><button disabled title="此按钮依赖 Obsidian 命令或脚本，网页不会执行">{title(view)}</button><small>Obsidian 操作未启用</small></div>
  let rows: XdbRow[], value: string | undefined
  try { rows = selectRows(config, view, context.rows); if (view.type === 'metric') value = metricValue(view.aggregate, rows) } catch (error) { return <Notice>{(error as Error).message}</Notice> }
  if (view.type === 'metric') return <div className="xdb-metric"><strong>{value}</strong><small>{rows.length} 篇匹配笔记 · {rows.flatMap(row => row.file.tasks).length} 个任务</small></div>
  if (view.type === 'table' || view.type === 'list') return <TableView rows={rows} view={view} config={config} open={context.open} />
  if (view.type === 'calendar') return <CalendarView rows={rows} view={view} open={context.open} />
  if (view.type === 'date-page') return <DatePage rows={rows} view={view} open={context.open} />
  if (view.type === 'binding') {
    const path = String(view.file?.path || '').replace(/\{\{date:\s*YYYY-MM-DD\}\}/g, dayKey(new Date()))
    const row = rows.find(item => item.file.path === path)
    return <div className="xdb-binding"><small>{path} · 只读</small>{(view.items || []).map((item: RecordValue) => <label key={item.id}>{String(item.binding?.property || '')}<input readOnly value={row ? display(field(row, item.binding?.property || '')) : '目标笔记不存在'} /></label>)}</div>
  }
  return <Notice>{view.type === 'gantt' ? '甘特图尚未适配；不会以普通列表冒充时间轴。' : `尚未适配此视图：${String(view.type)}`}</Notice>
}

function ViewGroup({ config, parent, context }: { config: RecordValue; parent?: RecordValue; context: Context }) {
  const children: RecordValue[] = config.views.filter((view: RecordValue) => parent ? view.parentId === parent.id : !view.parentId)
  const [selected, setSelected] = useState('')
  const mode = parent?.options?.groupType || config.rootGroup?.type || 'tabs'
  const active = children.find(view => view.id === selected) || children[0]
  if (!active) return <Notice>没有可显示的视图</Notice>
  if (mode === 'tabs') return <div className="xdb-tabs"><nav aria-label={parent ? title(parent) : 'XDB 页面'}>{children.map(view => <button key={view.id} aria-pressed={view.id === active.id} onClick={() => setSelected(view.id)}>{title(view)}</button>)}</nav><div className="xdb-tab-content" key={active.id}><View config={config} view={active} context={context} /></div></div>
  const ordered = [...children].sort((left, right) => (left.layouts?.laptop?.y || 0) - (right.layouts?.laptop?.y || 0) || (left.layouts?.laptop?.x || 0) - (right.layouts?.laptop?.x || 0))
  return <div className="xdb-layout">{ordered.map(view => { const layout = view.layouts?.laptop; const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback; const column = Math.max(0, Math.min(23, number(layout?.x, 0))); const style: CSSProperties = layout ? { gridColumn: `${column + 1} / span ${Math.max(1, Math.min(24 - column, number(layout.w, 6)))}`, gridRow: `${Math.max(0, Math.min(500, number(layout.y, 0))) + 1} / span ${Math.max(2, Math.min(100, number(layout.h, 6)))}` } : { gridColumn: 'span 12' }; return <section className={`xdb-widget xdb-widget-${view.type}`} key={view.id} style={style}><h3>{title(view)}</h3><div className="xdb-widget-body"><View config={config} view={view} context={context} /></div></section> })}</div>
}

export default function XdbPage({ path, connection, vault }: { path: string; connection: Connection; vault: string }) {
  const [state, setState] = useState<{ data?: RecordValue; rows?: XdbRow[]; error?: string; progress?: string }>({})
  const [opened, setOpened] = useState<XdbRow | null>(null)
  const [retry, setRetry] = useState(0)
  const load = useMemo(() => {
    const cache = new Map<string, Promise<RecordValue>>()
    return (target: string) => {
      if (!cache.has(target)) cache.set(target, fetch(fileEndpoint(connection, vault, target), { headers: fnsHeaders(connection) }).then(async response => {
        if (!response.ok) throw new Error(`附件读取失败 (${response.status})`)
        const blob = await response.blob()
        if (blob.size > 5 * 1024 * 1024) throw new Error('XDB 超过 5 MB')
        return parseXdb(await blob.text())
      }))
      return cache.get(target)!
    }
  }, [connection.baseUrl, connection.token, connection.clientType, vault, retry])
  useEffect(() => {
    let cancelled = false
    setState({ progress: '正在加载 XDB 和笔记…' }); setOpened(null)
    void (async () => {
      const [data, summaries] = await Promise.all([load(path), fnsApi.getNotes(connection, vault)])
      if (cancelled) return
      const rows = summaries.map(summaryRow)
      setState({ data, rows, progress: summaries.length ? `已加载 ${summaries.length} 条笔记索引，正在补充任务数据…` : undefined })
      const notes: Note[] = []; let index = 0
      await Promise.all(Array.from({ length: Math.min(8, summaries.length) }, async () => {
        while (!cancelled && index < summaries.length) {
          const summary = summaries[index++]
          notes.push(await fnsApi.getNote(connection, vault, summary.path))
          if (!cancelled) setState({ data, rows: notes.map(noteRow).concat(rows.filter(row => !notes.some(note => note.path === row.file.path))), progress: `正在补充任务数据 ${notes.length} / ${summaries.length}` })
        }
      }))
      if (!cancelled) setState({ data, rows: notes.map(noteRow), progress: undefined })
    })().catch(error => { if (!cancelled) { cancelled = true; setState({ error: String(error.message) }) } })
    return () => { cancelled = true }
  }, [load, path])
  const context: Context = { connection, rows: state.rows || [], open: setOpened, load, ancestry: [path] }
  return <section className="xdb-page" aria-label="XDB 渲染页面"><header className="xdb-page-toolbar"><strong>{path.split('/').pop()}</strong><span>只读 · 基于远程笔记{state.progress ? ` · ${state.progress}` : ''}</span><button onClick={() => setRetry(value => value + 1)}>刷新数据</button></header>{state.error ? <Notice>数据加载失败：{state.error}。未显示不完整的统计。</Notice> : state.data ? <ViewGroup config={state.data} context={context} /> : <Notice>{state.progress}</Notice>}{opened && <section className="xdb-note-reader" aria-label="笔记内容"><header><strong>{opened.file.path}</strong><button onClick={() => setOpened(null)}>关闭笔记</button></header><ReactMarkdown remarkPlugins={[remarkGfm]} components={xdbMarkdownComponents}>{opened.content}</ReactMarkdown></section>}</section>
}
