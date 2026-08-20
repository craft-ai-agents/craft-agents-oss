/**
 * Session multi-view tabs — thin wrapper over EntityViewTabs (backward-compatible exports).
 * Graph = SiYuan global-graph; map = Craft mind map; mindmap = legacy SiYuan map label.
 */

import * as React from 'react'
import {
  defaultSessionEntityCapabilities,
  EntityViewPlaceholder,
  EntityViewTabs,
  useEntityView,
  type EntityViewId,
} from './EntityViewTabs'
import { useSiyuanConnected } from '@/hooks/useSiyuanConnected'

/** Alias of EntityViewId for existing session callers. */
export type SessionViewId = EntityViewId

export function useSessionView(sessionId: string): [SessionViewId, (id: SessionViewId) => void] {
  const siyuanConnected = useSiyuanConnected()
  const capabilities = React.useMemo(
    () => defaultSessionEntityCapabilities({ siyuanConnected: siyuanConnected ?? false }),
    [siyuanConnected],
  )
  return useEntityView(`session:${sessionId}`, capabilities, 'standard')
}

export interface SessionViewTabsProps {
  value: SessionViewId
  onChange: (id: SessionViewId) => void
  className?: string
}

export function SessionViewTabs({ value, onChange, className }: SessionViewTabsProps) {
  const siyuanConnected = useSiyuanConnected()
  const capabilities = React.useMemo(
    () => defaultSessionEntityCapabilities({ siyuanConnected: siyuanConnected ?? false }),
    [siyuanConnected],
  )
  return (
    <EntityViewTabs
      value={value}
      onChange={onChange}
      capabilities={capabilities}
      className={className}
    />
  )
}

export interface SessionViewPlaceholderProps {
  view: SessionViewId
}

export function SessionViewPlaceholder({ view }: SessionViewPlaceholderProps) {
  return <EntityViewPlaceholder view={view} />
}
