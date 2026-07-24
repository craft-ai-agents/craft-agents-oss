import crypto from 'node:crypto';
import { Database } from './database-compat';
import { openMemoryDatabase, bootstrapStorage, createAuditEntry } from './database';
import type { AnyMemory, AuditEntry, MemoryQuery } from './types';

type SerializableSource = NonNullable<AnyMemory['source']>;

function memoryTitleEq(query: MemoryQuery): string {
  const queries: string[] = [];
  if (typeof query.class !== 'undefined') {
    queries.push(`class = '${Array.isArray(query.class) ? query.class[0] : query.class}'`);
  }
  if (typeof query.scope !== 'undefined') {
    queries.push(`scope = '${Array.isArray(query.scope) ? query.scope[0] : query.scope}'`);
  }
  if (typeof query.scopeId !== 'undefined') {
    queries.push(`scope_id = '${query.scopeId}'`);
  }
  if (typeof query.minConfidence !== 'undefined') {
    queries.push(`confidence >= ${query.minConfidence}`);
  }
  if (query.includeArchived !== true) {
    queries.push(`archived = 0`);
  }
  return queries.length > 0 ? 'AND ' + queries.join(' AND ') : '';
}

type MemoryDiff = {
  previous: Partial<AnyMemory> | undefined;
  next: Partial<AnyMemory>;
};

export class MemoryRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  static createMemoryRepository(db: Database) {
    return new MemoryRepository(db);
  }

  getMemory(id: string): AnyMemory | undefined {
    const row = this.db.prepare(`
      SELECT memories.* FROM memories
      LEFT JOIN memory_index ON memory_index.memory_id = memories.id
      WHERE memories.id = ? AND memory_index.archived = 0
    `).get(id) as any;

    if (!row) return undefined;
    return this.hydrateMemory(row);
  }

  // In a full implementation this handles all filters with optional arrays, joins, order_by, and pagination.
  // For now it returns the active memories in insertion order.
  listMemories(): AnyMemory[] {
    const stmt = this.db.prepare(`
      SELECT memories.* FROM memories
      LEFT JOIN memory_index ON memory_index.memory_id = memories.id
      WHERE memories.archived = 0 AND memory_index.archived = 0
      ORDER BY datetime(memories.created_at) DESC
    `);

    return stmt.all().map((row: any) => this.hydrateMemory(row));
  }

  createMemory(memory: AnyMemory, auditEntry?: AuditEntry): AnyMemory {
    const result = this.createMemoryInTransaction(memory);
    if (auditEntry) {
      createAuditEntry(this.db, auditEntry);
    }
    return result;
  }

  updateMemory(id: string, patch: Partial<AnyMemory>, auditEntry?: AuditEntry): AnyMemory {
    const diff: MemoryDiff = {
      previous: this.getMemory(id),
      next: patch,
    };

    const existed = this.db.prepare(`SELECT id FROM memories WHERE id = ?`).get(id) as any;
    if (!existed) {
      throw new Error(`Memory not found for id=${id}`);
    }

    const current = this.getMemory(id);

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of Object.keys(patch)) {
      fields.push(`${key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())} = ?`);
      values.push(JSON.stringify((patch as any)[key]));
    }

    fields.push(`updated_at = ?`);
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const updated = this.getMemory(id);
    if (!updated) {
      throw new Error(`Memory update failed for id=${id}`);
    }

    if (auditEntry) {
      createAuditEntry(this.db, auditEntry);
    }

    return updated;
  }

  supersedeMemory(memoryId: string, supersededById: string, auditEntry?: AuditEntry): AnyMemory {
    const now = new Date().toISOString();
    const updated = this.updateMemory(memoryId, { supersededById }, auditEntry);
    return updated;
  }

  archiveMemory(memoryId: string, auditEntry?: AuditEntry): AnyMemory {
    return this.updateMemory(memoryId, { archived: true }, auditEntry);
  }

  restoreMemory(memoryId: string, auditEntry?: AuditEntry): AnyMemory {
    return this.updateMemory(memoryId, { archived: false, supersededById: undefined }, auditEntry);
  }

  deleteMemory(memoryId: string): void {
    const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
    if (result.changes === 0) {
      throw new Error(`Memory not found for delete, id=${memoryId}`);
    }
  }

  private createMemoryInTransaction(memory: AnyMemory): AnyMemory {
    const row = this.mapMemoryToRow(memory);

    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, class, scope, scope_id, title, content, confidence, sensitivity,
        source_session_id, source_message_id, source_tool_call, source_import_origin,
        canconical_question, session_id, outcome, category, explicit,
        key, triggers, success_count,
        created_at, updated_at,
        expires_at, ttl_days, archive_on_supersede,
        superseded_by_id, supersedes_ids, tags,
        token_cost, duration_seconds,
        previous_values, dependencies, pitfalls, checksum
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?,
          ?,
          ?, ?,
          ?, ?,
          ?, ?
      )
    `);

    stmt.run(
      row.id, row.class, row.scope, row.scopeId, row.title, row.content, row.confidence, row.sensitivity,
      row.sourceSessionId, row.sourceMessageId, row.sourceToolCall, row.sourceImportOrigin,
      row.canonicalQuestion, row.sessionId, row.outcome, row.category, row.explicit,
      row.key, [], row.successCount,
      row.createdAt, row.updatedAt,
      row.expiresAt, row.ttlDays, row.archiveOnSupersede,
      row.supersededById, row.supersedesIds, row.tags,
      row.tokenCost, row.durationSeconds,
      JSON.stringify(row.previousValues), JSON.stringify(row.dependencies), JSON.stringify(row.pitfalls), row.checksum
    );

    return memory;
  }

  private mapMemoryToRow(memory: AnyMemory) {
    const base = {
      id: memory.id,
      class: memory.class,
      scope: memory.scope,
      scopeId: memory.scopeId ?? null,
      title: memory.title,
      content: memory.content,
      confidence: memory.confidence,
      sensitivity: memory.sensitivity,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      expiresAt: (memory.expiry?.expiresAt) ?? null,
      ttlDays: memory.expiry?.ttlDays ?? null,
      archiveOnSupersede: memory.expiry?.archiveOnSupersede ? 1 : 0,
      supersededById: memory.supersededById ?? null,
      supersedesIds: JSON.stringify(memory.supersedesIds ?? []),
      tags: JSON.stringify(memory.tags ?? []),
      previousValues: [],
      dependencies: [],
      pitfalls: [],
      checksum: null,
      tokenCost: (memory as any).tokenCost ?? null,
      durationSeconds: (memory as any).durationSeconds ?? null,
      canonicalQuestion: (memory as any).canonicalQuestion ?? null,
      sessionId: (memory as any).sessionId ?? null,
      outcome: (memory as any).outcome ?? null,
      category: (memory as any).category ?? null,
      explicit: (memory as any).explicit ? 1 : 0,
      key: (memory as any).key ?? null,
      successCount: (memory as any).successCount ?? 0,
      sourceSessionId: memory.source?.sessionId ?? null,
      sourceMessageId: memory.source?.messageId ?? null,
      sourceToolCall: memory.source?.toolCall ?? null,
      sourceImportOrigin: memory.source?.importOrigin ?? null,
    };

    return base;
  }

  private hydrateMemory(row: any): AnyMemory {
    const base = {
      id: row.id,
      class: row.class,
      scope: row.scope,
      scopeId: row.scopeId,
      title: row.title,
      content: row.content,
      confidence: row.confidence,
      sensitivity: row.sensitivity,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiry: {
        expiresAt: row.expires_at,
        ttlDays: row.ttl_days,
        archiveOnSupersede: row.archive_on_supersede === 1,
      } as any,
      supersededById: row.superseded_by_id,
      supersedesIds: JSON.parse(row.supersedes_ids) as string[],
      tags: JSON.parse(row.tags) as string[],
      source: {
        sessionId: row.source_session_id,
        messageId: row.source_message_id,
        toolCall: row.source_tool_call,
        importOrigin: row.source_import_origin,
      } as SerializableSource,
      archived: row.archived === 1,
    };

    const cls = row.class as 'profile' | 'semantic' | 'episodic' | 'procedural';

    if (cls === 'profile') {
      return {
        ...base,
        class: 'profile',
        key: row.key,
        previousValues: JSON.parse(row.previous_values),
      } as any;
    }

    if (cls === 'semantic') {
      return {
        ...base,
        class: 'semantic',
        category: row.category,
        explicit: row.explicit === 1,
        canonicalQuestion: row.canonical_question,
      } as any;
    }

    if (cls === 'episodic') {
      return {
        ...base,
        class: 'episodic',
        sessionId: row.sessionId,
        outcome: row.outcome,
        decisions: [],
        artifacts: [],
        tokenCost: row.token_cost,
        durationSeconds: row.duration_seconds,
      } as any;
    }

    if (cls === 'procedural') {
      return {
        ...base,
        class: 'procedural',
        triggers: [],
        steps: [],
        successCount: row.success_count,
        pitfalls: [],
        dependencies: [],
      } as any;
    }

    throw new Error(`Unknown memory class: ${cls}`);
  }
}

export type { MemoryQuery } from './types';
