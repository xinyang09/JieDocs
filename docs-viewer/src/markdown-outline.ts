export interface DocumentHeading {
  level: number
  text: string
  id: string
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Recursively extracts plain text from React nodes, elements, or primitive values
 */
export function getNodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getNodeText).join('')
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    return getNodeText((node as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

/**
 * Extracts document headings (H1-H6) from Markdown content.
 * Code blocks (fenced with ``` or ~~~, or 4-space/tab indented) and HTML comments
 * are strictly ignored so that code comments (e.g. `# 快速上手` in Python/Shell)
 * are never mistakenly extracted as document outline headings.
 */
export function extractHeadings(markdown: string): DocumentHeading[] {
  if (!markdown) return []

  // Strip YAML frontmatter at document start if present
  let content = markdown
  if (/^---\s*\r?\n/.test(content)) {
    const endMatch = /\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(content.slice(3))
    if (endMatch) {
      content = content.slice(3 + endMatch.index + endMatch[0].length)
    }
  }

  const headings: DocumentHeading[] = []
  let fence: { character: string; length: number } | null = null
  let inHtmlComment = false

  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Handle HTML comments (<!-- ... -->)
    if (!fence) {
      if (inHtmlComment) {
        if (line.includes('-->')) inHtmlComment = false
        continue
      }
      if (line.includes('<!--')) {
        if (!line.includes('-->')) {
          inHtmlComment = true
          continue
        }
        if (/^\s*<!--.*?-->\s*$/.test(line)) {
          continue
        }
      }
    }

    // Handle fenced code block boundary (``` or ~~~ with any indentation)
    const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      if (!fence) {
        fence = { character: fenceMatch[2][0], length: fenceMatch[2].length }
      } else if (
        fenceMatch[2][0] === fence.character &&
        fenceMatch[2].length >= fence.length &&
        !fenceMatch[3].trim()
      ) {
        fence = null
      }
      continue
    }

    // While inside a code block, ignore all lines completely
    if (fence) continue

    // Indented code block: 4 or more spaces or tab indentation
    if (/^(?: {4}|\t)/.test(line)) continue

    // Match ATX heading (1 to 6 #) preceded by 0 to 3 spaces and followed by whitespace
    const match = /^ {0,3}(#{1,6})[ \t]+(.+)$/.exec(line)
    if (match) {
      // Strip trailing hashes (CommonMark closed heading) and markdown markers (*, _, `)
      const cleanText = match[2]
        .trim()
        .replace(/[ \t]+#+[ \t]*$/, '')
        .replace(/[*_`]/g, '')
        .trim()
      if (cleanText) {
        headings.push({
          level: match[1].length,
          text: cleanText,
          id: slugify(cleanText) || `heading-${headings.length + 1}`,
        })
      }
    }
  }

  return headings
}
