import { useState, useCallback, useEffect, useRef } from "react"
import { formatDistanceToNow } from "date-fns"
import { Archive, ArchiveRestore, Trash2, Pencil, MoreHorizontal, ExternalLink, Flag, FlagOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useSession } from "@/hooks/useSession"
import { useFocusZone, useRovingTabIndex } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import { getSessionPreview } from "@/utils/preview"
import type { Session } from "../../../shared/types"

interface SessionItemProps {
  item: Session
  index: number
  preview: string
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
  onKeyDown: (e: React.KeyboardEvent, item: Session) => void
  onRenameClick: (sessionId: string, currentName: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onSelect: (forceNewTab: boolean) => void
  onOpenInNewTab: () => void
}

/**
 * SessionItem - Individual session card with dropdown menu
 * Tracks menu open state to keep "..." button visible
 */
function SessionItem({
  item,
  index,
  preview,
  itemProps,
  isSelected,
  isLast,
  onKeyDown,
  onRenameClick,
  onArchive,
  onUnarchive,
  onFlag,
  onUnflag,
  onDelete,
  onSelect,
  onOpenInNewTab,
}: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const handleClick = (e: React.MouseEvent) => {
    // Cmd+Click (Mac) or Ctrl+Click (Windows/Linux) opens in new tab
    const forceNewTab = e.metaKey || e.ctrlKey
    onSelect(forceNewTab)
  }

  return (
    <div className="session-item" data-selected={isSelected || undefined}>
      {index > 0 && (
        <div className="session-separator pl-8 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for button + dropdown, group for hover state */}
      <div className="session-content relative group select-none pl-2 mr-2">
        <button
          {...itemProps}
          className={cn(
            "flex w-full flex-col items-start gap-1.5 pl-7 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2",
            "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          )}
          onClick={handleClick}
          onKeyDown={(e) => {
            itemProps.onKeyDown(e)
            onKeyDown(e, item)
          }}
        >
          {/* Flag - positioned in left margin */}
          {item.isFlagged && (
            <Flag className="absolute left-[16px] top-[15px] h-[12px] w-[12px] text-amber-500 fill-amber-500" />
          )}
          {/* Title */}
          <div className="flex items-center gap-2 w-full pr-6 min-w-0">
            {item.isProcessing && (
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
            )}
            <div className="font-semibold font-sans truncate min-w-0 -mb-[2px]">
              {getSessionTitle(item)}
            </div>
          </div>
          {/* Subtitle */}
          <div className="flex items-center gap-2 text-xs text-foreground/70 w-full -mb-[2px] pr-6">
            <span>
              {item.agentName || (
                <>{item.messages.length} message{item.messages.length !== 1 ? 's' : ''}</>
              )}
              {item.lastMessageAt && (
                <> · {formatDistanceToNow(new Date(item.lastMessageAt), { addSuffix: true })}</>
              )}
            </span>
          </div>
          {/* Preview Text */}
          <div className="line-clamp-2 text-xs text-muted-foreground leading-relaxed w-full">
            {preview}
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
            <DropdownMenu onOpenChange={setMenuOpen}>
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
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem onClick={() => onRenameClick(item.id, getSessionTitle(item))}>
                <Pencil />
                Rename
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
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
              {onArchive && (
                <StyledDropdownMenuItem onClick={() => onArchive(item.id)}>
                  <Archive />
                  Archive
                </StyledDropdownMenuItem>
              )}
              {onUnarchive && (
                <StyledDropdownMenuItem onClick={() => onUnarchive(item.id)}>
                  <ArchiveRestore />
                  Unarchive
                </StyledDropdownMenuItem>
              )}
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

interface SessionListProps {
  items: Session[]
  onDelete: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input */
  onFocusChatInput?: () => void
  /** Called when a session is selected (click or Cmd+click for new tab) */
  onSessionSelect?: (session: Session, options: { forceNewTab: boolean }) => void
}

/**
 * SessionList - Scrollable list of session cards with keyboard navigation
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate and select sessions (immediate selection)
 * - Enter: Focus chat input
 * - Delete/Backspace: Delete session
 * - A: Archive session
 * - R: Rename session
 */
export function SessionList({
  items,
  onDelete,
  onArchive,
  onUnarchive,
  onFlag,
  onUnflag,
  onRename,
  onFocusChatInput,
  onSessionSelect,
}: SessionListProps) {
  const [session, setSession] = useSession()
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  // Sort by most recent activity first
  const sortedItems = [...items].sort((a, b) =>
    (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
  )

  // Find initial index based on selected session
  const selectedIndex = sortedItems.findIndex(item => item.id === session.selected)

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

  // Handle Delete key
  const handleDelete = useCallback((item: Session) => {
    onDelete(item.id)
  }, [onDelete])

  // Roving tabindex for keyboard navigation
  const {
    activeIndex,
    setActiveIndex,
    getItemProps,
    focusActiveItem,
  } = useRovingTabIndex({
    items: sortedItems,
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
    const newIndex = sortedItems.findIndex(item => item.id === session.selected)
    if (newIndex >= 0 && newIndex !== activeIndex) {
      setActiveIndex(newIndex)
    }
  }, [session.selected, sortedItems, activeIndex, setActiveIndex])

  // Focus active item when zone gains focus
  useEffect(() => {
    if (isFocused && sortedItems.length > 0) {
      focusActiveItem()
    }
  }, [isFocused, focusActiveItem, sortedItems.length])

  // Handle single-key shortcuts (A, R, Left/Right) when focused
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

    switch (e.key.toLowerCase()) {
      case 'a':
        e.preventDefault()
        if (onArchive) {
          onArchive(item.id)
        } else if (onUnarchive) {
          onUnarchive(item.id)
        }
        break
      case 'r':
        e.preventDefault()
        handleRenameClick(item.id, getSessionTitle(item))
        break
    }
  }, [onArchive, onUnarchive, focusZone])

  const handleRenameClick = (sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    setRenameDialogOpen(true)
  }

  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRename(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameSessionId(null)
    setRenameName("")
  }

  // Empty state - render outside ScrollArea to avoid scroll
  if (sortedItems.length === 0) {
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
        <div
          ref={zoneRef}
          className="flex flex-col pb-14 min-w-0 pt-2"
          data-focus-zone="session-list"
          data-session-list
          role="listbox"
          aria-label="Sessions"
        >
          {sortedItems.map((item, index) => {
            const preview = getSessionPreview(item.messages)
            const itemProps = getItemProps(item, index)

            return (
              <SessionItem
                key={item.id}
                item={item}
                index={index}
                preview={preview}
                itemProps={itemProps}
                isSelected={session.selected === item.id}
                isLast={index === sortedItems.length - 1}
                onKeyDown={handleKeyDown}
                onRenameClick={handleRenameClick}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                onFlag={onFlag}
                onUnflag={onUnflag}
                onDelete={onDelete}
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
              />
            )
          })}
        </div>
      </ScrollArea>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder="Enter a name..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameSubmit()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
