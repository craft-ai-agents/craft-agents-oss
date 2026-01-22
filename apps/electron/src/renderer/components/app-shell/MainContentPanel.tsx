/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * In focused mode (single window), wraps content with StoplightProvider
 * so PanelHeader components automatically compensate for macOS traffic lights.
 */

import * as React from 'react'
import { Panel } from './Panel'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  useNavigationState,
  isChatsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isVectorSearchNavigation,
  isSchedulesNavigation,
} from '@/contexts/NavigationContext'
import { AppSettingsPage, WorkspaceSettingsPage, PermissionsSettingsPage, PreferencesPage, ShortcutsPage, SourceInfoPage, ChatPage, DocumentViewerPage } from '@/pages'
import SkillInfoPage from '@/pages/SkillInfoPage'
import { ScheduleDetailPanel } from '@/components/scheduler/ScheduleDetailPanel'

export interface MainContentPanelProps {
  /** Whether the app is in focused mode (single chat, no sidebar) */
  isFocusedMode?: boolean
  /** Optional className for the container */
  className?: string
}

export function MainContentPanel({
  isFocusedMode = false,
  className,
}: MainContentPanelProps) {
  const navState = useNavigationState()
  const { activeWorkspaceId } = useAppShellContext()

  // Wrap content with StoplightProvider so PanelHeaders auto-compensate in focused mode
  const wrapWithStoplight = (content: React.ReactNode) => (
    <StoplightProvider value={isFocusedMode}>
      {content}
    </StoplightProvider>
  )

  // Settings navigator - always has content (subpage determines which page)
  if (isSettingsNavigation(navState)) {
    switch (navState.subpage) {
      case 'workspace':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <WorkspaceSettingsPage />
          </Panel>
        )
      case 'permissions':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <PermissionsSettingsPage />
          </Panel>
        )
      case 'shortcuts':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <ShortcutsPage />
          </Panel>
        )
      case 'preferences':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <PreferencesPage />
          </Panel>
        )
      case 'app':
      default:
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AppSettingsPage />
          </Panel>
        )
    }
  }

  // Sources navigator - show source info or empty state
  if (isSourcesNavigation(navState)) {
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={navState.details.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No source selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">No sources configured</p>
        </div>
      </Panel>
    )
  }

  // Skills navigator - show skill info or empty state
  if (isSkillsNavigation(navState)) {
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No skill selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">No skills configured</p>
        </div>
      </Panel>
    )
  }

  // Vector Search navigator - show document content or empty state
  if (isVectorSearchNavigation(navState)) {
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <DocumentViewerPage filePath={navState.details.filePath} />
        </Panel>
      )
    }
    // No document selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">Select a search result to view the document</p>
        </div>
      </Panel>
    )
  }

  // Schedules navigator - show schedule detail panel or empty state
  if (isSchedulesNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <ScheduleDetailPanelWrapper
          scheduleId={navState.details?.scheduleId || null}
          workspaceId={activeWorkspaceId || ''}
        />
      </Panel>
    )
  }

  // Chats navigator - show chat or empty state
  if (isChatsNavigation(navState)) {
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
        </Panel>
      )
    }
    // No session selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">
            {navState.filter.kind === 'flagged'
              ? 'No flagged conversations'
              : 'No conversations yet'}
          </p>
        </div>
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Select a conversation to get started</p>
      </div>
    </Panel>
  )
}

/**
 * Wrapper component that fetches schedule data and passes it to ScheduleDetailPanel
 */
interface ScheduleDetailPanelWrapperProps {
  scheduleId: string | null
  workspaceId: string
}

function ScheduleDetailPanelWrapper({ scheduleId, workspaceId }: ScheduleDetailPanelWrapperProps) {
  const [schedules, setSchedules] = React.useState<import('../../../shared/types').Schedule[]>([])

  React.useEffect(() => {
    if (!workspaceId) return
    window.electronAPI.scheduleList(workspaceId).then(setSchedules)
  }, [workspaceId])

  // Listen for schedule events to refresh the list
  React.useEffect(() => {
    if (!workspaceId) return
    const cleanup = window.electronAPI.onScheduleEvent(() => {
      window.electronAPI.scheduleList(workspaceId).then(setSchedules)
    })
    return cleanup
  }, [workspaceId])

  const selectedSchedule = schedules.find(s => s.id === scheduleId) || null

  const handleUpdate = async (id: string, updates: { prompt: string }) => {
    const updated = await window.electronAPI.scheduleUpdate(workspaceId, id, updates)
    if (updated) {
      setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s))
    }
  }

  const handleRunNow = async (id: string) => {
    await window.electronAPI.scheduleRunNow(workspaceId, id)
  }

  return (
    <ScheduleDetailPanel
      schedule={selectedSchedule}
      onUpdate={handleUpdate}
      onRunNow={handleRunNow}
    />
  )
}
