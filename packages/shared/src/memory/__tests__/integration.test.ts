import { openMemoryDatabase, bootstrapStorage, createAuditEntry } from '../database';

describe('Memory integration: schema + CRUD in chat', () => {
  let db: ReturnType<typeof openMemoryDatabase>;

  beforeEach(() => {
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates expected tables (memories + memory_index_fts virtual + memory_audit)', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    // `memory_index` was deprecated; FTS5 backing table provides equivalent
    // searchability without the dead metadata table. Virtual tables show up
    // as type='table' in sqlite_master, so the new schema includes both
    // `memory_index_fts` and the legacy `memories` + audit table.
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['memories', 'memory_index_fts', 'memory_audit']),
    );
    expect(tables.map((t) => t.name)).not.toContain('memory_index');
  });

  it('inserts and reads back a memory', () => {
    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT INTO memories (id, class, scope, title, content, confidence, sensitivity, tags, archived, created_at, updated_at, archive_on_supersede, supersedes_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('mem:1', 'profile', 'global', 'User name', 'John Doe', 0.9, 'internal', '[]', '0', nowIso, nowIso, '1', '[]');

    const row = db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get('mem:1') as any;
    expect(row.title).toBe('User name');
    expect(row.content).toBe('John Doe');
  });

  it('archives mem1 in-place and verifies isolation', () => {
    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT INTO memories (id, class, scope, title, content, confidence, sensitivity, tags, archived, created_at, updated_at, archive_on_supersede, supersedes_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('mem:1', 'profile', 'global', 'User name', 'John Doe', 0.9, 'internal', '[]', '0', nowIso, nowIso, '1', '[]');

    // Use prepare+run, not db.run directly: database-compat's `db.run` only
    // takes a single sql arg; parameters can't be bound through `db.run`.
    // `prepare(...).run(...)` is the supported path going forward.
    db.prepare('UPDATE memories SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso, 'mem:1');

    const active = db.prepare('SELECT * FROM memories WHERE scope = ? AND archived = 0').all('global') as any[];
    expect(active).toHaveLength(0);
  });

  it('creates audit entry against an inserted memory', () => {
    // memory_audit has a hard foreign key to memories(id). Insert the parent
    // row before the audit entry so the FK constraint has a target.
    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT INTO memories (id, class, scope, title, content, confidence, sensitivity, tags, archived, created_at, updated_at, archive_on_supersede, supersedes_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('mem:1', 'profile', 'global', 'User name', 'John Doe', 0.9, 'internal', '[]', '0', nowIso, nowIso, '1', '[]');

    createAuditEntry(db, {
      id: 'audit:test:1',
      memoryId: 'mem:1',
      action: 'create',
      previousContent: undefined,
      newContent: 'Hello world',
      timestamp: new Date().toISOString(),
      actor: 'integration-test',
    });

    const audits = db.prepare('SELECT * FROM memory_audit WHERE memory_id = ?').all('mem:1') as any[];
    expect(audits).toHaveLength(1);
    expect(audits[0].new_content).toBe('Hello world');
  });
});
