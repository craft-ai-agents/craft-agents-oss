export interface ComfySystemStats {
  system: {
    os?: string
    comfyui_version?: string
    python_version?: string
    pytorch_version?: string
    [key: string]: unknown
  }
  devices: Array<{
    name?: string
    type?: string
    index?: number
    vram_total?: number
    vram_free?: number
    [key: string]: unknown
  }>
}

export interface ComfyQueueSnapshot {
  queue_running: unknown[]
  queue_pending: unknown[]
}

export interface ComfyPromptResponse {
  prompt_id: string
  number?: number
  node_errors?: Record<string, unknown>
}

export interface ComfyUploadResult {
  name: string
  subfolder?: string
  type?: string
}

export interface ComfyViewRequest {
  filename: string
  subfolder?: string
  type?: 'input' | 'output' | 'temp'
}

export interface ComfyUploadOptions {
  filename: string
  data: Blob
  subfolder?: string
  type?: 'input' | 'output' | 'temp'
  overwrite?: boolean
}

export type ComfyFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ComfyClientOptions {
  baseUrl?: string
  timeoutMs?: number
  fetch?: ComfyFetch
}

export class ComfyClientError extends Error {
  readonly status?: number
  readonly detail?: unknown

  constructor(message: string, options: { status?: number; detail?: unknown; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ComfyClientError'
    this.status = options.status
    this.detail = options.detail
  }
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188'
const DEFAULT_TIMEOUT_MS = 15_000

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function joinSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`ComfyUI request timed out after ${timeoutMs}ms`)), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

export class ComfyUIClient {
  readonly baseUrl: string
  readonly timeoutMs: number
  private readonly fetchImpl: ComfyFetch

  constructor(options: ComfyClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (!this.fetchImpl) throw new ComfyClientError('Fetch is unavailable in this runtime')
  }

  getSystemStats(signal?: AbortSignal): Promise<ComfySystemStats> {
    return this.request('/system_stats', { signal })
  }

  getObjectInfo(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request('/object_info', { signal })
  }

  getQueue(signal?: AbortSignal): Promise<ComfyQueueSnapshot> {
    return this.request('/queue', { signal })
  }

  getHistory(promptId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request(`/history/${encodeURIComponent(promptId)}`, { signal })
  }

  queuePrompt(workflow: Record<string, unknown>, clientId?: string, signal?: AbortSignal): Promise<ComfyPromptResponse> {
    return this.request('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, ...(clientId ? { client_id: clientId } : {}) }),
      signal,
    })
  }

  async interrupt(signal?: AbortSignal): Promise<void> {
    await this.request('/interrupt', { method: 'POST', signal }, false)
  }

  uploadImage(options: ComfyUploadOptions, signal?: AbortSignal): Promise<ComfyUploadResult> {
    const body = new FormData()
    body.append('image', options.data, options.filename)
    if (options.subfolder) body.append('subfolder', options.subfolder)
    if (options.type) body.append('type', options.type)
    if (options.overwrite !== undefined) body.append('overwrite', String(options.overwrite))
    return this.request('/upload/image', { method: 'POST', body, signal })
  }

  getViewUrl(request: ComfyViewRequest): string {
    const query = new URLSearchParams({ filename: request.filename })
    if (request.subfolder) query.set('subfolder', request.subfolder)
    if (request.type) query.set('type', request.type)
    return `${this.baseUrl}/view?${query.toString()}`
  }

  private async request<T>(path: string, init: RequestInit = {}, expectJson = true): Promise<T> {
    const joined = joinSignal(init.signal ?? undefined, this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: joined.signal })
      if (!response.ok) {
        const detail = await this.readErrorDetail(response)
        throw new ComfyClientError(`ComfyUI request failed (${response.status} ${response.statusText})`, {
          status: response.status,
          detail,
        })
      }
      if (!expectJson || response.status === 204) return undefined as T
      return await response.json() as T
    } catch (error) {
      if (error instanceof ComfyClientError) throw error
      const reason = joined.signal.reason
      if (joined.signal.aborted) {
        throw new ComfyClientError(
          reason instanceof Error ? reason.message : 'ComfyUI request was cancelled',
          { cause: error },
        )
      }
      throw new ComfyClientError(
        `Unable to reach ComfyUI at ${this.baseUrl}`,
        { cause: error },
      )
    } finally {
      joined.cleanup()
    }
  }

  private async readErrorDetail(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? ''
    try {
      return contentType.includes('application/json') ? await response.json() : await response.text()
    } catch {
      return undefined
    }
  }
}
