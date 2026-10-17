export type RawSelectionInput = {
  text: string
  start?: number
  end?: number
}

/** Convert an editor-body selection into a range in the complete raw note. */
export function rawNoteSelectionRange(content: string, request: RawSelectionInput) {
  // Proposal offsets are defined over the LF-normalized document, matching
  // browser text nodes and the server patcher. The stored note keeps its
  // original line endings and hash.
  const normalizedContent = content.replace(/\r\n/g, '\n')
  const frontmatter = /^---\s*\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/.exec(normalizedContent)?.[0] || ''
  const bodyOffset = frontmatter.length
  const body = normalizedContent.slice(bodyOffset)
  const text = request.text
  const requestedStart = Number.isSafeInteger(request.start) ? request.start as number : -1
  const requestedEnd = Number.isSafeInteger(request.end) ? request.end as number : -1
  if (requestedStart >= 0 && requestedEnd >= requestedStart && body.slice(requestedStart, requestedEnd) === text) {
    return { start: bodyOffset + requestedStart, end: bodyOffset + requestedEnd }
  }
  const bodyIndex = body.indexOf(text)
  if (bodyIndex >= 0) return { start: bodyOffset + bodyIndex, end: bodyOffset + bodyIndex + text.length }
  const fullIndex = normalizedContent.indexOf(text)
  if (fullIndex >= 0) return { start: fullIndex, end: fullIndex + text.length }
  // Keep a deterministic range for transformed Markdown (for example links)
  // when the visible text has no exact raw source match. The server will still
  // enforce the proposal baseline before writing.
  const fallbackStart = Math.max(0, Math.min(body.length, requestedStart >= 0 ? requestedStart : 0))
  const fallbackEnd = Math.max(fallbackStart, Math.min(body.length, requestedEnd > fallbackStart ? requestedEnd : fallbackStart + text.length))
  return { start: bodyOffset + fallbackStart, end: bodyOffset + fallbackEnd }
}
