import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import type { ModelOption } from '../../../shared/types'

interface ModelSelectProps {
  value: string
  options: ModelOption[]
  onChange: (value: string) => void
  labelId: string
  emptyLabel: string
  defaultLabel: string
}

interface MenuPosition {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

export default function ModelSelect({
  value,
  options,
  onChange,
  labelId,
  emptyLabel,
  defaultLabel
}: ModelSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()
  const listboxId = `${id}-listbox`
  const valueId = `${id}-value`
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex]

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    const gap = 6
    const below = window.innerHeight - rect.bottom - gap - 8
    const above = rect.top - gap - 8
    const desiredHeight = Math.min(320, options.length * 64 + 8)
    const placeAbove = below < desiredHeight && above > below
    const available = placeAbove ? above : below

    setPosition({
      left: rect.left,
      width: rect.width,
      top: placeAbove ? undefined : rect.bottom + gap,
      bottom: placeAbove ? window.innerHeight - rect.top + gap : undefined,
      maxHeight: Math.max(64, Math.min(320, available))
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    document.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      document.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleOutsidePointer)
    return () => document.removeEventListener('pointerdown', handleOutsidePointer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const active = menu?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
    if (!menu || !active) return
    if (active.offsetTop < menu.scrollTop) menu.scrollTop = active.offsetTop
    else if (active.offsetTop + active.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = active.offsetTop + active.offsetHeight - menu.clientHeight
    }
  }, [activeIndex, open, position])

  useEffect(() => {
    if (options.length === 0) setOpen(false)
  }, [options.length])

  useEffect(() => () => {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
  }, [])

  const showMenu = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    if (options.length === 0) return
    setActiveIndex(index)
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (options.length === 0) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) showMenu()
      else setActiveIndex((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) showMenu(event.key === 'Home' ? 0 : options.length - 1)
      else setActiveIndex(event.key === 'Home' ? 0 : options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else showMenu()
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    } else if (event.key === 'Tab' && open) {
      setOpen(false)
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      typeaheadRef.current += event.key.toLocaleLowerCase()
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
      typeaheadTimerRef.current = setTimeout(() => { typeaheadRef.current = '' }, 600)
      const match = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(typeaheadRef.current))
      if (match >= 0) {
        event.preventDefault()
        if (!open) showMenu(match)
        else setActiveIndex(match)
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        disabled={options.length === 0}
        onClick={() => open ? setOpen(false) : showMenu()}
        onKeyDown={handleKeyDown}
        className="flex w-full min-h-14 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 text-left text-sm text-gray-900 shadow-sm transition-colors hover:border-gray-300 focus-visible:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
      >
        <span id={valueId} className="min-w-0 flex-1 truncate font-medium">
          {selected?.label || emptyLabel}
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className="fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-1 shadow-xl shadow-gray-900/10"
          style={position}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${index}`}
              data-option-index={index}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${index === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'} ${option.value === value ? 'text-blue-700' : 'text-gray-800'}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  <span className="truncate">{option.label}</span>
                  {option.isDefault && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">{defaultLabel}</span>}
                </span>
                {option.desc && <span className="mt-0.5 block truncate text-xs font-normal text-gray-500">{option.desc}</span>}
              </span>
              {option.value === value && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-600" />}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
