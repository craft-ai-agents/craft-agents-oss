/**
 * Progress Monitor
 *
 * Watches task files in ~/.claude/tasks/{listId}/ for status changes.
 * Decodes metadata to map task updates back to story progress.
 */

import { watch, type FSWatcher } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { OrchestrateMeta } from './types.ts'
import { decodeMeta } from './meta-codec.ts'

export interface TaskFileContent {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
}

export interface ProgressUpdate {
  taskId: string
  status: 'pending' | 'in_progress' | 'completed'
  meta: OrchestrateMeta | null
}

export type ProgressCallback = (update: ProgressUpdate) => void

/**
 * Watch a task list directory for changes
 */
export function watchTaskProgress(
  taskListId: string,
  onProgress: ProgressCallback
): FSWatcher {
  const taskDir = join(homedir(), '.claude', 'tasks', taskListId)

  const watcher = watch(taskDir, async (event, filename) => {
    if (!filename?.endsWith('.json') || filename.startsWith('.')) {
      return
    }

    try {
      const filePath = join(taskDir, filename)
      const content = await readFile(filePath, 'utf-8')
      const task = JSON.parse(content) as TaskFileContent
      const meta = decodeMeta(task.description)

      onProgress({
        taskId: task.id,
        status: task.status,
        meta,
      })
    } catch {
      // File may be in the process of being written, ignore errors
    }
  })

  return watcher
}

/**
 * Get task directory path
 */
export function getTaskDir(taskListId: string): string {
  return join(homedir(), '.claude', 'tasks', taskListId)
}
