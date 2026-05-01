/**
 * useWorkflowRuns
 *
 * Renderer-side state for the workflow run history of a workspace.
 * Subscribes to onWorkflowRunUpdated and splices live runs into the list
 * so the recent-runs page and the run page both stay reactive.
 */

import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { workflowRunsStateAtomFamily, type WorkflowRunsState } from '@/atoms/workflow-runs'
import type { WorkflowRunDTO } from '../../shared/types'

export interface UseWorkflowRunsResult {
  runs: WorkflowRunDTO[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  start: (workflowSlug: string, triggerInputs: Record<string, unknown>) => Promise<WorkflowRunDTO>
  cancel: (runId: string) => Promise<void>
  remove: (runId: string) => Promise<boolean>
}

const NULL_WORKSPACE_KEY = '__no_workspace__'
const loadedWorkspaceKeys = new Set<string>()
const inFlightRefreshes = new Map<string, Promise<void>>()
const mountedWorkspaceKeys = new Map<string, number>()
let globalRunsCleanup: (() => void) | null = null
const setStateByWorkspaceKey = new Map<string, (updater: (prev: WorkflowRunsState) => WorkflowRunsState) => void>()
const refreshersByWorkspaceKey = new Map<string, () => Promise<void>>()

function getWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? NULL_WORKSPACE_KEY
}

function sortRuns(runs: WorkflowRunDTO[]): WorkflowRunDTO[] {
  return [...runs].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

function spliceRun(runs: WorkflowRunDTO[], next: WorkflowRunDTO): WorkflowRunDTO[] {
  const filtered = runs.filter((r) => r.id !== next.id)
  filtered.push(next)
  return sortRuns(filtered)
}

export function useWorkflowRuns(workspaceId: string | null | undefined): UseWorkflowRunsResult {
  const workspaceKey = getWorkspaceKey(workspaceId)
  const [state, setState] = useAtom(workflowRunsStateAtomFamily(workspaceKey))

  const refresh = useCallback(async () => {
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing

    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        const runs = workspaceId
          ? await window.electronAPI.listWorkflowRuns(workspaceId)
          : []
        setState((prev) => {
          const byId = new Map<string, WorkflowRunDTO>()
          for (const run of runs) byId.set(run.id, run)
          for (const run of prev.runs) {
            const listed = byId.get(run.id)
            if (!listed || (run.updatedAt ?? '') > (listed.updatedAt ?? '')) {
              byId.set(run.id, run)
            }
          }
          return {
            runs: sortRuns([...byId.values()]),
            loading: false,
            error: null,
          }
        })
        loadedWorkspaceKeys.add(workspaceKey)
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        inFlightRefreshes.delete(workspaceKey)
      }
    })()

    inFlightRefreshes.set(workspaceKey, run)
    return run
  }, [setState, workspaceId, workspaceKey])

  useEffect(() => {
    refreshersByWorkspaceKey.set(workspaceKey, refresh)
    setStateByWorkspaceKey.set(workspaceKey, setState)
    return () => {
      if (refreshersByWorkspaceKey.get(workspaceKey) === refresh) {
        refreshersByWorkspaceKey.delete(workspaceKey)
      }
      if (setStateByWorkspaceKey.get(workspaceKey) === setState) {
        setStateByWorkspaceKey.delete(workspaceKey)
      }
    }
  }, [refresh, setState, workspaceKey])

  useEffect(() => {
    if (!loadedWorkspaceKeys.has(workspaceKey)) {
      refresh()
    }
  }, [refresh, workspaceKey])

  useEffect(() => {
    mountedWorkspaceKeys.set(workspaceKey, (mountedWorkspaceKeys.get(workspaceKey) ?? 0) + 1)
    if (!globalRunsCleanup) {
      globalRunsCleanup = window.electronAPI.onWorkflowRunUpdated((changedWorkspaceId, run) => {
        const changedKey = getWorkspaceKey(changedWorkspaceId)
        const setStateChanged = setStateByWorkspaceKey.get(changedKey)
        if (setStateChanged) {
          setStateChanged((prev) => ({ ...prev, runs: spliceRun(prev.runs, run) }))
        }
      })
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) mountedWorkspaceKeys.delete(workspaceKey)
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)

      if (mountedWorkspaceKeys.size === 0 && globalRunsCleanup) {
        globalRunsCleanup()
        globalRunsCleanup = null
      }
    }
  }, [workspaceKey])

  const start = useCallback(async (
    workflowSlug: string,
    triggerInputs: Record<string, unknown>,
  ): Promise<WorkflowRunDTO> => {
    if (!workspaceId) throw new Error('No active workspace')
    const created = await window.electronAPI.startWorkflowRun(workspaceId, workflowSlug, triggerInputs)
    setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, created) }))
    return created
  }, [setState, workspaceId])

  const cancel = useCallback(async (runId: string) => {
    if (!workspaceId) return
    await window.electronAPI.cancelWorkflowRun(workspaceId, runId)
  }, [workspaceId])

  const remove = useCallback(async (runId: string) => {
    if (!workspaceId) return false
    const ok = await window.electronAPI.deleteWorkflowRun(workspaceId, runId)
    if (ok) {
      setState((prev) => ({ ...prev, runs: prev.runs.filter((r) => r.id !== runId) }))
    }
    return ok
  }, [setState, workspaceId])

  return {
    runs: state.runs,
    loading: state.loading,
    error: state.error,
    refresh,
    start,
    cancel,
    remove,
  }
}
