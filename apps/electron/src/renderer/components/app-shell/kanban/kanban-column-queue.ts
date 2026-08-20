/**
 * FIFO per-workspace queue for kanban column auto-run (drop → start agent).
 *
 * Drop onto `in-progress` always enqueues a Play-equivalent turn. Other columns
 * enqueue only when the destination has `promptEnabled` + a non-empty prompt.
 * Execution reuses the same `onSendMessage` / `runTask` paths as the tile Play
 * button — never spawns agents outside those RPCs.
 *
 * Loop-guard: a session already `isProcessing` is skipped (not re-queued) so
 * rapid re-drops cannot double-fire the same turn.
 */

export type KanbanColumnRunJob = {
  workspaceId: string
  sessionId: string
  columnId: string
  /** Column auto-prompt text (may be empty for bare in-progress Play). */
  columnPrompt: string
  title: string
  /** Goal / acceptance body for the turn. */
  goalText: string
  /** Spec-backed Conductor task slug — when set, Play uses `runTask` instead of sendMessage. */
  taskSlug?: string
  enqueuedAt: number
}

export type KanbanColumnRunHandlers = {
  /** Freeform / plain tile path (same as Play for non-spec children / parent freeform). */
  sendMessage: (sessionId: string, message: string) => void
  /** Spec-backed Conductor path (same as tile Play when `taskSlug` is set). */
  runTask: (workspaceId: string, args: { slug: string; orchestratorSessionId: string }) => Promise<unknown>
  /** Current processing flag — skip if true (loop-guard). */
  isProcessing: (sessionId: string) => boolean
  /** Optimistic processing flip so subsequent drops no-op while the turn starts. */
  markProcessing?: (sessionId: string) => void
  onError?: (err: unknown, job: KanbanColumnRunJob) => void
}

type WorkspaceQueue = {
  jobs: KanbanColumnRunJob[]
  draining: boolean
}

const queues = new Map<string, WorkspaceQueue>()

/** @internal test helper */
export function __resetKanbanColumnQueuesForTests(): void {
  queues.clear()
}

function getQueue(workspaceId: string): WorkspaceQueue {
  let q = queues.get(workspaceId)
  if (!q) {
    q = { jobs: [], draining: false }
    queues.set(workspaceId, q)
  }
  return q
}

/**
 * Build the user message for a column auto-run turn.
 * When a column prompt is set it is prepended and separated by `---`.
 */
export function buildColumnRunMessage(job: Pick<KanbanColumnRunJob, 'columnPrompt' | 'title' | 'goalText'>): string {
  const bodyParts: string[] = []
  const title = job.title.trim()
  const goal = job.goalText.trim()
  if (title) bodyParts.push(title)
  if (goal && goal !== title) bodyParts.push(goal)
  const body = bodyParts.join('\n\n') || title || goal

  const prompt = job.columnPrompt.trim()
  if (prompt && body) return `${prompt}\n\n---\n\n${body}`
  if (prompt) return prompt
  return body
}

/**
 * Whether a drop onto `toColumn` should start an agent turn.
 * `in-progress` always runs; other columns need promptEnabled + non-empty prompt.
 */
export function shouldAutoRunOnDrop(
  toColumn: string,
  column?: { promptEnabled?: boolean; prompt?: string } | null
): boolean {
  if (toColumn === 'in-progress') return true
  return !!(column?.promptEnabled && column.prompt?.trim())
}

/** Enqueue a column auto-run job and kick the workspace drain loop. */
export function enqueueKanbanColumnRun(job: KanbanColumnRunJob, handlers: KanbanColumnRunHandlers): void {
  const q = getQueue(job.workspaceId)
  q.jobs.push(job)
  void drainQueue(job.workspaceId, handlers)
}

async function drainQueue(workspaceId: string, handlers: KanbanColumnRunHandlers): Promise<void> {
  const q = getQueue(workspaceId)
  if (q.draining) return
  q.draining = true
  try {
    while (q.jobs.length > 0) {
      const job = q.jobs.shift()!
      if (handlers.isProcessing(job.sessionId)) {
        // Loop-guard: already running — drop this enqueue silently.
        continue
      }
      try {
        if (job.taskSlug) {
          handlers.markProcessing?.(job.sessionId)
          await handlers.runTask(job.workspaceId, {
            slug: job.taskSlug,
            orchestratorSessionId: job.sessionId,
          })
        } else {
          const message = buildColumnRunMessage(job)
          if (!message.trim()) continue
          handlers.markProcessing?.(job.sessionId)
          handlers.sendMessage(job.sessionId, message)
        }
      } catch (err) {
        handlers.onError?.(err, job)
      }
    }
  } finally {
    q.draining = false
    // Jobs may have arrived while we were finishing the last tick.
    if (q.jobs.length > 0) {
      void drainQueue(workspaceId, handlers)
    }
  }
}
