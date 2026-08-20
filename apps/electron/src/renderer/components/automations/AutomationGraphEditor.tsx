import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Braces, GitBranch, Group, MessageSquare, Plus, Save, Trash2, Webhook } from 'lucide-react'
import { compileAutomationGraph } from '@craft-agent/shared/automations/graph'
import type { AutomationGraph, AutomationGraphNode } from '@craft-agent/shared/automations/types'
import { cn } from '@/lib/utils'

export interface AutomationGraphEditorProps {
  graph: AutomationGraph
  onChange: (graph: AutomationGraph) => void
  onSave: (graph: AutomationGraph) => Promise<void> | void
  selectedNodeId?: string | null
  onSelectedNodeChange?: (nodeId: string | null) => void
  disabled?: boolean
  className?: string
}

type MetadataKind = 'annotation' | 'group' | 'decision'

const NODE_ACCENT: Record<AutomationGraphNode['kind'], string> = {
  trigger: 'border-sky-500/35 bg-sky-500/[0.08] text-sky-700 dark:text-sky-300',
  matcher: 'border-violet-500/35 bg-violet-500/[0.08] text-violet-700 dark:text-violet-300',
  prompt: 'border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300',
  webhook: 'border-amber-500/35 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300',
  annotation: 'border-muted-foreground/25 bg-muted/50 text-muted-foreground',
  group: 'border-muted-foreground/25 bg-muted/30 text-muted-foreground',
  decision: 'border-orange-500/35 bg-orange-500/[0.08] text-orange-700 dark:text-orange-300',
}

function createMetadataNode(kind: MetadataKind, graph: AutomationGraph): AutomationGraphNode {
  const rightmost = graph.nodes.reduce((right, node) => Math.max(right, node.position.x), 0)
  const lowest = graph.nodes.reduce((bottom, node) => Math.max(bottom, node.position.y), 0)
  const id = `${kind}:${Date.now()}:${graph.nodes.length}`
  const position = { x: rightmost + 48, y: lowest + 48 }

  switch (kind) {
    case 'annotation':
      return { id, kind, position, data: {} }
    case 'group':
      return { id, kind, position, data: {} }
    case 'decision':
      return { id, kind, position, data: {} }
  }
}

export function AutomationGraphEditor({
  graph,
  onChange,
  onSave,
  selectedNodeId,
  onSelectedNodeChange,
  disabled = false,
  className,
}: AutomationGraphEditorProps) {
  const { t } = useTranslation()
  const [internalSelectedNodeId, setInternalSelectedNodeId] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const markerId = React.useId()
  const dragState = React.useRef<{
    nodeId: string
    originX: number
    originY: number
    startX: number
    startY: number
  } | null>(null)
  const selectedId = selectedNodeId === undefined ? internalSelectedNodeId : selectedNodeId
  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null
  const nodeKindLabels: Record<AutomationGraphNode['kind'], string> = {
    trigger: t('automations.sectionWhen'),
    matcher: t('automations.matching'),
    prompt: t('automations.badgePrompt'),
    webhook: t('automations.badgeWebhook'),
    annotation: t('common.description'),
    group: t('common.selected'),
    decision: t('automations.sectionIf'),
  }
  const metadataChoices: Array<{ kind: MetadataKind; icon: React.ComponentType<{ className?: string }>; label: string }> = [
    { kind: 'annotation', icon: Braces, label: nodeKindLabels.annotation },
    { kind: 'group', icon: Group, label: nodeKindLabels.group },
    { kind: 'decision', icon: GitBranch, label: nodeKindLabels.decision },
  ]

  const selectNode = React.useCallback((nodeId: string | null) => {
    if (selectedNodeId === undefined) setInternalSelectedNodeId(nodeId)
    onSelectedNodeChange?.(nodeId)
  }, [onSelectedNodeChange, selectedNodeId])

  const updateNode = React.useCallback((nextNode: AutomationGraphNode) => {
    onChange({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === nextNode.id ? nextNode : node),
    })
  }, [graph, onChange])

  const addMetadata = React.useCallback((kind: MetadataKind) => {
    const node = createMetadataNode(kind, graph)
    onChange({ ...graph, nodes: [...graph.nodes, node] })
    selectNode(node.id)
  }, [graph, onChange, selectNode])

  const deleteSelectedMetadata = React.useCallback(() => {
    if (!selectedNode || (selectedNode.kind !== 'annotation' && selectedNode.kind !== 'group' && selectedNode.kind !== 'decision')) return
    onChange({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== selectedNode.id),
      edges: graph.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    })
    selectNode(null)
  }, [graph, onChange, selectNode, selectedNode])

  const save = React.useCallback(async () => {
    try {
      compileAutomationGraph(graph)
      setSaveError(null)
      setIsSaving(true)
      await onSave(graph)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('auth.somethingWentWrongRetry'))
    } finally {
      setIsSaving(false)
    }
  }, [graph, onSave, t])

  React.useEffect(() => {
    const moveNode = (event: PointerEvent) => {
      const drag = dragState.current
      if (!drag) return
      const nextPosition = {
        x: Math.max(0, Math.round(drag.originX + event.clientX - drag.startX)),
        y: Math.max(0, Math.round(drag.originY + event.clientY - drag.startY)),
      }
      onChange({
        ...graph,
        nodes: graph.nodes.map((node) => node.id === drag.nodeId ? { ...node, position: nextPosition } : node),
      })
    }
    const finishMove = () => {
      dragState.current = null
    }
    window.addEventListener('pointermove', moveNode)
    window.addEventListener('pointerup', finishMove)
    return () => {
      window.removeEventListener('pointermove', moveNode)
      window.removeEventListener('pointerup', finishMove)
    }
  }, [graph, onChange])

  const graphWidth = Math.max(640, ...graph.nodes.map((node) => node.position.x + 230))
  const graphHeight = Math.max(320, ...graph.nodes.map((node) => node.position.y + 96))

  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background', className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1">
          {metadataChoices.map(({ kind, icon: Icon, label }) => (
            <button
              key={kind}
              type="button"
              aria-label={label}
              title={label}
              disabled={disabled || isSaving}
              onClick={() => addMetadata(kind)}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Plus className="size-3" />
              <Icon className="-ml-1 size-3" />
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled || isSaving}
          onClick={() => { void save() }}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          <Save className="size-3.5" />
          {isSaving ? t('common.saving') : t('common.save')}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto bg-muted/[0.14] p-3">
          <div className="relative" style={{ width: graphWidth, height: graphHeight }}>
            <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
              <defs>
                <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" className="fill-muted-foreground/55" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const source = graph.nodes.find((node) => node.id === edge.source)
                const target = graph.nodes.find((node) => node.id === edge.target)
                if (!source || !target) return null
                return (
                  <line
                    key={edge.id}
                    x1={source.position.x + 208}
                    y1={source.position.y + 40}
                    x2={target.position.x + 4}
                    y2={target.position.y + 40}
                    markerEnd={`url(#${markerId})`}
                    className={edge.kind === 'flow' ? 'stroke-muted-foreground/55' : 'stroke-muted-foreground/30'}
                    strokeDasharray={edge.kind === 'flow' ? undefined : '4 4'}
                  />
                )
              })}
            </svg>

            {graph.nodes.map((node) => {
              const Icon = node.kind === 'prompt' ? MessageSquare : node.kind === 'webhook' ? Webhook : node.kind === 'decision' ? GitBranch : node.kind === 'group' ? Group : Braces
              const label = node.label ?? nodeKindLabels[node.kind]
              const isSelected = node.id === selectedId
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-label={label}
                  aria-pressed={isSelected}
                  onPointerDown={(event) => {
                    if (disabled || isSaving || event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    dragState.current = {
                      nodeId: node.id,
                      originX: node.position.x,
                      originY: node.position.y,
                      startX: event.clientX,
                      startY: event.clientY,
                    }
                  }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId)
                    }
                    dragState.current = null
                  }}
                  onClick={() => selectNode(node.id)}
                  className={cn(
                    'absolute flex h-16 w-52 cursor-grab items-center gap-2 rounded-lg border px-3 text-left shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    NODE_ACCENT[node.kind],
                    isSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 truncate text-xs font-medium">{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="w-56 shrink-0 border-l border-border/60 p-3">
          {selectedNode && (
            <div className="space-y-3">
              <input
                value={selectedNode.label ?? ''}
                onChange={(event) => updateNode({ ...selectedNode, label: event.target.value || undefined })}
                disabled={disabled || isSaving}
                aria-label={t('common.edit')}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              {selectedNode.kind === 'annotation' && (
                <textarea
                  value={selectedNode.data.text ?? ''}
                  onChange={(event) => updateNode({ ...selectedNode, data: { ...selectedNode.data, text: event.target.value || undefined } })}
                  disabled={disabled || isSaving}
                  aria-label={t('common.description')}
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              )}
              {selectedNode.kind === 'decision' && (
                <textarea
                  value={selectedNode.data.expression ?? ''}
                  onChange={(event) => updateNode({ ...selectedNode, data: { ...selectedNode.data, expression: event.target.value || undefined } })}
                  disabled={disabled || isSaving}
                  aria-label={t('automations.sectionIf')}
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              )}
              {(selectedNode.kind === 'annotation' || selectedNode.kind === 'group' || selectedNode.kind === 'decision') && (
                <button
                  type="button"
                  disabled={disabled || isSaving}
                  onClick={deleteSelectedMetadata}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  {t('common.delete')}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {saveError && <p className="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{saveError}</p>}
    </section>
  )
}
