import { Database } from './database-compat';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { AnyMemory, AuditEntry, MemoryQuery } from './types';

export const MEMORY_DB_FILENAME = 'memory.db';

type OpenOptions = {
  inMemory?: boolean;
};

export function openMemoryDatabase(dataDir?: string, options: OpenOptions = {}): Database {
  const dbPath = options.inMemory
    ? ':memory:'
    : dataDir
      ? join(dataDir, MEMORY_DB_FILENAME)
      : ':memory:';

  const db = new Database(dbPath, { create: true, readwrite: true });

  if (!options.inMemory && dbPath !== ':memory:') {
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA cache_size = -4000');

  return db;
}

export function bootstrapStorage(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      class TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.8,
      sensitivity TEXT NOT NULL DEFAULT 'internal',
      source_session_id TEXT,
      source_message_id TEXT,
      source_tool_call TEXT,
      source_import_origin TEXT,
      canconical_question text,
      session_id TEXT,
      outcome TEXT,
      category text,
      explicit INTEGER DEFAULT 1,
      key TEXT,
      triggers TEXT,
      success_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      ttl_days INTEGER,
      archive_on_supersede INTEGER DEFAULT 1,
      superseded_by_id TEXT,
      supersedes_ids TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      archived INTEGER DEFAULT 0,
      token_cost INTEGER,
      duration_seconds INTEGER,
      previous_values TEXT NOT NULL DEFAULT '[]',
      dependencies TEXT NOT NULL DEFAULT '[]',
      pitfalls TEXT NOT NULL DEFAULT '[]',
      checksum TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_index (
      memory_id TEXT PRIMARY KEY,
      fts_rowid INTEGER,
      class TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_id TEXT,
      sensitivity TEXT NOT NULL DEFAULT 'internal',
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER DEFAULT 0,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_index_fts (
      rowid INTEGER PRIMARY KEY,
      memory_id TEXT NOT NULL,
      title TEXT,
      content TEXT,
      canonical_question TEXT,
      triggers TEXT,
      key TEXT,
      category TEXT,
      tags TEXT,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_id ON memories(id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_class ON memories(class)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by_id)');

  db.run('CREATE INDEX IF NOT EXISTS idx_memory_index_class ON memory_index(class)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_index_scope ON memory_index(scope, scope_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_index_archived ON memory_index(archived)');

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_audit (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      action TEXT NOT NULL,
      previous_content TEXT,
      new_content TEXT,
      source_session_id TEXT,
      source_message_id TEXT,
      source_tool_call TEXT,
      source_import_origin TEXT,
      timestamp TEXT NOT NULL,
      actor TEXT,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_memory_audit_memory ON memory_audit(memory_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_audit_timestamp ON memory_audit(timestamp)');
}

export function createAuditEntry(db: Database, entry: AuditEntry) {
  const stmt = db.prepare(`
    INSERT INTO memory_audit (
      id, memory_id, action, previous_content, new_content,
      source_session_id, source_message_id, source_tool_call, source_import_origin,
      timestamp, actor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    entry.id,
    entry.memoryId,
    entry.action,
    entry.previousContent ?? null,
    entry.newContent ?? null,
    entry.source?.sessionId ?? null,
    entry.source?.messageId ?? null,
    entry.source?.toolCall ?? null,
    entry.source?.importOrigin ?? null,
    entry.timestamp,
    entry.actor ?? null,
  );

  return result;
}

export { type AnyMemory, type MemoryQuery };
