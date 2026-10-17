import { useEffect, useRef, useState } from 'react'
import type { DocumentHeading } from './markdown-outline'

export function DocumentOutline({ headings, activeId, onJump, className = '' }: {
  headings: DocumentHeading[]
  activeId: string
  onJump: (id: string) => void
  className?: string
}) {
  if (!headings.length) return null
  return <aside className={`outline-panel ${className}`} aria-label="本页目录" tabIndex={0}>
    <div className="outline-rail" aria-hidden="true">
      {headings.map((heading, index) => <span key={`${heading.id}-${index}`} className={`outline-marker outline-level-${heading.level} ${activeId === heading.id ? 'is-active' : ''}`} />)}
    </div>
    <div className="outline-popover">
      <p>本页内容</p>
      {headings.map((heading, index) => <button type="button" key={`${heading.id}-${index}`} className={`outline-level-${heading.level} ${activeId === heading.id ? 'is-active' : ''}`} aria-current={activeId === heading.id ? 'location' : undefined} onClick={() => onJump(heading.id)}>{heading.text}</button>)}
    </div>
  </aside>
}

export function EditorDocumentOutline({ container }: { container: HTMLElement | null }) {
  const [headings, setHeadings] = useState<DocumentHeading[]>([])
  const [activeId, setActiveId] = useState('')
  const targets = useRef<HTMLElement[]>([])

  useEffect(() => {
    const root = container?.querySelector<HTMLElement>('.inline-editor-content')
    if (!root) return
    let frame = 0
    function updateActive() {
      const top = root!.getBoundingClientRect().top + 24
      let activeIndex = 0
      targets.current.forEach((element, index) => {
        if (element.getBoundingClientRect().top <= top + 1) activeIndex = index
      })
      if (root!.scrollTop > 0 && root!.scrollTop + root!.clientHeight >= root!.scrollHeight - 1) activeIndex = targets.current.length - 1
      setActiveId(targets.current.length ? `editor-heading-${activeIndex}` : '')
    }
    function syncHeadings() {
      targets.current = Array.from(root!.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
        .filter((element) => !element.closest('pre, code, .code-block') && element.textContent?.trim())
      targets.current.forEach((element, index) => { element.id = `editor-heading-${index}` })
      setHeadings(targets.current.map((element, index) => ({
        id: `editor-heading-${index}`,
        level: Number(element.tagName.slice(1)),
        text: element.textContent!.trim(),
      })))
      updateActive()
    }
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncHeadings)
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    const resizeObserver = new ResizeObserver(updateActive)
    resizeObserver.observe(root)
    root.addEventListener('scroll', updateActive, { passive: true })
    root.addEventListener('load', updateActive, true)
    syncHeadings()
    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      cancelAnimationFrame(frame)
      root.removeEventListener('scroll', updateActive)
      root.removeEventListener('load', updateActive, true)
      targets.current = []
    }
  }, [container])

  function jumpToHeading(id: string) {
    const root = container?.querySelector<HTMLElement>('.inline-editor-content')
    const target = targets.current[headings.findIndex((heading) => heading.id === id)]
    if (!root || !target) return
    root.scrollTo({
      top: root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 24,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    setActiveId(id)
  }

  return <DocumentOutline headings={headings} activeId={activeId} onJump={jumpToHeading} className="ai-document-preview-outline" />
}
