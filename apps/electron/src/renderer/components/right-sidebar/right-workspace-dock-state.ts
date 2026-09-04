export type RightDockTabType = 'brief' | 'artifacts' | 'files'

export interface OpenDockTab {
  id: string
  type: RightDockTabType
}

const RIGHT_DOCK_TAB_TYPES = new Set<RightDockTabType>([
  'brief',
  'artifacts',
  'files',
])

export function normalizeRightDockTabs(value: OpenDockTab[]): OpenDockTab[] {
  const result = value.filter(
    tab => RIGHT_DOCK_TAB_TYPES.has(tab.type) && typeof tab.id === 'string' && tab.id.length > 0
  )
  return result.length > 0 ? result : [
    { id: 'brief', type: 'brief' },
    { id: 'artifacts', type: 'artifacts' },
  ]
}
