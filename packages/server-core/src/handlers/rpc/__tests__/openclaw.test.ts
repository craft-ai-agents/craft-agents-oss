import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  AcceptSecurityRiskRequest,
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
} from '@craft-agent/shared/openclaw'
import type { HandlerDeps, OpenClawSecurityService } from '../../handler-deps'
import { HANDLED_CHANNELS, registerOpenClawHandlers } from '../openclaw'
import type { RequestContext, RpcServer } from '../../../transport/types'

type Handler = (context: RequestContext, input?: unknown) => unknown | Promise<unknown>

const WORKSPACE_ID = 'workspace-test'
const DAY_MS = 24 * 60 * 60 * 1000

function runtimeStatus(workspaceId = WORKSPACE_ID): OpenClawRuntimeStatus {
  return {
    runtimeId: 'runtime_test_1',
    workspaceId,
    state: 'stopped',
    version: '1.2.3',
    managed: true,
    lastHealthAt: 1_700_000_000_000,
  }
}

function auditSnapshot(workspaceId = WORKSPACE_ID): SecurityAuditSnapshot {
  return {
    id: 'audit_test_1',
    runtimeId: 'runtime_test_1',
    workspaceId,
    mode: 'standard',
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_000_100,
    coverage: {
      craft: 'checked',
      openclaw: 'not-provisioned',
      deep: 'not-requested',
    },
    runtime: runtimeStatus(workspaceId),
    summary: {
      critical: 0,
      warn: 0,
      info: 0,
      pass: 1,
      unavailable: 0,
    },
    domains: [
      { domain: 'ingress', severity: 'pass', findingCount: 0, coverage: 'complete' },
    ],
    findings: [
      {
        fingerprint: 'finding_12345678',
        source: 'craft',
        checkId: 'craft.ingress.loopback',
        domain: 'ingress',
        severity: 'pass',
        title: 'Loopback only',
        detail: 'The managed runtime has no public listener.',
        remediation: null,
        detectedAt: 1_700_000_000_000,
      },
    ],
  }
}

function createService(overrides: Partial<OpenClawSecurityService> = {}) {
  const calls: Array<{ method: string; input: unknown }> = []
  const service: OpenClawSecurityService = {
    getRuntimeStatus: async input => {
      calls.push({ method: 'getRuntimeStatus', input })
      return runtimeStatus(input.workspaceId)
    },
    installRuntime: async input => {
      calls.push({ method: 'installRuntime', input })
      return runtimeStatus(input.workspaceId)
    },
    provisionRuntime: async input => {
      calls.push({ method: 'provisionRuntime', input })
      return runtimeStatus(input.workspaceId)
    },
    startRuntime: async input => {
      calls.push({ method: 'startRuntime', input })
      return runtimeStatus(input.workspaceId)
    },
    stopRuntime: async input => {
      calls.push({ method: 'stopRuntime', input })
      return runtimeStatus(input.workspaceId)
    },
    runAudit: async input => {
      calls.push({ method: 'runAudit', input })
      return { ...auditSnapshot(input.workspaceId), mode: input.mode }
    },
    getLatestAudit: async input => {
      calls.push({ method: 'getLatestAudit', input })
      return auditSnapshot(input.workspaceId)
    },
    acceptRisk: async input => {
      calls.push({ method: 'acceptRisk', input })
    },
    revokeRiskAcceptance: async input => {
      calls.push({ method: 'revokeRiskAcceptance', input })
    },
    ...overrides,
  }
  return { service, calls }
}

function createHarness(
  openClawSecurity?: OpenClawSecurityService,
  windowWorkspaceId?: string,
) {
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  }
  const deps = {
    openClawSecurity,
    ...(windowWorkspaceId
      ? { windowManager: { getWorkspaceForWindow: () => windowWorkspaceId } }
      : {}),
  } as HandlerDeps
  registerOpenClawHandlers(server as unknown as RpcServer, deps)

  async function invoke(
    channel: string,
    input: unknown,
    context: RequestContext = {
      clientId: 'test-client',
      workspaceId: WORKSPACE_ID,
      webContentsId: null,
    },
  ): Promise<unknown> {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing handler for ${channel}`)
    return handler(context, input)
  }

  return { handlers, invoke }
}

describe('OpenClaw security RPC handlers', () => {
  const EXPECTED_CHANNELS = [
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

  it('registers the same data-only channel profile with and without the host service', () => {
    const headless = createHarness()
    const hosted = createHarness(createService().service)

    expect([...HANDLED_CHANNELS]).toEqual([...EXPECTED_CHANNELS])
    expect([...headless.handlers.keys()]).toEqual([...EXPECTED_CHANNELS])
    expect([...hosted.handlers.keys()]).toEqual([...EXPECTED_CHANNELS])
  })

  it('returns a controlled unsupported error when the optional host service is absent', async () => {
    const { invoke } = createHarness()

    await expect(invoke(RPC_CHANNELS.openclawRuntime.GET_STATUS, { workspaceId: WORKSPACE_ID }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    await expect(invoke(RPC_CHANNELS.securityAudit.RUN, { workspaceId: WORKSPACE_ID, mode: 'standard' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('authorizes the requested workspace against the caller workspace before invoking the service', async () => {
    const { service, calls } = createService()
    const { invoke } = createHarness(service)

    await expect(invoke(
      RPC_CHANNELS.openclawRuntime.GET_STATUS,
      { workspaceId: 'workspace-other' },
    )).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(calls).toEqual([])

    const fallback = createHarness(service, WORKSPACE_ID)
    await fallback.invoke(
      RPC_CHANNELS.openclawRuntime.GET_STATUS,
      { workspaceId: WORKSPACE_ID },
      { clientId: 'test-client', workspaceId: null, webContentsId: 42 },
    )
    expect(calls).toContainEqual({
      method: 'getRuntimeStatus',
      input: { workspaceId: WORKSPACE_ID },
    })
  })

  it('validates exact request shapes and risk acceptance bounds before service invocation', async () => {
    const { service, calls } = createService()
    const { invoke } = createHarness(service)
    const expiry = Date.now() + 2 * DAY_MS

    await expect(invoke(
      RPC_CHANNELS.openclawRuntime.START,
      { workspaceId: WORKSPACE_ID, argv: ['gateway', 'run'] },
    )).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(invoke(
      RPC_CHANNELS.securityAudit.RUN,
      { workspaceId: WORKSPACE_ID, mode: 'unsafe', endpoint: 'http://127.0.0.1:1' },
    )).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(invoke(
      RPC_CHANNELS.securityAudit.ACCEPT_RISK,
      {
        workspaceId: WORKSPACE_ID,
        fingerprint: 'finding_12345678',
        rationale: 'short',
        expiresAt: expiry,
      },
    )).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(invoke(
      RPC_CHANNELS.securityAudit.ACCEPT_RISK,
      {
        workspaceId: WORKSPACE_ID,
        fingerprint: 'finding_12345678',
        rationale: 'A documented, time-bound local operator exception.',
        expiresAt: Date.now() + 1,
        token: 'must-not-cross-the-boundary',
      },
    )).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(invoke(
      RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE,
      { workspaceId: WORKSPACE_ID, fingerprint: 'short' },
    )).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(calls).toEqual([])
  })

  it('counts risk acceptance rationales by Unicode code point', async () => {
    const { service, calls } = createService()
    const { invoke } = createHarness(service)
    const expiry = Date.now() + 2 * DAY_MS
    const acceptedRationale = '😀'.repeat(251)

    await invoke(RPC_CHANNELS.securityAudit.ACCEPT_RISK, {
      workspaceId: WORKSPACE_ID,
      fingerprint: 'finding_12345678',
      rationale: acceptedRationale,
      expiresAt: expiry,
    })
    await expect(invoke(RPC_CHANNELS.securityAudit.ACCEPT_RISK, {
      workspaceId: WORKSPACE_ID,
      fingerprint: 'finding_12345678',
      rationale: '😀'.repeat(501),
      expiresAt: expiry,
    })).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(calls).toEqual([{
      method: 'acceptRisk',
      input: {
        workspaceId: WORKSPACE_ID,
        fingerprint: 'finding_12345678',
        rationale: acceptedRationale,
        expiresAt: expiry,
      },
    }])
  })

  it('passes only validated data inputs to the narrow safe service', async () => {
    const { service, calls } = createService()
    const { invoke } = createHarness(service)
    const accept: AcceptSecurityRiskRequest = {
      workspaceId: WORKSPACE_ID,
      fingerprint: 'finding_12345678',
      rationale: 'A documented, time-bound local operator exception.',
      expiresAt: Date.now() + 2 * DAY_MS,
    }

    await invoke(RPC_CHANNELS.openclawRuntime.INSTALL, { workspaceId: WORKSPACE_ID })
    await invoke(RPC_CHANNELS.openclawRuntime.PROVISION, { workspaceId: WORKSPACE_ID })
    await invoke(RPC_CHANNELS.openclawRuntime.START, { workspaceId: WORKSPACE_ID })
    await invoke(RPC_CHANNELS.openclawRuntime.STOP, { workspaceId: WORKSPACE_ID })
    await invoke(RPC_CHANNELS.securityAudit.RUN, { workspaceId: WORKSPACE_ID, mode: 'deep' satisfies AuditMode })
    await invoke(RPC_CHANNELS.securityAudit.GET_LATEST, { workspaceId: WORKSPACE_ID })
    await invoke(RPC_CHANNELS.securityAudit.ACCEPT_RISK, accept)
    await invoke(RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE, {
      workspaceId: WORKSPACE_ID,
      fingerprint: accept.fingerprint,
    })

    expect(calls).toEqual([
      { method: 'installRuntime', input: { workspaceId: WORKSPACE_ID } },
      { method: 'provisionRuntime', input: { workspaceId: WORKSPACE_ID } },
      { method: 'startRuntime', input: { workspaceId: WORKSPACE_ID } },
      { method: 'stopRuntime', input: { workspaceId: WORKSPACE_ID } },
      { method: 'runAudit', input: { workspaceId: WORKSPACE_ID, mode: 'deep' } },
      { method: 'getLatestAudit', input: { workspaceId: WORKSPACE_ID } },
      { method: 'acceptRisk', input: accept },
      {
        method: 'revokeRiskAcceptance',
        input: { workspaceId: WORKSPACE_ID, fingerprint: accept.fingerprint },
      },
    ])
  })

  it('projects service responses through an allowlist before remote serialization', async () => {
    const unsafeRuntime = {
      ...runtimeStatus(),
      token: 'gateway-token-must-never-serialize',
      endpoint: 'http://127.0.0.1:32123',
      port: 32123,
      path: '/private/runtime/config.json',
      runtimeConfig: { gateway: { token: 'gateway-token-must-never-serialize' } },
      argv: ['gateway', 'run'],
      environment: { OPENCLAW_GATEWAY_TOKEN: 'gateway-token-must-never-serialize' },
      browserUrl: 'http://127.0.0.1:32123/setup',
    } as unknown as OpenClawRuntimeStatus
    const unsafeSnapshot = {
      ...auditSnapshot(),
      runtime: unsafeRuntime,
      rawOutput: 'gateway-token-must-never-serialize',
      findings: [
        {
          ...auditSnapshot().findings[0]!,
          detail: 'Bearer gateway-token-must-never-serialize at /run/openclaw/config.json via [::1]:32123',
          endpoint: 'http://127.0.0.1:32123',
          subprocessOutput: 'gateway-token-must-never-serialize',
        },
      ],
    } as unknown as SecurityAuditSnapshot
    const { service } = createService({
      getRuntimeStatus: async () => unsafeRuntime,
      runAudit: async () => unsafeSnapshot,
    })
    const { invoke } = createHarness(service)

    const status = await invoke(
      RPC_CHANNELS.openclawRuntime.GET_STATUS,
      { workspaceId: WORKSPACE_ID },
    ) as Record<string, unknown>
    const snapshot = await invoke(
      RPC_CHANNELS.securityAudit.RUN,
      { workspaceId: WORKSPACE_ID, mode: 'standard' },
    ) as Record<string, unknown>
    const serialized = JSON.stringify({ status, snapshot })

    expect(status).not.toHaveProperty('token')
    expect(status).not.toHaveProperty('endpoint')
    expect(status).not.toHaveProperty('port')
    expect(status).not.toHaveProperty('path')
    expect(status).not.toHaveProperty('runtimeConfig')
    expect(status).not.toHaveProperty('argv')
    expect(status).not.toHaveProperty('environment')
    expect(status).not.toHaveProperty('browserUrl')
    expect((snapshot.runtime as Record<string, unknown>)).not.toHaveProperty('token')
    expect((snapshot.findings as Array<Record<string, unknown>>)[0]).not.toHaveProperty('endpoint')
    expect(serialized).not.toContain('gateway-token-must-never-serialize')
    expect(serialized).not.toContain('127.0.0.1:32123')
    expect(serialized).not.toContain('/run/openclaw/config.json')
    expect(serialized).not.toContain('[::1]:32123')
  })
})
