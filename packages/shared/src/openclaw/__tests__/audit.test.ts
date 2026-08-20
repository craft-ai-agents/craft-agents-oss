import { describe, expect, it } from 'bun:test'
import {
  applyRiskAcceptance,
  fingerprintSecurityFinding,
  mapOpenClawCheckIdToDomain,
  normaliseOpenClawFinding,
  parseOpenClawAuditJson,
  redactSecurityText,
  sanitizeSecurityText,
} from '../audit.ts'
import {
  MALFORMED_AUDIT_JSON,
  PUNCTUATED_ENV_ASSIGNMENT_AUDIT_JSON,
  TOKEN_AND_PATH_AUDIT_JSON,
  VALID_DEEP_AUDIT_JSON,
  VALID_STANDARD_AUDIT_JSON,
} from './audit-fixtures.ts'

describe('OpenClaw shared audit domain', () => {
  it('creates a deterministic, detail-sensitive fingerprint without timestamps or severity', () => {
    const base = {
      source: 'openclaw' as const,
      checkId: 'gateway.bind_no_auth',
      title: 'Gateway auth missing',
      detail: 'Gateway is not authenticated',
      remediation: 'Enable token auth',
    }

    expect(fingerprintSecurityFinding(base)).toBe(fingerprintSecurityFinding({ ...base, severity: 'critical' }))
    expect(fingerprintSecurityFinding(base)).not.toBe(fingerprintSecurityFinding({ ...base, detail: 'Another exposure' }))
    expect(fingerprintSecurityFinding(base)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('uses the canonical sanitizer before deriving a finding fingerprint', () => {
    const raw = {
      source: 'openclaw' as const,
      checkId: 'gateway.bind_no_auth',
      title: 'Gateway endpoint found',
      detail: 'https://127.0.0.1:49200/control OPENCLAW_GATEWAY_TOKEN=fixture_secret_abcdefghijklmnopqrstuvwxyz',
      remediation: 'Stop listener on port 49200',
    }
    const sanitized = {
      ...raw,
      detail: redactSecurityText(raw.detail),
      remediation: redactSecurityText(raw.remediation),
    }
    expect(fingerprintSecurityFinding(raw)).toBe(fingerprintSecurityFinding(sanitized))
  })

  it('maps known audit families across the seven domains and retains unknown checkIds as other', () => {
    expect(mapOpenClawCheckIdToDomain('channels.discord.dm.open')).toBe('ingress')
    expect(mapOpenClawCheckIdToDomain('session.dm_scope_main')).toBe('sessions')
    expect(mapOpenClawCheckIdToDomain('tools.exec.security_full_configured')).toBe('tools')
    expect(mapOpenClawCheckIdToDomain('config.secrets.gateway_password_in_config')).toBe('secrets')
    expect(mapOpenClawCheckIdToDomain('gateway.tailscale_funnel')).toBe('network')
    expect(mapOpenClawCheckIdToDomain('plugins.code_safety')).toBe('extensions')
    expect(mapOpenClawCheckIdToDomain('sandbox.dangerous_bind_mount')).toBe('isolation')
    expect(mapOpenClawCheckIdToDomain('future.check.from.a.plugin')).toBe('other')
  })

  it('redacts explicit secret values, token-like text, and absolute paths before values leave the domain', () => {
    const redacted = redactSecurityText(
      'Authorization: Bearer fixture-token-abcdefghijklmnopqrstuvwxyz at /private/tmp/openclaw/config.json, ~/.openclaw/config.json, and C:\\Users\\alice\\secret.txt',
      { secrets: ['fixture-token-abcdefghijklmnopqrstuvwxyz'] },
    )

    expect(redacted).not.toContain('fixture-token-abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain('/private/tmp/openclaw/config.json')
    expect(redacted).not.toContain('C:\\Users\\alice\\secret.txt')
    expect(redacted).not.toContain('~/.openclaw/config.json')
    expect(redacted).toContain('[REDACTED]')
    expect(redacted).toContain('[PATH_REDACTED]')
  })

  it('sanitizes endpoints, ports, and arbitrary environment assignments before parsing or fingerprinting', () => {
    const source = 'OPENCLAW_GATEWAY_TOKEN=fixture_secret_abcdefghijklmnopqrstuvwxyz https://127.0.0.1:49200/control port=49200 api.example.test:8555 listening on port 8555'
    const sanitized = redactSecurityText(source)
    expect(sanitized).not.toContain('OPENCLAW_GATEWAY_TOKEN')
    expect(sanitized).not.toContain('fixture_secret_abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('https://127.0.0.1:49200/control')
    expect(sanitized).not.toContain('49200')
    expect(sanitized).not.toContain('api.example.test')
    expect(sanitized).not.toContain('8555')
    expect(sanitized).toContain('[ENV_REDACTED]')
    expect(sanitized).toContain('[ENDPOINT_REDACTED]')
  })

  it('redacts punctuation-prefixed secret assignments while parsing and normalising findings', () => {
    const source = 'Audit output contained (OPENCLAW_GATEWAY_TOKEN=plainsecret).'
    const sanitized = sanitizeSecurityText(source)
    expect(sanitized).toBe('Audit output contained ([ENV_REDACTED]).')
    expect(sanitizeSecurityText('(version=1)')).toBe('(version=1)')

    const parsed = parseOpenClawAuditJson(PUNCTUATED_ENV_ASSIGNMENT_AUDIT_JSON)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('expected punctuation assignment fixture')

    const parsedFinding = parsed.report.findings[0]!
    expect(JSON.stringify(parsedFinding)).not.toContain('plainsecret')

    const normalised = normaliseOpenClawFinding(parsedFinding, 1_786_276_800_000)
    expect(JSON.stringify(normalised)).not.toContain('plainsecret')
    expect(normalised.detail).toBe(sanitized)
  })

  it('sanitizes quoted JSON-style secret and credential properties', () => {
    const serialized = '{"OPENCLAW_GATEWAY_TOKEN":"fixture_secret_abcdefghijklmnopqrstuvwxyz","apiKey":"api-key-abcdefghijklmnopqrstuvwxyz","value":"credential-value-abcdefghijklmnopqrstuvwxyz"}'
    const escaped = '{\\"token\\":\\"escaped-token-abcdefghijklmnopqrstuvwxyz\\"}'
    const dotted = '{"gateway.token":"dotted-token-abcdefghijklmnopqrstuvwxyz","gate\\u0077ay\\u002etoken":"unicode-token-abcdefghijklmnopqrstuvwxyz"}'
    const singleQuoted = "{'gateway.token':'single-quoted-token-abcdefghijklmnopqrstuvwxyz'}"
    const strayQuote = 'stray "x"token":"opaque-token-abcdefghijklmnopqrstuvwxyz"'
    const sanitized = redactSecurityText(`${serialized} ${escaped} ${dotted} ${singleQuoted} ${strayQuote}`)
    expect(sanitized).not.toContain('fixture_secret_abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('api-key-abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('credential-value-abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('escaped-token-abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('dotted-token-abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('unicode-token-abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('single-quoted-token-abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('opaque-token-abcdefghijklmnopqrstuvwxyz')
    expect(sanitized).not.toContain('gateway.token')
    expect(sanitized).not.toContain('gate\\u0077ay\\u002etoken')
  })

  it('handles an adversarial long-backslash JSON fragment in bounded time', () => {
    const adversarial = `{"gateway.token":"${'\\'.repeat(50_000)}`
    const startedAt = performance.now()
    redactSecurityText(adversarial)
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })

  it('handles repeated unmatched escaped quote delimiters in bounded time', () => {
    const adversarial = '\\"'.repeat(50_000)
    const startedAt = performance.now()
    redactSecurityText(adversarial)
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })

  it('strictly parses only allowed OpenClaw audit fields and discards diagnostics and unknown data', () => {
    const parsed = parseOpenClawAuditJson(VALID_STANDARD_AUDIT_JSON)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('expected valid audit JSON')
    expect(parsed.report.findings).toHaveLength(2)
    expect(parsed.report.findings[0]).toEqual({
      checkId: 'gateway.bind_no_auth',
      severity: 'critical',
      title: 'Gateway is exposed without authentication',
      detail: 'Gateway binds outside loopback.',
      remediation: 'Set gateway.bind to loopback and enable token auth.',
    })
    expect(JSON.stringify(parsed.report)).not.toContain('secretDiagnostics')
    expect(JSON.stringify(parsed.report)).not.toContain('must-not-survive')
    expect(JSON.stringify(parsed.report)).not.toContain('unknownTopLevel')
  })

  it('accepts the separately-audited suppressed finding list without treating it as active findings', () => {
    const parsed = parseOpenClawAuditJson(VALID_DEEP_AUDIT_JSON)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('expected valid deep audit JSON')
    expect(parsed.report.findings).toHaveLength(1)
    expect(parsed.report.suppressedFindings).toHaveLength(1)
    expect(parsed.report.suppressedFindings[0]?.checkId).toBe('security.audit.suppressions.active')
  })

  it('rejects malformed and schema-invalid audit output without preserving raw text', () => {
    expect(parseOpenClawAuditJson(MALFORMED_AUDIT_JSON)).toEqual({
      ok: false,
      error: { code: 'AUDIT_OUTPUT_INVALID', retryable: false },
    })
    expect(parseOpenClawAuditJson('{"summary":{},"findings":[{"checkId":"x"}]}')).toEqual({
      ok: false,
      error: { code: 'AUDIT_OUTPUT_INVALID', retryable: false },
    })
  })

  it('redacts parsed finding text before fingerprinting and supports expiry-aware local acceptance', () => {
    const parsed = parseOpenClawAuditJson(TOKEN_AND_PATH_AUDIT_JSON)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('expected valid redaction fixture')

    const finding = parsed.report.findings[0]!
    const serialized = JSON.stringify(finding)
    expect(serialized).not.toContain('fixture_secret_abcdefghijklmnopqrstuvwxyz')
    expect(serialized).not.toContain('/private/tmp/openclaw')
    expect(serialized).not.toContain('OPENCLAW_GATEWAY_TOKEN')
    expect(serialized).not.toContain('https://127.0.0.1:49200/control')
    expect(serialized).not.toContain('49200')

    const now = 1_786_276_800_000
    expect(applyRiskAcceptance({ rationale: 'Documented accepted risk', expiresAt: now + 1 }, now)).toEqual({
      rationale: 'Documented accepted risk',
      expiresAt: now + 1,
      expired: false,
    })
    expect(applyRiskAcceptance({ rationale: 'Expired accepted risk', expiresAt: now - 1 }, now)).toEqual({
      rationale: 'Expired accepted risk',
      expiresAt: now - 1,
      expired: true,
    })
  })
})
