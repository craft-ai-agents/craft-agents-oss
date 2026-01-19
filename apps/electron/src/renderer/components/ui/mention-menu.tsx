import * as React from 'react'
import { cn } from '@/lib/utils'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'

// ============================================================================
// Types
// ============================================================================

export type MentionItemType = 'skill' | 'source'

export interface MentionItem {
  id: string
  type: MentionItemType
  label: string
  description?: string
  // Type-specific data
  skill?: LoadedSkill
  source?: LoadedSource
}

export interface MentionSection {
  id: string
  label: string
  items: MentionItem[]
}

export interface InlineMentionMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: MentionSection[]
  onSelect: (item: MentionItem) => void
  filter?: string
  position: { x: number; y: number }
  workspaceId?: string
  maxWidth?: number
  className?: string
}

// ============================================================================
// Shared Styles
// ============================================================================

const MENU_CONTAINER_STYLE = 'overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[300px] overflow-y-auto py-1'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-3 rounded-[6px] mx-1 px-2 py-1.5 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-foreground/5'
const MENU_SECTION_HEADER = 'px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider'

// ============================================================================
// Filter utilities
// ============================================================================

/**
 * Get match priority score for filtering (higher = better match)
 * 3 = starts with filter (first word)
 * 2 = word boundary match (2nd+ word after space/hyphen/underscore)
 * 1 = contains filter (mid-word)
 * 0 = no match
 */
function getMatchScore(text: string, filter: string): number {
  const lowerText = text.toLowerCase()
  // Best: starts with filter (first word)
  if (lowerText.startsWith(filter)) return 3
  // Good: word boundary match (after space/hyphen/underscore)
  const escapedFilter = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordBoundaryPattern = new RegExp(`[\\s\\-_]${escapedFilter}`)
  if (wordBoundaryPattern.test(lowerText)) return 2
  // OK: contains filter anywhere
  if (lowerText.includes(filter)) return 1
  return 0
}

function filterSections(sections: MentionSection[], filter: string): MentionSection[] {
  if (!filter) return sections
  const lowerFilter = filter.toLowerCase()

  // Collect all matching items across sections
  const allItems = sections.flatMap(section => section.items)
  const matchingItems = allItems.filter(item =>
    item.label.toLowerCase().includes(lowerFilter) ||
    item.id.toLowerCase().includes(lowerFilter) ||
    item.description?.toLowerCase().includes(lowerFilter)
  )

  // Sort by match priority: first word > later word > contains
  matchingItems.sort((a, b) => {
    const aLabelScore = getMatchScore(a.label, lowerFilter)
    const bLabelScore = getMatchScore(b.label, lowerFilter)
    const aIdScore = getMatchScore(a.id, lowerFilter)
    const bIdScore = getMatchScore(b.id, lowerFilter)

    // Compare by best score (label or id)
    const aScore = Math.max(aLabelScore, aIdScore)
    const bScore = Math.max(bLabelScore, bIdScore)
    if (aScore !== bScore) return bScore - aScore

    // Same score tier: alphabetical by label
    return a.label.localeCompare(b.label)
  })

  // Return as flat list in a single virtual section (headers hidden when filtering)
  if (matchingItems.length === 0) return []
  return [{ id: 'results', label: 'Results', items: matchingItems }]
}

function flattenItems(sections: MentionSection[]): MentionItem[] {
  return sections.flatMap(section => section.items)
}

/**
 * Check if the @ character at the given position is a valid mention trigger.
 * Valid triggers are:
 * - @ at the start of input (position 0)
 * - @ preceded by whitespace (space, tab, newline)
 * - @ preceded by opening brackets or quotes: ( " '
 *
 * Invalid triggers (returns false):
 * - @ in the middle of a word (e.g., "test@example.com")
 * - @ preceded by alphanumeric or other characters
 *
 * @param textBeforeCursor - The text from start of input to cursor position
 * @param atPosition - The position of the @ character in textBeforeCursor
 * @returns true if this @ should trigger the mention menu
 */
export function isValidMentionTrigger(textBeforeCursor: string, atPosition: number): boolean {
  if (atPosition < 0) return false
  if (atPosition === 0) return true
  const charBefore = textBeforeCursor[atPosition - 1]
  if (charBefore === undefined) return false
  // Allow whitespace or opening brackets/quotes before @
  return /\s/.test(charBefore) || /[("']/.test(charBefore)
}

// ============================================================================
// InlineMentionMenu Component
// ============================================================================

export function InlineMentionMenu({
  open,
  onOpenChange,
  sections,
  onSelect,
  filter = '',
  position,
  workspaceId,
  maxWidth = 280,
  className,
}: InlineMentionMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredSections = filterSections(sections, filter)
  const flatItems = flattenItems(filteredSections)

  // Reset selection when filter changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Keyboard navigation
  React.useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : flatItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (flatItems[selectedIndex]) {
            onSelect(flatItems[selectedIndex])
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
  }, [open, flatItems, selectedIndex, onSelect, onOpenChange])

  // Close on click outside
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

  // Scroll selected item into view when navigating with keyboard
  React.useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('[data-selected="true"]')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Hide if no results or not open
  if (!open || flatItems.length === 0) return null

  // Calculate bottom position from window height (menu appears above cursor)
  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0

  // Track current item index across all sections
  let currentItemIndex = 0

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
      <div ref={listRef} className={MENU_LIST_STYLE}>
        {filteredSections.map((section, sectionIndex) => (
          <React.Fragment key={section.id}>
            {/* Section header - hide when filtering for better prefix match relevance */}
            {!filter && (
              <div className={MENU_SECTION_HEADER}>
                {section.label}
              </div>
            )}

            {/* Section items */}
            {section.items.map((item) => {
              const itemIndex = currentItemIndex++
              const isSelected = itemIndex === selectedIndex

              return (
                <div
                  key={`${section.id}-${item.id}`}
                  data-selected={isSelected}
                  onClick={() => {
                    onSelect(item)
                    onOpenChange(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  className={cn(
                    MENU_ITEM_STYLE,
                    isSelected && MENU_ITEM_SELECTED
                  )}
                >
                  {/* Icon based on type */}
                  <div className="shrink-0">
                    {item.type === 'skill' && item.skill && (
                      <SkillAvatar skill={item.skill} size="sm" workspaceId={workspaceId} />
                    )}
                    {item.type === 'source' && item.source && (
                      <SourceAvatar source={item.source} size="sm" />
                    )}
                  </div>

                  {/* Label and description */}
                  <div className="flex-1 min-w-0 leading-tight">
                    <div className="font-medium truncate">{item.label}</div>
                    {item.description && (
                      <div className="text-[11px] text-foreground/50 truncate mt-px">
                        {item.description}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Separator between sections (not after last, hide when filtering) */}
            {!filter && sectionIndex < filteredSections.length - 1 && (
              <div className="h-px bg-border/50 my-1 mx-2" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Hook for managing inline mention state
// ============================================================================

/** Interface for elements that can be used with useInlineMention */
export interface MentionInputElement {
  getBoundingClientRect: () => DOMRect
  getCaretRect?: () => DOMRect | null
  value: string
  selectionStart: number
}

export interface UseInlineMentionOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<MentionInputElement | null>
  skills: LoadedSkill[]
  sources: LoadedSource[]
  onSelect: (item: MentionItem) => void
}

export interface UseInlineMentionReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  sections: MentionSection[]
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  handleSelect: (item: MentionItem) => { value: string; cursorPosition: number }
}

export function useInlineMention({
  inputRef,
  skills,
  sources,
  onSelect,
}: UseInlineMentionOptions): UseInlineMentionReturn {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [atStart, setAtStart] = React.useState(-1)
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  // Build sections from available data (skills and sources only - folders moved to slash menu)
  const sections = React.useMemo((): MentionSection[] => {
    const result: MentionSection[] = []

    // Skills section
    if (skills.length > 0) {
      result.push({
        id: 'skills',
        label: 'Skills',
        items: skills.map(skill => ({
          id: skill.slug,
          type: 'skill' as const,
          label: skill.metadata.name,
          description: skill.metadata.description,
          skill,
        })),
      })
    }

    // Sources section
    if (sources.length > 0) {
      result.push({
        id: 'sources',
        label: 'Sources',
        items: sources.map(source => ({
          id: source.config.slug,
          type: 'source' as const,
          label: source.config.name,
          description: source.config.tagline,
          source,
        })),
      })
    }

    return result
  }, [skills, sources])

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    // Match @ anywhere, followed by optional word chars, hyphens, and slashes
    // This triggers on typing @ and shows menu while typing the filter
    const atMatch = textBeforeCursor.match(/@([\w\-/]*)$/)

    // Only show menu if we have at least one section with items
    const hasItems = sections.some(s => s.items.length > 0)

    // Check if this is a valid @ mention trigger:
    // - Must have @ match and items to show
    // - @ must be at start of input OR preceded by whitespace (not mid-word like emails)
    const matchStart = atMatch ? textBeforeCursor.lastIndexOf('@') : -1
    const isValidTrigger = atMatch && hasItems && isValidMentionTrigger(textBeforeCursor, matchStart)

    if (isValidTrigger) {
      setAtStart(matchStart)
      // Filter by the content after @
      setFilter(atMatch[1] || '')

      if (inputRef.current) {
        // Try to get actual caret position from the input element
        const caretRect = inputRef.current.getCaretRect?.()

        if (caretRect && caretRect.x > 0) {
          // Use actual caret position
          setPosition({
            x: caretRect.x,
            y: caretRect.y,
          })
        } else {
          // Fallback: position at input element's left edge
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
      setAtStart(-1)
    }
  }, [inputRef, sections])

  const handleSelect = React.useCallback((item: MentionItem): { value: string; cursorPosition: number } => {
    let result = ''
    let newCursorPosition = 0

    if (atStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, atStart)
      const after = currentValue.slice(cursorPosition)

      // Build the mention text based on type using bracket syntax
      let mentionText: string
      if (item.type === 'skill') {
        mentionText = `[skill:${item.id}] `
      } else if (item.type === 'source') {
        mentionText = `[source:${item.id}] `
      } else {
        mentionText = `[skill:${item.id}] `
      }

      result = before + mentionText + after
      newCursorPosition = before.length + mentionText.length
    }

    onSelect(item)
    setIsOpen(false)

    return { value: result, cursorPosition: newCursorPosition }
  }, [onSelect, atStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setAtStart(-1)
  }, [])

  return {
    isOpen,
    filter,
    position,
    sections,
    handleInputChange,
    close,
    handleSelect,
  }
}
