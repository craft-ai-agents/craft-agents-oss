/**
 * Moving chats between projects as families: which chats a move changes (the selection plus the
 * chats nested under it that follow) and what each one's `projectOverride` becomes, and the checks
 * on what a client sends. Pure, so the rules are testable without a SessionManager.
 */

import { MAX_PROJECT_MOVE_SESSIONS, type SessionProjectState } from '@craft-agent/shared/protocol'

/** What a move needs to know about a session of the workspace. */
export interface ProjectMoveNode {
  id: string
  /** The session it nests under in the list: its `parentSessionId`, else the session it was branched from */
  listParentId?: string
  projectId?: string
  projectOverride?: true
}

/** A session's project binding after a move. */
export interface ProjectChange {
  id: string
  projectId: string | undefined
  projectOverride: true | undefined
}

/**
 * Keeps its own project rather than following `parent`: it carries the marker, or (a header from
 * before the marker existed) it is in a project other than its parent's and the one the walk
 * started from. Unassigned chats always follow.
 */
function keepsOwnProject(child: ProjectMoveNode, parent: ProjectMoveNode, start: ProjectMoveNode): boolean {
  if (child.projectOverride) return true
  return child.projectId !== undefined && child.projectId !== parent.projectId && child.projectId !== start.projectId
}

/**
 * What moving `selected` (session ids of one workspace; others in `sessions` are ignored) to
 * `destination` (`undefined` = no project) changes, in order: each selected chat, then the chats
 * nested under it that follow it.
 *
 * - A nested chat follows its list parent unless it is selected itself (it is moved as part of the
 *   selection) or keeps its own project (`keepsOwnProject`). One that keeps its own project but is
 *   already in the destination joins again: the family converged, so its marker is cleared.
 * - A selected chat gets the marker when it ends up in another project than its list parent and
 *   that parent isn't moving with it.
 *
 * Chats whose project and marker don't change are left out. Loops of parents end where the walk
 * meets a chat again.
 */
export function planProjectMove(
  sessions: Iterable<ProjectMoveNode>,
  selected: readonly string[],
  destination: string | undefined,
): ProjectChange[] {
  const byId = new Map<string, ProjectMoveNode>()
  for (const session of sessions) byId.set(session.id, session)

  const children = new Map<string, ProjectMoveNode[]>()
  for (const session of byId.values()) {
    const parentId = session.listParentId
    if (!parentId || parentId === session.id || !byId.has(parentId)) continue
    const siblings = children.get(parentId)
    if (siblings) siblings.push(session)
    else children.set(parentId, [session])
  }

  const selectedIds = new Set(selected.filter(id => byId.has(id)))
  // Insertion order is the result's order
  const moving = new Map<string, ProjectMoveNode>()
  for (const id of selectedIds) {
    const start = byId.get(id)!
    const queue = [start]
    for (let node = queue.shift(); node; node = queue.shift()) {
      if (moving.has(node.id)) continue
      moving.set(node.id, node)
      for (const child of children.get(node.id) ?? []) {
        if (selectedIds.has(child.id) || moving.has(child.id)) continue
        if (keepsOwnProject(child, node, start) && child.projectId !== destination) continue
        queue.push(child)
      }
    }
  }

  const changes: ProjectChange[] = []
  for (const node of moving.values()) {
    const parent = node.listParentId && node.listParentId !== node.id ? byId.get(node.listParentId) : undefined
    const projectOverride = parent && !moving.has(parent.id) && parent.projectId !== destination ? true : undefined
    if (node.projectId === destination && node.projectOverride === projectOverride) continue
    changes.push({ id: node.id, projectId: destination, projectOverride })
  }
  return changes
}

/**
 * The chats a `setProjectId` command names, checked: the command's session first, then
 * `additionalSessionIds` (absent or an array of ids), duplicates dropped, at most
 * MAX_PROJECT_MOVE_SESSIONS in all. Throws on anything else; a string was once spread into
 * single-character ids.
 */
export function projectMoveSelection(sessionId: unknown, additionalSessionIds: unknown): string[] {
  if (!isId(sessionId)) throw new Error('setProjectId: the session id must be a non-empty string')
  if (additionalSessionIds === undefined || additionalSessionIds === null) return [sessionId]
  if (!Array.isArray(additionalSessionIds) || !additionalSessionIds.every(isId)) {
    throw new Error('setProjectId: additionalSessionIds must be an array of session ids')
  }
  if (additionalSessionIds.length + 1 > MAX_PROJECT_MOVE_SESSIONS) {
    throw new Error(`setProjectId: at most ${MAX_PROJECT_MOVE_SESSIONS} chats per command, got ${additionalSessionIds.length + 1}`)
  }
  return [...new Set([sessionId, ...additionalSessionIds])]
}

/** A `setProjectId` destination, checked: a project id, or `null` for no project. */
export function projectMoveDestination(projectId: unknown): string | null {
  if (projectId === null || isId(projectId)) return projectId
  throw new Error('setProjectId: projectId must be a project id or null')
}

/** The `sessions` of a `restoreProjectIds` command, checked (at most MAX_PROJECT_MOVE_SESSIONS). */
export function projectRestoreStates(sessions: unknown): SessionProjectState[] {
  if (!Array.isArray(sessions)) throw new Error('restoreProjectIds: sessions must be an array')
  if (sessions.length > MAX_PROJECT_MOVE_SESSIONS) {
    throw new Error(`restoreProjectIds: at most ${MAX_PROJECT_MOVE_SESSIONS} chats per command, got ${sessions.length}`)
  }
  return sessions.map((entry: unknown) => {
    const { id, projectId, projectOverride } = (entry ?? {}) as Record<string, unknown>
    if (!isId(id) || (projectId !== null && !isId(projectId)) || typeof projectOverride !== 'boolean') {
      throw new Error('restoreProjectIds: each entry needs an id, a projectId (or null) and a boolean projectOverride')
    }
    return { id, projectId, projectOverride }
  })
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
