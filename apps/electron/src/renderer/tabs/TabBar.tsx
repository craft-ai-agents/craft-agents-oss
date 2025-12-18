/**
 * TabBar Component
 *
 * Horizontal tab bar with close buttons.
 * Auto-hides when only one tab is open.
 * Safari-style minimal design.
 */

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useTabs } from './useTabs'
import type { Tab } from './types'

interface TabBarProps {
  className?: string
}

export function TabBar({ className }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab, closeTab, isTabBarVisible } = useTabs()
  const scrollAreaRef = React.useRef<HTMLDivElement>(null)

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

  return (
    <div className={cn('h-[28px] bg-muted/50 flex items-stretch shrink-0', className)}>
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        <div className="flex items-stretch h-[28px]">
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onActivate={() => setActiveTab(tab.id)}
              onClose={() => closeTab(tab.id)}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="h-1" />
      </ScrollArea>
    </div>
  )
}

interface TabItemProps {
  tab: Tab
  isActive: boolean
  onActivate: () => void
  onClose: () => void
}

function TabItem({ tab, isActive, onActivate, onClose }: TabItemProps) {
  return (
    <div
      data-tab-id={tab.id}
      className="flex items-stretch"
    >
      <button
        onClick={onActivate}
        className={cn(
          'group flex items-center gap-2 px-3 text-[11px] font-medium select-none outline-none',
          'min-w-[80px] max-w-[180px]',
          'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
          isActive
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:text-foreground/80'
        )}
      >
        <span className="truncate flex-1 text-left">{tab.label}</span>
        {tab.dirty && (
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 shrink-0" />
        )}
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
              'p-0.5 rounded hover:bg-foreground/10',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              'transition-opacity'
            )}
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>
    </div>
  )
}
