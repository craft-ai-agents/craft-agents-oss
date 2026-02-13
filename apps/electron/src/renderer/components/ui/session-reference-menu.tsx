import * as React from 'react'
import { fuzzyScore } from '@g4os/shared/search'
import { cn } from '@/lib/utils'

export interface SessionReferenceCandidate {
  id: string
  workspaceId: string
  title: string
  lastMessageAt?: number
}

export interface InlineSessionReferenceMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: SessionReferenceCandidate[]
  onSelect: (item: SessionReferenceCandidate) => void
  filter?: string
  position: { x: number; y: number }
  maxWidth?: number
  className?: string
}

const MENU_CONTAINER_STYLE = 'overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[240px] overflow-y-auto py-1'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-2 rounded-[6px] mx-1 px-2 py-1.5 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-foreground/5'

function filterSessionItems(items: SessionReferenceCandidate[], filter: string): SessionReferenceCandidate[] {
  const query = filter.trim().toLowerCase()
  if (!query) {
    return [...items]
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      .slice(0, 50)
  }

  return items
    .map((item) => {
      const titleScore = fuzzyScore(item.title, query)
      const includes = item.title.toLowerCase().includes(query)

      if (titleScore === 0 && !includes) {
        return null
      }

      return {
        item,
        score: Math.max(titleScore, includes ? 1 : 0),
      }
    })
    .filter((entry): entry is { item: SessionReferenceCandidate; score: number } => entry !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (b.item.lastMessageAt || 0) - (a.item.lastMessageAt || 0)
    })
    .slice(0, 50)
    .map((entry) => entry.item)
}

export function InlineSessionReferenceMenu({
  open,
  onOpenChange,
  items,
  onSelect,
  filter = '',
  position,
  maxWidth = 320,
  className,
}: InlineSessionReferenceMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredItems = React.useMemo(() => filterSessionItems(items, filter), [items, filter])

  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  React.useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          if (filteredItems.length === 0) return
          e.preventDefault()
          setSelectedIndex(prev => (prev < filteredItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          if (filteredItems.length === 0) return
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          if (filteredItems[selectedIndex]) {
            e.preventDefault()
            onSelect(filteredItems[selectedIndex])
            onOpenChange(false)
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, filteredItems, selectedIndex, onSelect, onOpenChange])

  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  React.useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('[data-selected="true"]')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!open) return null

  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0

  return (
    <div
      ref={menuRef}
      className={cn('fixed z-dropdown', MENU_CONTAINER_STYLE, className)}
      style={{
        left: Math.round(position.x) - 10,
        bottom: bottomPosition,
        width: maxWidth,
        maxWidth,
      }}
    >
      <div className="px-3 py-1.5 text-[12px] font-medium text-muted-foreground border-b border-foreground/5">
        Reference sessions
      </div>

      <div ref={listRef} className={MENU_LIST_STYLE}>
        {filteredItems.length === 0 && filter.trim() && (
          <div className="px-3 py-2 text-[12px] text-muted-foreground/60">No sessions found</div>
        )}

        {filteredItems.map((item, itemIndex) => {
          const isSelected = itemIndex === selectedIndex

          return (
            <div
              key={item.id}
              data-selected={isSelected}
              onClick={() => {
                onSelect(item)
                onOpenChange(false)
              }}
              onMouseEnter={() => setSelectedIndex(itemIndex)}
              className={cn(MENU_ITEM_STYLE, isSelected && MENU_ITEM_SELECTED)}
            >
              <div className="shrink-0 text-muted-foreground">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2.5H14.5C18.2712 2.5 20.1569 2.5 21.3284 3.67157C22.5 4.84315 22.5 6.72876 22.5 10.5V11.5C22.5 15.2712 22.5 17.1569 21.3284 18.3284C20.1569 19.5 18.2712 19.5 14.5 19.5H13.4122C12.6233 19.5 12.2288 19.5 11.8534 19.5894C11.4781 19.6787 11.1276 19.8538 10.4265 20.2038L7.5 21.6653C5.42893 22.7008 4.3934 23.2185 3.6967 22.8557C3 22.4929 3 21.3351 3 19.0194V11.5C3 7.72876 3 5.84315 4.17157 4.67157C5.34315 3.5 7.22876 3.5 11 3.5" />
                  <path d="M7.5 8.5H17.5M7.5 12H13.5" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate">{item.title}</div>
                <div className="truncate text-[11px] text-muted-foreground/70">{item.id}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export interface SessionReferenceInputElement {
  getBoundingClientRect: () => DOMRect
  getCaretRect?: () => DOMRect | null
  value: string
  selectionStart: number
}

export interface UseInlineSessionReferenceOptions {
  inputRef: React.RefObject<SessionReferenceInputElement | null>
  sessions: SessionReferenceCandidate[]
  onSelect: (item: SessionReferenceCandidate) => void
}

export interface UseInlineSessionReferenceReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  items: SessionReferenceCandidate[]
  hasMatches: boolean
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  handleSelect: (item: SessionReferenceCandidate) => { value: string; cursorPosition: number }
}

export function useInlineSessionReference({
  inputRef,
  sessions,
  onSelect,
}: UseInlineSessionReferenceOptions): UseInlineSessionReferenceReturn {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [triggerStart, setTriggerStart] = React.useState(-1)
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    const matchStart = textBeforeCursor.lastIndexOf('>')
    const isValidTrigger =
      matchStart === 0 ||
      (matchStart > 0 && /\s/.test(textBeforeCursor[matchStart - 1] || ''))
    const filterText = matchStart >= 0 ? textBeforeCursor.slice(matchStart + 1) : ''
    const shouldClose =
      matchStart < 0 ||
      !isValidTrigger ||
      filterText.includes('\n') ||
      filterText.includes('\r') ||
      /\s/.test(filterText)

    if (!shouldClose) {
      setTriggerStart(matchStart)
      setFilter(filterText)

      if (inputRef.current) {
        const caretRect = inputRef.current.getCaretRect?.()
        if (caretRect && caretRect.x > 0) {
          setPosition({
            x: caretRect.x,
            y: caretRect.y,
          })
        } else {
          const rect = inputRef.current.getBoundingClientRect()
          const lineHeight = 20
          const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
          setPosition({
            x: rect.left,
            y: rect.top + (linesBeforeCursor + 1) * lineHeight,
          })
        }
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setTriggerStart(-1)
    }
  }, [inputRef])

  const handleSelect = React.useCallback((item: SessionReferenceCandidate): { value: string; cursorPosition: number } => {
    const { value: currentValue, cursorPosition } = currentInputRef.current
    let result = currentValue
    let newCursorPosition = cursorPosition

    if (triggerStart >= 0) {
      const before = currentValue.slice(0, triggerStart)
      const after = currentValue.slice(cursorPosition)
      const mentionText = `[session:${item.workspaceId}:${item.id}] `

      result = before + mentionText + after
      newCursorPosition = before.length + mentionText.length
    }

    onSelect(item)
    setIsOpen(false)
    setFilter('')
    setTriggerStart(-1)

    return { value: result, cursorPosition: newCursorPosition }
  }, [onSelect, triggerStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setTriggerStart(-1)
  }, [])

  const hasMatches = React.useMemo(() => {
    return filterSessionItems(sessions, filter).length > 0
  }, [sessions, filter])

  return {
    isOpen,
    filter,
    position,
    items: sessions,
    hasMatches,
    handleInputChange,
    close,
    handleSelect,
  }
}
