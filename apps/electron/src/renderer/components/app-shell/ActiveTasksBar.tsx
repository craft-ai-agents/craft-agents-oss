/**
 * ActiveTasksBar - Compact horizontal display of running background tasks
 *
 * Shows above/below the ChatInput when background tasks are active.
 * Each task shows: type icon, ID (shortened), elapsed time, kill button
 */

import React from 'react'
import { useSetAtom } from 'jotai'
import { TaskActionMenu, type TerminalOverlayData } from './TaskActionMenu'
import { backgroundTasksAtomFamily, type BackgroundTask } from '@/atoms/sessions'

// Re-exported for existing consumers (ActiveOptionBadges, ChatInputZone, TaskActionMenu)
// so the single definition lives in atoms/sessions.ts.
export type { BackgroundTask } from '@/atoms/sessions'

/**
 * How long a terminal/orphaned chip lingers before it is auto-pruned. Terminal
 * (completed/failed/stopped) chips clear quickly so the bar reflects live work;
 * orphaned chips linger a bit longer so the user actually notices that a task
 * died at turn end rather than silently vanishing.
 */
const TERMINAL_LINGER_MS = 8_000
const ORPHANED_LINGER_MS = 20_000

export interface ActiveTasksBarProps {
  /** Active background tasks */
  tasks: BackgroundTask[]
  /** Session ID for opening preview windows */
  sessionId: string
  /** Callback when kill button is clicked */
  onKillTask?: (taskId: string) => void
  /** Callback to insert message into input field */
  onInsertMessage?: (text: string) => void
  /** Callback to show terminal output overlay */
  onShowTerminalOverlay?: (data: TerminalOverlayData) => void
  /** Additional class name */
  className?: string
}

/**
 * ActiveTasksBar - Badge-style display of running background tasks
 * Styled to match ActiveOptionBadges for visual consistency
 * Only renders when there are active tasks
 */
export function ActiveTasksBar({ tasks, sessionId, onKillTask, onInsertMessage, onShowTerminalOverlay, className }: ActiveTasksBarProps) {
  const setTasks = useSetAtom(backgroundTasksAtomFamily(sessionId))

  // Auto-expiry ticker: prune terminal/orphaned chips after their linger window
  // so the bar reflects live work and terminal chips don't accumulate. Running
  // chips are never pruned here — they clear on task_completed or are flipped to
  // 'orphaned' at turn end (App.tsx handleBackgroundTaskEvent). This is the
  // reliability backstop that was missing when the bar was first disabled.
  React.useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setTasks((prev) => {
        const next = prev.filter((t) => {
          if (t.status === 'running') return true
          const age = now - (t.completedAt ?? now)
          const linger = t.status === 'orphaned' ? ORPHANED_LINGER_MS : TERMINAL_LINGER_MS
          return age < linger
        })
        return next.length === prev.length ? prev : next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [sessionId, setTasks])

  // Don't render if no tasks
  if (tasks.length === 0) return null

  return (
    <>
      {tasks.map((task) => (
        <TaskActionMenu
          key={task.id}
          task={task}
          sessionId={sessionId}
          onKillTask={onKillTask || (() => {})}
          onInsertMessage={onInsertMessage}
          onShowTerminalOverlay={onShowTerminalOverlay}
          className={className}
        />
      ))}
    </>
  )
}
