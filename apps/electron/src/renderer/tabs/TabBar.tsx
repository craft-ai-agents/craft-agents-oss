/**
 * TabBar Component
 *
 * Horizontal tab bar with close buttons.
 * Auto-hides when only one tab is open.
 * macOS-style: full width, equal tab widths, min-width with scroll.
 */

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabs } from './useTabs'
import type { ChatTab, Tab } from './types'
import { FadingText } from '@/components/ui/fading-text'
import { useChatContext } from '@/context/ChatContext'
import { getSessionTitle } from '@/utils/session'

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
  const { sessions } = useChatContext()

  // Get tab label - for chat tabs, look up session title dynamically
  const getTabLabel = React.useCallback((tab: Tab): string => {
    if (tab.type === 'chat') {
      const session = sessions.find(s => s.id === (tab as ChatTab).sessionId)
      return session ? getSessionTitle(session) : tab.label
    }
    return tab.label
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
      data-tab-bar
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

          return (
            <TabItem
              key={tab.id}
              tab={tab}
              label={getTabLabel(tab)}
              isActive={isActive}
              isLast={isLast}
              hideSeparator={hideSeparator}
              onActivate={() => setActiveTab(tab.id)}
              onClose={() => handleClose(tab.id)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              width={needsScroll ? MIN_TAB_WIDTH : undefined}
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
  onActivate: () => void
  onClose: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  width?: number
}

function TabItem({ tab, label, isActive, isLast, hideSeparator, onActivate, onClose, onMouseEnter, onMouseLeave, width }: TabItemProps) {
  return (
    <button
      data-tab-id={tab.id}
      onClick={onActivate}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'group relative flex items-center gap-1 px-2 text-[12px] font-medium select-none outline-none',
        'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring rounded-full',
        !width && 'flex-1 min-w-0',
        isActive
          ? 'bg-background text-foreground border border-foreground/10'
          : 'text-muted-foreground hover:text-foreground/80 hover:bg-background/50 border border-transparent'
      )}
      style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
    >
      {/* Close button on the left */}
      {tab.closable && (
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
          className={cn(
            'p-1 -ml-1 rounded-full hover:bg-foreground/7',
            'opacity-0 group-hover:opacity-75 focus:opacity-50'
          )}
        >
          <X className="h-3 w-3" />
        </span>
      )}
      {/* Tab label - centered */}
      <FadingText className="flex-1 text-center min-w-0">{label}</FadingText>
      {/* Dirty indicator */}
      {tab.dirty && (
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 shrink-0" />
      )}
      {/* Spacer to balance close button for centering */}
      {tab.closable && (
        <span className="w-4 shrink-0" />
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
  )
}
