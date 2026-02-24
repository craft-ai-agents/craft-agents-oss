/**
 * useAutomations
 *
 * Encapsulates all automations state management:
 * - Loading automations from automations.json
 * - Subscribing to live updates
 * - Test, toggle, duplicate, delete handlers
 * - Delete confirmation state
 * - Syncing automations to Jotai atom for cross-component access
 */

import { useState, useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { automationsAtom } from '@/atoms/automations'
import { parseAutomationsConfig, type AutomationListItem, type TestResult, type ExecutionEntry } from '@/components/automations/types'

async function loadAutomationsFromDisk(rootPath: string): Promise<AutomationListItem[]> {
  // automations.json is canonical. Legacy fallback is used only when hooks.json exists.
  const automationsPath = `${rootPath}/automations.json`
  const hooksPath = `${rootPath}/hooks.json`

  // 1) Try canonical automations.json
  try {
    const automationsContent = await window.electronAPI.readFile(automationsPath)
    return parseAutomationsConfig(JSON.parse(automationsContent))
  } catch {
    // Continue to legacy fallback below
  }

  // 2) Legacy fallback: only if hooks.json exists/readable.
  // This is a migration safety net, not a first-class config path.
  const legacyContent = await window.electronAPI.readFile(hooksPath)
  console.warn('[automations] Falling back to deprecated hooks.json in renderer. Please migrate to automations.json.')
  return parseAutomationsConfig(JSON.parse(legacyContent))
}

export interface UseAutomationsResult {
  automations: AutomationListItem[]
  automationTestResults: Record<string, TestResult>
  automationPendingDelete: string | null
  pendingDeleteAutomation: AutomationListItem | undefined
  setAutomationPendingDelete: (id: string | null) => void
  handleTestAutomation: (automationId: string) => void
  handleToggleAutomation: (automationId: string) => void
  handleDuplicateAutomation: (automationId: string) => void
  handleDeleteAutomation: (automationId: string) => void
  confirmDeleteAutomation: () => void
  getAutomationHistory: (automationId: string) => Promise<ExecutionEntry[]>
}

export function useAutomations(
  activeWorkspaceId: string | null | undefined,
  activeWorkspaceRootPath: string | undefined,
): UseAutomationsResult {
  const [automations, setAutomations] = useState<AutomationListItem[]>([])
  const [automationTestResults, setAutomationTestResults] = useState<Record<string, TestResult>>({})
  const [automationPendingDelete, setAutomationPendingDelete] = useState<string | null>(null)

  // Sync automations to Jotai atom for cross-component access (MainContentPanel)
  const setAutomationsAtom = useSetAtom(automationsAtom)
  useEffect(() => {
    setAutomationsAtom(automations)
  }, [automations, setAutomationsAtom])

  // Load automations from workspace automations.json
  useEffect(() => {
    if (!activeWorkspaceRootPath) return
    let stale = false
    loadAutomationsFromDisk(activeWorkspaceRootPath)
      .then((items) => { if (!stale) setAutomations(items) })
      .catch(() => { if (!stale) setAutomations([]) })
    return () => { stale = true }
  }, [activeWorkspaceRootPath])

  // Subscribe to live automations updates (when automations.json changes on disk)
  useEffect(() => {
    if (!activeWorkspaceRootPath) return
    let stale = false
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      loadAutomationsFromDisk(activeWorkspaceRootPath)
        .then((items) => { if (!stale) setAutomations(items) })
        .catch(() => { if (!stale) setAutomations([]) })
    })
    return () => { stale = true; cleanup() }
  }, [activeWorkspaceRootPath])

  // Test automation — aggregate all action results
  const handleTestAutomation = useCallback((automationId: string) => {
    const automation = automations.find(h => h.id === automationId)
    if (!automation || !activeWorkspaceId) return

    setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'running' } }))

    window.electronAPI.testAutomation({
      workspaceId: activeWorkspaceId,
      actions: automation.actions,
      permissionMode: automation.permissionMode,
      labels: automation.labels,
    }).then((result) => {
      const actions = result.actions
      if (!actions || actions.length === 0) {
        setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'error', stderr: 'No actions to execute' } }))
        return
      }
      const hasBlocked = actions.some(a => a.blocked)
      const hasError = actions.some(a => !a.success && !a.blocked)
      const state = hasBlocked ? 'blocked' : hasError ? 'error' : 'success'
      const stdout = actions.map(a => a.stdout).filter(Boolean).join('\n')
      const stderr = actions.map(a => a.stderr).filter(Boolean).join('\n')
      const duration = actions.reduce((sum, a) => sum + (a.duration ?? 0), 0)
      const blockedReason = actions.map(a => a.blockedReason).filter(Boolean).join('; ')
      setAutomationTestResults(prev => ({
        ...prev,
        [automationId]: {
          state,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
          exitCode: actions[actions.length - 1]?.exitCode,
          duration: duration || undefined,
          blockedReason: blockedReason || undefined,
        },
      }))
    }).catch((err: Error) => {
      setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'error', stderr: err.message } }))
    })
  }, [automations, activeWorkspaceId])

  const handleToggleAutomation = useCallback((automationId: string) => {
    const automation = automations.find(h => h.id === automationId)
    if (!automation || !activeWorkspaceId) return
    window.electronAPI.setAutomationEnabled(
      activeWorkspaceId,
      automation.event,
      automation.matcherIndex,
      !automation.enabled,
    ).catch(() => {
      toast.error('Failed to toggle automation')
    })
  }, [automations, activeWorkspaceId])

  const handleDuplicateAutomation = useCallback((automationId: string) => {
    const automation = automations.find(h => h.id === automationId)
    if (!automation || !activeWorkspaceId) return
    window.electronAPI.duplicateAutomation(activeWorkspaceId, automation.event, automation.matcherIndex)
      .catch(() => toast.error('Failed to duplicate automation'))
  }, [automations, activeWorkspaceId])

  // Delete: show confirmation dialog
  const handleDeleteAutomation = useCallback((automationId: string) => {
    setAutomationPendingDelete(automationId)
  }, [])

  const pendingDeleteAutomation = automationPendingDelete ? automations.find(h => h.id === automationPendingDelete) : undefined

  const confirmDeleteAutomation = useCallback(() => {
    if (!pendingDeleteAutomation || !activeWorkspaceId) return
    window.electronAPI.deleteAutomation(activeWorkspaceId, pendingDeleteAutomation.event, pendingDeleteAutomation.matcherIndex)
      .catch(() => toast.error('Failed to delete automation'))
    setAutomationPendingDelete(null)
  }, [pendingDeleteAutomation, activeWorkspaceId])

  // Fetch execution history for a specific automation
  const getAutomationHistory = useCallback(async (automationId: string): Promise<ExecutionEntry[]> => {
    if (!activeWorkspaceId) return []
    try {
      const entries = await window.electronAPI.getAutomationHistory(activeWorkspaceId, automationId, 20)
      const automation = automations.find(h => h.id === automationId)
      return entries.map((e: { id: string; ts: number; ok: boolean }) => ({
        id: `${e.id}-${e.ts}`,
        automationId: e.id,
        event: automation?.event ?? 'LabelAdd',
        status: e.ok ? 'success' as const : 'error' as const,
        duration: 0,
        timestamp: e.ts,
      }))
    } catch {
      return []
    }
  }, [activeWorkspaceId, automations])

  return {
    automations,
    automationTestResults,
    automationPendingDelete,
    pendingDeleteAutomation,
    setAutomationPendingDelete,
    handleTestAutomation,
    handleToggleAutomation,
    handleDuplicateAutomation,
    handleDeleteAutomation,
    confirmDeleteAutomation,
    getAutomationHistory,
  }
}
