import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Database, Transaction } from '@tursodatabase/database'
import { atomicWriteFileSync } from '@craft-agent/shared/utils'

const WORKGRAPH_DIRECTORY = 'workgraph'
const DATABASE_FILENAME = 'workgraph.db'
const PROVISIONING_FILENAME = 'workgraph-provisioning.json'
const WORKGRAPH_SCHEMA_VERSION = 3
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

type WorkGraphDatabase = Pick<Database, 'all' | 'close' | 'exec' | 'get' | 'run' | 'transactionAsync'>
type WorkGraphTransaction = Pick<Transaction, 'all' | 'exec' | 'get' | 'run'>

export type WorkGraphAvailabilityReason =
  | 'unsupported-platform'
  | 'incomplete-provisioning'
  | 'invalid-provisioning-record'
  | 'provisioning-mismatch'
  | 'schema-mismatch'
  | 'integrity-check-failed'
  | 'database-open-failed'

export type WorkGraphHealth =
  | {
    state: 'available'
    platform: `${string}/${string}`
    schemaVersion: number
    installationId: string
  }
  | {
    state: 'unavailable'
    platform: `${string}/${string}`
    reason: WorkGraphAvailabilityReason
  }

export interface WorkGraphPlatform {
  readonly platform: NodeJS.Platform
  readonly arch: string
}

export interface WorkGraphKernelOptions {
  /** Trusted app-owned config root. This is never sourced from an RPC input. */
  readonly configDir: string
  readonly platform?: WorkGraphPlatform
  /** Narrow internal failure hook for atomicity tests; production code omits it. */
  readonly hooks?: {
    readonly afterStateWrite?: () => Promise<void> | void
  }
}

export interface CreateWorkItemInput {
  readonly workspaceId: string
  readonly title: string
  readonly status?: WorkItemStatus
  readonly priority?: number
  readonly dueAt?: number | null
  readonly rank?: number
  readonly projectId?: string | null
  readonly parentId?: string | null
  readonly correlationId?: string | null
}

export type WorkItemStatus = 'todo' | 'in_progress' | 'done' | 'canceled'

export interface WorkItem {
  readonly id: string
  readonly workspaceId: string
  readonly title: string
  readonly status: WorkItemStatus
  readonly priority: number
  readonly dueAt: number | null
  readonly rank: number
  readonly projectId: string | null
  readonly parentId: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type ConnectionStorageMode = 'reference' | 'copy' | 'mirror' | 'managed' | 'ephemeral'

export interface CreateConnectionInput {
  readonly workspaceId: string
  readonly integrationId: string
  readonly credentialRefId: `cred_${string}`
  readonly storageMode: ConnectionStorageMode
  readonly scopes?: readonly string[]
}

export interface ConnectionRecord {
  readonly id: string
  readonly workspaceId: string
  readonly integrationId: string
  readonly credentialRefId: string
  readonly storageMode: ConnectionStorageMode
  readonly scopes: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ConnectionAuditRecord {
  readonly connectionId: string
  readonly eventType: string
  readonly occurredAt: number
  readonly actorId: string | null
  readonly outcome: string
  readonly payloadDigest: string
  readonly action: string
}

export interface ConnectionBindingRecord {
  readonly id: string
  readonly connectionId: string
  readonly consumerId: string
  readonly purpose: string
  readonly actions: readonly string[]
  readonly resources: readonly string[]
}

interface ProvisioningRecord {
  readonly installationId: string
  readonly relativeDatabaseFilename: typeof DATABASE_FILENAME
  readonly state: 'provisioned'
}

interface Migration {
  readonly version: number
  readonly sql: string
  readonly checksum: string
}

interface OpenDatabase {
  readonly database: WorkGraphDatabase
  readonly installationId: string
  readonly schemaVersion: number
}

const MIGRATIONS: readonly Migration[] = [
  migration(1, `
    CREATE TABLE IF NOT EXISTS workgraph_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workgraph_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_objects (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('work_item', 'session_ref', 'agent_run')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS graph_objects_workspace_idx ON graph_objects (workspace_id, id);

    CREATE TABLE IF NOT EXISTS work_items (
      object_id TEXT PRIMARY KEY NOT NULL REFERENCES graph_objects(id) ON DELETE RESTRICT,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'canceled')),
      priority INTEGER NOT NULL,
      due_at INTEGER,
      rank INTEGER NOT NULL,
      project_id TEXT,
      parent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS work_items_workspace_idx ON work_items (workspace_id, rank, object_id);

    CREATE TABLE IF NOT EXISTS session_refs (
      object_id TEXT PRIMARY KEY NOT NULL REFERENCES graph_objects(id) ON DELETE RESTRICT,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_version TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_refs_workspace_idx ON session_refs (workspace_id, session_id);

    CREATE TABLE IF NOT EXISTS agent_runs (
      object_id TEXT PRIMARY KEY NOT NULL REFERENCES graph_objects(id) ON DELETE RESTRICT,
      workspace_id TEXT NOT NULL,
      executor_kind TEXT NOT NULL,
      external_source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      budget_metadata_digest TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_runs_workspace_idx ON agent_runs (workspace_id, external_source_id);

    CREATE TABLE IF NOT EXISTS workgraph_relations (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      from_object_id TEXT NOT NULL REFERENCES graph_objects(id) ON DELETE RESTRICT,
      to_object_id TEXT NOT NULL REFERENCES graph_objects(id) ON DELETE RESTRICT,
      relation_type TEXT NOT NULL,
      provenance TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (from_object_id <> to_object_id)
    );
    CREATE INDEX IF NOT EXISTS workgraph_relations_workspace_idx ON workgraph_relations (workspace_id, from_object_id, to_object_id);

    CREATE TABLE IF NOT EXISTS workgraph_ledger (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      workspace_id TEXT NOT NULL,
      object_id TEXT,
      relation_id TEXT,
      event_type TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT,
      source_kind TEXT NOT NULL,
      correlation_id TEXT,
      causation_id TEXT,
      schema_version INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      payload_digest TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workgraph_ledger_workspace_sequence_idx ON workgraph_ledger (workspace_id, sequence);

    CREATE TABLE IF NOT EXISTS workgraph_migration_sources (
      id TEXT PRIMARY KEY NOT NULL,
      source_kind TEXT NOT NULL,
      source_identity TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      source_schema_version TEXT NOT NULL,
      cursor TEXT,
      status TEXT NOT NULL,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (source_kind, source_identity)
    );

    CREATE TRIGGER IF NOT EXISTS workgraph_ledger_no_update
    BEFORE UPDATE ON workgraph_ledger
    BEGIN
      SELECT RAISE(ABORT, 'workgraph ledger is immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS workgraph_ledger_no_delete
    BEFORE DELETE ON workgraph_ledger
    BEGIN
      SELECT RAISE(ABORT, 'workgraph ledger is immutable');
    END;
  `),
  migration(2, `
    CREATE TABLE IF NOT EXISTS workgraph_connections (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      storage_mode TEXT NOT NULL CHECK (storage_mode IN ('reference', 'copy', 'mirror', 'managed', 'ephemeral')),
      scopes_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workgraph_connections_workspace_idx
      ON workgraph_connections (workspace_id, id);

    CREATE TABLE IF NOT EXISTS workgraph_connection_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES workgraph_connections(id) ON DELETE RESTRICT,
      consumer_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      actions_json TEXT NOT NULL,
      resources_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workgraph_connection_bindings_workspace_idx
      ON workgraph_connection_bindings (workspace_id, connection_id);
  `),
  migration(3, `
    ALTER TABLE workgraph_ledger ADD COLUMN action TEXT;
  `),
]

export function isWorkGraphPlatformSupported(platform: WorkGraphPlatform = process): boolean {
  // Only this tuple has been locally qualified. New tuples require their own
  // packaged native-driver smoke before they can be enabled.
  return platform.platform === 'darwin' && platform.arch === 'arm64'
}

export function createWorkGraphKernel(options: WorkGraphKernelOptions): WorkGraphKernel {
  return new WorkGraphKernel(options)
}

export class WorkGraphKernel {
  private readonly configDir: string
  private readonly platform: WorkGraphPlatform
  private readonly hooks: WorkGraphKernelOptions['hooks']
  private readonly directory: string
  private readonly databasePath: string
  private readonly markerPath: string
  private database: WorkGraphDatabase | null = null
  private initialization: Promise<WorkGraphHealth> | null = null
  private health: WorkGraphHealth | null = null

  constructor(options: WorkGraphKernelOptions) {
    if (!options.configDir || options.configDir.includes('\0')) {
      throw new Error('WorkGraph requires a trusted non-empty config directory')
    }

    this.configDir = options.configDir
    this.platform = options.platform ?? process
    this.hooks = options.hooks
    this.directory = join(this.configDir, WORKGRAPH_DIRECTORY)
    this.databasePath = join(this.directory, DATABASE_FILENAME)
    this.markerPath = join(this.directory, PROVISIONING_FILENAME)
  }

  async getHealth(): Promise<WorkGraphHealth> {
    await this.initialize()
    return this.health!
  }

  async getVersion(): Promise<{ schemaVersion: number; state: WorkGraphHealth['state'] }> {
    const health = await this.getHealth()
    return { schemaVersion: health.state === 'available' ? health.schemaVersion : 0, state: health.state }
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    const database = await this.requireDatabase()
    const validated = validateCreateWorkItem(input)
    const id = randomUUID()
    const eventId = randomUUID()
    const now = Date.now()
    const payloadDigest = digest({
      type: 'work-item-created',
      id,
      workspaceId: validated.workspaceId,
      status: validated.status,
      priority: validated.priority,
      dueAt: validated.dueAt,
      rank: validated.rank,
      projectId: validated.projectId,
      parentId: validated.parentId,
    })

    const mutation = database.transactionAsync(async (transaction: WorkGraphTransaction) => {
      await transaction.run(
        'INSERT INTO graph_objects (id, workspace_id, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        id,
        validated.workspaceId,
        'work_item',
        now,
        now,
      )
      await transaction.run(
        `INSERT INTO work_items (
          object_id, workspace_id, title, status, priority, due_at, rank, project_id, parent_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        validated.workspaceId,
        validated.title,
        validated.status,
        validated.priority,
        validated.dueAt,
        validated.rank,
        validated.projectId,
        validated.parentId,
        now,
        now,
      )
      await this.hooks?.afterStateWrite?.()
      await transaction.run(
        `INSERT INTO workgraph_ledger (
          event_id, workspace_id, object_id, relation_id, event_type, occurred_at, actor_kind, actor_id,
          source_kind, correlation_id, causation_id, schema_version, outcome, payload_digest
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`,
        eventId,
        validated.workspaceId,
        id,
        'work-item-created',
        now,
        'system',
        'workgraph',
        validated.correlationId,
        WORKGRAPH_SCHEMA_VERSION,
        'committed',
        payloadDigest,
      )
    })
    await mutation.immediate()

    return {
      id,
      workspaceId: validated.workspaceId,
      title: validated.title,
      status: validated.status,
      priority: validated.priority,
      dueAt: validated.dueAt,
      rank: validated.rank,
      projectId: validated.projectId ?? null,
      parentId: validated.parentId ?? null,
      createdAt: now,
      updatedAt: now,
    }
  }

  async createConnection(input: CreateConnectionInput): Promise<ConnectionRecord> {
    const database = await this.requireDatabase()
    for (const key of Object.keys(input as object)) {
      if (!['workspaceId', 'integrationId', 'credentialRefId', 'storageMode', 'scopes'].includes(key)) {
        throw new Error(`Invalid connection metadata field: ${key}`)
      }
    }
    assertOpaqueId(input.workspaceId, 'workspace ID')
    assertOpaqueId(input.integrationId, 'integration ID')
    if (!/^cred_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.credentialRefId)) {
      throw new Error('Invalid credentialRefId')
    }
    if (!['reference', 'copy', 'mirror', 'managed', 'ephemeral'].includes(input.storageMode)) {
      throw new Error('Invalid storageMode')
    }
    const scopes = input.scopes ?? []
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
      throw new Error('Invalid scopes')
    }
    const id = randomUUID()
    const now = Date.now()
    const eventId = randomUUID()
    const payloadDigest = digest({
      type: 'connection-created',
      id,
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      credentialRefId: input.credentialRefId,
      storageMode: input.storageMode,
      scopes,
    })
    const mutation = database.transactionAsync(async (transaction: WorkGraphTransaction) => {
      await transaction.run(
        `INSERT INTO workgraph_connections (
          id, workspace_id, integration_id, credential_ref_id, storage_mode, scopes_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.workspaceId,
        input.integrationId,
        input.credentialRefId,
        input.storageMode,
        JSON.stringify(scopes),
        now,
        now,
      )
      await transaction.run(
        `INSERT INTO workgraph_ledger (
          event_id, workspace_id, object_id, relation_id, event_type, occurred_at, actor_kind, actor_id,
          source_kind, correlation_id, causation_id, schema_version, outcome, payload_digest, action
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?)`,
        eventId,
        input.workspaceId,
        id,
        'connection-created',
        now,
        'system',
        'workgraph',
        WORKGRAPH_SCHEMA_VERSION,
        'committed',
        payloadDigest,
        'connection.create',
      )
    })
    await mutation.immediate()
    return {
      id,
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      credentialRefId: input.credentialRefId,
      storageMode: input.storageMode,
      scopes,
      createdAt: now,
      updatedAt: now,
    }
  }

  async listConnections(workspaceId: string): Promise<readonly ConnectionRecord[]> {
    const database = await this.requireDatabase()
    assertOpaqueId(workspaceId, 'workspace ID')
    const rows = await database.all(
      `SELECT id, workspace_id, integration_id, credential_ref_id, storage_mode, scopes_json, created_at, updated_at
       FROM workgraph_connections WHERE workspace_id = ? ORDER BY created_at, id`,
      workspaceId,
    ) as Array<Record<string, unknown>>
    return rows.map(rowToConnection)
  }

  async getConnection(workspaceId: string, connectionId: string): Promise<ConnectionRecord | null> {
    const database = await this.requireDatabase()
    assertOpaqueId(workspaceId, 'workspace ID')
    assertOpaqueId(connectionId, 'connection ID')
    const row = await database.get(
      `SELECT id, workspace_id, integration_id, credential_ref_id, storage_mode, scopes_json, created_at, updated_at
       FROM workgraph_connections WHERE workspace_id = ? AND id = ?`,
      workspaceId,
      connectionId,
    ) as Record<string, unknown> | undefined
    return row ? rowToConnection(row) : null
  }

  async bindConsumer(input: {
    workspaceId: string
    connectionId: string
    consumerId: string
    purpose: string
    allowedActions: readonly string[]
    resources: readonly string[]
  }): Promise<{ id: string }> {
    const database = await this.requireDatabase()
    assertOpaqueId(input.workspaceId, 'workspace ID')
    assertOpaqueId(input.connectionId, 'connection ID')
    assertOpaqueId(input.consumerId, 'consumer ID')
    if (!input.purpose.trim()) throw new Error('Invalid purpose')
    const existing = await this.getConnection(input.workspaceId, input.connectionId)
    if (!existing) throw new Error('Connection not found')
    const id = randomUUID()
    await database.run(
      `INSERT INTO workgraph_connection_bindings (
        id, workspace_id, connection_id, consumer_id, purpose, actions_json, resources_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.workspaceId,
      input.connectionId,
      input.consumerId,
      input.purpose.trim(),
      JSON.stringify(input.allowedActions),
      JSON.stringify(input.resources),
      Date.now(),
    )
    return { id }
  }

  async appendConnectionAudit(input: {
    workspaceId: string
    connectionId: string
    credentialRefId?: string
    consumer?: string
    action: string
    decision: 'allow' | 'deny'
    versionFingerprint?: string
    eventType?: 'connection-audit' | 'connection-revoked' | 'connection-rotated' | 'connection-repaired' | 'connection-converted' | 'connection-binding-revoked'
  }): Promise<void> {
    const database = await this.requireDatabase()
    assertOpaqueId(input.workspaceId, 'workspace ID')
    assertOpaqueId(input.connectionId, 'connection ID')
    const payloadDigest = digest({
      type: 'connection-audit',
      connectionId: input.connectionId,
      credentialRefId: input.credentialRefId,
      consumer: input.consumer,
      action: input.action,
      decision: input.decision,
      versionFingerprint: input.versionFingerprint,
    })
    await database.run(
      `INSERT INTO workgraph_ledger (
        event_id, workspace_id, object_id, relation_id, event_type, occurred_at, actor_kind, actor_id,
        source_kind, correlation_id, causation_id, schema_version, outcome, payload_digest, action
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      randomUUID(),
      input.workspaceId,
      input.connectionId,
      input.eventType ?? 'connection-audit',
      Date.now(),
      'system',
      input.consumer ?? null,
      'workgraph',
      WORKGRAPH_SCHEMA_VERSION,
      input.decision === 'allow' ? 'committed' : 'denied',
      payloadDigest,
      input.action,
    )
  }

  async affectedClosure(workspaceId: string, connectionId: string): Promise<readonly string[]> {
    const database = await this.requireDatabase()
    assertOpaqueId(workspaceId, 'workspace ID')
    assertOpaqueId(connectionId, 'connection ID')
    const rows = await database.all(
      'SELECT consumer_id FROM workgraph_connection_bindings WHERE workspace_id = ? AND connection_id = ?',
      workspaceId,
      connectionId,
    ) as Array<Record<string, unknown>>
    return rows.map((row) => {
      if (typeof row.consumer_id !== 'string') throw new Error('Invalid WorkGraph row field: consumer_id')
      return row.consumer_id
    })
  }

  async listConnectionAudit(
    workspaceId: string,
    connectionId?: string,
  ): Promise<readonly ConnectionAuditRecord[]> {
    const database = await this.requireDatabase()
    assertOpaqueId(workspaceId, 'workspace ID')
    if (connectionId) assertOpaqueId(connectionId, 'connection ID')
    const eventTypes = `'connection-created', 'connection-audit', 'connection-revoked', 'connection-rotated', 'connection-repaired', 'connection-converted', 'connection-binding-revoked'`
    const sql = connectionId
      ? `SELECT object_id, event_type, occurred_at, actor_id, outcome, payload_digest, action
         FROM workgraph_ledger
         WHERE workspace_id = ? AND object_id = ?
           AND event_type IN (${eventTypes})
         ORDER BY sequence DESC LIMIT 100`
      : `SELECT object_id, event_type, occurred_at, actor_id, outcome, payload_digest, action
         FROM workgraph_ledger
         WHERE workspace_id = ?
           AND event_type IN (${eventTypes})
         ORDER BY sequence DESC LIMIT 100`
    const rows = (
      connectionId
        ? await database.all(sql, workspaceId, connectionId)
        : await database.all(sql, workspaceId)
    ) as Array<Record<string, unknown>>
    return rows.map((row) => {
      if (typeof row.object_id !== 'string') throw new Error('Invalid WorkGraph row field: object_id')
      if (typeof row.event_type !== 'string') throw new Error('Invalid WorkGraph row field: event_type')
      if (typeof row.occurred_at !== 'number') throw new Error('Invalid WorkGraph row field: occurred_at')
      if (row.actor_id != null && typeof row.actor_id !== 'string') {
        throw new Error('Invalid WorkGraph row field: actor_id')
      }
      if (typeof row.outcome !== 'string') throw new Error('Invalid WorkGraph row field: outcome')
      if (typeof row.payload_digest !== 'string') throw new Error('Invalid WorkGraph row field: payload_digest')
      return {
        connectionId: row.object_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        actorId: row.actor_id ?? null,
        outcome: row.outcome,
        payloadDigest: row.payload_digest,
        action: typeof row.action === 'string' ? row.action : row.event_type,
      }
    })
  }

  async convertConnectionToReference(workspaceId: string, connectionId: string): Promise<ConnectionRecord> {
    const existing = await this.getConnection(workspaceId, connectionId)
    if (!existing) throw new Error('Connection not found')
    if (existing.storageMode !== 'copy') throw new Error('unsupported_convert')
    const database = await this.requireDatabase()
    const now = Date.now()
    const payloadDigest = digest({
      type: 'connection-converted',
      connectionId,
      credentialRefId: existing.credentialRefId,
      from: 'copy',
      to: 'reference',
    })
    await database.run(
      'UPDATE workgraph_connections SET storage_mode = ?, updated_at = ? WHERE workspace_id = ? AND id = ?',
      'reference',
      now,
      workspaceId,
      connectionId,
    )
    await this.appendConnectionAudit({
      workspaceId,
      connectionId,
      credentialRefId: existing.credentialRefId,
      action: 'connection.convert',
      decision: 'allow',
      eventType: 'connection-converted',
      versionFingerprint: payloadDigest,
    })
    const updated = await this.getConnection(workspaceId, connectionId)
    if (!updated) throw new Error('Connection not found')
    return updated
  }

  async listConnectionBindings(
    workspaceId: string,
    connectionId?: string,
  ): Promise<readonly ConnectionBindingRecord[]> {
    const database = await this.requireDatabase()
    assertOpaqueId(workspaceId, 'workspace ID')
    if (connectionId) assertOpaqueId(connectionId, 'connection ID')
    const rows = (
      connectionId
        ? await database.all(
          `SELECT id, connection_id, consumer_id, purpose, actions_json, resources_json
           FROM workgraph_connection_bindings WHERE workspace_id = ? AND connection_id = ?
           ORDER BY created_at, id`,
          workspaceId,
          connectionId,
        )
        : await database.all(
          `SELECT id, connection_id, consumer_id, purpose, actions_json, resources_json
           FROM workgraph_connection_bindings WHERE workspace_id = ?
           ORDER BY created_at, id`,
          workspaceId,
        )
    ) as Array<Record<string, unknown>>
    return rows.map((row) => {
      if (typeof row.id !== 'string') throw new Error('Invalid WorkGraph row field: id')
      if (typeof row.connection_id !== 'string') throw new Error('Invalid WorkGraph row field: connection_id')
      if (typeof row.consumer_id !== 'string') throw new Error('Invalid WorkGraph row field: consumer_id')
      if (typeof row.purpose !== 'string') throw new Error('Invalid WorkGraph row field: purpose')
      const actions = typeof row.actions_json === 'string' ? JSON.parse(row.actions_json) : []
      const resources = typeof row.resources_json === 'string' ? JSON.parse(row.resources_json) : []
      if (!Array.isArray(actions) || !Array.isArray(resources)) throw new Error('Invalid connection binding metadata')
      return {
        id: row.id,
        connectionId: row.connection_id,
        consumerId: row.consumer_id,
        purpose: row.purpose,
        actions: actions.filter((item) => typeof item === 'string'),
        resources: resources.filter((item) => typeof item === 'string'),
      }
    })
  }

  async revokeConnectionBinding(workspaceId: string, bindingId: string): Promise<ConnectionBindingRecord> {
    const database = await this.requireDatabase()
    assertOpaqueId(workspaceId, 'workspace ID')
    assertOpaqueId(bindingId, 'binding ID')
    const [binding] = (await this.listConnectionBindings(workspaceId)).filter((row) => row.id === bindingId)
    if (!binding) throw new Error('Binding not found')
    await database.run(
      'DELETE FROM workgraph_connection_bindings WHERE workspace_id = ? AND id = ?',
      workspaceId,
      bindingId,
    )
    await this.appendConnectionAudit({
      workspaceId,
      connectionId: binding.connectionId,
      consumer: binding.consumerId,
      action: 'connection.unbind',
      decision: 'allow',
      eventType: 'connection-binding-revoked',
    })
    return binding
  }

  /** Returns null for any cross-workspace selector rather than revealing ownership. */
  async getWorkItem(workspaceId: string, objectId: string): Promise<WorkItem | null> {
    const database = await this.requireDatabase()
    assertOpaqueId(workspaceId, 'workspace ID')
    assertOpaqueId(objectId, 'work item ID')

    const row = await database.get(
      `SELECT object_id, workspace_id, title, status, priority, due_at, rank, project_id, parent_id, created_at, updated_at
       FROM work_items WHERE workspace_id = ? AND object_id = ?`,
      workspaceId,
      objectId,
    ) as Record<string, unknown> | undefined

    return row ? rowToWorkItem(row) : null
  }

  async close(): Promise<void> {
    const database = this.database
    this.database = null
    this.initialization = null
    this.health = null
    await database?.close()
  }

  private async initialize(): Promise<WorkGraphHealth> {
    if (this.initialization) return this.initialization
    this.initialization = this.initializeOnce()
    return this.initialization
  }

  private async initializeOnce(): Promise<WorkGraphHealth> {
    const platform = platformName(this.platform)
    if (!isWorkGraphPlatformSupported(this.platform)) {
      return this.setUnavailable('unsupported-platform', platform)
    }

    mkdirSync(this.directory, { recursive: true })
    const hasDatabase = existsSync(this.databasePath)
    const hasMarker = existsSync(this.markerPath)

    if (!hasDatabase && !hasMarker) {
      return this.provision(platform)
    }
    if (!hasDatabase || !hasMarker) {
      return this.setUnavailable('incomplete-provisioning', platform)
    }

    const marker = readProvisioningRecord(this.markerPath)
    if (!marker) {
      return this.setUnavailable('invalid-provisioning-record', platform)
    }

    let opened: OpenDatabase | null = null
    try {
      opened = await openDatabase(this.databasePath)
      await runMigrations(opened.database)
      await validateSchema(opened.database)
      await verifyIntegrity(opened.database)
      const installationId = await readInstallationId(opened.database)
      if (!installationId || installationId !== marker.installationId) {
        await opened.database.close()
        return this.setUnavailable('provisioning-mismatch', platform)
      }
      const schemaVersion = await readSchemaVersion(opened.database)
      this.database = opened.database
      this.health = { state: 'available', platform, installationId, schemaVersion }
      return this.health
    } catch (error) {
      await opened?.database.close().catch(() => undefined)
      return this.setUnavailable(reasonForOpenError(error), platform)
    }
  }

  private async provision(platform: `${string}/${string}`): Promise<WorkGraphHealth> {
    const installationId = randomUUID()
    let opened: OpenDatabase | null = null

    try {
      opened = await openDatabase(this.databasePath, false)
      await runMigrations(opened.database)
      const metadata = opened.database.transactionAsync(async (transaction: WorkGraphTransaction) => {
        await transaction.run(
          'INSERT INTO workgraph_meta (key, value) VALUES (?, ?)',
          'installation_id',
          installationId,
        )
      })
      await metadata.immediate()
      await verifyIntegrity(opened.database)

      const marker: ProvisioningRecord = {
        installationId,
        relativeDatabaseFilename: DATABASE_FILENAME,
        state: 'provisioned',
      }
      atomicWriteFileSync(this.markerPath, `${JSON.stringify(marker)}\n`)

      const schemaVersion = await readSchemaVersion(opened.database)
      this.database = opened.database
      this.health = { state: 'available', platform, installationId, schemaVersion }
      return this.health
    } catch (error) {
      await opened?.database.close().catch(() => undefined)
      return this.setUnavailable(reasonForOpenError(error), platform)
    }
  }

  private async requireDatabase(): Promise<WorkGraphDatabase> {
    const health = await this.getHealth()
    if (health.state !== 'available' || !this.database) {
      throw new WorkGraphUnavailableError(health)
    }
    return this.database
  }

  private setUnavailable(reason: WorkGraphAvailabilityReason, platform: `${string}/${string}`): WorkGraphHealth {
    this.database = null
    this.health = { state: 'unavailable', platform, reason }
    return this.health
  }
}

export class WorkGraphUnavailableError extends Error {
  readonly health: WorkGraphHealth

  constructor(health: WorkGraphHealth) {
    super(`WorkGraph is unavailable: ${health.state === 'unavailable' ? health.reason : 'unknown'}`)
    this.name = 'WorkGraphUnavailableError'
    this.health = health
  }
}

function migration(version: number, sql: string): Migration {
  return { version, sql, checksum: digest(sql) }
}

async function openDatabase(path: string, fileMustExist = true): Promise<OpenDatabase> {
  const { connect } = await loadDatabaseDriver()
  const database = await connect(path, { fileMustExist })
  await database.exec('PRAGMA foreign_keys = ON')
  return { database, installationId: '', schemaVersion: 0 }
}

/**
 * Keep the N-API facade outside the Electron CJS bundle. Its ESM loader needs
 * a real module URL to resolve the architecture-specific `.node` artifact.
 */
async function loadDatabaseDriver(): Promise<typeof import('@tursodatabase/database')> {
  const modulePath = createRequire(__filename).resolve('@tursodatabase/database')
  return await import(modulePath)
}

async function runMigrations(database: WorkGraphDatabase): Promise<void> {
  const apply = database.transactionAsync(async (transaction: WorkGraphTransaction) => {
    await transaction.exec(`
      CREATE TABLE IF NOT EXISTS workgraph_schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)

    for (const current of MIGRATIONS) {
      const existing = await transaction.get(
        'SELECT checksum FROM workgraph_schema_migrations WHERE version = ?',
        current.version,
      ) as { checksum?: unknown } | undefined
      if (existing) {
        if (existing.checksum !== current.checksum) {
          throw new WorkGraphSchemaMismatchError()
        }
        continue
      }
      await transaction.exec(current.sql)
      await transaction.run(
        'INSERT INTO workgraph_schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
        current.version,
        current.checksum,
        Date.now(),
      )
    }
  })
  await apply.immediate()
}

async function validateSchema(database: WorkGraphDatabase): Promise<void> {
  for (const current of MIGRATIONS) {
    const row = await database.get(
      'SELECT checksum FROM workgraph_schema_migrations WHERE version = ?',
      current.version,
    ) as { checksum?: unknown } | undefined
    if (!row || row.checksum !== current.checksum) {
      throw new WorkGraphSchemaMismatchError()
    }
  }

  const highest = await readSchemaVersion(database)
  if (highest !== WORKGRAPH_SCHEMA_VERSION) {
    throw new WorkGraphSchemaMismatchError()
  }
}

async function readSchemaVersion(database: WorkGraphDatabase): Promise<number> {
  const row = await database.get('SELECT MAX(version) AS version FROM workgraph_schema_migrations') as { version?: unknown } | undefined
  return typeof row?.version === 'number' ? row.version : 0
}

async function readInstallationId(database: WorkGraphDatabase): Promise<string | null> {
  const row = await database.get("SELECT value FROM workgraph_meta WHERE key = 'installation_id'") as { value?: unknown } | undefined
  return typeof row?.value === 'string' && OPAQUE_ID.test(row.value) ? row.value : null
}

async function verifyIntegrity(database: WorkGraphDatabase): Promise<void> {
  const row = await database.get('PRAGMA integrity_check') as Record<string, unknown> | undefined
  const values = row ? Object.values(row) : []
  if (values.length !== 1 || values[0] !== 'ok') {
    throw new WorkGraphIntegrityError()
  }
}

function readProvisioningRecord(path: string): ProvisioningRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ProvisioningRecord>
    if (
      parsed.state !== 'provisioned'
      || parsed.relativeDatabaseFilename !== DATABASE_FILENAME
      || typeof parsed.installationId !== 'string'
      || !OPAQUE_ID.test(parsed.installationId)
    ) {
      return null
    }
    return {
      installationId: parsed.installationId,
      relativeDatabaseFilename: DATABASE_FILENAME,
      state: 'provisioned',
    }
  } catch {
    return null
  }
}

function validateCreateWorkItem(input: CreateWorkItemInput): Required<Omit<CreateWorkItemInput, 'projectId' | 'parentId' | 'correlationId'>> & Pick<CreateWorkItemInput, 'projectId' | 'parentId' | 'correlationId'> {
  assertOpaqueId(input.workspaceId, 'workspace ID')
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500) {
    throw new Error('Work item title must be a non-empty string up to 500 characters')
  }

  const status = input.status ?? 'todo'
  if (!['todo', 'in_progress', 'done', 'canceled'].includes(status)) {
    throw new Error('Work item status is invalid')
  }
  const priority = input.priority ?? 0
  const rank = input.rank ?? 0
  if (!Number.isSafeInteger(priority) || !Number.isSafeInteger(rank)) {
    throw new Error('Work item priority and rank must be safe integers')
  }
  if (input.dueAt != null && !Number.isSafeInteger(input.dueAt)) {
    throw new Error('Work item due date must be a UTC epoch millisecond value')
  }
  for (const [name, value] of [
    ['project ID', input.projectId],
    ['parent ID', input.parentId],
    ['correlation ID', input.correlationId],
  ] as const) {
    if (value != null) assertOpaqueId(value, name)
  }

  return {
    workspaceId: input.workspaceId,
    title: input.title.trim(),
    status,
    priority,
    dueAt: input.dueAt ?? null,
    rank,
    projectId: input.projectId ?? null,
    parentId: input.parentId ?? null,
    correlationId: input.correlationId ?? null,
  }
}

function assertOpaqueId(value: string, label: string): void {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
}

function rowToWorkItem(row: Record<string, unknown>): WorkItem {
  const requiredString = (key: string): string => {
    const value = row[key]
    if (typeof value !== 'string') throw new Error(`Invalid WorkGraph row field: ${key}`)
    return value
  }
  const requiredInteger = (key: string): number => {
    const value = row[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid WorkGraph row field: ${key}`)
    return value
  }

  return {
    id: requiredString('object_id'),
    workspaceId: requiredString('workspace_id'),
    title: requiredString('title'),
    status: requiredString('status') as WorkItemStatus,
    priority: requiredInteger('priority'),
    dueAt: row.due_at == null ? null : requiredInteger('due_at'),
    rank: requiredInteger('rank'),
    projectId: row.project_id == null ? null : requiredString('project_id'),
    parentId: row.parent_id == null ? null : requiredString('parent_id'),
    createdAt: requiredInteger('created_at'),
    updatedAt: requiredInteger('updated_at'),
  }
}

function rowToConnection(row: Record<string, unknown>): ConnectionRecord {
  const requiredString = (key: string): string => {
    const value = row[key]
    if (typeof value !== 'string') throw new Error(`Invalid WorkGraph row field: ${key}`)
    return value
  }
  const requiredInteger = (key: string): number => {
    const value = row[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid WorkGraph row field: ${key}`)
    return value
  }
  const scopesRaw = requiredString('scopes_json')
  const scopes = JSON.parse(scopesRaw) as unknown
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
    throw new Error('Invalid WorkGraph row field: scopes_json')
  }
  return {
    id: requiredString('id'),
    workspaceId: requiredString('workspace_id'),
    integrationId: requiredString('integration_id'),
    credentialRefId: requiredString('credential_ref_id'),
    storageMode: requiredString('storage_mode') as ConnectionStorageMode,
    scopes,
    createdAt: requiredInteger('created_at'),
    updatedAt: requiredInteger('updated_at'),
  }
}

function reasonForOpenError(error: unknown): WorkGraphAvailabilityReason {
  if (error instanceof WorkGraphSchemaMismatchError) return 'schema-mismatch'
  if (error instanceof WorkGraphIntegrityError) return 'integrity-check-failed'
  return 'database-open-failed'
}

function platformName(platform: WorkGraphPlatform): `${string}/${string}` {
  return `${platform.platform}/${platform.arch}`
}

function digest(value: unknown): string {
  const source = typeof value === 'string' ? value : JSON.stringify(value)
  return createHash('sha256').update(source).digest('hex')
}

class WorkGraphSchemaMismatchError extends Error {}
class WorkGraphIntegrityError extends Error {}

export {
  convertCopyToReferenceAndRevalidate,
  repairConnectionAndRevalidate,
  revokeConnectionAndRevalidate,
  revokeConnectionBindingAndRevalidate,
  rotateConnectionAndRevalidate,
} from './revalidation.ts'
export type {
  ConvertConnectionInput,
  RepairConnectionInput,
  RevokeBindingInput,
  RevokeConnectionInput,
  RevalidatedConsumer,
  RotateConnectionInput,
  WorkGraphRevokeSurface,
} from './revalidation.ts'
export { testGithubConnection } from './connection-test.ts'
export type { TestGithubConnectionInput } from './connection-test.ts'
export { isGithubEnvCandidate, performGithubUser, runGithubVertical } from './github-vertical.ts'
export type { GithubFetch, GithubVerticalInput, GithubVerticalResult } from './github-vertical.ts'
export { previewGithubEnvImport, commitGithubEnvImport } from './github-import.ts'
export type { GithubImportPreview } from './github-import.ts'
export { previewGitHelperImport, commitGitHelperImport } from './git-helper-import.ts'
export type { GitHelperImportPreview } from './git-helper-import.ts'
export {
  previewAdcImport,
  commitAdcImport,
  previewAwsProfileImport,
  commitAwsProfileImport,
  previewDockerHelperImport,
  commitDockerHelperImport,
  previewKeychainImport,
  commitKeychainImport,
  previewSshAgentImport,
  commitSshAgentImport,
} from './local-imports.ts'
export type { LocalImportPreview } from './local-imports.ts'
export { createConnectionGrant } from './create-grant.ts'
