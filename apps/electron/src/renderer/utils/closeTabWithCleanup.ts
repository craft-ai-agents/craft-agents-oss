/**
 * closeTabWithCleanup - Pure utility function for closing tabs
 *
 * Contains the cleanup logic for closing tabs with empty sessions.
 * This is a pure function (no React hooks) so it can be used:
 * - By useCloseTab hook (inside ChatProvider)
 * - By Chat.tsx (outside ChatProvider, passes props directly)
 *
 * Single source of truth for tab close cleanup behavior.
 */

import type { Tab, ChatTab } from '@/tabs'
import type { Session } from '../../shared/types'

export interface CloseTabParams {
  tabId: string
  tabs: Tab[]
  sessions: Session[]
  onDeleteSession: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  closeTab: (tabId: string) => void
}

/**
 * Close a tab with automatic cleanup for empty sessions.
 * If closing a chat tab with no messages, deletes the session entirely.
 * Empty sessions are deleted without confirmation (no valuable content to lose).
 */
export function closeTabWithCleanup(params: CloseTabParams): void {
  const { tabId, tabs, sessions, onDeleteSession, closeTab } = params

  const tab = tabs.find(t => t.id === tabId)
  if (tab?.type === 'chat') {
    const chatTab = tab as ChatTab
    const session = sessions.find(s => s.id === chatTab.sessionId)
    // If session has no messages, delete it entirely (skip confirmation for empty sessions)
    if (session && session.messages.length === 0) {
      onDeleteSession(session.id, true) // skipConfirmation = true
      // Note: onDeleteSession already closes the tab via closeChatTabBySession
      return
    }
  }
  // Otherwise just close the tab normally
  closeTab(tabId)
}
