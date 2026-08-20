/**
 * Toolchain Status Hook
 *
 * Subscribes to the toolchain download manager (first-run downloads of the
 * agent runtime: omp, node, python, ffmpeg, … — spec 2026-08-06).
 *
 * - Loads the per-tool status snapshot on mount
 * - Applies incremental push updates (phase changes + download progress)
 * - Exposes `updateTool(name)` for forced update / retry
 * - Degrades gracefully when the local server has no toolchain handler
 *   (headless/remote transports): `available` is false and the hook is inert.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ToolchainToolStatus, ToolchainToolName } from '../../shared/types'
import { RPC_CHANNELS } from '../../shared/types'

interface UseToolchainStatusResult {
  /** True when the connected server registered the toolchain manager handler. */
  available: boolean
  /** True while the initial snapshot is loading. */
  isLoading: boolean
  /** Snapshot of every known tool, keyed status stream applied. */
  tools: ToolchainToolStatus[]
  /** Lookup helper for a single tool. */
  getTool: (name: ToolchainToolName) => ToolchainToolStatus | undefined
  /** Force update / retry of one tool (outdated, error or missing phase). */
  updateTool: (name: ToolchainToolName) => Promise<void>
  /** Name of the tool a manual update is currently running for. */
  updating: ToolchainToolName | null
}

export function useToolchainStatus(): UseToolchainStatusResult {
  const [available, setAvailable] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [tools, setTools] = useState<ToolchainToolStatus[]>([])
  const [updating, setUpdating] = useState<ToolchainToolName | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.isChannelAvailable?.(RPC_CHANNELS.toolchain.STATUS)) {
      setAvailable(false)
      setIsLoading(false)
      return
    }
    setAvailable(true)

    let cancelled = false
    api
      .getToolchainStatus()
      .then((snapshot) => {
        if (!cancelled) {
          setTools(snapshot)
          setIsLoading(false)
        }
      })
      .catch((error) => {
        console.error('[useToolchainStatus] Failed to load status:', error)
        if (!cancelled) {
          setAvailable(false)
          setIsLoading(false)
        }
      })

    const unsubscribe = api.onToolchainStatusChanged((status) => {
      setTools((prev) => {
        const index = prev.findIndex((tool) => tool.name === status.name)
        if (index === -1) return [...prev, status]
        const next = prev.slice()
        next[index] = status
        return next
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const toolsByName = useMemo(() => {
    const lookup: Partial<Record<ToolchainToolName, ToolchainToolStatus>> = {}
    for (const tool of tools) lookup[tool.name] = tool
    return lookup
  }, [tools])

  const getTool = useCallback(
    (name: ToolchainToolName) => toolsByName[name],
    [toolsByName],
  )

  const updateTool = useCallback(async (name: ToolchainToolName) => {
    if (!window.electronAPI) return
    setUpdating(name)
    try {
      await window.electronAPI.updateToolchainTool(name)
    } catch (error) {
      console.error(`[useToolchainStatus] update(${name}) failed:`, error)
    } finally {
      setUpdating(null)
    }
  }, [])

  return { available, isLoading, tools, getTool, updateTool, updating }
}
