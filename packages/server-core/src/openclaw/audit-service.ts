import { randomUUID } from 'node:crypto'
import type {
  AcceptSecurityRiskRequest,
  AuditMode,
  AuditSeverity,
  OpenClawRuntimeStatus,
  OpenClawSafeError,
  SecurityAuditSnapshot,
  SecurityDomain,
  SecurityDomainSummary,
  SecurityFinding,
} from '@craft-agent/shared/openclaw'
import {
  fingerprintSecurityFinding,
  sanitizeSecurityText,
} from '@craft-agent/shared/openclaw'
import type { CraftAuditCollection, OpenClawAuditCollection } from './collectors.ts'
import type { OpenClawAuditRuntime, OpenClawAuditRuntimeProvider } from './runtime-manager.ts'
import { OpenClawOperationError } from './runtime-manager.ts'
import { OpenClawRiskAcceptanceStore, OpenClawSnapshotStore } from './persistence.ts'

const DOMAINS: readonly SecurityDomain[] = [
  'ingress',
  'sessions',
  'tools',
  'secrets',
  'network',
  'extensions',
  'isolation',
  'other',
]

const SEVERITY_RANK: Readonly<Record<AuditSeverity, number>> = {
  unavailable: 0,
  pass: 1,
  info: 2,
  warn: 3,
  critical: 4,
}

export interface OpenClawAuditServiceRuntimeProvider extends OpenClawAuditRuntimeProvider {
  getRuntimeStatus(workspaceId: string): Promise<OpenClawRuntimeStatus>
}

export interface CraftSecurityCollectorLike {
  collect(workspaceId: string, detectedAt?: number): Promise<CraftAuditCollection>
}

export interface OpenClawSecurityCollectorLike {
  collect(workspaceId: string, mode: AuditMode): Promise<OpenClawAuditCollection>
  dispose?(): Promise<void>
}

export interface OpenClawSecurityAuditServiceDependencies {
  readonly runtimeProvider: OpenClawAuditServiceRuntimeProvider
  readonly craftCollector: CraftSecurityCollectorLike
  readonly openClawCollector: OpenClawSecurityCollectorLike
  readonly now?: () => number
}

function safeError(code: OpenClawSafeError['code'], retryable: boolean): OpenClawSafeError {
  return { code, retryable }
}

function runtimeSafeError(status: OpenClawRuntimeStatus): OpenClawSafeError | undefined {
  if (!status.safeError) return undefined
  const retryable = status.safeError !== 'UNSUPPORTED' && status.safeError !== 'PATH_REJECTED'
  return safeError(status.safeError, retryable)
}

const SAFE_CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

/**
 * Rebuilds the only finding shape the service may persist or return. This
 * closes the collector-to-snapshot boundary even when a future collector is
 * replaced or misbehaves.
 */
function canonicalizeFinding(finding: SecurityFinding): SecurityFinding {
  const checkId = SAFE_CHECK_ID_PATTERN.test(finding.checkId) ? finding.checkId : 'unknown'
  const title = sanitizeSecurityText(finding.title)
  const detail = sanitizeSecurityText(finding.detail)
  const remediation = finding.remediation === null ? null : sanitizeSecurityText(finding.remediation)
  const acceptance = finding.acceptance === undefined
    ? undefined
    : {
        rationale: sanitizeSecurityText(finding.acceptance.rationale),
        expiresAt: finding.acceptance.expiresAt,
        expired: finding.acceptance.expired,
      }
  return {
    fingerprint: fingerprintSecurityFinding({
      source: finding.source,
      checkId,
      title,
      detail,
      remediation,
    }),
    source: finding.source,
    checkId,
    domain: finding.domain,
    severity: finding.severity,
    title,
    detail,
    remediation,
    detectedAt: finding.detectedAt,
    ...(acceptance === undefined ? {} : { acceptance }),
  }
}

function summaryFor(findings: readonly SecurityFinding[], craft: CraftAuditCollection, openclaw: OpenClawAuditCollection): Record<AuditSeverity, number> {
  const summary: Record<AuditSeverity, number> = { critical: 0, warn: 0, info: 0, pass: 0, unavailable: 0 }
  for (const finding of findings) summary[finding.severity] += 1
  if (craft.coverage === 'unavailable') summary.unavailable += 1
  if (openclaw.coverage !== 'checked') summary.unavailable += 1
  return summary
}

function severityForDomain(findings: readonly SecurityFinding[], domain: SecurityDomain, coverage: SecurityDomainSummary['coverage']): AuditSeverity {
  let winner: AuditSeverity | null = null
  for (const finding of findings) {
    if (finding.domain !== domain) continue
    if (!winner || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[winner]) winner = finding.severity
  }
  if (winner) return winner
  return coverage === 'complete' ? 'pass' : 'unavailable'
}

function domainSummaries(findings: readonly SecurityFinding[], craft: CraftAuditCollection, openclaw: OpenClawAuditCollection): readonly SecurityDomainSummary[] {
  const checkedSources = Number(craft.coverage === 'checked') + Number(openclaw.coverage === 'checked')
  const coverage: SecurityDomainSummary['coverage'] = checkedSources === 2 ? 'complete' : checkedSources === 1 ? 'partial' : 'none'
  return DOMAINS.map(domain => ({
    domain,
    severity: severityForDomain(findings, domain, coverage),
    findingCount: findings.filter(finding => finding.domain === domain).length,
    coverage,
  }))
}

function deepCoverage(mode: AuditMode, collection: OpenClawAuditCollection): SecurityAuditSnapshot['coverage']['deep'] {
  if (mode === 'standard') return 'not-requested'
  if (collection.coverage === 'checked') return 'checked'
  if (collection.coverage === 'failed') return 'failed'
  return 'unavailable'
}

/**
 * Coordinates safe collectors and local-only persistence. It has no transport
 * knowledge: later Electron-only confirmation code must call its explicit
 * mutation methods rather than exposing process controls through RPC.
 */
export class OpenClawSecurityAuditService {
  private readonly now: () => number
  private disposePromise: Promise<void> | undefined
  constructor(private readonly deps: OpenClawSecurityAuditServiceDependencies) {
    this.now = deps.now ?? Date.now
  }

  async runAudit(workspaceId: string, mode: AuditMode): Promise<SecurityAuditSnapshot> {
    const startedAt = this.now()
    const [runtime, context, craft, openclaw] = await Promise.all([
      this.deps.runtimeProvider.getRuntimeStatus(workspaceId),
      this.deps.runtimeProvider.getAuditRuntime(workspaceId),
      this.deps.craftCollector.collect(workspaceId, startedAt),
      this.deps.openClawCollector.collect(workspaceId, mode),
    ])

    const candidates = [
      ...craft.findings,
      ...openclaw.findings,
    ].map(canonicalizeFinding)
    const findings = (await this.applyAcceptances(workspaceId, candidates, context)).map(canonicalizeFinding)
    const snapshot: SecurityAuditSnapshot = {
      id: randomUUID(),
      runtimeId: runtime.runtimeId,
      workspaceId,
      mode,
      startedAt,
      completedAt: this.now(),
      coverage: {
        craft: craft.coverage,
        openclaw: openclaw.coverage,
        deep: deepCoverage(mode, openclaw),
      },
      runtime,
      summary: summaryFor(findings, craft, openclaw),
      domains: domainSummaries(findings, craft, openclaw),
      findings,
      ...(openclaw.error ? { safeError: openclaw.error } : runtimeSafeError(runtime) ? { safeError: runtimeSafeError(runtime)! } : {}),
    }

    if (!context?.auditDirectory) return snapshot
    try {
      return await new OpenClawSnapshotStore(context.auditDirectory, { now: this.now }).save(snapshot)
    } catch {
      return { ...snapshot, safeError: safeError('PERSISTENCE_FAILED', true) }
    }
  }

  async getLatestAudit(workspaceId: string): Promise<SecurityAuditSnapshot | null> {
    const context = await this.deps.runtimeProvider.getAuditRuntime(workspaceId)
    if (!context?.auditDirectory) return null
    try {
      return await new OpenClawSnapshotStore(context.auditDirectory, { now: this.now }).latest()
    } catch {
      return null
    }
  }

  /** Idempotently terminates and awaits owned in-flight audits during app quit. */
  async dispose(): Promise<void> {
    this.disposePromise ??= Promise.resolve(this.deps.openClawCollector.dispose?.()).then(() => undefined)
    await this.disposePromise
  }

  /** Explicit future-confirmation mutation: it writes only Craft-local acceptance state. */
  async acceptRisk(input: AcceptSecurityRiskRequest): Promise<void> {
    const context = await this.requireAuditRuntime(input.workspaceId)
    await new OpenClawRiskAcceptanceStore(context.auditDirectory!, { now: this.now }).accept(input)
  }

  /** Explicit future-confirmation mutation: it never changes OpenClaw suppression configuration. */
  async revokeRiskAcceptance(workspaceId: string, fingerprint: string): Promise<void> {
    const context = await this.requireAuditRuntime(workspaceId)
    await new OpenClawRiskAcceptanceStore(context.auditDirectory!, { now: this.now }).revoke(workspaceId, fingerprint)
  }

  private async applyAcceptances(
    workspaceId: string,
    findings: readonly SecurityFinding[],
    context: OpenClawAuditRuntime | null,
  ): Promise<readonly SecurityFinding[]> {
    if (!context?.auditDirectory) return findings
    const store = new OpenClawRiskAcceptanceStore(context.auditDirectory, { now: this.now })
    return Promise.all(findings.map(async finding => {
      const acceptance = await store.get(workspaceId, finding.fingerprint, this.now())
      return acceptance ? { ...finding, acceptance } : finding
    }))
  }

  private async requireAuditRuntime(workspaceId: string): Promise<OpenClawAuditRuntime & { readonly auditDirectory: string }> {
    const context = await this.deps.runtimeProvider.getAuditRuntime(workspaceId)
    if (!context?.auditDirectory) throw new OpenClawOperationError('RUNTIME_MISSING', true)
    return context as OpenClawAuditRuntime & { readonly auditDirectory: string }
  }
}
