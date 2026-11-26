import {
  MAX_PROJECT_MOVE_SESSIONS,
  type ProjectMoveEntry,
  type ProjectMoveResult,
  type SessionCommand,
} from '@craft-agent/shared/protocol'

/** Sends a project command for a session (`window.electronAPI.sessionCommand`). */
export type ProjectCommandSender = (
  sessionId: string,
  command: Extract<SessionCommand, { type: 'setProjectId' | 'restoreProjectIds' }>,
) => Promise<unknown>

export function isProjectMoveResult(value: unknown): value is ProjectMoveResult {
  return !!value && typeof value === 'object' && Array.isArray((value as ProjectMoveResult).moved)
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

/**
 * Move chats to a project (`null` = no project). The server moves the chats nested under them too
 * and returns what it changed: those entries come back, each chat once with what it had before
 * the move (what Undo restores). An older server answers nothing and moves only the command's own
 * chat, so the rest then go one command each, and the result is `null` (nothing to undo).
 */
export async function moveSessionsToProject(
  send: ProjectCommandSender,
  sessionIds: readonly string[],
  projectId: string | null,
): Promise<ProjectMoveEntry[] | null> {
  const moved = new Map<string, ProjectMoveEntry>()
  const batches = chunks([...new Set(sessionIds)], MAX_PROJECT_MOVE_SESSIONS)
  for (const [index, [first, ...rest]] of batches.entries()) {
    const result = await send(first!, {
      type: 'setProjectId',
      projectId,
      ...(rest.length > 0 ? { additionalSessionIds: rest } : {}),
    })
    if (!isProjectMoveResult(result)) {
      for (const id of [...rest, ...batches.slice(index + 1).flat()]) {
        await send(id, { type: 'setProjectId', projectId })
      }
      return null
    }
    // A chat a later batch changes again (it followed its parent, then was selected) keeps its
    // state from before the whole move
    for (const entry of result.moved) if (!moved.has(entry.id)) moved.set(entry.id, entry)
  }
  return [...moved.values()]
}

/** Undo `moveSessionsToProject`: each chat gets back exactly the project and marker it had. */
export async function undoProjectMove(send: ProjectCommandSender, moved: readonly ProjectMoveEntry[]): Promise<void> {
  for (const batch of chunks(moved, MAX_PROJECT_MOVE_SESSIONS)) {
    await send(batch[0]!.id, {
      type: 'restoreProjectIds',
      sessions: batch.map(entry => ({ id: entry.id, projectId: entry.previousProjectId, projectOverride: entry.previousOverride })),
    })
  }
}

/**
 * The project every selected chat is in, for the check mark in "Move to Project": a project id,
 * `null` when none of them has one, `undefined` when they differ or a selected chat isn't known.
 */
export function sharedProjectId(
  selected: readonly { projectId?: string }[],
  selectedCount: number,
): string | null | undefined {
  if (selected.length === 0 || selected.length !== selectedCount) return undefined
  const first = selected[0]!.projectId ?? null
  return selected.every(meta => (meta.projectId ?? null) === first) ? first : undefined
}

/**
 * Collects values by key and hands them over together, `delayMs` after the first one or at once
 * with `flush()`; a key added again keeps its latest value. A project move sends one
 * `project_id_changed` per chat, so the renderer applies a burst as one update instead of
 * re-rendering the session list per chat.
 */
export function createKeyedBatcher<V>(apply: (batch: Map<string, V>) => void, delayMs: number) {
  let pending = new Map<string, V>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.size === 0) return
    const batch = pending
    pending = new Map()
    apply(batch)
  }
  return {
    add(key: string, value: V) {
      pending.set(key, value)
      timer ??= setTimeout(flush, delayMs)
    },
    flush,
  }
}
