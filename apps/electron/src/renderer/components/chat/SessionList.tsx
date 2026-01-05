import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { formatDistanceToNow, isToday, isYesterday, format, startOfDay } from "date-fns"
import { Trash2, Pencil, MoreHorizontal, ExternalLink, Flag, FlagOff, MailOpen, Search, X, FolderOpen } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

/** Check if a string is a hex color code (e.g., #3B82F6) */
function isHexColor(str: string | undefined): boolean {
  return !!str && /^#[0-9A-Fa-f]{6}$/.test(str)
}
import { Spinner } from "@/components/ui/loading-indicator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TodoStateMenu } from "@/components/ui/todo-filter-menu"
import { getStateColor, getStateIcon, getStateLabel, getStateShortcut, type TodoStateId } from "@/config/todo-states"
import type { TodoState } from "@/config/todo-states"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from "@/components/ui/styled-dropdown"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RenameDialog } from "@/components/ui/rename-dialog"
import { useSession } from "@/hooks/useSession"
import { useFocusZone, useRovingTabIndex } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import type { Session } from "../../../shared/types"
import { PERMISSION_MODE_CONFIG, type PermissionMode } from "@craft-agent/shared/agent/modes"

/**
 * Format a date for the date header
 * Returns "Today", "Yesterday", or formatted date like "Dec 19"
 */
function formatDateHeader(date: Date): string {
  if (isToday(date)) return "Today"
  if (isYesterday(date)) return "Yesterday"
  return format(date, "MMM d")
}

/**
 * Group sessions by date (day boundary)
 * Returns array of { date, sessions } sorted by date descending
 */
function groupSessionsByDate(sessions: Session[]): Array<{ date: Date; label: string; sessions: Session[] }> {
  const groups = new Map<string, { date: Date; sessions: Session[] }>()

  for (const session of sessions) {
    const timestamp = session.lastMessageAt || 0
    const date = startOfDay(new Date(timestamp))
    const key = date.toISOString()

    if (!groups.has(key)) {
      groups.set(key, { date, sessions: [] })
    }
    groups.get(key)!.sessions.push(session)
  }

  // Sort groups by date descending and add labels
  return Array.from(groups.values())
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map(group => ({
      ...group,
      label: formatDateHeader(group.date),
    }))
}

/**
 * Get the current todo state of a session
 * States are user-controlled, never automatic
 */
function getSessionTodoState(session: Session): TodoStateId {
  // Read from session.todoState (user-controlled)
  // Falls back to 'todo' if not set
  return (session.todoState as TodoStateId) || 'todo'
}

/**
 * Get the last final assistant message ID from a session
 * A "final" message is one where:
 * - role === 'assistant' AND
 * - isIntermediate !== true (not commentary between tool calls)
 * Returns undefined if no final assistant message exists
 */
function getLastFinalAssistantMessageId(session: Session): string | undefined {
  // Iterate backwards to find the most recent final assistant message
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i]
    if (msg.role === 'assistant' && !msg.isIntermediate) {
      return msg.id
    }
  }
  return undefined
}

/**
 * Check if a session has unread messages
 * A session is unread if:
 * - There's a final assistant message AND
 * - Its ID differs from lastReadMessageId
 */
function hasUnreadMessages(session: Session): boolean {
  const lastFinalId = getLastFinalAssistantMessageId(session)
  if (!lastFinalId) return false  // No final assistant message yet
  return lastFinalId !== session.lastReadMessageId
}

/**
 * Count the number of unread final assistant messages
 * Returns the count of final assistant messages after lastReadMessageId
 */
function countUnreadMessages(session: Session): number {
  if (!session.lastReadMessageId) {
    // Never read - count all final assistant messages
    return session.messages.filter(msg => msg.role === 'assistant' && !msg.isIntermediate).length
  }

  // Find the index of the last read message
  const lastReadIndex = session.messages.findIndex(msg => msg.id === session.lastReadMessageId)
  if (lastReadIndex === -1) {
    // Last read message not found - count all final assistant messages
    return session.messages.filter(msg => msg.role === 'assistant' && !msg.isIntermediate).length
  }

  // Count final assistant messages after the last read index
  let count = 0
  for (let i = lastReadIndex + 1; i < session.messages.length; i++) {
    const msg = session.messages[i]
    if (msg.role === 'assistant' && !msg.isIntermediate) {
      count++
    }
  }
  return count
}

/**
 * Highlight matching text in a string
 * Returns React nodes with matched portions wrapped in a highlight span
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)

  if (index === -1) return text

  const before = text.slice(0, index)
  const match = text.slice(index, index + query.length)
  const after = text.slice(index + query.length)

  return (
    <>
      {before}
      <span className="bg-info/30 rounded-sm">{match}</span>
      {highlightMatch(after, query)}
    </>
  )
}

interface SessionItemProps {
  item: Session
  index: number
  itemProps: {
    id: string
    tabIndex: number
    'aria-selected': boolean
    onKeyDown: (e: React.KeyboardEvent) => void
    onFocus: () => void
    ref: (el: HTMLElement | null) => void
    role: string
  }
  isSelected: boolean
  isLast: boolean
  isFirstInGroup: boolean
  onKeyDown: (e: React.KeyboardEvent, item: Session) => void
  onRenameClick: (sessionId: string, currentName: string) => void
  onTodoStateChange: (sessionId: string, state: TodoStateId) => void
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onSelect: (forceNewTab: boolean) => void
  onOpenInNewTab: () => void
  /** Current permission mode for this session (from real-time state) */
  permissionMode?: PermissionMode
  /** Current search query for highlighting matches */
  searchQuery?: string
  /** Dynamic todo states from workspace config */
  todoStates: TodoState[]
}

/**
 * SessionItem - Individual session card with todo checkbox and dropdown menu
 * Tracks menu open state to keep "..." button visible
 */
function SessionItem({
  item,
  index,
  itemProps,
  isSelected,
  isLast,
  isFirstInGroup,
  onKeyDown,
  onRenameClick,
  onTodoStateChange,
  onFlag,
  onUnflag,
  onMarkUnread,
  onDelete,
  onSelect,
  onOpenInNewTab,
  permissionMode,
  searchQuery,
  todoStates,
}: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [todoMenuOpen, setTodoMenuOpen] = useState(false)

  // Get current todo state from session properties
  const currentTodoState = getSessionTodoState(item)

  const handleClick = (e: React.MouseEvent) => {
    // Cmd+Click (Mac) or Ctrl+Click (Windows/Linux) opens in new tab
    const forceNewTab = e.metaKey || e.ctrlKey
    onSelect(forceNewTab)
  }

  const handleTodoStateSelect = (state: TodoStateId) => {
    setTodoMenuOpen(false)
    onTodoStateChange(item.id, state)
  }

  return (
    <div
      className="session-item"
      data-selected={isSelected || undefined}
    >
      {/* Separator - only show if not first in group */}
      {!isFirstInGroup && (
        <div className="session-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for button + dropdown, group for hover state */}
      <div className="session-content relative group select-none pl-2 mr-2">
        {/* Todo State Icon - positioned absolutely, outside the button */}
        <Popover modal={true} open={todoMenuOpen} onOpenChange={setTodoMenuOpen}>
          <PopoverTrigger asChild>
            <div className="absolute left-4 top-3.5 z-10">
              <div
                className={cn(
                  "w-4 h-4 flex items-center justify-center rounded-full transition-colors cursor-pointer",
                  "hover:bg-foreground/5",
                  !isHexColor(getStateColor(currentTodoState, todoStates)) && (getStateColor(currentTodoState, todoStates) || 'text-muted-foreground')
                )}
                style={isHexColor(getStateColor(currentTodoState, todoStates)) ? { color: getStateColor(currentTodoState, todoStates) } : undefined}
                role="button"
                aria-haspopup="menu"
                aria-expanded={todoMenuOpen}
                aria-label="Change todo state"
              >
                <div className="w-4 h-4 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full [&>span]:text-base">
                  {getStateIcon(currentTodoState, todoStates)}
                </div>
              </div>
            </div>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-0 border-0 shadow-none bg-transparent"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <TodoStateMenu
              activeState={currentTodoState}
              onSelect={handleTodoStateSelect}
              states={todoStates}
            />
          </PopoverContent>
        </Popover>
        {/* Main content button */}
        <button
          {...itemProps}
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onClick={handleClick}
          onKeyDown={(e) => {
            itemProps.onKeyDown(e)
            onKeyDown(e, item)
          }}
        >
          {/* Spacer for todo icon */}
          <div className="w-4 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {/* Title - up to 2 lines */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {searchQuery ? highlightMatch(getSessionTitle(item), searchQuery) : getSessionTitle(item)}
              </div>
            </div>
            {/* Subtitle - with optional flag at start, single line with truncation */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
              {item.isProcessing && (
                <Spinner className="text-[8px] text-foreground shrink-0" />
              )}
              {!item.isProcessing && hasUnreadMessages(item) && (
                <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
              )}
              {item.isFlagged && (
                <Flag className="h-[10px] w-[10px] text-info fill-info shrink-0" />
              )}
              {permissionMode && (
                <span
                  className={cn(
                    "shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded",
                    permissionMode === 'allow-all' && "bg-accent/10 text-accent"
                  )}
                  style={permissionMode === 'allow-all' ? undefined : {
                    backgroundColor: `${PERMISSION_MODE_CONFIG[permissionMode].colors.primary}1A`, // 10% opacity
                    color: PERMISSION_MODE_CONFIG[permissionMode].colors.muted,
                  }}
                >
                  {PERMISSION_MODE_CONFIG[permissionMode].shortName}
                </span>
              )}
              <span className="truncate">
                {searchQuery && item.agentName ? highlightMatch(item.agentName, searchQuery) : item.agentName || (
                  !item.isProcessing && hasUnreadMessages(item) ? (
                    <>{countUnreadMessages(item)} new</>
                  ) : null
                )}
                {item.lastMessageAt && (
                  <>{item.agentName || hasUnreadMessages(item) ? ' · ' : ''}{formatDistanceToNow(new Date(item.lastMessageAt), { addSuffix: true })}</>
                )}
              </span>
            </div>
          </div>
        </button>
        {/* Action buttons - visible on hover or when menu is open */}
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          {/* More menu */}
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end">
              <StyledDropdownMenuItem onClick={onOpenInNewTab}>
                <ExternalLink />
                Open in new tab
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={() => window.electronAPI.showSessionInFinder(item.id)}>
                <FolderOpen />
                View in Finder
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <span
                    className={cn("shrink-0 flex items-center -mt-px", !isHexColor(getStateColor(currentTodoState, todoStates)) && (getStateColor(currentTodoState, todoStates) || 'text-muted-foreground'))}
                    style={isHexColor(getStateColor(currentTodoState, todoStates)) ? { color: getStateColor(currentTodoState, todoStates) } : undefined}
                  >
                    {getStateIcon(currentTodoState, todoStates)}
                  </span>
                  Status
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent>
                  {todoStates.map((state) => (
                    <StyledDropdownMenuItem
                      key={state.id}
                      onClick={() => onTodoStateChange(item.id, state.id)}
                      className={currentTodoState === state.id ? "bg-foreground/5" : ""}
                    >
                      <span
                        className={cn("shrink-0 flex items-center -mt-px", !isHexColor(state.color) && state.color)}
                        style={isHexColor(state.color) ? { color: state.color } : undefined}
                      >
                        {state.icon}
                      </span>
                      {state.label}
                    </StyledDropdownMenuItem>
                  ))}
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>
              {onFlag && !item.isFlagged && (
                <StyledDropdownMenuItem onClick={() => onFlag(item.id)}>
                  <Flag />
                  Flag
                </StyledDropdownMenuItem>
              )}
              {onUnflag && item.isFlagged && (
                <StyledDropdownMenuItem onClick={() => onUnflag(item.id)}>
                  <FlagOff />
                  Unflag
                </StyledDropdownMenuItem>
              )}
              {/* Mark as Unread - only show if session has been read */}
              {!hasUnreadMessages(item) && item.messages.length > 0 && (
                <StyledDropdownMenuItem onClick={() => onMarkUnread(item.id)}>
                  <MailOpen />
                  Mark as Unread
                </StyledDropdownMenuItem>
              )}
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem onClick={() => onRenameClick(item.id, getSessionTitle(item))}>
                <Pencil />
                Rename
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem onClick={() => onDelete(item.id)} variant="destructive">
                <Trash2 />
                Delete
              </StyledDropdownMenuItem>
            </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * DateHeader - Sticky section header showing date label (Today, Yesterday, Dec 19, etc.)
 */
function DateHeader({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 bg-background px-4 py-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  )
}

interface SessionListProps {
  items: Session[]
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onTodoStateChange: (sessionId: string, state: TodoStateId) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input */
  onFocusChatInput?: () => void
  /** Called when a session is selected (click or Cmd+click for new tab) */
  onSessionSelect?: (session: Session, options: { forceNewTab: boolean }) => void
  /** Called to navigate to a specific view (e.g., 'completed', 'inbox') */
  onNavigateToView?: (view: 'inbox' | 'completed' | 'flagged') => void
  /** Unified session options per session (real-time state) */
  sessionOptions?: Map<string, import('../../hooks/useSessionOptions').SessionOptions>
  /** Whether search mode is active */
  searchActive?: boolean
  /** Current search query */
  searchQuery?: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed */
  onSearchClose?: () => void
  /** Dynamic todo states from workspace config */
  todoStates?: TodoState[]
}

// Re-export TodoStateId for use by parent components
export type { TodoStateId }

/**
 * SessionList - Scrollable list of session cards with keyboard navigation
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate and select sessions (immediate selection)
 * - Enter: Focus chat input
 * - Delete/Backspace: Delete session
 * - C: Mark complete/incomplete
 * - R: Rename session
 */
export function SessionList({
  items,
  onDelete,
  onFlag,
  onUnflag,
  onMarkUnread,
  onTodoStateChange,
  onRename,
  onFocusChatInput,
  onSessionSelect,
  onNavigateToView,
  sessionOptions,
  searchActive,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  todoStates = [],
}: SessionListProps) {
  const [session, setSession] = useSession()
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search input when search becomes active (with delay to let dropdown close)
  useEffect(() => {
    if (searchActive) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [searchActive])

  // Sort by most recent activity first
  const sortedItems = [...items].sort((a, b) =>
    (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
  )

  // Filter items by search query
  const searchFilteredItems = useMemo(() => {
    if (!searchQuery.trim()) return sortedItems
    const query = searchQuery.toLowerCase()
    return sortedItems.filter(item => {
      const title = getSessionTitle(item).toLowerCase()
      const agentName = (item.agentName || '').toLowerCase()
      return title.includes(query) || agentName.includes(query)
    })
  }, [sortedItems, searchQuery])

  // Group sessions by date (use filtered items when searching)
  const dateGroups = useMemo(() => groupSessionsByDate(searchFilteredItems), [searchFilteredItems])

  // Create flat list for keyboard navigation (maintains order across groups)
  const flatItems = useMemo(() => {
    return dateGroups.flatMap(group => group.sessions)
  }, [dateGroups])

  // Create a lookup map for session ID -> flat index
  const sessionIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatItems.forEach((item, index) => map.set(item.id, index))
    return map
  }, [flatItems])

  // Find initial index based on selected session
  const selectedIndex = flatItems.findIndex(item => item.id === session.selected)

  // Focus zone management
  const { focusZone } = useFocusContext()

  // Register as focus zone
  const { zoneRef, isFocused } = useFocusZone({ zoneId: 'session-list' })

  // Handle session selection (immediate on arrow navigation)
  const handleActiveChange = useCallback((item: Session) => {
    setSession({ ...session, selected: item.id })
  }, [session, setSession])

  // Handle Enter to focus chat input
  const handleEnter = useCallback(() => {
    onFocusChatInput?.()
  }, [onFocusChatInput])

  const handleFlagWithToast = useCallback((sessionId: string) => {
    if (!onFlag) return
    onFlag(sessionId)
    toast('Conversation flagged', {
      description: 'Added to your flagged items',
      action: onUnflag ? {
        label: 'Undo',
        onClick: () => onUnflag(sessionId),
      } : undefined,
    })
  }, [onFlag, onUnflag])

  const handleUnflagWithToast = useCallback((sessionId: string) => {
    if (!onUnflag) return
    onUnflag(sessionId)
    toast('Flag removed', {
      description: 'Removed from flagged items',
      action: onFlag ? {
        label: 'Undo',
        onClick: () => onFlag(sessionId),
      } : undefined,
    })
  }, [onFlag, onUnflag])

  const handleDeleteWithToast = useCallback(async (sessionId: string): Promise<boolean> => {
    // Confirmation dialog is shown by handleDeleteSession in App.tsx
    // We await so toast only shows after successful deletion (if user confirmed)
    const deleted = await onDelete(sessionId)
    if (deleted) {
      toast('Conversation deleted')
    }
    return deleted
  }, [onDelete])

  // Handle Delete key
  const handleDelete = useCallback((item: Session) => {
    handleDeleteWithToast(item.id)
  }, [handleDeleteWithToast])

  // Roving tabindex for keyboard navigation
  const {
    activeIndex,
    setActiveIndex,
    getItemProps,
    focusActiveItem,
  } = useRovingTabIndex({
    items: flatItems,
    getId: (item, _index) => item.id,
    orientation: 'vertical',
    wrap: true,
    onActiveChange: handleActiveChange,
    onEnter: handleEnter,
    onDelete: handleDelete,
    initialIndex: selectedIndex >= 0 ? selectedIndex : 0,
    enabled: isFocused,
  })

  // Sync activeIndex when selection changes externally
  useEffect(() => {
    const newIndex = flatItems.findIndex(item => item.id === session.selected)
    if (newIndex >= 0 && newIndex !== activeIndex) {
      setActiveIndex(newIndex)
    }
  }, [session.selected, flatItems, activeIndex, setActiveIndex])

  // Focus active item when zone gains focus (but not while search input is active)
  useEffect(() => {
    if (isFocused && flatItems.length > 0 && !searchActive) {
      focusActiveItem()
    }
  }, [isFocused, focusActiveItem, flatItems.length, searchActive])

  // Handle single-key shortcuts when focused
  // Todo state shortcuts: T (todo), P (in-progress), V (needs-review), D (done), X (cancelled)
  // Other shortcuts: C (toggle complete), R (rename)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, item: Session) => {
    // Handle arrow keys for zone navigation (no modifiers required)
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusZone('sidebar')
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusZone('chat')
      return
    }

    // Only handle letter shortcuts when no modifiers
    if (e.metaKey || e.ctrlKey || e.altKey) return

    const key = e.key.toLowerCase()

    // Todo state shortcuts - dynamically built from todoStates
    const stateShortcuts: Record<string, TodoStateId> = {}
    todoStates.forEach(state => {
      if (state.shortcut) {
        stateShortcuts[state.shortcut.toLowerCase()] = state.id
      }
    })

    if (key in stateShortcuts) {
      e.preventDefault()
      onTodoStateChange(item.id, stateShortcuts[key])
      return
    }

    // Other shortcuts
    switch (key) {
      case 'c':
        e.preventDefault()
        // Toggle between done and todo
        const newState = item.todoState === 'done' || item.todoState === 'cancelled' ? 'todo' : 'done'
        onTodoStateChange(item.id, newState)
        break
      case 'r':
        e.preventDefault()
        handleRenameClick(item.id, getSessionTitle(item))
        break
    }
  }, [onTodoStateChange, focusZone, todoStates])

  const handleRenameClick = (sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    // Defer dialog open to next frame to let dropdown fully unmount first
    // This prevents race condition between dropdown's modal cleanup and dialog's modal setup
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }

  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRename(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameSessionId(null)
    setRenameName("")
  }

  // Handle search input key events
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onSearchClose?.()
    }
  }

  // Empty state - render outside ScrollArea to avoid scroll
  if (flatItems.length === 0 && !searchActive) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">
          No conversations yet
        </p>
      </div>
    )
  }

  return (
    <>
      <ScrollArea className="h-screen select-none" ref={scrollRef}>
        {/* Search input - shown when search is active */}
        {searchActive && (
          <div className="sticky top-0 z-20 bg-background px-2 py-2 border-b border-border/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search conversations..."
                className="w-full h-8 pl-8 pr-8 text-sm bg-foreground/5 border-0 rounded-[8px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
              />
              <button
                onClick={onSearchClose}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-foreground/10 rounded"
                title="Close search"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        )}
        <div
          ref={zoneRef}
          className="flex flex-col pb-14 min-w-0"
          data-focus-zone="session-list"
          role="listbox"
          aria-label="Sessions"
        >
          {/* No results message when searching */}
          {searchActive && searchQuery && flatItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <p className="text-sm text-muted-foreground">No conversations found</p>
              <button
                onClick={() => onSearchChange?.('')}
                className="text-xs text-foreground hover:underline mt-1"
              >
                Clear search
              </button>
            </div>
          )}
          {dateGroups.map((group) => (
            <div key={group.date.toISOString()}>
              {/* Date header */}
              <DateHeader label={group.label} />
              {/* Sessions in this date group */}
              {group.sessions.map((item, indexInGroup) => {
                const flatIndex = sessionIndexMap.get(item.id) ?? 0
                const itemProps = getItemProps(item, flatIndex)

                return (
                  <SessionItem
                    key={item.id}
                    item={item}
                    index={flatIndex}
                    itemProps={itemProps}
                    isSelected={session.selected === item.id}
                    isLast={flatIndex === flatItems.length - 1}
                    isFirstInGroup={indexInGroup === 0}
                    onKeyDown={handleKeyDown}
                    onRenameClick={handleRenameClick}
                    onTodoStateChange={onTodoStateChange}
                    onFlag={onFlag ? handleFlagWithToast : undefined}
                    onUnflag={onUnflag ? handleUnflagWithToast : undefined}
                    onMarkUnread={onMarkUnread}
                    onDelete={handleDeleteWithToast}
                    onSelect={(forceNewTab) => {
                      // Always update selection
                      setSession({ ...session, selected: item.id })
                      // Notify parent for tab handling
                      onSessionSelect?.(item, { forceNewTab })
                    }}
                    onOpenInNewTab={() => {
                      // Open in new tab without changing selection
                      onSessionSelect?.(item, { forceNewTab: true })
                    }}
                    permissionMode={sessionOptions?.get(item.id)?.permissionMode}
                    searchQuery={searchQuery}
                    todoStates={todoStates}
                  />
                )
              })}
          </div>
          ))}
        </div>
      </ScrollArea>

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title="Rename conversation"
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder="Enter a name..."
      />
    </>
  )
}

