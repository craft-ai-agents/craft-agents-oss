/**
 * Nested outline list for a MindMapGraph (Entity tab Outline + Host split pane).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MindMapGraph, MindMapNodeId } from '@craft-agent/core/mindmap'

export interface MindMapOutlineProps {
  graph: MindMapGraph
  selectedId?: MindMapNodeId | null
  onSelect?: (id: MindMapNodeId | null) => void
  onNavigate?: (source: { kind: string; id: string }) => void
  className?: string
}

export function MindMapOutline({
  graph,
  selectedId,
  onSelect,
  onNavigate,
  className,
}: MindMapOutlineProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = React.useState<Record<string, true>>({})

  const toggle = (id: MindMapNodeId) => {
    setCollapsed((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  const renderNode = (id: MindMapNodeId, depth: number): React.ReactNode => {
    const node = graph.nodes[id]
    if (!node) return null
    const hasChildren = node.children.length > 0
    const isCollapsed = Boolean(collapsed[id])
    const selected = selectedId === id

    return (
      <div key={id} className="min-w-0">
        <div
          className="flex items-center gap-1"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              title={t(isCollapsed ? 'mindmap.expandNode' : 'mindmap.collapseNode')}
              aria-label={t(isCollapsed ? 'mindmap.expandNode' : 'mindmap.collapseNode')}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(id)}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => {
              onSelect?.(id)
              if (node.source) onNavigate?.(node.source)
            }}
            className={cn(
              'min-w-0 flex-1 flex items-center gap-1 rounded-[8px] px-1 py-1 text-left text-sm transition-colors',
              selected
                ? 'bg-foreground/10 text-foreground'
                : 'text-foreground/90 hover:bg-foreground/5',
            )}
          >
            <span className="truncate">{node.label}</span>
            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {node.kind}
            </span>
          </button>
        </div>
        {hasChildren && !isCollapsed
          ? node.children.map((childId) => renderNode(childId, depth + 1))
          : null}
      </div>
    )
  }

  return (
    <div className={cn('flex-1 min-h-0 overflow-auto py-2 px-1', className)}>
      {renderNode(graph.rootId, 0)}
    </div>
  )
}
