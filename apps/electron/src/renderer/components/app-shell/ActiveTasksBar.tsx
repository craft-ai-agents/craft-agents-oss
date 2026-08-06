/**
 * ActiveTasksBar - Compact horizontal display of running background tasks
 *
 * Shows above/below the ChatInput when background tasks are active.
 * Each task shows: type icon, ID (shortened), elapsed time, kill button
 */

import React from 'react'
import { useSetAtom } from 'jotai'
import { TaskActionMenu, type TerminalOverlayData } from './TaskActionMenu'
import { advanceBackgroundTaskChips } from './background-task-chip-state'
import { backgroundTasksAtomFamily, type BackgroundTask } from '@/atoms/sessions'

// Re-exported for existing consumers (ActiveOptionBadges, ChatInputZone, TaskActionMenu)
// so the single definition lives in atoms/sessions.ts.
export type { BackgroundTask } from '@/atoms/sessions'

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

  // Stop an unconfirmed chip from spinning forever without pretending the task
  // died. Old no-signal tasks become `stale` and remain recoverable; only real
  // terminal/orphaned states are auto-pruned by the pure lifecycle helper.
  React.useEffect(() => {
    const interval = setInterval(() => {
      setTasks((prev) => advanceBackgroundTaskChips(prev, Date.now()))
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
