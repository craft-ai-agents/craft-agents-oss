import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { type CollectionDisplay,
type SessionPriority, } from '@craft-agent/shared/sessions/collection'
import type { SessionStatus } from '@/config/session-status-config'
import {
  collectionDisplayAtom,
  loadCollectionDisplayAtom,
  replaceCollectionDisplayAtom,
  setCollectionDisplayAtom,
} from '@/atoms/collection-display'
import { collectionFiltersAtom } from '@/atoms/collection-filters'
import { CollectionViewToggle, type CollectionViewMode } from '../kanban/BoardListToggle'
import { CollectionDisplayPopover } from './CollectionDisplayPopover'
import { CollectionOpsBar } from './CollectionOpsBar'
import { cn } from '@/lib/utils'

const DEFAULT_PRIORITIES: SessionPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

export interface CollectionViewChromeProps {
  workspaceId: string | null | undefined
  viewMode: CollectionViewMode
  onViewModeChange: (mode: CollectionViewMode) => void
  /** Compact header: toggle + Display only (list/board headers). */
  compact?: boolean
  statuses?: SessionStatus[]
  priorities?: SessionPriority[]
  projects?: Array<{ id: string; name: string }>
  labels?: Array<{ id: string; name: string }>
  className?: string
}

/**
 * Loads CollectionDisplay for workspace and renders either:
 * - compact: CollectionViewToggle + Display popover (list/board toolbars)
 * - full: CollectionOpsBar strip with filter chips (table host already uses its own)
 */
export function CollectionViewChrome({
  workspaceId,
  viewMode,
  onViewModeChange,
  compact = true,
  statuses = [],
  priorities = DEFAULT_PRIORITIES,
  projects = [],
  labels = [],
  className,
}: CollectionViewChromeProps) {
  const display = useAtomValue(collectionDisplayAtom)
  const setDisplay = useSetAtom(setCollectionDisplayAtom)
  const replaceDisplay = useSetAtom(replaceCollectionDisplayAtom)
  const loadDisplay = useSetAtom(loadCollectionDisplayAtom)
  const filters = useAtomValue(collectionFiltersAtom)
  const setFilters = useSetAtom(collectionFiltersAtom)

  React.useEffect(() => {
    void loadDisplay(workspaceId)
  }, [workspaceId, loadDisplay])

  React.useEffect(() => {
    if (!workspaceId || typeof window === 'undefined') return
    const api = window.electronAPI
    if (!api?.onCollectionDisplayChanged) return
    return api.onCollectionDisplayChanged((wsId, next) => {
      if (wsId !== workspaceId) return
      replaceDisplay(next)
    })
  }, [workspaceId, replaceDisplay])

  const handleDisplayChange = React.useCallback(
    (next: CollectionDisplay) => {
      void setDisplay({ display: next, workspaceId })
    },
    [setDisplay, workspaceId],
  )

  const toggle = (
    <CollectionViewToggle value={viewMode} onChange={onViewModeChange} />
  )

  if (compact) {
    return (
      <div className={cn('inline-flex items-center gap-2', className)}>
        {toggle}
        <CollectionDisplayPopover display={display} onDisplayChange={handleDisplayChange} />
      </div>
    )
  }

  return (
    <CollectionOpsBar
      display={display}
      filters={filters}
      onDisplayChange={handleDisplayChange}
      onFiltersChange={setFilters}
      statuses={statuses}
      priorities={priorities}
      projects={projects}
      labels={labels}
      trailing={toggle}
      className={className}
    />
  )
}
