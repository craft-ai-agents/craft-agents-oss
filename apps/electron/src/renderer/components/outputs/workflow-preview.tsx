import * as React from 'react'
import type { OutputPreviewSettledHandler } from './OutputInlinePreview'

export type WorkflowNodeState = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'skipped' | 'awaiting-human' | 'unknown'

export interface WorkflowGraphNode {
  id: string
  label: string
  agent?: string
  state: WorkflowNodeState
}

export interface WorkflowGraphSpec {
  title: string
  state?: string
  nodes: WorkflowGraphNode[]
}

interface OutputWorkflowPreviewProps {
  content: string
  label: string
  className?: string
  onPreviewSettled?: OutputPreviewSettledHandler
}

const WIDTH = 980
const NODE_WIDTH = 180
const NODE_HEIGHT = 72
const GAP = 44

const STATE_STYLES: Record<WorkflowNodeState, { fill: string; stroke: string; text: string }> = {
  queued: { fill: '#111827', stroke: '#52525b', text: '#d4d4d8' },
  running: { fill: '#082f49', stroke: '#38bdf8', text: '#e0f2fe' },
  succeeded: { fill: '#052e1a', stroke: '#34d399', text: '#d1fae5' },
  failed: { fill: '#450a0a', stroke: '#fb7185', text: '#ffe4e6' },
  interrupted: { fill: '#431407', stroke: '#fb923c', text: '#ffedd5' },
  skipped: { fill: '#18181b', stroke: '#71717a', text: '#a1a1aa' },
  'awaiting-human': { fill: '#422006', stroke: '#fbbf24', text: '#fef3c7' },
  unknown: { fill: '#18181b', stroke: '#52525b', text: '#d4d4d8' },
}

export function OutputWorkflowPreview({ content, label, className, onPreviewSettled }: OutputWorkflowPreviewProps) {
  const parsed = React.useMemo(() => parseWorkflowGraphSpec(content), [content])

  React.useEffect(() => {
    onPreviewSettled?.(parsed.ok ? 'ready' : 'error')
  }, [onPreviewSettled, parsed.ok])

  if (!parsed.ok) {
    return (
      <div className={className ?? 'runneros-card flex items-center gap-2 px-3 py-2 text-sm text-white/45'}>
        <span>Workflow preview unavailable: {parsed.error}</span>
      </div>
    )
  }

  const spec = parsed.spec
  const height = Math.max(360, 128 + spec.nodes.length * (NODE_HEIGHT + GAP))
  return (
    <div className={className ?? 'h-full min-h-[360px] w-full overflow-hidden rounded-md'}>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-white/[0.08] bg-black/70">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2 text-xs text-white/48">
          <span className="truncate">{spec.title || label}</span>
          <span>{spec.state ?? `${spec.nodes.length} steps`}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <svg viewBox={`0 0 ${WIDTH} ${height}`} className="min-h-full w-full" role="img" aria-label={spec.title || label}>
            <rect x="0" y="0" width={WIDTH} height={height} rx="16" fill="#050505" />
            <text x="32" y="40" fill="#d8d8df" fontSize="21" fontWeight="600">{spec.title || label}</text>
            {spec.state ? <text x="32" y="64" fill="#a1a1aa" fontSize="12">{spec.state}</text> : null}
            <WorkflowNodes nodes={spec.nodes} />
          </svg>
        </div>
      </div>
    </div>
  )
}

function WorkflowNodes({ nodes }: { nodes: WorkflowGraphNode[] }) {
  const x = 128
  const startY = 96
  return (
    <g>
      {nodes.map((node, index) => {
        const y = startY + index * (NODE_HEIGHT + GAP)
        const style = STATE_STYLES[node.state] ?? STATE_STYLES.unknown
        const hasNext = index < nodes.length - 1
        return (
          <g key={node.id}>
            {hasNext ? (
              <g>
                <line x1={x + NODE_WIDTH / 2} y1={y + NODE_HEIGHT} x2={x + NODE_WIDTH / 2} y2={y + NODE_HEIGHT + GAP - 8} stroke="#3f3f46" strokeWidth="2" />
                <path d={`M ${x + NODE_WIDTH / 2 - 6} ${y + NODE_HEIGHT + GAP - 14} L ${x + NODE_WIDTH / 2} ${y + NODE_HEIGHT + GAP - 6} L ${x + NODE_WIDTH / 2 + 6} ${y + NODE_HEIGHT + GAP - 14}`} fill="none" stroke="#3f3f46" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : null}
            <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="14" fill={style.fill} stroke={style.stroke} strokeWidth="1.6" />
            <text x={x + 18} y={y + 29} fill={style.text} fontSize="15" fontWeight="600">{truncate(node.label, 20)}</text>
            <text x={x + 18} y={y + 52} fill="#a1a1aa" fontSize="11">{node.agent ? truncate(node.agent, 20) : node.state}</text>
            <StatePill x={x + NODE_WIDTH + 24} y={y + 20} state={node.state} />
          </g>
        )
      })}
    </g>
  )
}

function StatePill({ x, y, state }: { x: number; y: number; state: WorkflowNodeState }) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.unknown
  const label = state.replace(/-/g, ' ')
  return (
    <g>
      <rect x={x} y={y} width="132" height="30" rx="15" fill={style.fill} stroke={style.stroke} opacity="0.95" />
      <text x={x + 66} y={y + 20} fill={style.text} fontSize="12" textAnchor="middle">{label}</text>
    </g>
  )
}

export function parseWorkflowGraphSpec(content: string): { ok: true; spec: WorkflowGraphSpec } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }

  if (!isRecord(raw)) return { ok: false, error: 'workflow graph must be an object' }

  const direct = parseDirectWorkflowGraph(raw)
  if (direct) return { ok: true, spec: direct }

  const run = parseWorkflowRunSnapshot(raw)
  if (run) return { ok: true, spec: run }

  const definition = parseWorkflowDefinition(raw)
  if (definition) return { ok: true, spec: definition }

  return { ok: false, error: 'expected nodes, steps, metadata.steps, or workflowSnapshot metadata' }
}

function parseDirectWorkflowGraph(record: Record<string, unknown>): WorkflowGraphSpec | null {
  const nodes = parseNodeArray(record.nodes)
  if (nodes.length === 0) return null
  return {
    title: asString(record.title) ?? 'Workflow graph',
    state: asString(record.state),
    nodes,
  }
}

function parseWorkflowRunSnapshot(record: Record<string, unknown>): WorkflowGraphSpec | null {
  const workflowSnapshot = isRecord(record.workflowSnapshot) ? record.workflowSnapshot : null
  const metadata = isRecord(workflowSnapshot?.metadata) ? workflowSnapshot.metadata : null
  const steps = parseRunStepArray(record.steps, metadata)
  if (steps.length === 0) return null
  return {
    title: asString(metadata?.name) ?? asString(record.workflowSlug) ?? 'Workflow run',
    state: asString(record.state),
    nodes: steps,
  }
}

function parseWorkflowDefinition(record: Record<string, unknown>): WorkflowGraphSpec | null {
  const metadata = isRecord(record.metadata) ? record.metadata : record
  const rawSteps = Array.isArray(metadata.steps) ? metadata.steps : Array.isArray(record.steps) ? record.steps : null
  if (!rawSteps) return null
  const nodes = rawSteps.flatMap((step, index) => {
    if (!isRecord(step)) return []
    return [{
      id: asString(step.id) ?? String(index + 1),
      label: asString(step.description) ?? asString(step.id) ?? `Step ${index + 1}`,
      agent: asString(step.agent),
      state: 'queued' as WorkflowNodeState,
    }]
  })
  if (nodes.length === 0) return null
  return {
    title: asString(metadata.name) ?? 'Workflow',
    nodes,
  }
}

function parseNodeArray(value: unknown): WorkflowGraphNode[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((node, index) => {
    if (!isRecord(node)) return []
    return [{
      id: asString(node.id) ?? String(index + 1),
      label: asString(node.label) ?? asString(node.name) ?? asString(node.id) ?? `Step ${index + 1}`,
      agent: asString(node.agent),
      state: normalizeState(node.state),
    }]
  })
}

function parseRunStepArray(value: unknown, metadata?: Record<string, unknown> | null): WorkflowGraphNode[] {
  if (!Array.isArray(value)) return []
  const definitions = Array.isArray(metadata?.steps) ? metadata.steps : []
  return value.flatMap((step, index) => {
    if (!isRecord(step)) return []
    const id = asString(step.id) ?? String(index + 1)
    const definition = definitions.find((candidate) => isRecord(candidate) && candidate.id === id)
    const def = isRecord(definition) ? definition : null
    return [{
      id,
      label: asString(def?.description) ?? id,
      agent: asString(def?.agent) ?? readRunStepAgent(step),
      state: normalizeState(step.state),
    }]
  })
}

function readRunStepAgent(step: Record<string, unknown>): string | undefined {
  const receipt = isRecord(step.executionReceipt) ? step.executionReceipt : null
  const agent = isRecord(receipt?.agent) ? receipt.agent : null
  return asString(agent?.name) ?? asString(agent?.slug)
}

function normalizeState(value: unknown): WorkflowNodeState {
  const state = typeof value === 'string' ? value : 'unknown'
  if (state === 'queued' || state === 'running' || state === 'succeeded' || state === 'failed' || state === 'interrupted' || state === 'skipped' || state === 'awaiting-human') return state
  return 'unknown'
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}...` : value
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
