/**
 * Craft SVG mind-map engine — LR tree, pan/zoom, collapse, minimap.
 */

import * as React from 'react'
import { GitFork, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  addPinnedCustomNode,
  autoLayout,
  deletePinnedCustomNode,
  layoutBounds,
  MAX_CUSTOM_MIND_MAP_LABEL_LENGTH,
  PinnedMindMapEditError,
  reparentPinnedCustomNode,
  renamePinnedCustomNode,
  type MindMapLayout,
  type MindMapNodeId,
} from '@craft-agent/core/mindmap'
import { MindMapMinimap } from './minimap'
import {
  MIND_MAP_NODE_HEIGHT,
  MIND_MAP_NODE_WIDTH,
  type MindMapEngineProps,
} from './types'
import { clampMindMapZoom, fitMindMapViewport } from './fit'
const ZOOM_IN = 1.1
const ZOOM_OUT = 1 / ZOOM_IN



function normalizeCollapsed(
  collapsed: MindMapEngineProps['collapsed'],
): MindMapNodeId[] {
  if (!collapsed) return []
  if (collapsed instanceof Set) return [...collapsed]
  return [...collapsed]
}

function parentBezier(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
}

function truncateLabel(label: string, max: number): string {
  const t = label.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1))}…`
}

type StructureEditor =
  | { mode: 'add'; parentId: MindMapNodeId; label: string }
  | { mode: 'rename'; nodeId: MindMapNodeId; label: string }
  | { mode: 'reparent'; nodeId: MindMapNodeId; parentId: MindMapNodeId }

export type SvgMindMapViewProps = Omit<MindMapEngineProps, 'layout' | 'mode'> & {
  layout?: MindMapLayout | 'auto'
  /** Bump to request fitView from host toolbar */
  fitRequestKey?: number
}

export type SvgMindMapViewHandle = {
  fitView: () => void
  zoomBy: (factor: number) => void
  getViewport: () => { x: number; y: number; zoom: number }
}

export const SvgMindMapView = React.forwardRef<SvgMindMapViewHandle, SvgMindMapViewProps>(
  function SvgMindMapView(
    {
      graph,
      layout: layoutProp = 'auto',
      readOnlyStructure = true,
      selectedId = null,
      searchQuery = '',
      collapsed: collapsedProp,
      className,
      onGraphChange,
      onLayoutChange,
      onNavigate,
      onSelect,
      onToggleCollapse,
      fitRequestKey = 0,
    },
    ref,
  ) {
    const containerRef = React.useRef<HTMLDivElement>(null)
    const [size, setSize] = React.useState({ width: 0, height: 0 })
    const [pan, setPan] = React.useState({ x: 48, y: 48 })
    const [zoom, setZoom] = React.useState(1)
    const dragRef = React.useRef<{
      pointerId: number
      startX: number
      startY: number
      origPanX: number
      origPanY: number
    } | null>(null)
    const [isPanning, setIsPanning] = React.useState(false)
    const { t } = useTranslation()
    const [structureEditor, setStructureEditor] = React.useState<StructureEditor | null>(null)
    const [structureError, setStructureError] = React.useState<string | null>(null)
    const [structureNotice, setStructureNotice] = React.useState<string | null>(null)

    const collapsedList = React.useMemo(
      () => normalizeCollapsed(collapsedProp),
      [collapsedProp],
    )
    const collapsedSet = React.useMemo(() => new Set(collapsedList), [collapsedList])

    const layout: MindMapLayout = React.useMemo(() => {
      if (layoutProp !== 'auto' && layoutProp && collapsedProp === undefined) {
        if (Object.keys(layoutProp.positions).length > 0) return layoutProp
      }
      return autoLayout(graph, {
        collapsed: collapsedList,
        hGap: 200,
        vGap: 56,
        nodeWidth: MIND_MAP_NODE_WIDTH,
        nodeHeight: MIND_MAP_NODE_HEIGHT,
      })
    }, [graph, layoutProp, collapsedList, collapsedProp])

    React.useEffect(() => {
      onLayoutChange?.(layout)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid callback churn loops
    }, [layout])

    const q = searchQuery.trim().toLowerCase()
    const nodeCount = Object.keys(graph.nodes).length
    const visibleCount = Object.keys(layout.positions).length

    React.useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const ro = new ResizeObserver((entries) => {
        const cr = entries[0]?.contentRect
        if (!cr) return
        setSize({ width: cr.width, height: cr.height })
      })
      ro.observe(el)
      const r = el.getBoundingClientRect()
      setSize({ width: r.width, height: r.height })
      return () => ro.disconnect()
    }, [])

    // Expand point-bounds by half chip so fit includes full node rects
    const bounds = React.useMemo(() => {
      const half = Math.max(MIND_MAP_NODE_WIDTH, MIND_MAP_NODE_HEIGHT) / 2 + 24
      return layoutBounds(layout, half)
    }, [layout])

    const fitView = React.useCallback(() => {
      const viewport = fitMindMapViewport(size, bounds)
      if (!viewport) return
      setZoom(viewport.zoom)
      setPan({ x: viewport.x, y: viewport.y })
    }, [bounds, size])

    const zoomBy = React.useCallback(
      (factor: number) => {
        const { width, height } = size
        const mx = width / 2
        const my = height / 2
        setZoom((prev) => {
          const next = clampMindMapZoom(prev * factor)
          const worldX = (mx - pan.x) / prev
          const worldY = (my - pan.y) / prev
          setPan({
            x: mx - worldX * next,
            y: my - worldY * next,
          })
          return next
        })
      },
      [pan.x, pan.y, size],
    )

    React.useImperativeHandle(
      ref,
      () => ({
        fitView,
        zoomBy,
        getViewport: () => ({ x: pan.x, y: pan.y, zoom }),
      }),
      [fitView, zoomBy, pan.x, pan.y, zoom],
    )

    const graphKey = `${graph.contentHash}:${graph.rootId}`

    // Re-fit after graph layout, mount sizing, and every container resize.
    React.useLayoutEffect(() => {
      fitView()
    }, [graphKey, layout, size.width, size.height, fitView])

    React.useEffect(() => {
      if (fitRequestKey > 0) fitView()
    }, [fitRequestKey, fitView])

    const onWheel = (e: React.WheelEvent) => {
      e.preventDefault()
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? ZOOM_IN : ZOOM_OUT
      setZoom((prev) => {
        const next = clampMindMapZoom(prev * factor)
        const worldX = (mx - pan.x) / prev
        const worldY = (my - pan.y) / prev
        setPan({
          x: mx - worldX * next,
          y: my - worldY * next,
        })
        return next
      })
    }

    const onPointerDownBg = (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as Element
      if (target.closest('[data-mindmap-node]')) return
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
      }
      setIsPanning(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      setPan({
        x: d.origPanX + (e.clientX - d.startX),
        y: d.origPanY + (e.clientY - d.startY),
      })
    }

    const endPan = (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      dragRef.current = null
      setIsPanning(false)
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }

    const handleMinimapNav = React.useCallback(
      (world: { x: number; y: number }) => {
        if (size.width <= 0 || size.height <= 0) return
        setPan({
          x: size.width / 2 - world.x * zoom,
          y: size.height / 2 - world.y * zoom,
        })
      },
      [size.width, size.height, zoom],
    )

    const canEditStructure = !readOnlyStructure && Boolean(onGraphChange)
    const selectedNode = selectedId ? graph.nodes[selectedId] : undefined
    const selectedCustomNode = selectedNode?.kind === 'custom' ? selectedNode : undefined
    const parentOptions = React.useMemo(() => Object.values(graph.nodes), [graph.nodes])

    React.useEffect(() => {
      if (canEditStructure) return
      setStructureEditor(null)
      setStructureError(null)
      setStructureNotice(null)
    }, [canEditStructure])

    const structureErrorMessage = (error: unknown): string => {
      if (error instanceof PinnedMindMapEditError) {
        switch (error.code) {
          case 'invalid-label':
            return t('mindmap.invalidNodeLabel')
          case 'cannot-delete-root':
            return t('mindmap.cannotDeleteRoot')
          case 'cannot-reparent-root':
            return t('mindmap.cannotReparentRoot')
          case 'cannot-reparent-descendant':
            return t('mindmap.cannotReparentDescendant')
          default:
            return t('mindmap.invalidParent')
        }
      }
      return t('mindmap.invalidParent')
    }

    const submitStructureEdit = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!structureEditor || !onGraphChange) return
      try {
        let nextGraph = graph
        let nextSelection: MindMapNodeId | null | undefined
        let notice = ''

        if (structureEditor.mode === 'add') {
          nextGraph = addPinnedCustomNode(
            graph,
            structureEditor.parentId,
            structureEditor.label,
          )
          nextSelection =
            Object.keys(nextGraph.nodes).find((nodeId) => !graph.nodes[nodeId]) ?? null
          notice = t('mindmap.nodeAdded')
        } else if (structureEditor.mode === 'rename') {
          nextGraph = renamePinnedCustomNode(graph, structureEditor.nodeId, structureEditor.label)
          notice = t('mindmap.nodeRenamed')
        } else {
          nextGraph = reparentPinnedCustomNode(
            graph,
            structureEditor.nodeId,
            structureEditor.parentId,
          )
          notice = t('mindmap.nodeReparented')
        }

        onGraphChange(nextGraph)
        if (nextSelection !== undefined) onSelect?.(nextSelection)
        setStructureEditor(null)
        setStructureError(null)
        setStructureNotice(notice)
      } catch (error) {
        setStructureError(structureErrorMessage(error))
      }
    }

    const deleteSelectedCustomNode = () => {
      if (!selectedCustomNode || !onGraphChange) return
      try {
        const nextGraph = deletePinnedCustomNode(graph, selectedCustomNode.id)
        onGraphChange(nextGraph)
        const nextSelection =
          selectedCustomNode.parentId && nextGraph.nodes[selectedCustomNode.parentId]
            ? selectedCustomNode.parentId
            : nextGraph.rootId
        onSelect?.(nextSelection)
        setStructureEditor(null)
        setStructureError(null)
        setStructureNotice(t('mindmap.nodeDeleted'))
      } catch (error) {
        setStructureError(structureErrorMessage(error))
      }
    }

    const visibleIds = React.useMemo(
      () => new Set(Object.keys(layout.positions)),
      [layout.positions],
    )

    const edges = React.useMemo(() => {
      const out: Array<{ id: string; kind: 'parent' | 'backlink' | 'ref'; d: string }> = []
      for (const edge of graph.edges) {
        const from = layout.positions[edge.from]
        const to = layout.positions[edge.to]
        if (!from || !to) continue
        if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue

        // autoLayout positions are node centers
        if (edge.kind === 'parent') {
          const x1 = from.x + MIND_MAP_NODE_WIDTH / 2
          const y1 = from.y
          const x2 = to.x - MIND_MAP_NODE_WIDTH / 2
          const y2 = to.y
          out.push({ id: edge.id, kind: 'parent', d: parentBezier(x1, y1, x2, y2) })
        } else {
          out.push({
            id: edge.id,
            kind: edge.kind,
            d: parentBezier(from.x, from.y, to.x, to.y),
          })
        }
      }
      return out
    }, [graph.edges, layout.positions, visibleIds])

    const nodes = React.useMemo(() => {
      const list: Array<{
        id: MindMapNodeId
        x: number
        y: number
        label: string
        kind: string
        hasChildren: boolean
        isCollapsed: boolean
        selected: boolean
        dimmed: boolean
        source?: { kind: string; id: string }
      }> = []
      for (const [id, pos] of Object.entries(layout.positions)) {
        if (!pos) continue
        const node = graph.nodes[id]
        if (!node) continue
        const hasChildren = node.children.length > 0
        const isCollapsed = collapsedSet.has(id) || Boolean(node.collapsed)
        const label = node.label || id
        const dimmed = q.length > 0 && !label.toLowerCase().includes(q)
        list.push({
          id,
          x: pos.x,
          y: pos.y,
          label,
          kind: node.kind,
          hasChildren,
          isCollapsed,
          selected: selectedId === id,
          dimmed,
          source: node.source,
        })
      }
      return list
    }, [layout.positions, graph.nodes, collapsedSet, selectedId, q])


    return (
      <div
        ref={containerRef}
        className={cn(
          'relative flex-1 min-h-0 min-w-0 overflow-hidden bg-background touch-none select-none',
          isPanning ? 'cursor-grabbing' : 'cursor-grab',
          className,
        )}
        onWheel={onWheel}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <svg
          width="100%"
          height="100%"
          className="absolute inset-0 block h-full w-full"
          style={{ overflow: 'hidden' }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <g className="pointer-events-none">
              {edges.map((e) => (
                <path
                  key={e.id}
                  d={e.d}
                  fill="none"
                  className={
                    e.kind === 'parent' ? 'stroke-border/70' : 'stroke-muted-foreground/50'
                  }
                  strokeWidth={e.kind === 'parent' ? 1.5 : 1.25}
                  strokeDasharray={e.kind === 'parent' ? undefined : '4 3'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>

            <g>
              {nodes.map((n) => {
                const x = n.x - MIND_MAP_NODE_WIDTH / 2
                const y = n.y - MIND_MAP_NODE_HEIGHT / 2
                return (
                  <g
                    key={n.id}
                    data-mindmap-node={n.id}
                    transform={`translate(${x}, ${y})`}
                    className={cn('cursor-pointer', n.dimmed ? 'opacity-25' : 'opacity-100')}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect?.(n.id)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onSelect?.(n.id)
                      if (n.source) onNavigate?.(n.source)
                    }}
                  >
                    <rect
                      width={MIND_MAP_NODE_WIDTH}
                      height={MIND_MAP_NODE_HEIGHT}
                      rx={10}
                      ry={10}
                      className={cn(
                        'fill-background stroke-border/60',
                        n.kind === 'root' && 'fill-foreground/[0.03]',
                        n.selected && 'stroke-foreground/70 fill-foreground/[0.06]',
                      )}
                      strokeWidth={n.selected ? 2 : 1}
                    />
                    {n.selected ? (
                      <rect
                        x={-3}
                        y={-3}
                        width={MIND_MAP_NODE_WIDTH + 6}
                        height={MIND_MAP_NODE_HEIGHT + 6}
                        rx={12}
                        ry={12}
                        className="fill-none stroke-foreground/30"
                        strokeWidth={1}
                      />
                    ) : null}

                    {n.hasChildren ? (
                      <g
                        transform={`translate(${MIND_MAP_NODE_WIDTH - 22}, ${MIND_MAP_NODE_HEIGHT / 2 - 9})`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleCollapse?.(n.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          e.stopPropagation()
                          onToggleCollapse?.(n.id)
                        }}
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-expanded={!n.isCollapsed}
                        aria-label={t(n.isCollapsed ? 'mindmap.expandNode' : 'mindmap.collapseNode')}
                      >
                        <circle
                          cx={9}
                          cy={9}
                          r={9}
                          className="fill-muted stroke-border/70"
                          strokeWidth={1}
                        />
                        <text
                          x={9}
                          y={9.5}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="fill-muted-foreground"
                          style={{ fontSize: 12, fontFamily: 'inherit' }}
                        >
                          {n.isCollapsed ? '+' : '−'}
                        </text>
                      </g>
                    ) : null}

                    <text
                      x={12}
                      y={MIND_MAP_NODE_HEIGHT / 2 + 0.5}
                      dominantBaseline="middle"
                      className="fill-foreground/80"
                      style={{ fontSize: 12, fontFamily: 'inherit' }}
                    >
                      {truncateLabel(n.label, n.hasChildren ? 20 : 24)}
                    </text>
                  </g>
                )
              })}
            </g>
          </g>
        </svg>

        {canEditStructure ? (
          <div
            className="absolute left-3 top-3 z-10 max-w-[min(20rem,calc(100%-1.5rem))] rounded-lg border border-border/60 bg-background/95 p-1.5 shadow-sm backdrop-blur"
            data-mindmap-structure-controls
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                title={t('mindmap.addNode')}
                aria-label={t('mindmap.addNode')}
                onClick={() => {
                  setStructureEditor({
                    mode: 'add',
                    parentId: selectedNode?.id ?? graph.rootId,
                    label: '',
                  })
                  setStructureError(null)
                  setStructureNotice(null)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              {selectedCustomNode ? (
                <>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    title={t('mindmap.renameNode')}
                    aria-label={t('mindmap.renameNode')}
                    onClick={() => {
                      setStructureEditor({
                        mode: 'rename',
                        nodeId: selectedCustomNode.id,
                        label: selectedCustomNode.label,
                      })
                      setStructureError(null)
                      setStructureNotice(null)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    title={t('mindmap.reparentNode')}
                    aria-label={t('mindmap.reparentNode')}
                    onClick={() => {
                      setStructureEditor({
                        mode: 'reparent',
                        nodeId: selectedCustomNode.id,
                        parentId: selectedCustomNode.parentId ?? graph.rootId,
                      })
                      setStructureError(null)
                      setStructureNotice(null)
                    }}
                  >
                    <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    title={t('mindmap.deleteNode')}
                    aria-label={t('mindmap.deleteNode')}
                    onClick={deleteSelectedCustomNode}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </div>

            {structureNotice ? (
              <p className="px-1 pt-1 text-[11px] text-muted-foreground" role="status">
                {structureNotice}
              </p>
            ) : null}

            {structureEditor ? (
              <form
                className="mt-1.5 space-y-1.5 border-t border-border/50 pt-1.5"
                aria-label={
                  structureEditor.mode === 'add'
                    ? t('mindmap.addNode')
                    : structureEditor.mode === 'rename'
                      ? t('mindmap.renameNode')
                      : t('mindmap.reparentNode')
                }
                onSubmit={submitStructureEdit}
              >
                {structureEditor.mode !== 'rename' ? (
                  <label className="block space-y-0.5 px-1 text-[11px] text-muted-foreground">
                    <span>{t('mindmap.parentNode')}</span>
                    <select
                      className="h-7 w-full rounded-md border border-border/60 bg-background px-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
                      value={structureEditor.parentId}
                      onChange={(event) => {
                        const parentId = event.target.value
                        setStructureEditor((current) =>
                          current && current.mode !== 'rename' ? { ...current, parentId } : current,
                        )
                      }}
                    >
                      {parentOptions.map((node) => (
                        <option
                          key={node.id}
                          value={node.id}
                          disabled={
                            structureEditor.mode === 'reparent' &&
                            node.id === structureEditor.nodeId
                          }
                        >
                          {node.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {structureEditor.mode !== 'reparent' ? (
                  <label className="block space-y-0.5 px-1 text-[11px] text-muted-foreground">
                    <span>{t('mindmap.nodeLabel')}</span>
                    <input
                      autoFocus
                      required
                      maxLength={MAX_CUSTOM_MIND_MAP_LABEL_LENGTH}
                      className="h-7 w-full rounded-md border border-border/60 bg-background px-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
                      value={structureEditor.label}
                      aria-invalid={Boolean(structureError)}
                      onChange={(event) => {
                        const label = event.target.value
                        setStructureEditor((current) =>
                          current && current.mode !== 'reparent' ? { ...current, label } : current,
                        )
                      }}
                    />
                  </label>
                ) : null}

                {structureError ? (
                  <p className="px-1 text-[11px] text-destructive" role="alert">
                    {structureError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-1 px-1">
                  <button
                    type="button"
                    className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    onClick={() => {
                      setStructureEditor(null)
                      setStructureError(null)
                    }}
                  >
                    {t('mindmap.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="h-7 rounded-md bg-foreground px-2 text-xs font-medium text-background hover:bg-foreground/90"
                  >
                    {t('mindmap.saveNode')}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        <MindMapMinimap
          layout={layout}
          bounds={bounds}
          pan={pan}
          zoom={zoom}
          viewportSize={size}
          nodeCount={visibleCount > 0 ? visibleCount : nodeCount}
          selectedId={selectedId}
          onNavigateTo={handleMinimapNav}
        />
      </div>
    )
  },
)

export default SvgMindMapView
