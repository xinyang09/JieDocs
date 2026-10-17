import type { AIAction } from './ai-contract.ts'

export type AICommandId = 'summarize' | 'todo' | 'outline' | 'rewrite' | 'cite' | 'create-note'
export type AICommand = { id: AICommandId; label: string; description: string; makeAction: (instruction: string) => AIAction }

export const aiCommands: AICommand[] = [
  { id: 'summarize', label: '总结本页', description: '提炼当前文档的关键内容', makeAction: (instruction) => ({ type: 'summarize', instruction: instruction || '总结当前文档的关键内容。' }) },
  { id: 'todo', label: '提取待办', description: '从当前文档提取可执行任务', makeAction: (instruction) => ({ type: 'answer', instruction: instruction || '提取当前文档中的待办事项，并按优先级列出。' }) },
  { id: 'outline', label: '生成大纲', description: '生成清晰的层级大纲', makeAction: (instruction) => ({ type: 'answer', instruction: instruction || '为当前文档生成层级大纲。' }) },
  { id: 'rewrite', label: '改写选区', description: '保留原意并改善表达', makeAction: (instruction) => ({ type: 'rewrite', target: 'selection', instruction: instruction || '改写选中文本，让表达更清晰。' }) },
  { id: 'cite', label: '插入引用', description: '从指定文档中寻找相关引用', makeAction: (instruction) => ({ type: 'insert', position: 'cursor', instruction: instruction || '寻找相关文档并插入引用。' }) },
  { id: 'create-note', label: '创建文档', description: '根据指令生成一篇新文档', makeAction: (instruction) => ({ type: 'create-note', path: '新文档.md', instruction: instruction || '创建一篇新文档。' }) },
]

export function filterAICommands(query: string) {
  const needle = query.trim().replace(/^\//, '').toLocaleLowerCase()
  if (!needle) return aiCommands
  return aiCommands.filter((command) => `${command.id} ${command.label} ${command.description}`.toLocaleLowerCase().includes(needle))
}

export function parseSlashCommand(input: string): { command: AICommand; instruction: string } | null {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (!match) return null
  const command = aiCommands.find((item) => item.id === match[1])
  return command ? { command, instruction: match[2]?.trim() || '' } : null
}

export function moveAICommand(index: number, direction: 'up' | 'down', count: number) {
  if (!count) return 0
  return Math.max(0, Math.min(count - 1, index + (direction === 'up' ? -1 : 1)))
}
