/**
 * What a session spawned with the spawn_session tool inherits from the session that spawned it.
 * Extracted from the SessionManager callback so the inheritance rules are unit-testable.
 */

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
    workingDirectory: request.workingDirectory ?? (projectId === parent.projectId ? parent.workingDirectory : undefined),
    projectId,
    // The parent's mode both ways, never the workspace default (branches do the same).
    codingMode: parent.codingMode === true,
    // Spawned sessions become subtasks of the spawning session.
    parentSessionId: parent.id,
  }
}
