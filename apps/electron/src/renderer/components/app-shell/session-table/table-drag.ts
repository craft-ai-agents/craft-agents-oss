import type { SessionMeta } from '@/atoms/sessions'
import type { SessionCommand, SessionPriority } from '@craft-agent/shared/protocol/dto'
import type { CollectionGroupBy } from '@craft-agent/shared/sessions/collection'

export type CrossGroupDropAction = {
  metadataPatch: Partial<Pick<SessionMeta, 'sessionStatus' | 'priority' | 'projectId'>>
  command: Extract<SessionCommand, { type: 'setSessionStatus' | 'setPriority' | 'setProjectId' }>
}

/**
 * Convert a table group bucket to the one writable field FR-47 permits drag to change.
 * Due-date buckets are derived ranges; label buckets are multi-valued, so neither has a
 * deterministic cross-group rewrite.
 */
export function crossGroupDropAction(
  groupBy: CollectionGroupBy,
  targetBucketKey: string,
): CrossGroupDropAction | null {
  switch (groupBy) {
    case 'status': {
      if (!targetBucketKey.startsWith('status:')) return null
      const state = targetBucketKey.slice('status:'.length)
      return state
        ? { metadataPatch: { sessionStatus: state }, command: { type: 'setSessionStatus', state } }
        : null
    }
    case 'priority': {
      if (!targetBucketKey.startsWith('priority:')) return null
      const priority = targetBucketKey.slice('priority:'.length) as SessionPriority
      return priority
        ? { metadataPatch: { priority }, command: { type: 'setPriority', priority } }
        : null
    }
    case 'project': {
      if (!targetBucketKey.startsWith('project:')) return null
      const projectId = targetBucketKey.slice('project:'.length)
      return {
        metadataPatch: { projectId: projectId || undefined },
        command: { type: 'setProjectId', projectId: projectId || null },
      }
    }
    case 'none':
    case 'dueDate':
    case 'label':
      return null
  }
}
