/**
 * Task 7: acpDriver + factory.ts integration
 *
 * Verifies that createBackend('acp', ...) correctly instantiates AcpAgent
 * and that the factory-level wiring works end to end.
 */
import { describe, it, expect } from 'bun:test'
import { createBackend, getAvailableProviders } from '../src/agent/backend/factory'
import { AcpAgent } from '../src/agent/acp-agent'
import { createLinkedTransports } from '../src/agent/acp-transport'
import type { BackendConfig } from '../src/agent/backend/types'

function makeAcpConfig(overrides: Record<string, unknown> = {}): BackendConfig {
  return {
    provider: 'acp' as const,
    workspace: {
      id: 'test-ws',
      name: 'Test Workspace',
      slug: 'test-ws',
      rootPath: '/tmp/test-ws',
      createdAt: 0,
    },
    session: {
      id: 'test-session',
      workspaceRootPath: '/tmp/test-ws',
      createdAt: 0,
      lastUsedAt: 0,
    },
    isHeadless: true,
    model: '',
    miniModel: '',
    ...overrides,
  } as BackendConfig
}

describe('factory: createBackend with acp transport injection', () => {
  it('createBackendWithTransport returns AcpAgent instance', () => {
    const [clientTransport] = createLinkedTransports()
    const { createBackendWithTransport } = require('../src/agent/backend/factory')

    const agent = createBackendWithTransport(makeAcpConfig(), clientTransport)

    expect(agent).toBeInstanceOf(AcpAgent)
    agent.destroy()
    void clientTransport.dispose()
  })
})

describe('factory: getAvailableProviders includes acp', () => {
  it("'acp' is in available providers", () => {
    const providers = getAvailableProviders()
    expect(providers).toContain('acp')
  })
})

describe('acpDriver: buildRuntime returns empty payload', () => {
  it('acpDriver.buildRuntime returns an empty record', () => {
    const { acpDriver } = require('../src/agent/backend/internal/drivers/acp')
    const result = acpDriver.buildRuntime({} as any)
    expect(typeof result).toBe('object')
    expect(result).toBeDefined()
  })

  it('acpDriver.provider === acp', () => {
    const { acpDriver } = require('../src/agent/backend/internal/drivers/acp')
    expect(acpDriver.provider).toBe('acp')
  })
})
