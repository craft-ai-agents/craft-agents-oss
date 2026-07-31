import { Database } from './database-compat';
import { createAuditEntry } from './database';
import type { AnyMemory, AuditEntry, MemoryEdge, MemoryGraphData, MemoryQuery, MemorySearchResult } from './types';
import type { VaultFileRecord } from './obsidian-sync';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

type SerializableSource = NonNullable<AnyMemory['source']>;

/**
 * Columns stored as JSON-as-text. Only these columns need JSON.stringify when
 * written (and JSON.parse on read). All other columns accept native values
 * (numbers, booleans, plain strings) so SQLite types match the column affinity.
 */
const JSON_TEXT_COLUMNS = new Set<string>([
  'supersedes_ids',
  'tags',
  'previous_values',
  'dependencies',
  'pitfalls',
  'triggers',
]);

/**
 * Escape a user-supplied FTS5 query string so a stray `:` / `(` / `*` doesn't
 * throw a syntax error. We wrap each whitespace-separated token in double
 * quotes for an exact-phrase token, which still feeds bm25 correctly. The
 * caller is still free to pass structured FTS5 syntax if they want
 * stemming-on-demand; we default to safe tokenization.
 */
function buildFtsMatch(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      // Drop characters FTS5 reserves as syntax. Quoted token is enough.
      const cleaned = tok.replace(/['"]/g, '');
      if (!cleaned) return null;
      return `"${cleaned}"`;
    })
    .filter((t): t is string => t !== null);
  return tokens.join(' ');
}

/**
 * Tag-list parser used by the vault importer. Three shapes of input are
 * accepted so existing hand-edited vault files still round-trip:
 *   1. JSON array — `"[\"a\",\"b\"]"` (new writer format)
 *   2. Comma-separated — `"a, b"` (legacy user edits)
 *   3. Space-separated — `"a b"` (fallback)
 * Empty / pure-whitespace returns `[]`.
 */
function parseTagsField(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  // Strip YAML inline-list brackets if a hand-edited vault file wrote
  // `tags: [a, b]` instead of the writer's JSON-array form. Without this
  // strip the comma branch returns `['[a', 'b]']` and the brackets leak
  // into every downstream consumer (FTS tags column, panel chips, etc.).
  let cleaned = raw.trim();
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
  } catch {
    // Not JSON — try the legacy delimiters below.
  }
  if (cleaned.includes(',')) {
    return cleaned.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return cleaned.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * JSON-list parser for class-specific procedural fields (triggers, pitfalls,
 * dependencies). Tolerates empty strings and a missing list — returns `[]`
 * instead of throwing so a single blank frontmatter doesn't poison the
 * whole import.
 */
function parseJsonField(raw: string): unknown[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// `memory_index` removed in favor of `memory_index_fts` (real FTS5 virtual
// table). Helpers `memoryTitleEq` etc. used to build hand-rolled WHERE
// clauses from `MemoryQuery`; with FTS5 + bm25 in searchMemories the
// filtering is now done in SQL with proper parameter binding, so we delete
// the unsafe string-interpolating helper.

export class MemoryRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  static createMemoryRepository(db: Database) {
    return new MemoryRepository(db);
  }

  /**
   * Close the underlying SQLite connection. WAL checkpoints are written and
   * the lock released. Safe to call multiple times (bun:sqlite / node:sqlite
   * close() is idempotent on an already-closed handle).
   */
  close(): void {
    this.db.close();
  }

  /**
   * Return aggregate statistics about the memory store for the stats dashboard.
   *
   * - classDistribution: count of active memories per class.
   * - ftsHealth: comparison of FTS index rows vs. memories table rows (a gap
   *   means some memories are missing from the FTS index and won't be found
   *   by `memory_search`).
   * - vault: vault root path, file count on disk, and last import time from
   *   the audit log.
   */
  getMemoryStats(vaultRoot?: string): {
    classDistribution: Record<string, number>;
    totalActive: number;
    totalArchived: number;
    ftsHealth: { memoriesRows: number; ftsRows: number; healthy: boolean };
    vault: { root: string; filesOnDisk: number; lastImportAt: string | null };
    graph: { edgeCount: number; edgeTypeDistribution: Record<string, number> };
  } {
    // Class distribution (active only)
    const classRows = this.db.prepare(`
      SELECT class, COUNT(*) AS n FROM memories WHERE archived = 0 GROUP BY class ORDER BY class
    `).all() as Array<{ class: string; n: number }>;
    const classDistribution: Record<string, number> = {};
    for (const r of classRows) classDistribution[r.class] = r.n;

    const totalRow = this.db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE archived = 0`).get() as { n: number };
    const archivedRow = this.db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE archived = 1`).get() as { n: number };

    // FTS index health
    const memCount = (this.db.prepare(`SELECT COUNT(*) AS n FROM memories`).get() as { n: number })?.n ?? 0;
    const ftsCount = (this.db.prepare(`SELECT COUNT(*) AS n FROM memory_index_fts`).get() as { n: number })?.n ?? 0;

    // Vault: count files on disk
    let filesOnDisk = 0;
    if (vaultRoot) {
      try {
        for (const cls of ['profile', 'semantic', 'episodic', 'procedural']) {
          const dir = join(vaultRoot, cls);
          if (existsSync(dir)) {
            for (const _f of readdirSync(dir)) {
              if (_f.endsWith('.md')) filesOnDisk++;
            }
          }
        }
      } catch {
        // Non-fatal: vault disk stats unavailable
      }
    }

    // Last import time from audit log
    const lastAudit = this.db.prepare(`
      SELECT timestamp FROM memory_audit WHERE action = 'import' ORDER BY datetime(timestamp) DESC LIMIT 1
    `).get() as { timestamp: string } | undefined;

    const edgeRows = this.db.prepare(`
      SELECT type, COUNT(*) AS n FROM memory_edges GROUP BY type ORDER BY type
    `).all() as Array<{ type: string; n: number }>;
    const edgeTypeDistribution: Record<string, number> = {};
    for (const row of edgeRows) edgeTypeDistribution[row.type] = row.n;
    const edgeCount = edgeRows.reduce((sum, row) => sum + row.n, 0);

    return {
      classDistribution,
      totalActive: totalRow.n,
      totalArchived: archivedRow.n,
      ftsHealth: {
        memoriesRows: memCount,
        ftsRows: ftsCount,
        healthy: memCount === ftsCount,
      },
      vault: {
        root: vaultRoot ?? '(not configured)',
        filesOnDisk,
        lastImportAt: lastAudit?.timestamp ?? null,
      },
      graph: {
        edgeCount,
        edgeTypeDistribution,
      },
    };
  }

  listMemoryEdges(): MemoryEdge[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_edges ORDER BY datetime(created_at) ASC, id ASC
    `).all() as any[];
    return rows.map((row) => this.hydrateEdge(row));
  }

  getMemoryGraph(): MemoryGraphData {
    return {
      memories: this.listMemories(),
      edges: this.listMemoryEdges(),
    };
  }

  getMemory(id: string): AnyMemory | undefined {
    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `).get(id) as any;

    if (!row) return undefined;
    if (row.archived === 1) return undefined;
    return this.hydrateMemory(row);
  }

  // In a full implementation this handles all filters with optional arrays, joins, order_by, and pagination.
  // For now it returns the active memories ordered by most-recently-created.
  listMemories(): AnyMemory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE archived = 0 ORDER BY datetime(created_at) DESC
    `);

    return stmt.all().map((row: any) => this.hydrateMemory(row));
  }

  createMemory(memory: AnyMemory, auditEntry?: AuditEntry): AnyMemory {
    // Wrap (memories INSERT, FTS INDEX INSERT, audit INSERT) in an explicit
    // BEGIN/COMMIT. A throw from any of those three issues a ROLLBACK so we
    // never leave a memory row whose FTS index is missing \u2014 the row would
    // silently disappear from every subsequent search.
    this.db.run('BEGIN');
    try {
      const result = this.insertMemoryRow(memory);
      this.populateFts(result);
      this.reconcileEdgesForMemory(result);
      if (auditEntry) {
        createAuditEntry(this.db, auditEntry);
      }
      this.db.run('COMMIT');
      return result;
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }

  updateMemory(id: string, patch: Partial<AnyMemory>, auditEntry?: AuditEntry): AnyMemory {
    const existed = this.db.prepare(`SELECT id FROM memories WHERE id = ?`).get(id) as any;
    if (!existed) {
      throw new Error(`Memory not found for id=${id}`);
    }

    const fields: string[] = [];
    const values: any[] = [];

    // Properties that exist only in-memory (reconstructed by hydrateMemory)
    // and have no corresponding DB column. Silently skip them so an UPDATE
    // from the IPC handler doesn't crash with "no such column" when the
    // renderer accidentally includes them in the patch.
    const IN_MEMORY_ONLY = new Set(['decisions', 'artifacts', 'steps']);

    for (const key of Object.keys(patch)) {
      if (IN_MEMORY_ONLY.has(key)) continue;

      // Flatten nested objects: `source` and `expiry` are stored as flat
      // prefix-based columns in the DB (e.g. source_session_id, expires_at).
      // The regex-based camelCase→snake_case below only handles flat keys.
      if (key === 'source') {
        const src = (patch as any).source as Record<string, unknown> | undefined;
        if (src && typeof src === 'object' && !Array.isArray(src)) {
          if ('sessionId' in src) { fields.push('source_session_id = ?'); values.push((src as any).sessionId ?? null); }
          if ('messageId' in src) { fields.push('source_message_id = ?'); values.push((src as any).messageId ?? null); }
          if ('toolCall' in src) { fields.push('source_tool_call = ?'); values.push((src as any).toolCall ?? null); }
          if ('importOrigin' in src) { fields.push('source_import_origin = ?'); values.push((src as any).importOrigin ?? null); }
        }
        continue;
      }

      if (key === 'expiry') {
        const ep = (patch as any).expiry as Record<string, unknown> | undefined;
        if (ep && typeof ep === 'object' && !Array.isArray(ep)) {
          if ('expiresAt' in ep) { fields.push('expires_at = ?'); values.push((ep as any).expiresAt ?? null); }
          if ('ttlDays' in ep) { fields.push('ttl_days = ?'); values.push((ep as any).ttlDays ?? null); }
          if ('archiveOnSupersede' in ep) { fields.push('archive_on_supersede = ?'); values.push((ep as any).archiveOnSupersede ? 1 : 0); }
        }
        continue;
      }

      const column = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      const value = (patch as any)[key];
      fields.push(`${column} = ?`);
      if (value === undefined) {
        // `restoreMemory` deliberately patches `supersededById` to undefined to
        // clear it; map that to SQL NULL instead of binding an undefined value
        // (which sqlite treats as TEXT 'undefined').
        values.push(null);
      } else if (JSON_TEXT_COLUMNS.has(column)) {
        values.push(JSON.stringify(value));
      } else {
        // Pass native values for INTEGER / REAL / plain TEXT columns. The previous
        // implementation JSON.stringified everything, which silently corrupted
        // boolean and number columns (e.g. `archived: true` was written as the
        // text "true", defeating `row.archived === 1` on read).
        values.push(value);
      }
    }

    fields.push(`updated_at = ?`);
    values.push(new Date().toISOString());
    values.push(id);

    // Same atomicity as createMemory: the UPDATE, the FTS reindex, and the
    // audit entry are wrapped so a crash partway through never leaves the
    // row's FTS index inconsistent with its memories row.
    this.db.run('BEGIN');
    try {
      this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      // Re-fetch *without the archive filter*: an archive/restore update flips
      // the row's `archived` flag, and `getMemory()` hides archived rows, so it
      // would return undefined and falsely throw "Memory update failed". The
      // hydrate step still produces a full AnyMemory (with `archived` reflecting
      // the post-update state) so callers can react to it.
      const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as any;
      if (!row) {
        throw new Error(`Memory update failed for id=${id}`);
      }
      const updated = this.hydrateMemory(row);

      this.populateFts(updated);
      this.reconcileEdgesForMemory(updated);

      if (auditEntry) {
        createAuditEntry(this.db, auditEntry);
      }
      this.db.run('COMMIT');
      return updated;
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }

  supersedeMemory(memoryId: string, supersededById: string, auditEntry?: AuditEntry): AnyMemory {
    return this.updateMemory(memoryId, { supersededById }, auditEntry);
  }

  archiveMemory(memoryId: string, auditEntry?: AuditEntry): AnyMemory {
    return this.updateMemory(memoryId, { archived: true }, auditEntry);
  }

  restoreMemory(memoryId: string, auditEntry?: AuditEntry): AnyMemory {
    return this.updateMemory(memoryId, { archived: false, supersededById: undefined }, auditEntry);
  }

  /**
   * Map a flat Obsidian vault record (frontmatter + body) into a typed
   * `AnyMemory`. Class-specific fields (key, category, triggers, etc.)
   * are pulled out of the frontmatter in branch-specific blocks; the body
   * becomes `content`. Source attribution is stamped `obsidian` so an
   * imported row's audit trail says where it came from.
   *
   * Returns `{ memory }` on success or `{ error: { message } }` on parse
   * failure. The caller (typically `importMemories`) collects errors into
   * its stats return rather than throwing — partial-import is more
   * useful than abort-all when one vault file is malformed.
   */
  parseVaultRecord(record: VaultFileRecord):
    | { memory: AnyMemory }
    | { error: { message: string; field?: string } }
  {
    const fm = record.frontmatter;
    const base: any = {
      id: fm.id ?? record.filePath,
      class: fm.class,
      scope: fm.scope ?? 'global',
      scopeId: fm.scopeId || undefined,
      title: (record.body.match(/^#\s*(.+)$/m)?.[1] ?? '').trim() || fm.id || 'Untitled',
      content: record.body
        .replace(/^#\s*.+\n*/m, '')
        .replace(/\n*Tags:\s*#[\s\S]*$/m, '')
        .trim(),
      confidence: fm.confidence ? Number(fm.confidence) : 0.8,
      sensitivity: (fm.sensitivity ?? 'internal'),
      source: {
        sessionId: fm.source_session || undefined,
        messageId: fm.source_message || undefined,
        importOrigin: 'obsidian',
      },
      createdAt: fm.createdAt || new Date().toISOString(),
      updatedAt: fm.updatedAt || fm.createdAt || new Date().toISOString(),
      archived: fm.archived === 'true' || fm.archived === '1',
      tags: parseTagsField(fm.tags ?? ''),
    };

    const cls = fm.class;
    if (!cls) return { error: { message: `missing 'class' field`, field: 'class' } };

    if (cls === 'profile') {
      if (!fm.key) return { error: { message: `profile memory missing 'key' field`, field: 'key' } };
      base.key = fm.key;
      base.previousValues = [];
      return { memory: base as AnyMemory };
    }
    if (cls === 'semantic') {
      if (!fm.category) return { error: { message: `semantic memory missing 'category' field`, field: 'category' } };
      base.category = fm.category;
      base.explicit = fm.explicit !== 'false' && fm.explicit !== '0';
      base.canonicalQuestion = fm.canonicalQuestion || fm.canonical_question || undefined;
      return { memory: base as AnyMemory };
    }
    if (cls === 'episodic') {
      if (fm.sessionId === undefined) return { error: { message: `episodic memory missing 'sessionId' field`, field: 'sessionId' } };
      // outcome distinguished from key-absence: an in-progress episodic
      // memory legitimately has an empty `outcome:` line (writer emits an
      // empty string for null/undefined values). Treating empty as falsy
      // here would falsely reject every in-progress session. Only an
      // ABSENT key triggers the parse error; an empty value stays as `''`.
      if (fm.outcome === undefined) return { error: { message: `episodic memory missing 'outcome' field`, field: 'outcome' } };
      base.sessionId = fm.sessionId;
      base.outcome = fm.outcome;
      base.decisions = [];
      base.artifacts = [];
      if (fm.tokenCost) base.tokenCost = Number(fm.tokenCost);
      if (fm.durationSeconds) base.durationSeconds = Number(fm.durationSeconds);
      return { memory: base as AnyMemory };
    }
    if (cls === 'procedural') {
      base.triggers = parseJsonField(fm.triggers ?? '[]');
      base.steps = [];
      base.successCount = fm.successCount ? Number(fm.successCount) : 0;
      base.pitfalls = parseJsonField(fm.pitfalls ?? '[]');
      base.dependencies = parseJsonField(fm.dependencies ?? '[]');
      return { memory: base as AnyMemory };
    }
    return { error: { message: `unknown class '${cls}'`, field: 'class' } };
  }

  /**
   * Bulk-import N memory records from the Obsidian vault. Skip-dedupe is
   * keyed by `memory.id`: if a row with the same id already exists, it's
   * counted as `skipped` and not re-imported. Per-row failures (parse
   * errors, DB errors, anything thrown by `insertMemoryRow` / `populateFts`)
   * surface in `errors` rather than aborting the whole batch — a single
   * malformed file shouldn't block importing 99 siblings.
   *
   * Each successful row is audited with `action: 'import'`, `actor: <caller
   * supplied>`, `source.importOrigin: 'obsidian'` so the audit trail ties
   * rows back to their vault origin.
   *
   * Wrapped in one big BEGIN/COMMIT to keep the memories table + FTS index
   * consistent, with per-row SAVEPOINTs so a sub-row failure doesn't
   * poison the rest of the batch.
   */
  importMemories(
    records: VaultFileRecord[],
    actor: string,
  ): { imported: number; skipped: number; errors: Array<{ message: string; filePath?: string }> }
  {
    const stats = { imported: 0, skipped: 0, errors: [] as Array<{ message: string; filePath?: string }> };

    // Pre-load existing IDs in one query for fast dedupe without N lookup
    // round-trips. This is the only read issued outside the transaction.
    const existingIds = new Set(
      (this.db.prepare(`SELECT id FROM memories`).all() as Array<{ id: string }>).map((r) => r.id),
    );

    this.db.run('BEGIN');
    try {
      for (const record of records) {
        try {
          const parsed = this.parseVaultRecord(record);
          if ('error' in parsed) {
            stats.errors.push({ message: parsed.error.message, filePath: record.filePath });
            continue;
          }
          const memory = parsed.memory;
          if (existingIds.has(memory.id)) {
            stats.skipped++;
            continue;
          }
          // Per-row savepoint: a single failed row can be rolled back
          // without unwinding the rest of the import batch.
          this.db.run(`SAVEPOINT import_row`);
          try {
            this.insertMemoryRow(memory);
            this.populateFts(memory);
            this.reconcileEdgesForMemory(memory);
            createAuditEntry(this.db, {
              id: `audit:import:${memory.id}:${Date.now()}`,
              memoryId: memory.id,
              action: 'import',
              previousContent: undefined,
              newContent: `imported from obsidian vault (${record.filePath})`,
              source: { ...(memory.source ?? {}), importOrigin: 'obsidian' },
              timestamp: new Date().toISOString(),
              actor,
            });
            this.db.run(`RELEASE import_row`);
            existingIds.add(memory.id);
            stats.imported++;
          } catch (e) {
            this.db.run(`ROLLBACK TO import_row`);
            stats.errors.push({
              message: e instanceof Error ? e.message : String(e),
              filePath: record.filePath,
            });
          }
        } catch (e) {
          stats.errors.push({ message: e instanceof Error ? e.message : String(e), filePath: record.filePath });
        }
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    return stats;
  }

  deleteMemory(memoryId: string): void {
    // Wrap (memories DELETE, FTS DELETE) so a half-applied delete never
    // leaves memory_index_fts orphaned.
    this.db.run('BEGIN');
    try {
      const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
      if (result.changes === 0) {
        this.db.run('ROLLBACK');
        throw new Error(`Memory not found for delete, id=${memoryId}`);
      }
      // FTS5 rowids are independent of the memories table; we maintain a
      // mapping row keyed by UNINDEXED memory_id. Drop it so a delete +
      // reinsert cycle doesn't leave stale FTS hits.
      this.db.prepare(`DELETE FROM memory_index_fts WHERE memory_id = ?`).run(memoryId);
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }

  /**
   * Full-text search via FTS5 with bm25 ranking + snippet highlighting.
   *
   * Behavior matrix:
   * - `query.query` empty + filters → server-side filtered list (no FTS overhead).
   * - `query.query` non-empty → FTS5 MATCH + bm25 ranking + snippet, then
   *   in-memory filters applied for class/scope/tags/confidence because
   *   these predicates are cheap and don't combine well with bm25 in SQL
   *   without a tighter secondary index.
   * - Re-fetches each memory's full row from `memories` so the hydrated
   *   result reflects the latest fields (FTS only stores searchable text).
   *
   * Returns `MemorySearchResult[]` with `score = 1.0 - bm25` clamped to
   * [0, 1) — bm25 returns non-negative ranks where lower is better, so the
   * conventional "higher is more relevant" UI ordering wants this flip.
   */
  searchMemories(query: MemoryQuery): MemorySearchResult[] {
    const trimmedFts = query.query?.trim() ?? '';
    // Two physical branches (with/without FTS MATCH) need different tag-filter
    // strategy: FTS5 lets us MATCH the indexed `tags` column on memory_index_fts,
    // but the empty-FTS branch doesn't join that table. Pass the flag down so
    // buildSearchFilters writes a json_each-based filter for the empty-FTS case.
    const filters = this.buildSearchFilters(query, trimmedFts.length > 0);

    if (!trimmedFts) {
      // No FTS query — bypass FTS5 entirely, use a SQL WHERE on the canonical
      // memories filter columns. We expose this as MemorySearchResult[] with a
      // synthetic rank so the panel's rendering pipe is uniform.
      // Note: `archived = 0` is NOT hardcoded here — `buildSearchFilters`
      // emits it conditionally based on `query.includeArchived`.
      const rows = this.db.prepare(`
        SELECT * FROM memories WHERE 1 = 1 ${filters.whereSql} ORDER BY datetime(updated_at) DESC ${filters.limitOffset}
      `).all(...filters.params) as any[];
      return rows.map((row) => ({
        memory: this.hydrateMemory(row),
        // No text relevance when no FTS query; assign a recency-tied synthetic
        // score so the panel can still sort without a special case.
        score: 1 - (Date.now() - Date.parse(row.updated_at)) / (1000 * 60 * 60 * 24 * 365),
      }));
    }

    const matchExpr = buildFtsMatch(trimmedFts);
    if (!matchExpr) {
      // All user-supplied tokens failed the FTS sanitizer (e.g. only quotes).
      // Fall through to the no-FTS branch to avoid a syntax error.
      return this.searchMemories({ ...query, query: '' });
    }

    // FTS5 only lives in memory_index_fts — page 2 (0-indexed) is `content`,
    // which is the field the user is most likely matching on (snippet uses it).
    // `0` would highlight title. `2` is content.
    const rows = this.db.prepare(`
      SELECT
        memories.*,
        bm25(memory_index_fts) AS bm25_score,
        snippet(memory_index_fts, 2, '<mark>', '</mark>', '…', 16) AS content_snippet
      FROM memory_index_fts
      INNER JOIN memories ON memories.id = memory_index_fts.memory_id
      WHERE memory_index_fts MATCH ?
        ${filters.whereSql}
      ORDER BY bm25_score ASC
      ${filters.limitOffset}
    `).all(matchExpr, ...filters.params) as any[];

    return rows.map((row) => ({
      memory: this.hydrateMemory(row),
      // Clamp into [0, 1]: bm25 returns non-negative ranks where lower is
      // better, so the conventional "higher is more relevant" UI ordering
      // wants 1 - bm25. Floating-point edge case: a perfect single-row match
      // can produce bm25 slightly below 0 (e.g. -7e-7), making the score
      // slightly above 1. Clamp both ends.
      score: Math.min(1, Math.max(0, 1 - Number(row.bm25_score ?? 0))),
      snippet: row.content_snippet ?? undefined,
    }));
  }

  /**
   * @param forFtsPath  When true, emits clauses that reference the FTS5
   *   virtual table (e.g. `memory_index_fts.tags MATCH ?`). When false,
   *   emits SQL-1999 / json_each equivalents so the empty-FTS branch
   *   (which doesn't join memory_index_fts) keeps working.
   */
  private buildSearchFilters(query: MemoryQuery, forFtsPath: boolean): {
    whereSql: string;
    params: any[];
    limitOffset: string;
  } {
    const clauses: string[] = [];
    const params: any[] = [];

    if (typeof query.class !== 'undefined') {
      if (Array.isArray(query.class)) {
        if (query.class.length === 0) {
          clauses.push('1 = 0');
        } else {
          clauses.push(`memories.class IN (${query.class.map(() => '?').join(',')})`);
          params.push(...query.class);
        }
      } else {
        clauses.push(`memories.class = ?`);
        params.push(query.class);
      }
    }

    if (typeof query.scope !== 'undefined') {
      if (Array.isArray(query.scope)) {
        if (query.scope.length === 0) {
          clauses.push('1 = 0');
        } else {
          clauses.push(`memories.scope IN (${query.scope.map(() => '?').join(',')})`);
          params.push(...query.scope);
        }
      } else {
        clauses.push(`memories.scope = ?`);
        params.push(query.scope);
      }
    }

    if (typeof query.scopeId !== 'undefined') {
      clauses.push(`memories.scope_id = ?`);
      params.push(query.scopeId);
    }

    if (typeof query.minConfidence !== 'undefined') {
      clauses.push(`memories.confidence >= ?`);
      params.push(query.minConfidence);
    }

    if (query.includeArchived === true) {
      // nothing — show archived rows alongside active ones
    } else {
      clauses.push(`memories.archived = 0`);
    }

    if (query.tags && query.tags.length > 0) {
      // Filter on tags. Two strategies depending on which search branch is
      // running. The empty-FTS branch doesn't join memory_index_fts, so we
      // walk the JSON array stored in memories.tags directly.
      if (forFtsPath) {
        // AND-of-tags: every requested tag must appear in the indexed
        // `tags` column (whose entries are space-joined on insert).
        for (const tag of query.tags) {
          clauses.push(`memory_index_fts.tags MATCH ?`);
          params.push(`"${tag.replace(/['"]/g, '')}"`);
        }
      } else {
        for (const tag of query.tags) {
          clauses.push(`EXISTS (SELECT 1 FROM json_each(memories.tags) WHERE json_each.value = ?)`);
          params.push(tag);
        }
      }
    }

    if (typeof query.category === 'string' && query.category.length > 0) {
      clauses.push(`memories.category = ?`);
      params.push(query.category);
    }

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const limitOffset = `LIMIT ${limit} OFFSET ${offset}`;

    return {
      whereSql: clauses.length > 0 ? 'AND ' + clauses.join(' AND ') : '',
      params,
      limitOffset,
    };
  }

  /**
   * Insert/update the FTS5 row for a memory. The FTS table is keyed by FTS5
   * `rowid`. We use `INSERT OR REPLACE` keyed on `memory_id` to keep this
   * idempotent — but FTS5 doesn't enforce uniqueness on UNINDEXED columns,
   * so we DELETE the previous row first to guarantee exactly one FTS entry
   * per memory. Wrapped in a try/catch because SOFT-Texas cases (passing
   * non-string) used to crash the bug. The memory_id column is UNINDEXED,
   * title/content/etc. are tokenized.
   */
  private populateFts(memory: AnyMemory): void {
    // Drop any prior row for this memory_id so we never double-index.
    this.db.prepare(`DELETE FROM memory_index_fts WHERE memory_id = ?`).run(memory.id);

    const triggers = Array.isArray((memory as any).triggers)
      ? (memory as any).triggers.join(' ')
      : '';
    const tags = Array.isArray(memory.tags) ? memory.tags.join(' ') : '';
    const key = (memory as any).key ?? '';
    const category = (memory as any).category ?? '';
    const canonicalQuestion = (memory as any).canonicalQuestion ?? '';

    this.db.prepare(`
      INSERT INTO memory_index_fts (memory_id, title, content, canonical_question, triggers, key, category, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.title,
      memory.content,
      canonicalQuestion,
      triggers,
      key,
      category,
      tags,
    );
  }

  private insertMemoryRow(memory: AnyMemory): AnyMemory {
    const row = this.mapMemoryToRow(memory);

    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, class, scope, scope_id, title, content, confidence, sensitivity,
        source_session_id, source_message_id, source_tool_call, source_import_origin,
        canonical_question, session_id, outcome, category, explicit,
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
      row.key, row.triggers, row.successCount,
      row.createdAt, row.updatedAt,
      row.expiresAt, row.ttlDays, row.archiveOnSupersede,
      row.supersededById, row.supersedesIds, row.tags,
      row.tokenCost, row.durationSeconds,
      row.previousValues, row.dependencies, row.pitfalls, row.checksum
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
      // JSON-stringify every list-shaped column so bun:sqlite's strict
      // binding (string | TypedArray | boolean | number | bigint | null) is
      // never asked to bind a literal `[]`. Pass `null` when empty/absent.
      triggers: Array.isArray((memory as any).triggers) && (memory as any).triggers.length > 0
        ? JSON.stringify((memory as any).triggers)
        : null,
      previousValues: JSON.stringify((memory as any).previousValues ?? []),
      dependencies: JSON.stringify((memory as any).dependencies ?? []),
      pitfalls: JSON.stringify((memory as any).pitfalls ?? []),
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

  private reconcileEdgesForMemory(memory: AnyMemory): void {
    this.db.prepare(`
      DELETE FROM memory_edges WHERE source_memory_id = ? OR target_memory_id = ?
    `).run(memory.id, memory.id);

    const activeMemories = this.listMemories();
    const otherMemories = activeMemories.filter((candidate) => candidate.id !== memory.id);
    const memoryTags = new Set(memory.tags ?? []);

    for (const other of otherMemories) {
      const otherTags = other.tags ?? [];
      const sharedTagCount = otherTags.filter((tag) => memoryTags.has(tag)).length;
      const sameSession = !!memory.source?.sessionId && memory.source.sessionId === other.source?.sessionId;
      const referencesCurrent = other.supersededById === memory.id || (other.supersedesIds ?? []).includes(memory.id);

      if (sameSession) {
        this.upsertEdge(
          memory.id < other.id ? memory.id : other.id,
          memory.id < other.id ? other.id : memory.id,
          'same-session',
          0.5,
        );
      }
      if (sharedTagCount > 0) {
        this.upsertEdge(
          memory.id < other.id ? memory.id : other.id,
          memory.id < other.id ? other.id : memory.id,
          'same-tag',
          Math.min(sharedTagCount, 5),
        );
      }
      if (referencesCurrent) {
        this.upsertEdge(other.id, memory.id, 'supersedes', 1);
      }
    }

    if (memory.supersededById) {
      this.upsertEdge(memory.supersededById, memory.id, 'supersedes', 1);
    }
    for (const supersedesId of memory.supersedesIds ?? []) {
      this.upsertEdge(memory.id, supersedesId, 'supersedes', 1);
    }
  }

  private upsertEdge(
    sourceMemoryId: string,
    targetMemoryId: string,
    type: MemoryEdge['type'],
    weight: number,
    provenance: MemoryEdge['provenance'] = 'system',
  ): void {
    if (sourceMemoryId === targetMemoryId) return;
    const now = new Date().toISOString();
    const id = `edge:${type}:${sourceMemoryId}:${targetMemoryId}`;
    this.db.prepare(`
      INSERT INTO memory_edges (id, source_memory_id, target_memory_id, type, weight, provenance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_memory_id, target_memory_id, type)
      DO UPDATE SET weight = excluded.weight, provenance = excluded.provenance, updated_at = excluded.updated_at
    `).run(id, sourceMemoryId, targetMemoryId, type, weight, provenance, now, now);
  }

  private hydrateEdge(row: any): MemoryEdge {
    return {
      id: row.id,
      sourceMemoryId: row.source_memory_id,
      targetMemoryId: row.target_memory_id,
      type: row.type,
      weight: row.weight,
      provenance: row.provenance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateMemory(row: any): AnyMemory {
    // SQLite stores column names verbatim — the schema lowercases them with
    // explicit snake_case names (canonical_question, source_session_id,
    // session_id, etc.). Earlier reads of `row.sessionId` from a row that
    // returned `session_id` were silently `undefined`, which is why episodic
    // memories used to lose their sessionId back in the renderer. Read by
    // snake_case everywhere.
    const base = {
      id: row.id,
      class: row.class,
      scope: row.scope,
      scopeId: row.scope_id ?? null,
      title: row.title,
      content: row.content,
      confidence: row.confidence,
      sensitivity: row.sensitivity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
        sessionId: row.session_id,
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
        triggers: row.triggers ? JSON.parse(row.triggers) : [],
        steps: [],
        successCount: row.success_count,
        pitfalls: row.pitfalls ? JSON.parse(row.pitfalls) : [],
        dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      } as any;
    }

    throw new Error(`Unknown memory class: ${cls}`);
  }
}

export type { MemoryQuery, MemorySearchResult } from './types';
