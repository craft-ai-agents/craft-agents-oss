import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import {
  applyRiskAcceptance,
  redactSecurityText,
  type AcceptSecurityRiskRequest,
  type AuditSeverity,
  type OpenClawRuntimeStatus,
  type OpenClawSafeError,
  type SecurityAuditSnapshot,
  type SecurityFinding,
  type SecurityFindingAcceptance,
  type SecurityRiskAcceptance,
} from '@craft-agent/shared/openclaw'
import { OpenClawOperationError } from './runtime-manager.ts'

const OWNER_DIR_MODE = 0o700
const OWNER_FILE_MODE = 0o600
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SNAPSHOTS = 30
const RETENTION_MS = 90 * DAY_MS
const MAX_PERSISTED_BYTES = 8 * 1024 * 1024
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const SAFE_ERROR_CODES = [
  'RUNTIME_MISSING',
  'UNSUPPORTED',
  'PORT_CONFLICT',
  'START_FAILED',
  'HEALTH_TIMEOUT',
  'STOP_FAILED',
  'PATH_REJECTED',
  'CREDENTIAL_MISSING',
  'INVALID_WORKSPACE',
  'RUNTIME_STOPPED',
  'AUDIT_FAILED',
  'AUDIT_TIMEOUT',
  'AUDIT_OUTPUT_INVALID',
  'AUDIT_OUTPUT_TOO_LARGE',
  'RISK_ACCEPTANCE_INVALID',
  'PERSISTENCE_FAILED',
] as const satisfies readonly OpenClawSafeError['code'][]
const SAFE_ERROR_CODE_SET: ReadonlySet<string> = new Set(SAFE_ERROR_CODES)
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

export interface OpenClawPersistenceOptions {
  readonly now?: () => number
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOpenClawSafeErrorCode(value: unknown): value is OpenClawSafeError['code'] {
  return typeof value === 'string' && SAFE_ERROR_CODE_SET.has(value)
}

function isSeverity(value: unknown): value is AuditSeverity {
  return value === 'critical' || value === 'warn' || value === 'info' || value === 'pass' || value === 'unavailable'
}

function safeRuntimeStatus(value: unknown): OpenClawRuntimeStatus | null {
  if (!isPlainRecord(value) ||
    typeof value.runtimeId !== 'string' ||
    typeof value.workspaceId !== 'string' ||
    typeof value.state !== 'string' ||
    value.managed !== true ||
    !SAFE_ID_PATTERN.test(value.runtimeId) ||
    !WORKSPACE_ID_PATTERN.test(value.workspaceId)) {
    return null
  }
  const states = new Set(['unavailable', 'installing', 'provisioned', 'starting', 'running', 'stopped', 'degraded', 'failed', 'unsupported'])
  if (!states.has(value.state)) return null
  const runtimeCodes = new Set(['RUNTIME_MISSING', 'UNSUPPORTED', 'PORT_CONFLICT', 'START_FAILED', 'HEALTH_TIMEOUT', 'STOP_FAILED', 'PATH_REJECTED', 'CREDENTIAL_MISSING'])
  return {
    runtimeId: value.runtimeId,
    workspaceId: value.workspaceId,
    state: value.state as OpenClawRuntimeStatus['state'],
    managed: true,
    ...(typeof value.version === 'string' && value.version.length <= 128 ? { version: value.version } : {}),
    ...(typeof value.lastHealthAt === 'number' && Number.isFinite(value.lastHealthAt) ? { lastHealthAt: value.lastHealthAt } : {}),
    ...(typeof value.safeError === 'string' && runtimeCodes.has(value.safeError)
      ? { safeError: value.safeError as NonNullable<OpenClawRuntimeStatus['safeError']> }
      : {}),
  }
}

function safeFinding(value: unknown): SecurityFinding | null {
  if (!isPlainRecord(value) ||
    typeof value.fingerprint !== 'string' ||
    !FINGERPRINT_PATTERN.test(value.fingerprint) ||
    typeof value.source !== 'string' ||
    typeof value.checkId !== 'string' ||
    !CHECK_ID_PATTERN.test(value.checkId) ||
    typeof value.domain !== 'string' ||
    !isSeverity(value.severity) ||
    typeof value.title !== 'string' ||
    value.title.length > 8_000 ||
    typeof value.detail !== 'string' ||
    value.detail.length > 8_000 ||
    (value.remediation !== null && (typeof value.remediation !== 'string' || value.remediation.length > 8_000)) ||
    typeof value.detectedAt !== 'number' ||
    !Number.isFinite(value.detectedAt)) return null
  const domains = new Set(['ingress', 'sessions', 'tools', 'secrets', 'network', 'extensions', 'isolation', 'other'])
  if ((value.source !== 'craft' && value.source !== 'openclaw') || !domains.has(value.domain)) return null
  const acceptance = isPlainRecord(value.acceptance) &&
    typeof value.acceptance.rationale === 'string' &&
    typeof value.acceptance.expiresAt === 'number' &&
    typeof value.acceptance.expired === 'boolean'
    ? {
        rationale: redactSecurityText(value.acceptance.rationale),
        expiresAt: value.acceptance.expiresAt,
        expired: value.acceptance.expired,
      }
    : undefined
  return {
    fingerprint: value.fingerprint,
    source: value.source,
    checkId: value.checkId,
    domain: value.domain as SecurityFinding['domain'],
    severity: value.severity,
    title: redactSecurityText(value.title),
    detail: redactSecurityText(value.detail),
    remediation: value.remediation === null ? null : redactSecurityText(value.remediation),
    detectedAt: value.detectedAt,
    ...(acceptance === undefined ? {} : { acceptance }),
  }
}

function safeSnapshot(value: unknown): SecurityAuditSnapshot | null {
  if (!isPlainRecord(value) ||
    typeof value.id !== 'string' ||
    !SAFE_ID_PATTERN.test(value.id) ||
    typeof value.runtimeId !== 'string' ||
    !SAFE_ID_PATTERN.test(value.runtimeId) ||
    typeof value.workspaceId !== 'string' ||
    !WORKSPACE_ID_PATTERN.test(value.workspaceId) ||
    (value.mode !== 'standard' && value.mode !== 'deep') ||
    typeof value.startedAt !== 'number' ||
    typeof value.completedAt !== 'number' ||
    !Number.isFinite(value.startedAt) ||
    !Number.isFinite(value.completedAt) ||
    !isPlainRecord(value.coverage) ||
    !isPlainRecord(value.summary) ||
    !Array.isArray(value.domains) ||
    !Array.isArray(value.findings)) return null

  const runtime = safeRuntimeStatus(value.runtime)
  if (!runtime || runtime.runtimeId !== value.runtimeId || runtime.workspaceId !== value.workspaceId) return null
  if ((value.coverage.craft !== 'checked' && value.coverage.craft !== 'unavailable') ||
    !['checked', 'not-provisioned', 'unavailable', 'failed'].includes(value.coverage.openclaw as string) ||
    (value.coverage.deep !== undefined && !['checked', 'not-requested', 'unavailable', 'failed'].includes(value.coverage.deep as string))) return null

  const summary: Record<AuditSeverity, number> = { critical: 0, warn: 0, info: 0, pass: 0, unavailable: 0 }
  for (const severity of Object.keys(summary) as AuditSeverity[]) {
    const count = value.summary[severity]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null
    summary[severity] = count
  }

  const domains = value.domains.map(domain => {
    if (!isPlainRecord(domain) || typeof domain.domain !== 'string' || !isSeverity(domain.severity) || typeof domain.findingCount !== 'number' || !Number.isSafeInteger(domain.findingCount) || !['complete', 'partial', 'none'].includes(domain.coverage as string)) return null
    const allowed = new Set(['ingress', 'sessions', 'tools', 'secrets', 'network', 'extensions', 'isolation', 'other'])
    if (!allowed.has(domain.domain)) return null
    return {
      domain: domain.domain as SecurityFinding['domain'],
      severity: domain.severity,
      findingCount: domain.findingCount,
      coverage: domain.coverage as 'complete' | 'partial' | 'none',
    }
  })
  if (domains.some(domain => domain === null)) return null

  const findings = value.findings.map(safeFinding)
  if (findings.some(finding => finding === null)) return null

  const candidateSafeError = value.safeError
  const safeError: OpenClawSafeError | undefined = isPlainRecord(candidateSafeError) &&
    isOpenClawSafeErrorCode(candidateSafeError.code) &&
    typeof candidateSafeError.retryable === 'boolean'
    ? {
        code: candidateSafeError.code,
        retryable: candidateSafeError.retryable,
      }
    : undefined
  return {
    id: value.id,
    runtimeId: value.runtimeId,
    workspaceId: value.workspaceId,
    mode: value.mode,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    coverage: {
      craft: value.coverage.craft,
      openclaw: value.coverage.openclaw as SecurityAuditSnapshot['coverage']['openclaw'],
      ...(value.coverage.deep === undefined ? {} : { deep: value.coverage.deep as NonNullable<SecurityAuditSnapshot['coverage']['deep']> }),
    },
    runtime,
    summary,
    domains: domains as NonNullable<typeof domains[number]>[],
    findings: findings as SecurityFinding[],
    ...(safeError === undefined ? {} : { safeError }),
  }
}

async function ensureOwnerDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new OpenClawOperationError('PATH_REJECTED', false)
  await mkdir(path, { recursive: true, mode: OWNER_DIR_MODE })
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new OpenClawOperationError('PATH_REJECTED', false)
  const canonical = await realpath(path)
  await chmod(canonical, OWNER_DIR_MODE)
  return canonical
}

async function assertSafeExistingFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) throw new OpenClawOperationError('PATH_REJECTED', false)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await assertSafeExistingFile(path)
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, 'wx', OWNER_FILE_MODE)
    await handle.writeFile(content, 'utf8')
  } finally {
    await handle?.close()
  }
  try {
    await chmod(temp, OWNER_FILE_MODE)
    await rename(temp, path)
    await chmod(path, OWNER_FILE_MODE)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

abstract class OpenClawJsonStore {
  protected readonly now: () => number
  protected readonly directory: string

  constructor(directory: string, options: OpenClawPersistenceOptions) {
    this.directory = directory
    this.now = options.now ?? Date.now
  }

  protected async ensureDirectory(): Promise<string> {
    return ensureOwnerDirectory(this.directory)
  }

  protected async readText(fileName: string): Promise<string | null> {
    const directory = await this.ensureDirectory()
    const path = join(directory, fileName)
    if (!await assertSafeExistingFile(path)) return null
    const text = await readFile(path, 'utf8')
    if (Buffer.byteLength(text, 'utf8') > MAX_PERSISTED_BYTES) throw new OpenClawOperationError('PERSISTENCE_FAILED', false)
    return text
  }

  protected async writeText(fileName: string, content: string): Promise<void> {
    const directory = await this.ensureDirectory()
    await atomicWrite(join(directory, fileName), content)
  }
}

/** Immutable, redacted JSONL snapshot store with max-30 / max-90-day retention. */
export class OpenClawSnapshotStore extends OpenClawJsonStore {
  async list(): Promise<readonly SecurityAuditSnapshot[]> {
    const text = await this.readText('snapshots.jsonl')
    if (!text) return []
    return text.split('\n')
      .filter(Boolean)
      .map(line => {
        try { return safeSnapshot(JSON.parse(line)) } catch { return null }
      })
      .filter((snapshot): snapshot is SecurityAuditSnapshot => snapshot !== null)
      .sort((left, right) => right.completedAt - left.completedAt)
  }

  async save(snapshot: SecurityAuditSnapshot): Promise<SecurityAuditSnapshot> {
    const safe = safeSnapshot(snapshot)
    if (!safe) throw new OpenClawOperationError('PERSISTENCE_FAILED', false)
    const cutoff = this.now() - RETENTION_MS
    const current = await this.list()
    const retained = [...current, safe]
      .filter(candidate => candidate.completedAt >= cutoff)
      .sort((left, right) => right.completedAt - left.completedAt)
      .slice(0, MAX_SNAPSHOTS)
    await this.writeText('snapshots.jsonl', retained.map(candidate => JSON.stringify(candidate)).join('\n') + (retained.length > 0 ? '\n' : ''))
    return safe
  }

  async latest(): Promise<SecurityAuditSnapshot | null> {
    return (await this.list())[0] ?? null
  }
}

function safeAcceptance(value: unknown): SecurityRiskAcceptance | null {
  if (!isPlainRecord(value) ||
    typeof value.workspaceId !== 'string' ||
    typeof value.fingerprint !== 'string' ||
    typeof value.rationale !== 'string' ||
    typeof value.acceptedAt !== 'number' ||
    typeof value.expiresAt !== 'number') return null
  if (!WORKSPACE_ID_PATTERN.test(value.workspaceId) || !FINGERPRINT_PATTERN.test(value.fingerprint) || !Number.isFinite(value.acceptedAt) || !Number.isFinite(value.expiresAt)) return null
  return {
    workspaceId: value.workspaceId,
    fingerprint: value.fingerprint,
    rationale: redactSecurityText(value.rationale),
    acceptedAt: value.acceptedAt,
    expiresAt: value.expiresAt,
  }
}

/** Local Craft acceptance store. It never reads or writes OpenClaw suppression state. */
export class OpenClawRiskAcceptanceStore extends OpenClawJsonStore {
  private async all(): Promise<SecurityRiskAcceptance[]> {
    const text = await this.readText('acceptances.json')
    if (!text) return []
    try {
      const parsed: unknown = JSON.parse(text)
      if (!Array.isArray(parsed)) return []
      return parsed.map(safeAcceptance).filter((value): value is SecurityRiskAcceptance => value !== null)
    } catch {
      return []
    }
  }

  async accept(input: AcceptSecurityRiskRequest): Promise<SecurityRiskAcceptance> {
    const now = this.now()
    const rationale = input.rationale.trim()
    const rationaleLength = Array.from(rationale).length
    if (!WORKSPACE_ID_PATTERN.test(input.workspaceId) ||
      !FINGERPRINT_PATTERN.test(input.fingerprint) ||
      rationaleLength < 10 ||
      rationaleLength > 500 ||
      !Number.isFinite(input.expiresAt) ||
      input.expiresAt < now + DAY_MS ||
      input.expiresAt > now + 365 * DAY_MS) {
      throw new OpenClawOperationError('RISK_ACCEPTANCE_INVALID', false)
    }
    const acceptance: SecurityRiskAcceptance = {
      workspaceId: input.workspaceId,
      fingerprint: input.fingerprint,
      rationale: redactSecurityText(rationale),
      acceptedAt: now,
      expiresAt: input.expiresAt,
    }
    const existing = await this.all()
    const updated = [
      ...existing.filter(candidate => candidate.workspaceId !== input.workspaceId || candidate.fingerprint !== input.fingerprint),
      acceptance,
    ]
    await this.writeText('acceptances.json', JSON.stringify(updated))
    return acceptance
  }

  async get(workspaceId: string, fingerprint: string, now = this.now()): Promise<SecurityFindingAcceptance | null> {
    const acceptance = (await this.all())
      .filter(candidate => candidate.workspaceId === workspaceId && candidate.fingerprint === fingerprint)
      .sort((left, right) => right.acceptedAt - left.acceptedAt)[0]
    return acceptance ? applyRiskAcceptance(acceptance, now) : null
  }

  async revoke(workspaceId: string, fingerprint: string): Promise<void> {
    if (!WORKSPACE_ID_PATTERN.test(workspaceId) || !FINGERPRINT_PATTERN.test(fingerprint)) {
      throw new OpenClawOperationError('RISK_ACCEPTANCE_INVALID', false)
    }
    const updated = (await this.all()).filter(candidate => candidate.workspaceId !== workspaceId || candidate.fingerprint !== fingerprint)
    await this.writeText('acceptances.json', JSON.stringify(updated))
  }
}
