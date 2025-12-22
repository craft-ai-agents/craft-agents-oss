/**
 * ChatContext
 *
 * Provides session and workspace data to tab panels without prop drilling.
 * This context is used by ChatTabPanel and other components that need
 * access to the current session, workspace, and callback functions.
 */

import * as React from 'react'
import { createContext, useContext } from 'react'
import type {
  Session,
  Workspace,
  SubAgentMetadata,
  FileAttachment,
  PermissionRequest,
  PlanReviewRequest,
  PlanReviewResponse,
  AskQuestionRequest,
  AskQuestionResponse,
} from '../../shared/types'

export interface ChatContextType {
  // Data
  sessions: Session[]
  workspaces: Workspace[]
  agents: SubAgentMetadata[]
  activeWorkspaceId: string | null
  currentModel: string
  pendingPermissions: Map<string, PermissionRequest[]>
  /** Pending plan review requests per session */
  pendingPlanReviews: Map<string, PlanReviewRequest>
  /** Pending ask question requests per session */
  pendingAskQuestions: Map<string, AskQuestionRequest>
  /** Draft input text per session - preserved across mode switches and conversation changes */
  sessionDrafts: Map<string, string>

  // Advanced options (all session-scoped)
  /** Session IDs that have ultrathink enabled (session-scoped, single-shot per message) */
  ultrathinkSessions: Set<string>
  /** Session IDs that have skip permissions enabled (session-scoped) */
  skipPermissionsSessions: Set<string>
  /** Session IDs that have plan mode enabled (session-scoped) */
  planModeSessions: Set<string>

  // Session callbacks
  onCreateSession: (workspaceId: string, agentId?: string) => Promise<Session>
  onSendMessage: (sessionId: string, message: string, attachments?: FileAttachment[]) => void
  onRenameSession: (sessionId: string, name: string) => void
  onFlagSession: (sessionId: string) => void
  onUnflagSession: (sessionId: string) => void
  onMarkSessionRead: (sessionId: string) => void
  onDeleteSession: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>

  // Permission handling
  onRespondToPermission?: (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean
  ) => void

  // Plan mode handling
  onRespondToPlanReview?: (
    sessionId: string,
    requestId: string,
    response: PlanReviewResponse
  ) => void
  onRespondToAskQuestion?: (
    sessionId: string,
    requestId: string,
    answers: AskQuestionResponse
  ) => void

  // File/URL handlers - these can open in tabs or external apps
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void

  // Model
  onModelChange: (model: string) => void

  // Advanced options callbacks (all session-scoped)
  onUltrathinkChange: (sessionId: string, enabled: boolean) => void
  onSkipPermissionsChange: (sessionId: string, enabled: boolean) => void
  onPlanModeChange: (sessionId: string, enabled: boolean) => void

  // Input draft callback
  onInputChange: (sessionId: string, value: string) => void

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
 * Get pending plan review for a session
 */
export function usePendingPlanReview(sessionId: string): PlanReviewRequest | undefined {
  const { pendingPlanReviews } = useChatContext()
  return pendingPlanReviews.get(sessionId)
}

/**
 * Get pending ask question for a session
 */
export function usePendingAskQuestion(sessionId: string): AskQuestionRequest | undefined {
  const { pendingAskQuestions } = useChatContext()
  return pendingAskQuestions.get(sessionId)
}
