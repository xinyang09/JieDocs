import type { Note } from './types'

export type RecordValue = Record<string, any>
export type XdbRow = RecordValue & { file: { path: string; basename: string; parent: string; ctime: number; mtime: number; tasks: RecordValue[] } }
export const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value)
export function parseXdb(text: string): RecordValue {
  const value = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (!record(value) || !Array.isArray(value.views) || !value.views.every(record)) throw new Error('无效的 XDB 视图配置')
  if (value.fields !== undefined && (!Array.isArray(value.fields) || !value.fields.every(record))) throw new Error('无效的 XDB 字段')
  const ids = value.views.map((view: RecordValue) => view.id)
  if (ids.some((id: unknown) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('视图 ID 缺失或重复')
  for (const view of value.views) {
    const visited = new Set([view.id])
    let parent = view.parentId
    while (parent) {
      if (visited.has(parent)) throw new Error('视图分组存在循环')
      visited.add(parent)
      const match = value.views.find((item: RecordValue) => item.id === parent)
      if (!match || match.type !== 'group') throw new Error('视图父分组不存在')
      parent = match.parentId
    }
  }
  return value
}
export function noteRow(note: Note): XdbRow {
  const properties: RecordValue = Object.create(null)
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(note.content)
  for (const line of (frontmatter?.[1] || '').split('\n')) {
    const match = /^([^\s:#][^:]*):\s*(.*?)\s*$/.exec(line)
    if (match) properties[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  let fenced = false
  const tasks: RecordValue[] = []
  for (const line of note.content.replace(frontmatter?.[0] || '', '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const match = !fenced && /^\s*(?:[-*+]|\d+\.)\s+\[(.)\]\s+(.*)$/.exec(line)
    if (match) tasks.push({ status: match[1], content: match[2] })
  }
  return { ...properties, content: note.content, file: { path: note.path, basename: note.path.split('/').pop()!.replace(/\.md$/i, ''), parent: note.path.split('/').slice(0, -1).join('/'), ctime: note.ctime, mtime: note.mtime, tasks } }
}
export function summaryRow(note: { path: string; mtime: number; ctime?: number }): XdbRow {
  const parts = note.path.split('/')
  return { file: { path: note.path, basename: parts.pop()!.replace(/\.md$/i, ''), parent: parts.join('/'), ctime: note.ctime || note.mtime, mtime: note.mtime, tasks: [] } }
}
export function field(row: XdbRow, name: string): any {
  return name.startsWith('file.') ? row.file[name.slice(5) as keyof XdbRow['file']] : row[name]
}
export function dateValue(value: unknown): Date | null {
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value.slice(0, 10) + 'T00:00:00') : null
  return date && Number.isFinite(date.getTime()) ? date : null
}
export function predicate(filter: any, now = new Date()): (row: XdbRow) => boolean {
  if (!filter) return () => true
  if (filter.type === 'group') {
    if (!Array.isArray(filter.items) || !['and', 'or'].includes(filter.join)) throw new Error('不支持的过滤组合')
    const children = filter.items.map((item: unknown) => predicate(item, now))
    return (row) => !children.length || (filter.join === 'or' ? children.some((test: any) => test(row)) : children.every((test: any) => test(row)))
  }
  const expression = String(filter.expression || '').trim()
  const match = /^([\w.\u0080-\uffff]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*("[^"\\]*"|'[^'\\]*'|null|now\(\)(?:\.startOf\("month"\))?)$/.exec(expression)
  if (!match) throw new Error(`暂不支持过滤表达式：${expression}`)
  const [, name, operator, literal] = match
  const isDate = literal.startsWith('now()')
  const expected = isDate ? (literal.includes('startOf') ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : now.getTime()) : literal === 'null' ? null : literal.slice(1, -1)
  return (row) => {
    let actual = field(row, name) ?? null
    if (isDate) { const date = dateValue(actual); if (!date) return false; actual = date.getTime() }
    else if (typeof actual === 'string' && typeof expected === 'number') { const date = dateValue(actual); if (date) actual = date.getTime() }
    if (operator === '==' || operator === '===') return actual === expected
    if (operator === '!=' || operator === '!==') return actual !== expected
    if (actual === null || expected === null) return false
    return operator === '>' ? actual > expected : operator === '<' ? actual < expected : operator === '>=' ? actual >= expected : actual <= expected
  }
}
export function selectRows(config: RecordValue, view: RecordValue, notes: XdbRow[]): XdbRow[] {
  if (config.source && !['file', 'task'].includes(config.source)) throw new Error(`暂不支持数据源：${config.source}`)
  const rows = config.source === 'task' ? notes.flatMap(note => note.file.tasks.map(task => ({ ...note, ...task }))) : notes
  const selected = rows.filter(predicate(config.filter)).filter(predicate(view.filter))
  for (const sort of [...(view.sort || [])].reverse()) selected.sort((left, right) => String(field(left, sort.field) ?? '').localeCompare(String(field(right, sort.field) ?? ''), 'zh-CN', { numeric: true }) * (sort.direction === 'desc' ? -1 : 1))
  return selected
}
export function metricValue(aggregate: any, rows: XdbRow[]): string {
  const expression = String(aggregate?.expression || '').replace(/\s+(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/g, '')
  const tasks = rows.flatMap(row => row.file.tasks)
  const pending = tasks.filter(task => task.status === ' ').length
  const countExpression = 'count($items.flatMap(f=>f.file.tasks).filter(t=>t.status===" "))'
  const doneExpression = 'count($items.flatMap(f=>f.file.tasks).filter(t=>t.status!==" "))'
  const totalExpression = 'count($items.flatMap(f=>f.file.tasks))'
  if ([countExpression, `(${countExpression})`].includes(expression)) return String(pending)
  if (expression === `((${doneExpression}/${totalExpression})*100).toFixed(2)+"%"`) return tasks.length ? ((tasks.length - pending) / tasks.length * 100).toFixed(2) + '%' : '无任务'
  if (expression === `(${doneExpression}/${totalExpression}).toFixed(2)*100+"%"`) return tasks.length ? String(Number(((tasks.length - pending) / tasks.length).toFixed(2)) * 100) + '%' : '无任务'
  if (expression === 'longestConsecutiveDays($items.map(item=>item["created"]))+"天"') {
    const dates = [...new Set(rows.map(row => dateValue(row.created)).filter(Boolean).map(date => Math.floor(Date.UTC(date!.getFullYear(), date!.getMonth(), date!.getDate()) / 86400000)))].sort((left, right) => left - right)
    let longest = 0, run = 0, previous = -Infinity
    for (const date of dates) { run = date === previous + 1 ? run + 1 : 1; longest = Math.max(longest, run); previous = date }
    return `${longest}天`
  }
  if (expression === 'count($items)') return String(rows.length)
  throw new Error('该统计表达式尚未适配；未执行任意脚本')
}
