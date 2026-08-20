import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  fingerprintSecurityFinding,
  type OpenClawRuntimeStatus,
  type SecurityAuditSnapshot,
} from '@craft-agent/shared/openclaw'
import {
  CraftSecurityCollector,
  OpenClawSecurityCollector,
  type OpenClawAuditRuntimeProvider,
  type OpenClawAuditRunner,
} from '../collectors.ts'
import {
  OpenClawRiskAcceptanceStore,
  OpenClawSnapshotStore,
} from '../persistence.ts'
import { OpenClawSecurityAuditService } from '../audit-service.ts'
import {
  QUOTED_SECRET_RISK_RATIONALE,
  TOKEN_AND_PATH_AUDIT_JSON,
  VALID_DEEP_AUDIT_JSON,
} from './audit-fixtures.ts'

const NOW = 1_786_276_800_000
const DAY = 24 * 60 * 60 * 1000
const QUOTED_SECRET_VALUES = [
  'fixture_secret_abcdefghijklmnopqrstuvwxyz',
  'dotted_token_abcdefghijklmnopqrstuvwxyz',
  'unicode_token_abcdefghijklmnopqrstuvwxyz',
  'credential-value-abcdefghijklmnopqrstuvwxyz',
  'opaque-token-abcdefghijklmnopqrstuvwxyz',
]
const QUOTED_SECRET_FRAGMENTS = [
  ...QUOTED_SECRET_VALUES,
  'OPENCLAW_GATEWAY_TOKEN',
  'gateway.token',
  'gate\\u0077ay\\u002etoken',
]
const SNAPSHOT_DETAIL = 'Bearer fixture-token-abcdefghijklmnopqrstuvwxyz at /private/tmp/runtime https://127.0.0.1:49200/control port=49200 OPENCLAW_GATEWAY_TOKEN=fixture_secret_abcdefghijklmnopqrstuvwxyz (OPENCLAW_GATEWAY_TOKEN=plainsecret)'

function runtime(overrides: Partial<OpenClawRuntimeStatus> = {}): OpenClawRuntimeStatus {
  return {
    runtimeId: 'openclaw_runtime_test',
    workspaceId: 'workspace-test',
    state: 'provisioned',
    managed: true,
    version: '2026.7.1-2',
    ...overrides,
  }
}

function snapshot(index: number, completedAt = NOW): SecurityAuditSnapshot {
  return {
    id: `snapshot-${index}`,
    runtimeId: 'openclaw_runtime_test',
    workspaceId: 'workspace-test',
    mode: 'standard',
    startedAt: completedAt - 1,
    completedAt,
    coverage: { craft: 'checked', openclaw: 'checked', deep: 'not-requested' },
    runtime: runtime(),
    summary: { critical: 0, warn: 1, info: 0, pass: 0, unavailable: 0 },
    domains: [{ domain: 'extensions', severity: 'warn', findingCount: 1, coverage: 'complete' }],
    findings: [{
      fingerprint: fingerprintSecurityFinding({
        source: 'openclaw',
        checkId: 'plugins.code_safety',
        title: 'Plugin finding',
        detail: SNAPSHOT_DETAIL,
        remediation: null,
      }),
      source: 'openclaw',
      checkId: 'plugins.code_safety',
      domain: 'extensions',
      severity: 'warn',
      title: 'Plugin finding',
      detail: SNAPSHOT_DETAIL,
      remediation: null,
      detectedAt: completedAt,
    }],
  }
}

describe('OpenClaw audit collectors', () => {
  it('collects only metadata-safe Craft posture and never projects credential values', async () => {
    const collector = new CraftSecurityCollector({
      inspect: async () => ({
        permissionMode: 'allow-all',
        extensions: [{ id: 'example.extension', enabled: true, capabilityClasses: ['filesystem', 'network'] }],
        credentialHealth: {
          healthy: false,
          issues: [{ type: 'decryption_failed' }],
        },
        server: { bind: 'all', tls: false, insecure: true },
        toolchain: { openclaw: 'unsupported' },
      }),
    })

    const result = await collector.collect('workspace-test', NOW)
    expect(result.coverage).toBe('checked')
    expect(result.findings.map(finding => finding.checkId)).toEqual(expect.arrayContaining([
      'craft.permissions.allow_all',
      'craft.extensions.example.extension.high_risk_capability',
      'craft.credentials.decryption_failed',
      'craft.server.bind.non_loopback',
      'craft.server.tls.disabled',
      'craft.toolchain.openclaw.unsupported',
    ]))
    expect(JSON.stringify(result)).not.toContain('value')
  })

  it('runs the exact standard command through a managed launcher and returns only redacted normalized findings', async () => {
    const requests: unknown[] = []
    const provider: OpenClawAuditRuntimeProvider = {
      async getAuditRuntime() {
        return {
          runtime: runtime(),
          cwd: '/private/tmp/openclaw/workspace',
          configPath: '/private/tmp/openclaw/config/openclaw.json',
          statePath: '/private/tmp/openclaw/state',
        }
      },
    }
    const runner: OpenClawAuditRunner = {
      async run(request) {
        requests.push(request)
        return { exitCode: 0, stdout: TOKEN_AND_PATH_AUDIT_JSON }
      },
    }
    const collector = new OpenClawSecurityCollector({
      runtimeProvider: provider,
      resolveManagedLauncher: async () => ({
        executablePath: '/managed/node',
        argsPrefix: ['/managed/openclaw/openclaw.mjs'] as const,
        version: '2026.7.1-2' as const,
      }),
      runner,
      now: () => NOW,
    })

    const result = await collector.collect('workspace-test', 'standard')
    expect(result.coverage).toBe('checked')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.domain).toBe('extensions')
    expect(JSON.stringify(result)).not.toContain('fixture-token-abcdefghijklmnopqrstuvwxyz')
    expect(JSON.stringify(result)).not.toContain('/private/tmp/openclaw')
    expect(JSON.stringify(result)).not.toContain('OPENCLAW_GATEWAY_TOKEN')
    expect(JSON.stringify(result)).not.toContain('https://127.0.0.1:49200/control')
    expect(JSON.stringify(result)).not.toContain('49200')
    expect(requests).toEqual([expect.objectContaining({
      executablePath: '/managed/node',
      args: ['/managed/openclaw/openclaw.mjs', 'security', 'audit', '--json'],
      shell: false,
    })])
  })

  it('fails closed as unsupported on Windows before resolving or spawning a managed audit', async () => {
    let runtimeCalls = 0
    let launcherCalls = 0
    let runnerCalls = 0
    const collector = new OpenClawSecurityCollector({
      platform: 'win32',
      runtimeProvider: {
        async getAuditRuntime() {
          runtimeCalls += 1
          return null
        },
      },
      resolveManagedLauncher: async () => {
        launcherCalls += 1
        return null
      },
      runner: {
        async run() {
          runnerCalls += 1
          return { exitCode: 0, stdout: '{}' }
        },
      },
    })

    await expect(collector.collect('workspace-test', 'standard')).resolves.toEqual({
      coverage: 'unavailable',
      findings: [],
      suppressedFindingCount: 0,
      error: { code: 'UNSUPPORTED', retryable: false },
    })
    expect(runtimeCalls).toBe(0)
    expect(launcherCalls).toBe(0)
    expect(runnerCalls).toBe(0)
  })

  it('treats deep auditing as a separate explicit command and reports a stopped runtime as unavailable', async () => {
    const commands: readonly string[][] = []
    const runningProvider: OpenClawAuditRuntimeProvider = {
      async getAuditRuntime() {
        return {
          runtime: runtime({ state: 'running' }),
          cwd: '/tmp/workspace',
          configPath: '/tmp/config/openclaw.json',
          statePath: '/tmp/state',
        }
      },
    }
    const runner: OpenClawAuditRunner = {
      async run(request) {
        ;(commands as string[][]).push([...request.args])
        return { exitCode: 0, stdout: VALID_DEEP_AUDIT_JSON }
      },
    }
    const deepCollector = new OpenClawSecurityCollector({
      runtimeProvider: runningProvider,
      resolveManagedLauncher: async () => ({ executablePath: '/managed/node', argsPrefix: ['/managed/cli.mjs'] as const, version: '2026.7.1-2' as const }),
      runner,
      now: () => NOW,
    })
    const deep = await deepCollector.collect('workspace-test', 'deep')
    expect(deep.coverage).toBe('checked')
    expect(commands).toEqual([['/managed/cli.mjs', 'security', 'audit', '--deep', '--json']])

    const stoppedCollector = new OpenClawSecurityCollector({
      runtimeProvider: { async getAuditRuntime() { return { runtime: runtime({ state: 'stopped' }), cwd: '/tmp', configPath: '/tmp/config', statePath: '/tmp/state' } } },
      resolveManagedLauncher: async () => ({ executablePath: '/managed/node', argsPrefix: ['/managed/cli.mjs'] as const, version: '2026.7.1-2' as const }),
      runner,
      now: () => NOW,
    })
    await expect(stoppedCollector.collect('workspace-test', 'deep')).resolves.toMatchObject({
      coverage: 'unavailable',
      error: { code: 'RUNTIME_STOPPED' },
      findings: [],
    })
  })

  it('reports malformed, missing, and oversized managed audit output with controlled codes rather than raw process data', async () => {
    const provider: OpenClawAuditRuntimeProvider = {
      async getAuditRuntime() {
        return { runtime: runtime(), cwd: '/tmp', configPath: '/tmp/config', statePath: '/tmp/state' }
      },
    }
    const launcher = async () => ({ executablePath: '/managed/node', argsPrefix: ['/managed/cli.mjs'] as const, version: '2026.7.1-2' as const })
    const malformed = new OpenClawSecurityCollector({
      runtimeProvider: provider,
      resolveManagedLauncher: launcher,
      runner: { async run() { return { exitCode: 0, stdout: '{bad' } } },
      now: () => NOW,
    })
    await expect(malformed.collect('workspace-test', 'standard')).resolves.toMatchObject({
      coverage: 'failed',
      error: { code: 'AUDIT_OUTPUT_INVALID' },
      findings: [],
    })

    const missing = new OpenClawSecurityCollector({
      runtimeProvider: provider,
      resolveManagedLauncher: async () => null,
      runner: { async run() { throw new Error('must not run') } },
      now: () => NOW,
    })
    await expect(missing.collect('workspace-test', 'standard')).resolves.toMatchObject({
      coverage: 'unavailable',
      error: { code: 'UNSUPPORTED' },
    })

    const oversized = new OpenClawSecurityCollector({
      runtimeProvider: provider,
      resolveManagedLauncher: launcher,
      runner: { async run() { return { exitCode: 0, stdout: 'x'.repeat(1024 * 1024 + 1) } } },
      now: () => NOW,
    })
    await expect(oversized.collect('workspace-test', 'standard')).resolves.toMatchObject({
      coverage: 'failed',
      error: { code: 'AUDIT_OUTPUT_TOO_LARGE' },
    })
  })
})

describe('OpenClaw redacted local persistence', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('redacts punctuation-prefixed secret assignments before snapshot JSONL persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-openclaw-punctuation-redaction-'))
    roots.push(root)
    const store = new OpenClawSnapshotStore(root, { now: () => NOW })

    const saved = await store.save(snapshot(0))
    expect(JSON.stringify(saved)).not.toContain('plainsecret')
    expect(saved.findings[0]?.detail).toContain('[ENV_REDACTED]')

    const persisted = await readFile(join(root, 'snapshots.jsonl'), 'utf8')
    expect(persisted).not.toContain('plainsecret')
    expect(persisted).toContain('[ENV_REDACTED]')
  })

  it('retains at most 30 snapshots and drops records older than 90 days while writing redacted JSONL only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-openclaw-audit-'))
    roots.push(root)
    const store = new OpenClawSnapshotStore(root, { now: () => NOW })

    for (let index = 0; index < 31; index += 1) {
      await store.save(snapshot(index, NOW - index * DAY))
    }
    await store.save(snapshot(99, NOW - 91 * DAY))

    const retained = await store.list()
    expect(retained).toHaveLength(30)
    expect(retained.some(value => value.id === 'snapshot-30')).toBe(false)
    expect(retained.some(value => value.id === 'snapshot-99')).toBe(false)
    const persisted = await readFile(join(root, 'snapshots.jsonl'), 'utf8')
    expect(persisted).not.toContain('fixture-token-abcdefghijklmnopqrstuvwxyz')
    expect(persisted).not.toContain('/private/tmp/runtime')
    expect(persisted).not.toContain('OPENCLAW_GATEWAY_TOKEN')
    expect(persisted).not.toContain('https://127.0.0.1:49200/control')
    expect(persisted).not.toContain('49200')
  })

  it('persists independent local risk acceptance with expiry and validates rationale/date bounds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-openclaw-acceptance-'))
    roots.push(root)
    const store = new OpenClawRiskAcceptanceStore(root, { now: () => NOW })

    const accepted = await store.accept({
      workspaceId: 'workspace-test',
      fingerprint: 'fingerprint-123',
      rationale: QUOTED_SECRET_RISK_RATIONALE,
      expiresAt: NOW + DAY,
    })
    for (const secret of QUOTED_SECRET_FRAGMENTS) expect(accepted.rationale).not.toContain(secret)
    expect(await store.get('workspace-test', 'fingerprint-123', NOW)).toEqual({
      rationale: accepted.rationale,
      expiresAt: NOW + DAY,
      expired: false,
    })
    expect(await store.get('workspace-test', 'fingerprint-123', NOW + DAY + 1)).toEqual({
      rationale: accepted.rationale,
      expiresAt: NOW + DAY,
      expired: true,
    })
    await expect(store.accept({
      workspaceId: 'workspace-test',
      fingerprint: 'fingerprint-123',
      rationale: 'short',
      expiresAt: NOW + DAY,
    })).rejects.toMatchObject({ code: 'RISK_ACCEPTANCE_INVALID' })
    await expect(store.accept({
      workspaceId: 'workspace-test',
      fingerprint: 'fingerprint-123',
      rationale: 'A sufficiently long rationale with an invalid expiry.',
      expiresAt: NOW + 1,
    })).rejects.toMatchObject({ code: 'RISK_ACCEPTANCE_INVALID' })

    const persisted = await readFile(join(root, 'acceptances.json'), 'utf8')
    expect(persisted).not.toContain('security.audit.suppressions')
    for (const secret of QUOTED_SECRET_FRAGMENTS) expect(persisted).not.toContain(secret)
  })

  it('counts persisted risk acceptance rationales by Unicode code point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-openclaw-acceptance-'))
    roots.push(root)
    const store = new OpenClawRiskAcceptanceStore(root, { now: () => NOW })
    const acceptedRationale = '😀'.repeat(251)

    await expect(store.accept({
      workspaceId: 'workspace-test',
      fingerprint: 'fingerprint-123',
      rationale: acceptedRationale,
      expiresAt: NOW + DAY,
    })).resolves.toMatchObject({ rationale: acceptedRationale })
    await expect(store.accept({
      workspaceId: 'workspace-test',
      fingerprint: 'fingerprint-123',
      rationale: '😀'.repeat(501),
      expiresAt: NOW + DAY,
    })).rejects.toMatchObject({ code: 'RISK_ACCEPTANCE_INVALID' })
  })
})

describe('OpenClawSecurityAuditService', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('combines source coverage, applies local acceptance, and persists only a redacted snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-openclaw-audit-service-'))
    roots.push(root)
    const baseFinding = snapshot(1).findings[0]!
    const service = new OpenClawSecurityAuditService({
      runtimeProvider: {
        async getRuntimeStatus() { return runtime() },
        async getAuditRuntime() {
          return {
            runtime: runtime(),
            cwd: '/private/tmp/workspace',
            configPath: '/private/tmp/config',
            statePath: '/private/tmp/state',
            auditDirectory: root,
          }
        },
      },
      craftCollector: {
        async collect() {
          return { coverage: 'checked' as const, findings: [] }
        },
      },
      openClawCollector: {
        async collect() {
          return { coverage: 'checked' as const, findings: [baseFinding], suppressedFindingCount: 0 }
        },
      },
      now: () => NOW,
    })

    await service.acceptRisk({
      workspaceId: 'workspace-test',
      fingerprint: baseFinding.fingerprint,
      rationale: QUOTED_SECRET_RISK_RATIONALE,
      expiresAt: NOW + DAY,
    })
    const result = await service.runAudit('workspace-test', 'standard')

    expect(result.coverage).toEqual({ craft: 'checked', openclaw: 'checked', deep: 'not-requested' })
    expect(result.findings[0]?.acceptance?.expiresAt).toBe(NOW + DAY)
    expect(result.findings[0]?.acceptance?.expired).toBe(false)
    for (const secret of QUOTED_SECRET_FRAGMENTS) expect(result.findings[0]?.acceptance?.rationale).not.toContain(secret)
    expect(await service.getLatestAudit('workspace-test')).toMatchObject({ id: result.id })
    expect((await readFile(join(root, 'snapshots.jsonl'), 'utf8'))).not.toContain('/private/tmp/runtime')
    expect(JSON.stringify(result)).not.toContain('OPENCLAW_GATEWAY_TOKEN')
    expect(JSON.stringify(result)).not.toContain('https://127.0.0.1:49200/control')
    expect(JSON.stringify(result)).not.toContain('49200')
    expect(JSON.stringify(result)).not.toContain('plainsecret')
    const persistedSnapshot = await readFile(join(root, 'snapshots.jsonl'), 'utf8')
    expect(persistedSnapshot).not.toContain('plainsecret')
    for (const secret of QUOTED_SECRET_FRAGMENTS) expect(persistedSnapshot).not.toContain(secret)
  })

  it('delegates application shutdown to the owned audit collector disposer without transport exposure', async () => {
    let disposed = 0
    const service = new OpenClawSecurityAuditService({
      runtimeProvider: {
        async getRuntimeStatus() { return runtime() },
        async getAuditRuntime() { return null },
      },
      craftCollector: { async collect() { return { coverage: 'checked' as const, findings: [] } } },
      openClawCollector: {
        async collect() { return { coverage: 'not-provisioned' as const, findings: [], suppressedFindingCount: 0 } },
        async dispose() { disposed += 1 },
      },
    })

    await service.dispose()
    await service.dispose()
    expect(disposed).toBe(1)
  })
})
