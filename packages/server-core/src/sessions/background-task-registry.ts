import { readFile } from 'fs/promises'

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'orphaned'

export interface RunningBackgroundTask {
  taskId: string
  toolUseId?: string
  intent?: string
  startTime: number
  lastProgressAt?: number
  elapsedSeconds?: number
  status: BackgroundTaskStatus
  completedAt?: number
  turnId?: string
  workflowId?: string
  agentsCompleted?: number
}

export interface BackgroundTaskOutput {
  outputFile: string
  summary: string
  status: string
  completedAt: number
}

export interface BackgroundTaskState {
  backgroundTaskOutputs: Map<string, BackgroundTaskOutput>
  backgroundTaskRegistry: Map<string, RunningBackgroundTask>
}

export interface BackgroundTaskLogger {
  info(message: string, meta?: unknown): void
  error(message: string, error?: unknown): void
}

export interface TaskBackgroundedInput {
  taskId: string
  toolUseId?: string
  intent?: string
  turnId?: string
  workflowId?: string
  kind?: string
}

export interface TaskCompletedInput {
  taskId: string
  status: 'completed' | 'failed' | 'stopped'
  outputFile?: string
  summary?: string
}

export interface TaskCompletionResult {
  wasAlreadyTerminal: boolean
  taskIntent?: string
  outputFile?: string
}

const ONE_HOUR = 3_600_000

function findTask(state: BackgroundTaskState, taskId: string): RunningBackgroundTask | undefined {
  return state.backgroundTaskRegistry.get(taskId)
    ?? [...state.backgroundTaskRegistry.values()].find((task) => task.workflowId === taskId)
}

export function registerBackgroundTask(
  state: BackgroundTaskState,
  event: TaskBackgroundedInput,
  now = Date.now(),
): RunningBackgroundTask {
  const task: RunningBackgroundTask = {
    taskId: event.taskId,
    toolUseId: event.toolUseId,
    intent: event.intent,
    startTime: now,
    status: 'running',
    turnId: event.turnId,
    ...(event.workflowId ? { workflowId: event.workflowId } : {}),
    ...(event.kind === 'workflow' ? { agentsCompleted: 0 } : {}),
  }
  state.backgroundTaskRegistry.set(event.taskId, task)
  return task
}

export function recordWorkflowAgentCompleted(state: BackgroundTaskState, workflowId: string): void {
  const task = [...state.backgroundTaskRegistry.values()].find((entry) => entry.workflowId === workflowId)
  if (task) task.agentsCompleted = (task.agentsCompleted ?? 0) + 1
}

export function recordBackgroundTaskProgress(
  state: BackgroundTaskState,
  toolUseId: string,
  elapsedSeconds: number,
  now = Date.now(),
): void {
  const task = [...state.backgroundTaskRegistry.values()].find((entry) => entry.toolUseId === toolUseId)
  if (!task) return
  task.elapsedSeconds = elapsedSeconds
  task.lastProgressAt = now
}

export function completeBackgroundTask(
  state: BackgroundTaskState,
  taskOutputIndex: Map<string, string>,
  sessionId: string,
  event: TaskCompletedInput,
  now = Date.now(),
): TaskCompletionResult {
  const priorEntry = findTask(state, event.taskId)
  const wasAlreadyTerminal = priorEntry
    ? priorEntry.status !== 'running'
    : taskOutputIndex.has(event.taskId)

  const outputFile = event.outputFile || ''
  state.backgroundTaskOutputs.set(event.taskId, {
    outputFile,
    summary: event.summary || '',
    status: event.status,
    completedAt: now,
  })
  taskOutputIndex.set(event.taskId, sessionId)

  if (priorEntry) {
    priorEntry.status = event.status
    priorEntry.completedAt = now
  } else {
    state.backgroundTaskRegistry.set(event.taskId, {
      taskId: event.taskId,
      startTime: now,
      status: event.status,
      completedAt: now,
    })
  }

  evictStaleBackgroundTasks(state, taskOutputIndex, now)
  return { wasAlreadyTerminal, taskIntent: priorEntry?.intent, outputFile }
}

export function evictStaleBackgroundTasks(
  state: BackgroundTaskState,
  taskOutputIndex: Map<string, string>,
  now = Date.now(),
): void {
  for (const [taskId, info] of state.backgroundTaskOutputs) {
    if (now - info.completedAt > ONE_HOUR) {
      state.backgroundTaskOutputs.delete(taskId)
      taskOutputIndex.delete(taskId)
    }
  }
  for (const [taskId, info] of state.backgroundTaskRegistry) {
    if (info.status !== 'running' && info.completedAt && now - info.completedAt > ONE_HOUR) {
      state.backgroundTaskRegistry.delete(taskId)
    }
  }
}

export function markOrphanedBackgroundTasks(state: BackgroundTaskState, now = Date.now()): number {
  let orphaned = 0
  for (const info of state.backgroundTaskRegistry.values()) {
    if (info.status === 'running') {
      info.status = 'orphaned'
      info.completedAt = now
      orphaned++
    }
  }
  return orphaned
}

export function listBackgroundTasks(state: BackgroundTaskState | undefined): RunningBackgroundTask[] {
  if (!state) return []
  return [...state.backgroundTaskRegistry.values()]
    .map((task) => ({ ...task }))
    .sort((a, b) => b.startTime - a.startTime)
}

export async function getBackgroundTaskOutput(
  taskId: string,
  taskOutputIndex: Map<string, string>,
  getState: (sessionId: string) => BackgroundTaskState | undefined,
  log: BackgroundTaskLogger,
): Promise<string | null> {
  const sessionId = taskOutputIndex.get(taskId)
  if (!sessionId) {
    log.info(`No output found for task: ${taskId} (task may still be running)`)
    return null
  }

  const state = getState(sessionId)
  const info = state?.backgroundTaskOutputs.get(taskId)
  if (!info) {
    taskOutputIndex.delete(taskId)
    return null
  }

  log.info(`Found output for task ${taskId}: file=${info.outputFile}, status=${info.status}`)
  try {
    const content = await readFile(info.outputFile, 'utf-8')
    state!.backgroundTaskOutputs.delete(taskId)
    taskOutputIndex.delete(taskId)
    return content
  } catch (error) {
    log.error(`Failed to read task output file: ${info.outputFile}`, error)
    return info.summary || null
  }
}
