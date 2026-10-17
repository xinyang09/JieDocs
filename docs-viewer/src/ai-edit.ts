export type DocumentEditResult = { status: 'changed'; content: string; summary: string } | { status: 'unsupported' }

export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:(?:\r?\n)+|$)/.exec(content)
  if (!match) return { frontmatter: '', body: content }
  return {
    frontmatter: match[0],
    body: content.slice(match[0].length),
  }
}

export function cleanMarkdownText(text: string): string {
  const wrapper = /^(\x60{3,})(?:markdown|md)[ \t]*\r?\n([\s\S]*)\r?\n\1[ \t]*$/i.exec(text.trim())
  return wrapper ? wrapper[2] : text
}

export function recombineDocument(frontmatter: string, body: string): string {
  if (!frontmatter) return body
  const separator = frontmatter.endsWith('\n') ? '' : frontmatter.includes('\r\n') ? '\r\n\r\n' : '\n\n'
  return `${frontmatter}${separator}${body}`
}

export function prepareDocumentEdit(original: string, generated: string): { status: 'changed' | 'unchanged' | 'empty'; content: string } {
  const { frontmatter, body } = splitFrontmatter(original)
  const comparable = (content: string) => content.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  if (comparable(generated) === comparable(original) || comparable(generated) === comparable(body)) {
    return { status: 'unchanged', content: original }
  }
  let updatedBody = cleanMarkdownText(generated)
  if (frontmatter) updatedBody = splitFrontmatter(updatedBody).body
  if (!updatedBody.trim()) return { status: 'empty', content: original }
  if (comparable(updatedBody) === comparable(body)) return { status: 'unchanged', content: original }
  return { status: 'changed', content: recombineDocument(frontmatter, updatedBody) }
}

export function applyDocumentInstruction(original: string, instruction: string): DocumentEditResult {
  const text = instruction.trim()
  const lineEnding = original.includes('\r\n') ? '\r\n' : '\n'
  const appendMatch = /^(?:在|于)?(?:文章|文档|笔记|正文)?(?:的)?(?:最后|末尾|文末)(?:增加|添加|加上|追加|插入)(?:一行|一段|内容)?(?:[:：]?\s*)([\s\S]+)$/i.exec(text)
  if (appendMatch?.[1]?.trim()) {
    const addition = appendMatch[1].trim()
    const separator = original.endsWith('\n') || original.endsWith('\r') ? '' : lineEnding
    return {
      status: 'changed',
      content: `${original}${separator}${addition}${lineEnding}`,
      summary: `已在文档末尾新增：${addition}`,
    }
  }

  const titleMatch = /^(?:把|将)?(?:文章|文档|笔记)?(?:的)?(?:标题|首标题|第一个标题)(?:改成|换成|替换为|设置为)[:：]?\s*(.+)$/i.exec(text)
  if (titleMatch?.[1]?.trim()) {
    const { frontmatter, body } = splitFrontmatter(original)
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#?[ \t]*$/m.exec(body)
    if (heading?.[1]) {
      const nextBody = body.slice(0, heading.index) + `${heading[1]} ${titleMatch[1].trim()}` + body.slice(heading.index + heading[0].length)
      return { status: 'changed', content: recombineDocument(frontmatter, nextBody), summary: `已将标题改为：${titleMatch[1].trim()}` }
    }
  }

  return { status: 'unsupported' }
}

export function isDocumentEditIntent(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const isQuestion = /(?:怎么|如何|怎样|为什么|为何|能不能|可否|可不可以|是否可以|有什么|有哪些|是否会).*(?:改|修改|更新|优化|增加|删除|导出)/i.test(trimmed)
    || /(?:讲了什么|说了什么|是什么|什么意思|介绍一下|解释一下|怎么理解|分析一下|写的什么|写了什么|主要内容|主要观点)/i.test(trimmed)
  if (isQuestion) return false

  const isPureAnalysis = /^(?:请?(?:帮我)?)?(?:总结|提取|梳理|概括|列出|大纲|分析)(?:一下|当前|这篇|此篇|本文)?(?:要点|重点|内容|待办|表格|数据|核心|结论)?(?:[。！!？?\s]*)$/i.test(trimmed)
  if (isPureAnalysis) return false
  if (/[？?吗呢么]\s*$/.test(trimmed) && !/(?:帮我|请).*(?:改|删|加|换|写)/.test(trimmed)) return false
  if (/(?:把|将).+(?:改成|换成|替换为|删除|删掉|去掉|移除|追加|插入|翻译成|翻译为)/i.test(trimmed)) return true
  if (/(?:增加|添加|加上|追加|插入|写入|写上|修改|改成|换成|替换|删除|删掉|去掉|移除|清空|润色|重写|改写|重构|扩写|精简|续写)/i.test(trimmed)) return true
  if (/(?:文章|笔记|正文|文档|内容|开头|结尾|文末|末尾|最后|首行|行|段|段落|标题).*(?:加|删|改|换)/i.test(trimmed)
    || /(?:加|删|改|换).*(?:文章|笔记|正文|文档|开头|结尾|文末|末尾|首行|行|段|标题)/i.test(trimmed)) return true
  if (/^(?:在|给)?(?:文章|文档|正文|笔记|开头|结尾|末尾|文末|首行)?\s*(?:加|删|改)\s*.+/i.test(trimmed)) return true
  return false
}

export type DocumentCreateIntent = {
  path: string
  content?: string
}

export type DocumentDeleteIntent = {
  path: string
}

function cleanDocumentTarget(value: string): string {
  return value
    .trim()
    .replace(/^[`"'“”‘’《》]+|[`"'“”‘’《》]+$/g, '')
    .replace(/[。！!；;，,]+$/g, '')
    .trim()
}

function normalizeDocumentTarget(value: string): string {
  const target = cleanDocumentTarget(value)
    .replace(/^(?:标题|文件名|文档名|文章名)\s*(?:是|为|叫|叫做)?\s*/i, '')
    .replace(/^[:：]\s*/, '')
    .trim()
  if (!target || target === '当前文章' || target === '当前文档' || target === '当前笔记' || target === '这篇文章' || target === '这篇文档' || target === '这篇笔记') return ''
  return /\.md$/i.test(target) ? target : `${target}.md`
}

export function parseDocumentCreateIntent(text: string): DocumentCreateIntent | null {
  const trimmed = text.trim()
  const match = /^(?:请|帮我)?\s*(?:创建|新建|新增|建立|写|撰写|生成)\s*(?:一篇|一个|一份)?\s*(?:文章|文档|笔记)\s*([\s\S]*)$/i.exec(trimmed)
  if (!match) return null
  let rest = match[1].trim().replace(/^[，,:：\s]+/, '')
  if (!rest) return null

  let content: string | undefined
  const contentMarker = /\s*(?:[,，。；;]?\s*(?:正文|内容)(?:是|为|：|:)\s*)/i.exec(rest)
  if (contentMarker?.index !== undefined) {
    content = rest.slice(contentMarker.index + contentMarker[0].length).trim()
    rest = rest.slice(0, contentMarker.index).trim()
  }
  const path = normalizeDocumentTarget(rest)
  if (!path) return null
  return content ? { path, content } : { path }
}

export function parseDocumentDeleteIntent(text: string): DocumentDeleteIntent | null {
  const trimmed = text.trim()
  const match = /^(?:请|帮我)?\s*(?:删除|删掉|移除|去掉)\s*(.*)$/i.exec(trimmed)
  if (!match) return null
  const rest = match[1].trim().replace(/^[，,:：\s]+/, '')
  if (!rest) return null

  const currentMatch = /^(?:当前|这篇|此篇|该篇)?\s*(?:文章|文档|笔记)\s*$/i.exec(rest)
  if (currentMatch) return { path: '' }

  const articleMatch = /^(?:文章|文档|笔记)\s+(.+)$/i.exec(rest)
  const target = normalizeDocumentTarget(articleMatch?.[1] || rest)
  if (!target || /^(?:中的|里的|内的|里面的)/.test(target)) return null
  if (!articleMatch && !/\.md$/i.test(cleanDocumentTarget(rest)) && !/[\\/]/.test(rest)) return null
  return { path: target }
}
