/**
 * TabContent Component
 *
 * Container for tab content with lazy loading.
 * Keeps loaded tabs in memory for instant switching.
 * Only shows loading state for first-time tab loads.
 */

import * as React from 'react'
import { Suspense, lazy, useState, useEffect } from 'react'
import { Spinner } from '@/components/ui/loading-indicator'
import { cn } from '@/lib/utils'
import { useTabs } from './useTabs'
import type { Tab, TabType } from './types'

/**
 * Lazy-loaded panel components
 */
const ChatTabPanel = lazy(() => import('./panels/ChatTabPanel'))
const SettingsTabPanel = lazy(() => import('./panels/SettingsTabPanel'))
const ShortcutsTabPanel = lazy(() => import('./panels/ShortcutsTabPanel'))
const AgentInfoTabPanel = lazy(() => import('./panels/AgentInfoTabPanel'))
const AgentSetupTabPanel = lazy(() => import('./panels/AgentSetupTabPanel'))
const FileTabPanel = lazy(() => import('./panels/FileTabPanel'))
const BrowserTabPanel = lazy(() => import('./panels/BrowserTabPanel'))

/**
 * Map tab types to their panel components
 */
const TAB_PANELS: Record<TabType, React.LazyExoticComponent<React.ComponentType<{ tab: Tab }>>> = {
  chat: ChatTabPanel,
  settings: SettingsTabPanel,
  shortcuts: ShortcutsTabPanel,
  'agent-info': AgentInfoTabPanel,
  'agent-setup': AgentSetupTabPanel,
  file: FileTabPanel,
  browser: BrowserTabPanel,
}

interface TabContentProps {
  className?: string
}

export function TabContent({ className }: TabContentProps) {
  const { tabs, activeTab, activeTabId } = useTabs()

  // Track which tabs have been rendered (for keeping them in memory)
  const [renderedTabIds, setRenderedTabIds] = useState<Set<string>>(new Set())

  // Add active tab to rendered set
  useEffect(() => {
    if (activeTabId && !renderedTabIds.has(activeTabId)) {
      setRenderedTabIds(prev => new Set([...prev, activeTabId]))
    }
  }, [activeTabId, renderedTabIds])

  // Clean up rendered tabs that no longer exist
  useEffect(() => {
    const currentTabIds = new Set(tabs.map(t => t.id))
    setRenderedTabIds(prev => {
      const newSet = new Set<string>()
      prev.forEach(id => {
        if (currentTabIds.has(id)) {
          newSet.add(id)
        }
      })
      return newSet
    })
  }, [tabs])

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p className="text-sm">No tab selected</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Render all tabs that have been visited, hide inactive ones */}
      {tabs.filter(tab => renderedTabIds.has(tab.id)).map(tab => {
        const PanelComponent = TAB_PANELS[tab.type]
        const isActive = tab.id === activeTabId

        return (
          <div
            key={tab.id}
            className={cn(
              'h-full',
              isActive ? 'block' : 'hidden'
            )}
          >
            <Suspense fallback={<TabLoadingFallback />}>
              <PanelComponent tab={tab} />
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}

function TabLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <Spinner className="text-lg text-muted-foreground" />
    </div>
  )
}
