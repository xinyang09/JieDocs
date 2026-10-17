const createdDatePattern = /(?:^|\s)➕\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/gu
const completedDatePattern = /(?:^|\s)✅\uFE0F?\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/gu
const taskPriorityPattern = /(?:^|\s)(🔺|⏫|🔼|🔽|⏬|🔻)\s*$/u
const taskTimePattern = /(?:^|\s)⏰\uFE0F?\s*([01]?\d|2[0-3]):([0-5]\d)(?:\s*(?:-|–|—|~|至|到)\s*([01]?\d|2[0-3]):([0-5]\d))?(?=\s|$)/u

export type TaskSchedule = {
  dueDate?: string
  startTime?: string
  endTime?: string
}

export type TaskDates = {
  text: string
  createdDate?: string
  completedDate?: string
  dueDate?: string
  startTime?: string
  endTime?: string
}

function isValidDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatTaskTime(hour: string, minute: string) {
  return `${hour.padStart(2, '0')}:${minute}`
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function readTaskTime(text: string) {
  const match = taskTimePattern.exec(text)
  if (!match) return { startTime: undefined, endTime: undefined }
  const startTime = formatTaskTime(match[1], match[2])
  const endTime = match[3] ? formatTaskTime(match[3], match[4]) : undefined
  if (endTime && endTime <= startTime) return { startTime, endTime: undefined }
  return { startTime, endTime }
}

/** Task dates and times live in Markdown so they survive reloads, moves, and sync. */
export function readTaskDates(text: string, path = ''): TaskDates {
  let createdDate: string | undefined
  let completedDate: string | undefined
  let taskText = text.replace(createdDatePattern, (marker, date: string) => {
    if (!isValidDate(date)) return marker
    createdDate ??= date
    return ''
  })
  taskText = taskText.replace(completedDatePattern, (marker, date: string) => {
    if (!isValidDate(date)) return marker
    completedDate ??= date
    return ''
  }).trim()

  const schedule = readTaskTime(taskText)
  if (schedule.startTime) taskText = taskText.replace(taskTimePattern, '').replace(/\s{2,}/g, ' ').trim()

  // Creation/completion metadata and an explicit time must not turn an
  // otherwise unscheduled task into a due task.
  const match = `${taskText} ${path}`.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/)
  const dueDate = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : undefined
  const result: TaskDates = {
    text: taskText,
    createdDate,
    completedDate,
    dueDate: dueDate && isValidDate(dueDate) ? dueDate : undefined,
  }
  if (schedule.startTime) {
    result.startTime = schedule.startTime
    if (schedule.endTime) result.endTime = schedule.endTime
  }
  return result
}

export function withTaskCreationDate(text: string, now = new Date()) {
  if (readTaskDates(text).createdDate) return text
  const date = formatDate(now)
  // Keep the existing trailing priority marker in place for priority switching.
  const priorityMatch = taskPriorityPattern.exec(text)
  if (priorityMatch) return `${text.slice(0, priorityMatch.index).trimEnd()} ➕ ${date} ${priorityMatch[1]}`.trim()
  return `${text} ➕ ${date}`
}

/** Add explicit date/time metadata before a trailing priority marker. */
export function withTaskSchedule(text: string, schedule: TaskSchedule = {}) {
  const current = readTaskDates(text)
  const dueDate = schedule.dueDate && isValidDate(schedule.dueDate) ? schedule.dueDate : undefined
  const startTime = schedule.startTime && isValidTime(schedule.startTime) ? schedule.startTime : undefined
  const endTime = schedule.endTime && isValidTime(schedule.endTime) && startTime && schedule.endTime > startTime ? schedule.endTime : undefined
  if ((!dueDate || dueDate === current.dueDate) && (!startTime || startTime === current.startTime)) return text
  const markers = [dueDate && dueDate !== current.dueDate ? `📅 ${dueDate}` : '', startTime && startTime !== current.startTime ? `⏰ ${startTime}${endTime ? `-${endTime}` : ''}` : ''].filter(Boolean).join(' ')
  if (!markers) return text
  const priorityMatch = taskPriorityPattern.exec(text)
  if (priorityMatch) return `${text.slice(0, priorityMatch.index).trimEnd()} ${markers} ${priorityMatch[1]}`.trim()
  return `${text.trimEnd()} ${markers}`.trim()
}

export function withTaskCompletionDate(text: string, now = new Date()) {
  const date = formatDate(now)
  const priorityMatch = taskPriorityPattern.exec(text)
  const priority = priorityMatch ? priorityMatch[1] : null
  const withoutPriority = priorityMatch ? text.slice(0, priorityMatch.index).trimEnd() : text.trimEnd()
  const cleaned = withoutPriority.replace(completedDatePattern, '').trimEnd()
  if (priority) return `${cleaned} ✅ ${date} ${priority}`.trim()
  return `${cleaned} ✅ ${date}`.trim()
}

export function withoutTaskCompletionDate(text: string) {
  const priorityMatch = taskPriorityPattern.exec(text)
  const priority = priorityMatch ? priorityMatch[1] : null
  const withoutPriority = priorityMatch ? text.slice(0, priorityMatch.index).trimEnd() : text.trimEnd()
  const cleaned = withoutPriority.replace(completedDatePattern, '').trimEnd()
  if (priority) return `${cleaned} ${priority}`.trim()
  return cleaned.trim()
}

export function toggleMarkdownTaskLine(line: string, completed: boolean, now = new Date()) {
  const match = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*?)$/)
  if (!match) return line
  const prefix = match[1]
  const suffix = match[3] || ' '
  const body = match[4]
  const nextPrefix = completed ? `${prefix}x${suffix}` : `${prefix} ${suffix}`
  const nextBody = completed ? withTaskCompletionDate(body, now) : withoutTaskCompletionDate(body)
  return `${nextPrefix}${nextBody}`
}
