import { withTaskCreationDate, withTaskSchedule, type TaskSchedule } from './task-dates.ts'

/** Append one checkbox task without rewriting any of the existing Markdown. */
export function appendMarkdownTask(content: string, text: string, createdAt = new Date(), schedule?: TaskSchedule) {
  const taskText = text.replace(/[\r\n]+/g, ' ').trim()
  if (!taskText) throw new Error('请输入任务内容。')

  // Appending inside an unfinished fence would silently create code, not a task.
  let fence: { character: string; length: number } | null = null
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (!match) continue
    if (!fence) fence = { character: match[1][0], length: match[1].length }
    else if (match[1][0] === fence.character && match[1].length >= fence.length && !match[2].trim()) fence = null
  }
  if (fence) throw new Error('目标文档有未闭合的代码块，请先修正文档或选择其他文档。')

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const separator = !content || content.endsWith(newline + newline) ? '' : content.endsWith(newline) ? newline : newline + newline
  const withCreatedDate = withTaskCreationDate(taskText, createdAt)
  return `${content}${separator}- [ ] ${withTaskSchedule(withCreatedDate, schedule)}${newline}`
}

/** Never overwrite an existing document when the user chooses a new task note. */
export function nextTaskDocumentPath(folder: string, paths: string[]) {
  const directory = folder.replace(/^\/+|\/+$/g, '')
  const prefix = directory ? `${directory}/` : ''
  const existing = new Set(paths)
  let index = 0
  while (existing.has(`${prefix}任务${index ? ` ${index}` : ''}.md`)) index += 1
  return `${prefix}任务${index ? ` ${index}` : ''}.md`
}
