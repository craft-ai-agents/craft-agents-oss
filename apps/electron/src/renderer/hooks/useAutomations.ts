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
  const automationsPath = `${rootPath}/automations.json`
  const content = await window.electronAPI.readFile(automationsPath)
  return parseAutomationsConfig(JSON.parse(content))
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

  // Load automations from disk and hydrate lastExecutedAt from history in one step.
  // This avoids the race where a config reload wipes timestamps before the
  // history effect can re-merge them.
  const loadAndHydrate = useCallback(async () => {
    if (!activeWorkspaceRootPath) return
    try {
      const items = await loadAutomationsFromDisk(activeWorkspaceRootPath)
      if (activeWorkspaceId) {
        try {
          const map = await window.electronAPI.getAutomationLastExecuted(activeWorkspaceId)
          for (const item of items) {
            item.lastExecutedAt = map[item.id] ?? item.lastExecutedAt
          }
        } catch { /* history unavailable — timestamps stay undefined */ }
      }
      setAutomations(items)
    } catch {
      setAutomations([])
    }
  }, [activeWorkspaceRootPath, activeWorkspaceId])

  // Initial load
  useEffect(() => {
    loadAndHydrate()
  }, [loadAndHydrate])

  // Subscribe to live automations updates (when automations.json changes on disk)
  useEffect(() => {
    if (!activeWorkspaceRootPath) return
    const cleanup = window.electronAPI.onAutomationsChanged(() => { loadAndHydrate() })
    return () => { cleanup() }
  }, [activeWorkspaceRootPath, loadAndHydrate])

  // Shared lookup — avoids repeating automations.find() in every callback
  const findAutomation = useCallback((id: string) => automations.find(h => h.id === id), [automations])

  // Test automation — aggregate all action results
  const handleTestAutomation = useCallback((automationId: string) => {
    const automation = findAutomation(automationId)
    if (!automation || !activeWorkspaceId) return

    setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'running' } }))

    window.electronAPI.testAutomation({
      workspaceId: activeWorkspaceId,
      automationId: automation.id,
      actions: automation.actions,
      permissionMode: automation.permissionMode,
      labels: automation.labels,
    }).then((result) => {
      const actions = result.actions
      if (!actions || actions.length === 0) {
        setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'error', stderr: 'No actions to execute' } }))
        return
      }
      const hasError = actions.some(a => !a.success)
      const state = hasError ? 'error' : 'success'
      const stderr = actions.map(a => a.stderr).filter(Boolean).join('\n')
      const duration = actions.reduce((sum, a) => sum + (a.duration ?? 0), 0)
      setAutomationTestResults(prev => ({
        ...prev,
        [automationId]: {
          state,
          stderr: stderr || undefined,
          duration: duration || undefined,
        },
      }))
    }).catch((err: Error) => {
      setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'error', stderr: err.message } }))
    })
  }, [findAutomation, activeWorkspaceId])

  const handleToggleAutomation = useCallback((automationId: string) => {
    const automation = findAutomation(automationId)
    if (!automation || !activeWorkspaceId) return
    window.electronAPI.setAutomationEnabled(
      activeWorkspaceId,
      automation.event,
      automation.matcherIndex,
      !automation.enabled,
    ).catch(() => {
      toast.error('Failed to toggle automation')
    })
  }, [findAutomation, activeWorkspaceId])

  const handleDuplicateAutomation = useCallback((automationId: string) => {
    const automation = findAutomation(automationId)
    if (!automation || !activeWorkspaceId) return
    window.electronAPI.duplicateAutomation(activeWorkspaceId, automation.event, automation.matcherIndex)
      .catch(() => toast.error('Failed to duplicate automation'))
  }, [findAutomation, activeWorkspaceId])

  // Delete: show confirmation dialog
  const handleDeleteAutomation = useCallback((automationId: string) => {
    setAutomationPendingDelete(automationId)
  }, [])

  const pendingDeleteAutomation = automationPendingDelete ? findAutomation(automationPendingDelete) : undefined

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
      const automation = findAutomation(automationId)
      return entries.map((e: { id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string }) => ({
        id: `${e.id}-${e.ts}`,
        automationId: e.id,
        event: automation?.event ?? 'LabelAdd',
        status: e.ok ? 'success' as const : 'error' as const,
        duration: 0,
        timestamp: e.ts,
        sessionId: e.sessionId,
        actionSummary: e.prompt,
        error: e.error,
      }))
    } catch {
      return []
    }
  }, [activeWorkspaceId, findAutomation])

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
