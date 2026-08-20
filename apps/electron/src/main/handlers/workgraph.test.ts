import { describe, expect, it } from 'bun:test'

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcHandlerOptions, RpcServer } from '@craft-agent/server-core/transport'
import type { WorkGraphHealth, WorkGraphKernel } from '@craft-agent/server-core/workgraph'

import { HANDLED_CHANNELS, registerWorkGraphHandlers } from './workgraph'

describe('WorkGraph handler profile', () => {
  it('registers health and connection channels with the trusted local-Electron fence', async () => {
    const registrations = new Map<string, RpcHandlerOptions | undefined>()
    const handlers = new Map<string, (...args: never[]) => unknown>()
    const server: RpcServer = {
      handle(channel, handler, options) {
        registrations.set(channel, options)
        handlers.set(channel, handler as (...args: never[]) => unknown)
      },
      push() {},
      async invokeClient() { return undefined },
      hasClientCapability() { return false },
      findClientsWithCapability() { return [] },
    }
    const health: WorkGraphHealth = {
      state: 'unavailable',
      platform: 'darwin/arm64',
      reason: 'unsupported-platform',
    }
    const created = {
      id: 'conn-1',
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      storageMode: 'copy' as const,
      scopes: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const workGraph: Pick<WorkGraphKernel, 'getHealth' | 'getVersion' | 'listConnections' | 'listConnectionAudit' | 'listConnectionBindings' | 'convertConnectionToReference' | 'revokeConnectionBinding' | 'getConnection' | 'createConnection' | 'bindConsumer' | 'appendConnectionAudit' | 'affectedClosure'> = {
      async getHealth() { return health },
      async getVersion() { return { state: health.state, schemaVersion: 0 } },
      async listConnections() { return [created] },
      async listConnectionAudit() { return [] },
      async listConnectionBindings() { return [] },
      async convertConnectionToReference() { return { ...created, storageMode: 'reference' as const } },
      async revokeConnectionBinding() {
        return { id: 'bind-1', connectionId: created.id, consumerId: 'owner', purpose: 'github.user', actions: ['github.api'], resources: ['github:user'] }
      },
      async getConnection() { return created },
      async createConnection() { return created },
      async bindConsumer() { return { id: 'bind-1' } },
      async appendConnectionAudit() { return { id: 'audit-1' } as never },
      async affectedClosure() { return [] },
    }

    registerWorkGraphHandlers(server, workGraph)

    expect([...registrations.keys()]).toEqual([...HANDLED_CHANNELS])
    for (const channel of HANDLED_CHANNELS) {
      expect(registrations.get(channel)).toEqual({ access: 'localElectron' })
    }
    expect(registrations.has(RPC_CHANNELS.workgraph.LIST_CONNECTIONS)).toBe(true)
    expect(registrations.has(RPC_CHANNELS.workgraph.GET_CONNECTION)).toBe(true)
    expect(registrations.has(RPC_CHANNELS.workgraph.CREATE_CONNECTION)).toBe(true)
    expect(registrations.has(RPC_CHANNELS.workgraph.GRANT_CONNECTION)).toBe(true)

    const grant = handlers.get(RPC_CHANNELS.workgraph.GRANT_CONNECTION)
    await expect(grant?.({} as never, {
      workspaceId: 'workspace_a',
      connectionId: created.id,
      consumerId: 'agent-a',
      purpose: 'github.user',
      actions: ['github.api'],
      resources: ['github:user'],
      value: 'super-secret',
    })).rejects.toThrow(/value|payload|secret|field/i)

    const preview = handlers.get(RPC_CHANNELS.workgraph.PREVIEW_GITHUB_ENV)
    await expect(preview?.({} as never, '/tmp/.env')).resolves.toEqual([])
    const previewGit = handlers.get(RPC_CHANNELS.workgraph.PREVIEW_GIT_HELPER)
    await expect(previewGit?.({} as never, '/tmp/.gitconfig')).resolves.toEqual([])

    const create = handlers.get(RPC_CHANNELS.workgraph.CREATE_CONNECTION)
    expect(() => create?.({} as never, {
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: created.credentialRefId,
      storageMode: 'copy',
      value: 'super-secret',
    })).toThrow(/value|payload|secret|field/i)
  })
})
