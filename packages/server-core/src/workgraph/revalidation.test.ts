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
import {
  convertCopyToReferenceAndRevalidate,
  repairConnectionAndRevalidate,
  revokeConnectionAndRevalidate,
  revokeConnectionBindingAndRevalidate,
  rotateConnectionAndRevalidate,
} from './revalidation.ts'

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
  const root = mkdtempSync(join(tmpdir(), 'craft-workgraph-cf5-rev-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('CF-5.2 revoke, closure, revalidate', () => {
  nativeIt('invalidates leases, audits, and revalidates only the same workspace', async () => {
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
    const other = await kernel.createConnection({
      workspaceId: 'workspace_b',
      integrationId: 'github',
      credentialRefId: written.ref.id,
      storageMode: 'copy',
    })
    await kernel.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:demo'],
    })
    await kernel.bindConsumer({
      workspaceId: 'workspace_b',
      connectionId: other.id,
      consumerId: 'agent-b',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:other'],
    })

    const consumer = { kind: 'agent' as const, id: 'agent-a', workspaceId: 'workspace_a' }
    broker.grant({
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: written.ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
    })
    const lease = await broker.acquireLease({
      credentialRef: written.ref.id,
      consumer,
      purpose: 'list issues',
      action: 'github.request',
      resources: ['repo:demo'],
      audience: 'local-broker',
      ttl: 5000,
    })

    const result = await revokeConnectionAndRevalidate({
      kernel,
      broker,
      provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      reason: 'operator',
    })

    expect(result.consumers).toEqual([
      { consumerId: 'agent-a', status: 'repair_required' },
    ])
    expect(JSON.stringify(result)).not.toContain('super-secret')
    await expect(broker.perform(lease.id, () => 'x')).rejects.toMatchObject({ code: 'lease_revoked' })

    await kernel.close()
    const db = await connect(join(root, 'workgraph', 'workgraph.db'), { fileMustExist: true })
    try {
      const row = await db.get(
        "SELECT event_type, outcome, payload_digest FROM workgraph_ledger WHERE event_type = 'connection-revoked'",
      ) as { event_type: string; outcome: string; payload_digest: string }
      expect(row.outcome).toBe('committed')
      expect(row.payload_digest).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(row)).not.toContain('super-secret')
    } finally {
      await db.close()
    }
  })

  nativeIt('rejects an unknown connection without touching the broker', async () => {
    const root = createRoot()
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id))
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    await expect(revokeConnectionAndRevalidate({
      kernel,
      broker,
      provider,
      workspaceId: 'workspace_a',
      connectionId: 'missing-connection-id',
      reason: 'operator',
    })).rejects.toThrow(/not found/i)
    await kernel.close()
  })
})

describe('CF-6.5 rotate and repair', () => {
  nativeIt('rotate invalidates leases but keeps the provider copy', async () => {
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
    await kernel.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:demo'],
    })
    const consumer = { kind: 'agent' as const, id: 'agent-a', workspaceId: 'workspace_a' }
    broker.grant({
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: written.ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
    })
    const lease = await broker.acquireLease({
      credentialRef: written.ref.id,
      consumer,
      purpose: 'list issues',
      action: 'github.request',
      resources: ['repo:demo'],
      audience: 'local-broker',
      ttl: 5000,
    })

    const result = await rotateConnectionAndRevalidate({
      kernel,
      broker,
      provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      reason: 'operator-rotate',
    })

    expect(result.consumers).toEqual([{ consumerId: 'agent-a', status: 'denied' }])
    expect(JSON.stringify(result)).not.toContain('super-secret')
    await expect(broker.perform(lease.id, () => 'x')).rejects.toMatchObject({ code: 'lease_revoked' })
    expect((await provider.inspect(written.ref)).status).toBe('active')
    const repaired = await repairConnectionAndRevalidate({
      kernel,
      broker,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
    })
    expect(repaired.consumers).toEqual([{ consumerId: 'agent-a', status: 'denied' }])
    expect(JSON.stringify(repaired)).not.toContain('super-secret')

    await kernel.close()
    const db = await connect(join(root, 'workgraph', 'workgraph.db'), { fileMustExist: true })
    try {
      const rotated = await db.get(
        "SELECT event_type, outcome FROM workgraph_ledger WHERE event_type = 'connection-rotated'",
      ) as { event_type: string; outcome: string }
      expect(rotated.outcome).toBe('committed')
      const repairedRow = await db.get(
        "SELECT event_type, outcome FROM workgraph_ledger WHERE event_type = 'connection-repaired'",
      ) as { event_type: string; outcome: string }
      expect(repairedRow.outcome).toBe('committed')
    } finally {
      await db.close()
    }
  })

  nativeIt('converts copy to reference, drops the local copy, and unbinds a consumer', async () => {
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
    await kernel.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'github.user',
      allowedActions: ['github.api'],
      resources: ['github:user'],
    })
    broker.grant({
      workspaceId: 'workspace_a',
      consumerId: 'agent-a',
      credentialRefId: written.ref.id,
      actions: ['github.api'],
      resources: ['github:user'],
    })
    const converted = await convertCopyToReferenceAndRevalidate({
      kernel,
      broker,
      provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      reason: 'owner-convert',
    })
    expect(converted.storageMode).toBe('reference')
    expect(JSON.stringify(converted)).not.toContain('super-secret')
    const inspected = await provider.inspect(written.ref)
    expect(inspected.status).toBe('missing')
    const [binding] = await kernel.listConnectionBindings('workspace_a', connection.id)
    expect(binding?.consumerId).toBe('agent-a')
    const unbound = await revokeConnectionBindingAndRevalidate({
      kernel,
      broker,
      workspaceId: 'workspace_a',
      bindingId: binding!.id,
    })
    expect(unbound.consumers[0]?.consumerId).toBe('agent-a')
    expect(await kernel.listConnectionBindings('workspace_a', connection.id)).toEqual([])
    await kernel.close()
  })
})
