/**
 * WorkflowInfoPage
 *
 * Displays comprehensive workflow details including metadata,
 * instructions, knowledge files, and slash command usage.
 * Uses the Info_ component system for consistent styling.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { toast } from 'sonner'
import { WorkflowMenu } from '@/components/app-shell/WorkflowMenu'
import { WorkflowAvatar } from '@/components/ui/workflow-avatar'
import { routes, navigate } from '@/lib/navigate'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import type { LoadedWorkflow } from '../../shared/types'

interface WorkflowInfoPageProps {
  workflowSlug: string
  workspaceId: string
}

export default function WorkflowInfoPage({ workflowSlug, workspaceId }: WorkflowInfoPageProps) {
  const [workflow, setWorkflow] = useState<LoadedWorkflow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load workflow data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadWorkflow = async () => {
      try {
        const workflows = await window.electronAPI.getWorkflows(workspaceId)

        if (!isMounted) return

        const found = workflows.find((w) => w.slug === workflowSlug)
        if (found) {
          setWorkflow(found)
        } else {
          setError('Workflow not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load workflow')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadWorkflow()

    // Subscribe to workflow changes
    const unsubscribe = window.electronAPI.onWorkflowsChanged?.((workflows) => {
      const updated = workflows.find((w) => w.slug === workflowSlug)
      if (updated) {
        setWorkflow(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, workflowSlug])

  const handleOpenInFinder = useCallback(async () => {
    if (!workflow) return
    try {
      await window.electronAPI.openWorkflowInFinder(workspaceId, workflowSlug)
    } catch (err) {
      console.error('Failed to open workflow in finder:', err)
    }
  }, [workflow, workspaceId, workflowSlug])

  const handleDelete = useCallback(async () => {
    if (!workflow) return
    try {
      await window.electronAPI.deleteWorkflow(workspaceId, workflowSlug)
      toast.success(`Deleted workflow: ${workflow.metadata.name}`)
      navigate(routes.view.workflows())
    } catch (err) {
      toast.error('Failed to delete workflow', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [workflow, workspaceId, workflowSlug])

  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`g4os://workflows/workflow/${workflowSlug}?window=focused`)
  }, [workflowSlug])

  const workflowName = workflow?.metadata.name || workflowSlug

  const formatPath = (path: string) => {
    const workflowsIndex = path.indexOf('/workflows/')
    if (workflowsIndex !== -1) {
      return path.slice(workflowsIndex + 1)
    }
    return path
  }

  const handleLocationClick = () => {
    if (!workflow) return
    window.electronAPI.showInFolder(`${workflow.path}/WORKFLOW.md`)
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!workflow && !loading && !error ? 'Workflow not found' : undefined}
    >
      <Info_Page.Header
        title={workflowName}
        titleMenu={
          <WorkflowMenu
            workflowSlug={workflowSlug}
            workflowName={workflowName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            onDelete={handleDelete}
          />
        }
      />

      {workflow && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<WorkflowAvatar workflow={workflow} fluid workspaceId={workspaceId} />}
            title={workflow.metadata.name}
            tagline={workflow.metadata.description}
          />

          {/* Metadata */}
          <Info_Section
            title="Metadata"
            actions={
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('workflow-metadata', workflow.path)}
                secondaryAction={{
                  label: 'Edit File',
                  filePath: `${workflow.path}/WORKFLOW.md`,
                }}
              />
            }
          >
            <Info_Table>
              <Info_Table.Row label="Slug" value={workflow.slug} />
              <Info_Table.Row label="Name">{workflow.metadata.name}</Info_Table.Row>
              <Info_Table.Row label="Description">
                {workflow.metadata.description}
              </Info_Table.Row>
              <Info_Table.Row label="Slash Command">
                <code className="text-xs bg-foreground/5 px-1.5 py-0.5 rounded">/{workflow.slug}</code>
              </Info_Table.Row>
              <Info_Table.Row label="Location">
                <button
                  onClick={handleLocationClick}
                  className="hover:underline cursor-pointer text-left"
                >
                  {formatPath(workflow.path)}
                </button>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Instructions */}
          <Info_Section
            title="Instructions"
            actions={
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('workflow-instructions', workflow.path)}
                secondaryAction={{
                  label: 'Edit File',
                  filePath: `${workflow.path}/WORKFLOW.md`,
                }}
              />
            }
          >
            <Info_Markdown maxHeight={540} fullscreen>
              {workflow.content || '*No instructions provided.*'}
            </Info_Markdown>
          </Info_Section>

          {/* Knowledge Files */}
          {workflow.knowledgeFiles.length > 0 && (
            <Info_Section title="Knowledge Files">
              <div className="space-y-3 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  These files are injected as context when the workflow is triggered via <code className="text-xs bg-foreground/5 px-1 py-0.5 rounded">/{workflow.slug}</code>.
                </p>
                {workflow.knowledgeFiles.map((kf) => (
                  <div key={kf.name} className="rounded-[8px] border border-border/50 overflow-hidden">
                    <div className="px-3 py-2 bg-foreground/[0.02] border-b border-border/30">
                      <span className="text-xs font-medium font-mono">{kf.name}</span>
                    </div>
                    <Info_Markdown maxHeight={300}>
                      {kf.content}
                    </Info_Markdown>
                  </div>
                ))}
              </div>
            </Info_Section>
          )}

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
