import { access } from 'node:fs/promises'
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
} from '@archstudio/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import { ComfyUIClient } from '../../integrations/comfyui/client'
import { applyWorkflowParameters, discoverComfyWorkflows } from '../../integrations/comfyui/workflow'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.media.COMFY_HEALTH,
  RPC_CHANNELS.media.COMFY_START,
  RPC_CHANNELS.media.COMFY_WORKFLOWS,
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
    const stats = await client.getSystemStats()
    const device = stats.devices[0]
    return {
      connected: true,
      baseUrl: client.baseUrl,
      version: typeof stats.system.comfyui_version === 'string' ? stats.system.comfyui_version : undefined,
      device: device?.name,
      vramTotal: device?.vram_total,
      vramFree: device?.vram_free,
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

function historyEntry(history: Record<string, unknown>, promptId: string): Record<string, unknown> | undefined {
  const direct = history[promptId]
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, unknown>
  return undefined
}

function summarizeHistoryState(entry: Record<string, unknown>): ComfyJobStatus['state'] {
  const status = entry.status
  if (status && typeof status === 'object' && !Array.isArray(status)) {
    const value = (status as Record<string, unknown>).status_str
    if (value === 'error') return 'failed'
    if (value === 'success') return 'completed'
  }
  if (entry.outputs && typeof entry.outputs === 'object') return 'completed'
  return 'unknown'
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

  server.handle(RPC_CHANNELS.media.COMFY_WORKFLOWS, async (): Promise<ComfyWorkflowList> => {
    const result = await discoverComfyWorkflows(configuredWorkflowRoot())
    return {
      workflows: result.workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        kind: workflow.kind,
        nodeClasses: workflow.nodeClasses,
        parameters: workflow.parameters.map(({ id, label, kind, value, options }) => ({ id, label, kind, value, options })),
      })),
      rejectedCount: result.rejected.length,
    }
  })

  server.handle(RPC_CHANNELS.media.COMFY_RUN, async (ctx, request: ComfyRunRequest): Promise<ComfyRunResult> => {
    if (!request?.workflowId) throw new Error('workflowId is required')
    const result = await discoverComfyWorkflows(configuredWorkflowRoot())
    const definition = result.workflows.find((workflow) => workflow.id === request.workflowId)
    if (!definition) throw new Error(`Unknown ComfyUI workflow: ${request.workflowId}`)
    const workflow = applyWorkflowParameters(definition, request.parameters ?? {})
    const queued = await client.queuePrompt(workflow, `archstudio-${ctx.clientId}`, ctx.signal)
    deps.platform.logger.info('Queued ComfyUI workflow', { workflowId: request.workflowId, promptId: queued.prompt_id })
    return { promptId: queued.prompt_id, queueNumber: queued.number }
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
      return { promptId: request.promptId, state: summarizeHistoryState(entry) }
    }
    if (queueContains(queue.queue_running, request.promptId)) return { promptId: request.promptId, state: 'running' }
    if (queueContains(queue.queue_pending, request.promptId)) return { promptId: request.promptId, state: 'queued' }
    return { promptId: request.promptId, state: 'unknown' }
  })

  server.handle(RPC_CHANNELS.media.COMFY_CANCEL, async (ctx): Promise<void> => {
    await client.interrupt(ctx.signal)
  })
}
