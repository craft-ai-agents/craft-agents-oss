/**
 * LabProjectDetail
 *
 * Main detail view for a Lab project.
 * Shows project info, personas, pipeline launcher, active pipeline progress,
 * and pipeline history.
 * Follows existing detail view patterns (SourceDetail, SkillDetail).
 */

import { useState, useMemo, useCallback } from 'react'
import {
  FlaskConical,
  Plus,
  Play,
  Users,
  Target,
  GitBranch,
  X,
  Sparkles,
  Trash2,
  Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { LabProject, LabPersona, LabPipeline, CreatePersonaInput } from '@craft-agent/shared/lab/types'
import { PERSONA_TEMPLATES, type PersonaTemplate } from '@craft-agent/shared/lab/persona-templates'
import { PipelineView } from './PipelineView'
import { PersonaDialog } from './PersonaDialog'

interface LabProjectDetailProps {
  project: LabProject
  personas: LabPersona[]
  allPersonas: LabPersona[]
  pipelines: LabPipeline[]
  activePipeline?: LabPipeline | null
  onUpdateProject: (updates: LabProject) => void
  onAddPersona: (personaId: string) => void
  onRemovePersona: (personaId: string) => void
  onCreatePersonaFromTemplate: (template: PersonaTemplate) => void
  onCreatePersona: (input: CreatePersonaInput) => void
  onEditPersona: (persona: LabPersona) => void
  onStartPipeline: (prompt: string) => void
  onSelectPipeline: (pipeline: LabPipeline) => void
  onClearActivePipeline?: () => void
  onStopPipeline?: () => void
  onClearHistory?: () => void
}

export function LabProjectDetail({
  project,
  personas,
  allPersonas,
  pipelines,
  activePipeline,
  onUpdateProject,
  onAddPersona,
  onRemovePersona,
  onCreatePersonaFromTemplate,
  onCreatePersona,
  onEditPersona,
  onStartPipeline,
  onSelectPipeline,
  onClearActivePipeline,
  onStopPipeline,
  onClearHistory,
}: LabProjectDetailProps) {
  const [pipelinePrompt, setPipelinePrompt] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [personaDialogOpen, setPersonaDialogOpen] = useState(false)
  const [editingPersona, setEditingPersona] = useState<LabPersona | null>(null)

  // Personas NOT yet in this project
  const availablePersonas = useMemo(
    () => allPersonas.filter(p => !project.personaIds.includes(p.id)),
    [allPersonas, project.personaIds],
  )

  // Templates not yet created as personas
  const availableTemplates = useMemo(
    () => PERSONA_TEMPLATES.filter(
      t => !allPersonas.some(p => p.name === t.name),
    ),
    [allPersonas],
  )

  const handleStartPipeline = useCallback(() => {
    if (!pipelinePrompt.trim()) return
    onStartPipeline(pipelinePrompt.trim())
    setPipelinePrompt('')
  }, [pipelinePrompt, onStartPipeline])

  return (
    <ScrollArea className="h-full">
      <div className="max-w-2xl mx-auto py-8 px-6 space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <FlaskConical className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{project.name}</h1>
              <p className="text-sm text-muted-foreground">{project.description}</p>
            </div>
          </div>
        </div>

        {/* Goals */}
        {project.goals.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Goals</h2>
            </div>
            <div className="space-y-1.5 pl-6">
              {project.goals.map((goal, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0 mt-0.5">&bull;</span>
                  <span>{goal}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <Separator />

        {/* Team (Personas) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Team</h2>
              <span className="text-xs text-muted-foreground">
                ({personas.length} persona{personas.length !== 1 ? 's' : ''})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  setEditingPersona(null)
                  setPersonaDialogOpen(true)
                }}
              >
                <Plus className="h-3 w-3" />
                Create Custom
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setShowTemplates(!showTemplates)}
              >
                <Sparkles className="h-3 w-3" />
                {showTemplates ? 'Hide Templates' : 'Add from Templates'}
              </Button>
            </div>
          </div>

          {/* Active personas */}
          <div className="grid gap-2">
            {personas.map(persona => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onEdit={() => {
                  setEditingPersona(persona)
                  setPersonaDialogOpen(true)
                }}
                onRemove={() => onRemovePersona(persona.id)}
              />
            ))}
          </div>

          {/* Available personas to add */}
          {availablePersonas.length > 0 && (
            <div className="pt-2">
              <div className="text-xs text-muted-foreground mb-2">Available personas:</div>
              <div className="flex flex-wrap gap-1.5">
                {availablePersonas.map(p => (
                  <button
                    key={p.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-foreground/5 hover:bg-foreground/10 transition-colors"
                    onClick={() => onAddPersona(p.id)}
                  >
                    <Plus className="h-3 w-3" />
                    <span>{p.icon}</span>
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Template gallery */}
          {showTemplates && availableTemplates.length > 0 && (
            <div className="pt-2 space-y-2">
              <div className="text-xs text-muted-foreground">
                Create from template:
              </div>
              <div className="grid gap-2">
                {availableTemplates.map(template => (
                  <button
                    key={template.templateId}
                    className="flex items-start gap-3 p-3 rounded-lg border border-dashed border-foreground/10 hover:border-accent/30 hover:bg-accent/5 transition-colors text-left"
                    onClick={() => onCreatePersonaFromTemplate(template)}
                  >
                    <span className="text-lg">{template.icon}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{template.name}</div>
                      <div className="text-xs text-muted-foreground">{template.role}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {personas.length === 0 && !showTemplates && (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                No personas assigned to this project yet.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTemplates(true)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Browse Templates
              </Button>
            </div>
          )}
        </section>

        <Separator />

        {/* Active Pipeline Progress */}
        {activePipeline && (
          <>
            <section className="space-y-3">
              <PipelineView
                pipeline={activePipeline}
                onClose={onClearActivePipeline}
                onStop={onStopPipeline}
              />
            </section>
            <Separator />
          </>
        )}

        {/* Run Pipeline */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Run War Room</h2>
          </div>

          <div className="space-y-2">
            <textarea
              className={cn(
                'w-full min-h-[80px] rounded-lg border border-foreground/10 bg-foreground/[0.02]',
                'px-3 py-2 text-sm resize-y',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-1 focus:ring-accent/50',
              )}
              placeholder="Describe the task or problem for the team to solve..."
              value={pipelinePrompt}
              onChange={(e) => setPipelinePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleStartPipeline()
                }
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {personas.length > 0
                  ? `Team of ${personas.length}: ${personas.map(p => p.icon).join(' ')}`
                  : 'Add personas to your team first'}
              </span>
              <Button
                size="sm"
                disabled={!pipelinePrompt.trim() || personas.length === 0}
                onClick={handleStartPipeline}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Start Pipeline
              </Button>
            </div>
          </div>
        </section>

        {/* Pipeline History */}
        {pipelines.length > 0 && (
          <>
            <Separator />
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium">Pipeline History</h2>
                  <span className="text-xs text-muted-foreground">
                    ({pipelines.length})
                  </span>
                </div>
                {onClearHistory && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
                    onClick={onClearHistory}
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {pipelines.map(pipeline => (
                  <PipelineCard
                    key={pipeline.id}
                    pipeline={pipeline}
                    isActive={activePipeline?.id === pipeline.id}
                    onClick={() => onSelectPipeline(pipeline)}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Persona create/edit dialog */}
      <PersonaDialog
        open={personaDialogOpen}
        onOpenChange={setPersonaDialogOpen}
        persona={editingPersona}
        onCreate={onCreatePersona}
        onSave={onEditPersona}
      />
    </ScrollArea>
  )
}

// ============================================================
// Sub-components
// ============================================================

function PersonaCard({
  persona,
  onEdit,
  onRemove,
}: {
  persona: LabPersona
  onEdit: () => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group relative rounded-lg border border-foreground/10 overflow-hidden">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-lg">{persona.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{persona.name}</div>
          <div className="text-xs text-muted-foreground">{persona.role}</div>
        </div>
        {persona.model && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground">
            {persona.model}
          </span>
        )}
        <button
          className="shrink-0 h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </button>
        <button
          className="shrink-0 h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 text-xs border-t border-foreground/5 pt-2">
          <div>
            <span className="font-medium text-muted-foreground">Mindset:</span>
            <p className="mt-0.5 text-foreground/80 whitespace-pre-wrap line-clamp-3">
              {persona.mindset}
            </p>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">Evaluation:</span>
            <p className="mt-0.5 text-foreground/80 whitespace-pre-wrap line-clamp-3">
              {persona.evaluationCriteria}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
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

function PipelineCard({
  pipeline,
  isActive,
  onClick,
}: {
  pipeline: LabPipeline
  isActive?: boolean
  onClick: () => void
}) {
  const elapsed = pipeline.completedAt
    ? `${((pipeline.completedAt - pipeline.createdAt) / 1000 / 60).toFixed(1)}min`
    : 'running...'

  return (
    <button
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left',
        isActive
          ? 'border-accent/30 bg-accent/5'
          : 'border-foreground/10 hover:bg-foreground/[0.02]',
      )}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{pipeline.prompt}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded font-medium',
            STATUS_COLORS[pipeline.status] || STATUS_COLORS.pending,
          )}>
            {pipeline.status}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {elapsed}
          </span>
          {pipeline.totalCostUsd != null && (
            <span className="text-[10px] text-muted-foreground">
              ${pipeline.totalCostUsd.toFixed(2)}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            iter {pipeline.iteration}/{pipeline.maxIterations}
          </span>
        </div>
      </div>
    </button>
  )
}
