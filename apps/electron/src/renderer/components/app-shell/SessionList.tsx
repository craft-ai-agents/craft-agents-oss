import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { formatDistanceToNow, formatDistanceToNowStrict, isToday, isYesterday, format, startOfDay } from "date-fns"
import type { Locale } from "date-fns"
import { MoreHorizontal, Flag, Search, X, Copy, Link2Off, CloudUpload, Globe, RefreshCw, Inbox } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { rendererPerf } from "@/lib/perf"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { flattenLabels, extractLabelId } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import { useTheme } from "@/context/ThemeContext"
import { Spinner, Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TodoStateMenu } from "@/components/ui/todo-filter-menu"
import { getStateColor, getStateIcon, getStateLabel, type TodoStateId } from "@/config/todo-states"
import type { TodoState } from "@/config/todo-states"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from "@/components/ui/styled-context-menu"
import { DropdownMenuProvider, ContextMenuProvider } from "@/components/ui/menu-context"
import { SessionMenu } from "./SessionMenu"
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
import { useNavigation, useNavigationState, routes, isChatsNavigation } from "@/contexts/NavigationContext"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import type { SessionMeta } from "@/atoms/sessions"
import type { ViewConfig } from "@craft-agent/shared/views"
import { PERMISSION_MODE_CONFIG, type PermissionMode } from "@craft-agent/shared/agent/modes"

// Pagination constants
const INITIAL_DISPLAY_LIMIT = 20
const BATCH_SIZE = 20

/** Short relative time locale for date-fns formatDistanceToNowStrict.
 *  Produces compact strings: "7m", "2h", "3d", "2w", "5mo", "1y" */
const shortTimeLocale: Pick<Locale, 'formatDistance'> = {
  formatDistance: (token: string, count: number) => {
    const units: Record<string, string> = {
      xSeconds: `${count}s`,
      xMinutes: `${count}m`,
      xHours: `${count}h`,
      xDays: `${count}d`,
      xWeeks: `${count}w`,
      xMonths: `${count}mo`,
      xYears: `${count}y`,
    }
    return units[token] || `${count}`
  },
}

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
function groupSessionsByDate(sessions: SessionMeta[]): Array<{ date: Date; label: string; sessions: SessionMeta[] }> {
  const groups = new Map<string, { date: Date; sessions: SessionMeta[] }>()

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
function getSessionTodoState(session: SessionMeta): TodoStateId {
  // Read from session.todoState (user-controlled)
  // Falls back to 'todo' if not set
  return (session.todoState as TodoStateId) || 'todo'
}

/**
 * Check if a session has unread messages.
 * Uses the explicit hasUnread flag (state machine approach) as single source of truth.
 * This avoids race conditions from comparing two independently-updated IDs.
 */
function hasUnreadMessages(session: SessionMeta): boolean {
  return session.hasUnread === true
}

/**
 * Check if session has any messages (uses lastFinalMessageId as proxy)
 */
function hasMessages(session: SessionMeta): boolean {
  return session.lastFinalMessageId !== undefined
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
  item: SessionMeta
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
  onKeyDown: (e: React.KeyboardEvent, item: SessionMeta) => void
  onRenameClick: (sessionId: string, currentName: string) => void
  onTodoStateChange: (sessionId: string, state: TodoStateId) => void
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onSelect: () => void
  onOpenInNewWindow: () => void
  /** Current permission mode for this session (from real-time state) */
  permissionMode?: PermissionMode
  /** Current search query for highlighting matches */
  searchQuery?: string
  /** Dynamic todo states from workspace config */
  todoStates: TodoState[]
  /** Pre-flattened label configs for resolving session label IDs to display info */
  flatLabels: LabelConfig[]
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
  onOpenInNewWindow,
  permissionMode,
  searchQuery,
  todoStates,
  flatLabels,
}: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [todoMenuOpen, setTodoMenuOpen] = useState(false)

  // Get current todo state from session properties
  const currentTodoState = getSessionTodoState(item)

  // Resolve session label IDs (e.g. "bug", "priority::3") to their LabelConfig objects
  const resolvedLabels = useMemo(() => {
    if (!item.labels || item.labels.length === 0 || flatLabels.length === 0) return []
    return item.labels
      .map(entry => {
        const id = extractLabelId(entry)
        return flatLabels.find(l => l.id === id)
      })
      .filter((l): l is LabelConfig => l != null)
  }, [item.labels, flatLabels])


  // Theme context for resolving label colors (light/dark aware)
  const { isDark } = useTheme()

  const handleClick = () => {
    // Start perf tracking for session switch
    rendererPerf.startSessionSwitch(item.id)
    onSelect()
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
      {/* Wrapper for button + dropdown + context menu, group for hover state */}
      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="session-content relative group select-none pl-2 mr-2">
        {/* Todo State Icon - positioned absolutely, outside the button */}
        <Popover modal={true} open={todoMenuOpen} onOpenChange={setTodoMenuOpen}>
          <PopoverTrigger asChild>
            <div className="absolute left-4 top-3.5 z-10">
              <div
                className={cn(
                  "w-4 h-4 flex items-center justify-center rounded-full transition-colors cursor-pointer",
                  "hover:bg-foreground/5",
                )}
                style={{ color: getStateColor(currentTodoState, todoStates) ?? 'var(--foreground)' }}
                role="button"
                aria-haspopup="menu"
                aria-expanded={todoMenuOpen}
                aria-label="Change todo state"
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
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
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
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
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px]",
            // Fast hover transition (75ms vs default 150ms), selection is instant
            "transition-[background-color] duration-75",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onMouseDown={handleClick}
          onKeyDown={(e) => {
            itemProps.onKeyDown(e)
            onKeyDown(e, item)
          }}
        >
          {/* Spacer for todo icon */}
          <div className="w-4 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {/* Title - up to 2 lines, with shimmer during async operations (sharing, title regen, etc.) */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className={cn(
                "font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]",
                item.isAsyncOperationOngoing && "animate-shimmer-text"
              )}>
                {searchQuery ? highlightMatch(getSessionTitle(item), searchQuery) : getSessionTitle(item)}
              </div>
            </div>
            {/* Subtitle row — badges scroll horizontally when they overflow */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] min-w-0">
              {/* Fixed indicators (Spinner + New) — always visible */}
              {item.isProcessing && (
                <Spinner className="text-[8px] text-foreground shrink-0" />
              )}
              {!item.isProcessing && hasUnreadMessages(item) && (
                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent text-white">
                  New
                </span>
              )}

              {/* Scrollable badges container — horizontal scroll with hidden scrollbar,
                  right-edge gradient mask to hint at overflow */}
              <div
                className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide pr-4"
                style={{ maskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)' }}
              >
                {item.isFlagged && (
                  <span className="shrink-0 h-[18px] w-[18px] flex items-center justify-center rounded bg-foreground/5">
                    <Flag className="h-[10px] w-[10px] text-info fill-info" />
                  </span>
                )}
                {item.lastMessageRole === 'plan' && (
                  <span className="shrink-0 h-[18px] px-1.5 text-[10px] font-medium rounded bg-success/10 text-success flex items-center whitespace-nowrap">
                    Plan
                  </span>
                )}
                {permissionMode && (
                  <span
                    className={cn(
                      "shrink-0 h-[18px] px-1.5 text-[10px] font-medium rounded flex items-center whitespace-nowrap",
                      permissionMode === 'safe' && "bg-foreground/5 text-foreground/60",
                      permissionMode === 'ask' && "bg-info/10 text-info",
                      permissionMode === 'allow-all' && "bg-accent/10 text-accent"
                    )}
                  >
                    {PERMISSION_MODE_CONFIG[permissionMode].shortName}
                  </span>
                )}
                {/* Label badges — solid color via color-mix in sRGB */}
                {resolvedLabels.map(label => {
                  const color = label.color ? resolveEntityColor(label.color, isDark) : null
                  return (
                    <span
                      key={label.id}
                      className="shrink-0 h-[18px] px-1.5 text-[10px] font-medium rounded flex items-center whitespace-nowrap"
                      style={color ? {
                        backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)`,
                        color: `color-mix(in srgb, ${color} 80%, transparent)`,
                      } : {
                        backgroundColor: 'rgba(var(--foreground-rgb), 0.05)',
                        color: 'rgba(var(--foreground-rgb), 0.6)',
                      }}
                    >
                      {label.name}
                    </span>
                  )
                })}
                {item.sharedUrl && (
                  <DropdownMenu modal={true}>
                    <DropdownMenuTrigger asChild>
                      <span
                        className="shrink-0 h-[18px] w-[18px] flex items-center justify-center rounded bg-foreground/5 text-foreground/70 cursor-pointer hover:bg-foreground/10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <CloudUpload className="h-[10px] w-[10px]" />
                      </span>
                    </DropdownMenuTrigger>
                    <StyledDropdownMenuContent align="start">
                      <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(item.sharedUrl!)}>
                        <Globe />
                        Open in Browser
                      </StyledDropdownMenuItem>
                      <StyledDropdownMenuItem onClick={async () => {
                        await navigator.clipboard.writeText(item.sharedUrl!)
                        toast.success('Link copied to clipboard')
                      }}>
                        <Copy />
                        Copy Link
                      </StyledDropdownMenuItem>
                      <StyledDropdownMenuItem onClick={async () => {
                        const result = await window.electronAPI.sessionCommand(item.id, { type: 'updateShare' })
                        if (result?.success) {
                          toast.success('Share updated')
                        } else {
                          toast.error('Failed to update share', { description: result?.error })
                        }
                      }}>
                        <RefreshCw />
                        Update Share
                      </StyledDropdownMenuItem>
                      <StyledDropdownMenuSeparator />
                      <StyledDropdownMenuItem onClick={async () => {
                        const result = await window.electronAPI.sessionCommand(item.id, { type: 'revokeShare' })
                        if (result?.success) {
                          toast.success('Sharing stopped')
                        } else {
                          toast.error('Failed to stop sharing', { description: result?.error })
                        }
                      }} variant="destructive">
                        <Link2Off />
                        Stop Sharing
                      </StyledDropdownMenuItem>
                    </StyledDropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {/* Timestamp — outside stacking container so it never overlaps badges.
                  shrink-0 keeps it fixed-width; the badges container clips instead. */}
              {item.lastMessageAt && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0 text-[11px] text-foreground/40 whitespace-nowrap cursor-default">
                      {formatDistanceToNowStrict(new Date(item.lastMessageAt), { locale: shortTimeLocale as Locale })}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    {formatDistanceToNow(new Date(item.lastMessageAt), { addSuffix: true })}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </button>
        {/* Action buttons - visible on hover or when menu is open */}
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen || contextMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
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
                <DropdownMenuProvider>
                  <SessionMenu
                    sessionId={item.id}
                    sessionName={getSessionTitle(item)}
                    isFlagged={item.isFlagged ?? false}
                    sharedUrl={item.sharedUrl}
                    hasMessages={hasMessages(item)}
                    hasUnreadMessages={hasUnreadMessages(item)}
                    currentTodoState={currentTodoState}
                    todoStates={todoStates}
                    onRename={() => onRenameClick(item.id, getSessionTitle(item))}
                    onFlag={() => onFlag?.(item.id)}
                    onUnflag={() => onUnflag?.(item.id)}
                    onMarkUnread={() => onMarkUnread(item.id)}
                    onTodoStateChange={(state) => onTodoStateChange(item.id, state)}
                    onOpenInNewWindow={onOpenInNewWindow}
                    onDelete={() => onDelete(item.id)}
                  />
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
          </div>
        </ContextMenuTrigger>
        {/* Context menu - same content as dropdown */}
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <SessionMenu
              sessionId={item.id}
              sessionName={getSessionTitle(item)}
              isFlagged={item.isFlagged ?? false}
              sharedUrl={item.sharedUrl}
              hasMessages={hasMessages(item)}
              hasUnreadMessages={hasUnreadMessages(item)}
              currentTodoState={currentTodoState}
              todoStates={todoStates}
              onRename={() => onRenameClick(item.id, getSessionTitle(item))}
              onFlag={() => onFlag?.(item.id)}
              onUnflag={() => onUnflag?.(item.id)}
              onMarkUnread={() => onMarkUnread(item.id)}
              onTodoStateChange={(state) => onTodoStateChange(item.id, state)}
              onOpenInNewWindow={onOpenInNewWindow}
              onDelete={() => onDelete(item.id)}
            />
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
    </div>
  )
}

/**
 * DateHeader - Simple date group header rendered inline with content.
 * No sticky behavior - just scrolls with the list.
 */
function DateHeader({ label }: { label: string }) {
  return (
    <div className="px-4 py-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  )
}

interface SessionListProps {
  items: SessionMeta[]
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onTodoStateChange: (sessionId: string, state: TodoStateId) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input */
  onFocusChatInput?: () => void
  /** Called when a session is selected */
  onSessionSelect?: (session: SessionMeta) => void
  /** Called when user wants to open a session in a new window */
  onOpenInNewWindow?: (session: SessionMeta) => void
  /** Called to navigate to a specific view (e.g., 'allChats', 'flagged') */
  onNavigateToView?: (view: 'allChats' | 'flagged') => void
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
  /** View evaluator — evaluates a session and returns matching view configs */
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  /** Label configs for resolving session label IDs to display info */
  labels?: LabelConfig[]
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
  onOpenInNewWindow,
  onNavigateToView,
  sessionOptions,
  searchActive,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  todoStates = [],
  evaluateViews,
  labels = [],
}: SessionListProps) {
  const [session] = useSession()
  const { navigate } = useNavigation()
  const navState = useNavigationState()

  // Pre-flatten label tree once for efficient ID lookups in each SessionItem
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  // Get current filter from navigation state (for preserving context in tab routes)
  const currentFilter = isChatsNavigation(navState) ? navState.filter : undefined

  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

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
      return title.includes(query)
    })
  }, [sortedItems, searchQuery])

  // Reset display limit when search query changes
  useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
  }, [searchQuery])

  // Paginate items - only show up to displayLimit
  const paginatedItems = useMemo(() => {
    return searchFilteredItems.slice(0, displayLimit)
  }, [searchFilteredItems, displayLimit])

  // Check if there are more items to load
  const hasMore = displayLimit < searchFilteredItems.length

  // Load more items callback
  const loadMore = useCallback(() => {
    setDisplayLimit(prev => Math.min(prev + BATCH_SIZE, searchFilteredItems.length))
  }, [searchFilteredItems.length])

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '100px' }  // Trigger slightly before reaching bottom
    )

    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  // Group sessions by date (use paginated items)
  const dateGroups = useMemo(() => groupSessionsByDate(paginatedItems), [paginatedItems])

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
  const handleActiveChange = useCallback((item: SessionMeta) => {
    // Navigate using view routes to preserve filter context
    if (!currentFilter || currentFilter.kind === 'allChats') {
      navigate(routes.view.allChats(item.id))
    } else if (currentFilter.kind === 'flagged') {
      navigate(routes.view.flagged(item.id))
    } else if (currentFilter.kind === 'state') {
      navigate(routes.view.state(currentFilter.stateId, item.id))
    }
  }, [navigate, currentFilter])

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

  // Arrow key shortcuts for zone navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, _item: SessionMeta) => {
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
  }, [focusZone])

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
    // Stop propagation to prevent roving tabindex from intercepting keys (e.g. Backspace as Delete)
    e.stopPropagation()

    if (e.key === 'Escape') {
      e.preventDefault()
      onSearchClose?.()
    }
  }

  // Empty state - render outside ScrollArea for proper vertical centering
  if (flatItems.length === 0 && !searchActive) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>No conversations yet</EmptyTitle>
          <EmptyDescription>
            Conversations with your agent appear here. Start one to get going.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <button
            onClick={() => onFocusChatInput?.()}
            className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
          >
            New Conversation
          </button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      {/* ScrollArea with mask-fade-top-short - shorter fade to avoid header overlap */}
      <ScrollArea className="h-screen select-none mask-fade-top-short">
        {/* Search input - sticky at top */}
        {searchActive && (
          <div className="sticky top-0 z-sticky px-2 py-2 border-b border-border/50">
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
              {/* Date header - scrolls with content */}
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
                    onSelect={() => {
                      // Navigate to session with filter context (updates URL and selection)
                      if (!currentFilter || currentFilter.kind === 'allChats') {
                        navigate(routes.view.allChats(item.id))
                      } else if (currentFilter.kind === 'flagged') {
                        navigate(routes.view.flagged(item.id))
                      } else if (currentFilter.kind === 'state') {
                        navigate(routes.view.state(currentFilter.stateId, item.id))
                      }
                      // Notify parent
                      onSessionSelect?.(item)
                    }}
                    onOpenInNewWindow={() => onOpenInNewWindow?.(item)}
                    permissionMode={sessionOptions?.get(item.id)?.permissionMode}
                    searchQuery={searchQuery}
                    todoStates={todoStates}
                    flatLabels={flatLabels}
                  />
                )
              })}
          </div>
          ))}
          {/* Load more sentinel - triggers infinite scroll */}
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <Spinner className="text-muted-foreground" />
            </div>
          )}
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

