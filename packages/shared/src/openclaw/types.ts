/**
 * Safe, transport-ready domain contracts for the managed OpenClaw runtime.
 *
 * These types intentionally exclude process identifiers, filesystem paths, ports,
 * URLs, child arguments, environments, and credential material.
 */

export type AuditSeverity = 'critical' | 'warn' | 'info' | 'pass' | 'unavailable'

export type AuditMode = 'standard' | 'deep'

export type RuntimeState =
  | 'unavailable'
  | 'installing'
  | 'provisioned'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'degraded'
  | 'failed'
  | 'unsupported'

export type SecurityDomain =
  | 'ingress'
  | 'sessions'
  | 'tools'
  | 'secrets'
  | 'network'
  | 'extensions'
  | 'isolation'
  | 'other'

/** Codes safe to return to a UI or RPC caller. Never attach raw process output. */
export type OpenClawSafeErrorCode =
  | 'RUNTIME_MISSING'
  | 'UNSUPPORTED'
  | 'PORT_CONFLICT'
  | 'START_FAILED'
  | 'HEALTH_TIMEOUT'
  | 'STOP_FAILED'
  | 'PATH_REJECTED'
  | 'CREDENTIAL_MISSING'
  | 'INVALID_WORKSPACE'
  | 'RUNTIME_STOPPED'
  | 'AUDIT_FAILED'
  | 'AUDIT_TIMEOUT'
  | 'AUDIT_OUTPUT_INVALID'
  | 'AUDIT_OUTPUT_TOO_LARGE'
  | 'RISK_ACCEPTANCE_INVALID'
  | 'PERSISTENCE_FAILED'

export type OpenClawRuntimeSafeErrorCode = Extract<
  OpenClawSafeErrorCode,
  | 'RUNTIME_MISSING'
  | 'UNSUPPORTED'
  | 'PORT_CONFLICT'
  | 'START_FAILED'
  | 'HEALTH_TIMEOUT'
  | 'STOP_FAILED'
  | 'PATH_REJECTED'
  | 'CREDENTIAL_MISSING'
>

export interface OpenClawSafeError<Code extends OpenClawSafeErrorCode = OpenClawSafeErrorCode> {
  readonly code: Code
  readonly retryable: boolean
}

/**
 * Safe runtime projection. The runtime identifier is a stable opaque hash of an
 * internal workspace identity, never a user path or label.
 */
export interface OpenClawRuntimeStatus {
  readonly runtimeId: string
  readonly workspaceId: string
  readonly state: RuntimeState
  readonly version?: string
  readonly managed: true
  readonly lastHealthAt?: number
  readonly safeError?: OpenClawRuntimeSafeErrorCode
}

export interface SecurityFindingAcceptance {
  readonly rationale: string
  readonly expiresAt: number
  readonly expired: boolean
}

export interface SecurityFinding {
  readonly fingerprint: string
  readonly source: 'craft' | 'openclaw'
  readonly checkId: string
  readonly domain: SecurityDomain
  readonly severity: AuditSeverity
  readonly title: string
  readonly detail: string
  readonly remediation: string | null
  readonly detectedAt: number
  readonly acceptance?: SecurityFindingAcceptance
}

export type CraftAuditCoverage = 'checked' | 'unavailable'
export type OpenClawAuditCoverage = 'checked' | 'not-provisioned' | 'unavailable' | 'failed'
export type DeepAuditCoverage = 'checked' | 'not-requested' | 'unavailable' | 'failed'

export interface SecurityDomainSummary {
  readonly domain: SecurityDomain
  readonly severity: AuditSeverity
  readonly findingCount: number
  readonly coverage: 'complete' | 'partial' | 'none'
}

export interface SecurityAuditSnapshot {
  readonly id: string
  readonly runtimeId: string
  readonly workspaceId: string
  readonly mode: AuditMode
  readonly startedAt: number
  readonly completedAt: number
  readonly coverage: {
    readonly craft: CraftAuditCoverage
    readonly openclaw: OpenClawAuditCoverage
    readonly deep?: DeepAuditCoverage
  }
  readonly runtime: OpenClawRuntimeStatus
  readonly summary: Record<AuditSeverity, number>
  readonly domains: readonly SecurityDomainSummary[]
  readonly findings: readonly SecurityFinding[]
  readonly safeError?: OpenClawSafeError
}

/** Input accepted only after the transport has authorized the workspace. */
export interface AcceptSecurityRiskRequest {
  readonly workspaceId: string
  readonly fingerprint: string
  readonly rationale: string
  readonly expiresAt: number
}

/** Local Craft record; it never maps to OpenClaw's suppression configuration. */
export interface SecurityRiskAcceptance {
  readonly workspaceId: string
  readonly fingerprint: string
  readonly rationale: string
  readonly acceptedAt: number
  readonly expiresAt: number
}

/** Strict allowlisted shape extracted from `openclaw security audit --json`. */
export interface OpenClawAuditFinding {
  readonly checkId: string
  readonly severity: AuditSeverity
  readonly title: string
  readonly detail: string
  readonly remediation: string | null
}

export interface OpenClawAuditReport {
  readonly timestamp?: number
  readonly summary: Readonly<Partial<Record<AuditSeverity, number>>>
  readonly findings: readonly OpenClawAuditFinding[]
  readonly suppressedFindings: readonly OpenClawAuditFinding[]
}

export type OpenClawAuditParseResult =
  | { readonly ok: true; readonly report: OpenClawAuditReport }
  | { readonly ok: false; readonly error: OpenClawSafeError<'AUDIT_OUTPUT_INVALID'> }
