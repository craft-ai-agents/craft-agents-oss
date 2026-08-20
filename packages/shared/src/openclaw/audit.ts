import { createHash } from 'node:crypto'
import type {
  AuditSeverity,
  OpenClawAuditFinding,
  OpenClawAuditParseResult,
  OpenClawAuditReport,
  SecurityDomain,
  SecurityFinding,
  SecurityFindingAcceptance,
} from './types.ts'

const MAX_AUDIT_JSON_BYTES = 1024 * 1024
const MAX_AUDIT_FINDINGS = 10_000
const MAX_CHECK_ID_LENGTH = 256
const MAX_FINDING_TEXT_LENGTH = 8_000
const AUDIT_SEVERITIES: readonly AuditSeverity[] = ['critical', 'warn', 'info', 'pass', 'unavailable']
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export interface SecurityRedactionOptions {
  /** Exact in-memory secret values that must be removed before serialisation. */
  readonly secrets?: readonly string[]
  /** Exact filesystem roots that must not escape the server-core boundary. */
  readonly paths?: readonly string[]
}

export interface FingerprintSecurityFindingInput {
  readonly source: 'craft' | 'openclaw'
  readonly checkId: string
  readonly title: string
  readonly detail: string
  readonly remediation: string | null
  /** Deliberately ignored: a severity transition must retain local acceptance. */
  readonly severity?: AuditSeverity
  /** Deliberately ignored: fingerprints are stable across audit runs. */
  readonly detectedAt?: number
}

function isAuditSeverity(value: unknown): value is AuditSeverity {
  return typeof value === 'string' && (AUDIT_SEVERITIES as readonly string[]).includes(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeAuditError(): OpenClawAuditParseResult {
  return { ok: false, error: { code: 'AUDIT_OUTPUT_INVALID', retryable: false } }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redactExactValues(value: string, values: readonly string[], replacement: string): string {
  let result = value
  for (const candidate of [...values]
    .filter(candidateValue => candidateValue.length >= 4)
    .sort((left, right) => right.length - left.length)) {
    result = result.replace(new RegExp(escapeRegExp(candidate), 'g'), replacement)
  }
  return result
}

const MAX_QUOTED_PROPERTY_KEY_LENGTH = 512

function findQuotedSegmentEnd(value: string, start: number): number | null {
  const quote = value[start]!
  let index = start + 1
  while (index < value.length) {
    const character = value[index]!
    if (character === '\\') {
      if (index + 1 >= value.length) return null
      index += 2
      continue
    }
    if (character === quote) return index + 1
    index += 1
  }
  return null
}

function skipWhitespace(value: string, start: number): number {
  let index = start
  while (index < value.length && /\s/.test(value[index]!)) index += 1
  return index
}

function findJsonPropertyValueEnd(value: string, start: number): number {
  if (start >= value.length) return start
  if (value[start] === '"' || value[start] === "'") return findQuotedSegmentEnd(value, start) ?? value.length

  let index = start
  while (index < value.length) {
    const character = value[index]!
    if (character === ',' || character === '}' || character === ']' || /\s/.test(character!)) break
    index += 1
  }
  return index
}

function decodeQuotedJsonPropertyKey(quotedKey: string): string | null {
  if (quotedKey.length < 2 || quotedKey.length > MAX_QUOTED_PROPERTY_KEY_LENGTH) return null
  const quote = quotedKey[0]!
  if (quote === '"') {
    try {
      const parsed: unknown = JSON.parse(quotedKey)
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return null
    }
  }

  const raw = quotedKey.slice(1, -1)
  let decoded = ''
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!
    if (character !== '\\') {
      decoded += character
      continue
    }
    const escaped = raw[index + 1]
    if (escaped === undefined) return null
    if (escaped !== 'u') {
      decoded += escaped
      index += 1
      continue
    }
    const hex = raw.slice(index + 2, index + 6)
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return null
    decoded += String.fromCharCode(Number.parseInt(hex, 16))
    index += 5
  }
  return decoded
}

function isCredentialPropertyKey(key: string): boolean {
  const normalized = key.normalize('NFKC').toLowerCase().replace(/[\s._-]+/g, '')
  return normalized === 'value' ||
    normalized === 'key' ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('authorization') ||
    normalized.includes('credential') ||
    normalized.includes('apikey') ||
    normalized.includes('privatekey') ||
    normalized.includes('accesskey')
}

function isSecretBearingAssignmentKey(key: string): boolean {
  const normalized = key.normalize('NFKC').toLowerCase().replace(/[\s._-]+/g, '')
  return normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('authorization') ||
    normalized.includes('credential') ||
    normalized.includes('apikey') ||
    normalized.includes('privatekey') ||
    normalized.includes('accesskey')
}

const SECRET_ASSIGNMENT_PATTERN = /(?:^|([^A-Za-z0-9_.]))([A-Za-z_][A-Za-z0-9_.-]{0,127})\s*(?:=|:)\s*/g

function findSecretAssignmentValue(value: string, start: number): { readonly end: number; readonly suffixStart: number } {
  const quote = value[start]
  if (quote === '"' || quote === "'") {
    const end = findQuotedSegmentEnd(value, start) ?? value.length
    return { end, suffixStart: end }
  }
  if (quote === '[') {
    const markerEnd = value.indexOf(']', start + 1)
    if (markerEnd >= 0) return { end: markerEnd + 1, suffixStart: markerEnd + 1 }
  }

  let end = start
  while (end < value.length) {
    const character = value[end]!
    if (character === ',' || character === ';' || /\s/.test(character)) break
    end += 1
  }
  let suffixStart = end
  while (suffixStart > start) {
    const character = value[suffixStart - 1]!
    if (
      character !== ')' &&
      character !== '}' &&
      character !== ']' &&
      character !== '.' &&
      character !== '!' &&
      character !== '?'
    ) break
    suffixStart -= 1
  }
  return { end, suffixStart }
}

function redactSecretBearingAssignments(value: string): string {
  const chunks: string[] = []
  let emitted = 0
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SECRET_ASSIGNMENT_PATTERN.exec(value)) !== null) {
    const key = match[2]!
    if (!isSecretBearingAssignmentKey(key)) continue

    const valueStart = SECRET_ASSIGNMENT_PATTERN.lastIndex
    const { end, suffixStart } = findSecretAssignmentValue(value, valueStart)
    if (end === valueStart) continue

    chunks.push(
      value.slice(emitted, match.index),
      match[1] ?? '',
      '[ENV_REDACTED]',
      value.slice(suffixStart, end),
    )
    emitted = end
    SECRET_ASSIGNMENT_PATTERN.lastIndex = end
  }
  return chunks.length === 0 ? value : `${chunks.join('')}${value.slice(emitted)}`
}

function redactQuotedJsonCredentialProperties(value: string): string {
  const chunks: string[] = []
  let emitted = 0
  let index = 0
  while (index < value.length) {
    const character = value[index]!
    if (character !== '"' && character !== "'") {
      index += 1
      continue
    }

    const keyEnd = findQuotedSegmentEnd(value, index)
    if (keyEnd === null) {
      // The scanner reached EOF without an unescaped closing delimiter, so
      // every later quote belongs to the same malformed tail.
      break
    }
    const colon = skipWhitespace(value, keyEnd)
    if (value[colon] !== ':') {
      index = keyEnd
      continue
    }
    const valueStart = skipWhitespace(value, colon + 1)
    const valueEnd = findJsonPropertyValueEnd(value, valueStart)
    const key = decodeQuotedJsonPropertyKey(value.slice(index, keyEnd))
    if (key === null || isCredentialPropertyKey(key)) {
      chunks.push(value.slice(emitted, index), '[SECRET_PROPERTY_REDACTED]:[REDACTED]')
      emitted = valueEnd
    }
    index = Math.max(keyEnd, valueEnd)
  }
  return chunks.length === 0 ? value : `${chunks.join('')}${value.slice(emitted)}`
}

/**
 * A separate fail-safe pass for JSON-like text. It does not pair keys or
 * retain quote state: every colon followed by a quoted value is redacted.
 * This remains linear even when an earlier key scanner encounters malformed
 * or stray delimiters.
 */
function redactImmediatelyQuotedPropertyValues(value: string): string {
  const chunks: string[] = []
  let emitted = 0
  let index = 0
  while (index < value.length) {
    const colon = value.indexOf(':', index)
    if (colon < 0) break
    const valueStart = skipWhitespace(value, colon + 1)
    const quote = value[valueStart]
    if (quote !== '"' && quote !== "'") {
      index = colon + 1
      continue
    }

    const valueEnd = findQuotedSegmentEnd(value, valueStart)
    chunks.push(value.slice(emitted, valueStart), '[REDACTED]')
    if (valueEnd === null) {
      emitted = value.length
      break
    }
    emitted = valueEnd
    index = valueEnd
  }
  return chunks.length === 0 ? value : `${chunks.join('')}${value.slice(emitted)}`
}

/**
 * Canonical strict sanitizer for all audit-facing text. It removes secret
 * values, arbitrary environment assignments, endpoints/ports, and local
 * filesystem locations before a finding can be fingerprinted, persisted, or
 * returned through a future RPC boundary.
 */
export function sanitizeSecurityText(value: string, options: SecurityRedactionOptions = {}): string {
  let sanitized = redactExactValues(value, options.secrets ?? [], '[REDACTED]')
  sanitized = redactExactValues(sanitized, options.paths ?? [], '[PATH_REDACTED]')
  // First redact every immediately quoted JSON-like value independently of
  // key pairing, then perform canonical key redaction before and after
  // unwrapping escaped JSON delimiters.
  sanitized = redactImmediatelyQuotedPropertyValues(sanitized)
  sanitized = redactQuotedJsonCredentialProperties(sanitized)
  sanitized = sanitized.replace(/\\(["'])/g, '$1')
  sanitized = redactImmediatelyQuotedPropertyValues(sanitized)
  sanitized = redactQuotedJsonCredentialProperties(sanitized)

  // A diagnostic must never turn an arbitrary environment entry into a UI,
  // snapshot, or telemetry value. Remove the name as well as the value.
  sanitized = sanitized.replace(
    /(^|[\s,;])(?:[A-Za-z_][A-Za-z0-9_]{0,127})\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/g,
    '$1[ENV_REDACTED]',
  )
  sanitized = sanitized.replace(/\b(?:https?|wss?|file):\/\/[^\s'"<>]+/gi, '[ENDPOINT_REDACTED]')
  sanitized = sanitized.replace(
    /\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,63}:\d{1,5}\b/g,
    '[ENDPOINT_REDACTED]',
  )
  sanitized = sanitized.replace(
    /(?:\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3})\b|\[[0-9A-Fa-f:]+\]|\b(?:[A-Za-z0-9-]+\.)+(?:com|net|org|io|ai|dev|app|co|edu|gov|local|test|internal)\b)(?::\d{1,5})?/gi,
    '[ENDPOINT_REDACTED]',
  )
  sanitized = sanitized.replace(
    /\b(?:port|cdp[_-]?port|gateway[_-]?port)(?:\s*[:=]\s*|\s+)\d{1,5}\b/gi,
    '[PORT_REDACTED]',
  )
  sanitized = sanitized.replace(/\bBearer\s+[-._~+/=A-Za-z0-9]{8,}\b/gi, 'Bearer [REDACTED]')
  sanitized = sanitized.replace(
    /\b(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*["']?[-._~+/=A-Za-z0-9]{8,}/gi,
    '$1=[REDACTED]',
  )
  sanitized = sanitized.replace(
    /\b(?:sk|pk|rk|ghp|gho|github_pat|xox[a-z]|AKIA|AIza)[-_A-Za-z0-9]{8,}\b/gi,
    '[REDACTED]',
  )
  // Secret-bearing assignment and property keys may follow punctuation, where
  // the broad environment matcher above intentionally does not apply.
  sanitized = redactSecretBearingAssignments(sanitized)
  sanitized = sanitized.replace(
    /(?:^|\s)(?:\/(?:Users|home|private|var|tmp|etc|opt|usr|Library|Applications|Volumes|mnt|srv|data)(?:\/[A-Za-z0-9._~@%+=,:;()\[\]-]+)+)/g,
    match => `${match.startsWith(' ') ? ' ' : ''}[PATH_REDACTED]`,
  )
  sanitized = sanitized.replace(
    /(^|[\s"'(])\/(?:[A-Za-z0-9._~@%+=,:;()\[\]-]+\/)*[A-Za-z0-9._~@%+=,:;()\[\]-]+/g,
    '$1[PATH_REDACTED]',
  )
  sanitized = sanitized.replace(
    /(^|[\s"'(])(?:~\/|\.\.?\/)(?:[A-Za-z0-9._~@%+=,:;()\[\]-]+\/)*[A-Za-z0-9._~@%+=,:;()\[\]-]+/g,
    '$1[PATH_REDACTED]',
  )
  sanitized = sanitized.replace(
    /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\?)+/g,
    '[PATH_REDACTED]',
  )
  return sanitized
}

/** Backward-compatible name for the canonical strict sanitizer. */
export const redactSecurityText = sanitizeSecurityText

function normaliseFingerprintText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** Stable SHA-256 fingerprint for matching a standing finding across runs. */
export function fingerprintSecurityFinding(input: FingerprintSecurityFindingInput): string {
  const canonical = [
    input.source,
    normaliseFingerprintText(input.checkId).toLowerCase(),
    normaliseFingerprintText(sanitizeSecurityText(input.title)),
    normaliseFingerprintText(sanitizeSecurityText(input.detail)),
    normaliseFingerprintText(input.remediation === null ? null : sanitizeSecurityText(input.remediation)),
  ].join('\u0000')
  return createHash('sha256').update(canonical, 'utf8').digest('base64url')
}

/**
 * Maps the documented OpenClaw check families to Craft's seven dashboard
 * segments. New or plugin-provided identifiers fail closed to `other`.
 */
export function mapOpenClawCheckIdToDomain(checkId: string): SecurityDomain {
  const value = checkId.trim().toLowerCase()

  if (
    value.startsWith('session.') ||
    value.startsWith('hooks.default_session') ||
    value.startsWith('hooks.request_session') ||
    value.includes('.scope_main_multiuser')
  ) return 'sessions'

  if (value.startsWith('tools.') || value.startsWith('gateway.tools_') || value.startsWith('gateway.nodes.')) return 'tools'

  if (
    value.startsWith('config.secrets.') ||
    value.startsWith('hooks.token') ||
    value.startsWith('gateway.token') ||
    value.startsWith('fs.auth_profiles.') ||
    value.startsWith('fs.credentials') ||
    value.startsWith('fs.config.') ||
    value.startsWith('fs.config_include.')
  ) return 'secrets'

  if (value.startsWith('plugins.') || value.startsWith('skills.')) return 'extensions'

  if (
    value.startsWith('sandbox.') ||
    value.startsWith('fs.') ||
    value.startsWith('security.trust_model.') ||
    value.startsWith('models.') ||
    value.startsWith('config.insecure_')
  ) return 'isolation'

  if (value.startsWith('channels.') || value.startsWith('hooks.') || value.startsWith('security.exposure.')) return 'ingress'

  if (value.startsWith('gateway.') || value.startsWith('browser.') || value.startsWith('discovery.')) return 'network'

  return 'other'
}

function parseTimestamp(value: unknown): number | undefined | null {
  if (value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseSummary(value: unknown): Readonly<Partial<Record<AuditSeverity, number>>> | null {
  if (!isPlainRecord(value)) return null
  const summary: Partial<Record<AuditSeverity, number>> = {}
  for (const severity of AUDIT_SEVERITIES) {
    const count = value[severity]
    if (count === undefined) continue
    if (!Number.isSafeInteger(count) || (count as number) < 0) return null
    summary[severity] = count as number
  }
  return summary
}

function parseFinding(value: unknown): OpenClawAuditFinding | null {
  if (!isPlainRecord(value)) return null
  const { checkId, severity, title, detail, remediation } = value
  if (
    typeof checkId !== 'string' ||
    checkId.length === 0 ||
    checkId.length > MAX_CHECK_ID_LENGTH ||
    !CHECK_ID_PATTERN.test(checkId) ||
    !isAuditSeverity(severity) ||
    typeof title !== 'string' ||
    title.length > MAX_FINDING_TEXT_LENGTH ||
    typeof detail !== 'string' ||
    detail.length > MAX_FINDING_TEXT_LENGTH ||
    (remediation !== null && (typeof remediation !== 'string' || remediation.length > MAX_FINDING_TEXT_LENGTH))
  ) return null

  return {
    checkId,
    severity,
    title: sanitizeSecurityText(title),
    detail: sanitizeSecurityText(detail),
    remediation: remediation === null ? null : sanitizeSecurityText(remediation),
  }
}

function parseFindingList(value: unknown): readonly OpenClawAuditFinding[] | null {
  if (!Array.isArray(value) || value.length > MAX_AUDIT_FINDINGS) return null
  const findings: OpenClawAuditFinding[] = []
  for (const candidate of value) {
    const parsed = parseFinding(candidate)
    if (!parsed) return null
    findings.push(parsed)
  }
  return findings
}

/**
 * Extracts only the allowlisted JSON shape emitted by `security audit --json`.
 * Unknown top-level and finding fields, including secret diagnostics and raw
 * stderr, are deliberately not represented in the result.
 */
export function parseOpenClawAuditJson(raw: string): OpenClawAuditParseResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_AUDIT_JSON_BYTES) return safeAuditError()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return safeAuditError()
  }
  if (!isPlainRecord(parsed)) return safeAuditError()

  const summary = parseSummary(parsed.summary)
  const findings = parseFindingList(parsed.findings)
  const suppressedFindings = parsed.suppressedFindings === undefined
    ? []
    : parseFindingList(parsed.suppressedFindings)
  const timestamp = parseTimestamp(parsed.ts)
  if (!summary || !findings || !suppressedFindings || timestamp === null) return safeAuditError()

  const report: OpenClawAuditReport = {
    ...(timestamp === undefined ? {} : { timestamp }),
    summary,
    findings,
    suppressedFindings,
  }
  return { ok: true, report }
}

export function normaliseOpenClawFinding(
  finding: OpenClawAuditFinding,
  detectedAt: number,
  redaction: SecurityRedactionOptions = {},
): SecurityFinding {
  const title = redactSecurityText(finding.title, redaction)
  const detail = redactSecurityText(finding.detail, redaction)
  const remediation = finding.remediation === null ? null : redactSecurityText(finding.remediation, redaction)
  return {
    fingerprint: fingerprintSecurityFinding({
      source: 'openclaw',
      checkId: finding.checkId,
      title,
      detail,
      remediation,
    }),
    source: 'openclaw',
    checkId: finding.checkId,
    domain: mapOpenClawCheckIdToDomain(finding.checkId),
    severity: finding.severity,
    title,
    detail,
    remediation,
    detectedAt,
  }
}

export function applyRiskAcceptance(
  acceptance: Pick<SecurityFindingAcceptance, 'rationale' | 'expiresAt'>,
  now: number,
): SecurityFindingAcceptance {
  return {
    rationale: acceptance.rationale,
    expiresAt: acceptance.expiresAt,
    expired: acceptance.expiresAt <= now,
  }
}

export const OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES = MAX_AUDIT_JSON_BYTES
