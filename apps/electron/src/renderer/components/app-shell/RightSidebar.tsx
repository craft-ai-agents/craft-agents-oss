/**
 * RightSidebar - Content router for right sidebar panels
 *
 * Routes to different panel types based on RightSidebarPanel discriminated union.
 * Similar to how MainContentPanel routes between different page types.
 */

import * as React from 'react'
import type { RightSidebarPanel } from '../../../shared/types'
import { SessionMetadataPanel } from '../right-sidebar/SessionMetadataPanel'
import type { FileChange } from '@craft-agent/ui'

export interface RightSidebarProps {
  /** Current panel configuration */
  panel: RightSidebarPanel
  /** Session ID (required for session-specific panels) */
  sessionId?: string
  /** Close button to display in panel header */
  closeButton?: React.ReactNode
  /** File changes accumulated across the session */
  fileChanges?: FileChange[]
  /** Callback to open diff review sheet */
  onReviewChanges?: () => void
  /** Callback to open diff review for specific file */
  onReviewFile?: (changeId: string) => void
  /** Callback when all changes are accepted */
  onAcceptAll?: () => void
  /** Callback when all changes are rejected */
  onRejectAll?: () => void
  /** Status of each change (pending/accepted/rejected) */
  changeStatuses?: Map<string, 'pending' | 'accepted' | 'rejected'>
  /** Enable git integration features */
  enableGitIntegration?: boolean
  /** Working directory for git operations */
  gitWorkingDir?: string
  /** Callback when commit is created */
  onCommitCreated?: (commitHash: string) => void
}

/**
 * Routes right sidebar content based on panel type
 */
export function RightSidebar({
  panel,
  sessionId,
  closeButton,
  fileChanges,
  onReviewChanges,
  onReviewFile,
  onAcceptAll,
  onRejectAll,
  changeStatuses,
  enableGitIntegration,
  gitWorkingDir,
  onCommitCreated,
}: RightSidebarProps) {
  switch (panel.type) {
    case 'sessionMetadata':
      return (
        <SessionMetadataPanel
          sessionId={sessionId}
          closeButton={closeButton}
          fileChanges={fileChanges}
          onReviewChanges={onReviewChanges}
          onReviewFile={onReviewFile}
          onAcceptAll={onAcceptAll}
          onRejectAll={onRejectAll}
          changeStatuses={changeStatuses}
          enableGitIntegration={enableGitIntegration}
          gitWorkingDir={gitWorkingDir}
          onCommitCreated={onCommitCreated}
        />
      )

    case 'files':
      // TODO: Implement SessionFilesPanel
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Files panel - Coming soon</p>
        </div>
      )

    case 'history':
      // TODO: Implement SessionHistoryPanel
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <p className="text-sm">History panel - Coming soon</p>
        </div>
      )

    case 'none':
    default:
      return null
  }
}
