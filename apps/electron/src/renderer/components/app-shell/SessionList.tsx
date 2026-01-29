import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { formatDistanceToNow, formatDistanceToNowStrict, isToday, isYesterday, format, startOfDay } from "date-fns"
import type { Locale } from "date-fns"
import { MoreHorizontal, Flag, Search, X, Copy, Link2Off, CloudUpload, Globe, RefreshCw, Inbox, ChevronUp, ChevronDown } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { rendererPerf } from "@/lib/perf"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { flattenLabels, parseLabelEntry, formatLabelEntry, formatDisplayValue } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import { useTheme } from "@/context/ThemeContext"
import { Spinner, Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TodoStateMenu } from "@/components/ui/todo-filter-menu"
import { LabelValuePopover } from "@/components/ui/label-value-popover"
import { LabelValueTypeIcon } from "@/components/ui/label-icon"
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
      <span className="px-1 py-0.5 bg-yellow-300/30 rounded-[4px]">{match}</span>
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
  /** Full label tree (for labels submenu in SessionMenu) */
  labels: LabelConfig[]
  /** Callback when session labels are toggled */
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  /** Content match info (from full-text search) - if set, shows snippet below title */
  contentMatch?: { matchCount: number; snippet: string }
  /** Number of matches in ChatDisplay (only set when session is selected and loaded) */
  chatMatchCount?: number
  /** Current match index in ChatDisplay (0-based) */
  chatMatchIndex?: number
  /** Navigate to previous match in ChatDisplay */
  onNavigatePrev?: () => void
  /** Navigate to next match in ChatDisplay */
  onNavigateNext?: () => void
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
  labels,
  onLabelsChange,
  contentMatch,
  chatMatchCount,
  chatMatchIndex,
  onNavigatePrev,
  onNavigateNext,
}: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [todoMenuOpen, setTodoMenuOpen] = useState(false)
  // Tracks which label badge's LabelValuePopover is open (by index), null = all closed
  const [openLabelIndex, setOpenLabelIndex] = useState<number | null>(null)

  // Get current todo state from session properties
  const currentTodoState = getSessionTodoState(item)

  // Resolve session label entries (e.g. "bug", "priority::3") to config + optional value
  const resolvedLabels = useMemo(() => {
    if (!item.labels || item.labels.length === 0 || flatLabels.length === 0) return []
    return item.labels
      .map(entry => {
        const parsed = parseLabelEntry(entry)
        const config = flatLabels.find(l => l.id === parsed.id)
        if (!config) return null
        return { config, rawValue: parsed.rawValue }
      })
      .filter((l): l is { config: LabelConfig; rawValue: string | undefined } => l != null)
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
      data-session-id={item.id}
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
                {/* Label badges — each badge opens its own LabelValuePopover for
                    editing the value or removing the label. Uses onMouseDown +
                    stopPropagation to prevent parent <button> session selection. */}
                {resolvedLabels.map(({ config: label, rawValue }, labelIndex) => {
                  const color = label.color ? resolveEntityColor(label.color, isDark) : null
                  const displayValue = rawValue ? formatDisplayValue(rawValue, label.valueType) : undefined
                  return (
                    <LabelValuePopover
                      key={label.id}
                      label={label}
                      value={rawValue}
                      open={openLabelIndex === labelIndex}
                      onOpenChange={(open) => setOpenLabelIndex(open ? labelIndex : null)}
                      onValueChange={(newValue) => {
                        // Rebuild labels array with the updated value for this label
                        const updatedLabels = (item.labels || []).map(entry => {
                          const parsed = parseLabelEntry(entry)
                          if (parsed.id === label.id) {
                            return formatLabelEntry(label.id, newValue)
                          }
                          return entry
                        })
                        onLabelsChange?.(item.id, updatedLabels)
                      }}
                      onRemove={() => {
                        // Remove this label entry from the session
                        const updatedLabels = (item.labels || []).filter(entry => {
                          const parsed = parseLabelEntry(entry)
                          return parsed.id !== label.id
                        })
                        onLabelsChange?.(item.id, updatedLabels)
                      }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        className="shrink-0 h-[18px] max-w-[120px] px-1.5 text-[10px] font-medium rounded flex items-center whitespace-nowrap gap-0.5 cursor-pointer"
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                        }}
                        style={color ? {
                          backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)`,
                          color: `color-mix(in srgb, ${color} 75%, var(--foreground))`,
                        } : {
                          backgroundColor: 'rgba(var(--foreground-rgb), 0.05)',
                          color: 'rgba(var(--foreground-rgb), 0.8)',
                        }}
                      >
                        {label.name}
                        {/* Interpunct + value for typed labels, or placeholder icon if typed but no value set */}
                        {displayValue ? (
                          <>
                            <span style={{ opacity: 0.4 }}>·</span>
                            <span className="font-normal truncate min-w-0" style={{ opacity: 0.75 }}>
                              {displayValue}
                            </span>
                          </>
                        ) : (
                          label.valueType && (
                            <>
                              <span style={{ opacity: 0.4 }}>·</span>
                              <LabelValueTypeIcon valueType={label.valueType} size={10} />
                            </>
                          )
                        )}
                      </div>
                    </LabelValuePopover>
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
                  shrink-0 keeps it fixed-width; the badges container clips instead.
                  Hidden when in search mode with matches for selected session. */}
              {item.lastMessageAt && !(isSelected && searchQuery && chatMatchCount && chatMatchCount > 0) && (
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
            {/* Content match snippet - shown when found in conversation content (at bottom) */}
            {contentMatch && contentMatch.snippet && (
              <div className="flex items-center gap-1.5 text-xs text-foreground/50 w-full min-w-0 pl-2 pr-1.5 mt-1.5 mb-1 h-8 border border-border rounded-md">
                  <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} style={{ color: 'color-mix(in oklch, var(--foreground) 60%, transparent)' }} />
                  <span className="truncate flex-1 min-w-0">
                    {searchQuery ? highlightMatch(contentMatch.snippet, searchQuery) : contentMatch.snippet}
                  </span>
                  {/* Match navigation chevrons - inline on right when selected with matches */}
                  {isSelected && chatMatchCount != null && chatMatchCount > 0 && (
                    <div className="flex items-center shrink-0 gap-0.5 ml-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onNavigatePrev?.() }}
                        className={cn(
                          "p-0.5 rounded transition-colors",
                          (chatMatchIndex ?? 0) <= 0
                            ? "opacity-30 cursor-default"
                            : "hover:bg-foreground/5"
                        )}
                        disabled={(chatMatchIndex ?? 0) <= 0}
                        title="Previous match"
                      >
                        <ChevronUp className="size-4 text-muted-foreground" strokeWidth={1.5} />
                      </button>
                      <span className="text-[9px] text-muted-foreground tabular-nums leading-tight">
                        {(chatMatchIndex ?? 0) + 1}/{chatMatchCount ?? 0}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onNavigateNext?.() }}
                        className={cn(
                          "p-0.5 rounded transition-colors",
                          (chatMatchIndex ?? 0) >= (chatMatchCount ?? 1) - 1
                            ? "opacity-30 cursor-default"
                            : "hover:bg-foreground/5"
                        )}
                        disabled={(chatMatchIndex ?? 0) >= (chatMatchCount ?? 1) - 1}
                        title="Next match"
                      >
                        <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.5} />
                      </button>
                    </div>
                  )}
              </div>
            )}
          </div>
        </button>

        {/* Action buttons - visible on hover or when menu is open, hidden in search mode with matches */}
        {!(isSelected && searchQuery && chatMatchCount && chatMatchCount > 0) && (
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10 flex items-center gap-1",
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
                    sessionLabels={item.labels ?? []}
                    labels={labels}
                    onLabelsChange={onLabelsChange ? (newLabels) => onLabelsChange(item.id, newLabels) : undefined}
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
        )}
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
              sessionLabels={item.labels ?? []}
              labels={labels}
              onLabelsChange={onLabelsChange ? (newLabels) => onLabelsChange(item.id, newLabels) : undefined}
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
  /** Callback when session labels are toggled (for labels submenu in SessionMenu) */
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  /** Workspace ID for content search (optional - if not provided, content search is disabled) */
  workspaceId?: string
  /** Ref to ChatDisplay for navigation between matches */
  chatDisplayRef?: React.RefObject<import('./ChatDisplay').ChatDisplayHandle>
  /** Match count from ChatDisplay (used for navigation UI) */
  chatMatchCount?: number
  /** Current match index from ChatDisplay (0-based) */
  chatMatchIndex?: number
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
  onLabelsChange,
  workspaceId,
  chatDisplayRef,
  chatMatchCount,
  chatMatchIndex,
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

  // Content search state (full-text search via ripgrep)
  const [contentSearchResults, setContentSearchResults] = useState<Map<string, { matchCount: number; snippet: string }>>(new Map())
  const [isSearchingContent, setIsSearchingContent] = useState(false)
  // Track if search input has actual DOM focus (for proper keyboard navigation gating)
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false)

  // Debounced content search - triggers when search query changes and length >= 2
  useEffect(() => {
    if (!workspaceId || !searchActive || searchQuery.length < 2) {
      setContentSearchResults(new Map())
      return
    }

    setIsSearchingContent(true)
    const timer = setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchSessionContent(workspaceId, searchQuery)
        const resultMap = new Map<string, { matchCount: number; snippet: string }>()
        for (const result of results) {
          resultMap.set(result.sessionId, {
            matchCount: result.matchCount,
            snippet: result.matches[0]?.snippet || '',
          })
        }
        setContentSearchResults(resultMap)
      } catch (error) {
        console.error('[SessionList] Content search error:', error)
        setContentSearchResults(new Map())
      } finally {
        setIsSearchingContent(false)
      }
    }, 300) // Debounce 300ms

    return () => {
      clearTimeout(timer)
      setIsSearchingContent(false)
    }
  }, [workspaceId, searchActive, searchQuery])

  // Focus search input when search becomes active
  useEffect(() => {
    if (searchActive) {
      searchInputRef.current?.focus()
    }
  }, [searchActive])

  // Sort by most recent activity first
  const sortedItems = [...items].sort((a, b) =>
    (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
  )

  // Filter items by search query — matches title, label names, label values, and content.
  // '#' characters are stripped when matching labels (so "#bug" finds label "bug").
  // A bare '#' matches all sessions that have any labels.
  // Content matches (from ripgrep search) are included and shown with snippets.
  const searchFilteredItems = useMemo(() => {
    if (!searchQuery.trim()) return sortedItems
    const query = searchQuery.toLowerCase()
    const labelQuery = query.replace(/#/g, '')

    // Check if a session matches by title or labels (quick local match)
    const matchesTitleOrLabels = (item: SessionMeta): boolean => {
      if (getSessionTitle(item).toLowerCase().includes(query)) return true
      // Bare '#' (no text after stripping) matches any session with labels
      if (!labelQuery && item.labels && item.labels.length > 0) return true
      // Match against label names and values (with # stripped)
      if (labelQuery && item.labels?.some(entry => {
        const parsed = parseLabelEntry(entry)
        const config = flatLabels.find(l => l.id === parsed.id)
        if (config?.name.toLowerCase().includes(labelQuery)) return true
        if (parsed.rawValue?.toLowerCase().includes(labelQuery)) return true
        return false
      })) return true
      return false
    }

    // Split into title/label matches and content-only matches
    const titleMatches: SessionMeta[] = []
    const contentOnlyMatches: SessionMeta[] = []

    for (const item of sortedItems) {
      const hasTitleMatch = matchesTitleOrLabels(item)
      const hasContentMatch = contentSearchResults.has(item.id)

      if (hasTitleMatch) {
        titleMatches.push(item)
      } else if (hasContentMatch) {
        contentOnlyMatches.push(item)
      }
    }

    // Return title matches first, then content-only matches
    // Content-only matches are sorted by match count (descending)
    contentOnlyMatches.sort((a, b) => {
      const countA = contentSearchResults.get(a.id)?.matchCount || 0
      const countB = contentSearchResults.get(b.id)?.matchCount || 0
      return countB - countA
    })

    return [...titleMatches, ...contentOnlyMatches]
  }, [sortedItems, searchQuery, flatLabels, contentSearchResults])

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
    // Scroll the selected item into view
    requestAnimationFrame(() => {
      const element = document.querySelector(`[data-session-id="${item.id}"]`)
      element?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    })
  }, [navigate, currentFilter])

  // NOTE: We intentionally do NOT auto-select sessions while typing in search.
  // Auto-selecting causes: 1) ChatDisplay to scroll, 2) focus loss from search input
  // Selection only changes via: arrow key navigation or explicit click

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
  // During search: enabled but moveFocus=false so focus stays on search input
  const rovingEnabled = isFocused || (searchActive && isSearchInputFocused)

  const {
    activeIndex,
    setActiveIndex,
    getItemProps,
    getContainerProps,
    focusActiveItem,
  } = useRovingTabIndex({
    items: flatItems,
    getId: (item, _index) => item.id,
    orientation: 'vertical',
    wrap: true,
    onActiveChange: handleActiveChange,
    onEnter: handleEnter,
    initialIndex: selectedIndex >= 0 ? selectedIndex : 0,
    enabled: rovingEnabled,
    moveFocus: !searchActive, // Keep focus on search input during search
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

  // Handle search input key events (Arrow keys handled by native listener above)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onSearchClose?.()
      return
    }

    // Enter: Focus the chat input (same as pressing Enter on a selected session)
    if (e.key === 'Enter') {
      e.preventDefault()
      onFocusChatInput?.()
      return
    }

    // Forward arrow keys to roving tabindex (search input is outside the container)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      getContainerProps().onKeyDown(e)
      return
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
            onClick={() => {
              // Create a new session, applying the current filter's status/label if applicable
              const params: { status?: string; label?: string } = {}
              if (currentFilter?.kind === 'state') params.status = currentFilter.stateId
              else if (currentFilter?.kind === 'label') params.label = currentFilter.labelId
              navigate(routes.action.newChat(Object.keys(params).length > 0 ? params : undefined))
            }}
            className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
          >
            New Conversation
          </button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Search input - OUTSIDE ScrollArea to prevent arrow key capture */}
      {searchActive && (
        <div className="shrink-0 px-2 py-2 border-b border-border/50">
          {/* Elevated input wrapper with shadow-minimal for consistent styling with filter inputs */}
          <div className="relative rounded-[8px] shadow-minimal bg-muted/50 has-[:focus-visible]:bg-background">
            {/* Show spinner while searching content, otherwise show search icon */}
            {isSearchingContent ? (
              <Spinner className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground" />
            ) : (
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setIsSearchInputFocused(true)}
              onBlur={() => setIsSearchInputFocused(false)}
              placeholder="Search titles and content..."
              className="w-full h-8 pl-8 pr-8 text-sm bg-transparent border-0 rounded-[8px] outline-none focus-visible:ring-0 focus-visible:outline-none placeholder:text-muted-foreground/50"
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
      {/* ScrollArea with mask-fade-top-short - shorter fade to avoid header overlap */}
      <ScrollArea className="flex-1 select-none mask-fade-top-short">
        <div
          ref={zoneRef}
          className="flex flex-col pb-14 min-w-0"
          data-focus-zone="session-list"
          role="listbox"
          aria-label="Sessions"
        >
          {/* No results message when searching */}
          {searchActive && searchQuery && flatItems.length === 0 && !isSearchingContent && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <p className="text-sm text-muted-foreground">No conversations found</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Searched titles and message content
              </p>
              <button
                onClick={() => onSearchChange?.('')}
                className="text-xs text-foreground hover:underline mt-2"
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
                    labels={labels}
                    onLabelsChange={onLabelsChange}
                    contentMatch={contentSearchResults.get(item.id)}
                    chatMatchCount={session.selected === item.id ? chatMatchCount : undefined}
                    chatMatchIndex={session.selected === item.id ? chatMatchIndex : undefined}
                    onNavigatePrev={session.selected === item.id ? () => chatDisplayRef?.current?.goToPrevMatch() : undefined}
                    onNavigateNext={session.selected === item.id ? () => chatDisplayRef?.current?.goToNextMatch() : undefined}
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
    </div>
  )
}

