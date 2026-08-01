import { access, readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { RpcServer } from '@archstudio/server-core/transport'
import {
  RPC_CHANNELS,
  type ComfyHealth,
  type ComfyJobStatus,
  type ComfyJobStatusRequest,
  type ComfyRunRequest,
  type ComfyRunResult,
  type ComfyWorkflowList,
  type MediaItem,
  type MediaListPage,
  type MediaListRequest,
} from '@archstudio/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import { ComfyClientError, ComfyUIClient } from '../../integrations/comfyui/client'
import {
  applyMissingNodeDefaults,
  applyWorkflowParameters,
  discoverComfyWorkflows,
  namespaceWorkflowOutputs,
  parseComfyWorkflow,
} from '../../integrations/comfyui/workflow'
import { classifyMedia } from './sessions'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.media.COMFY_HEALTH,
  RPC_CHANNELS.media.COMFY_START,
  RPC_CHANNELS.media.COMFY_WORKFLOWS,
  RPC_CHANNELS.media.COMFY_ARTIFACTS,
  RPC_CHANNELS.media.COMFY_RUN,
  RPC_CHANNELS.media.COMFY_STATUS,
  RPC_CHANNELS.media.COMFY_CANCEL,
] as const

const DEFAULT_COMFY_ROOT = process.platform === 'win32' ? 'D:\\Comfyui' : join(process.env.HOME ?? '', 'ComfyUI')

function configuredRoot(): string {
  return process.env.COMFYUI_ROOT?.trim() || DEFAULT_COMFY_ROOT
}

function configuredWorkflowRoot(): string {
  return process.env.COMFYUI_WORKFLOWS_PATH?.trim() || join(configuredRoot(), 'workflows')
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readHealth(client: ComfyUIClient): Promise<ComfyHealth> {
  try {
    const [stats, queue] = await Promise.all([
      client.getSystemStats(),
      client.getQueue(),
    ])
    const device = stats.devices[0]
    return {
      connected: true,
      baseUrl: client.baseUrl,
      version: typeof stats.system.comfyui_version === 'string' ? stats.system.comfyui_version : undefined,
      device: device?.name,
      vramTotal: device?.vram_total,
      vramFree: device?.vram_free,
      queueRunning: queue.queue_running.length,
      queuePending: queue.queue_pending.length,
    }
  } catch (error) {
    return {
      connected: false,
      baseUrl: client.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function queueContains(entries: unknown[], promptId: string): boolean {
  return entries.some((entry) => Array.isArray(entry) && entry.some((value) => value === promptId))
}

function formatPromptValidationError(error: ComfyClientError): string {
  const detail = error.detail
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return error.message
  const nodeErrors = (detail as Record<string, unknown>).node_errors
  if (!nodeErrors || typeof nodeErrors !== 'object' || Array.isArray(nodeErrors)) return error.message
  const messages: string[] = []
  for (const [nodeId, rawNode] of Object.entries(nodeErrors as Record<string, unknown>)) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) continue
    const classType = (rawNode as Record<string, unknown>).class_type
    const errors = (rawNode as Record<string, unknown>).errors
    if (!Array.isArray(errors)) continue
    for (const raw of errors) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const item = raw as Record<string, unknown>
      const message = typeof item.message === 'string' ? item.message : 'Validation failed'
      const details = typeof item.details === 'string' && item.details ? `: ${item.details}` : ''
      messages.push(`${typeof classType === 'string' ? classType : 'Node'} ${nodeId} — ${message}${details}`)
    }
  }
  return messages.length > 0 ? messages.join('\n') : error.message
}

function historyEntry(history: Record<string, unknown>, promptId: string): Record<string, unknown> | undefined {
  const direct = history[promptId]
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, unknown>
  return undefined
}

export function safeHistoryStatus(entry: Record<string, unknown>, promptId: string): ComfyJobStatus {
  const rawStatus = entry.status
  const status = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)
    ? rawStatus as Record<string, unknown>
    : {}
  const state = status.status_str === 'error'
    ? 'failed'
    : status.status_str === 'success' || entry.outputs && typeof entry.outputs === 'object'
      ? 'completed'
      : 'unknown'
  const result: ComfyJobStatus = {
    promptId,
    state,
    stage: state === 'failed' ? 'failed' : state === 'completed' ? 'completed' : undefined,
  }
  const messages = Array.isArray(status.messages) ? status.messages : []
  for (const rawMessage of messages) {
    if (!Array.isArray(rawMessage) || typeof rawMessage[0] !== 'string') continue
    const payload = rawMessage[1]
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    const data = payload as Record<string, unknown>
    const timestamp = typeof data.timestamp === 'number' ? data.timestamp : undefined
    if (rawMessage[0] === 'execution_start' && timestamp) result.startedAt = timestamp
    if (rawMessage[0] === 'execution_success' && timestamp) result.finishedAt = timestamp
    if (rawMessage[0] === 'execution_error') {
      if (timestamp) result.finishedAt = timestamp
      if (typeof data.node_type === 'string') result.currentNode = data.node_type
      if (typeof data.exception_message === 'string') {
        result.error = data.exception_message.trim().slice(0, 1_200)
      }
    }
  }
  return result
}

export function registerComfyUIHandlers(server: RpcServer, deps: HandlerDeps): void {
  const baseUrl = process.env.COMFYUI_BASE_URL?.trim() || 'http://127.0.0.1:8188'
  const client = new ComfyUIClient({ baseUrl })
  const healthClient = new ComfyUIClient({ baseUrl, timeoutMs: 1_500 })

  server.handle(RPC_CHANNELS.media.COMFY_HEALTH, async (): Promise<ComfyHealth> => readHealth(healthClient))

  server.handle(RPC_CHANNELS.media.COMFY_START, async (ctx): Promise<ComfyHealth> => {
    const existing = await readHealth(healthClient)
    if (existing.connected) return existing
    if (process.platform !== 'win32') {
      throw new Error('Starting ComfyUI from Media Lab is currently configured for Windows only')
    }

    const scriptPath = join(configuredRoot(), 'start_comfyui_hidden.vbs')
    await access(scriptPath)
    const child = spawn('wscript.exe', [scriptPath], {
      cwd: configuredRoot(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    deps.platform.logger.info('Started local ComfyUI process', { scriptPath })

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      if (ctx.signal.aborted) throw new Error('ComfyUI startup was cancelled')
      await wait(1_000)
      const health = await readHealth(healthClient)
      if (health.connected) return health
    }
    throw new Error('ComfyUI did not become ready within 60 seconds')
  })

  server.handle(RPC_CHANNELS.media.COMFY_ARTIFACTS, async (ctx, request: MediaListRequest = {}): Promise<MediaListPage> => {
    const outputRoot = join(configuredRoot(), 'output', 'ARCHstudio')
    const artifacts: MediaItem[] = []
    try {
      await access(outputRoot)
    } catch {
      return { items: [], hasMore: false, nextCursor: null }
    }

    async function walk(directory: string): Promise<void> {
      if (ctx.signal.aborted) throw new Error('ComfyUI output scan was cancelled')
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          await walk(path)
          continue
        }
        if (!entry.isFile()) continue
        const kind = classifyMedia(entry.name)
        if (!kind || kind === 'doc' || request.kind && request.kind !== kind) continue
        const info = await stat(path)
        const relativeFolder = path.slice(outputRoot.length).replace(/^[\\/]+/, '').split(/[\\/]/).slice(0, -1).join('/')
        artifacts.push({
          kind,
          name: entry.name,
          path,
          size: info.size,
          mtime: info.mtimeMs,
          sessionId: `comfyui:${relativeFolder || 'output'}`,
          sessionTitle: relativeFolder ? `ComfyUI · ${relativeFolder}` : 'ComfyUI output',
          lastMessageAt: info.mtimeMs,
        })
      }
    }

    await walk(outputRoot)
    artifacts.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || a.path.localeCompare(b.path))
    const offset = request.cursor ? Math.max(0, Number.parseInt(request.cursor, 10) || 0) : 0
    const limit = Math.min(500, Math.max(1, Math.floor(request.limit ?? 200)))
    const items = artifacts.slice(offset, offset + limit)
    const nextOffset = offset + items.length
    return {
      items,
      hasMore: nextOffset < artifacts.length,
      nextCursor: nextOffset < artifacts.length ? String(nextOffset) : null,
    }
  })

  server.handle(RPC_CHANNELS.media.COMFY_WORKFLOWS, async (): Promise<ComfyWorkflowList> => {
    const [result, objectInfo] = await Promise.all([
      discoverComfyWorkflows(configuredWorkflowRoot()),
      client.getObjectInfo(),
    ])
    return {
      workflows: result.workflows.map((workflow) => {
        const hydrated = parseComfyWorkflow(
          applyMissingNodeDefaults(workflow.workflow, objectInfo),
          { path: workflow.path, id: workflow.id, name: workflow.name },
        )
        return {
          id: hydrated.id,
          name: hydrated.name,
          kind: hydrated.kind,
          nodeClasses: hydrated.nodeClasses,
          parameters: hydrated.parameters.map(({ id, label, kind, value, options }) => ({ id, label, kind, value, options })),
        }
      }),
      rejectedCount: result.rejected.length,
    }
  })

  server.handle(RPC_CHANNELS.media.COMFY_RUN, async (ctx, request: ComfyRunRequest): Promise<ComfyRunResult> => {
    if (!request?.workflowId) throw new Error('workflowId is required')
    const [result, objectInfo] = await Promise.all([
      discoverComfyWorkflows(configuredWorkflowRoot()),
      client.getObjectInfo(ctx.signal),
    ])
    const discovered = result.workflows.find((workflow) => workflow.id === request.workflowId)
    if (!discovered) throw new Error(`Unknown ComfyUI workflow: ${request.workflowId}`)
    const definition = parseComfyWorkflow(
      applyMissingNodeDefaults(discovered.workflow, objectInfo),
      { path: discovered.path, id: discovered.id, name: discovered.name },
    )
    const parameterized = applyWorkflowParameters(definition, request.parameters ?? {})
    const workflow = namespaceWorkflowOutputs(parameterized, definition.kind)
    try {
      const queued = await client.queuePrompt(workflow, `archstudio-${ctx.clientId}`, ctx.signal)
      deps.platform.logger.info('Queued ComfyUI workflow', { workflowId: request.workflowId, promptId: queued.prompt_id })
      return { promptId: queued.prompt_id, queueNumber: queued.number }
    } catch (error) {
      if (error instanceof ComfyClientError) throw new Error(formatPromptValidationError(error))
      throw error
    }
  })

  server.handle(RPC_CHANNELS.media.COMFY_STATUS, async (ctx, request: ComfyJobStatusRequest): Promise<ComfyJobStatus> => {
    if (!request?.promptId) throw new Error('promptId is required')
    const [history, queue] = await Promise.all([
      client.getHistory(request.promptId, ctx.signal),
      client.getQueue(ctx.signal),
    ])
    const entry = historyEntry(history, request.promptId)
    if (entry) {
      // Never return raw history: ComfyUI stores the submitted workflow in it,
      // and custom nodes may persist credentials among their inputs.
      return safeHistoryStatus(entry, request.promptId)
    }
    if (queueContains(queue.queue_running, request.promptId)) {
      return { promptId: request.promptId, state: 'running', stage: 'executing' }
    }
    if (queueContains(queue.queue_pending, request.promptId)) {
      return { promptId: request.promptId, state: 'queued', stage: 'queued' }
    }
    return { promptId: request.promptId, state: 'unknown' }
  })

  server.handle(RPC_CHANNELS.media.COMFY_CANCEL, async (ctx): Promise<void> => {
    await client.interrupt(ctx.signal)
  })
}
