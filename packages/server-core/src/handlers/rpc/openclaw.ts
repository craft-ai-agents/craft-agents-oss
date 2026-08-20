import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  sanitizeSecurityText,
  type AcceptSecurityRiskRequest,
  type AuditMode,
  type AuditSeverity,
  type OpenClawRuntimeSafeErrorCode,
  type OpenClawRuntimeStatus,
  type OpenClawSafeError,
  type SecurityAuditSnapshot,
  type SecurityDomain,
  type SecurityFinding,
} from '@craft-agent/shared/openclaw'
import type { RpcServer, RequestContext } from '../../transport/types'
import type {
  HandlerDeps,
  OpenClawSecurityAuditInput,
  OpenClawSecurityService,
  OpenClawSecurityWorkspaceInput,
  RevokeOpenClawSecurityRiskInput,
} from '../handler-deps'

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_FINDING_TEXT_LENGTH = 8_000
const MAX_FINDINGS = 10_000
const MAX_DOMAINS = 8

const AUDIT_MODES = ['standard', 'deep'] as const
const RUNTIME_STATES = [
  'unavailable',
  'installing',
  'provisioned',
  'starting',
  'running',
  'stopped',
  'degraded',
  'failed',
  'unsupported',
] as const
const AUDIT_SEVERITIES = ['critical', 'warn', 'info', 'pass', 'unavailable'] as const
const SECURITY_DOMAINS = [
  'ingress',
  'sessions',
  'tools',
  'secrets',
  'network',
  'extensions',
  'isolation',
  'other',
] as const
const RUNTIME_SAFE_ERROR_CODES = [
  'RUNTIME_MISSING',
  'UNSUPPORTED',
  'PORT_CONFLICT',
  'START_FAILED',
  'HEALTH_TIMEOUT',
  'STOP_FAILED',
  'PATH_REJECTED',
  'CREDENTIAL_MISSING',
] as const
const SAFE_ERROR_CODES = [
  ...RUNTIME_SAFE_ERROR_CODES,
  'INVALID_WORKSPACE',
  'RUNTIME_STOPPED',
  'AUDIT_FAILED',
  'AUDIT_TIMEOUT',
  'AUDIT_OUTPUT_INVALID',
  'AUDIT_OUTPUT_TOO_LARGE',
  'RISK_ACCEPTANCE_INVALID',
  'PERSISTENCE_FAILED',
] as const

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.openclawRuntime.GET_STATUS,
  RPC_CHANNELS.openclawRuntime.INSTALL,
  RPC_CHANNELS.openclawRuntime.PROVISION,
  RPC_CHANNELS.openclawRuntime.START,
  RPC_CHANNELS.openclawRuntime.STOP,
  RPC_CHANNELS.securityAudit.RUN,
  RPC_CHANNELS.securityAudit.GET_LATEST,
  RPC_CHANNELS.securityAudit.ACCEPT_RISK,
  RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE,
] as const

function invalidRequest(): never {
  throw new CodedError('INVALID_REF', 'Invalid OpenClaw security request')
}

function unavailable(): never {
  throw new CodedError('UNSUPPORTED_OPERATION', 'OpenClaw security operations are unavailable on this host')
}

function serviceFailure(): never {
  throw new CodedError('PROVIDER_ERROR', 'OpenClaw security operation failed')
}

function invalidServiceProjection(): never {
  throw new CodedError('PROVIDER_ERROR', 'OpenClaw security service returned an invalid safe projection')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every(key => expected.includes(key))
}

function parseWorkspaceInput(value: unknown): OpenClawSecurityWorkspaceInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['workspaceId']) ||
    typeof value.workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(value.workspaceId)) {
    invalidRequest()
  }
  return { workspaceId: value.workspaceId }
}

function parseAuditInput(value: unknown): OpenClawSecurityAuditInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['workspaceId', 'mode']) ||
    typeof value.workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(value.workspaceId) ||
    !isOneOf(value.mode, AUDIT_MODES)) {
    invalidRequest()
  }
  return { workspaceId: value.workspaceId, mode: value.mode }
}

function parseAcceptRiskInput(value: unknown): AcceptSecurityRiskRequest {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['workspaceId', 'fingerprint', 'rationale', 'expiresAt']) ||
    typeof value.workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(value.workspaceId) ||
    typeof value.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(value.fingerprint) ||
    typeof value.rationale !== 'string' ||
    typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)) {
    invalidRequest()
  }

  const rationale = value.rationale.trim()
  const rationaleLength = Array.from(rationale).length
  const now = Date.now()
  if (rationaleLength < 10 || rationaleLength > 500 ||
    value.expiresAt < now + DAY_MS || value.expiresAt > now + 365 * DAY_MS) {
    invalidRequest()
  }

  return {
    workspaceId: value.workspaceId,
    fingerprint: value.fingerprint,
    rationale,
    expiresAt: value.expiresAt,
  }
}

function parseRevokeRiskInput(value: unknown): RevokeOpenClawSecurityRiskInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['workspaceId', 'fingerprint']) ||
    typeof value.workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(value.workspaceId) ||
    typeof value.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(value.fingerprint)) {
    invalidRequest()
  }
  return { workspaceId: value.workspaceId, fingerprint: value.fingerprint }
}

function authorizeWorkspace<T extends OpenClawSecurityWorkspaceInput>(
  context: RequestContext,
  deps: HandlerDeps,
  input: T,
): T {
  const callerWorkspaceId = context.workspaceId ?? (
    context.webContentsId === null
      ? undefined
      : deps.windowManager?.getWorkspaceForWindow(context.webContentsId) ?? undefined
  )
  if (typeof callerWorkspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(callerWorkspaceId) ||
    callerWorkspaceId !== input.workspaceId) {
    invalidRequest()
  }
  return input
}

function requireService(deps: HandlerDeps): OpenClawSecurityService {
  return deps.openClawSecurity ?? unavailable()
}

async function callService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    serviceFailure()
  }
}

function safeText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_FINDING_TEXT_LENGTH) invalidServiceProjection()
  return sanitizeSecurityText(value)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>`]+/gi, '[URL_REDACTED]')
    .replace(/(^|\s)(?:~\/|\/)(?:[^\s/]+\/)*[^\s/]+/g, '$1[PATH_REDACTED]')
    .replace(/\[[0-9A-Fa-f:.]+\]\s*:\s*\d{1,5}\b/g, '[ENDPOINT_REDACTED]')
    .replace(/\b(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])\s*:\s*\d{1,5}\b/g, '[ENDPOINT_REDACTED]')
    .replace(/\bport\s*(?:=|:)?\s*\d{1,5}\b/gi, 'port=[REDACTED]')
    .replace(/\b[A-Z_][A-Z0-9_]{1,127}\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/g, '[ENV_REDACTED]')
    .replace(/\b(argv|arguments?|command|config(?:uration)?|environment|stdout|stderr|output)\s*[:=]\s*[^\r\n]+/gi, '$1=[REDACTED]')
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_FINDINGS
}

function projectRuntimeStatus(value: unknown, workspaceId: string): OpenClawRuntimeStatus {
  if (!isPlainRecord(value) || typeof value.runtimeId !== 'string' || !SAFE_ID_PATTERN.test(value.runtimeId) ||
    value.workspaceId !== workspaceId || !isOneOf(value.state, RUNTIME_STATES) || value.managed !== true) {
    invalidServiceProjection()
  }

  const version = value.version
  if (version !== undefined && (typeof version !== 'string' || !SAFE_VERSION_PATTERN.test(version))) {
    invalidServiceProjection()
  }
  const lastHealthAt = value.lastHealthAt
  if (lastHealthAt !== undefined && !isTimestamp(lastHealthAt)) invalidServiceProjection()
  const safeError = value.safeError
  if (safeError !== undefined && !isOneOf(safeError, RUNTIME_SAFE_ERROR_CODES)) invalidServiceProjection()

  return {
    runtimeId: value.runtimeId,
    workspaceId,
    state: value.state,
    managed: true,
    ...(version !== undefined ? { version } : {}),
    ...(lastHealthAt !== undefined ? { lastHealthAt } : {}),
    ...(safeError !== undefined ? { safeError: safeError as OpenClawRuntimeSafeErrorCode } : {}),
  }
}

function projectCoverage(value: unknown): SecurityAuditSnapshot['coverage'] {
  if (!isPlainRecord(value) || value.craft !== 'checked' && value.craft !== 'unavailable' ||
    value.openclaw !== 'checked' && value.openclaw !== 'not-provisioned' &&
      value.openclaw !== 'unavailable' && value.openclaw !== 'failed') {
    invalidServiceProjection()
  }
  const deep = value.deep
  if (deep !== undefined && deep !== 'checked' && deep !== 'not-requested' &&
    deep !== 'unavailable' && deep !== 'failed') {
    invalidServiceProjection()
  }
  return {
    craft: value.craft,
    openclaw: value.openclaw,
    ...(deep !== undefined ? { deep } : {}),
  }
}

function projectSummary(value: unknown): Record<AuditSeverity, number> {
  if (!isPlainRecord(value)) invalidServiceProjection()
  const summary = {
    critical: value.critical,
    warn: value.warn,
    info: value.info,
    pass: value.pass,
    unavailable: value.unavailable,
  }
  if (!AUDIT_SEVERITIES.every(severity => isCount(summary[severity]))) invalidServiceProjection()
  return summary as Record<AuditSeverity, number>
}

function projectDomain(value: unknown): SecurityAuditSnapshot['domains'][number] {
  if (!isPlainRecord(value) || !isOneOf(value.domain, SECURITY_DOMAINS) ||
    !isOneOf(value.severity, AUDIT_SEVERITIES) || !isCount(value.findingCount) ||
    value.coverage !== 'complete' && value.coverage !== 'partial' && value.coverage !== 'none') {
    invalidServiceProjection()
  }
  return {
    domain: value.domain as SecurityDomain,
    severity: value.severity as AuditSeverity,
    findingCount: value.findingCount,
    coverage: value.coverage,
  }
}

function projectAcceptance(value: unknown): SecurityFinding['acceptance'] {
  if (!isPlainRecord(value) || typeof value.rationale !== 'string') {
    invalidServiceProjection()
  }
  const rationale = value.rationale.trim()
  const rationaleLength = Array.from(rationale).length
  if (rationaleLength < 10 || rationaleLength > 500 ||
    !isTimestamp(value.expiresAt) || typeof value.expired !== 'boolean') {
    invalidServiceProjection()
  }
  return {
    rationale: safeText(rationale),
    expiresAt: value.expiresAt,
    expired: value.expired,
  }
}

function projectFinding(value: unknown): SecurityFinding {
  if (!isPlainRecord(value) || typeof value.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(value.fingerprint) ||
    value.source !== 'craft' && value.source !== 'openclaw' ||
    typeof value.checkId !== 'string' || !CHECK_ID_PATTERN.test(value.checkId) ||
    !isOneOf(value.domain, SECURITY_DOMAINS) || !isOneOf(value.severity, AUDIT_SEVERITIES) ||
    !isTimestamp(value.detectedAt) || value.remediation !== null && typeof value.remediation !== 'string') {
    invalidServiceProjection()
  }
  const acceptance = value.acceptance === undefined ? undefined : projectAcceptance(value.acceptance)
  return {
    fingerprint: value.fingerprint,
    source: value.source,
    checkId: value.checkId,
    domain: value.domain,
    severity: value.severity,
    title: safeText(value.title),
    detail: safeText(value.detail),
    remediation: value.remediation === null ? null : safeText(value.remediation),
    detectedAt: value.detectedAt,
    ...(acceptance ? { acceptance } : {}),
  }
}

function projectSafeError(value: unknown): OpenClawSafeError | undefined {
  if (value === undefined) return undefined
  if (!isPlainRecord(value) || !isOneOf(value.code, SAFE_ERROR_CODES) || typeof value.retryable !== 'boolean') {
    invalidServiceProjection()
  }
  return { code: value.code, retryable: value.retryable }
}

function projectSnapshot(
  value: unknown,
  workspaceId: string,
  expectedMode?: AuditMode,
): SecurityAuditSnapshot {
  if (!isPlainRecord(value) || typeof value.id !== 'string' || !SAFE_ID_PATTERN.test(value.id) ||
    typeof value.runtimeId !== 'string' || !SAFE_ID_PATTERN.test(value.runtimeId) ||
    value.workspaceId !== workspaceId || !isOneOf(value.mode, AUDIT_MODES) ||
    expectedMode !== undefined && value.mode !== expectedMode ||
    !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt) ||
    value.completedAt < value.startedAt || !Array.isArray(value.domains) ||
    value.domains.length > MAX_DOMAINS || !Array.isArray(value.findings) || value.findings.length > MAX_FINDINGS) {
    invalidServiceProjection()
  }

  const runtime = projectRuntimeStatus(value.runtime, workspaceId)
  if (value.runtimeId !== runtime.runtimeId) invalidServiceProjection()
  const safeError = projectSafeError(value.safeError)
  return {
    id: value.id,
    runtimeId: value.runtimeId,
    workspaceId,
    mode: value.mode,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    coverage: projectCoverage(value.coverage),
    runtime,
    summary: projectSummary(value.summary),
    domains: value.domains.map(projectDomain),
    findings: value.findings.map(projectFinding),
    ...(safeError ? { safeError } : {}),
  }
}

/**
 * Registers only safe, workspace-scoped OpenClaw data operations. Host-control
 * actions deliberately have no RPC representation.
 */
export function registerOpenClawHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.openclawRuntime.GET_STATUS, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseWorkspaceInput(rawInput))
    const service = requireService(deps)
    const result = await callService(() => service.getRuntimeStatus(input))
    return projectRuntimeStatus(result, input.workspaceId)
  })

  server.handle(RPC_CHANNELS.openclawRuntime.INSTALL, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseWorkspaceInput(rawInput))
    const service = requireService(deps)
    const result = await callService(() => service.installRuntime(input))
    return projectRuntimeStatus(result, input.workspaceId)
  })

  server.handle(RPC_CHANNELS.openclawRuntime.PROVISION, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseWorkspaceInput(rawInput))
    const service = requireService(deps)
    const result = await callService(() => service.provisionRuntime(input))
    return projectRuntimeStatus(result, input.workspaceId)
  })

  server.handle(RPC_CHANNELS.openclawRuntime.START, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseWorkspaceInput(rawInput))
    const service = requireService(deps)
    const result = await callService(() => service.startRuntime(input))
    return projectRuntimeStatus(result, input.workspaceId)
  })

  server.handle(RPC_CHANNELS.openclawRuntime.STOP, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseWorkspaceInput(rawInput))
    const service = requireService(deps)
    const result = await callService(() => service.stopRuntime(input))
    return projectRuntimeStatus(result, input.workspaceId)
  })

  server.handle(RPC_CHANNELS.securityAudit.RUN, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseAuditInput(rawInput))
    const service = requireService(deps)
    const result = await callService(() => service.runAudit(input))
    return projectSnapshot(result, input.workspaceId, input.mode)
  })

  server.handle(RPC_CHANNELS.securityAudit.GET_LATEST, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseWorkspaceInput(rawInput))
    const service = requireService(deps)
    const result = await callService(() => service.getLatestAudit(input))
    return result === null ? null : projectSnapshot(result, input.workspaceId)
  })

  server.handle(RPC_CHANNELS.securityAudit.ACCEPT_RISK, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseAcceptRiskInput(rawInput))
    const service = requireService(deps)
    await callService(() => service.acceptRisk(input))
  })

  server.handle(RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE, async (context, rawInput: unknown) => {
    const input = authorizeWorkspace(context, deps, parseRevokeRiskInput(rawInput))
    const service = requireService(deps)
    await callService(() => service.revokeRiskAcceptance(input))
  })
}
