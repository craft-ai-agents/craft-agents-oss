import { useCallback, useEffect, useState } from 'react'
import type { VisualBoardSnapshot } from '@craft-agent/shared/visual-board'
import type { OutputManifestDTO } from './useOutputs'

interface VisualBoardResult {
  output: OutputManifestDTO
  board: VisualBoardSnapshot
}

interface UseVisualBoardResult {
  output: OutputManifestDTO | null
  board: VisualBoardSnapshot | null
  loading: boolean
  error: string | null
  available: boolean
  refresh: () => Promise<void>
  saveBoard: (snapshot: VisualBoardSnapshot) => Promise<VisualBoardResult>
}

type VisualBoardElectronAPI = typeof window.electronAPI & {
  getVisualBoard?: (workspaceId: string, sessionId: string) => Promise<VisualBoardResult>
  saveVisualBoard?: (
    workspaceId: string,
    sessionId: string,
    snapshot: VisualBoardSnapshot,
  ) => Promise<VisualBoardResult>
}

export function useVisualBoard(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): UseVisualBoardResult {
  const electronAPI = window.electronAPI as VisualBoardElectronAPI
  const available = typeof electronAPI.getVisualBoard === 'function'
    && typeof electronAPI.saveVisualBoard === 'function'
  const [output, setOutput] = useState<OutputManifestDTO | null>(null)
  const [board, setBoard] = useState<VisualBoardSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId || !sessionId || !available || typeof electronAPI.getVisualBoard !== 'function') {
      setOutput(null)
      setBoard(null)
      setError(workspaceId && sessionId ? 'Visual board API is unavailable.' : null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await electronAPI.getVisualBoard(workspaceId, sessionId)
      setOutput(result.output)
      setBoard(result.board)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [available, electronAPI, sessionId, workspaceId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const saveBoard = useCallback(async (snapshot: VisualBoardSnapshot) => {
    if (!workspaceId || !sessionId || typeof electronAPI.saveVisualBoard !== 'function') {
      throw new Error('Visual board API is unavailable.')
    }
    const result = await electronAPI.saveVisualBoard(workspaceId, sessionId, snapshot)
    setOutput(result.output)
    return result
  }, [electronAPI, sessionId, workspaceId])

  return {
    output,
    board,
    loading,
    error,
    available,
    refresh,
    saveBoard,
  }
}
