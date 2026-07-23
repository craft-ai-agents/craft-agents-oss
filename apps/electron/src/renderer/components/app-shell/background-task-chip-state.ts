import type { BackgroundTask } from '@/atoms/sessions'

/** How long real terminal/orphaned chips remain visible. */
export const TERMINAL_LINGER_MS = 8_000
export const ORPHANED_LINGER_MS = 20_000

/**
 * A missing lifecycle signal is not proof that a task stopped. After this long,
 * replace the spinner with an explicit unknown/stale state while keeping the chip
 * available for a later progress or completion event.
 */
export const RUNNING_SIGNAL_TIMEOUT_MS = 20 * 60_000

/**
 * Advance age-based chip state and prune only states known to be terminal.
 * Returns the original array when nothing changed to avoid spurious Jotai renders.
 */
export function advanceBackgroundTaskChips(
  tasks: BackgroundTask[],
  now: number,
): BackgroundTask[] {
  let changed = false
  const next = tasks
    .map((task) => {
      const lastSignalAt = task.lastSignalAt ?? task.startTime
      if (
        task.status === 'running'
        && now - lastSignalAt >= RUNNING_SIGNAL_TIMEOUT_MS
      ) {
        changed = true
        return { ...task, status: 'stale' as const }
      }
      return task
    })
    .filter((task) => {
      if (task.status === 'running' || task.status === 'stale') return true
      const age = now - (task.completedAt ?? now)
      const linger = task.status === 'orphaned'
        ? ORPHANED_LINGER_MS
        : TERMINAL_LINGER_MS
      return age < linger
    })

  if (next.length !== tasks.length) changed = true
  return changed ? next : tasks
}

/**
 * Record evidence that a task is still alive. A stale task can recover to running,
 * but late progress must never resurrect a truly terminal task.
 */
export function markBackgroundTaskSignal(
  task: BackgroundTask,
  now: number,
): BackgroundTask {
  if (task.status !== 'running' && task.status !== 'stale') return task
  return {
    ...task,
    status: 'running',
    lastSignalAt: now,
  }
}

/**
 * Turn-end death is authoritative only when the backend did not keep background
 * tasks alive. Both running and uncertain/stale chips become truly orphaned.
 */
export function markLiveBackgroundTasksOrphaned(
  tasks: BackgroundTask[],
  now: number,
): BackgroundTask[] {
  let changed = false
  const next = tasks.map((task) => {
    if (task.status !== 'running' && task.status !== 'stale') return task
    changed = true
    return {
      ...task,
      status: 'orphaned' as const,
      completedAt: now,
    }
  })
  return changed ? next : tasks
}
