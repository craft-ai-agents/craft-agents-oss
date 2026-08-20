import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { connect } from '@tursodatabase/database'
import { afterEach, describe, expect, it } from 'bun:test'

import { createWorkGraphKernel } from './index'

const roots: string[] = []
const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip

const CRED_A = 'cred_11111111-1111-4111-8111-111111111111' as const
const CRED_B = 'cred_22222222-2222-4222-8222-222222222222' as const

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-workgraph-cf5-'))
  roots.push(root)
  return root
}

function createKernel(root: string) {
  return createWorkGraphKernel({
    configDir: root,
    platform: { platform: 'darwin', arch: 'arm64' },
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('CF-5 WorkGraph connections', () => {
  nativeIt('provisions schema version 3', async () => {
    const kernel = createKernel(createRoot())
    const health = await kernel.getHealth()
    expect(health.state).toBe('available')
    if (health.state !== 'available') throw new Error('unavailable')
    expect(health.schemaVersion).toBe(3)
    await kernel.close()
  })

  nativeIt('creates a metadata-only connection and rejects secret fields', async () => {
    const kernel = createKernel(createRoot())
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'copy',
      scopes: ['repo'],
    })
    expect(connection.credentialRefId).toBe(CRED_A)
    expect(connection.storageMode).toBe('copy')
    expect(connection.scopes).toEqual(['repo'])
    expect(JSON.stringify(connection)).not.toContain('super-secret')
    expect(connection).not.toHaveProperty('value')
    expect(connection).not.toHaveProperty('payload')

    await expect(kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'copy',
      value: 'super-secret',
    } as never)).rejects.toThrow(/value|payload|metadata/i)

    await expect(kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: 'not-a-cred',
      storageMode: 'copy',
    } as never)).rejects.toThrow(/credentialRefId/i)

    await expect(kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'not-a-mode' as never,
    })).rejects.toThrow(/storageMode/i)

    await kernel.close()
  })

  nativeIt('binds consumers and closes over one workspace only', async () => {
    const kernel = createKernel(createRoot())
    await kernel.getHealth()
    const a = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'reference',
    })
    const b = await kernel.createConnection({
      workspaceId: 'workspace_b',
      integrationId: 'github',
      credentialRefId: CRED_B,
      storageMode: 'reference',
    })
    await kernel.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: a.id,
      consumerId: 'agent-a',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:demo'],
    })
    await kernel.bindConsumer({
      workspaceId: 'workspace_b',
      connectionId: b.id,
      consumerId: 'agent-b',
      purpose: 'list issues',
      allowedActions: ['github.request'],
      resources: ['repo:other'],
    })

    await expect(kernel.affectedClosure('workspace_a', a.id)).resolves.toEqual(['agent-a'])
    await expect(kernel.affectedClosure('workspace_b', a.id)).resolves.toEqual([])
    await expect(kernel.getConnection('workspace_b', a.id)).resolves.toBeNull()
    await expect(kernel.getConnection('workspace_a', a.id)).resolves.toMatchObject({
      id: a.id,
      credentialRefId: CRED_A,
    })
    await expect(kernel.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: 'missing-connection-id',
      consumerId: 'agent-a',
      purpose: 'x',
      allowedActions: [],
      resources: [],
    })).rejects.toThrow(/not found|Invalid/i)
    await kernel.close()
  })

  nativeIt('upgrades a v1 database to schema 3 without payload columns', async () => {
    const root = createRoot()
    const first = createKernel(root)
    await first.getHealth()
    await first.close()

    const db = await connect(join(root, 'workgraph', 'workgraph.db'), { fileMustExist: true })
    try {
      await db.exec('DROP TABLE IF EXISTS workgraph_connection_bindings')
      await db.exec('DROP TABLE IF EXISTS workgraph_connections')
      // Re-apply migration 2 only; leave migration 3 so ADD COLUMN action is not repeated.
      await db.run('DELETE FROM workgraph_schema_migrations WHERE version = 2')
    } finally {
      await db.close()
    }

    const upgraded = createKernel(root)
    const health = await upgraded.getHealth()
    expect(health.state).toBe('available')
    if (health.state !== 'available') throw new Error('unavailable')
    expect(health.schemaVersion).toBe(3)
    const connection = await upgraded.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'reference',
    })
    expect(connection.credentialRefId).toBe(CRED_A)
    await upgraded.close()

    const check = await connect(join(root, 'workgraph', 'workgraph.db'), { fileMustExist: true })
    try {
      const columns = await check.all('PRAGMA table_info(workgraph_connections)') as Array<{ name: string }>
      const names = columns.map((column) => column.name)
      expect(names).not.toContain('value')
      expect(names).not.toContain('payload')
      expect(names).not.toContain('secret')
      expect(names).not.toContain('token')
      expect(names).not.toContain('refresh_token')
    } finally {
      await check.close()
    }
  })

  nativeIt('appends a redacted immutable connection audit', async () => {
    const root = createRoot()
    const kernel = createKernel(root)
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'copy',
    })
    await kernel.appendConnectionAudit({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      credentialRefId: CRED_A,
      consumer: 'agent-a',
      action: 'github.request',
      decision: 'allow',
      versionFingerprint: 'abc',
    })
    await kernel.close()

    const db = await connect(join(root, 'workgraph', 'workgraph.db'), { fileMustExist: true })
    try {
      const row = await db.get(
        "SELECT outcome, payload_digest, event_type FROM workgraph_ledger WHERE event_type = 'connection-audit'",
      ) as { outcome: string; payload_digest: string; event_type: string }
      expect(row.outcome).toBe('committed')
      expect(row.payload_digest).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(row)).not.toContain('super-secret')
      await expect(db.run("UPDATE workgraph_ledger SET outcome = 'changed' WHERE event_type = 'connection-audit'"))
        .rejects.toThrow('workgraph ledger is immutable')
    } finally {
      await db.close()
    }
    expect(existsSync(join(root, 'workgraph', 'workgraph.db'))).toBe(true)
  })

  nativeIt('lists metadata-only connection audit rows including created', async () => {
    const kernel = createKernel(createRoot())
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED_A,
      storageMode: 'copy',
    })
    await kernel.appendConnectionAudit({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      credentialRefId: CRED_A,
      consumer: 'agent-a',
      action: 'github.request',
      decision: 'allow',
      versionFingerprint: 'abc',
    })
    const listed = await kernel.listConnectionAudit('workspace_a', connection.id)
    expect(listed.length).toBe(2)
    const created = listed.find((row) => row.eventType === 'connection-created')
    const audit = listed.find((row) => row.eventType === 'connection-audit')
    expect(created).toMatchObject({
      connectionId: connection.id,
      eventType: 'connection-created',
      outcome: 'committed',
      action: 'connection.create',
    })
    expect(typeof created?.occurredAt).toBe('number')
    expect(created?.payloadDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(audit).toMatchObject({
      connectionId: connection.id,
      eventType: 'connection-audit',
      outcome: 'committed',
      action: 'github.request',
      actorId: 'agent-a',
    })
    expect(typeof audit?.occurredAt).toBe('number')
    expect(audit?.payloadDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(listed)).not.toContain('super-secret')
    expect(listed[0]).not.toHaveProperty('value')
    await kernel.close()
  })
})
