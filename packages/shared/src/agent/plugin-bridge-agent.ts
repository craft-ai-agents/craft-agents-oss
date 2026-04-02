import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentEvent } from '@craft-agent/core/types'
import { BaseAgent } from './base-agent.ts'
import { EventQueue } from './backend/event-queue.ts'
import {
  AbortReason,
  type BackendConfig,
  type ChatOptions,
} from './backend/types.ts'
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts'
import type { FileAttachment } from '../utils/files.ts'

interface PluginBridgeRuntimeConfig {
  pluginId: string
  backendId: string
  helperPath: string
  helperRuntimePath?: string
}

type HelperMessage
  = { type: 'ready' }
    | { type: 'event'; event: AgentEvent }
    | { type: 'session_id'; sessionId: string }
    | { type: 'request_complete'; requestId: string }
    | { type: 'mini_completion_result'; requestId: string; text: string | null }
    | { type: 'error'; requestId?: string; message: string }

export class BridgePluginAgent extends BaseAgent {
  protected backendName = 'Plugin Bridge Backend'

  private subprocess: ChildProcess | null = null
  private readline: ReadlineInterface | null = null
  private subprocessReady: Promise<void> | null = null
  private subprocessReadyResolve: (() => void) | null = null
  private subprocessReadyReject: ((error: Error) => void) | null = null
  private eventQueue = new EventQueue()
  private pendingMiniCompletions = new Map<string, {
    resolve: (value: string | null) => void
    reject: (error: Error) => void
  }>()
  private activeChatRequestId: string | null = null
  private _isProcessing = false
  private lastStderr = ''
  private abortReason?: AbortReason
  private readonly pluginRuntime: PluginBridgeRuntimeConfig

  constructor(config: BackendConfig) {
    super(config, config.model || 'gpt-5.4')
    this._supportsBranching = false

    const runtime = config.runtime?.pluginBridge as PluginBridgeRuntimeConfig | undefined
    if (!runtime?.helperPath) {
      throw new Error('pluginBridge helperPath missing from backend runtime')
    }

    this.pluginRuntime = runtime
  }

  protected async *chatImpl(
    message: string,
    attachments?: FileAttachment[],
    _options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    if (attachments?.length) {
      yield {
        type: 'error',
        message: `${this.pluginRuntime.pluginId} does not support attachments yet.`,
      }
      yield { type: 'complete' }
      return
    }

    this.abortReason = undefined
    this.eventQueue.reset()
    await this.ensureSubprocess()

    const requestId = randomUUID()
    this.activeChatRequestId = requestId
    this._isProcessing = true

    this.send({
      type: 'chat',
      requestId,
      prompt: message,
      cwd: this.resolvedCwd(),
      model: this.getModel(),
      sessionId: this.getSessionId(),
      permissionMode: this.getPermissionMode(),
    })

    yield* this.eventQueue.drain()
  }

  async abort(_reason?: string): Promise<void> {
    if (!this.subprocess) return

    const requestId = randomUUID()
    this.send({ type: 'abort', requestId })
    this._isProcessing = false
    this.activeChatRequestId = null
  }

  forceAbort(reason: AbortReason): void {
    this.abortReason = reason
    void this.abort(reason)
  }

  isProcessing(): boolean {
    return this._isProcessing
  }

  respondToPermission(_requestId: string, _allowed: boolean, _alwaysAllow?: boolean): void {
    // Helper-backed plugins own their own non-interactive execution contract for now.
  }

  async runMiniCompletion(prompt: string): Promise<string | null> {
    await this.ensureSubprocess()

    return new Promise<string | null>((resolve, reject) => {
      const requestId = randomUUID()
      this.pendingMiniCompletions.set(requestId, { resolve, reject })
      this.send({
        type: 'mini_completion',
        requestId,
        prompt,
        cwd: this.resolvedCwd(),
        model: this.getModel(),
      })
    })
  }

  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    const text = await this.runMiniCompletion(request.prompt)
    return {
      text: text ?? '',
      model: request.model || this.getModel(),
    }
  }

  override destroy(): void {
    if (this.readline) {
      this.readline.close()
      this.readline = null
    }

    if (this.subprocess && !this.subprocess.killed) {
      this.subprocess.kill()
    }
    this.subprocess = null
    this.subprocessReady = null
    this.subprocessReadyResolve = null
    this.subprocessReadyReject = null
    this.activeChatRequestId = null
    this._isProcessing = false

    for (const pending of this.pendingMiniCompletions.values()) {
      pending.reject(new Error('Plugin bridge agent destroyed'))
    }
    this.pendingMiniCompletions.clear()

    super.destroy()
  }

  private async ensureSubprocess(): Promise<void> {
    if (this.subprocess && this.subprocessReady) {
      await this.subprocessReady
      return
    }

    const runtimePath = this.pluginRuntime.helperRuntimePath || process.execPath
    this.lastStderr = ''

    this.subprocessReady = new Promise<void>((resolve, reject) => {
      this.subprocessReadyResolve = resolve
      this.subprocessReadyReject = reject
    })

    const child = this.spawnHelperProcess(runtimePath)

    this.subprocess = child
    this.readline = createInterface({
      input: child.stdout!,
      crlfDelay: Infinity,
    })

    this.readline.on('line', (line) => this.handleLine(line))
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.lastStderr += text
      this.debug(`[plugin stderr] ${text.trim()}`)
    })
    child.on('exit', (code, signal) => {
      const errorText = this.lastStderr.trim()
      const error = new Error(
        errorText || `Plugin bridge helper exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      )

      if (this.subprocessReadyReject) {
        this.subprocessReadyReject(error)
      } else if (this._isProcessing) {
        this.eventQueue.enqueue({ type: 'error', message: error.message })
        this.eventQueue.complete()
      }

      this.subprocessReadyReject = null
      this.subprocessReadyResolve = null
      this.subprocessReady = null
      this.subprocess = null
      this._isProcessing = false
      this.activeChatRequestId = null
    })
    child.on('error', (error) => {
      const wrapped = error instanceof Error ? error : new Error(String(error))
      if (this.subprocessReadyReject) {
        this.subprocessReadyReject(wrapped)
      } else if (this._isProcessing) {
        this.eventQueue.enqueue({ type: 'error', message: wrapped.message })
        this.eventQueue.complete()
      }
    })

    await this.subprocessReady
  }

  private handleLine(line: string): void {
    if (!line.trim()) return

    let message: HelperMessage
    try {
      message = JSON.parse(line) as HelperMessage
    } catch {
      this.debug(`Invalid helper JSON: ${line.slice(0, 200)}`)
      return
    }

    switch (message.type) {
      case 'ready':
        this.subprocessReadyResolve?.()
        this.subprocessReadyResolve = null
        this.subprocessReadyReject = null
        break

      case 'session_id':
        this.setSessionId(message.sessionId)
        this.config.onSdkSessionIdUpdate?.(message.sessionId)
        break

      case 'event':
        this.eventQueue.enqueue(message.event)
        break

      case 'request_complete':
        if (message.requestId === this.activeChatRequestId) {
          this._isProcessing = false
          this.activeChatRequestId = null
          this.eventQueue.complete()
        }
        break

      case 'mini_completion_result': {
        const pending = this.pendingMiniCompletions.get(message.requestId)
        if (!pending) return
        this.pendingMiniCompletions.delete(message.requestId)
        pending.resolve(message.text)
        break
      }

      case 'error': {
        const err = new Error(message.message)
        if (message.requestId) {
          const pendingMini = this.pendingMiniCompletions.get(message.requestId)
          if (pendingMini) {
            this.pendingMiniCompletions.delete(message.requestId)
            pendingMini.reject(err)
            return
          }
        }

        if (message.requestId && message.requestId === this.activeChatRequestId) {
          this._isProcessing = false
          this.activeChatRequestId = null
          this.eventQueue.enqueue({ type: 'error', message: err.message })
          this.eventQueue.complete()
          return
        }

        this.eventQueue.enqueue({ type: 'error', message: err.message })
        break
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.subprocess?.stdin?.writable) {
      throw new Error(`Plugin helper stdin is not writable for ${this.pluginRuntime.pluginId}`)
    }

    this.subprocess.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private resolvedCwd(): string {
    const wd = this.workingDirectory
    if (wd.startsWith('~/')) return join(homedir(), wd.slice(2))
    if (wd === '~') return homedir()
    return wd
  }

  private resolvedProcessCwd(): string {
    const requestedCwd = this.resolvedCwd()
    return existsSync(requestedCwd) ? requestedCwd : process.cwd()
  }

  private spawnHelperProcess(runtimePath: string): ChildProcess {
    const options: SpawnOptions = {
      cwd: this.resolvedProcessCwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.config.envOverrides,
      },
    }

    if (runtimePath && existsSync(runtimePath) && basename(runtimePath) !== 'node') {
      return spawn(runtimePath, [this.pluginRuntime.helperPath], options)
    }

    return spawn('node', [this.pluginRuntime.helperPath], options)
  }
}
