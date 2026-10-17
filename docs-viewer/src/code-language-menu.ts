export const codeLanguageOptions = [
  ['text', '纯文本'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
  ['css', 'CSS'], ['docker', 'Dockerfile'], ['go', 'Go'], ['html', 'HTML'], ['java', 'Java'],
  ['javascript', 'JavaScript'], ['json', 'JSON'], ['kotlin', 'Kotlin'], ['lua', 'Lua'],
  ['markdown', 'Markdown'], ['php', 'PHP'], ['powershell', 'PowerShell'], ['python', 'Python'],
  ['ruby', 'Ruby'], ['rust', 'Rust'], ['scss', 'SCSS'], ['sql', 'SQL'], ['swift', 'Swift'],
  ['typescript', 'TypeScript'], ['yaml', 'YAML'],
] as const

export function codeLanguageLabel(value: string) {
  return codeLanguageOptions.find(([language]) => language === value)?.[1] || value
}

export function codeLanguageMenuPosition(anchor: { left: number; top: number; bottom: number }, viewport: { width: number; height: number }) {
  const margin = 8
  const gap = 6
  const width = Math.min(190, Math.max(1, viewport.width - margin * 2))
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const above = Math.max(0, anchor.top - gap - margin)
  const upwards = below < 280 && above > below
  const maxHeight = Math.min(280, upwards ? above : below)
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - margin - width)),
    top: upwards ? anchor.top - gap - maxHeight : anchor.bottom + gap,
    width,
    maxHeight,
  }
}

let dismissCurrentMenu: (() => void) | undefined

export function openCodeLanguageMenu(anchor: HTMLButtonElement, value: string, onSelect: (value: string) => void) {
  dismissCurrentMenu?.()
  const menu = document.createElement('div')
  menu.className = 'code-language-options code-language-floating'
  menu.id = `code-language-${crypto.randomUUID()}`
  menu.setAttribute('role', 'listbox')
  menu.setAttribute('aria-label', '代码语言')
  const position = codeLanguageMenuPosition(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
  Object.assign(menu.style, { left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px` })
  anchor.setAttribute('aria-expanded', 'true')
  anchor.setAttribute('aria-controls', menu.id)
  let closed = false

  function close(restoreFocus = false) {
    if (closed) return
    closed = true
    menu.remove()
    anchor.setAttribute('aria-expanded', 'false')
    anchor.removeAttribute('aria-controls')
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', keyboard, true)
    window.removeEventListener('scroll', scroll, true)
    window.removeEventListener('resize', resize)
    if (dismissCurrentMenu === close) dismissCurrentMenu = undefined
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true })
  }
  const options = codeLanguageOptions.map(([language, label]) => {
    const option = document.createElement('button')
    option.type = 'button'
    option.tabIndex = -1
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', String(language === value))
    option.dataset.codeLanguage = language
    option.classList.toggle('is-selected', language === value)
    option.textContent = label
    option.addEventListener('click', (event) => {
      event.stopPropagation()
      close(true)
      if (anchor.isConnected) onSelect(language)
    })
    menu.append(option)
    return option
  })
  let focused = Math.max(0, codeLanguageOptions.findIndex(([language]) => language === value))
  function focusOption(index: number) {
    focused = (index + options.length) % options.length
    const option = options[focused]
    option.focus({ preventScroll: true })
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
    if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (event.key === 'Tab') { close(true); return }
    if (!menu.contains(document.activeElement)) return
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : focused + (event.key === 'ArrowDown' ? 1 : -1))
    }
  }
  function outside(event: PointerEvent) {
    if (event.target instanceof Node && !menu.contains(event.target) && !anchor.contains(event.target)) close()
  }
  function scroll(event: Event) { if (!(event.target instanceof Node) || !menu.contains(event.target)) close() }
  function resize() { close() }
  document.body.append(menu)
  dismissCurrentMenu = close
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', keyboard, true)
  window.addEventListener('scroll', scroll, true)
  window.addEventListener('resize', resize)
  focusOption(focused)
  return close
}
