import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { AutomationGraphProjection } from '@craft-agent/shared/automations/graph'
import type { AutomationGraph } from '@craft-agent/shared/automations/types'
import { cn } from '@/lib/utils'
import { AutomationGraphEditor } from './AutomationGraphEditor'

export interface AutomationGraphWorkspaceEditorProps {
  workspaceId: string | null | undefined
  className?: string
}

/**
 * Workspace-scoped graph editor. The graph projection endpoint is intentionally
 * separate from the normal automations list read: viewing an absent config must
 * not seed a file; only a successful graph save creates one.
 */
export function AutomationGraphWorkspaceEditor({
  workspaceId,
  className,
}: AutomationGraphWorkspaceEditorProps) {
  const { t } = useTranslation()
  const [projection, setProjection] = React.useState<AutomationGraphProjection | null>(null)
  const [isLoading, setIsLoading] = React.useState(Boolean(workspaceId))
  const [loadFailed, setLoadFailed] = React.useState(false)

  const refresh = React.useCallback(async () => {
    if (!workspaceId) {
      setProjection(null)
      setLoadFailed(false)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const nextProjection = await window.electronAPI.getAutomationGraph(workspaceId)
      setProjection(nextProjection)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refresh()
    if (!workspaceId) return

    return window.electronAPI.onAutomationsChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) void refresh()
    })
  }, [refresh, workspaceId])

  const handleGraphChange = React.useCallback((graph: AutomationGraph) => {
    setProjection((current) => current ? { ...current, graph } : current)
  }, [])

  const saveGraph = React.useCallback(async (graph: AutomationGraph) => {
    if (!workspaceId || !projection) {
      throw new Error(t('auth.somethingWentWrongRetry'))
    }

    try {
      const saved = await window.electronAPI.saveAutomationGraph({
        workspaceId,
        graph,
        baseRevision: projection.revision,
      })
      setProjection({
        graph: saved.graph,
        revision: saved.revision,
        isDefault: false,
      })
    } catch (error) {
      if (error instanceof Error && /\bstale\b/i.test(error.message)) await refresh()
      throw error
    }
  }, [projection, refresh, t, workspaceId])

  if (!workspaceId) return null

  if (!projection && isLoading) {
    return (
      <div className={cn('flex min-h-48 items-center justify-center text-sm text-muted-foreground', className)} aria-busy="true">
        {t('common.loading')}
      </div>
    )
  }

  if (!projection || loadFailed) {
    return (
      <p className={cn('text-sm text-destructive', className)} role="alert">
        {t('auth.somethingWentWrongRetry')}
      </p>
    )
  }

  return (
    <AutomationGraphEditor
      graph={projection.graph}
      onChange={handleGraphChange}
      onSave={saveGraph}
      className={className}
    />
  )
}
