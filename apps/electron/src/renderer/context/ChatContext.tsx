/**
 * ChatContext
 *
 * Provides session and workspace data to tab panels without prop drilling.
 * This context is used by ChatTabPanel and other components that need
 * access to the current session, workspace, and callback functions.
 */

import * as React from 'react'
import { createContext, useContext, useCallback } from 'react'
import type {
  Session,
  Workspace,
  SubAgentMetadata,
  FileAttachment,
  PermissionRequest,
  ConnectionConfig,
  Mode,
  TodoState,
} from '../../shared/types'
import type { SessionOptions, SessionOptionUpdates } from '../hooks/useSessionOptions'
import { defaultSessionOptions } from '../hooks/useSessionOptions'

export interface ChatContextType {
  // Data
  sessions: Session[]
  workspaces: Workspace[]
  agents: SubAgentMetadata[]
  isLoadingAgents?: boolean
  activeWorkspaceId: string | null
  currentModel: string
  pendingPermissions: Map<string, PermissionRequest[]>
  /** Draft input text per session - preserved across mode switches and conversation changes */
  sessionDrafts: Map<string, string>
  /** All enabled connections (filtered from global connections) - provided by Chat component */
  enabledConnections?: ConnectionConfig[]

  // Unified session options (replaces ultrathinkSessions, skipPermissionsSessions, sessionModes)
  /** All session-scoped options in one map. Use useSessionOptionsFor() hook for easy access. */
  sessionOptions: Map<string, SessionOptions>

  // Session callbacks
  onCreateSession: (workspaceId: string, agentId?: string) => Promise<Session>
  onSendMessage: (sessionId: string, message: string, attachments?: FileAttachment[]) => void
  onRenameSession: (sessionId: string, name: string) => void
  onFlagSession: (sessionId: string) => void
  onUnflagSession: (sessionId: string) => void
  onMarkSessionRead: (sessionId: string) => void
  onMarkSessionUnread: (sessionId: string) => void
  onTodoStateChange: (sessionId: string, state: TodoState) => void
  onDeleteSession: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>

  // Permission handling
  onRespondToPermission?: (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean
  ) => void

  // File/URL handlers - these can open in tabs or external apps
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void

  // Model
  onModelChange: (model: string) => void

  // Workspace
  onSelectWorkspace: (id: string) => void
  onAddWorkspace: () => void

  // App actions
  onOpenSettings: () => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onRefreshAgents: () => void
  onLogout: () => void

  // Unified session options callback (replaces onUltrathinkChange, onSkipPermissionsChange, onModeChange)
  onSessionOptionsChange: (sessionId: string, updates: SessionOptionUpdates) => void

  // Input draft callback
  onInputChange: (sessionId: string, value: string) => void

  // Connection selection callback (per-session) - provided by Chat component
  onSessionConnectionsChange?: (sessionId: string, connectionIds: string[]) => void

  // Chat input ref (for focusing)
  textareaRef?: React.RefObject<HTMLTextAreaElement>
}

const ChatContext = createContext<ChatContextType | null>(null)

export function ChatProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: ChatContextType
}) {
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext(): ChatContextType {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider')
  }
  return context
}

/**
 * Get a specific session by ID
 */
export function useSession(sessionId: string): Session | null {
  const { sessions } = useChatContext()
  return sessions.find((s) => s.id === sessionId) || null
}

/**
 * Get the active workspace
 */
export function useActiveWorkspace(): Workspace | null {
  const { workspaces, activeWorkspaceId } = useChatContext()
  if (!activeWorkspaceId) return null
  return workspaces.find((w) => w.id === activeWorkspaceId) || null
}

/**
 * Get pending permission for a session (first in queue)
 */
export function usePendingPermission(sessionId: string): PermissionRequest | undefined {
  const { pendingPermissions } = useChatContext()
  return pendingPermissions.get(sessionId)?.[0]
}

/**
 * Hook to get and update session options for a specific session.
 * This is the primary way components should access session options.
 *
 * Usage:
 *   const { options, setMode, toggleUltrathink } = useSessionOptionsFor(sessionId)
 *   if (options.ultrathinkEnabled) { ... }
 *   setMode('safe', true)
 */
export function useSessionOptionsFor(sessionId: string): {
  options: SessionOptions
  setOption: <K extends keyof SessionOptions>(key: K, value: SessionOptions[K]) => void
  setOptions: (updates: SessionOptionUpdates) => void
  toggleUltrathink: () => void
  toggleSkipPermissions: () => void
  setMode: (mode: Mode, enabled: boolean) => void
  isModeActive: (mode: Mode) => boolean
} {
  const { sessionOptions, onSessionOptionsChange } = useChatContext()

  const options = sessionOptions.get(sessionId) ?? defaultSessionOptions

  const setOption = useCallback(<K extends keyof SessionOptions>(
    key: K,
    value: SessionOptions[K]
  ) => {
    onSessionOptionsChange(sessionId, { [key]: value })
  }, [sessionId, onSessionOptionsChange])

  const setOptions = useCallback((updates: SessionOptionUpdates) => {
    onSessionOptionsChange(sessionId, updates)
  }, [sessionId, onSessionOptionsChange])

  const toggleUltrathink = useCallback(() => {
    setOption('ultrathinkEnabled', !options.ultrathinkEnabled)
  }, [options.ultrathinkEnabled, setOption])

  const toggleSkipPermissions = useCallback(() => {
    setOption('skipPermissions', !options.skipPermissions)
  }, [options.skipPermissions, setOption])

  const setMode = useCallback((mode: Mode, enabled: boolean) => {
    const currentModes = options.activeModes
    if (enabled) {
      if (!currentModes.includes(mode)) {
        setOption('activeModes', [...currentModes, mode])
      }
    } else {
      setOption('activeModes', currentModes.filter(m => m !== mode))
    }
  }, [options.activeModes, setOption])

  const isModeActive = useCallback((mode: Mode) => {
    return options.activeModes.includes(mode)
  }, [options.activeModes])

  return {
    options,
    setOption,
    setOptions,
    toggleUltrathink,
    toggleSkipPermissions,
    setMode,
    isModeActive,
  }
}

