const COVER_KEY_PATTERN = /^\s*(?:cover(?:Image)?|image)\s*:/i

/**
 * Update the cover field while leaving unrelated frontmatter text and the
 * document body untouched. This intentionally works on the original text
 * instead of serialising YAML so existing quoting, field order and line
 * endings survive a cover change.
 */
export function updateFrontmatterCover(content: string, coverPath?: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const headerMatch = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(content)

  if (!headerMatch) {
    if (!coverPath) return content
    return `---${newline}cover: ${coverPath}${newline}---${newline}${newline}${content}`
  }

  const header = headerMatch[0]
  const headerLines = header.split(/\r?\n/)
  const closingIndex = headerLines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line))
  if (closingIndex < 0) return content

  const fields = headerLines.slice(1, closingIndex).filter((line) => !COVER_KEY_PATTERN.test(line))
  if (coverPath) fields.push(`cover: ${coverPath}`)

  if (!fields.length && !coverPath) {
    return content.slice(header.length)
  }

  const closing = headerLines[closingIndex].trim() || '---'
  const hasTrailingNewline = header.endsWith('\n')
  const nextHeader = ['---', ...fields, closing].join(newline) + (hasTrailingNewline ? newline : '')
  return `${nextHeader}${content.slice(header.length)}`
}

export function coverUploadPath(notePath: string, fileName: string): string {
  const folder = notePath.split('/').slice(0, -1).join('/')
  const stem = (notePath.split('/').pop() || 'document')
    .replace(/\.md$/i, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'document'
  const extension = /\.[a-z0-9]{1,8}$/i.exec(fileName)?.[0] || '.jpg'
  return `${folder ? `${folder}/` : ''}${stem}-cover${extension.toLowerCase()}`
}
