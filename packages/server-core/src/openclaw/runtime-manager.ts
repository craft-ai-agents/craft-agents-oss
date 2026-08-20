import { spawn as nodeSpawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises'
import { createServer } from 'node:net'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  openClawGatewayCredentialId,
  type CredentialId,
  type StoredCredential,
} from '@craft-agent/shared/credentials'
import type { ManagedOpenClawLauncher } from '@craft-agent/shared/toolchain/types'
import {
  redactSecurityText,
  type OpenClawRuntimeStatus,
  type OpenClawSafeErrorCode,
  type OpenClawRuntimeSafeErrorCode,
  type RuntimeState,
} from '@craft-agent/shared/openclaw'
import {
  buildHardenedOpenClawConfig,
  deriveOpenClawPortBlock,
  deriveOpenClawRuntimeId,
  type OpenClawPortBlock,
  type OpenClawRuntimeLayout,
} from './runtime-config.ts'

const OWNER_DIR_MODE = 0o700
const OWNER_FILE_MODE = 0o600
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 200
const DEFAULT_STOP_TIMEOUT_MS = 5_000
const MAX_RUNTIME_OUTPUT_BYTES = 64 * 1024
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/

export interface OpenClawCredentialStore {
  get(id: CredentialId): Promise<StoredCredential | null>
  set(id: CredentialId, credential: StoredCredential): Promise<void>
  delete(id: CredentialId): Promise<boolean>
}

interface StreamLike {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
}

export interface ManagedChildProcess {
  readonly pid?: number
  readonly stdout?: StreamLike | null
  readonly stderr?: StreamLike | null
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  once(event: 'error', listener: () => void): unknown
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface ManagedSpawnOptions {
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly shell: false
  readonly detached: false
  readonly stdio: readonly ['ignore', 'pipe', 'pipe']
  readonly windowsHide: true
}

export interface OpenClawHealthProbeInput {
  readonly host: '127.0.0.1'
  readonly port: number
  readonly path: '/health'
  readonly timeoutMs: number
}

export interface OpenClawRuntimeLogger {
  info(message: string): void
  warn(message: string): void
}

export interface OpenClawRuntimeManagerDependencies {
  /** Host-owned config root; never received from the renderer or RPC payload. */
  readonly runtimeRoot: string
  readonly credentialStore: OpenClawCredentialStore
  /** Must return a verified managed launcher or null; PATH fallback is forbidden. */
  readonly resolveManagedLauncher: () => Promise<ManagedOpenClawLauncher | null>
  readonly spawn?: (
    executablePath: string,
    args: readonly string[],
    options: ManagedSpawnOptions,
  ) => ManagedChildProcess
  readonly probeHealth?: (input: OpenClawHealthProbeInput) => Promise<boolean>
  readonly isPortAvailable?: (port: number) => Promise<boolean>
  readonly logger?: OpenClawRuntimeLogger
  readonly now?: () => number
  readonly healthTimeoutMs?: number
  readonly healthPollIntervalMs?: number
  readonly stopTimeoutMs?: number
}

/** Typed, controlled error used only inside server-core. Its message is always the safe code. */
export class OpenClawOperationError extends Error {
  readonly code: OpenClawSafeErrorCode
  readonly retryable: boolean

  constructor(code: OpenClawSafeErrorCode, retryable = false) {
    super(code)
    this.name = 'OpenClawOperationError'
    this.code = code
    this.retryable = retryable
  }
}

interface OpenClawRuntimeRecord {
  readonly runtimeId: string
  readonly workspaceId: string
  readonly state: RuntimeState
  readonly portBlock: OpenClawPortBlock
  readonly version?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastHealthAt?: number
  readonly safeError?: OpenClawRuntimeSafeErrorCode
  readonly launchNonce?: string
}

interface OwnedChild {
  readonly nonce: string
  readonly child: ManagedChildProcess
  readonly pid?: number
  readonly exit: Promise<void>
  resolveExit(): void
  expectedStop: boolean
  readonly output: BoundedRedactedOutput
}

/** Internal-only execution context. It must never be placed in an RPC response. */
export interface OpenClawAuditRuntime {
  readonly runtime: OpenClawRuntimeStatus
  readonly cwd: string
  readonly configPath: string
  readonly statePath: string
  readonly auditDirectory?: string
}

export interface OpenClawAuditRuntimeProvider {
  getAuditRuntime(workspaceId: string): Promise<OpenClawAuditRuntime | null>
}

class ImmutableRuntimeRecordStore {
  private readonly records = new Map<string, OpenClawRuntimeRecord>()

  get(runtimeId: string): OpenClawRuntimeRecord | undefined {
    return this.records.get(runtimeId)
  }

  put(record: OpenClawRuntimeRecord): OpenClawRuntimeRecord {
    const frozen = Object.freeze({
      ...record,
      portBlock: Object.freeze({
        basePort: record.portBlock.basePort,
        ports: Object.freeze([...record.portBlock.ports]),
      }),
    }) as OpenClawRuntimeRecord
    this.records.set(record.runtimeId, frozen)
    return frozen
  }

  all(): readonly OpenClawRuntimeRecord[] {
    return [...this.records.values()]
  }
}

class BoundedRedactedOutput {
  private bytes = 0
  private value = ''

  append(chunk: Buffer | string, redaction: { readonly secrets: readonly string[]; readonly paths: readonly string[] }): void {
    if (this.bytes >= MAX_RUNTIME_OUTPUT_BYTES) return
    const text = redactSecurityText(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk, redaction)
    const remaining = MAX_RUNTIME_OUTPUT_BYTES - this.bytes
    const clipped = Buffer.byteLength(text, 'utf8') > remaining
      ? Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8')
      : text
    this.value += clipped
    this.bytes += Buffer.byteLength(clipped, 'utf8')
  }

  /** Deliberately not exposed outside the manager; output is never logged or returned. */
  clear(): void {
    this.value = ''
    this.bytes = 0
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function assertWorkspaceId(workspaceId: string): void {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new OpenClawOperationError('INVALID_WORKSPACE', false)
  }
}

function runtimeStatus(record: OpenClawRuntimeRecord): OpenClawRuntimeStatus {
  return {
    runtimeId: record.runtimeId,
    workspaceId: record.workspaceId,
    state: record.state,
    ...(record.version === undefined ? {} : { version: record.version }),
    managed: true,
    ...(record.lastHealthAt === undefined ? {} : { lastHealthAt: record.lastHealthAt }),
    ...(record.safeError === undefined ? {} : { safeError: record.safeError }),
  }
}

function unavailableStatus(workspaceId: string): OpenClawRuntimeStatus {
  return {
    runtimeId: deriveOpenClawRuntimeId(workspaceId),
    workspaceId,
    state: 'unavailable',
    managed: true,
    safeError: 'RUNTIME_MISSING',
  }
}

function launcherIsManaged(launcher: ManagedOpenClawLauncher | null): launcher is ManagedOpenClawLauncher {
  return launcher !== null &&
    isAbsolute(launcher.executablePath) &&
    launcher.argsPrefix.length === 1 &&
    isAbsolute(launcher.argsPrefix[0]) &&
    !launcher.executablePath.includes('\u0000') &&
    !launcher.argsPrefix[0].includes('\u0000')
}

async function defaultPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolveAvailable => {
    const server = createServer()
    let settled = false
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      resolveAvailable(available)
    }
    server.once('error', () => settle(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => settle(true))
    })
  })
}

async function defaultProbeHealth(input: OpenClawHealthProbeInput): Promise<boolean> {
  try {
    const response = await fetch(`http://${input.host}:${input.port}${input.path}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}

function defaultSpawn(
  executablePath: string,
  args: readonly string[],
  options: ManagedSpawnOptions,
): ManagedChildProcess {
  return nodeSpawn(executablePath, [...args], {
    cwd: options.cwd,
    env: { ...options.env },
    shell: false,
    detached: false,
    stdio: [...options.stdio],
    windowsHide: true,
  }) as unknown as ManagedChildProcess
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolveWait => setTimeout(resolveWait, milliseconds))
}

/**
 * Owns one managed, loopback-only OpenClaw runtime per workspace. All process
 * and filesystem surfaces are internal; public methods return safe projections.
 */
export class OpenClawRuntimeManager implements OpenClawAuditRuntimeProvider {
  private readonly records = new ImmutableRuntimeRecordStore()
  private readonly locks = new Map<string, Promise<void>>()
  private readonly ownedChildren = new Map<string, OwnedChild>()
  private readonly now: () => number
  private readonly spawn: NonNullable<OpenClawRuntimeManagerDependencies['spawn']>
  private readonly probeHealth: NonNullable<OpenClawRuntimeManagerDependencies['probeHealth']>
  private readonly isPortAvailable: NonNullable<OpenClawRuntimeManagerDependencies['isPortAvailable']>
  private readonly healthTimeoutMs: number
  private readonly healthPollIntervalMs: number
  private readonly stopTimeoutMs: number
  private readonly runtimeRoot: string

  constructor(private readonly deps: OpenClawRuntimeManagerDependencies) {
    if (!isAbsolute(deps.runtimeRoot)) throw new OpenClawOperationError('PATH_REJECTED', false)
    this.runtimeRoot = resolve(deps.runtimeRoot)
    this.now = deps.now ?? Date.now
    this.spawn = deps.spawn ?? defaultSpawn
    this.probeHealth = deps.probeHealth ?? defaultProbeHealth
    this.isPortAvailable = deps.isPortAvailable ?? defaultPortAvailable
    this.healthTimeoutMs = deps.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
    this.healthPollIntervalMs = deps.healthPollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS
    this.stopTimeoutMs = deps.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
  }

  async getRuntimeStatus(workspaceId: string): Promise<OpenClawRuntimeStatus> {
    assertWorkspaceId(workspaceId)
    const runtimeId = deriveOpenClawRuntimeId(workspaceId)
    return this.records.get(runtimeId) ? runtimeStatus(this.records.get(runtimeId)!) : unavailableStatus(workspaceId)
  }

  async provisionRuntime(workspaceId: string): Promise<OpenClawRuntimeStatus> {
    assertWorkspaceId(workspaceId)
    const runtimeId = deriveOpenClawRuntimeId(workspaceId)
    return this.withRuntimeLock(runtimeId, async () => {
      const existing = this.records.get(runtimeId)
      if (existing && ['provisioned', 'starting', 'running', 'stopped', 'degraded'].includes(existing.state)) {
        return runtimeStatus(existing)
      }

      const launcher = await this.resolveLauncher()
      if (!launcher) {
        return runtimeStatus(this.putRecord({
          runtimeId,
          workspaceId,
          state: 'unsupported',
          portBlock: deriveOpenClawPortBlock(runtimeId),
          createdAt: existing?.createdAt ?? this.now(),
          updatedAt: this.now(),
          safeError: 'UNSUPPORTED',
        }))
      }

      const baseRecord: OpenClawRuntimeRecord = {
        runtimeId,
        workspaceId,
        state: 'provisioned',
        portBlock: deriveOpenClawPortBlock(runtimeId),
        version: launcher.version,
        createdAt: existing?.createdAt ?? this.now(),
        updatedAt: this.now(),
      }

      try {
        const layout = await this.ensureRuntimeLayout(runtimeId)
        await this.writeNewConfig(layout, baseRecord.portBlock)
        const credentialId = openClawGatewayCredentialId(runtimeId)
        const credential = await this.deps.credentialStore.get(credentialId)
        if (!credential?.value) {
          await this.deps.credentialStore.set(credentialId, { value: randomBytes(32).toString('base64url') })
        }
        return runtimeStatus(this.putRecord(baseRecord))
      } catch (error) {
        const code = error instanceof OpenClawOperationError ? error.code : 'PATH_REJECTED'
        return runtimeStatus(this.putRecord({
          ...baseRecord,
          state: 'failed',
          updatedAt: this.now(),
          safeError: this.toRuntimeError(code),
        }))
      }
    })
  }

  async startRuntime(workspaceId: string): Promise<OpenClawRuntimeStatus> {
    assertWorkspaceId(workspaceId)
    const runtimeId = deriveOpenClawRuntimeId(workspaceId)
    return this.withRuntimeLock(runtimeId, async () => {
      let record = this.records.get(runtimeId)
      if (!record) return unavailableStatus(workspaceId)
      if (record.state === 'running' && this.ownedChildren.has(runtimeId)) return runtimeStatus(record)
      if (record.state === 'unsupported') return runtimeStatus(record)

      const launcher = await this.resolveLauncher()
      if (!launcher) {
        record = this.putRecord({ ...record, state: 'unsupported', updatedAt: this.now(), safeError: 'UNSUPPORTED' })
        return runtimeStatus(record)
      }

      let layout: OpenClawRuntimeLayout
      try {
        layout = await this.ensureExistingRuntimeLayout(runtimeId)
      } catch {
        record = this.putRecord({ ...record, state: 'failed', updatedAt: this.now(), safeError: 'PATH_REJECTED' })
        return runtimeStatus(record)
      }

      if (!await this.isPortBlockAvailable(record.portBlock)) {
        record = this.putRecord({ ...record, state: 'failed', updatedAt: this.now(), safeError: 'PORT_CONFLICT' })
        return runtimeStatus(record)
      }

      let token: string
      try {
        const credential = await this.deps.credentialStore.get(openClawGatewayCredentialId(runtimeId))
        if (!credential?.value) throw new OpenClawOperationError('CREDENTIAL_MISSING', false)
        token = credential.value
      } catch {
        record = this.putRecord({ ...record, state: 'failed', updatedAt: this.now(), safeError: 'CREDENTIAL_MISSING' })
        return runtimeStatus(record)
      }

      const nonce = randomUUID()
      record = this.putRecord({
        ...record,
        state: 'starting',
        updatedAt: this.now(),
        safeError: undefined,
        launchNonce: nonce,
        version: launcher.version,
      })

      const args = Object.freeze([
        ...launcher.argsPrefix,
        'gateway',
        'run',
        '--config',
        layout.configPath,
      ])
      const env = Object.freeze({
        NODE_ENV: 'production',
        OPENCLAW_CONFIG_PATH: layout.configPath,
        OPENCLAW_STATE_DIR: layout.stateDir,
        OPENCLAW_WORKSPACE_DIR: layout.workspaceDir,
        OPENCLAW_GATEWAY_TOKEN: token,
      })

      let child: ManagedChildProcess
      try {
        child = this.spawn(launcher.executablePath, args, {
          cwd: layout.workspaceDir,
          env,
          shell: false,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
      } catch {
        record = this.putRecord({ ...record, state: 'failed', updatedAt: this.now(), safeError: 'START_FAILED' })
        return runtimeStatus(record)
      }

      const owner = this.ownChild(runtimeId, nonce, child, token, layout)
      const healthy = await this.waitForHealth(record.portBlock.basePort, owner)
      if (!healthy) {
        owner.expectedStop = true
        await this.terminateOwner(owner)
        record = this.records.get(runtimeId) ?? record
        record = this.putRecord({
          ...record,
          state: 'degraded',
          updatedAt: this.now(),
          safeError: 'HEALTH_TIMEOUT',
          launchNonce: undefined,
        })
        return runtimeStatus(record)
      }

      record = this.records.get(runtimeId) ?? record
      if (!this.ownedChildren.has(runtimeId) || record.launchNonce !== nonce) {
        return runtimeStatus(this.putRecord({
          ...record,
          state: 'degraded',
          updatedAt: this.now(),
          safeError: 'START_FAILED',
          launchNonce: undefined,
        }))
      }
      return runtimeStatus(this.putRecord({
        ...record,
        state: 'running',
        updatedAt: this.now(),
        lastHealthAt: this.now(),
        safeError: undefined,
      }))
    })
  }

  async stopRuntime(workspaceId: string): Promise<OpenClawRuntimeStatus> {
    assertWorkspaceId(workspaceId)
    const runtimeId = deriveOpenClawRuntimeId(workspaceId)
    return this.withRuntimeLock(runtimeId, async () => {
      let record = this.records.get(runtimeId)
      if (!record) return unavailableStatus(workspaceId)
      const owner = this.ownedChildren.get(runtimeId)
      if (owner) {
        owner.expectedStop = true
        const stopped = await this.terminateOwner(owner)
        record = this.records.get(runtimeId) ?? record
        if (!stopped) {
          return runtimeStatus(this.putRecord({
            ...record,
            state: 'failed',
            updatedAt: this.now(),
            safeError: 'STOP_FAILED',
            launchNonce: undefined,
          }))
        }
      }
      return runtimeStatus(this.putRecord({
        ...record,
        state: 'stopped',
        updatedAt: this.now(),
        safeError: undefined,
        launchNonce: undefined,
      }))
    })
  }

  /** Stops only children spawned and still owned by this manager instance. */
  async shutdown(): Promise<void> {
    const records = this.records.all()
    for (const record of records) {
      if (this.ownedChildren.has(record.runtimeId)) await this.stopRuntime(record.workspaceId)
    }
  }

  async getAuditRuntime(workspaceId: string): Promise<OpenClawAuditRuntime | null> {
    assertWorkspaceId(workspaceId)
    const runtimeId = deriveOpenClawRuntimeId(workspaceId)
    const record = this.records.get(runtimeId)
    if (!record) return null
    try {
      const layout = await this.ensureExistingRuntimeLayout(runtimeId)
      return {
        runtime: runtimeStatus(record),
        cwd: layout.workspaceDir,
        configPath: layout.configPath,
        statePath: layout.stateDir,
        auditDirectory: layout.auditDir,
      }
    } catch {
      this.putRecord({ ...record, state: 'failed', updatedAt: this.now(), safeError: 'PATH_REJECTED' })
      return null
    }
  }

  /**
   * Electron-main-only capability. It intentionally bypasses every serialized
   * projection and is safe only after the direct host IPC boundary confirms the
   * local operator. It never accepts an origin, port, or path from a caller.
   */
  async getControlUiOriginForHostControl(workspaceId: string): Promise<string> {
    assertWorkspaceId(workspaceId)
    const runtimeId = deriveOpenClawRuntimeId(workspaceId)
    return this.withRuntimeLock(runtimeId, async () => {
      const record = await this.requireOwnedRunningRuntime(workspaceId, runtimeId)
      await this.ensureExistingRuntimeLayout(runtimeId)
      return `http://127.0.0.1:${record.portBlock.basePort}/`
    })
  }

  /**
   * Electron-main-only capability for the clipboard effect. Callers must never
   * return this value or attach it to a transport/logging object.
   */
  async getGatewayTokenForHostControl(workspaceId: string): Promise<string> {
    assertWorkspaceId(workspaceId)
    const runtimeId = deriveOpenClawRuntimeId(workspaceId)
    return this.withRuntimeLock(runtimeId, async () => {
      await this.requireOwnedRunningRuntime(workspaceId, runtimeId)
      await this.ensureExistingRuntimeLayout(runtimeId)
      const credential = await this.deps.credentialStore.get(openClawGatewayCredentialId(runtimeId))
      if (!credential?.value) throw new OpenClawOperationError('CREDENTIAL_MISSING', false)
      return credential.value
    })
  }

  private async requireOwnedRunningRuntime(
    workspaceId: string,
    runtimeId: string,
  ): Promise<OpenClawRuntimeRecord> {
    const record = this.records.get(runtimeId)
    if (!record) throw new OpenClawOperationError('RUNTIME_MISSING', true)
    const owner = this.ownedChildren.get(runtimeId)
    if (record.workspaceId !== workspaceId || record.state !== 'running' || !owner || owner.nonce !== record.launchNonce) {
      throw new OpenClawOperationError('RUNTIME_STOPPED', true)
    }
    return record
  }

  private async resolveLauncher(): Promise<ManagedOpenClawLauncher | null> {
    try {
      const launcher = await this.deps.resolveManagedLauncher()
      return launcherIsManaged(launcher) ? launcher : null
    } catch {
      return null
    }
  }

  private async withRuntimeLock<T>(runtimeId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(runtimeId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const settled = current.then(() => undefined, () => undefined)
    this.locks.set(runtimeId, settled)
    try {
      return await current
    } finally {
      if (this.locks.get(runtimeId) === settled) this.locks.delete(runtimeId)
    }
  }

  private putRecord(record: OpenClawRuntimeRecord): OpenClawRuntimeRecord {
    return this.records.put(record)
  }

  private toRuntimeError(code: OpenClawSafeErrorCode): OpenClawRuntimeSafeErrorCode {
    switch (code) {
      case 'UNSUPPORTED':
      case 'PORT_CONFLICT':
      case 'START_FAILED':
      case 'HEALTH_TIMEOUT':
      case 'STOP_FAILED':
      case 'PATH_REJECTED':
      case 'CREDENTIAL_MISSING':
        return code
      default:
        return 'START_FAILED'
    }
  }

  private async ensureRuntimeLayout(runtimeId: string): Promise<OpenClawRuntimeLayout> {
    const canonicalRoot = await this.ensureOwnedDirectory(this.runtimeRoot)
    const runtimeDir = resolve(canonicalRoot, runtimeId)
    if (!isInside(canonicalRoot, runtimeDir)) throw new OpenClawOperationError('PATH_REJECTED', false)
    await this.ensureOwnedDirectory(runtimeDir, canonicalRoot)
    const configDir = join(runtimeDir, 'config')
    const stateDir = join(runtimeDir, 'state')
    const workspaceDir = join(runtimeDir, 'workspace')
    const auditDir = join(runtimeDir, 'audit')
    await this.ensureOwnedDirectory(configDir, canonicalRoot)
    await this.ensureOwnedDirectory(stateDir, canonicalRoot)
    await this.ensureOwnedDirectory(workspaceDir, canonicalRoot)
    await this.ensureOwnedDirectory(auditDir, canonicalRoot)
    return {
      runtimeDir,
      configDir,
      configPath: join(configDir, 'openclaw.json'),
      stateDir,
      workspaceDir,
      auditDir,
      snapshotsPath: join(auditDir, 'snapshots.jsonl'),
      acceptancesPath: join(auditDir, 'acceptances.json'),
    }
  }

  private async ensureExistingRuntimeLayout(runtimeId: string): Promise<OpenClawRuntimeLayout> {
    let canonicalRoot: string
    try {
      canonicalRoot = await this.assertOwnedDirectory(this.runtimeRoot)
    } catch (error) {
      if (isMissing(error)) throw new OpenClawOperationError('PATH_REJECTED', false)
      throw error
    }
    const runtimeDir = resolve(canonicalRoot, runtimeId)
    if (!isInside(canonicalRoot, runtimeDir)) throw new OpenClawOperationError('PATH_REJECTED', false)
    await this.assertOwnedDirectory(runtimeDir, canonicalRoot)
    const configDir = join(runtimeDir, 'config')
    const stateDir = join(runtimeDir, 'state')
    const workspaceDir = join(runtimeDir, 'workspace')
    const auditDir = join(runtimeDir, 'audit')
    await this.assertOwnedDirectory(configDir, canonicalRoot)
    await this.assertOwnedDirectory(stateDir, canonicalRoot)
    await this.assertOwnedDirectory(workspaceDir, canonicalRoot)
    await this.assertOwnedDirectory(auditDir, canonicalRoot)
    const configPath = join(configDir, 'openclaw.json')
    await this.assertOwnedFile(configPath, canonicalRoot)
    return {
      runtimeDir,
      configDir,
      configPath,
      stateDir,
      workspaceDir,
      auditDir,
      snapshotsPath: join(auditDir, 'snapshots.jsonl'),
      acceptancesPath: join(auditDir, 'acceptances.json'),
    }
  }

  private async ensureOwnedDirectory(path: string, containmentRoot?: string): Promise<string> {
    await mkdir(path, { recursive: true, mode: OWNER_DIR_MODE })
    const canonical = await this.assertOwnedDirectory(path, containmentRoot)
    await chmod(canonical, OWNER_DIR_MODE)
    return canonical
  }

  private async assertOwnedDirectory(path: string, containmentRoot?: string): Promise<string> {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new OpenClawOperationError('PATH_REJECTED', false)
    const canonical = await realpath(path)
    if (containmentRoot && !isInside(containmentRoot, canonical)) {
      throw new OpenClawOperationError('PATH_REJECTED', false)
    }
    return canonical
  }

  private async assertOwnedFile(path: string, containmentRoot: string): Promise<void> {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) throw new OpenClawOperationError('PATH_REJECTED', false)
    const canonical = await realpath(path)
    if (!isInside(containmentRoot, canonical)) throw new OpenClawOperationError('PATH_REJECTED', false)
  }

  private async writeNewConfig(layout: OpenClawRuntimeLayout, portBlock: OpenClawPortBlock): Promise<void> {
    try {
      await this.assertOwnedFile(layout.configPath, layout.runtimeDir)
      // An untracked pre-existing file is not trusted as a managed baseline.
      throw new OpenClawOperationError('PATH_REJECTED', false)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const config = `${JSON.stringify(buildHardenedOpenClawConfig(portBlock), null, 2)}\n`
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      file = await open(layout.configPath, 'wx', OWNER_FILE_MODE)
      await file.writeFile(config, 'utf8')
    } catch (error) {
      if (error instanceof OpenClawOperationError) throw error
      throw new OpenClawOperationError('PATH_REJECTED', false)
    } finally {
      await file?.close()
    }
    await chmod(layout.configPath, OWNER_FILE_MODE)
  }

  private async isPortBlockAvailable(portBlock: OpenClawPortBlock): Promise<boolean> {
    for (const port of portBlock.ports) {
      if (!await this.isPortAvailable(port)) return false
    }
    for (const record of this.records.all()) {
      if (record.portBlock.basePort === portBlock.basePort && record.state === 'running') return false
    }
    return true
  }

  private ownChild(
    runtimeId: string,
    nonce: string,
    child: ManagedChildProcess,
    token: string,
    layout: OpenClawRuntimeLayout,
  ): OwnedChild {
    let resolveExit: () => void = () => undefined
    const owner: OwnedChild = {
      nonce,
      child,
      pid: child.pid,
      exit: new Promise<void>(resolvePromise => { resolveExit = resolvePromise }),
      resolveExit: () => resolveExit(),
      expectedStop: false,
      output: new BoundedRedactedOutput(),
    }
    this.ownedChildren.set(runtimeId, owner)
    const redaction = { secrets: [token], paths: [layout.runtimeDir] }
    child.stdout?.on('data', chunk => owner.output.append(chunk, redaction))
    child.stderr?.on('data', chunk => owner.output.append(chunk, redaction))
    child.once('error', () => {
      void this.handleChildTermination(runtimeId, owner)
    })
    child.once('exit', () => {
      owner.resolveExit()
      void this.handleChildTermination(runtimeId, owner)
    })
    return owner
  }

  private async handleChildTermination(runtimeId: string, owner: OwnedChild): Promise<void> {
    if (this.ownedChildren.get(runtimeId) !== owner) return
    this.ownedChildren.delete(runtimeId)
    owner.output.clear()
    if (owner.expectedStop) return
    const record = this.records.get(runtimeId)
    if (!record || record.launchNonce !== owner.nonce) return
    this.putRecord({
      ...record,
      state: 'degraded',
      updatedAt: this.now(),
      safeError: 'START_FAILED',
      launchNonce: undefined,
    })
  }

  private async waitForHealth(port: number, owner: OwnedChild): Promise<boolean> {
    const deadline = this.now() + this.healthTimeoutMs
    while (this.now() <= deadline) {
      if (!this.ownedChildrenHas(owner)) return false
      if (await this.probeHealth({ host: '127.0.0.1', port, path: '/health', timeoutMs: this.healthPollIntervalMs })) return true
      await wait(this.healthPollIntervalMs)
    }
    return false
  }

  private ownedChildrenHas(owner: OwnedChild): boolean {
    for (const candidate of this.ownedChildren.values()) {
      if (candidate === owner) return true
    }
    return false
  }

  private async terminateOwner(owner: OwnedChild): Promise<boolean> {
    try {
      if (!owner.child.kill('SIGTERM')) return false
    } catch {
      return false
    }
    if (await this.waitForExit(owner, this.stopTimeoutMs)) return true
    try {
      if (!owner.child.kill('SIGKILL')) return false
    } catch {
      return false
    }
    return this.waitForExit(owner, this.stopTimeoutMs)
  }

  private async waitForExit(owner: OwnedChild, timeoutMs: number): Promise<boolean> {
    return Promise.race([
      owner.exit.then(() => true),
      wait(timeoutMs).then(() => false),
    ])
  }
}
