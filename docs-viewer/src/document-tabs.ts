export type SavedDocumentTab = {
  key: string
  vault: string
  kind: 'note' | 'file' | 'skill'
  path: string
  title: string
  skillId?: string
}

export function makeDocumentTabKey(vault: string, kind: SavedDocumentTab['kind'], path: string) {
  return `${vault}\u0000${kind}\u0000${path}`
}

export function readDocumentTabs(value: unknown): SavedDocumentTab[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item.vault !== 'string' || typeof item.path !== 'string' || !item.path
      || !['note', 'file', 'skill'].includes(item.kind)) return []
    const key = makeDocumentTabKey(item.vault, item.kind, item.path)
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      key,
      vault: item.vault,
      kind: item.kind,
      path: item.path,
      title: typeof item.title === 'string' ? item.title : item.path,
      skillId: typeof item.skillId === 'string' ? item.skillId : undefined,
    }]
  })
}

export function saveDocumentTabs(tabs: (SavedDocumentTab & { skill?: { id: string } })[]) {
  return tabs.map(({ key, vault, kind, path, title, skillId, skill }) => ({
    key, vault, kind, path, title, skillId: skill?.id || skillId,
  }))
}

export function restoredActiveTab(tabs: SavedDocumentTab[], activeKey?: string) {
  return tabs.find((tab) => tab.key === activeKey) || tabs[0]
}
