import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronsUpDown, Layers, Plus } from 'lucide-react'

export function VaultSwitcher({ value, names, onChange, onCreate }: { value: string; names: string[]; onChange: (value: string) => void; onCreate: () => void }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const options = Array.from(new Set([value, ...names].filter(Boolean)))

  function close(restoreFocus = false) {
    setPosition(null)
    if (restoreFocus) trigger.current?.focus()
  }

  function open() {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 8, width: Math.min(rect.width, window.innerWidth - rect.left - 12) })
  }

  useEffect(() => {
    if (!position) return
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    ;(selected || menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]'))?.focus()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close()
    }
    function resize() { close(true) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', resize)
    }
  }, [position])

  return <div className="sidebar-vault-picker">
    <button ref={trigger} type="button" className="vault-switcher" aria-label={`切换空间：${value || '未选择'}`} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined}
      onClick={() => position ? close() : open()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open() }
      }}>
      <span className="vault-switcher-icon"><Layers size={18} /></span>
      <span className="vault-switcher-copy"><strong>{value || '选择空间'}</strong><span>空间</span></span>
      <ChevronsUpDown size={15} className="vault-switcher-chevron" />
    </button>
    {position && createPortal(<div ref={menu} id={id} role="menu" aria-label="切换空间" className="vault-switcher-menu" style={position}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
        if (event.key === 'Tab') { event.preventDefault(); close(true); return }
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        let next = current
        if (event.key === 'ArrowDown') next = (current + 1) % items.length
        else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else return
        event.preventDefault()
        items[next]?.focus()
      }}>
      <div className="vault-switcher-menu-heading">切换空间</div>
      <div className="vault-switcher-options">
        {options.map((name) => <button type="button" key={name} role="menuitemradio" aria-checked={name === value} tabIndex={-1} title={name}
          onClick={() => { onChange(name); close(true) }}>
          <Layers size={16} /><span>{name}</span>{name === value && <Check size={16} className="vault-switcher-check" />}
        </button>)}
        {!options.length && <p className="vault-switcher-empty">暂无可用空间</p>}
      </div>
      <div className="vault-switcher-menu-actions">
        <button type="button" onClick={() => { onCreate(); close(true) }}><Plus size={16} /><span>新建空间</span></button>
      </div>
    </div>, document.body)}
  </div>
}
