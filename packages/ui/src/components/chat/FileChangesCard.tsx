/**
 * FileChangesCard - Minimal file list card in message content
 *
 * Displays a compact list of files changed during an agent turn with:
 * - Status badges (M/A/D) for Modified, Added, Deleted
 * - Single "Review Changes" button to open DiffReviewSheet
 * - Clean, minimal design matching bg-muted/30 style
 */

import * as React from 'react'
import { FileEdit, FilePlus, FileX } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { FileChange } from '../overlay/MultiDiffPreviewOverlay'

export interface FileChangesCardProps {
  /** File changes from the turn */
  changes: FileChange[]
  /** Callback to open the review sheet */
  onReviewChanges: () => void
  /** Whether actions are disabled (during streaming) */
  disabled?: boolean
}

/**
 * Get the file name from a full path
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

/**
 * Get the parent directory from a full path
 */
function getParentDir(filePath: string): string {
  const parts = filePath.split('/')
  parts.pop() // Remove filename
  return parts.join('/')
}

/**
 * Determine the status badge for a file change
 */
function getFileStatus(change: FileChange): { label: string; icon: React.ReactNode; color: string } {
  if (change.toolType === 'Write') {
    // Write tool = Added file
    return {
      label: 'A',
      icon: <FilePlus className="w-3 h-3" />,
      color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
    }
  }

  if (change.toolType === 'Edit') {
    // Edit tool = Modified file
    if (change.original === '') {
      // Empty original = new file
      return {
        label: 'A',
        icon: <FilePlus className="w-3 h-3" />,
        color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
      }
    }

    if (change.modified === '') {
      // Empty modified = deleted file
      return {
        label: 'D',
        icon: <FileX className="w-3 h-3" />,
        color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30',
      }
    }

    // Modified file
    return {
      label: 'M',
      icon: <FileEdit className="w-3 h-3" />,
      color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30',
    }
  }

  // Fallback
  return {
    label: 'M',
    icon: <FileEdit className="w-3 h-3" />,
    color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30',
  }
}

/**
 * FileChangesCard component
 */
export function FileChangesCard({ changes, onReviewChanges, disabled = false }: FileChangesCardProps) {
  // Filter out errors
  const successfulChanges = changes.filter(c => !c.error)

  if (successfulChanges.length === 0) {
    return null
  }

  return (
    <div className={cn(
      "rounded-lg border border-border/30 bg-muted/30 p-3",
      "space-y-2"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-foreground/80">
          Files Changed
        </h4>
        <span className="text-xs text-muted-foreground">
          {successfulChanges.length} {successfulChanges.length === 1 ? 'file' : 'files'}
        </span>
      </div>

      {/* File list */}
      <div className="space-y-1">
        {successfulChanges.map((change) => {
          const status = getFileStatus(change)
          const fileName = getFileName(change.filePath)
          const parentDir = getParentDir(change.filePath)

          return (
            <div
              key={change.id}
              className="flex items-center gap-2 text-xs"
            >
              {/* Status badge */}
              <span
                className={cn(
                  "inline-flex items-center justify-center",
                  "w-5 h-5 rounded",
                  "font-mono font-medium text-[10px]",
                  status.color
                )}
                title={status.label === 'M' ? 'Modified' : status.label === 'A' ? 'Added' : 'Deleted'}
              >
                {status.label}
              </span>

              {/* File path */}
              <div className="flex-1 min-w-0 font-mono">
                {parentDir && (
                  <span className="text-muted-foreground/60">
                    {parentDir}/
                  </span>
                )}
                <span className="text-foreground/90">
                  {fileName}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action button */}
      <div className="pt-1 border-t border-border/20">
        <button
          onClick={onReviewChanges}
          disabled={disabled}
          className={cn(
            "w-full px-3 py-1.5 rounded-md",
            "text-xs font-medium",
            "bg-accent/50 hover:bg-accent",
            "text-accent-foreground",
            "transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          Review Changes
        </button>
      </div>
    </div>
  )
}
