/**
 * Craft-side EntityViewTabs around a knowledge document/block.
 * Standard/Graph → embedded SiYuan surface; Map/Outline → Craft mind-map projection.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeRef } from '@craft-agent/core/knowledge'
import { deriveKnowledgeMindMap, type MindMapGraph } from '@craft-agent/core/mindmap'
import {
  defaultKnowledgeEntityCapabilities,
  EntityViewTabs,
  useEntityView,
  type EntityViewId,
} from '@/components/app-shell/EntityViewTabs'
import { useAppShellContext } from '@/context/AppShellContext'
import { useSiyuanConnected } from '@/hooks/useSiyuanConnected'
import { MindMapHost } from '@/mindmap/MindMapHost'
import KnowledgeSurfacePage from '@/pages/KnowledgeSurfacePage'
import type { SiyuanSurfaceRef } from '@/knowledge/siyuan-url'

export interface KnowledgeEntityPageProps {
  kind: SiyuanSurfaceRef['kind']
  id: string
  panelId?: string
}

export default function KnowledgeEntityPage({ kind, id, panelId }: KnowledgeEntityPageProps) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const siyuanConnected = useSiyuanConnected()
  const capabilities = React.useMemo(
    () => defaultKnowledgeEntityCapabilities({ siyuanConnected: siyuanConnected ?? false }),
    [siyuanConnected],
  )
  const [view, setView] = useEntityView(`knowledge:${kind}:${id}`, capabilities, 'standard')

  const [graph, setGraph] = React.useState<MindMapGraph | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (view !== 'map' && view !== 'outline') {
      setGraph(null)
      setError(null)
      setLoading(false)
      return
    }
    if (!activeWorkspaceId) {
      setError(t('knowledge.inspector.noConnection'))
      setGraph(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const connections = await window.electronAPI.knowledge.listConnections()
        // Prefer default-local connection over arbitrary [0] when multi-connection.
        const connectionId =
          connections.find((c) => c.id === 'siyuan-local')?.id ??
          connections.find((c) => (c.label ?? '').toLowerCase().includes('local'))?.id ??
          connections[0]?.id
        if (!connectionId) throw new Error(t('knowledge.inspector.noConnection'))

        const ref: KnowledgeRef = { scheme: 'siyuan', kind: kind as KnowledgeRef['kind'], id }
        const args = { workspaceId: activeWorkspaceId, connectionId, ref }

        const node = await window.electronAPI.knowledge.get(args)
        const backlinks = await window.electronAPI.knowledge.getBacklinks(args).catch(() => [])

        let children: Array<{ blockId: string; content: string }> | undefined
        try {
          const ctx = await window.electronAPI.knowledge.getContext({
            ...args,
            mode: 'live-reference',
          })
          if (ctx?.children?.length) {
            children = ctx.children.map((c) => ({
              blockId: c.blockId,
              content: c.content,
            }))
          }
        } catch {
          // outline from markdown
        }

        if (cancelled) return
        setGraph(
          deriveKnowledgeMindMap({
            ref,
            title: node?.title || id,
            content: node?.markdown ?? '',
            children,
            backlinks: (backlinks ?? []).map((b) => ({
              ref: b.ref,
              title: b.title || b.ref.id,
            })),
          }),
        )
      } catch (e) {
        if (!cancelled) {
          setGraph(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [view, kind, id, activeWorkspaceId, t])

  let body: React.ReactNode
  if (view === 'map' || view === 'outline') {
    body = (
      <MindMapHost
        entity={{ type: 'knowledge', ref: { scheme: 'siyuan', kind: kind as KnowledgeRef['kind'], id } }}
        graph={graph}
        loading={loading}
        error={error}
        mode={view}
        workspaceId={activeWorkspaceId || undefined}
      />
    )
  } else if (view === 'graph') {
    body = <KnowledgeSurfacePage kind={kind} id={id} panelId={panelId} mode="graph" />
  } else {
    body = <KnowledgeSurfacePage kind={kind} id={id} panelId={panelId} mode="editor" />
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <EntityViewTabs
        value={view}
        onChange={setView as (id: EntityViewId) => void}
        capabilities={capabilities}
      />
      <div className="flex-1 flex flex-col min-h-0">{body}</div>
    </div>
  )
}
