import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { outputsStateAtomFamily, type OutputsState } from '@/atoms/outputs'

export const OUTPUT_RPC_CHANNELS = {
  LIST: 'outputs:list',
  GET: 'outputs:get',
  OPEN_FILE: 'outputs:openFile',
  SHOW_IN_FOLDER: 'outputs:showInFolder',
  UPDATED: 'outputs:updated',
} as const

export type OutputKind =
  | 'report'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'dataset'
  | 'code'
  | 'model'
  | 'receipt'
  | 'external-action'
  | 'collection'
  | 'other'

export type OutputStatus = 'draft' | 'published' | 'failed' | 'cancelled'
export type OutputPreviewMode = 'markdown' | 'text' | 'json' | 'image' | 'video' | 'audio' | 'model' | 'pdf' | 'excalidraw' | 'presentation' | 'table' | 'receipt' | 'external-link' | 'web'

export interface OutputAssetDTO {
  id: string
  label: string
  role: 'primary' | 'supporting' | 'source' | 'thumbnail' | 'attachment'
  path: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
}

export interface OutputReceiptDTO {
  id: string
  provider: string
  action: string
  status: 'succeeded' | 'failed' | 'pending'
  occurredAt: string
  externalId?: string
  url?: string
  displayText?: string
  metadata?: Record<string, unknown>
}

export interface OutputLinkDTO {
  id: string
  label: string
  url: string
  role?: 'primary' | 'source' | 'related' | 'external'
}

export interface OutputOriginDTO {
  source: 'workflow' | 'session' | 'automation' | 'manual'
  workflowRunId?: string
  workflowSlug?: string
  workflowName?: string
  stepId?: string
  sessionId?: string
  agentSlug?: string
  agentName?: string
  automationId?: string
}

export interface OutputSummaryDTO {
  id: string
  title: string
  kind: OutputKind
  status: OutputStatus
  summary?: string
  createdAt: string
  updatedAt?: string
  completedAt?: string
  origin?: OutputOriginDTO
  primary?: OutputAssetDTO
  primaryAssetId?: string
  previewMode?: OutputPreviewMode
  assetCount?: number
  receiptCount?: number
  linkCount?: number
  preview?: {
    mode: OutputPreviewMode
    assetId?: string
    inlineText?: string
  }
  tags?: string[]
  bundlePath?: string
  directoryPath?: string
  path?: string
}

export interface OutputManifestDTO extends OutputSummaryDTO {
  schemaVersion?: 1
  workspaceId?: string
  slug?: string
  summary: string
  origin: OutputOriginDTO
  primary?: OutputAssetDTO
  assets: OutputAssetDTO[]
  receipts: OutputReceiptDTO[]
  links: OutputLinkDTO[]
}

export interface UseOutputsResult {
  outputs: OutputSummaryDTO[]
  loading: boolean
  error: string | null
  available: boolean
  refresh: () => Promise<void>
  getOutput: (outputId: string) => Promise<OutputManifestDTO | null>
}

type OutputsElectronAPI = typeof window.electronAPI & {
  listOutputs?: (workspaceId: string, filter?: unknown) => Promise<unknown[]>
  getOutput?: (workspaceId: string, outputId: string) => Promise<unknown | null>
  openOutputFile?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
  showOutputInFolder?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
  onOutputsUpdated?: (callback: (workspaceId: string) => void) => () => void
}

const NULL_WORKSPACE_KEY = '__no_workspace__'
const loadedWorkspaceKeys = new Set<string>()
const inFlightRefreshes = new Map<string, Promise<void>>()
const mountedWorkspaceKeys = new Map<string, number>()
let globalOutputsCleanup: (() => void) | null = null
const setStateByWorkspaceKey = new Map<string, (updater: (prev: OutputsState) => OutputsState) => void>()
const refreshersByWorkspaceKey = new Map<string, () => Promise<void>>()

function getWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? NULL_WORKSPACE_KEY
}

function sortOutputs(outputs: OutputSummaryDTO[]): OutputSummaryDTO[] {
  return [...outputs].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

function coerceSummary(raw: unknown): OutputSummaryDTO | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return null
  return value as unknown as OutputSummaryDTO
}

function coerceManifest(raw: unknown): OutputManifestDTO | null {
  const summary = coerceSummary(raw)
  if (!summary || !raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  return {
    ...summary,
    summary: typeof value.summary === 'string' ? value.summary : '',
    origin: (value.origin && typeof value.origin === 'object' ? value.origin : { source: 'manual' }) as OutputOriginDTO,
    assets: Array.isArray(value.assets) ? value.assets as OutputAssetDTO[] : [],
    receipts: Array.isArray(value.receipts) ? value.receipts as OutputReceiptDTO[] : [],
    links: Array.isArray(value.links) ? value.links as OutputLinkDTO[] : [],
  }
}

export function useOutputs(workspaceId: string | null | undefined): UseOutputsResult {
  const workspaceKey = getWorkspaceKey(workspaceId)
  const [state, setState] = useAtom(outputsStateAtomFamily(workspaceKey))
  const electronAPI = window.electronAPI as OutputsElectronAPI
  const available = typeof electronAPI.listOutputs === 'function'
    || window.electronAPI.isChannelAvailable(OUTPUT_RPC_CHANNELS.LIST)

  const refresh = useCallback(async () => {
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing

    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        if (!workspaceId || typeof electronAPI.listOutputs !== 'function') {
          setState({
            outputs: [],
            loading: false,
            error: workspaceId
              ? 'Outputs API is unavailable for this window.'
              : null,
          })
          loadedWorkspaceKeys.add(workspaceKey)
          return
        }
        const raw = await electronAPI.listOutputs(workspaceId)
        const outputs = raw.map(coerceSummary).filter((entry): entry is OutputSummaryDTO => !!entry)
        setState({ outputs: sortOutputs(outputs), loading: false, error: null })
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
  }, [electronAPI, setState, workspaceId, workspaceKey])

  useEffect(() => {
    setStateByWorkspaceKey.set(workspaceKey, setState)
    refreshersByWorkspaceKey.set(workspaceKey, refresh)
    return () => {
      if (setStateByWorkspaceKey.get(workspaceKey) === setState) {
        setStateByWorkspaceKey.delete(workspaceKey)
      }
      if (refreshersByWorkspaceKey.get(workspaceKey) === refresh) {
        refreshersByWorkspaceKey.delete(workspaceKey)
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
    if (!globalOutputsCleanup && typeof electronAPI.onOutputsUpdated === 'function') {
      globalOutputsCleanup = electronAPI.onOutputsUpdated((changedWorkspaceId) => {
        const changedKey = getWorkspaceKey(changedWorkspaceId)
        refreshersByWorkspaceKey.get(changedKey)?.()
      })
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) mountedWorkspaceKeys.delete(workspaceKey)
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)

      if (mountedWorkspaceKeys.size === 0 && globalOutputsCleanup) {
        globalOutputsCleanup()
        globalOutputsCleanup = null
      }
    }
  }, [electronAPI, workspaceKey])

  const getOutput = useCallback(async (outputId: string): Promise<OutputManifestDTO | null> => {
    if (!workspaceId || typeof electronAPI.getOutput !== 'function') return null
    return coerceManifest(await electronAPI.getOutput(workspaceId, outputId))
  }, [electronAPI, workspaceId])

  return {
    outputs: state.outputs,
    loading: state.loading,
    error: state.error,
    available,
    refresh,
    getOutput,
  }
}
