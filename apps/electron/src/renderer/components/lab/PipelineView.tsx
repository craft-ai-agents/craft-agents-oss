/**
 * PipelineView
 *
 * Real-time visualization of a War Room pipeline execution.
 * Shows phase timeline, agent cards with status indicators,
 * output previews, and cost tracking.
 */

import { useState } from 'react'
import {
  Brain,
  Hammer,
  Search,
  RefreshCw,
  Check,
  X,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Zap,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import type { LabPipeline, LabPhase, LabAgentRun, PipelineStatus, PhaseStatus, AgentRunStatus } from '@craft-agent/shared/lab/types'

interface PipelineViewProps {
  pipeline: LabPipeline
  onClose?: () => void
}

export function PipelineView({ pipeline, onClose }: PipelineViewProps) {
  const isActive = !['completed', 'failed', 'cancelled'].includes(pipeline.status)
  const elapsed = getElapsed(pipeline.createdAt, pipeline.completedAt)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <PipelineStatusBadge status={pipeline.status} />
            {isActive && (
              <span className="text-[10px] text-muted-foreground animate-pulse">
                Running...
              </span>
            )}
          </div>
          <p className="text-sm text-foreground/80 line-clamp-2">{pipeline.prompt}</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Phase Timeline */}
      <PhaseTimeline phases={pipeline.phases} pipelineStatus={pipeline.status} />

      {/* Phase Details */}
      <div className="space-y-3">
        {pipeline.phases.map((phase, i) => (
          <PhaseSection key={phase.id} phase={phase} index={i} />
        ))}
      </div>

      {/* Error */}
      {pipeline.status === 'failed' && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">Pipeline failed. Check agent outputs for details.</p>
        </div>
      )}

      {/* Stats Footer */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1 border-t border-foreground/5">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {elapsed}
        </span>
        {pipeline.totalCostUsd != null && (
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            ${pipeline.totalCostUsd.toFixed(3)}
          </span>
        )}
        {pipeline.totalTokens != null && pipeline.totalTokens > 0 && (
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {formatTokens(pipeline.totalTokens)} tokens
          </span>
        )}
        <span>
          Iteration {pipeline.iteration}/{pipeline.maxIterations}
        </span>
      </div>
    </div>
  )
}

// ============================================================
// Phase Timeline (horizontal progress indicator)
// ============================================================

const PHASE_ICONS: Record<string, typeof Brain> = {
  think: Brain,
  build: Hammer,
  review: Search,
  iterate: RefreshCw,
  synthesize: Brain,
}

function PhaseTimeline({ phases, pipelineStatus }: { phases: LabPhase[]; pipelineStatus: PipelineStatus }) {
  // Build expected phase list: always show Think → Build → Review
  // Show actual phases if they exist, otherwise show pending placeholders
  const expectedPhases = ['think', 'build', 'review'] as const
  const actualPhaseMap = new Map(phases.map(p => [p.type, p]))

  return (
    <div className="flex items-center gap-1">
      {expectedPhases.map((phaseType, i) => {
        const phase = actualPhaseMap.get(phaseType)
        const status: PhaseStatus = phase?.status || 'pending'
        const Icon = PHASE_ICONS[phaseType] || Brain
        const isLast = i === expectedPhases.length - 1

        return (
          <div key={phaseType} className="flex items-center gap-1">
            <div
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors',
                status === 'running' && 'bg-accent/10 text-accent',
                status === 'completed' && 'bg-emerald-500/10 text-emerald-600',
                status === 'failed' && 'bg-destructive/10 text-destructive',
                status === 'pending' && 'bg-foreground/5 text-muted-foreground/50',
                status === 'skipped' && 'bg-foreground/5 text-muted-foreground/30 line-through',
              )}
            >
              {status === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : status === 'completed' ? (
                <Check className="h-3 w-3" />
              ) : status === 'failed' ? (
                <X className="h-3 w-3" />
              ) : (
                <Icon className="h-3 w-3" />
              )}
              <span className="capitalize">{phaseType}</span>
            </div>
            {!isLast && (
              <div className={cn(
                'h-px w-4',
                status === 'completed' ? 'bg-emerald-500/30' : 'bg-foreground/10',
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// Phase Section (expandable)
// ============================================================

function PhaseSection({ phase, index }: { phase: LabPhase; index: number }) {
  const [expanded, setExpanded] = useState(
    phase.status === 'running' || phase.status === 'failed'
  )
  const Icon = PHASE_ICONS[phase.type] || Brain

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      phase.status === 'running' && 'border-accent/20 bg-accent/[0.02]',
      phase.status === 'completed' && 'border-foreground/10',
      phase.status === 'failed' && 'border-destructive/20 bg-destructive/[0.02]',
      phase.status === 'pending' && 'border-foreground/5 opacity-50',
    )}>
      {/* Phase Header */}
      <button
        className="w-full flex items-center gap-2 p-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium flex-1">{phase.label}</span>
        <PhaseStatusIndicator status={phase.status} />
        {phase.startedAt && phase.completedAt && (
          <span className="text-[10px] text-muted-foreground">
            {getElapsed(phase.startedAt, phase.completedAt)}
          </span>
        )}
      </button>

      {/* Agent Runs */}
      {expanded && phase.agents.length > 0 && (
        <div className="px-3 pb-3 space-y-2">
          {phase.agents.map(agent => (
            <AgentRunCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Agent Run Card
// ============================================================

function AgentRunCard({ agent }: { agent: LabAgentRun }) {
  const [showOutput, setShowOutput] = useState(false)

  return (
    <div className={cn(
      'rounded-md border border-foreground/5 overflow-hidden',
      agent.status === 'running' && 'border-accent/10',
    )}>
      {/* Agent Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2',
          agent.output && 'cursor-pointer hover:bg-foreground/[0.02]',
        )}
        onClick={() => agent.output && setShowOutput(!showOutput)}
      >
        <span className="text-sm">{agent.personaIcon}</span>
        <span className="text-xs font-medium flex-1 truncate">{agent.personaName}</span>
        <AgentStatusIndicator status={agent.status} />
        {agent.tokenUsage && (
          <span className="text-[10px] text-muted-foreground">
            ${agent.tokenUsage.costUsd.toFixed(3)}
          </span>
        )}
        {agent.output && (
          showOutput ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )
        )}
      </div>

      {/* Error */}
      {agent.error && (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-destructive">{agent.error}</p>
        </div>
      )}

      {/* Output Preview */}
      {showOutput && agent.output && (
        <div className="border-t border-foreground/5 px-3 py-2 max-h-[200px] overflow-y-auto">
          <pre className="text-[11px] text-foreground/70 whitespace-pre-wrap font-mono leading-relaxed">
            {agent.output}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Status Indicators
// ============================================================

const PIPELINE_STATUS_STYLES: Record<PipelineStatus, string> = {
  pending: 'bg-muted-foreground/20 text-muted-foreground',
  thinking: 'bg-blue-500/10 text-blue-500',
  synthesizing: 'bg-violet-500/10 text-violet-500',
  building: 'bg-amber-500/10 text-amber-500',
  reviewing: 'bg-cyan-500/10 text-cyan-500',
  iterating: 'bg-orange-500/10 text-orange-500',
  completed: 'bg-emerald-500/10 text-emerald-500',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted-foreground/10 text-muted-foreground',
}

function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium',
      PIPELINE_STATUS_STYLES[status],
    )}>
      {['thinking', 'synthesizing', 'building', 'reviewing', 'iterating'].includes(status) && (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      )}
      {status}
    </span>
  )
}

function PhaseStatusIndicator({ status }: { status: PhaseStatus }) {
  if (status === 'running') return <Loader2 className="h-3 w-3 text-accent animate-spin" />
  if (status === 'completed') return <Check className="h-3 w-3 text-emerald-500" />
  if (status === 'failed') return <X className="h-3 w-3 text-destructive" />
  return <div className="h-3 w-3 rounded-full border border-foreground/10" />
}

function AgentStatusIndicator({ status }: { status: AgentRunStatus }) {
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-accent">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        working
      </span>
    )
  }
  if (status === 'completed') {
    return <Check className="h-3 w-3 text-emerald-500" />
  }
  if (status === 'failed') {
    return <X className="h-3 w-3 text-destructive" />
  }
  return (
    <span className="text-[10px] text-muted-foreground/50">pending</span>
  )
}

// ============================================================
// Utilities
// ============================================================

function getElapsed(startedAt: number, completedAt?: number): string {
  const end = completedAt || Date.now()
  const seconds = Math.floor((end - startedAt) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

// ============================================================
// Pipeline Event Reducer (for real-time state updates)
// ============================================================

/**
 * Apply a pipeline event to update local pipeline state.
 * Returns a new pipeline object (immutable update).
 */
export function applyPipelineEvent(
  pipeline: LabPipeline,
  event: import('@craft-agent/shared/lab/types').PipelineEvent,
): LabPipeline {
  // Only process events for this pipeline
  if (event.pipelineId !== pipeline.id) return pipeline

  const updated = { ...pipeline, phases: [...pipeline.phases], updatedAt: Date.now() }

  switch (event.type) {
    case 'pipeline_started':
      updated.status = 'thinking'
      break

    case 'phase_started': {
      const newPhase: LabPhase = {
        id: event.phaseId,
        type: event.phaseType as LabPhase['type'],
        label: getPhaseLabel(event.phaseType),
        status: 'running',
        agents: [],
        startedAt: Date.now(),
      }
      updated.phases = [...updated.phases, newPhase]
      break
    }

    case 'agent_started': {
      const phase = updated.phases[event.phaseIndex]
      if (phase) {
        const newAgent: LabAgentRun = {
          id: event.agentRunId,
          personaId: event.personaId,
          personaName: event.personaName,
          personaIcon: event.personaIcon,
          status: 'running',
          startedAt: Date.now(),
        }
        updated.phases = updated.phases.map((p, i) =>
          i === event.phaseIndex
            ? { ...p, agents: [...p.agents, newAgent] }
            : p
        )
      }
      break
    }

    case 'agent_completed': {
      updated.phases = updated.phases.map((p, i) =>
        i === event.phaseIndex
          ? {
              ...p,
              agents: p.agents.map(a =>
                a.id === event.agentRunId
                  ? { ...a, status: 'completed' as const, output: event.output, tokenUsage: event.tokenUsage, completedAt: Date.now() }
                  : a
              ),
            }
          : p
      )
      break
    }

    case 'agent_failed': {
      updated.phases = updated.phases.map((p, i) =>
        i === event.phaseIndex
          ? {
              ...p,
              agents: p.agents.map(a =>
                a.id === event.agentRunId
                  ? { ...a, status: 'failed' as const, error: event.error, completedAt: Date.now() }
                  : a
              ),
            }
          : p
      )
      break
    }

    case 'phase_completed': {
      updated.phases = updated.phases.map((p, i) =>
        i === event.phaseIndex
          ? { ...p, status: 'completed' as const, completedAt: Date.now() }
          : p
      )
      // Update pipeline status based on phase type
      if (event.phaseType === 'think') updated.status = 'building'
      else if (event.phaseType === 'build' || event.phaseType === 'iterate') updated.status = 'reviewing'
      break
    }

    case 'pipeline_completed':
      updated.status = event.status
      updated.completedAt = Date.now()
      updated.totalCostUsd = event.totalCostUsd
      updated.totalTokens = event.totalTokens
      break

    case 'pipeline_error':
      updated.status = 'failed'
      break
  }

  return updated
}

function getPhaseLabel(phaseType: string): string {
  const labels: Record<string, string> = {
    think: 'Think \u2014 Parallel Briefs',
    build: 'Build \u2014 Implementation',
    review: 'Review \u2014 Quality Check',
    iterate: 'Iterate \u2014 Fix Issues',
    synthesize: 'Synthesize \u2014 Plan',
  }
  return labels[phaseType] || phaseType
}
