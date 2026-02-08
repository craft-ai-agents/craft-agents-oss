/**
 * usePathRules
 *
 * Hook to load and manage path rules configuration for the active workspace.
 * Subscribes to live changes via LABELS_CHANGED event (path rules changes trigger same broadcast).
 */

import { useState, useEffect, useCallback } from 'react'
import type { PathRulesConfig, PathRule } from '@craft-agent/shared/labels/path-rules'

interface UsePathRulesResult {
  /** Path rules configuration */
  config: PathRulesConfig
  /** Individual rules array (convenience accessor) */
  rules: PathRule[]
  /** Whether data is loading */
  isLoading: boolean
  /** Reload path rules from disk */
  reload: () => Promise<void>
  /** Save updated path rules */
  save: (config: PathRulesConfig) => Promise<void>
}

const EMPTY_CONFIG: PathRulesConfig = { version: 1, rules: [] }

/**
 * Hook to load and manage path rules for a workspace.
 *
 * @param workspaceId - Active workspace ID (or undefined if none)
 */
export function usePathRules(workspaceId: string | undefined): UsePathRulesResult {
  const [config, setConfig] = useState<PathRulesConfig>(EMPTY_CONFIG)
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setConfig(EMPTY_CONFIG)
      setIsLoading(false)
      return
    }

    try {
      const loaded = await window.electronAPI.getPathRules(workspaceId)
      setConfig(loaded)
    } catch (error) {
      console.error('[usePathRules] Failed to load path rules:', error)
      setConfig(EMPTY_CONFIG)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  const save = useCallback(async (newConfig: PathRulesConfig) => {
    if (!workspaceId) return

    try {
      await window.electronAPI.savePathRules(workspaceId, newConfig)
      setConfig(newConfig)
    } catch (error) {
      console.error('[usePathRules] Failed to save path rules:', error)
      throw error
    }
  }, [workspaceId])

  // Initial load
  useEffect(() => {
    setIsLoading(true)
    reload()
  }, [reload])

  // Subscribe to live changes (path rules changes trigger LABELS_CHANGED broadcast)
  useEffect(() => {
    if (!workspaceId) return

    const unsubscribe = window.electronAPI.onLabelsChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) {
        reload()
      }
    })

    return unsubscribe
  }, [workspaceId, reload])

  return {
    config,
    rules: config.rules,
    isLoading,
    reload,
    save,
  }
}
