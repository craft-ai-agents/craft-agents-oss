/**
 * LoopProgressIndicator
 *
 * Displays the current status of an active Ralph Loop.
 * Shows story progress, iteration count, elapsed time, and control buttons.
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { Pause, Play, X, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react'
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
  const { progress, currentStory, status, elapsedMs = 0 } = loopState
  const statusConfig = getStatusConfig(status)

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
        'flex items-center gap-3 rounded-lg border border-border/50 bg-background/80 backdrop-blur-sm px-3 py-2',
        'shadow-sm',
        className
      )}
    >
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
    </motion.div>
  )
}
