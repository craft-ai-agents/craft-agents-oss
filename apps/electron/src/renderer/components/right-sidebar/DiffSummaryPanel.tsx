/**
 * DiffSummaryPanel - File changes summary panel for right sidebar
 *
 * Displays:
 * - Total file count and additions/deletions stats
 * - Per-file breakdown with status badges and change stats
 * - Action buttons: Review, Accept All, Reject
 * - Clicking a file opens DiffReviewSheet focused on that file
 */

import * as React from 'react'
import { useState } from 'react'
import { FileEdit, FilePlus, FileX, GitCommit, X } from 'lucide-react'
import { cn } from '@craft-agent/ui'
import type { FileChange } from '@craft-agent/ui'

export interface DiffSummaryPanelProps {
  /** All file changes across the session */
  changes: FileChange[]
  /** Callback to open review sheet */
  onReviewChanges: () => void
  /** Callback to open review sheet focused on a specific file */
  onReviewFile: (changeId: string) => void
  /** Callback when all changes are accepted */
  onAcceptAll: () => void
  /** Callback when all changes are rejected */
  onRejectAll: () => void
  /** Current status of each change */
  changeStatuses?: Map<string, 'pending' | 'accepted' | 'rejected'>
  /** Enable git integration features */
  enableGitIntegration?: boolean
  /** Working directory for git operations */
  gitWorkingDir?: string
  /** Callback when commit is created */
  onCommitCreated?: (commitHash: string) => void
}

/**
 * Calculate additions and deletions for a file change
 */
function calculateChangeStats(change: FileChange): { additions: number; deletions: number } {
  const originalLines = change.original.split('\n').filter(line => line.trim())
  const modifiedLines = change.modified.split('\n').filter(line => line.trim())

  // Simple heuristic: count different lines
  const additions = Math.max(0, modifiedLines.length - originalLines.length)
  const deletions = Math.max(0, originalLines.length - modifiedLines.length)

  return { additions, deletions }
}

/**
 * Get file name from path
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

/**
 * Get parent directory from path
 */
function getParentDir(filePath: string): string {
  const parts = filePath.split('/')
  parts.pop()
  const dir = parts.join('/')
  return dir ? dir + '/' : ''
}

/**
 * Determine file status badge
 */
function getFileStatus(change: FileChange): {
  label: string
  icon: React.ElementType
  color: string
} {
  if (change.toolType === 'Write' || change.original === '') {
    return {
      label: 'A',
      icon: FilePlus,
      color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
    }
  }

  if (change.modified === '') {
    return {
      label: 'D',
      icon: FileX,
      color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30',
    }
  }

  return {
    label: 'M',
    icon: FileEdit,
    color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30',
  }
}

/**
 * DiffSummaryPanel component
 */
export function DiffSummaryPanel({
  changes,
  onReviewChanges,
  onReviewFile,
  onAcceptAll,
  onRejectAll,
  changeStatuses,
  enableGitIntegration = false,
  gitWorkingDir,
  onCommitCreated,
}: DiffSummaryPanelProps) {
  // Commit dialog state
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)

  // Filter successful changes
  const successfulChanges = changes.filter(c => !c.error)

  // Handle commit creation
  const handleCreateCommit = async () => {
    if (!commitMessage.trim()) {
      setCommitError('Commit message is required')
      return
    }

    setIsCommitting(true)
    setCommitError(null)

    try {
      // Stage all accepted files first
      const acceptedChanges = successfulChanges.filter(
        change => changeStatuses?.get(change.id) === 'accepted'
      )

      if (acceptedChanges.length === 0) {
        setCommitError('No accepted changes to commit')
        setIsCommitting(false)
        return
      }

      const filePaths = acceptedChanges.map(c => c.filePath)

      // @ts-expect-error - IPC types not available in electron renderer
      const stageResult = await window.electron?.ipcRenderer.invoke(
        'git:stage-batch',
        filePaths,
        gitWorkingDir
      )

      if (!stageResult?.success) {
        setCommitError(stageResult?.error || 'Failed to stage files')
        setIsCommitting(false)
        return
      }

      // Create commit
      // @ts-expect-error - IPC types not available in electron renderer
      const commitResult = await window.electron?.ipcRenderer.invoke(
        'git:commit',
        commitMessage,
        gitWorkingDir
      )

      if (commitResult?.success) {
        onCommitCreated?.(commitResult.commitHash)
        setShowCommitDialog(false)
        setCommitMessage('')
      } else {
        setCommitError(commitResult?.error || 'Failed to create commit')
      }
    } catch (error: any) {
      setCommitError(error.message || 'Failed to create commit')
    } finally {
      setIsCommitting(false)
    }
  }

  if (successfulChanges.length === 0) {
    return null
  }

  // Calculate total stats
  const totalStats = successfulChanges.reduce(
    (acc, change) => {
      const stats = calculateChangeStats(change)
      return {
        additions: acc.additions + stats.additions,
        deletions: acc.deletions + stats.deletions,
      }
    },
    { additions: 0, deletions: 0 }
  )

  return (
    <div className="h-full flex flex-col relative">
      {/* Section Header - matches SessionFilesSection styling */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 select-none">
        <span className="text-xs font-medium text-muted-foreground">File changes</span>
      </div>

      {/* Header with stats */}
      <div className="px-4 py-2 border-b border-border/30">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">
            {successfulChanges.length} {successfulChanges.length === 1 ? 'file' : 'files'}
          </span>
          {(totalStats.additions > 0 || totalStats.deletions > 0) && (
            <span className="text-muted-foreground font-mono text-xs">
              <span className="text-green-600 dark:text-green-400">+{totalStats.additions}</span>
              {' '}
              <span className="text-red-600 dark:text-red-400">-{totalStats.deletions}</span>
            </span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-1">
          {successfulChanges.map((change) => {
            const status = getFileStatus(change)
            const StatusIcon = status.icon
            const fileName = getFileName(change.filePath)
            const parentDir = getParentDir(change.filePath)
            const stats = calculateChangeStats(change)
            const changeStatus = changeStatuses?.get(change.id) || 'pending'

            return (
              <button
                key={change.id}
                onClick={() => onReviewFile(change.id)}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-md",
                  "transition-colors",
                  "hover:bg-accent/50",
                  changeStatus === 'accepted' && "opacity-60",
                  changeStatus === 'rejected' && "opacity-40 line-through"
                )}
              >
                <div className="flex items-start gap-2">
                  {/* Status badge */}
                  <span
                    className={cn(
                      "inline-flex items-center justify-center",
                      "w-5 h-5 rounded flex-shrink-0 mt-0.5",
                      "font-mono font-medium text-[10px]",
                      status.color
                    )}
                    title={status.label === 'M' ? 'Modified' : status.label === 'A' ? 'Added' : 'Deleted'}
                  >
                    {status.label}
                  </span>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {fileName}
                      </span>
                      {(stats.additions > 0 || stats.deletions > 0) && (
                        <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
                          <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
                          {' '}
                          <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
                        </span>
                      )}
                    </div>
                    {parentDir && (
                      <div className="text-[10px] text-muted-foreground/60 truncate font-mono mt-0.5">
                        {parentDir}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-3 py-3 border-t border-border/30 flex flex-col gap-2">
        <button
          onClick={onReviewChanges}
          className={cn(
            "w-full px-3 py-2 rounded-md",
            "text-xs font-medium",
            "bg-accent/50 hover:bg-accent",
            "text-accent-foreground",
            "transition-colors"
          )}
        >
          Review All
        </button>
        <div className="flex gap-2">
          <button
            onClick={onAcceptAll}
            className={cn(
              "flex-1 px-3 py-1.5 rounded-md",
              "text-xs font-medium",
              "bg-green-500/10 hover:bg-green-500/20",
              "text-green-600 dark:text-green-400",
              "transition-colors"
            )}
          >
            Accept
          </button>
          <button
            onClick={onRejectAll}
            className={cn(
              "flex-1 px-3 py-1.5 rounded-md",
              "text-xs font-medium",
              "bg-destructive/10 hover:bg-destructive/20",
              "text-destructive",
              "transition-colors"
            )}
          >
            Reject
          </button>
        </div>

        {/* Git commit button */}
        {enableGitIntegration && (
          <button
            onClick={() => setShowCommitDialog(true)}
            className={cn(
              "w-full px-3 py-2 rounded-md",
              "text-xs font-medium",
              "bg-blue-500/10 hover:bg-blue-500/20",
              "text-blue-600 dark:text-blue-400",
              "transition-colors",
              "flex items-center justify-center gap-2"
            )}
          >
            <GitCommit className="w-3.5 h-3.5" />
            Create Commit
          </button>
        )}
      </div>

      {/* Commit dialog */}
      {showCommitDialog && (
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-10 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-lg">
            {/* Dialog header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-medium">Create Commit</h3>
              <button
                onClick={() => {
                  setShowCommitDialog(false)
                  setCommitMessage('')
                  setCommitError(null)
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dialog body */}
            <div className="p-4 space-y-3">
              {/* Stats */}
              <div className="text-xs text-muted-foreground">
                {(() => {
                  const acceptedCount = successfulChanges.filter(
                    c => changeStatuses?.get(c.id) === 'accepted'
                  ).length
                  return `${acceptedCount} accepted ${acceptedCount === 1 ? 'file' : 'files'} will be committed`
                })()}
              </div>

              {/* Commit message input */}
              <div>
                <label htmlFor="commit-message" className="text-xs font-medium text-foreground block mb-1.5">
                  Commit message
                </label>
                <textarea
                  id="commit-message"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Brief description of changes..."
                  className={cn(
                    "w-full px-3 py-2 rounded-md",
                    "text-sm",
                    "bg-background border border-border",
                    "focus:outline-none focus:ring-2 focus:ring-accent",
                    "resize-none"
                  )}
                  rows={3}
                  autoFocus
                />
              </div>

              {/* Error message */}
              {commitError && (
                <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                  {commitError}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowCommitDialog(false)
                    setCommitMessage('')
                    setCommitError(null)
                  }}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-md",
                    "text-xs font-medium",
                    "bg-accent/50 hover:bg-accent",
                    "text-accent-foreground",
                    "transition-colors"
                  )}
                  disabled={isCommitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateCommit}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-md",
                    "text-xs font-medium",
                    "bg-blue-500/10 hover:bg-blue-500/20",
                    "text-blue-600 dark:text-blue-400",
                    "transition-colors",
                    "flex items-center justify-center gap-2",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  disabled={isCommitting || !commitMessage.trim()}
                >
                  {isCommitting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Committing...
                    </>
                  ) : (
                    <>
                      <GitCommit className="w-3.5 h-3.5" />
                      Commit
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
