/**
 * useCloseTab Hook
 *
 * Provides a closeTab function that automatically cleans up empty sessions.
 * Use this instead of useTabs().closeTab to ensure empty chat sessions are deleted.
 */

import { useCallback } from 'react'
import { useTabs } from '@/tabs'
import { useChatContext } from '@/context/ChatContext'
import { closeTabWithCleanup as closeTabWithCleanupFn } from '@/utils/closeTabWithCleanup'

/**
 * Returns a closeTab function that:
 * - Deletes empty chat sessions (sessions with no messages)
 * - Just closes the tab for non-empty sessions or non-chat tabs
 */
export function useCloseTab() {
  const { tabs, closeTab, activeTab } = useTabs()
  const { sessions, onDeleteSession } = useChatContext()

  const closeTabWithCleanup = useCallback((tabId: string) => {
    closeTabWithCleanupFn({
      tabId,
      tabs,
      sessions,
      onDeleteSession,
      closeTab,
    })
  }, [tabs, sessions, onDeleteSession, closeTab])

  /**
   * Close the currently active tab with cleanup
   */
  const closeActiveTab = useCallback(() => {
    if (activeTab?.closable) {
      closeTabWithCleanup(activeTab.id)
    }
  }, [activeTab, closeTabWithCleanup])

  return {
    closeTab: closeTabWithCleanup,
    closeActiveTab,
  }
}
