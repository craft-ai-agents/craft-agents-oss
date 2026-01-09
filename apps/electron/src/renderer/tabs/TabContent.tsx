/**
 * TabContent Component
 *
 * Container for tab content with lazy loading.
 * Keeps loaded tabs in memory for instant switching.
 * Only shows loading state for first-time tab loads.
 */

import * as React from 'react'
import { Suspense, lazy, Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { rendererPerf } from '@/lib/perf'
import { useTabs } from './useTabs'
import type { Tab, TabType, ChatTab } from './types'
// Eagerly loaded - chat tabs are the most common, needs instant switching
import ChatTabPanel from './panels/ChatTabPanel'

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
 * Lazy-loaded panel components (less common, ok to have initial load delay)
 */
const SettingsTabPanel = lazy(() => import('./panels/SettingsTabPanel'))
const ShortcutsTabPanel = lazy(() => import('./panels/ShortcutsTabPanel'))
const AgentInfoTabPanel = lazy(() => import('./panels/AgentInfoTabPanel'))
const FileTabPanel = lazy(() => import('./panels/FileTabPanel'))
const BrowserTabPanel = lazy(() => import('./panels/BrowserTabPanel'))
const PreferencesTabPanel = lazy(() => import('./panels/PreferencesTabPanel'))
const SourceInfoTabPanel = lazy(() => import('./panels/SourceInfoTabPanel'))

/**
 * Map tab types to their panel components (excludes chat - handled separately)
 */
const TAB_PANELS: Partial<Record<TabType, React.LazyExoticComponent<React.ComponentType<{ tab: Tab }>>>> = {
  settings: SettingsTabPanel,
  shortcuts: ShortcutsTabPanel,
  'agent-info': AgentInfoTabPanel,
  file: FileTabPanel,
  browser: BrowserTabPanel,
  preferences: PreferencesTabPanel,
  'source-info': SourceInfoTabPanel,
}

interface TabContentProps {
  className?: string
}

export function TabContent({ className }: TabContentProps) {
  const { tabs, activeTab, activeTabId, closeTab } = useTabs()

  // Track which session IDs have been rendered (for chat tabs - keeps panels alive across tab switches)
  // Use ref to persist across renders without causing re-renders
  const renderedSessionIdsRef = React.useRef<Set<string>>(new Set())

  // Track which non-chat tab IDs have been rendered
  const renderedTabIdsRef = React.useRef<Set<string>>(new Set())

  // Synchronously update rendered sets
  // This is critical for instant tab switching - must happen before render, not in useEffect
  const currentTabIds = new Set(tabs.map(t => t.id))

  // Get all current session IDs from chat tabs
  const chatTabs = tabs.filter((t): t is ChatTab => t.type === 'chat')
  const currentSessionIds = new Set(chatTabs.map(t => t.sessionId))

  // Get active session ID if current tab is a chat tab
  const activeSessionId = activeTab?.type === 'chat' ? (activeTab as ChatTab).sessionId : null

  // Add active session to rendered set (synchronous, before render)
  if (activeSessionId && !renderedSessionIdsRef.current.has(activeSessionId)) {
    renderedSessionIdsRef.current = new Set([...renderedSessionIdsRef.current, activeSessionId])
    // Diagnostic: mark when panel is about to render for first time
    rendererPerf.markSessionSwitch(activeSessionId, 'tab-content.will-render')
  }

  // Add active non-chat tab to rendered set
  if (activeTabId && activeTab?.type !== 'chat' && !renderedTabIdsRef.current.has(activeTabId)) {
    renderedTabIdsRef.current = new Set([...renderedTabIdsRef.current, activeTabId])
  }

  // Clean up sessions that are no longer in any tab (synchronous)
  for (const sessionId of renderedSessionIdsRef.current) {
    if (!currentSessionIds.has(sessionId)) {
      renderedSessionIdsRef.current = new Set([...renderedSessionIdsRef.current].filter(x => x !== sessionId))
    }
  }

  // Clean up non-chat tabs that no longer exist (synchronous)
  for (const id of renderedTabIdsRef.current) {
    if (!currentTabIds.has(id)) {
      renderedTabIdsRef.current = new Set([...renderedTabIdsRef.current].filter(x => x !== id))
    }
  }

  // Copy to local variables for render
  const renderedSessionIds = renderedSessionIdsRef.current
  const renderedTabIds = renderedTabIdsRef.current

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground pt-[50px]">
        <p className="text-sm">No tab selected</p>
      </div>
    )
  }

  // Get the current chat tab (if any) for rendering chat panels
  const activeChatTab = activeTab?.type === 'chat' ? (activeTab as ChatTab) : null

  // Build list of session panels to render (keyed by sessionId for stability)
  // Each session that's been visited gets its own panel that stays mounted
  const sessionPanelsToRender = Array.from(renderedSessionIds)
    .filter(sessionId => currentSessionIds.has(sessionId))
    .map(sessionId => {
      // Find the chat tab for this session to get its full data
      const chatTab = chatTabs.find(t => t.sessionId === sessionId)
      return chatTab
    })
    .filter((tab): tab is ChatTab => tab !== undefined)

  // Get non-chat tabs to render
  const nonChatTabs = tabs.filter(tab => tab.type !== 'chat')
  const nonChatTabsToRender = nonChatTabs.filter(tab =>
    renderedTabIds.has(tab.id) && currentTabIds.has(tab.id)
  )

  return (
    <div className={cn('relative', className)}>
      {/* Render chat session panels - keyed by sessionId for stability */}
      {/* This keeps panels mounted when switching between sessions */}
      {sessionPanelsToRender.map(chatTab => {
        const isActive = activeSessionId === chatTab.sessionId

        return (
          <div
            key={`session:${chatTab.sessionId}`}
            className={cn(
              'h-full',
              !isActive && 'invisible absolute inset-0 -z-10'
            )}
          >
            <TabErrorBoundary tabId={chatTab.id} onClose={() => closeTab(chatTab.id)}>
              <Suspense fallback={<TabLoadingFallback />}>
                <ChatTabPanel tab={chatTab} />
              </Suspense>
            </TabErrorBoundary>
          </div>
        )
      })}

      {/* Render non-chat tabs - keyed by tab.id */}
      {nonChatTabsToRender.map(tab => {
        const PanelComponent = TAB_PANELS[tab.type]
        if (!PanelComponent) return null
        const isActive = tab.id === activeTabId

        return (
          <div
            key={tab.id}
            className={cn(
              'h-full',
              !isActive && 'invisible absolute inset-0 -z-10'
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
