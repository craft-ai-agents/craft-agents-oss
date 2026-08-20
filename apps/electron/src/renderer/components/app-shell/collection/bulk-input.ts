import type { BulkUpdateSessionsPatch } from '@craft-agent/shared/protocol/dto'

/** Native select values cannot distinguish an empty placeholder from no project. */
export const NO_PROJECT_VALUE = '__collection_no_project__'

export function projectPatchForBulkValue(value: string): BulkUpdateSessionsPatch | null {
  if (!value) return null
  return { projectId: value === NO_PROJECT_VALUE ? null : value }
}
