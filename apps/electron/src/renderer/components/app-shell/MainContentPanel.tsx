/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 */

import * as React from 'react'
import { Panel } from './Panel'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  useNavigationState,
  isChatsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
} from '@/contexts/NavigationContext'
import { SettingsPage, PreferencesPage, ShortcutsPage, SourceInfoPage, ChatPage } from '@/pages'

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

  // Settings navigator - always has content (subpage determines which page)
  if (isSettingsNavigation(navState)) {
    switch (navState.subpage) {
      case 'shortcuts':
        return (
          <Panel variant="grow" className={className}>
            <ShortcutsPage />
          </Panel>
        )
      case 'preferences':
        return (
          <Panel variant="grow" className={className}>
            <PreferencesPage />
          </Panel>
        )
      case 'general':
      default:
        return (
          <Panel variant="grow" className={className}>
            <SettingsPage />
          </Panel>
        )
    }
  }

  // Sources navigator - show source info or empty state
  if (isSourcesNavigation(navState)) {
    if (navState.details) {
      return (
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={navState.details.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No source selected - empty state
    return (
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">No sources configured</p>
        </div>
      </Panel>
    )
  }

  // Chats navigator - show chat or empty state
  if (isChatsNavigation(navState)) {
    if (navState.details) {
      return (
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} isFocusedMode={isFocusedMode} />
        </Panel>
      )
    }
    // No session selected - empty state
    return (
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
  return (
    <Panel variant="grow" className={className}>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Select a conversation to get started</p>
      </div>
    </Panel>
  )
}
