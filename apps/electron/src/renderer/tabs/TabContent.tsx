/**
 * TabContent Component
 *
 * Container for tab content with lazy loading.
 * Keeps loaded tabs in memory for instant switching.
 * Only shows loading state for first-time tab loads.
 */

import * as React from 'react'
import { Suspense, lazy, useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Spinner } from '@/components/ui/loading-indicator'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTabs } from './useTabs'
import type { Tab, TabType } from './types'

/**
 * Error boundary to catch and display errors in tab panels
 */
interface ErrorBoundaryProps {
  children: ReactNode
  tabId: string
  onClose: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

class TabErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TabContent] Error in tab panel:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium">Something went wrong</p>
          <p className="text-xs text-center max-w-md text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.props.onClose()}
          >
            Close Tab
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

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
const PreferencesTabPanel = lazy(() => import('./panels/PreferencesTabPanel'))

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
  preferences: PreferencesTabPanel,
}

interface TabContentProps {
  className?: string
}

export function TabContent({ className }: TabContentProps) {
  const { tabs, activeTab, activeTabId, closeTab } = useTabs()

  // Track which tabs have been rendered (for keeping them in memory)
  const [renderedTabIds, setRenderedTabIds] = useState<Set<string>>(new Set())

  // Synchronously update rendered tabs when tabs change
  // This is critical to prevent rendering deleted tabs
  const currentTabIds = new Set(tabs.map(t => t.id))

  // Add active tab to rendered set
  useEffect(() => {
    if (activeTabId && !renderedTabIds.has(activeTabId)) {
      setRenderedTabIds(prev => new Set([...prev, activeTabId]))
    }
  }, [activeTabId, renderedTabIds])

  // Clean up rendered tabs that no longer exist
  useEffect(() => {
    setRenderedTabIds(prev => {
      const newSet = new Set<string>()
      prev.forEach(id => {
        if (currentTabIds.has(id)) {
          newSet.add(id)
        }
      })
      return newSet
    })
  }, [tabs]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground pt-[50px]">
        <p className="text-sm">No tab selected</p>
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      {/* Render all tabs that have been visited, hide inactive ones */}
      {/* Use currentTabIds for extra safety - ensures we never render deleted tabs */}
      {tabs.filter(tab => renderedTabIds.has(tab.id) && currentTabIds.has(tab.id)).map(tab => {
        const PanelComponent = TAB_PANELS[tab.type]
        if (!PanelComponent) return null // Guard against missing panel types
        const isActive = tab.id === activeTabId

        return (
          <div
            key={tab.id}
            className={cn(
              'h-full',
              !isActive && 'invisible absolute inset-0'
            )}
          >
            <TabErrorBoundary tabId={tab.id} onClose={() => closeTab(tab.id)}>
              <Suspense fallback={<TabLoadingFallback />}>
                <PanelComponent tab={tab} />
              </Suspense>
            </TabErrorBoundary>
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
