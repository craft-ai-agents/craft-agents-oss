/**
 * Craft Extension Host manager (S-05 §3.5).
 *
 * Spawns a single Electron utilityProcess worker for craft-sandbox extensions.
 * - No SiYuan plugin execution (executesSiyuanPlugins always false)
 * - No raw secrets in worker env
 * - Capability broker: mints scoped tokens; redeems secrets only in main
 * - Crash → degraded; restart recovers
 * - start/stop/restart single-flight (mutex + generation token)
 * - Injectable forkFn / workerPath for tests (never requires real Electron)
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

import type { ExtensionHostStatus } from '@craft-agent/shared/extensions'
import { CONFIG_DIR } from '@craft-agent/shared/config'
import {
  getCredentialManager,
  type CredentialId,
} from '@craft-agent/shared/credentials'

import {
  assertPathAllowlisted,
  resolveSandboxRoots,
} from './extension-host/path-allowlist'
import {
  CapabilityBroker,
  getCapabilityBroker,
  type GetCredentialFn,
} from './extension-host/capability-broker'
import { getUrlAllowlist } from './extension-host/extension-url-allowlist'
import {
  buildScrubbedWorkerEnv,
  type BrokerRequestMessage,
  type MainToWorkerMessage,
  type WorkerToMainMessage,
} from './extension-host/protocol'

export type ExtensionHostLifecycle = 'stopped' | 'starting' | 'running' | 'degraded'

const DEFAULT_MESSAGE_TIMEOUT_MS = 5_000

/** Minimal child surface used by the manager (utilityProcess or test fake). */
export interface ExtensionHostChild extends EventEmitter {
  pid?: number
  postMessage(message: unknown): void
  kill(): void
  stdout?: NodeJS.ReadableStream | null
  stderr?: NodeJS.ReadableStream | null
}

export type ExtensionHostForkFn = (
  modulePath: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio?: string
    serviceName?: string
  },
) => ExtensionHostChild

export interface ExtensionHostManagerOptions {
  /** Injectable fork (tests). Defaults to electron.utilityProcess.fork. */
  forkFn?: ExtensionHostForkFn
  /** Path to built worker bundle (extension-host-worker.cjs). */
  workerPath?: string
  /** Config dir for sandbox allowlist root. */
  configDir?: string
  /** Override CRAFT_EXTENSION_SANDBOX_ROOT. */
  sandboxRootEnv?: string
  /** RPC / ping timeout. Defaults to CRAFT_EXTENSION_HOST_TIMEOUT_MS then 5_000. */
  messageTimeoutMs?: number
  /** Crash-to-restart minimum backoff. */
  crashBackoffMs?: number
  /** Skip waiting for worker `ready` (tests that drive messages manually). */
  skipReadyWait?: boolean
  /** Injectable capability broker (tests). Defaults to singleton. */
  broker?: CapabilityBroker
  /** Injectable credential resolver (tests). Defaults to CredentialManager.get. */
  getCredential?: GetCredentialFn
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function defaultWorkerPath(): string {
  // Packaged / built main lives next to extension-host-worker.cjs in dist/.
  try {
    const here =
      typeof __dirname !== 'undefined'
        ? __dirname
        : dirname(fileURLToPath(import.meta.url))
    const candidate = join(here, 'extension-host-worker.cjs')
    if (existsSync(candidate)) return candidate
    // Dev: apps/electron/src/main → apps/electron/dist
    const distCandidate = join(here, '..', '..', 'dist', 'extension-host-worker.cjs')
    if (existsSync(distCandidate)) return distCandidate
    return candidate
  } catch {
    return join(process.cwd(), 'apps/electron/dist/extension-host-worker.cjs')
  }
}

function tryLoadUtilityProcessFork(): ExtensionHostForkFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      utilityProcess?: {
        fork: ExtensionHostForkFn
      }
      app?: { isReady: () => boolean }
    }
    if (electron?.utilityProcess?.fork) {
      return (modulePath, args, options) => {
        // Production should only fork after app ready; tests inject forkFn.
        if (electron.app && typeof electron.app.isReady === 'function' && !electron.app.isReady()) {
          throw new Error('Extension Host: app not ready')
        }
        return electron.utilityProcess!.fork(modulePath, args, {
          ...options,
          stdio: 'pipe',
        } as Parameters<ExtensionHostForkFn>[2])
      }
    }
  } catch {
    // Unit tests without electron binary.
  }
  return null
}

let idSeq = 0
function nextId(): string {
  idSeq = (idSeq + 1) % 1_000_000
  return `eh-${Date.now().toString(36)}-${idSeq}`
}

export class ExtensionHostManager {
  private lifecycle: ExtensionHostLifecycle = 'stopped'
  private message?: string
  private child: ExtensionHostChild | null = null
  private pid: number | undefined
  private readonly pending = new Map<string, PendingRequest>()
  private readonly loadedExtensions = new Set<string>()
  /** grantedPermissions per extensionId (defaults for broker mint). */
  private readonly grantedByExtension = new Map<string, readonly string[]>()
  private readonly forkFn: ExtensionHostForkFn | null
  private readonly workerPath: string
  private readonly configDir: string
  private readonly sandboxRootEnv?: string
  private readonly messageTimeoutMs: number
  private readonly crashBackoffMs: number
  private readonly skipReadyWait: boolean
  private readonly broker: CapabilityBroker
  private readonly getCredential: GetCredentialFn
  private onChildMessage: ((msg: unknown) => void) | null = null
  private onChildExit: ((code: number | null) => void) | null = null
  private onChildError: (() => void) | null = null

  /**
   * Generation token: stop()/restart() bump this so in-flight start cannot
   * promote to running and stale child exits cannot force degraded.
   */
  private generation = 0
  /** Generation that owns the current child binding (for exit filtering). */
  private childGeneration = 0
  /** True while an intentional stop/restart teardown is in progress or pending. */
  private intentionalStop = false
  /** Serialize start/stop/restart bodies. */
  private opChain: Promise<unknown> = Promise.resolve()
  /** Join concurrent start() callers onto one in-flight attempt. */
  private startShared: Promise<ExtensionHostStatus> | null = null

  constructor(options: ExtensionHostManagerOptions = {}) {
    this.forkFn = options.forkFn ?? tryLoadUtilityProcessFork()
    this.workerPath = options.workerPath ?? defaultWorkerPath()
    this.configDir = options.configDir ?? CONFIG_DIR
    this.sandboxRootEnv = options.sandboxRootEnv
    this.messageTimeoutMs =
      options.messageTimeoutMs ??
      (Number(process.env.CRAFT_EXTENSION_HOST_TIMEOUT_MS) || DEFAULT_MESSAGE_TIMEOUT_MS)
    this.skipReadyWait = options.skipReadyWait ?? false
    this.crashBackoffMs =
      options.crashBackoffMs ??
      (Number(process.env.CRAFT_EXTENSION_HOST_CRASH_BACKOFF_MS) || 0)
    this.broker = options.broker ?? getCapabilityBroker()
    this.getCredential =
      options.getCredential ??
      ((id: CredentialId) => getCredentialManager().get(id))
  }

  getStatus(): ExtensionHostStatus {
    return {
      status: this.lifecycle,
      pid: this.lifecycle === 'running' ? this.pid : undefined,
      executesSiyuanPlugins: false,
      message:
        this.message ??
        'Extension Host stopped — does not execute SiYuan plugins',
      loadedExtensions:
        this.loadedExtensions.size > 0
          ? [...this.loadedExtensions]
          : undefined,
    }
  }

  async start(): Promise<ExtensionHostStatus> {
    if (this.startShared) {
      return this.startShared
    }
    if (this.lifecycle === 'running' && this.child && !this.intentionalStop) {
      return this.getStatus()
    }

    // Capture generation before enqueue so a later stop() invalidates us.
    const startGen = this.generation
    const run = this.enqueue(() => this.startExclusive(startGen))
    this.startShared = run
    void run.finally(() => {
      if (this.startShared === run) this.startShared = null
    })
    return run
  }

  async stop(): Promise<ExtensionHostStatus> {
    // Invalidate any in-flight start immediately (before we reach the queue).
    this.generation += 1
    this.intentionalStop = true
    // Unblock waitForReady / RPCs so the start queue slot can finish and
    // stopExclusive can run (otherwise stop waits behind ready timeout).
    this.rejectAllPending(new Error('Extension Host stopped'))
    // Best-effort kill of the current child without waiting on the queue —
    // stopExclusive will clean state; this prevents orphan forks.
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // ignore
      }
    }
    return this.enqueue(() => this.stopExclusive())
  }

  async restart(): Promise<ExtensionHostStatus> {
    this.generation += 1
    this.intentionalStop = true
    this.rejectAllPending(new Error('Extension Host restarted'))
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // ignore
      }
    }
    // Single queue slot: stop then start without nested enqueue deadlock.
    return this.enqueue(async () => {
      await this.stopExclusive()
      return this.startExclusive(this.generation)
    })
  }

  /**
   * Load a craft-sandbox extension module into the worker.
   * entryPath must pass the sandbox allowlist (checked in main AND worker).
   * grantedPermissions are stored as the sole authority for broker mint.
   */
  async loadExtension(
    extensionId: string,
    entryPath: string,
    grantedPermissions?: readonly string[],
  ): Promise<void> {
    if (!extensionId) throw new Error('extensionId is required')
    const roots = resolveSandboxRoots({
      configDir: this.configDir,
      sandboxRootEnv: this.sandboxRootEnv,
    })
    const resolved = assertPathAllowlisted(entryPath, roots)

    await this.ensureRunning()
    await this.request({
      id: nextId(),
      type: 'load',
      extensionId,
      entryPath: resolved,
    })
    this.loadedExtensions.add(extensionId)
    if (grantedPermissions) {
      this.grantedByExtension.set(extensionId, [...grantedPermissions])
    } else if (!this.grantedByExtension.has(extensionId)) {
      this.grantedByExtension.set(extensionId, [])
    }
  }

  async unloadExtension(extensionId: string): Promise<void> {
    this.broker.revokeExtension(extensionId)
    this.grantedByExtension.delete(extensionId)
    if (this.lifecycle !== 'running' || !this.child) {
      this.loadedExtensions.delete(extensionId)
      return
    }
    await this.request({
      id: nextId(),
      type: 'unload',
      extensionId,
    })
    this.loadedExtensions.delete(extensionId)
  }

  /**
   * Describe commands exported by a loaded extension module (`module.commands`).
   * Returns [] for extensions without a commands export; throws when unloaded.
   */
  async listExtensionCommands(extensionId: string): Promise<Array<{
    id: string
    title: string
    when?: string
    defaultHotkey?: string
    keywords?: string[]
  }>> {
    if (!extensionId) throw new Error('extensionId is required')
    if (!this.loadedExtensions.has(extensionId)) {
      throw new Error(`Extension not loaded: ${extensionId}`)
    }
    await this.ensureRunning()
    const result = await this.request({
      id: nextId(),
      type: 'list-commands',
      extensionId,
    })
    if (
      result &&
      typeof result === 'object' &&
      'commands' in result &&
      Array.isArray((result as { commands: unknown }).commands)
    ) {
      return (result as { commands: Array<{
        id: string
        title: string
        when?: string
        defaultHotkey?: string
        keywords?: string[]
      }> }).commands
    }
    return []
  }

  /**
   * Call a method on a loaded extension module inside the worker.
   * Basic permission gate: rejects empty permissions arrays when provided.
   */
  async callExtension(
    extensionId: string,
    method: string,
    args?: unknown[],
    permissions?: string[],
  ): Promise<unknown> {
    if (!extensionId) throw new Error('extensionId is required')
    if (!method) throw new Error('method is required')
    if (Array.isArray(permissions) && permissions.length === 0) {
      throw new Error('Permission check failed: empty permissions')
    }

    await this.ensureRunning()
    return this.request({
      id: nextId(),
      type: 'call',
      extensionId,
      method,
      args,
      permissions,
    })
  }

  /**
   * Mint a scoped capability token for an extension (main-side RPC).
   * Returns { token, expiresAt, permission } — never the secret.
   *
   * Authority: only grants stored at loadExtension time. Callers cannot
   * self-supply grantedPermissions (renderer input is ignored).
   */
  mintCapability(input: {
    extensionId: string
    permission: string
    ttlMs?: number
    singleUse?: boolean
  }): { token: string; expiresAt: number; permission: string } {
    const granted = this.requireStoredGrants(input.extensionId)
    const cap = this.broker.mint({
      extensionId: input.extensionId,
      permission: input.permission,
      grantedPermissions: granted,
      ttlMs: input.ttlMs,
      singleUse: input.singleUse,
    })
    return {
      token: cap.token,
      expiresAt: cap.expiresAt,
      permission: cap.permission,
    }
  }

  revokeCapability(token: string): void {
    this.broker.revoke(token)
  }

  revokeExtensionCapabilities(extensionId: string): void {
    this.broker.revokeExtension(extensionId)
  }

  /**
   * Resolve effective URL allowlist for proxyFetch.
   * Non-empty durable store is authoritative — caller/renderer prefixes must not widen it.
   * Empty durable → caller prefixes only; empty caller too → undefined (broker allow-all / dev default).
   */
  private mergeUrlAllowlist(
    token: string,
    callerPrefixes?: string[],
  ): string[] | undefined {
    const cap = this.broker.peek(token)
    const durable = cap ? getUrlAllowlist(cap.extensionId, this.configDir) : []
    const effective =
      durable.length > 0 ? durable : (callerPrefixes ?? [])
    return effective.length > 0 ? effective : undefined
  }

  /** Main-side authenticated fetch via capability token (no worker hop). */
  async proxyFetch(input: {
    token: string
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    allowedUrlPrefixes?: string[]
    fetchImpl?: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>
  }): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    const allowedUrlPrefixes = this.mergeUrlAllowlist(
      input.token,
      input.allowedUrlPrefixes,
    )
    return this.broker.proxyFetch({
      token: input.token,
      url: input.url,
      method: input.method,
      headers: input.headers,
      body: input.body,
      allowedUrlPrefixes,
      fetchImpl: input.fetchImpl,
      getCredential: this.getCredential,
    })
  }
  getGrantedPermissions(extensionId: string): readonly string[] {
    return this.grantedByExtension.get(extensionId) ?? []
  }

  /** Ping worker (health). */
  async ping(): Promise<void> {
    await this.ensureRunning()
    await this.request({ id: nextId(), type: 'ping' })
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn)
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async startExclusive(startGen: number): Promise<ExtensionHostStatus> {
    if (startGen !== this.generation) {
      // stop()/restart() won before we began — do not fork.
      return this.statusAfterCancelledStart()
    }
    if (this.lifecycle === 'running' && this.child) {
      return this.getStatus()
    }

    this.lifecycle = 'starting'
    this.message = 'Extension Host starting'

    if (!this.forkFn) {
      if (startGen !== this.generation) return this.statusAfterCancelledStart()
      // No electron utilityProcess and no injectable fork — stay degraded-honest.
      this.lifecycle = 'degraded'
      this.message =
        'Extension Host unavailable (no utilityProcess) — does not execute SiYuan plugins'
      this.pid = undefined
      this.child = null
      return this.getStatus()
    }

    let child: ExtensionHostChild | null = null
    try {
      const env = buildScrubbedWorkerEnv(process.env)
      env.CRAFT_CONFIG_DIR = this.configDir
      if (this.sandboxRootEnv) {
        env.CRAFT_EXTENSION_SANDBOX_ROOT = this.sandboxRootEnv
      }

      if (startGen !== this.generation) {
        return this.statusAfterCancelledStart()
      }

      child = this.forkFn(this.workerPath, [], {
        env,
        stdio: 'pipe',
        serviceName: 'craft-extension-host',
      })

      if (startGen !== this.generation) {
        // stop won between fork and bind — kill orphan immediately.
        try {
          child.kill()
        } catch {
          // ignore
        }
        return this.statusAfterCancelledStart()
      }

      this.child = child
      this.pid = typeof child.pid === 'number' ? child.pid : undefined
      this.childGeneration = startGen
      this.bindChild(child, startGen)

      if (!this.skipReadyWait) {
        await this.waitForReady()
      }

      if (startGen !== this.generation) {
        // stop() during start: never promote to running; do not set degraded.
        if (this.child === child) {
          this.teardownChild()
        } else {
          try {
            child.kill()
          } catch {
            // ignore
          }
        }
        return this.statusAfterCancelledStart()
      }

      this.lifecycle = 'running'
      this.message =
        'Extension Host running — craft-sandbox only; SiYuan plugins execute only inside SiYuan'
      return this.getStatus()
    } catch (err) {
      if (startGen !== this.generation) {
        if (child && this.child === child) {
          this.teardownChild()
        } else if (child) {
          try {
            child.kill()
          } catch {
            // ignore
          }
        }
        // stop won — leave lifecycle to stopExclusive (or already stopped).
        return this.statusAfterCancelledStart()
      }
      this.teardownChild()
      this.lifecycle = 'degraded'
      this.message =
        err instanceof Error
          ? `Extension Host failed to start: ${err.message}`
          : 'Extension Host failed to start'
      return this.getStatus()
    }
  }

  /** Status snapshot when stop/restart invalidated an in-flight start. */
  private statusAfterCancelledStart(): ExtensionHostStatus {
    if (this.lifecycle === 'stopped' || this.intentionalStop) {
      return {
        status: 'stopped',
        executesSiyuanPlugins: false,
        message:
          this.lifecycle === 'stopped'
            ? (this.message ?? 'Extension Host stopped')
            : 'Extension Host stopped',
        pid: undefined,
      }
    }
    return this.getStatus()
  }

  private async stopExclusive(): Promise<ExtensionHostStatus> {
    this.rejectAllPending(new Error('Extension Host stopped'))
    this.teardownChild()
    // Kill all live capability tokens — stop must not leave redeemable grants.
    this.broker.clear()
    this.loadedExtensions.clear()
    this.grantedByExtension.clear()
    this.lifecycle = 'stopped'
    this.message = 'Extension Host stopped'
    this.pid = undefined
    this.intentionalStop = false
    return this.getStatus()
  }

  /**
   * Stored load-time grants only. Rejects unknown / unloaded extensions and
   * never accepts caller-supplied grant lists as authority.
   */
  private requireStoredGrants(extensionId: string): readonly string[] {
    const id = typeof extensionId === 'string' ? extensionId.trim() : ''
    if (!id) throw new Error('extensionId is required')
    if (!this.loadedExtensions.has(id)) {
      throw new Error(`Extension not loaded: ${id}`)
    }
    const granted = this.grantedByExtension.get(id)
    if (!granted) {
      throw new Error(`No stored grants for extension: ${id}`)
    }
    return granted
  }

  private async ensureRunning(): Promise<void> {
    if (this.lifecycle === 'running' && this.child) return
    const status = await this.start()
    if (status.status !== 'running' || !this.child) {
      throw new Error(status.message ?? 'Extension Host is not running')
    }
  }

  private bindChild(child: ExtensionHostChild, gen: number): void {
    this.onChildMessage = (raw: unknown) => {
      if (gen !== this.generation) return
      this.handleWorkerMessage(unwrapMessage(raw))
    }
    this.onChildExit = (_code: number | null) => {
      this.handleChildExit(gen)
    }
    this.onChildError = () => {
      this.handleChildExit(gen)
    }

    child.on('message', this.onChildMessage)
    child.on('exit', this.onChildExit)
    child.on('error', this.onChildError)
  }

  private handleWorkerMessage(msg: WorkerToMainMessage | null): void {
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'ready') {
      const ready = this.pending.get('__ready__')
      if (ready) {
        clearTimeout(ready.timer)
        this.pending.delete('__ready__')
        ready.resolve(undefined)
      }
      return
    }

    if (msg.type === 'broker-request') {
      void this.handleBrokerRequest(msg)
      return
    }

    if (!('id' in msg) || !msg.id) return
    const pending = this.pending.get(msg.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(msg.id)

    if (msg.type === 'pong' || msg.type === 'ok') {
      pending.resolve(msg.type === 'ok' ? msg.result : undefined)
      return
    }
    if (msg.type === 'error') {
      pending.reject(new Error(msg.error || 'Extension host error'))
    }
  }

  private async handleBrokerRequest(msg: BrokerRequestMessage): Promise<void> {
    const child = this.child
    if (!child) return

    try {
      if (msg.action === 'mint') {
        // Worker cannot escalate: only main-stored load grants authorize mint.
        const granted = this.requireStoredGrants(msg.extensionId)
        const cap = this.broker.mint({
          extensionId: msg.extensionId,
          permission: msg.permission,
          grantedPermissions: granted,
          ttlMs: msg.ttlMs,
          singleUse: msg.singleUse,
        })
        const response: MainToWorkerMessage = {
          id: msg.id,
          type: 'broker-ok',
          result: {
            token: cap.token,
            expiresAt: cap.expiresAt,
            permission: cap.permission,
          },
        }
        child.postMessage(response)
        return
      }

      if (msg.action === 'fetch') {
        const allowedUrlPrefixes = this.mergeUrlAllowlist(msg.capabilityToken)
        const result = await this.broker.proxyFetch({
          token: msg.capabilityToken,
          url: msg.url,
          method: msg.method,
          headers: msg.headers,
          body: msg.body,
          allowedUrlPrefixes,
          getCredential: this.getCredential,
        })
        const response: MainToWorkerMessage = {
          id: msg.id,
          type: 'broker-ok',
          result,
        }
        child.postMessage(response)
        return
      }

      // Exhaustiveness: BrokerRequestMessage only has mint|fetch today.
      const _exhaustive: never = msg
      child.postMessage({
        id: (_exhaustive as BrokerRequestMessage).id,
        type: 'broker-error',
        error: 'Unknown broker action',
      } satisfies MainToWorkerMessage)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      try {
        child.postMessage({
          id: msg.id,
          type: 'broker-error',
          error,
        } satisfies MainToWorkerMessage)
      } catch {
        // ignore post failure
      }
    }
  }

  private handleChildExit(exitGen: number): void {
    // Intentional stop / superseded generation / already stopped: never
    // clobber stopped → degraded.
    const stale =
      exitGen !== this.generation ||
      exitGen !== this.childGeneration ||
      this.intentionalStop ||
      this.lifecycle === 'stopped'

    this.rejectAllPending(new Error('Extension Host process exited'))
    this.detachChildListeners()
    this.child = null
    this.pid = undefined
    // Crash path: revoke every token so orphaned workers cannot redeem later.
    this.broker.clear()
    this.loadedExtensions.clear()
    this.grantedByExtension.clear()
    if (stale) {
      return
    }

    const wasActive =
      this.lifecycle === 'running' || this.lifecycle === 'starting'
    if (wasActive || this.lifecycle === 'degraded') {
      this.lifecycle = 'degraded'
      this.message =
        'Extension Host crashed — degraded; restart to recover. Does not execute SiYuan plugins'
    }
  }

  private detachChildListeners(): void {
    if (!this.child) return
    if (this.onChildMessage) this.child.off('message', this.onChildMessage)
    if (this.onChildExit) this.child.off('exit', this.onChildExit)
    if (this.onChildError) this.child.off('error', this.onChildError)
    this.onChildMessage = null
    this.onChildExit = null
    this.onChildError = null
  }

  private teardownChild(): void {
    if (!this.child) return
    this.detachChildListeners()
    try {
      this.child.kill()
    } catch {
      // ignore
    }
    this.child = null
    this.pid = undefined
  }

  private waitForReady(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const timer = setTimeout(() => {
      this.pending.delete('__ready__')
      reject(new Error('Extension Host ready timeout'))
    }, this.messageTimeoutMs)
    this.pending.set('__ready__', {
      resolve: () => resolve(),
      reject,
      timer,
    })
    return promise
  }

  private request(message: MainToWorkerMessage): Promise<unknown> {
    const child = this.child
    if (!child) return Promise.reject(new Error('Extension Host has no child'))

    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    const timer = setTimeout(() => {
      this.pending.delete(message.id)
      reject(new Error(`Extension Host timeout waiting for ${message.type}`))
    }, this.messageTimeoutMs)

    this.pending.set(message.id, { resolve, reject, timer })
    try {
      child.postMessage(message)
    } catch (err) {
      clearTimeout(timer)
      this.pending.delete(message.id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    return promise
  }

  private rejectAllPending(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
      this.pending.delete(id)
    }
  }
}

function unwrapMessage(raw: unknown): WorkerToMainMessage | null {
  if (!raw || typeof raw !== 'object') return null
  // Electron may wrap as { data }
  if ('data' in raw && (raw as { data: unknown }).data && typeof (raw as { data: unknown }).data === 'object') {
    const data = (raw as { data: unknown }).data
    if (data && typeof data === 'object' && 'type' in (data as object)) {
      return data as WorkerToMainMessage
    }
  }
  if ('type' in raw) return raw as WorkerToMainMessage
  return null
}

const hosts = new Map<string, ExtensionHostManager>()

/** Registry key used when workspaceId is absent/blank. */
export const DEFAULT_WORKSPACE_KEY = '_default'

function resolveWorkspaceKey(workspaceId?: string | null): string {
  if (typeof workspaceId === 'string' && workspaceId.trim()) return workspaceId.trim()
  return DEFAULT_WORKSPACE_KEY
}

/** Per-workspace Extension Host manager (lazy). */
export function getExtensionHostManager(workspaceId?: string | null): ExtensionHostManager {
  const key = resolveWorkspaceKey(workspaceId)
  let mgr = hosts.get(key)
  if (!mgr) {
    // Isolated broker per workspace so stop/revoke in A cannot clear B's tokens.
    mgr = new ExtensionHostManager({
      broker: new CapabilityBroker(),
    })
    hosts.set(key, mgr)
  }
  return mgr
}

/** Snapshot status of every live workspace host. */
export function listExtensionHostStatuses(): Array<
  { workspaceId: string } & ExtensionHostStatus
> {
  return [...hosts.entries()].map(([workspaceId, mgr]) => ({
    workspaceId,
    ...mgr.getStatus(),
  }))
}

/** Stop every registered host (app quit / tests). */
export async function stopAllExtensionHosts(): Promise<void> {
  await Promise.all([...hosts.values()].map((m) => m.stop()))
}

/** Test helper — stop all and clear registry. */
export function resetExtensionHostManagers(): void {
  for (const m of hosts.values()) void m.stop()
  hosts.clear()
}

/** Backward-compat alias. */
export function resetExtensionHostManager(): void {
  resetExtensionHostManagers()
}

/** Test helper — install a preconfigured manager for a workspace key. */
export function setExtensionHostManagerForTests(
  manager: ExtensionHostManager | null,
  workspaceId?: string | null,
): void {
  const key = resolveWorkspaceKey(workspaceId)
  if (!manager) hosts.delete(key)
  else hosts.set(key, manager)
}
