import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { deepResearchRunsStateAtomFamily, type DeepResearchRunsState } from '@/atoms/deep-research-runs'
import type { DeepResearchRunDTO, ReviseDeepResearchPlanInput, StartDeepResearchRunInput } from '../../shared/types'

export interface UseDeepResearchRunsResult {
  runs: DeepResearchRunDTO[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  start: (input: StartDeepResearchRunInput) => Promise<DeepResearchRunDTO>
  approve: (runId: string) => Promise<DeepResearchRunDTO>
  revise: (runId: string, input: ReviseDeepResearchPlanInput) => Promise<DeepResearchRunDTO>
  cancel: (runId: string) => Promise<DeepResearchRunDTO>
  remove: (runId: string) => Promise<boolean>
}

const NULL_WORKSPACE_KEY = '__no_workspace__'
const loadedWorkspaceKeys = new Set<string>()
const inFlightRefreshes = new Map<string, Promise<void>>()
const mountedWorkspaceKeys = new Map<string, number>()
const setStateByWorkspaceKey = new Map<string, (updater: (prev: DeepResearchRunsState) => DeepResearchRunsState) => void>()
let globalCleanup: (() => void) | null = null

function getWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? NULL_WORKSPACE_KEY
}

function sortRuns(runs: DeepResearchRunDTO[]): DeepResearchRunDTO[] {
  return [...runs].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

function spliceRun(runs: DeepResearchRunDTO[], next: DeepResearchRunDTO): DeepResearchRunDTO[] {
  return sortRuns([...runs.filter((run) => run.id !== next.id), next])
}

export function useDeepResearchRuns(workspaceId: string | null | undefined): UseDeepResearchRunsResult {
  const workspaceKey = getWorkspaceKey(workspaceId)
  const [state, setState] = useAtom(deepResearchRunsStateAtomFamily(workspaceKey))

  const refresh = useCallback(async () => {
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing
    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        const runs = workspaceId ? await window.electronAPI.listDeepResearchRuns(workspaceId) : []
        setState({ runs: sortRuns(runs), loading: false, error: null })
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
    setStateByWorkspaceKey.set(workspaceKey, setState)
    return () => {
      if (setStateByWorkspaceKey.get(workspaceKey) === setState) {
        setStateByWorkspaceKey.delete(workspaceKey)
      }
    }
  }, [setState, workspaceKey])

  useEffect(() => {
    if (!loadedWorkspaceKeys.has(workspaceKey)) void refresh()
  }, [refresh, workspaceKey])

  useEffect(() => {
    mountedWorkspaceKeys.set(workspaceKey, (mountedWorkspaceKeys.get(workspaceKey) ?? 0) + 1)
    if (!globalCleanup) {
      globalCleanup = window.electronAPI.onDeepResearchRunUpdated((changedWorkspaceId, run) => {
        const setStateChanged = setStateByWorkspaceKey.get(getWorkspaceKey(changedWorkspaceId))
        if (setStateChanged) setStateChanged((prev) => ({ ...prev, runs: spliceRun(prev.runs, run) }))
      })
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) mountedWorkspaceKeys.delete(workspaceKey)
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)
      if (mountedWorkspaceKeys.size === 0 && globalCleanup) {
        globalCleanup()
        globalCleanup = null
      }
    }
  }, [workspaceKey])

  const start = useCallback(async (input: StartDeepResearchRunInput) => {
    if (!workspaceId) throw new Error('No active workspace')
    const created = await window.electronAPI.startDeepResearchRun(workspaceId, input)
    setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, created) }))
    return created
  }, [setState, workspaceId])

  const approve = useCallback(async (runId: string) => {
    if (!workspaceId) throw new Error('No active workspace')
    const updated = await window.electronAPI.approveDeepResearchPlan(workspaceId, runId)
    setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, updated) }))
    return updated
  }, [setState, workspaceId])

  const revise = useCallback(async (runId: string, input: ReviseDeepResearchPlanInput) => {
    if (!workspaceId) throw new Error('No active workspace')
    const updated = await window.electronAPI.reviseDeepResearchPlan(workspaceId, runId, input)
    setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, updated) }))
    return updated
  }, [setState, workspaceId])

  const cancel = useCallback(async (runId: string) => {
    if (!workspaceId) throw new Error('No active workspace')
    const updated = await window.electronAPI.cancelDeepResearchRun(workspaceId, runId)
    setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, updated) }))
    return updated
  }, [setState, workspaceId])

  const remove = useCallback(async (runId: string) => {
    if (!workspaceId) return false
    const ok = await window.electronAPI.deleteDeepResearchRun(workspaceId, runId)
    if (ok) setState((prev) => ({ ...prev, runs: prev.runs.filter((run) => run.id !== runId) }))
    return ok
  }, [setState, workspaceId])

  return { runs: state.runs, loading: state.loading, error: state.error, refresh, start, approve, revise, cancel, remove }
}
