/**
 * LoopProgressIndicator
 *
 * Displays the current status of an active Ralph Loop.
 * Shows story progress, iteration count, elapsed time, and control buttons.
 */

import * as React from 'react'
import { useState } from 'react'
import { motion } from 'motion/react'
import { Pause, Play, X, CheckCircle2, RefreshCw, AlertCircle, ChevronDown, CheckCircle, XCircle, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import type { LoopStateUI } from '../../../shared/types'

export interface LoopProgressIndicatorProps {
  /** Current loop state */
  loopState: LoopStateUI
  /** Callback when pause button is clicked */
  onPause?: () => void
  /** Callback when resume button is clicked */
  onResume?: () => void
  /** Callback when cancel button is clicked */
  onCancel?: () => void
  /** Additional class name */
  className?: string
}

/** Format elapsed time in a compact way */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

/** Get status configuration for styling */
function getStatusConfig(status: LoopStateUI['status']) {
  switch (status) {
    case 'running':
      return {
        icon: <Spinner className="h-3.5 w-3.5" />,
        label: 'Running',
        color: 'text-accent',
        bgColor: 'bg-accent/10',
      }
    case 'paused':
      return {
        icon: <Pause className="h-3.5 w-3.5" />,
        label: 'Paused',
        color: 'text-info',
        bgColor: 'bg-info/10',
      }
    case 'completed':
      return {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        label: 'Completed',
        color: 'text-success',
        bgColor: 'bg-success/10',
      }
    case 'cancelled':
      return {
        icon: <X className="h-3.5 w-3.5" />,
        label: 'Cancelled',
        color: 'text-foreground/60',
        bgColor: 'bg-foreground/5',
      }
    case 'error':
      return {
        icon: <AlertCircle className="h-3.5 w-3.5" />,
        label: 'Error',
        color: 'text-destructive',
        bgColor: 'bg-destructive/10',
      }
    default:
      return {
        icon: <RefreshCw className="h-3.5 w-3.5" />,
        label: 'Initializing',
        color: 'text-foreground/60',
        bgColor: 'bg-foreground/5',
      }
  }
}

export function LoopProgressIndicator({
  loopState,
  onPause,
  onResume,
  onCancel,
  className,
}: LoopProgressIndicatorProps) {
  const { progress, currentStory, status, elapsedMs = 0, completedStories = [], errors = [] } = loopState
  const statusConfig = getStatusConfig(status)

  // Expandable sections state
  const [showCompleted, setShowCompleted] = useState(false)
  const [showErrors, setShowErrors] = useState(errors.length > 0) // Auto-expand if errors exist

  // Calculate progress percentage
  const progressPercent = progress
    ? Math.round((progress.currentStoryIndex / progress.totalStories) * 100)
    : 0

  const isActive = status === 'running' || status === 'paused'

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border/50 bg-background/80 backdrop-blur-sm',
        'shadow-sm',
        className
      )}
    >
      {/* Main progress bar */}
      <div className="flex items-center gap-3 px-3 py-2">
      {/* Status indicator */}
      <div className={cn('flex items-center gap-1.5', statusConfig.color)}>
        {statusConfig.icon}
        <span className="text-xs font-medium">{statusConfig.label}</span>
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-border/50" />

      {/* Story progress */}
      {progress && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground/70">
            Story {progress.currentStoryIndex + 1}/{progress.totalStories}
          </span>

          {/* Progress bar */}
          <div className="w-24 h-1.5 bg-foreground/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      )}

      {/* Current story info */}
      {currentStory && (
        <>
          <div className="h-4 w-px bg-border/50" />
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-xs font-mono text-accent truncate">
              {currentStory.id}
            </span>
            <span className="text-xs text-foreground/50 truncate max-w-[200px]">
              {currentStory.title}
            </span>
          </div>
        </>
      )}

      {/* Iteration counter */}
      {progress && progress.currentIteration > 0 && (
        <>
          <div className="h-4 w-px bg-border/50" />
          <span className="text-xs text-foreground/50">
            Iter {progress.currentIteration}/{progress.maxIterations}
          </span>
        </>
      )}

      {/* Elapsed time */}
      <div className="h-4 w-px bg-border/50" />
      <span className="text-xs text-foreground/50 tabular-nums">
        {formatElapsed(elapsedMs)}
      </span>

      {/* Control buttons */}
      {isActive && (
        <>
          <div className="h-4 w-px bg-border/50" />
          <div className="flex items-center gap-1">
            {status === 'running' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onPause}
                title="Pause loop"
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onResume}
                title="Resume loop"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={onCancel}
              title="Cancel loop"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}
      </div>

      {/* Completed Stories Section */}
      {completedStories.length > 0 && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-foreground/5 transition-colors"
          >
            <span className="font-medium">
              Completed Stories ({completedStories.length}/{progress?.totalStories || 0})
            </span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', showCompleted && 'rotate-180')} />
          </button>
          {showCompleted && (
            <div className="px-3 pb-2 space-y-1">
              {completedStories.map((story, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs py-1">
                  {story.result === 'success' && <CheckCircle className="h-3 w-3 text-success flex-shrink-0" />}
                  {story.result === 'failed' && <XCircle className="h-3 w-3 text-destructive flex-shrink-0" />}
                  {story.result === 'skipped' && <Ban className="h-3 w-3 text-foreground/40 flex-shrink-0" />}
                  <span className="font-mono text-accent">{story.id}</span>
                  <span className="text-foreground/70 truncate">{story.title}</span>
                  {story.commitSha && (
                    <span className="font-mono text-foreground/40 text-[10px] ml-auto">
                      {story.commitSha.slice(0, 7)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Errors Section */}
      {errors.length > 0 && (
        <div className="border-t border-destructive/30 bg-destructive/5">
          <button
            onClick={() => setShowErrors(!showErrors)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-destructive/10 transition-colors"
          >
            <span className="font-medium text-destructive">
              Errors ({errors.length})
            </span>
            <ChevronDown className={cn('h-3 w-3 transition-transform text-destructive', showErrors && 'rotate-180')} />
          </button>
          {showErrors && (
            <div className="px-3 pb-2 space-y-2">
              {errors.map((error, idx) => (
                <div key={idx} className="text-xs bg-background/50 rounded p-2">
                  {error.storyId && (
                    <div className="font-mono text-accent mb-1">{error.storyId}</div>
                  )}
                  <div className="text-destructive">{error.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
