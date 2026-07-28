import { Database } from './database-compat';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { AnyMemory, AuditEntry, MemoryQuery } from './types';

export const MEMORY_DB_FILENAME = 'memory.db';

type OpenOptions = {
  inMemory?: boolean;
};

/**
 * Tokenizer note: `unicode61` is the default FTS5 tokenizer and lowercases
 * ASCII so we get case-insensitive exact-substring matches out of the box.
 * We stopped short of `porter` because Porter stemming breaks intended
 * matches on proper-noun / technical terms (e.g. "TypeScript" → "typ").
 * Memory panels search multi-word natural-language content where exact
 * terms (project names, env vars, file paths) matter as much as stems.
 */
const FTS_TOKENIZE = 'unicode61';

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

/**
 * Check whether a table of the given name exists in sqlite_master.
 * Used to detect the legacy plain-table `memory_index_fts` from older
 * installs so we can migrate it to a real FTS5 virtual table.
 */
function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { name: string } | undefined;
  return !!row;
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
      canonical_question TEXT,
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

  // Migration: legacy plain-table `memory_index_fts` (rows never written to,
  // never read from) is replaced by a real FTS5 virtual table. Drop any plain
  // table sitting under the same name and recreate it as a virtual table.
  // The migration is idempotent: a first-time install skips the DROP, a
  // re-bootstrap after the migration skips the entire block.
  if (tableExists(db, 'memory_index_fts')) {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get('memory_index_fts') as { sql: string | null } | undefined;
    const wasPlain = !row?.sql?.toUpperCase().includes('VIRTUAL');
    if (wasPlain) {
      db.run('DROP TABLE memory_index_fts');
    }
  }

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_index_fts USING fts5(
      memory_id UNINDEXED,
      title,
      content,
      canonical_question,
      triggers,
      key,
      category,
      tags,
      tokenize='${FTS_TOKENIZE}'
    )
  `);

  // Backfill: if any memories exist but the FTS index is empty, populate
  // it from the memories table. FTS5 assigns unique rowids per inserted row
  // automatically (no ON CONFLICT support in FTS5 — standard SQL syntax like
  // ON CONFLICT DO NOTHING throws a syntax error, so we use a plain INSERT).
  // memory_id collisions produce duplicate FTS rows that the search JOIN
  // back to memories.id resolves correctly.
  try {
    const ftsCount = (db.prepare('SELECT COUNT(*) AS n FROM memory_index_fts').get() as { n: number })?.n ?? 0;
    const memCount = (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number })?.n ?? 0;
    if (ftsCount === 0 && memCount > 0) {
      db.run(`
        INSERT INTO memory_index_fts (memory_id, title, content, canonical_question, triggers, key, category, tags)
        SELECT id, title, content, canonical_question, triggers, key, category, tags FROM memories
      `);
    }
  } catch {
    // swallow — first-time installs may not yet have the FTS table; the
    // repository populates rows as memories are created.
  }

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_id ON memories(id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_class ON memories(class)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by_id)');

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

export { type AnyMemory, type MemoryQuery } from './types';
