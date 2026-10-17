type PickerAnchor = { top: number; bottom: number; left: number; width: number }

/** Coordinates for a body-level dropdown, independent of the modal's overflow. */
export function taskDocumentPickerPosition(anchor: PickerAnchor, viewport: { width: number; height: number }) {
  const padding = 12
  const gap = 6
  const below = Math.max(0, viewport.height - anchor.bottom - padding - gap)
  const above = Math.max(0, anchor.top - padding - gap)
  const openBelow = below >= 180 || below >= above
  const maxHeight = Math.min(286, openBelow ? below : above)
  const width = Math.max(0, Math.min(anchor.width, viewport.width - padding * 2))
  return {
    top: openBelow ? anchor.bottom + gap : Math.max(padding, anchor.top - maxHeight - gap),
    left: Math.max(padding, Math.min(anchor.left, viewport.width - width - padding)),
    width,
    maxHeight,
  }
}

export function searchTaskDocuments(paths: string[], query: string) {
  const needle = query.trim().toLowerCase()
  const matches = needle ? paths.filter((path) => path.toLowerCase().includes(needle)) : paths
  return { paths: matches.slice(0, 100), total: matches.length }
}
