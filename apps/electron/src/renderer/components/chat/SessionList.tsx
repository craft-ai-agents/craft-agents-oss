import { useState, useCallback, useEffect, useRef } from "react"
import { formatDistanceToNow } from "date-fns"
import { Archive, ArchiveRestore, Trash2, Bot, Pencil, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
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
  onDelete: (sessionId: string) => void
  onSelect: (forceNewTab: boolean) => void
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
  onDelete,
  onSelect,
}: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const handleClick = (e: React.MouseEvent) => {
    // Cmd+Click (Mac) or Ctrl+Click (Windows/Linux) opens in new tab
    const forceNewTab = e.metaKey || e.ctrlKey
    onSelect(forceNewTab)
  }

  return (
    <div>
      {index > 0 && <Separator />}
      <button
        {...itemProps}
        className={cn(
          "group flex w-full flex-col items-start gap-2 pl-5 pr-4 py-3 text-left text-sm transition-all hover:bg-foreground/5 relative outline-none",
          isSelected && "bg-muted",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        )}
        onClick={handleClick}
        onKeyDown={(e) => {
          itemProps.onKeyDown(e)
          onKeyDown(e, item)
        }}
      >
        {/* Card Header Row */}
        <div className="flex w-full flex-col gap-0.5 pr-6">
          <div className="flex items-center gap-2">
            <div className="font-semibold font-sans truncate">
              {getSessionTitle(item)}
            </div>
            {item.isProcessing && (
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <span>
              {item.messages.length} message{item.messages.length !== 1 ? 's' : ''}
              {item.lastMessageAt && (
                <> · {formatDistanceToNow(new Date(item.lastMessageAt), { addSuffix: true })}</>
              )}
            </span>
            {item.agentName && (
              <span className="flex items-center gap-1 ml-auto">
                <Bot className="h-3 w-3" />
                {item.agentName}
              </span>
            )}
          </div>
        </div>
        {/* Preview Text */}
        <div className="line-clamp-2 text-xs text-muted-foreground">
          {preview}
        </div>
        {/* Processing Badge */}
        {item.isProcessing && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Processing</Badge>
          </div>
        )}
        {/* More menu dropdown - visible on hover or when menu is open */}
        <DropdownMenu onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <div
              className={cn(
                "absolute right-2 top-3 transition-opacity",
                menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-1 rounded hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end">
            <StyledDropdownMenuItem onClick={() => onRenameClick(item.id, getSessionTitle(item))}>
              <Pencil />
              Rename
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
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
      </button>
      {isLast && <Separator />}
    </div>
  )
}

interface SessionListProps {
  items: Session[]
  onDelete: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
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

  return (
    <ScrollArea className="h-screen" ref={scrollRef}>
      <div
        ref={zoneRef}
        className="flex flex-col pb-14"
        data-focus-zone="session-list"
        role="listbox"
        aria-label="Sessions"
      >
        {sortedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No conversations yet
          </p>
        ) : (
          sortedItems.map((item, index) => {
            const lastMessage = item.messages[item.messages.length - 1]
            const preview = lastMessage?.content?.slice(0, 300) || 'New conversation'
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
                onDelete={onDelete}
                onSelect={(forceNewTab) => {
                  // Always update selection
                  setSession({ ...session, selected: item.id })
                  // Notify parent for tab handling
                  onSessionSelect?.(item, { forceNewTab })
                }}
              />
            )
          })
        )}
      </div>

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
    </ScrollArea>
  )
}
