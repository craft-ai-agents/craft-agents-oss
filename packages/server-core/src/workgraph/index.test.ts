import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { connect } from '@tursodatabase/database'
import { afterEach, describe, expect, it } from 'bun:test'

import {
  createWorkGraphKernel,
  isWorkGraphPlatformSupported,
  type WorkGraphKernelOptions,
} from './index'

const roots: string[] = []
const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-workgraph-'))
  roots.push(root)
  return root
}

function paths(root: string) {
  const directory = join(root, 'workgraph')
  return {
    directory,
    database: join(directory, 'workgraph.db'),
    marker: join(directory, 'workgraph-provisioning.json'),
  }
}

function createKernel(root: string, hooks?: WorkGraphKernelOptions['hooks']) {
  return createWorkGraphKernel({
    configDir: root,
    platform: { platform: 'darwin', arch: 'arm64' },
    hooks,
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('WorkGraph kernel', () => {
  it('fails closed on unqualified platforms without creating a database', async () => {
    const root = createRoot()
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'x64' },
    })

    await expect(kernel.getHealth()).resolves.toEqual({
      state: 'unavailable',
      platform: 'darwin/x64',
      reason: 'unsupported-platform',
    })
    expect(existsSync(paths(root).database)).toBe(false)
    expect(isWorkGraphPlatformSupported({ platform: 'darwin', arch: 'x64' })).toBe(false)
    expect(isWorkGraphPlatformSupported({ platform: 'darwin', arch: 'arm64' })).toBe(true)
  })

  nativeIt('provisions only a clean root, persists a work item, and reopens with the same installation', async () => {
    const root = createRoot()
    const first = createKernel(root)
    const initial = await first.getHealth()
    expect(initial.state).toBe('available')
    if (initial.state !== 'available') throw new Error('WorkGraph did not provision')

    const workItem = await first.createWorkItem({
      workspaceId: 'workspace_a',
      title: 'First item',
      status: 'todo',
      priority: 2,
      rank: 10,
    })
    await first.close()

    const storedMarker = JSON.parse(readFileSync(paths(root).marker, 'utf-8'))
    expect(storedMarker).toEqual({
      installationId: initial.installationId,
      relativeDatabaseFilename: 'workgraph.db',
      state: 'provisioned',
    })

    const reopened = createKernel(root)
    const health = await reopened.getHealth()
    expect(health).toMatchObject({
      state: 'available',
      installationId: initial.installationId,
      schemaVersion: 3,
    })
    await expect(reopened.getWorkItem('workspace_a', workItem.id)).resolves.toMatchObject({
      id: workItem.id,
      title: 'First item',
    })
    await reopened.close()
  })

  nativeIt('treats a database without a provisioning marker as incomplete rather than first use', async () => {
    const root = createRoot()
    const { directory, database } = paths(root)
    mkdirSync(directory, { recursive: true })
    const db = await connect(database, { fileMustExist: false })
    await db.exec('CREATE TABLE unrelated (value TEXT)')
    await db.close()

    const kernel = createKernel(root)
    await expect(kernel.getHealth()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'incomplete-provisioning',
    })
    expect(existsSync(database)).toBe(true)
  })

  nativeIt('treats a deleted database behind a marker as incomplete rather than recreating it', async () => {
    const root = createRoot()
    const first = createKernel(root)
    await first.getHealth()
    await first.close()

    rmSync(paths(root).database)

    const kernel = createKernel(root)
    await expect(kernel.getHealth()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'incomplete-provisioning',
    })
    expect(existsSync(paths(root).database)).toBe(false)
  })

  nativeIt('rejects an installation ID mismatch without opening a replacement database', async () => {
    const root = createRoot()
    const first = createKernel(root)
    await first.getHealth()
    await first.close()

    writeFileSync(paths(root).marker, `${JSON.stringify({
      installationId: randomUUID(),
      relativeDatabaseFilename: 'workgraph.db',
      state: 'provisioned',
    })}\n`)

    const kernel = createKernel(root)
    await expect(kernel.getHealth()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'provisioning-mismatch',
    })
  })

  nativeIt('rolls back current state when ledger append cannot complete', async () => {
    const root = createRoot()
    const kernel = createKernel(root, {
      afterStateWrite: () => {
        throw new Error('test ledger failure')
      },
    })
    await kernel.getHealth()

    await expect(kernel.createWorkItem({
      workspaceId: 'workspace_a',
      title: 'Must roll back',
    })).rejects.toThrow('test ledger failure')
    await kernel.close()

    const db = await connect(paths(root).database, { fileMustExist: true })
    try {
      const objectCount = await db.get('SELECT COUNT(*) AS count FROM graph_objects') as { count: number }
      const itemCount = await db.get('SELECT COUNT(*) AS count FROM work_items') as { count: number }
      const ledgerCount = await db.get('SELECT COUNT(*) AS count FROM workgraph_ledger') as { count: number }
      expect(objectCount.count).toBe(0)
      expect(itemCount.count).toBe(0)
      expect(ledgerCount.count).toBe(0)
    } finally {
      await db.close()
    }
  })

  nativeIt('enforces immutable ledger rows with database triggers', async () => {
    const root = createRoot()
    const kernel = createKernel(root)
    await kernel.getHealth()
    await kernel.createWorkItem({ workspaceId: 'workspace_a', title: 'Immutable evidence' })
    await kernel.close()

    const db = await connect(paths(root).database, { fileMustExist: true })
    try {
      await expect(db.run("UPDATE workgraph_ledger SET outcome = 'changed'"))
        .rejects.toThrow('workgraph ledger is immutable')
      await expect(db.run('DELETE FROM workgraph_ledger'))
        .rejects.toThrow('workgraph ledger is immutable')
    } finally {
      await db.close()
    }
  })

  nativeIt('does not enumerate a work item across workspace scopes', async () => {
    const root = createRoot()
    const kernel = createKernel(root)
    await kernel.getHealth()
    const item = await kernel.createWorkItem({ workspaceId: 'workspace_a', title: 'Scoped item' })

    await expect(kernel.getWorkItem('workspace_b', item.id)).resolves.toBeNull()
    await expect(kernel.getWorkItem('workspace_a', item.id)).resolves.toMatchObject({ id: item.id })
    await kernel.close()
  })

  nativeIt('fails closed on a migration checksum drift', async () => {
    const root = createRoot()
    const first = createKernel(root)
    await first.getHealth()
    await first.close()

    const db = await connect(paths(root).database, { fileMustExist: true })
    try {
      await db.run("UPDATE workgraph_schema_migrations SET checksum = 'tampered' WHERE version = 1")
    } finally {
      await db.close()
    }

    const kernel = createKernel(root)
    await expect(kernel.getHealth()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'schema-mismatch',
    })
  })

  nativeIt('stores connection metadata, closes over one workspace, and keeps the ledger immutable', async () => {
    const root = createRoot()
    const kernel = createKernel(root)
    const cred = 'cred_123e4567-e89b-12d3-a456-426614174000'
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: cred,
      storageMode: 'copy',
      scopes: ['repo'],
    })
    expect(connection.credentialRefId).toBe(cred)
    expect(JSON.stringify(connection)).not.toContain('secret')
    await expect(kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: cred,
      storageMode: 'copy',
      value: 'secret',
    } as never)).rejects.toThrow(/value/)

    await kernel.bindConsumer({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      consumerId: 'agent-a',
      purpose: 'github.request',
      allowedActions: ['github.request'],
      resources: ['repo:demo'],
    })
    const other = await kernel.createConnection({
      workspaceId: 'workspace_b',
      integrationId: 'github',
      credentialRefId: cred,
      storageMode: 'reference',
    })
    await kernel.bindConsumer({
      workspaceId: 'workspace_b',
      connectionId: other.id,
      consumerId: 'agent-b',
      purpose: 'github.request',
      allowedActions: ['github.request'],
      resources: ['repo:other'],
    })
    expect(await kernel.affectedClosure('workspace_a', connection.id)).toEqual(['agent-a'])
    expect(await kernel.getConnection('workspace_b', connection.id)).toBeNull()

    await kernel.appendConnectionAudit({
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      credentialRefId: cred,
      consumer: 'agent-a',
      action: 'github.request',
      decision: 'allow',
      versionFingerprint: 'a'.repeat(64),
    })
    const { connect } = await import('@tursodatabase/database')
    const db = await connect(paths(root).database)
    await expect(db.exec('UPDATE workgraph_ledger SET outcome = "tampered"')).rejects.toThrow()
    const row = await db.get(
      "SELECT event_type, outcome, payload_digest FROM workgraph_ledger WHERE event_type = 'connection-audit'",
    ) as { event_type?: string; outcome?: string; payload_digest?: string }
    expect(row.outcome).toBe('committed')
    expect(JSON.stringify(row)).not.toContain('secret')
    await db.close()
    await kernel.close()
  })

  nativeIt('lists connections only inside the requested workspace', async () => {
    const root = createRoot()
    const kernel = createKernel(root)
    const cred = 'cred_123e4567-e89b-12d3-a456-426614174000'
    const local = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: cred,
      storageMode: 'copy',
    })
    await kernel.createConnection({
      workspaceId: 'workspace_b',
      integrationId: 'github',
      credentialRefId: cred,
      storageMode: 'reference',
    })
    const listed = await kernel.listConnections('workspace_a')
    expect(listed.map((row) => row.id)).toEqual([local.id])
    expect(JSON.stringify(listed)).not.toContain('secret')
    await kernel.close()
  })
})
