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
} from '@/contexts/NavigationContext'
import { AppSettingsPage, AppearanceSettingsPage, InputSettingsPage, WorkspaceSettingsPage, PermissionsSettingsPage, LabelsSettingsPage, PreferencesPage, ShortcutsPage, SourceInfoPage, ChatPage } from '@/pages'
import SkillInfoPage from '@/pages/SkillInfoPage'

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
      case 'appearance':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AppearanceSettingsPage />
          </Panel>
        )
      case 'input':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <InputSettingsPage />
          </Panel>
        )
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
      case 'labels':
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <LabelsSettingsPage />
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
    if (navState.details?.type === 'skill') {
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
