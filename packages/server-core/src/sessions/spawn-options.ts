/**
 * What a session spawned with the spawn_session tool inherits from the session that spawned it.
 * Extracted from the SessionManager callback so the inheritance rules are unit-testable.
 */

import { resolve } from 'node:path'
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'

/** The spawn_session fields that override what the child inherits. */
export interface SpawnOverrides {
  name?: string
  llmConnection?: string
  model?: string
  enabledSourceSlugs?: string[]
  thinkingLevel?: ThinkingLevel
  labels?: string[]
  workingDirectory?: string
  projectId?: string
  codingMode?: boolean
  /** An existing git worktree: the child works there, in Coding mode */
  worktreePath?: string
}

/** The spawning session's fields a child inherits. */
export interface SpawnParent {
  id: string
  llmConnection?: string
  model?: string
  enabledSourceSlugs?: string[]
  thinkingLevel?: ThinkingLevel
  labels?: string[]
  projectId?: string
  workingDirectory?: string
  codingMode?: boolean
}

/**
 * createSession options for a child of `parent`, without the permission mode and attendance the
 * caller decides. Whatever the request leaves out comes from the parent, so delegated work runs
 * like its parent.
 */
export function spawnedSessionOptions(request: SpawnOverrides, parent: SpawnParent): CreateSessionOptions {
  const projectId = request.projectId ?? parent.projectId
  return {
    name: request.name,
    llmConnection: request.llmConnection ?? parent.llmConnection,
    model: request.model ?? parent.model,
    enabledSourceSlugs: request.enabledSourceSlugs ?? parent.enabledSourceSlugs,
    thinkingLevel: request.thinkingLevel ?? parent.thinkingLevel,
    labels: request.labels ?? parent.labels,
    // The parent's folder (a Coding child works in the same checkout), unless the child moves to
    // another project: createSession then uses that project's folder.
    workingDirectory: request.worktreePath
      ?? request.workingDirectory
      ?? (projectId === parent.projectId ? parent.workingDirectory : undefined),
    // createSession resolves inheritance; passing the inherited id as explicit would
    // also make a deleted parent project fail creation instead of falling back.
    projectId: request.projectId,
    // Requested, else the parent's mode both ways, never the workspace default (branches do the same).
    codingMode: request.worktreePath ? true : request.codingMode ?? parent.codingMode === true,
    // Spawned sessions become subtasks of the spawning session.
    parentSessionId: parent.id,
  }
}

/**
 * Why `request` can't be spawned as asked, or undefined. `gitTopLevel` returns null when a folder
 * is missing or not inside a git work tree.
 */
export async function spawnRequestError(
  request: SpawnOverrides,
  gitTopLevel: (dir: string) => Promise<string | null>,
): Promise<string | undefined> {
  const { worktreePath, workingDirectory, codingMode } = request
  if (!worktreePath) return undefined
  if (codingMode === false) {
    return 'worktreePath starts the session in Coding mode: omit codingMode, or pass the folder as workingDirectory for a default-mode session.'
  }
  if (workingDirectory && resolve(workingDirectory) !== resolve(worktreePath)) {
    return 'Pass the folder once: worktreePath or workingDirectory, not both.'
  }
  if (!(await gitTopLevel(worktreePath))) {
    return `worktreePath ${worktreePath} is not inside a git work tree. Create the worktree first (e.g. git worktree add <path> -b <branch>), then pass its path.`
  }
  return undefined
}
