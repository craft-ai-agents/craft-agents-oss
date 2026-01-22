/**
 * LoopSummaryCard
 *
 * Displays a summary of a completed Ralph Loop.
 * Shows completed/failed/skipped stories, total time, and commit hashes.
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { CheckCircle2, XCircle, SkipForward, GitCommit, Clock, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LoopSummaryData {
  totalStories: number
  completedStories: number
  failedStories: number
  skippedStories: number
  totalTimeMs: number
  commits: string[]
}

export interface LoopSummaryCardProps {
  /** Summary data from loop completion */
  summary: LoopSummaryData
  /** Loop ID for reference */
  loopId?: string
  /** Additional class name */
  className?: string
}

/** Format duration in a human-readable way */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes} minutes`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours} hours`
}

/** Shorten commit SHA for display */
function shortenSha(sha: string): string {
  return sha.slice(0, 7)
}

export function LoopSummaryCard({
  summary,
  loopId,
  className,
}: LoopSummaryCardProps) {
  const { totalStories, completedStories, failedStories, skippedStories, totalTimeMs, commits } = summary

  // Determine overall status
  const allCompleted = completedStories === totalStories
  const allFailed = failedStories === totalStories
  const hasFailures = failedStories > 0

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'rounded-lg border bg-background/95 backdrop-blur-sm overflow-hidden',
        allCompleted && 'border-success/30',
        allFailed && 'border-destructive/30',
        hasFailures && !allFailed && 'border-info/30',
        !hasFailures && !allCompleted && 'border-border/50',
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'px-4 py-3 flex items-center justify-between',
          allCompleted && 'bg-success/5',
          allFailed && 'bg-destructive/5',
          hasFailures && !allFailed && 'bg-info/5',
          !hasFailures && !allCompleted && 'bg-foreground/5'
        )}
      >
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-foreground/70" />
          <span className="text-sm font-medium">Loop Complete</span>
        </div>
        {loopId && (
          <span className="text-xs text-foreground/50 font-mono">
            {loopId}
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="px-4 py-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Completed stories */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/10">
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{completedStories}</div>
            <div className="text-xs text-foreground/50">Completed</div>
          </div>
        </div>

        {/* Failed stories */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-destructive/10">
            <XCircle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{failedStories}</div>
            <div className="text-xs text-foreground/50">Failed</div>
          </div>
        </div>

        {/* Skipped stories */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground/10">
            <SkipForward className="h-4 w-4 text-foreground/50" />
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{skippedStories}</div>
            <div className="text-xs text-foreground/50">Skipped</div>
          </div>
        </div>

        {/* Total time */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground/10">
            <Clock className="h-4 w-4 text-foreground/50" />
          </div>
          <div>
            <div className="text-sm font-semibold">{formatDuration(totalTimeMs)}</div>
            <div className="text-xs text-foreground/50">Total time</div>
          </div>
        </div>
      </div>

      {/* Commits section */}
      {commits.length > 0 && (
        <div className="px-4 py-3 border-t border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <GitCommit className="h-3.5 w-3.5 text-foreground/50" />
            <span className="text-xs text-foreground/50">
              {commits.length} commit{commits.length !== 1 ? 's' : ''} created
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {commits.map((sha) => (
              <span
                key={sha}
                className="inline-flex items-center rounded px-2 py-0.5 text-xs font-mono bg-foreground/5 text-foreground/70"
              >
                {shortenSha(sha)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Progress bar at bottom */}
      <div className="h-1 bg-foreground/5 flex">
        {completedStories > 0 && (
          <div
            className="h-full bg-success"
            style={{ width: `${(completedStories / totalStories) * 100}%` }}
          />
        )}
        {failedStories > 0 && (
          <div
            className="h-full bg-destructive"
            style={{ width: `${(failedStories / totalStories) * 100}%` }}
          />
        )}
        {skippedStories > 0 && (
          <div
            className="h-full bg-foreground/30"
            style={{ width: `${(skippedStories / totalStories) * 100}%` }}
          />
        )}
      </div>
    </motion.div>
  )
}
