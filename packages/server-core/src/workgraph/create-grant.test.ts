import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { connect } from '@tursodatabase/database'
import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import { credentialIdToAccount } from '@craft-agent/shared/credentials'
import { LocalFileSecretProvider } from '@craft-agent/shared/credentials'
import { InProcessCredentialBroker } from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { createConnectionGrant } from './create-grant.ts'

const roots: string[] = []
const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory'
  readonly priority = 1
  readonly store = new Map<string, StoredCredential>()
  async isAvailable(): Promise<boolean> { return true }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential)
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id))
  }
  async list(): Promise<CredentialId[]> { return [] }
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-workgraph-cf-grant-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('createConnectionGrant', () => {
  nativeIt('binds a consumer and grants the broker', async () => {
    const root = createRoot()
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret' },
    })
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id))
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()

    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: written.ref.id,
      storageMode: 'copy',
    })

    const result = await createConnectionGrant({
      kernel,
      broker,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      actions: ['github.request'],
      resources: ['repo:demo'],
    })

    expect(result.bindingId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(result.grantId).toMatch(/^grant_\d+$/)
    expect(JSON.stringify(result)).not.toContain('super-secret')
    expect(JSON.stringify(result)).not.toMatch(/token|secret/i)

    expect(await kernel.affectedClosure('workspace_a', connection.id)).toEqual(['agent-a'])
    const grants = await broker.listGrants()
    expect(grants).toEqual([
      expect.objectContaining({
        id: result.grantId,
        workspaceId: 'workspace_a',
        consumerId: 'agent-a',
        credentialRefId: written.ref.id,
        actions: ['github.request'],
        resources: ['repo:demo'],
        status: 'active',
      }),
    ])

    await kernel.close()
    const db = await connect(join(root, 'workgraph', 'workgraph.db'), { fileMustExist: true })
    try {
      const row = await db.get(
        "SELECT event_type, outcome, actor_id, payload_digest FROM workgraph_ledger WHERE event_type = 'connection-audit'",
      ) as { event_type: string; outcome: string; actor_id: string; payload_digest: string }
      expect(row.outcome).toBe('committed')
      expect(row.actor_id).toBe('agent-a')
      expect(row.payload_digest).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(row)).not.toContain('super-secret')
    } finally {
      await db.close()
    }
  })

  nativeIt('rejects an unknown connection without granting', async () => {
    const root = createRoot()
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id))
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()

    await expect(createConnectionGrant({
      kernel,
      broker,
      workspaceId: 'workspace_a',
      connectionId: 'missing-connection-id',
      consumerId: 'agent-a',
      purpose: 'list issues',
      actions: ['github.request'],
      resources: ['repo:demo'],
    })).rejects.toThrow(/not found/i)

    expect(await broker.listGrants()).toEqual([])
    await kernel.close()
  })

  nativeIt('keeps token and secret fields out of the result', async () => {
    const root = createRoot()
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret-token-value' },
    })
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id))
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()

    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: written.ref.id,
      storageMode: 'copy',
    })

    const result = await createConnectionGrant({
      kernel,
      broker,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      actions: ['github.request'],
      resources: ['repo:demo'],
    })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('super-secret-token-value')
    expect(serialized).not.toMatch(/"token"|"secret"/i)
    expect(Object.keys(result).sort()).toEqual(['bindingId', 'grantId'])
    await kernel.close()
  })
})
