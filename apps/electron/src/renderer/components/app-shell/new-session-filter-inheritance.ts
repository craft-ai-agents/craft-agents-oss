export type FilterMode = 'include' | 'exclude'

export interface InheritedNewSessionParams {
  status?: string
  label?: string
  project?: string
}

type FilterMap = ReadonlyMap<string, FilterMode>

/**
 * Resolve the sole included filter that a new session should inherit.
 * Excluded filters are intentionally ignored because they describe which
 * sessions to hide, not attributes to apply to newly created sessions.
 */
export function resolveInheritedNewSessionParams(
  statusFilter: FilterMap,
  labelFilter: FilterMap,
  projectFilter: FilterMap,
): InheritedNewSessionParams | null {
  const candidates: InheritedNewSessionParams[] = []

  for (const [status, mode] of statusFilter) {
    if (mode === 'include') candidates.push({ status })
  }
  for (const [label, mode] of labelFilter) {
    if (mode === 'include') candidates.push({ label })
  }
  for (const [project, mode] of projectFilter) {
    if (mode === 'include') candidates.push({ project })
  }

  return candidates.length === 1 ? candidates[0] : null
}
