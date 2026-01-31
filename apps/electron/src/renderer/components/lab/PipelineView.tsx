/**
 * PipelineView
 *
 * Real-time visualization of a War Room pipeline execution.
 * Shows phase timeline with progress counters, agent cards with
 * live elapsed timers, auto-expanding phases, and output previews.
 */

import { useState, useEffect, useRef } from 'react'
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
  Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { LabPipeline, LabPhase, LabAgentRun, PipelineStatus, PhaseStatus, AgentRunStatus } from '@craft-agent/shared/lab/types'

// ============================================================
// Live Elapsed Time Hook
// ============================================================

function useLiveElapsed(startedAt: number | undefined, completedAt: number | undefined): string {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!startedAt || completedAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [startedAt, completedAt])

  if (!startedAt) return ''
  const end = completedAt || now
  const seconds = Math.floor((end - startedAt) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

// ============================================================
// Main PipelineView
// ============================================================

interface PipelineViewProps {
  pipeline: LabPipeline
  onClose?: () => void
  onStop?: () => void
}

export function PipelineView({ pipeline, onClose, onStop }: PipelineViewProps) {
  const isActive = !['completed', 'failed', 'cancelled'].includes(pipeline.status)
  const elapsed = useLiveElapsed(pipeline.createdAt, pipeline.completedAt)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <PipelineStatusBadge status={pipeline.status} />
            {isActive && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {elapsed}
              </span>
            )}
          </div>
          <p className="text-sm text-foreground/80 line-clamp-2">{pipeline.prompt}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isActive && onStop && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={onStop}
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Phase Timeline */}
      <PhaseTimeline phases={pipeline.phases} pipelineStatus={pipeline.status} />

      {/* Phase Details */}
      <div className="space-y-3">
        {pipeline.phases.map((phase, i) => (
          <PhaseSection key={phase.id} phase={phase} index={i} pipelineStatus={pipeline.status} />
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
      {(pipeline.status === 'completed' || pipeline.status === 'failed') && (
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
      )}
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
  const expectedPhases = ['think', 'build', 'review'] as const
  const actualPhaseMap = new Map(phases.map(p => [p.type, p]))

  return (
    <div className="flex items-center gap-1">
      {expectedPhases.map((phaseType, i) => {
        const phase = actualPhaseMap.get(phaseType)
        const status: PhaseStatus = phase?.status || 'pending'
        const Icon = PHASE_ICONS[phaseType] || Brain
        const isLast = i === expectedPhases.length - 1

        // Progress text for running phases
        let progressText = ''
        if (phase && status === 'running' && phase.agents.length > 0) {
          const done = phase.agents.filter(a => a.status === 'completed' || a.status === 'failed').length
          progressText = ` ${done}/${phase.agents.length}`
        }

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
              {progressText && (
                <span className="tabular-nums opacity-75">{progressText}</span>
              )}
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
// Phase Section (auto-expands when running, shows progress)
// ============================================================

function PhaseSection({ phase, index, pipelineStatus }: { phase: LabPhase; index: number; pipelineStatus: PipelineStatus }) {
  const [expanded, setExpanded] = useState(
    phase.status === 'running' || phase.status === 'failed'
  )
  const prevStatusRef = useRef(phase.status)
  const Icon = PHASE_ICONS[phase.type] || Brain
  const elapsed = useLiveElapsed(phase.startedAt, phase.completedAt)

  // Auto-expand when status transitions to 'running' or 'completed' (to show results)
  useEffect(() => {
    if (prevStatusRef.current !== phase.status) {
      if (phase.status === 'running' || phase.status === 'completed' || phase.status === 'failed') {
        setExpanded(true)
      }
      prevStatusRef.current = phase.status
    }
  }, [phase.status])

  // Progress counts
  const totalAgents = phase.agents.length
  const completedAgents = phase.agents.filter(a => a.status === 'completed').length
  const failedAgents = phase.agents.filter(a => a.status === 'failed').length
  const runningAgents = phase.agents.filter(a => a.status === 'running').length
  const finishedAgents = completedAgents + failedAgents

  // Phase cost
  const phaseCost = phase.agents.reduce((sum, a) => sum + (a.tokenUsage?.costUsd || 0), 0)

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

        {/* Progress counter */}
        {totalAgents > 0 && phase.status === 'running' && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {finishedAgents}/{totalAgents} done
          </span>
        )}
        {totalAgents > 0 && phase.status === 'completed' && (
          <span className="text-[10px] text-muted-foreground">
            {completedAgents} completed{failedAgents > 0 ? `, ${failedAgents} failed` : ''}
          </span>
        )}

        <PhaseStatusIndicator status={phase.status} />

        {elapsed && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {elapsed}
          </span>
        )}

        {phaseCost > 0 && (
          <span className="text-[10px] text-muted-foreground">
            ${phaseCost.toFixed(3)}
          </span>
        )}
      </button>

      {/* Running agents progress bar */}
      {phase.status === 'running' && totalAgents > 0 && (
        <div className="px-3 pb-2">
          <div className="h-1 rounded-full bg-foreground/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent/40 transition-all duration-500"
              style={{ width: `${(finishedAgents / totalAgents) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Agent Runs */}
      {expanded && phase.agents.length > 0 && (
        <div className="px-3 pb-3 space-y-2">
          {phase.agents.map(agent => (
            <AgentRunCard key={agent.id} agent={agent} phaseCompleted={phase.status === 'completed'} />
          ))}
        </div>
      )}

      {/* Empty state for running phase with no agents yet */}
      {expanded && phase.agents.length === 0 && phase.status === 'running' && (
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Starting agents...</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Agent Run Card (with live timer and auto-show output)
// ============================================================

function AgentRunCard({ agent, phaseCompleted }: { agent: LabAgentRun; phaseCompleted?: boolean }) {
  // Auto-show output when phase is completed (so user sees results without clicking)
  const [showOutput, setShowOutput] = useState(false)
  const elapsed = useLiveElapsed(agent.startedAt, agent.completedAt)

  // Auto-expand output when agent completes and phase is done
  useEffect(() => {
    if (phaseCompleted && agent.status === 'completed' && agent.output) {
      setShowOutput(true)
    }
  }, [phaseCompleted, agent.status, agent.output])

  // Truncated preview of output (first ~150 chars)
  const outputPreview = agent.output
    ? agent.output.length > 150
      ? agent.output.slice(0, 150).trim() + '...'
      : agent.output
    : null

  return (
    <div className={cn(
      'rounded-md border overflow-hidden',
      agent.status === 'running' && 'border-accent/15 bg-accent/[0.02]',
      agent.status === 'completed' && 'border-foreground/8',
      agent.status === 'failed' && 'border-destructive/15 bg-destructive/[0.01]',
      agent.status === 'pending' && 'border-foreground/5 opacity-60',
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
        {elapsed && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {elapsed}
          </span>
        )}
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

      {/* Inline preview when output exists but not expanded */}
      {!showOutput && agent.status === 'completed' && outputPreview && (
        <div
          className="px-3 pb-2 cursor-pointer"
          onClick={() => setShowOutput(true)}
        >
          <p className="text-[10px] text-muted-foreground/70 line-clamp-2 italic">
            {outputPreview}
          </p>
        </div>
      )}

      {/* Error */}
      {agent.error && (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-destructive">{agent.error}</p>
        </div>
      )}

      {/* Full Output */}
      {showOutput && agent.output && (
        <div className="border-t border-foreground/5 px-3 py-2 max-h-[300px] overflow-y-auto">
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

const PIPELINE_STATUS_CONFIG: Record<PipelineStatus, { style: string; label: string }> = {
  pending: { style: 'bg-muted-foreground/20 text-muted-foreground', label: 'Pending' },
  thinking: { style: 'bg-blue-500/10 text-blue-500', label: 'Thinking' },
  synthesizing: { style: 'bg-violet-500/10 text-violet-500', label: 'Synthesizing' },
  building: { style: 'bg-amber-500/10 text-amber-500', label: 'Building' },
  reviewing: { style: 'bg-cyan-500/10 text-cyan-500', label: 'Reviewing' },
  iterating: { style: 'bg-orange-500/10 text-orange-500', label: 'Iterating' },
  completed: { style: 'bg-emerald-500/10 text-emerald-500', label: 'Completed' },
  failed: { style: 'bg-destructive/10 text-destructive', label: 'Failed' },
  cancelled: { style: 'bg-muted-foreground/10 text-muted-foreground', label: 'Cancelled' },
}

function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  const config = PIPELINE_STATUS_CONFIG[status] || PIPELINE_STATUS_CONFIG.pending
  const isRunning = ['thinking', 'synthesizing', 'building', 'reviewing', 'iterating'].includes(status)

  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium',
      config.style,
    )}>
      {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {config.label}
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
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
        </span>
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
    <span className="text-[10px] text-muted-foreground/50">queued</span>
  )
}

// ============================================================
// Utilities
// ============================================================

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
  if (event.pipelineId !== pipeline.id) return pipeline

  const updated = { ...pipeline, phases: [...pipeline.phases], updatedAt: Date.now() }

  switch (event.type) {
    case 'pipeline_started':
      updated.status = 'thinking'
      break

    case 'phase_started': {
      // Only add phase if not already present (guard against duplicate events)
      const exists = updated.phases.some(p => p.id === event.phaseId)
      if (!exists) {
        const newPhase: LabPhase = {
          id: event.phaseId,
          type: event.phaseType as LabPhase['type'],
          label: getPhaseLabel(event.phaseType),
          status: 'running',
          agents: [],
          startedAt: Date.now(),
        }
        updated.phases = [...updated.phases, newPhase]
      }

      // Update pipeline status based on phase type
      if (event.phaseType === 'think') updated.status = 'thinking'
      else if (event.phaseType === 'build') updated.status = 'building'
      else if (event.phaseType === 'review') updated.status = 'reviewing'
      else if (event.phaseType === 'iterate') updated.status = 'iterating'
      else if (event.phaseType === 'synthesize') updated.status = 'synthesizing'
      break
    }

    case 'agent_started': {
      const phase = updated.phases[event.phaseIndex]
      if (phase) {
        // Only add if not already present
        const agentExists = phase.agents.some(a => a.id === event.agentRunId)
        if (!agentExists) {
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
      // Update pipeline status to next phase
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

    case 'pipeline_cancelled' as any:
      updated.status = 'cancelled'
      updated.completedAt = Date.now()
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
