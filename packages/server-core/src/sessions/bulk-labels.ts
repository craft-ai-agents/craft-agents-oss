import {
  BULK_UPDATE_MAX_IDS,
  type BulkUpdateSessionsInput,
  type BulkUpdateSessionsPatch,
  type SessionPriority,
} from '@craft-agent/shared/protocol'
import { assertValidBulkLabelPatch } from '@craft-agent/shared/sessions/collection'

const BULK_PATCH_FIELDS: Record<keyof BulkUpdateSessionsPatch, true> = {
  sessionStatus: true,
  priority: true,
  dueDate: true,
  projectId: true,
  labels: true,
  addLabels: true,
  removeLabels: true,
  isFlagged: true,
  isArchived: true,
  kanbanColumn: true,
}

const VALID_PRIORITIES: Record<SessionPriority, true> = {
  none: true,
  urgent: true,
  high: true,
  medium: true,
  low: true,
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (
    !Array.isArray(value)
    || value.some(item => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(`bulk_${field}_invalid`)
  }
}

/**
 * Reject malformed payloads before a manager mutation can begin. RPC inputs
 * are untrusted JSON despite their compile-time TypeScript shape.
 */
export function assertValidBulkUpdateInput(input: unknown): asserts input is BulkUpdateSessionsInput {
  if (
    typeof input !== 'object'
    || input === null
    || Array.isArray(input)
  ) {
    throw new Error('bulk_update_invalid')
  }

  const candidate = input as {
    workspaceId?: unknown
    ids?: unknown
    patch?: unknown
  }
  if (
    typeof candidate.workspaceId !== 'string'
    || candidate.workspaceId.length === 0
    || !Array.isArray(candidate.ids)
    || typeof candidate.patch !== 'object'
    || candidate.patch === null
    || Array.isArray(candidate.patch)
  ) {
    throw new Error('bulk_update_invalid')
  }
  if (candidate.ids.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new Error('bulk_id_invalid')
  }
  if (new Set(candidate.ids).size !== candidate.ids.length) {
    throw new Error('bulk_duplicate_id')
  }
  if (candidate.ids.length > BULK_UPDATE_MAX_IDS) {
    throw new Error('bulk_limit')
  }
}

/** Validate every supported patch field before targets are resolved. */
export function assertValidBulkUpdatePatch(patch: unknown): asserts patch is BulkUpdateSessionsPatch {
  if (
    typeof patch !== 'object'
    || patch === null
    || Array.isArray(patch)
  ) {
    throw new Error('bulk_patch_invalid')
  }

  const candidate = patch as Record<string, unknown>
  if ('rank' in candidate) {
    throw new Error('bulk_rank_forbidden')
  }
  if (Object.keys(candidate).length === 0) {
    throw new Error('bulk_patch_empty')
  }
  for (const field of Object.keys(candidate)) {
    if (!Object.prototype.hasOwnProperty.call(BULK_PATCH_FIELDS, field)) {
      throw new Error(`bulk_patch_unknown_field:${field}`)
    }
  }

  if (
    'sessionStatus' in candidate
    && (typeof candidate.sessionStatus !== 'string' || candidate.sessionStatus.length === 0)
  ) {
    throw new Error('bulk_sessionStatus_invalid')
  }
  if (
    'priority' in candidate
    && (
      typeof candidate.priority !== 'string'
      || !Object.prototype.hasOwnProperty.call(VALID_PRIORITIES, candidate.priority)
    )
  ) {
    throw new Error('bulk_priority_invalid')
  }
  if (
    'dueDate' in candidate
    && candidate.dueDate !== null
    && (typeof candidate.dueDate !== 'number' || !Number.isFinite(candidate.dueDate))
  ) {
    throw new Error('bulk_dueDate_invalid')
  }
  if (
    'projectId' in candidate
    && candidate.projectId !== null
    && (typeof candidate.projectId !== 'string' || candidate.projectId.length === 0)
  ) {
    throw new Error('bulk_projectId_invalid')
  }
  if (
    'kanbanColumn' in candidate
    && candidate.kanbanColumn !== null
    && (typeof candidate.kanbanColumn !== 'string' || candidate.kanbanColumn.length === 0)
  ) {
    throw new Error('bulk_kanbanColumn_invalid')
  }
  if ('isFlagged' in candidate && typeof candidate.isFlagged !== 'boolean') {
    throw new Error('bulk_isFlagged_invalid')
  }
  if ('isArchived' in candidate && typeof candidate.isArchived !== 'boolean') {
    throw new Error('bulk_isArchived_invalid')
  }
  for (const field of ['labels', 'addLabels', 'removeLabels'] as const) {
    if (field in candidate) {
      assertStringArray(candidate[field], field)
    }
  }

  assertValidBulkLabelPatch(candidate as BulkUpdateSessionsPatch)
}

