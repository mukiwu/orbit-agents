import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface QuickPickerItem {
  id: string
  name: string
  description?: string
  badge?: string
  selected?: boolean
}

interface QuickPickerProps {
  items: QuickPickerItem[]
  triggerLabel: string
  searchLabel: string
  searchPlaceholder: string
  emptyLabel: string
  resultsLabel: (count: number) => string
  onPick: (id: string) => void
}

export default function QuickPicker({
  items,
  triggerLabel,
  searchLabel,
  searchPlaceholder,
  emptyLabel,
  resultsLabel,
  onPick
}: QuickPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return items
    return items.filter((item) =>
      `${item.name} ${item.description ?? ''} ${item.badge ?? ''}`.toLocaleLowerCase().includes(normalized)
    )
  }, [items, query])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const handleOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handleOutsidePointer)
    return () => document.removeEventListener('pointerdown', handleOutsidePointer)
  }, [open])

  const pick = (item: QuickPickerItem) => {
    onPick(item.id)
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  const close = () => {
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setQuery('')
          setOpen((current) => !current)
        }}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 text-left text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id={id} className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-900/5">
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    close()
                  } else if (event.key === 'ArrowDown' && filtered.length > 0) {
                    event.preventDefault()
                    itemRefs.current[0]?.focus()
                  } else if (event.key === 'Enter' && query.trim() && filtered.length > 0) {
                    event.preventDefault()
                    pick(filtered[0])
                  }
                }}
                aria-label={searchLabel}
                placeholder={searchPlaceholder}
                className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              />
            </div>
            <p role="status" className="px-1 pt-1.5 text-xs text-gray-500">{resultsLabel(filtered.length)}</p>
          </div>

          <div className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">{emptyLabel}</p>
            ) : filtered.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => { itemRefs.current[index] = element }}
                type="button"
                onClick={() => pick(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    close()
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    itemRefs.current[Math.min(filtered.length - 1, index + 1)]?.focus()
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    if (index === 0) searchRef.current?.focus()
                    else itemRefs.current[index - 1]?.focus()
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    itemRefs.current[0]?.focus()
                  } else if (event.key === 'End') {
                    event.preventDefault()
                    itemRefs.current[filtered.length - 1]?.focus()
                  }
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="truncate">{item.name}</span>
                    {item.badge && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{item.badge}</span>}
                  </span>
                  {item.description && <span className="mt-0.5 block truncate text-xs text-gray-500">{item.description}</span>}
                </span>
                {item.selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-600" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
