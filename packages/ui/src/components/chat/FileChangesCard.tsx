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
 * Calculate addition and removal counts for a set of changes
 */
function calculateStats(changes: FileChange[]) {
  let additions = 0
  let removals = 0
  for (const change of changes) {
    // Basic line count estimation
    const addedLines = change.modified.split('\n').length
    const removedLines = change.original.split('\n').length

    if (change.toolType === 'Write') {
      if (change.original === '') {
        // Pure addition
        additions += addedLines
      } else {
        // Replacement (Write overwriting existing)
        additions += addedLines
        removals += removedLines
      }
    } else {
      // Edit is always a replacement of one block with another
      additions += addedLines
      removals += removedLines
    }
  }
  return { additions, removals }
}

/**
 * Determine the status badge for a group of file changes
 */
function getGroupStatus(changes: FileChange[]): { label: string; icon: React.ReactNode; color: string } {
  const hasWrite = changes.some(c => c.toolType === 'Write')
  const hasEdit = changes.some(c => c.toolType === 'Edit')

  if (hasWrite && !hasEdit) {
    // If we only have writes and they all have empty original, it's Added
    const allNew = changes.every(c => c.original === '')
    if (allNew) {
      return {
        label: 'A',
        icon: <FilePlus className="w-3 h-3" />,
        color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
      }
    }
  }

  // Default to Modified for any mix or pure edits
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

  // Dedupe changes by filePath
  const groupedChanges = successfulChanges.reduce((acc, change) => {
    const list = acc[change.filePath] || []
    list.push(change)
    acc[change.filePath] = list
    return acc
  }, {} as Record<string, FileChange[]>)

  const sortedPaths = Object.keys(groupedChanges).sort()

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
          {sortedPaths.length} {sortedPaths.length === 1 ? 'file' : 'files'}
        </span>
      </div>

      {/* File list */}
      <div className="space-y-1.5">
        {sortedPaths.map((filePath) => {
          const fileGroup = groupedChanges[filePath]
          if (!fileGroup) return null

          const stats = calculateStats(fileGroup)
          const status = getGroupStatus(fileGroup)
          const fileName = getFileName(filePath)
          const parentDir = getParentDir(filePath)

          return (
            <div
              key={filePath}
              className="flex items-center gap-2 text-xs"
            >
              {/* Status badge */}
              <span
                className={cn(
                  "inline-flex items-center justify-center",
                  "w-5 h-5 rounded shrink-0",
                  "font-mono font-medium text-[10px]",
                  status.color
                )}
                title={status.label === 'M' ? 'Modified' : 'Added'}
              >
                {status.label}
              </span>

              {/* File path and stats */}
              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                <div
                  className="flex-1 min-w-0 font-mono flex items-center gap-0.5"
                  title={filePath}
                >
                  {parentDir ? (
                    <>
                      <span className="text-muted-foreground/60 truncate min-w-[20px]">
                        {parentDir}
                      </span>
                      <span className="text-muted-foreground/40 shrink-0">/</span>
                      <span className="text-foreground/90 font-medium shrink-0">
                        {fileName}
                      </span>
                    </>
                  ) : (
                    <span className="text-foreground/90 font-medium truncate">
                      {fileName}
                    </span>
                  )}
                </div>

                {/* Addition/Removal stats */}
                <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px]">
                  {stats.additions > 0 && (
                    <span className="text-green-600 dark:text-green-400">
                      +{stats.additions}
                    </span>
                  )}
                  {stats.removals > 0 && (
                    <span className="text-destructive">
                      -{stats.removals}
                    </span>
                  )}
                </div>
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
