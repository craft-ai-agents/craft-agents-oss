import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Brain, Shield, ShieldOff, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

export type SlashCommandId = 'safe' | 'ultrathink' | 'skip-permissions'

export interface SlashCommand {
  id: SlashCommandId
  label: string
  description: string
  icon: React.ReactNode
  shortcut?: string
  activeStyle?: string
}

// ============================================================================
// Default Commands
// ============================================================================

// Icon size constant (used in DEFAULT_SLASH_COMMANDS below)
const MENU_ICON_SIZE = 'h-3.5 w-3.5'

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'safe',
    label: 'Safe Mode',
    description: 'Read-only exploration mode',
    icon: <Shield className={MENU_ICON_SIZE} />,
    activeStyle: 'bg-green-500/10 text-green-500 border-green-500/30',
  },
  {
    id: 'skip-permissions',
    label: 'Skip Permissions',
    description: 'Auto-approve all permission prompts',
    icon: <ShieldOff className={MENU_ICON_SIZE} />,
    activeStyle: 'bg-red-500/10 text-red-500 border-red-500/30',
  },
  {
    id: 'ultrathink',
    label: 'Ultrathink',
    description: 'Extended reasoning for complex problems',
    icon: <Brain className={MENU_ICON_SIZE} />,
    activeStyle: 'bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-pink-500/20 text-fuchsia-500 border-fuchsia-500/30',
  },
]

// ============================================================================
// Shared Styles
// ============================================================================

const MENU_CONTAINER_STYLE = 'min-w-[200px] overflow-hidden rounded-[8px] bg-background text-popover-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[240px] overflow-y-auto p-1'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-3 rounded-[6px] px-3 py-2 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-accent text-accent-foreground'
const MENU_ITEM_ACTIVE = 'bg-accent/40'

// ============================================================================
// Shared: Filter commands utility
// ============================================================================

function filterCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  if (!filter) return commands
  const lowerFilter = filter.toLowerCase()
  return commands.filter(
    cmd =>
      cmd.label.toLowerCase().includes(lowerFilter) ||
      cmd.id.toLowerCase().includes(lowerFilter)
  )
}

// ============================================================================
// Shared: Command Item Content
// ============================================================================

function CommandItemContent({ command, isActive }: { command: SlashCommand; isActive: boolean }) {
  return (
    <>
      <div className="shrink-0 text-muted-foreground">{command.icon}</div>
      <div className="flex-1 min-w-0">{command.label}</div>
      {isActive && (
        <div className="shrink-0 h-4 w-4 rounded-full bg-current flex items-center justify-center">
          <Check className="h-2.5 w-2.5 text-white dark:text-black" strokeWidth={3} />
        </div>
      )}
    </>
  )
}

// ============================================================================
// SlashCommandMenu Component (Button-triggered popup)
// ============================================================================

export interface SlashCommandMenuProps {
  commands: SlashCommand[]
  activeCommands?: SlashCommandId[]
  onSelect: (commandId: SlashCommandId) => void
  showFilter?: boolean
  filterPlaceholder?: string
  className?: string
}

export function SlashCommandMenu({
  commands,
  activeCommands = [],
  onSelect,
  showFilter = false,
  filterPlaceholder = 'Search commands...',
  className,
}: SlashCommandMenuProps) {
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const filteredCommands = filterCommands(commands, filter)

  React.useEffect(() => {
    if (showFilter && inputRef.current) {
      inputRef.current.focus()
    }
  }, [showFilter])

  if (filteredCommands.length === 0 && !showFilter) return null

  return (
    <CommandPrimitive
      className={cn(MENU_CONTAINER_STYLE, className)}
      shouldFilter={false}
    >
      {showFilter && (
        <div className="border-b border-border/50 px-3 py-2">
          <CommandPrimitive.Input
            ref={inputRef}
            value={filter}
            onValueChange={setFilter}
            placeholder={filterPlaceholder}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      <CommandPrimitive.List className={MENU_LIST_STYLE}>
        {filteredCommands.length === 0 ? (
          <CommandPrimitive.Empty className="py-4 text-center text-sm text-muted-foreground">
            No commands found
          </CommandPrimitive.Empty>
        ) : (
          filteredCommands.map((cmd) => {
            const isActive = activeCommands.includes(cmd.id)
            return (
              <CommandPrimitive.Item
                key={cmd.id}
                value={cmd.id}
                onSelect={() => onSelect(cmd.id)}
                className={cn(
                  MENU_ITEM_STYLE,
                  'outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                  isActive && MENU_ITEM_ACTIVE
                )}
              >
                <CommandItemContent command={cmd} isActive={isActive} />
              </CommandPrimitive.Item>
            )
          })
        )}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}

// ============================================================================
// InlineSlashCommand - Autocomplete that follows cursor
// ============================================================================

export interface InlineSlashCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: SlashCommand[]
  activeCommands?: SlashCommandId[]
  onSelect: (commandId: SlashCommandId) => void
  filter?: string
  position: { x: number; y: number }
  className?: string
}

export function InlineSlashCommand({
  open,
  onOpenChange,
  commands,
  activeCommands = [],
  onSelect,
  filter = '',
  position,
  className,
}: InlineSlashCommandProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredCommands = filterCommands(commands, filter)

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
          setSelectedIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredCommands.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            onSelect(filteredCommands[selectedIndex].id)
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
  }, [open, filteredCommands, selectedIndex, onSelect, onOpenChange])

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

  // Hide if no results or not open
  if (!open || filteredCommands.length === 0) return null

  // Calculate bottom position from window height (menu appears above cursor)
  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0

  return (
    <div
      ref={menuRef}
      className={cn('fixed z-50', MENU_CONTAINER_STYLE, className)}
      style={{ left: Math.round(position.x) - 10, bottom: bottomPosition }}
    >
      <div className={MENU_LIST_STYLE}>
        {filteredCommands.map((cmd, index) => {
          const isActive = activeCommands.includes(cmd.id)
          const isSelected = index === selectedIndex
          return (
            <div
              key={cmd.id}
              onClick={() => {
                onSelect(cmd.id)
                onOpenChange(false)
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                MENU_ITEM_STYLE,
                isSelected && MENU_ITEM_SELECTED,
                isActive && !isSelected && MENU_ITEM_ACTIVE
              )}
            >
              <CommandItemContent command={cmd} isActive={isActive} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// Hook for managing inline slash command state
// ============================================================================

export interface UseInlineSlashCommandOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement>
  onSelect: (commandId: SlashCommandId) => void
  activeCommands?: SlashCommandId[]
}

export interface UseInlineSlashCommandReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  activeCommands: SlashCommandId[]
  handleSelect: (commandId: SlashCommandId) => string
}

export function useInlineSlashCommand({
  textareaRef,
  onSelect,
  activeCommands = [],
}: UseInlineSlashCommandOptions): UseInlineSlashCommandReturn {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [slashStart, setSlashStart] = React.useState(-1)

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    const textBeforeCursor = value.slice(0, cursorPosition)
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/(\w*)$/)

    if (slashMatch) {
      const matchStart = textBeforeCursor.lastIndexOf('/')
      setSlashStart(matchStart)
      setFilter(slashMatch[1] || '')

      if (textareaRef.current) {
        const textarea = textareaRef.current
        const rect = textarea.getBoundingClientRect()
        const style = window.getComputedStyle(textarea)
        const lineHeight = parseInt(style.lineHeight) || 20

        // Mirror element to measure cursor position
        const mirror = document.createElement('div')
        mirror.style.cssText = `
          position: absolute;
          visibility: hidden;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: ${style.fontFamily};
          font-size: ${style.fontSize};
          line-height: ${style.lineHeight};
          padding: ${style.padding};
          width: ${textarea.clientWidth}px;
          box-sizing: border-box;
        `
        mirror.textContent = textBeforeCursor
        const caret = document.createElement('span')
        caret.textContent = '|'
        mirror.appendChild(caret)

        document.body.appendChild(mirror)
        const caretRect = caret.getBoundingClientRect()
        const mirrorRect = mirror.getBoundingClientRect()
        document.body.removeChild(mirror)

        // Position above the current line (menu appears above cursor)
        setPosition({
          x: rect.left + (caretRect.left - mirrorRect.left),
          y: rect.top + (caretRect.top - mirrorRect.top),
        })
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setSlashStart(-1)
    }
  }, [textareaRef])

  const handleSelect = React.useCallback((commandId: SlashCommandId): string => {
    onSelect(commandId)
    setIsOpen(false)

    if (textareaRef.current && slashStart >= 0) {
      const currentValue = textareaRef.current.value
      const before = currentValue.slice(0, slashStart)
      const cursorPos = textareaRef.current.selectionStart
      const after = currentValue.slice(cursorPos)
      return (before + after).trim()
    }

    return ''
  }, [onSelect, textareaRef, slashStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setSlashStart(-1)
  }, [])

  return {
    isOpen,
    filter,
    position,
    handleInputChange,
    close,
    activeCommands,
    handleSelect,
  }
}
