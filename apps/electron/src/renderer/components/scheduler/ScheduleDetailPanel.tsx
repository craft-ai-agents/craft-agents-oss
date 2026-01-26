import { useState, useEffect, useMemo } from 'react'
import { Clock, Check, X, Play, Loader2, Edit2, ExternalLink } from 'lucide-react'
import { Cron } from 'croner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { navigate, routes } from '@/lib/navigate'
import type { Schedule } from '../../../shared/types'

interface ScheduleDetailPanelProps {
  schedule: Schedule | null
  onUpdate?: (id: string, updates: { prompt: string }) => void
  onRunNow?: (id: string) => void
}

export function ScheduleDetailPanel({ schedule, onUpdate, onRunNow }: ScheduleDetailPanelProps) {
  if (!schedule) {
    return <EmptyState />
  }

  return <DetailView schedule={schedule} onUpdate={onUpdate} onRunNow={onRunNow} />
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-16 h-16 mx-auto rounded-full bg-muted/30 flex items-center justify-center">
          <Clock className="w-8 h-8 text-muted-foreground/50" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-medium text-foreground/90">No Schedule Selected</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Select a schedule from the list to view its details, upcoming runs, and execution history
          </p>
        </div>
      </div>
    </div>
  )
}

interface DetailViewProps {
  schedule: Schedule
  onUpdate?: (id: string, updates: { prompt: string }) => void
  onRunNow?: (id: string) => void
}

function DetailView({ schedule, onUpdate, onRunNow }: DetailViewProps) {
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState(schedule.prompt)
  const [countdown, setCountdown] = useState<string>('')

  // Support both 'cron' (standard) and 'customCron' (legacy/manual) fields
  const cronExpression = schedule.cron || (schedule as Record<string, unknown>).customCron as string | undefined

  // Calculate next run time
  const nextRun = useMemo(() => {
    if (!schedule.enabled || !cronExpression) return null
    try {
      const cron = new Cron(cronExpression, { timezone: schedule.timezone })
      return cron.nextRun()
    } catch {
      return null
    }
  }, [cronExpression, schedule.timezone, schedule.enabled])

  // Update countdown every second
  useEffect(() => {
    if (!nextRun) {
      setCountdown('')
      return
    }

    const updateCountdown = () => {
      const now = new Date()
      const diff = nextRun.getTime() - now.getTime()

      if (diff <= 0) {
        setCountdown('Running soon...')
        return
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      if (days > 0) {
        setCountdown(`${days}d ${hours}h`)
      } else if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m`)
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`)
      } else {
        setCountdown(`${seconds}s`)
      }
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [nextRun])

  // Execution history from schedule data
  const recentExecutions = useMemo(() => {
    // Use executionHistory if available, fallback to lastRun* fields for backward compatibility
    if (schedule.executionHistory && schedule.executionHistory.length > 0) {
      return schedule.executionHistory.map(exec => ({
        timestamp: exec.timestamp * 1000,
        status: exec.status,
        error: exec.error,
        sessionId: exec.sessionId,
      }))
    }
    // Fallback for schedules without execution history
    if (schedule.lastRunAt) {
      return [{
        timestamp: schedule.lastRunAt * 1000,
        status: schedule.lastRunStatus || 'success',
        error: schedule.lastRunError,
        sessionId: schedule.lastRunSessionId,
      }]
    }
    return []
  }, [schedule.executionHistory, schedule.lastRunAt, schedule.lastRunStatus, schedule.lastRunError, schedule.lastRunSessionId])

  const handleSavePrompt = () => {
    if (onUpdate && editedPrompt.trim() !== schedule.prompt) {
      onUpdate(schedule.id, { prompt: editedPrompt })
    }
    setIsEditingPrompt(false)
  }

  const handleCancelEdit = () => {
    setEditedPrompt(schedule.prompt)
    setIsEditingPrompt(false)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-8 py-12 space-y-16">
        {/* Next Run Countdown */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Next Run
            </h2>
            {onRunNow && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRunNow(schedule.id)}
                className="gap-2"
              >
                <Play className="w-3 h-3" />
                Run Now
              </Button>
            )}
          </div>

          {schedule.enabled ? (
            nextRun ? (
              <div className="space-y-3">
                <div
                  className="text-6xl font-light tabular-nums tracking-tight text-foreground"
                  style={{ fontFamily: 'SF Pro Display, -apple-system, sans-serif' }}
                >
                  {countdown}
                </div>
                <p className="text-sm text-muted-foreground">
                  {nextRun.toLocaleString('en-US', {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short',
                  })}
                </p>
              </div>
            ) : (
              <div className="text-2xl text-muted-foreground/50">No upcoming runs</div>
            )
          ) : (
            <div className="space-y-3">
              <div className="text-2xl text-muted-foreground/50">Schedule Disabled</div>
              <p className="text-sm text-muted-foreground">
                Enable this schedule to see the next run time
              </p>
            </div>
          )}
        </section>

        {/* Recent Executions */}
        <section className="space-y-6">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Recent Executions
          </h2>

          {recentExecutions.length > 0 ? (
            <div className="space-y-4">
              {recentExecutions.map((execution, i) => (
                <ExecutionRow key={i} execution={execution} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/50 py-8 text-center">
              No executions yet
            </p>
          )}
        </section>

        {/* Prompt Editor */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Prompt
            </h2>
            {!isEditingPrompt && onUpdate && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsEditingPrompt(true)}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <Edit2 className="w-3 h-3" />
                Edit
              </Button>
            )}
          </div>

          {isEditingPrompt ? (
            <div className="space-y-3">
              <Textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className="min-h-[200px] font-mono text-sm resize-none"
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSavePrompt}>
                  Save Changes
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative group">
              <pre className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap font-mono bg-muted/30 rounded-lg p-4 border border-border/50">
                {schedule.prompt}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

interface ExecutionRowProps {
  execution: {
    timestamp: number
    status: string
    error?: string | null
    sessionId?: string | null
  }
}

function ExecutionRow({ execution }: ExecutionRowProps) {
  const timeAgo = useMemo(() => {
    const now = Date.now()
    const diff = now - execution.timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }, [execution.timestamp])

  const handleClick = () => {
    if (execution.sessionId) {
      navigate(routes.view.allChats(execution.sessionId))
    }
  }

  const isClickable = !!execution.sessionId

  return (
    <div
      className={`flex items-start gap-4 group ${
        isClickable ? 'cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded-md transition-colors' : ''
      }`}
      onClick={handleClick}
    >
      {/* Status indicator */}
      <div className="pt-1 flex-shrink-0">
        {execution.status === 'success' ? (
          <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center">
            <Check className="w-4 h-4 text-green-500" />
          </div>
        ) : execution.status === 'failed' ? (
          <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center">
            <X className="w-4 h-4 text-red-500" />
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium text-foreground">
            {execution.status === 'success' ? 'Completed' : execution.status === 'failed' ? 'Failed' : 'Running'}
          </span>
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
          {isClickable && (
            <ExternalLink className="w-3 h-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
          )}
        </div>

        {execution.error && (
          <p className="text-xs text-red-400/80 font-mono">{execution.error}</p>
        )}

        <p className="text-xs text-muted-foreground">
          {new Date(execution.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          {isClickable && (
            <span className="ml-2 text-xs text-primary/60 group-hover:text-primary transition-colors">
              View session →
            </span>
          )}
        </p>
      </div>
    </div>
  )
}
