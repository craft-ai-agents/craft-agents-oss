/**
 * useTabs Hook
 *
 * Main hook for interacting with the tab system.
 * Provides state access and factory methods for opening tabs.
 */

import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import {
  tabStateAtom,
  activeTabAtom,
  isTabBarVisibleAtom,
  openTabAtom,
  closeTabAtom,
  setActiveTabAtom,
  reorderTabsAtom,
  updateTabAtom,
  previousTabAtom,
  nextTabAtom,
  closeOtherTabsAtom,
  validateTabsAtom,
  replaceTabAtom,
} from './atoms'
import type {
  Tab,
  ChatTab,
  SettingsTab,
  ShortcutsTab,
  AgentInfoTab,
  FileTab,
  BrowserTab,
  PreferencesTab,
  SourceInfoTab,
  OpenChatTabOptions,
} from './types'

export function useTabs() {
  const state = useAtomValue(tabStateAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const isTabBarVisible = useAtomValue(isTabBarVisibleAtom)
  const openTab = useSetAtom(openTabAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const setActiveTab = useSetAtom(setActiveTabAtom)
  const reorderTabs = useSetAtom(reorderTabsAtom)
  const updateTab = useSetAtom(updateTabAtom)
  const previousTab = useSetAtom(previousTabAtom)
  const nextTab = useSetAtom(nextTabAtom)
  const closeOtherTabs = useSetAtom(closeOtherTabsAtom)
  const validateTabs = useSetAtom(validateTabsAtom)
  const replaceTab = useSetAtom(replaceTabAtom)

  /**
   * Open a chat tab for a session
   * - Default: switches existing tab to session (if one exists)
   * - forceNew: always creates a new tab
   */
  const openChatTab = useCallback(
    (
      sessionId: string,
      workspaceId: string,
      label: string,
      agentId?: string,
      options: OpenChatTabOptions = {}
    ) => {
      const { forceNew = false } = options

      // Check if a chat tab for this session already exists
      const existingTab = state.tabs.find(
        (t) => t.type === 'chat' && (t as ChatTab).sessionId === sessionId
      ) as ChatTab | undefined

      if (existingTab && !forceNew) {
        // Activate existing tab
        setActiveTab(existingTab.id)
        return
      }

      // Find an existing chat tab to replace (hybrid behavior)
      // Only replace if not forcing new AND no existing tab for this session
      if (!forceNew) {
        const currentChatTab = state.tabs.find(
          (t) => t.type === 'chat' && t.id === state.activeTabId
        ) as ChatTab | undefined

        if (currentChatTab) {
          // Update the current chat tab to show this session
          // Use atomic replacement to avoid race conditions
          const newTab: ChatTab = {
            id: `chat:${sessionId}`,
            type: 'chat',
            sessionId,
            workspaceId,
            label,
            closable: true,
            agentId,
          }
          replaceTab({ oldTabId: currentChatTab.id, newTab })
          return
        }
      }

      // Create new tab
      const tab: ChatTab = {
        id: `chat:${sessionId}`,
        type: 'chat',
        sessionId,
        workspaceId,
        label,
        closable: true,
        agentId,
      }
      openTab(tab)
    },
    [state.tabs, state.activeTabId, openTab, setActiveTab, replaceTab]
  )

  /**
   * Open the settings tab (singleton)
   */
  const openSettingsTab = useCallback(() => {
    const tab: SettingsTab = {
      id: 'settings',
      type: 'settings',
      label: 'Settings',
      closable: true,
    }
    openTab(tab)
  }, [openTab])

  /**
   * Open the keyboard shortcuts tab (singleton)
   */
  const openShortcutsTab = useCallback(() => {
    const tab: ShortcutsTab = {
      id: 'shortcuts',
      type: 'shortcuts',
      label: 'Keyboard Shortcuts',
      closable: true,
    }
    openTab(tab)
  }, [openTab])

  /**
   * Open an agent info tab
   */
  const openAgentInfoTab = useCallback(
    (agentId: string, workspaceId: string, agentName: string) => {
      const tab: AgentInfoTab = {
        id: `agent-info:${agentId}`,
        type: 'agent-info',
        agentId,
        workspaceId,
        label: `${agentName}`,
        closable: true,
      }
      openTab(tab)
    },
    [openTab]
  )

  /**
   * Open a file viewer tab
   */
  const openFileTab = useCallback(
    (path: string) => {
      const fileName = path.split('/').pop() || path
      const tab: FileTab = {
        id: `file:${path}`,
        type: 'file',
        path,
        label: fileName,
        closable: true,
      }
      openTab(tab)
    },
    [openTab]
  )

  /**
   * Open a browser tab
   */
  const openBrowserTab = useCallback(
    (url: string) => {
      let label: string
      try {
        label = new URL(url).hostname
      } catch {
        label = url.slice(0, 30)
      }
      const tab: BrowserTab = {
        id: `browser:${url}`,
        type: 'browser',
        url,
        label,
        closable: true,
      }
      openTab(tab)
    },
    [openTab]
  )

  /**
   * Open the preferences editor tab (singleton)
   */
  const openPreferencesTab = useCallback(() => {
    const tab: PreferencesTab = {
      id: 'preferences',
      type: 'preferences',
      label: 'User Preferences',
      closable: true,
    }
    openTab(tab)
  }, [openTab])

  /**
   * Open a source info tab (view-only)
   * - Default: switches existing tab to source (if one exists) or replaces current source-info tab
   */
  const openSourceInfoTab = useCallback(
    (
      sourceSlug: string,
      workspaceId: string,
      sourceName: string,
      agentSlug?: string
    ) => {
      // Include agentSlug in ID to distinguish agent-scoped from workspace-scoped
      const tabId = agentSlug
        ? `source-info:${agentSlug}:${sourceSlug}`
        : `source-info:${sourceSlug}`

      // Check if a source-info tab for this source already exists
      const existingTab = state.tabs.find(
        (t) => t.type === 'source-info' && t.id === tabId
      ) as SourceInfoTab | undefined

      if (existingTab) {
        // Activate existing tab
        setActiveTab(existingTab.id)
        return
      }

      // Find an existing source-info tab to replace (hybrid behavior)
      const currentSourceInfoTab = state.tabs.find(
        (t) => t.type === 'source-info' && t.id === state.activeTabId
      ) as SourceInfoTab | undefined

      if (currentSourceInfoTab) {
        // Replace the current source-info tab with this source
        const newTab: SourceInfoTab = {
          id: tabId,
          type: 'source-info',
          sourceSlug,
          workspaceId,
          agentSlug,
          label: sourceName,
          closable: true,
        }
        replaceTab({ oldTabId: currentSourceInfoTab.id, newTab })
        return
      }

      // Create new tab
      const tab: SourceInfoTab = {
        id: tabId,
        type: 'source-info',
        sourceSlug,
        workspaceId,
        agentSlug,
        label: sourceName,
        closable: true,
      }
      openTab(tab)
    },
    [openTab, state.tabs, state.activeTabId, setActiveTab, replaceTab]
  )

  /**
   * Update a chat tab's label (e.g., when session is renamed)
   */
  const updateChatTabLabel = useCallback(
    (sessionId: string, label: string) => {
      const tabId = `chat:${sessionId}`
      updateTab(tabId, { label })
    },
    [updateTab]
  )

  /**
   * Close a chat tab by session ID
   */
  const closeChatTabBySession = useCallback(
    (sessionId: string) => {
      closeTab(`chat:${sessionId}`)
    },
    [closeTab]
  )

  /**
   * Check if a specific tab type is currently active
   */
  const isTabTypeActive = useCallback(
    (type: Tab['type']) => {
      return activeTab?.type === type
    },
    [activeTab]
  )

  /**
   * Get all tabs of a specific type
   */
  const getTabsByType = useCallback(
    <T extends Tab>(type: T['type']): T[] => {
      return state.tabs.filter((t): t is T => t.type === type)
    },
    [state.tabs]
  )

  return {
    // State
    tabs: state.tabs,
    activeTab,
    activeTabId: state.activeTabId,
    isTabBarVisible,

    // Core actions
    openTab,
    closeTab,
    setActiveTab,
    reorderTabs,
    updateTab,
    previousTab,
    nextTab,
    closeOtherTabs,
    validateTabs,

    // Factory methods
    openChatTab,
    openSettingsTab,
    openShortcutsTab,
    openAgentInfoTab,
    openFileTab,
    openBrowserTab,
    openPreferencesTab,
    openSourceInfoTab,

    // Helpers
    updateChatTabLabel,
    closeChatTabBySession,
    isTabTypeActive,
    getTabsByType,
  }
}
