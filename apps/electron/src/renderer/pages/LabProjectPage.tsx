/**
 * LabProjectPage
 *
 * Main content page for viewing and managing a Lab project.
 * Loads project data, personas, and pipelines from the backend.
 * Handles pipeline creation, execution, and real-time event tracking.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppShellContext } from '@/context/AppShellContext'
import { LabProjectDetail } from '@/components/lab/LabProjectDetail'
import { applyPipelineEvent } from '@/components/lab/PipelineView'
import { PERSONA_TEMPLATES } from '@craft-agent/shared/lab/persona-templates'
import type {
  LabProject,
  LabPersona,
  LabPipeline,
  CreatePersonaInput,
  PipelineEvent,
} from '@craft-agent/shared/lab/types'
import type { PersonaTemplate } from '@craft-agent/shared/lab/persona-templates'
import { FlaskConical } from 'lucide-react'

interface LabProjectPageProps {
  projectId: string
}

export default function LabProjectPage({ projectId }: LabProjectPageProps) {
  const { activeWorkspaceId } = useAppShellContext()
  const [project, setProject] = useState<LabProject | null>(null)
  const [allPersonas, setAllPersonas] = useState<LabPersona[]>([])
  const [pipelines, setPipelines] = useState<LabPipeline[]>([])
  const [activePipeline, setActivePipeline] = useState<LabPipeline | null>(null)
  const [loading, setLoading] = useState(true)

  // Ref for active pipeline to avoid stale closures in event listener
  const activePipelineRef = useRef<LabPipeline | null>(null)
  activePipelineRef.current = activePipeline

  // Load project, personas, and pipelines
  useEffect(() => {
    if (!activeWorkspaceId) return
    setLoading(true)

    Promise.all([
      window.electronAPI.getLabProjects(activeWorkspaceId),
      window.electronAPI.getLabPersonas(activeWorkspaceId),
      window.electronAPI.getLabPipelines(activeWorkspaceId, projectId),
    ]).then(([projects, personas, pipelineList]) => {
      const proj = projects.find(p => p.id === projectId) || null
      setProject(proj)
      setAllPersonas(personas)
      setPipelines(pipelineList)
    }).catch(err => {
      console.error('[LabProjectPage] Failed to load data:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [activeWorkspaceId, projectId])

  // Listen for pipeline events
  useEffect(() => {
    const cleanup = window.electronAPI.onLabPipelineEvent((event: PipelineEvent) => {
      const current = activePipelineRef.current
      if (!current || event.pipelineId !== current.id) return

      const updated = applyPipelineEvent(current, event)
      setActivePipeline(updated)

      // Update in pipelines list on terminal events
      if (event.type === 'pipeline_completed' || event.type === 'pipeline_error' || (event as any).type === 'pipeline_cancelled') {
        setPipelines(prev => prev.map(p =>
          p.id === updated.id ? updated : p
        ))
      }
    })

    return cleanup
  }, [])

  // Derived: personas assigned to this project
  const projectPersonas = allPersonas.filter(p =>
    project?.personaIds.includes(p.id)
  )

  // Update project handler
  const handleUpdateProject = useCallback(async (updated: LabProject) => {
    if (!activeWorkspaceId) return
    try {
      await window.electronAPI.saveLabProject(activeWorkspaceId, updated)
      setProject(updated)
    } catch (err) {
      console.error('[LabProjectPage] Failed to save project:', err)
    }
  }, [activeWorkspaceId])

  // Add persona to project
  const handleAddPersona = useCallback(async (personaId: string) => {
    if (!project || !activeWorkspaceId) return
    if (project.personaIds.includes(personaId)) return

    const updated = {
      ...project,
      personaIds: [...project.personaIds, personaId],
    }
    await handleUpdateProject(updated)
  }, [project, activeWorkspaceId, handleUpdateProject])

  // Remove persona from project
  const handleRemovePersona = useCallback(async (personaId: string) => {
    if (!project || !activeWorkspaceId) return

    const updated = {
      ...project,
      personaIds: project.personaIds.filter(id => id !== personaId),
    }
    await handleUpdateProject(updated)
  }, [project, activeWorkspaceId, handleUpdateProject])

  // Create persona from template and add to project
  const handleCreatePersonaFromTemplate = useCallback(async (template: PersonaTemplate) => {
    if (!activeWorkspaceId || !project) return

    const input: CreatePersonaInput = {
      name: template.name,
      role: template.role,
      icon: template.icon,
      mindset: template.mindset,
      knowledge: template.knowledge,
      evaluationCriteria: template.evaluationCriteria,
      model: template.model,
    }

    try {
      const persona = await window.electronAPI.createLabPersona(activeWorkspaceId, input)
      setAllPersonas(prev => [...prev, persona])

      // Also add to project
      const updated = {
        ...project,
        personaIds: [...project.personaIds, persona.id],
      }
      await handleUpdateProject(updated)
    } catch (err) {
      console.error('[LabProjectPage] Failed to create persona:', err)
    }
  }, [activeWorkspaceId, project, handleUpdateProject])

  // Start a pipeline
  const handleStartPipeline = useCallback(async (prompt: string) => {
    if (!activeWorkspaceId || !project) return

    try {
      // Create the pipeline record
      const pipeline = await window.electronAPI.createLabPipeline(
        activeWorkspaceId,
        project.id,
        prompt,
      )
      setPipelines(prev => [pipeline, ...prev])
      setActivePipeline(pipeline)
      // CRITICAL: Set ref immediately so the event listener can match events
      // before React re-renders. Without this, early events (pipeline_started,
      // phase_started) arrive before the re-render updates the ref, and get dropped.
      activePipelineRef.current = pipeline

      // Kick off pipeline execution (async, returns immediately)
      window.electronAPI.runLabPipeline(
        activeWorkspaceId,
        project.id,
        pipeline.id,
      ).catch(err => {
        console.error('[LabProjectPage] Pipeline execution error:', err)
      })
    } catch (err) {
      console.error('[LabProjectPage] Failed to create pipeline:', err)
    }
  }, [activeWorkspaceId, project])

  // Select a pipeline from history
  const handleSelectPipeline = useCallback((pipeline: LabPipeline) => {
    setActivePipeline(pipeline)
  }, [])

  // Clear active pipeline
  const handleClearActivePipeline = useCallback(() => {
    setActivePipeline(null)
  }, [])

  // Stop the active pipeline
  const handleStopPipeline = useCallback(async () => {
    if (!activeWorkspaceId || !activePipeline || !project) {
      console.warn('[LabProjectPage] Stop called but missing context', { activeWorkspaceId, projectId: project?.id, pipelineId: activePipeline?.id })
      return
    }
    console.log('[LabProjectPage] Stopping pipeline:', activePipeline.id)
    try {
      await window.electronAPI.stopLabPipeline(activeWorkspaceId, project.id, activePipeline.id)
      console.log('[LabProjectPage] Stop IPC call completed')
    } catch (err) {
      console.error('[LabProjectPage] Failed to stop pipeline:', err)
    }
  }, [activeWorkspaceId, activePipeline, project])

  // Clear all pipeline history
  const handleClearHistory = useCallback(async () => {
    if (!activeWorkspaceId || !project) return
    try {
      await window.electronAPI.clearLabPipelines(activeWorkspaceId, project.id)
      setPipelines([])
      setActivePipeline(null)
      activePipelineRef.current = null
    } catch (err) {
      console.error('[LabProjectPage] Failed to clear history:', err)
    }
  }, [activeWorkspaceId, project])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading project...</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <FlaskConical className="h-8 w-8 opacity-40" />
        <p className="text-sm">Project not found</p>
      </div>
    )
  }

  return (
    <LabProjectDetail
      project={project}
      personas={projectPersonas}
      allPersonas={allPersonas}
      pipelines={pipelines}
      activePipeline={activePipeline}
      onUpdateProject={handleUpdateProject}
      onAddPersona={handleAddPersona}
      onRemovePersona={handleRemovePersona}
      onCreatePersonaFromTemplate={handleCreatePersonaFromTemplate}
      onStartPipeline={handleStartPipeline}
      onSelectPipeline={handleSelectPipeline}
      onClearActivePipeline={handleClearActivePipeline}
      onStopPipeline={handleStopPipeline}
      onClearHistory={handleClearHistory}
    />
  )
}
