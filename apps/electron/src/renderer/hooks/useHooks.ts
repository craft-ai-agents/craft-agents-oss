/**
 * useHooks
 *
 * Encapsulates all hooks (tasks) state management:
 * - Loading hooks from hooks.json
 * - Subscribing to live updates
 * - Test, toggle, duplicate, delete handlers
 * - Delete confirmation state
 * - Syncing hooks to Jotai atom for cross-component access
 */

import { useState, useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { hooksAtom } from '@/atoms/hooks'
import { parseHooksConfig, type HookListItem, type TestResult, type ExecutionEntry } from '@/components/hooks/types'

async function loadHooksFromDisk(rootPath: string): Promise<HookListItem[]> {
  // Try tasks.json first (v2), fall back to hooks.json (v1)
  let content: string
  try {
    content = await window.electronAPI.readFile(`${rootPath}/tasks.json`)
  } catch {
    content = await window.electronAPI.readFile(`${rootPath}/hooks.json`)
  }
  const parsed = JSON.parse(content)
  return parseHooksConfig(parsed)
}

export interface UseHooksResult {
  hooks: HookListItem[]
  hookTestResults: Record<string, TestResult>
  hookPendingDelete: string | null
  pendingDeleteHook: HookListItem | undefined
  setHookPendingDelete: (id: string | null) => void
  handleTestHook: (hookId: string) => void
  handleToggleHook: (hookId: string) => void
  handleDuplicateHook: (hookId: string) => void
  handleDeleteHook: (hookId: string) => void
  confirmDeleteHook: () => void
  getHookHistory: (hookId: string) => Promise<ExecutionEntry[]>
}

export function useHooks(
  activeWorkspaceId: string | null | undefined,
  activeWorkspaceRootPath: string | undefined,
): UseHooksResult {
  const [hooks, setHooks] = useState<HookListItem[]>([])
  const [hookTestResults, setHookTestResults] = useState<Record<string, TestResult>>({})
  const [hookPendingDelete, setHookPendingDelete] = useState<string | null>(null)

  // Sync hooks to Jotai atom for cross-component access (MainContentPanel)
  const setHooksAtom = useSetAtom(hooksAtom)
  useEffect(() => {
    setHooksAtom(hooks)
  }, [hooks, setHooksAtom])

  // Load hooks from workspace hooks.json
  useEffect(() => {
    if (!activeWorkspaceRootPath) return
    let stale = false
    loadHooksFromDisk(activeWorkspaceRootPath)
      .then((items) => { if (!stale) setHooks(items) })
      .catch(() => { if (!stale) setHooks([]) })
    return () => { stale = true }
  }, [activeWorkspaceRootPath])

  // Subscribe to live hooks updates (when hooks.json changes on disk)
  useEffect(() => {
    if (!activeWorkspaceRootPath) return
    let stale = false
    const cleanup = window.electronAPI.onHooksChanged(() => {
      loadHooksFromDisk(activeWorkspaceRootPath)
        .then((items) => { if (!stale) setHooks(items) })
        .catch(() => { if (!stale) setHooks([]) })
    })
    return () => { stale = true; cleanup() }
  }, [activeWorkspaceRootPath])

  // Test hook — aggregate all action results
  const handleTestHook = useCallback((hookId: string) => {
    const hook = hooks.find(h => h.id === hookId)
    if (!hook || !activeWorkspaceId) return

    setHookTestResults(prev => ({ ...prev, [hookId]: { state: 'running' } }))

    window.electronAPI.testHook({
      workspaceId: activeWorkspaceId,
      hooks: hook.hooks,
      permissionMode: hook.permissionMode,
      labels: hook.labels,
    }).then((result) => {
      const actions = result.actions
      if (!actions || actions.length === 0) {
        setHookTestResults(prev => ({ ...prev, [hookId]: { state: 'error', stderr: 'No actions to execute' } }))
        return
      }
      const hasBlocked = actions.some(a => a.blocked)
      const hasError = actions.some(a => !a.success && !a.blocked)
      const state = hasBlocked ? 'blocked' : hasError ? 'error' : 'success'
      const stdout = actions.map(a => a.stdout).filter(Boolean).join('\n')
      const stderr = actions.map(a => a.stderr).filter(Boolean).join('\n')
      const duration = actions.reduce((sum, a) => sum + (a.duration ?? 0), 0)
      const blockedReason = actions.map(a => a.blockedReason).filter(Boolean).join('; ')
      setHookTestResults(prev => ({
        ...prev,
        [hookId]: {
          state,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
          exitCode: actions[actions.length - 1]?.exitCode,
          duration: duration || undefined,
          blockedReason: blockedReason || undefined,
        },
      }))
    }).catch((err: Error) => {
      setHookTestResults(prev => ({ ...prev, [hookId]: { state: 'error', stderr: err.message } }))
    })
  }, [hooks, activeWorkspaceId])

  const handleToggleHook = useCallback((hookId: string) => {
    const hook = hooks.find(h => h.id === hookId)
    if (!hook || !activeWorkspaceId) return
    window.electronAPI.setHookEnabled(
      activeWorkspaceId,
      hook.event,
      hook.matcherIndex,
      !hook.enabled,
    ).catch(() => {
      toast.error('Failed to toggle task')
    })
  }, [hooks, activeWorkspaceId])

  const handleDuplicateHook = useCallback((hookId: string) => {
    const hook = hooks.find(h => h.id === hookId)
    if (!hook || !activeWorkspaceId) return
    window.electronAPI.duplicateHook(activeWorkspaceId, hook.event, hook.matcherIndex)
      .catch(() => toast.error('Failed to duplicate task'))
  }, [hooks, activeWorkspaceId])

  // Delete: show confirmation dialog
  const handleDeleteHook = useCallback((hookId: string) => {
    setHookPendingDelete(hookId)
  }, [])

  const pendingDeleteHook = hookPendingDelete ? hooks.find(h => h.id === hookPendingDelete) : undefined

  const confirmDeleteHook = useCallback(() => {
    if (!pendingDeleteHook || !activeWorkspaceId) return
    window.electronAPI.deleteHook(activeWorkspaceId, pendingDeleteHook.event, pendingDeleteHook.matcherIndex)
      .catch(() => toast.error('Failed to delete task'))
    setHookPendingDelete(null)
  }, [pendingDeleteHook, activeWorkspaceId])

  // Fetch execution history for a specific hook
  const getHookHistory = useCallback(async (hookId: string): Promise<ExecutionEntry[]> => {
    if (!activeWorkspaceId) return []
    try {
      const entries = await window.electronAPI.getHookHistory(activeWorkspaceId, hookId, 20)
      const hook = hooks.find(h => h.id === hookId)
      return entries.map((e: { id: string; ts: number; ok: boolean }) => ({
        id: `${e.id}-${e.ts}`,
        hookId: e.id,
        event: hook?.event ?? 'LabelAdd',
        status: e.ok ? 'success' as const : 'error' as const,
        duration: 0,
        timestamp: e.ts,
      }))
    } catch {
      return []
    }
  }, [activeWorkspaceId, hooks])

  return {
    hooks,
    hookTestResults,
    hookPendingDelete,
    pendingDeleteHook,
    setHookPendingDelete,
    handleTestHook,
    handleToggleHook,
    handleDuplicateHook,
    handleDeleteHook,
    confirmDeleteHook,
    getHookHistory,
  }
}
