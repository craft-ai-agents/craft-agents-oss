import { spawn as nodeSpawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import {
  fingerprintSecurityFinding,
  normaliseOpenClawFinding,
  parseOpenClawAuditJson,
  redactSecurityText,
  OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES,
  type AuditMode,
  type OpenClawRuntimeStatus,
  type OpenClawSafeError,
  type SecurityDomain,
  type SecurityFinding,
} from '@craft-agent/shared/openclaw'
import type { ManagedOpenClawLauncher } from '@craft-agent/shared/toolchain/types'
import type { OpenClawAuditRuntime, OpenClawAuditRuntimeProvider } from './runtime-manager.ts'

export type { OpenClawAuditRuntimeProvider } from './runtime-manager.ts'

const AUDIT_TIMEOUT_MS = 30_000
const MAX_AUDIT_STDERR_BYTES = 1024 * 1024
const SAFE_EXTENSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

export interface OpenClawAuditProcessRequest {
  readonly executablePath: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly shell: false
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

/** Internal process result only. Raw stderr is discarded before this boundary. */
export interface OpenClawAuditProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stdoutTruncated?: boolean
  readonly stderrTruncated?: boolean
  readonly timedOut?: boolean
  readonly unsupported?: true
}

export interface OpenClawAuditRunner {
  run(request: OpenClawAuditProcessRequest): Promise<OpenClawAuditProcessResult>
  dispose?(): Promise<void>
}

export interface ManagedOpenClawAuditChildProcess {
  readonly pid?: number
  readonly stdout?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  readonly stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  once(event: 'error', listener: () => void): unknown
  once(event: 'close', listener: (code: number | null) => void): unknown
  kill(signal?: NodeJS.Signals | number): boolean
}
export type OpenClawAuditSpawn = (
  executablePath: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string
    env: Readonly<Record<string, string>>
    shell: false
    detached: boolean
    stdio: readonly ['ignore', 'pipe', 'pipe']
    windowsHide: true
  }>,
) => ManagedOpenClawAuditChildProcess


export type OpenClawAuditTreeTerminator = (
  child: ManagedOpenClawAuditChildProcess,
  signal: NodeJS.Signals,
) => void | Promise<void>

export interface OpenClawAuditTimer {
  clear(): void
}

export type OpenClawAuditSchedule = (callback: () => void, delayMs: number) => OpenClawAuditTimer
export interface OpenClawAuditProcessSupervisorDependencies {
  readonly spawn?: OpenClawAuditSpawn
  readonly schedule?: OpenClawAuditSchedule
  readonly terminateTree?: OpenClawAuditTreeTerminator
  readonly platform?: string
  readonly terminateGraceMs?: number
  readonly finalWaitMs?: number
}

interface ActiveAuditChild {
  readonly terminate: () => void
  readonly settled: Promise<void>
}
function appendBounded(current: Buffer, chunk: Buffer, maxBytes: number): { value: Buffer; truncated: boolean } {
  if (current.length >= maxBytes) return { value: current, truncated: true }
  const remaining = maxBytes - current.length
  if (chunk.length <= remaining) return { value: Buffer.concat([current, chunk]), truncated: false }
  return { value: Buffer.concat([current, chunk.subarray(0, remaining)]), truncated: true }
}

function isLiveAuditPid(pid: number | undefined): pid is number {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0
}

function defaultTerminateAuditTree(
  child: ManagedOpenClawAuditChildProcess,
  signal: NodeJS.Signals,
  platform: string,
): void {
  const pid = child.pid
  if (platform !== 'win32' && isLiveAuditPid(pid)) {
    const ownedProcessGroup: number = -pid
    try {
      process.kill(ownedProcessGroup, signal)
      return
    } catch {
      // The group may have already exited; direct fallback remains bounded.
    }
  }

  try { child.kill(signal) } catch { /* process result remains controlled */ }
}

/**
 * A per-collector supervisor for fixed audit children. It owns live handles,
 * never returns until a terminal result or bounded TERM-to-KILL escalation,
 * and supports app-quit disposal without exposing process data.
 */
export class OpenClawAuditProcessSupervisor implements OpenClawAuditRunner {
  private readonly spawn: OpenClawAuditSpawn
  private readonly terminateGraceMs: number
  private readonly finalWaitMs: number
  private readonly platform: string
  private readonly active = new Set<ActiveAuditChild>()
  private readonly schedule: OpenClawAuditSchedule
  private readonly terminateTree: OpenClawAuditTreeTerminator
  private disposed = false
  private disposePromise: Promise<void> | undefined
  constructor(deps: OpenClawAuditProcessSupervisorDependencies = {}) {
    this.spawn = deps.spawn ?? ((executablePath, args, options) => nodeSpawn(executablePath, [...args], {
      cwd: options.cwd,
      env: { ...options.env },
      shell: false,
      detached: options.detached,
      stdio: [...options.stdio],
      windowsHide: true,
    }) as ManagedOpenClawAuditChildProcess)
    this.platform = deps.platform ?? process.platform
    this.terminateGraceMs = Math.max(0, deps.terminateGraceMs ?? 1_000)
    this.finalWaitMs = Math.max(0, deps.finalWaitMs ?? 1_000)
    this.schedule = deps.schedule ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      return { clear: () => clearTimeout(timer) }
    })
    this.terminateTree = deps.terminateTree ?? ((child, signal) => defaultTerminateAuditTree(
      child,
      signal,
      this.platform,
    ))
  }

  async run(request: OpenClawAuditProcessRequest): Promise<OpenClawAuditProcessResult> {
    // Windows lacks a native Job Object supervisor here. Never launch an
    // audit child until that ownership boundary exists.
    if (this.platform === 'win32') return { exitCode: null, stdout: '', unsupported: true }
    if (this.disposed) return { exitCode: null, stdout: '' }

    const result = Promise.withResolvers<OpenClawAuditProcessResult>()
    let child: ManagedOpenClawAuditChildProcess
    try {
      child = this.spawn(request.executablePath, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        detached: this.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      result.resolve({ exitCode: null, stdout: '' })
      return result.promise
    }

    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let finished = false
    let terminating = false
    let childClosed = false
    let childExitCode: number | null = null
    let timeoutTimer: OpenClawAuditTimer | undefined
    let killTimer: OpenClawAuditTimer | undefined
    let finalWaitTimer: OpenClawAuditTimer | undefined
    let active: ActiveAuditChild | undefined
    const settled = Promise.withResolvers<void>()

    const finish = (exitCode: number | null): void => {
      if (finished) return
      finished = true
      timeoutTimer?.clear()
      killTimer?.clear()
      finalWaitTimer?.clear()
      if (active) this.active.delete(active)
      result.resolve({
        exitCode,
        stdout: stdout.toString('utf8'),
        ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
        ...(stderrTruncated ? { stderrTruncated: true } : {}),
        ...(timedOut ? { timedOut: true } : {}),
      })
      settled.resolve()
    }

    const afterTreeTermination = (
      signal: NodeJS.Signals,
      onComplete: () => void,
    ): void => {
      let termination: void | Promise<void>
      try {
        termination = this.terminateTree(child, signal)
      } catch {
        onComplete()
        return
      }
      if (termination && typeof termination.then === 'function') {
        void termination.then(onComplete, onComplete)
        return
      }
      onComplete()
    }
    const scheduleFinalWait = (): void => {
      if (finished) return
      finalWaitTimer = this.schedule(
        () => finish(childClosed ? childExitCode : null),
        this.finalWaitMs,
      )
    }
    const scheduleKill = (): void => {
      if (finished) return
      killTimer = this.schedule(() => {
        if (finished) return
        afterTreeTermination('SIGKILL', scheduleFinalWait)
      }, this.terminateGraceMs)
    }
    const terminate = (): void => {
      if (finished || terminating) return
      terminating = true
      if (!timedOut) timeoutTimer?.clear()
      afterTreeTermination('SIGTERM', scheduleKill)
    }
    active = { terminate, settled: settled.promise }
    this.active.add(active)
    timeoutTimer = this.schedule(() => {
      timedOut = true
      terminate()
    }, request.timeoutMs)

    child.stdout?.on('data', chunk => {
      if (finished) return
      const next = appendBounded(stdout, Buffer.from(chunk), request.maxOutputBytes)
      stdout = next.value
      stdoutTruncated ||= next.truncated
      if (stdoutTruncated) terminate()
    })
    child.stderr?.on('data', chunk => {
      if (finished) return
      const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, 'utf8')
      stderrBytes += bytes
      stderrTruncated ||= stderrBytes > MAX_AUDIT_STDERR_BYTES
      if (stderrTruncated) terminate()
    })
    child.once('error', () => {
      if (!terminating) finish(null)
    })
    child.once('close', code => {
      childClosed = true
      childExitCode = code
      if (!terminating) finish(code)
    })
    return result.promise
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    const active = [...this.active]
    for (const child of active) child.terminate()
    this.disposePromise = Promise.all(active.map(child => child.settled)).then(() => undefined)
    return this.disposePromise
  }
}


export interface OpenClawSecurityCollectorDependencies {
  readonly runtimeProvider: OpenClawAuditRuntimeProvider
  readonly resolveManagedLauncher: () => Promise<ManagedOpenClawLauncher | null>
  readonly runner?: OpenClawAuditRunner
  readonly platform?: string
  readonly now?: () => number
}

export interface OpenClawAuditCollection {
  readonly coverage: 'checked' | 'not-provisioned' | 'unavailable' | 'failed'
  readonly findings: readonly SecurityFinding[]
  readonly suppressedFindingCount: number
  readonly error?: OpenClawSafeError
}

function safeError(code: OpenClawSafeError['code'], retryable: boolean): OpenClawSafeError {
  return { code, retryable }
}

function validLauncher(launcher: ManagedOpenClawLauncher | null): launcher is ManagedOpenClawLauncher {
  return launcher !== null && launcher.argsPrefix.length === 1 && isAbsolute(launcher.executablePath) && isAbsolute(launcher.argsPrefix[0])
}

/** Read-only audit collector for a verified managed OpenClaw installation. */
export class OpenClawSecurityCollector {
  private readonly runner: OpenClawAuditRunner
  private readonly now: () => number
  private readonly platform: string

  constructor(private readonly deps: OpenClawSecurityCollectorDependencies) {
    this.platform = deps.platform ?? process.platform
    this.runner = deps.runner ?? new OpenClawAuditProcessSupervisor({ platform: this.platform })
    this.now = deps.now ?? Date.now
  }

  async collect(workspaceId: string, mode: AuditMode): Promise<OpenClawAuditCollection> {
    // Native Job Object ownership is required before a Windows audit child can
    // run. Returning a controlled unavailable state avoids a partial tree.
    if (this.platform === 'win32') {
      return { coverage: 'unavailable', findings: [], suppressedFindingCount: 0, error: safeError('UNSUPPORTED', false) }
    }
    let runtime: OpenClawAuditRuntime | null
    try {
      runtime = await this.deps.runtimeProvider.getAuditRuntime(workspaceId)
    } catch {
      return { coverage: 'unavailable', findings: [], suppressedFindingCount: 0, error: safeError('RUNTIME_MISSING', true) }
    }
    if (!runtime) {
      return { coverage: 'not-provisioned', findings: [], suppressedFindingCount: 0, error: safeError('RUNTIME_MISSING', true) }
    }
    if (runtime.runtime.state === 'unsupported') {
      return { coverage: 'unavailable', findings: [], suppressedFindingCount: 0, error: safeError('UNSUPPORTED', false) }
    }
    if (mode === 'deep' && runtime.runtime.state !== 'running') {
      return { coverage: 'unavailable', findings: [], suppressedFindingCount: 0, error: safeError('RUNTIME_STOPPED', true) }
    }

    let launcher: ManagedOpenClawLauncher | null
    try {
      launcher = await this.deps.resolveManagedLauncher()
    } catch {
      launcher = null
    }
    if (!validLauncher(launcher)) {
      return { coverage: 'unavailable', findings: [], suppressedFindingCount: 0, error: safeError('UNSUPPORTED', false) }
    }

    const args = mode === 'standard'
      ? [...launcher.argsPrefix, 'security', 'audit', '--json']
      : [...launcher.argsPrefix, 'security', 'audit', '--deep', '--json']
    let result: OpenClawAuditProcessResult
    try {
      result = await this.runner.run({
        executablePath: launcher.executablePath,
        args,
        cwd: runtime.cwd,
        env: {
          NODE_ENV: 'production',
          OPENCLAW_CONFIG_PATH: runtime.configPath,
          OPENCLAW_STATE_DIR: runtime.statePath,
        },
        shell: false,
        timeoutMs: AUDIT_TIMEOUT_MS,
        maxOutputBytes: OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES,
      })
    } catch {
      return { coverage: 'failed', findings: [], suppressedFindingCount: 0, error: safeError('AUDIT_FAILED', true) }
    }

    if (result.unsupported) {
      return { coverage: 'unavailable', findings: [], suppressedFindingCount: 0, error: safeError('UNSUPPORTED', false) }
    }
    if (result.timedOut) {
      return { coverage: 'failed', findings: [], suppressedFindingCount: 0, error: safeError('AUDIT_TIMEOUT', true) }
    }
    if (
      result.stdoutTruncated ||
      result.stderrTruncated ||
      Buffer.byteLength(result.stdout, 'utf8') > OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES
    ) {
      return { coverage: 'failed', findings: [], suppressedFindingCount: 0, error: safeError('AUDIT_OUTPUT_TOO_LARGE', false) }
    }
    if (result.exitCode !== 0) {
      // Stderr is intentionally discarded here. Do not include it in any safe result.
      return { coverage: 'failed', findings: [], suppressedFindingCount: 0, error: safeError('AUDIT_FAILED', true) }
    }

    const parsed = parseOpenClawAuditJson(result.stdout)
    if (!parsed.ok) {
      return { coverage: 'failed', findings: [], suppressedFindingCount: 0, error: parsed.error }
    }

    const detectedAt = this.now()
    const redaction = {
      paths: [runtime.cwd, runtime.configPath, runtime.statePath],
    }
    return {
      coverage: 'checked',
      findings: parsed.report.findings.map(finding => normaliseOpenClawFinding(finding, detectedAt, redaction)),
      suppressedFindingCount: parsed.report.suppressedFindings.length,
    }
  }

  /** Stops any owned in-flight audit process during application shutdown. */
  async dispose(): Promise<void> {
    await this.runner.dispose?.()
  }
}

export type CraftPermissionMode = 'ask' | 'safe' | 'allow-all'
export type CraftExtensionCapability = 'filesystem' | 'network' | 'process' | 'browser' | 'credentials' | 'other'

/** Value-free metadata view; `StoredCredential.value` is intentionally absent. */
export interface CraftSecurityPosture {
  readonly permissionMode?: CraftPermissionMode
  readonly extensions: readonly {
    readonly id: string
    readonly enabled: boolean
    readonly capabilityClasses: readonly CraftExtensionCapability[]
  }[]
  readonly credentialHealth: {
    readonly healthy: boolean
    readonly issues: readonly { readonly type: string }[]
  }
  readonly server: {
    readonly bind: 'loopback' | 'lan' | 'all' | 'unknown'
    readonly tls: boolean
    readonly insecure: boolean
  }
  readonly toolchain: { readonly openclaw: 'ready' | 'missing' | 'unsupported' }
}

export interface CraftSecurityCollectorDependencies {
  readonly inspect: (workspaceId: string) => Promise<CraftSecurityPosture>
}

export interface CraftAuditCollection {
  readonly coverage: 'checked' | 'unavailable'
  readonly findings: readonly SecurityFinding[]
}

function safeIdentifier(value: string, fallback: string): string {
  return SAFE_EXTENSION_ID.test(value) ? value : fallback
}

function craftFinding(
  checkId: string,
  domain: SecurityDomain,
  severity: SecurityFinding['severity'],
  title: string,
  detail: string,
  remediation: string | null,
  detectedAt: number,
): SecurityFinding {
  const safeTitle = redactSecurityText(title)
  const safeDetail = redactSecurityText(detail)
  const safeRemediation = remediation === null ? null : redactSecurityText(remediation)
  return {
    fingerprint: fingerprintSecurityFinding({
      source: 'craft',
      checkId,
      title: safeTitle,
      detail: safeDetail,
      remediation: safeRemediation,
    }),
    source: 'craft',
    checkId,
    domain,
    severity,
    title: safeTitle,
    detail: safeDetail,
    remediation: safeRemediation,
    detectedAt,
  }
}

/**
 * Collects only safe Craft metadata. It never accepts or reads a credential
 * value, server token, path, process argument, or URL.
 */
export class CraftSecurityCollector {
  constructor(private readonly deps: CraftSecurityCollectorDependencies) {}

  async collect(workspaceId: string, detectedAt = Date.now()): Promise<CraftAuditCollection> {
    let posture: CraftSecurityPosture
    try {
      posture = await this.deps.inspect(workspaceId)
    } catch {
      return { coverage: 'unavailable', findings: [] }
    }

    const findings: SecurityFinding[] = []
    if (posture.permissionMode === 'allow-all') {
      findings.push(craftFinding(
        'craft.permissions.allow_all',
        'tools',
        'warn',
        'Craft permission mode allows all actions',
        'The active workspace permission posture allows actions without a per-action approval.',
        'Use ask or safe mode for workspaces that process untrusted content.',
        detectedAt,
      ))
    }

    for (const extension of posture.extensions) {
      const highRisk = extension.enabled && extension.capabilityClasses.some(capability =>
        capability === 'filesystem' || capability === 'network' || capability === 'process' || capability === 'browser' || capability === 'credentials',
      )
      if (!highRisk) continue
      const extensionId = safeIdentifier(extension.id, 'unknown')
      findings.push(craftFinding(
        `craft.extensions.${extensionId}.high_risk_capability`,
        'extensions',
        'warn',
        'Enabled extension has high-risk capabilities',
        'An enabled extension can access one or more high-impact capability classes.',
        'Review the extension grant and disable capabilities not required for this workspace.',
        detectedAt,
      ))
    }

    if (!posture.credentialHealth.healthy) {
      for (const issue of posture.credentialHealth.issues) {
        const issueType = safeIdentifier(issue.type, 'unknown')
        findings.push(craftFinding(
          `craft.credentials.${issueType}`,
          'secrets',
          'warn',
          'Credential storage health needs attention',
          'Craft could not confirm that a credential-storage health check is clean.',
          'Repair credential storage through the host settings surface before using affected integrations.',
          detectedAt,
        ))
      }
    }

    if (posture.server.bind !== 'loopback') {
      findings.push(craftFinding(
        'craft.server.bind.non_loopback',
        'ingress',
        'critical',
        'Craft server listens beyond loopback',
        'A server bind outside loopback expands the inbound network surface.',
        'Bind to loopback or enforce an explicit authenticated reverse-proxy boundary.',
        detectedAt,
      ))
      if (!posture.server.tls) {
        findings.push(craftFinding(
          'craft.server.tls.disabled',
          'network',
          'critical',
          'Craft server lacks TLS on a non-loopback bind',
          'Network traffic could be exposed or modified in transit.',
          'Enable TLS before using a non-loopback server bind.',
          detectedAt,
        ))
      }
    }
    if (posture.server.insecure) {
      findings.push(craftFinding(
        'craft.server.insecure_mode',
        'network',
        'warn',
        'Craft server reports an insecure mode',
        'One or more server hardening controls are disabled.',
        'Review the host server configuration and restore its hardened defaults.',
        detectedAt,
      ))
    }

    if (posture.toolchain.openclaw !== 'ready') {
      findings.push(craftFinding(
        `craft.toolchain.openclaw.${posture.toolchain.openclaw}`,
        'isolation',
        'info',
        'Managed OpenClaw runtime is not ready',
        'Craft cannot safely run a managed OpenClaw audit until the pinned toolchain is ready.',
        'Install or repair only the managed OpenClaw toolchain from Craft.',
        detectedAt,
      ))
    }

    return { coverage: 'checked', findings }
  }
}
