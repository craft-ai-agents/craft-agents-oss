/**
 * TabBar Component
 *
 * Horizontal tab bar with close buttons.
 * Auto-hides when only one tab is open.
 * macOS-style: full width, equal tab widths, min-width with scroll.
 *
 * Features:
 * - Spinner indicator for tabs with active processing
 * - Unread badge for tabs with new messages
 * - Right-click context menu with "Move to New Window" option
 */

import * as React from 'react'
import { X, AppWindow } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabs } from './useTabs'
import type { ChatTab, Tab, AgentInfoTab, FileTab, BrowserTab, SourceInfoTab } from './types'
import { FadingText } from '@/components/ui/fading-text'
import { useChatContext } from '@/context/ChatContext'
import { getSessionTitle, hasUnreadMessages, countUnreadMessages } from '@/utils/session'
import { Spinner } from '@craft-agent/ui'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'

const MIN_TAB_WIDTH = 120
const MAX_TAB_WIDTH = 200

interface TabBarProps {
  className?: string
  /**
   * Optional callback to override default close behavior.
   * If provided, this is called instead of closeTab.
   * Use this to add cleanup logic (e.g., deleting empty sessions).
   */
  onClose?: (tabId: string) => void
}

export function TabBar({ className, onClose }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab, closeTab, isTabBarVisible } = useTabs()
  const { sessions, activeWorkspaceId } = useChatContext()

  // Handle "Move to New Window" action
  const handleMoveToNewWindow = React.useCallback((tab: Tab) => {
    if (!activeWorkspaceId) return

    // Build tab params based on tab type
    const tabParams: Record<string, string> = {}

    switch (tab.type) {
      case 'chat': {
        const chatTab = tab as ChatTab
        tabParams.sessionId = chatTab.sessionId
        if (chatTab.agentId) tabParams.agentId = chatTab.agentId
        break
      }
      case 'agent-info': {
        const agentTab = tab as AgentInfoTab
        tabParams.agentId = agentTab.agentId
        break
      }
      case 'file': {
        const fileTab = tab as FileTab
        tabParams.path = fileTab.path
        break
      }
      case 'browser': {
        const browserTab = tab as BrowserTab
        tabParams.url = browserTab.url
        break
      }
      case 'source-info': {
        const sourceTab = tab as SourceInfoTab
        tabParams.sourceSlug = sourceTab.sourceSlug
        if (sourceTab.agentSlug) tabParams.agentSlug = sourceTab.agentSlug
        break
      }
      // settings, shortcuts, preferences don't need extra params
    }

    // Open in new window
    window.electronAPI.openTabContentWindow({
      workspaceId: activeWorkspaceId,
      tabType: tab.type,
      tabParams,
    })

    // Close the tab in the current window
    closeTab(tab.id)
  }, [activeWorkspaceId, closeTab])

  // Get tab label - for chat tabs, look up session title dynamically
  const getTabLabel = React.useCallback((tab: Tab): string => {
    if (tab.type === 'chat') {
      const session = sessions.find(s => s.id === (tab as ChatTab).sessionId)
      return session ? getSessionTitle(session) : tab.label
    }
    return tab.label
  }, [sessions])

  // Get session state for chat tabs (processing status, unread count)
  const getSessionState = React.useCallback((tab: Tab): { isProcessing: boolean; unreadCount: number } | null => {
    if (tab.type !== 'chat') return null
    const session = sessions.find(s => s.id === (tab as ChatTab).sessionId)
    if (!session) return null
    return {
      isProcessing: session.isProcessing,
      unreadCount: hasUnreadMessages(session) ? countUnreadMessages(session) : 0
    }
  }, [sessions])

  // Use custom onClose if provided, otherwise use default closeTab
  const handleClose = onClose ?? closeTab
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)

  // Measure container width
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      setContainerWidth(container.getBoundingClientRect().width)
    }

    // Measure immediately
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [tabs.length]) // Re-measure when tab count changes

  // Scroll active tab into view when it changes
  React.useEffect(() => {
    if (!activeTabId) return
    const activeElement = document.querySelector(`[data-tab-id="${activeTabId}"]`)
    activeElement?.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' })
  }, [activeTabId])

  // Auto-hide when single tab
  if (!isTabBarVisible) {
    return null
  }

  // Calculate tab width: divide equally, but respect min/max
  const equalWidth = containerWidth / tabs.length
  const tabWidth = Math.max(MIN_TAB_WIDTH, Math.min(MAX_TAB_WIDTH, equalWidth))
  const needsScroll = tabWidth * tabs.length > containerWidth

  // Find active tab index for separator logic
  const activeIndex = tabs.findIndex(t => t.id === activeTabId)

  return (
    <div
      ref={containerRef}
      className={cn('h-[32px] shrink-0 bg-foreground/5 mx-2 mb-2 p-[1px] rounded-full overflow-x-auto scrollbar-hide', className)}
    >
      <div
        className="flex items-stretch h-[30px]"
        style={{ width: needsScroll ? 'max-content' : '100%' }}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const isLast = index === tabs.length - 1
          // Hide separator after this tab if:
          // - This tab or next tab is active
          // - This tab or next tab is hovered
          const hideSeparator = isActive ||
            index + 1 === activeIndex ||
            hoveredIndex === index ||
            hoveredIndex === index + 1
          const sessionState = getSessionState(tab)

          return (
            <TabItem
              key={tab.id}
              tab={tab}
              label={getTabLabel(tab)}
              isActive={isActive}
              isLast={isLast}
              hideSeparator={hideSeparator}
              isHovered={hoveredIndex === index}
              onActivate={() => setActiveTab(tab.id)}
              onClose={() => handleClose(tab.id)}
              onMoveToNewWindow={() => handleMoveToNewWindow(tab)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              width={needsScroll ? MIN_TAB_WIDTH : undefined}
              isProcessing={sessionState?.isProcessing}
              unreadCount={sessionState?.unreadCount}
            />
          )
        })}
      </div>
    </div>
  )
}

interface TabItemProps {
  tab: Tab
  label: string
  isActive: boolean
  isLast: boolean
  hideSeparator: boolean
  isHovered: boolean
  onActivate: () => void
  onClose: () => void
  onMoveToNewWindow: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  width?: number
  /** Whether the session is currently processing (shows spinner) */
  isProcessing?: boolean
  /** Number of unread messages (shows badge when > 0 and not active) */
  unreadCount?: number
}

function TabItem({ tab, label, isActive, isLast, hideSeparator, isHovered, onActivate, onClose, onMoveToNewWindow, onMouseEnter, onMouseLeave, width, isProcessing, unreadCount }: TabItemProps) {
  // Show spinner when processing (even on active tab), but not when hovered
  const showSpinner = !isHovered && isProcessing
  // Show unread badge only when tab is not active, not hovered, not processing, and has unread messages
  const showUnreadBadge = !isActive && !isHovered && !isProcessing && unreadCount && unreadCount > 0
  // Show close button when hovered and closable
  const showCloseButton = isHovered && tab.closable

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          data-tab-id={tab.id}
          onMouseDown={onActivate}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={cn(
            'relative flex items-center gap-1 px-2 text-[12px] font-medium select-none outline-none',
            'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring rounded-full',
            !width && 'flex-1 min-w-0',
            isActive
              ? 'bg-background text-foreground border border-foreground/10'
              : 'text-muted-foreground hover:text-foreground/80 hover:bg-background/50 border border-transparent'
          )}
          style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
        >
          {/* Left slot: Fixed width container for Close/Spinner/Badge */}
          {tab.closable && (
            <span className="w-5 h-5 -ml-1 flex items-center justify-center shrink-0">
              {showCloseButton ? (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      onClose()
                    }
                  }}
                  className="p-0.5 rounded-full hover:bg-foreground/7"
                >
                  <X className="h-3 w-3" />
                </span>
              ) : showSpinner ? (
                <Spinner className="text-[8px] text-accent" />
              ) : showUnreadBadge ? (
                <span className="flex items-center justify-center w-2 h-2 rounded-full bg-accent text-[6px] font-semibold text-accent-foreground">
                  {unreadCount > 9 ? '+' : unreadCount}
                </span>
              ) : null}
            </span>
          )}
          {/* Tab label - centered */}
          <FadingText className="flex-1 text-center min-w-0">{label}</FadingText>
          {/* Dirty indicator */}
          {tab.dirty && !showSpinner && !showUnreadBadge && (
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 shrink-0" />
          )}
          {/* Spacer to balance left slot for centering */}
          {tab.closable && (
            <span className="w-5 shrink-0" />
          )}
          {/* Separator line (after tab, except last) */}
          {!isLast && (
            <span
              className={cn(
                'absolute right-0 top-1/2 -translate-y-1/2 w-px h-3',
                hideSeparator ? 'bg-transparent' : 'bg-foreground/10'
              )}
            />
          )}
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={onMoveToNewWindow}>
          <AppWindow className="h-4 w-4" />
          Move to New Window
        </StyledContextMenuItem>
        {tab.closable && (
          <>
            <StyledContextMenuSeparator />
            <StyledContextMenuItem onClick={onClose}>
              <X className="h-4 w-4" />
              Close Tab
            </StyledContextMenuItem>
          </>
        )}
      </StyledContextMenuContent>
    </ContextMenu>
  )
}
