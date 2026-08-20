/**
 * fts-index — SQLite FTS5 full-text index for the self-learning memory (spec M1).
 *
 * One index per scope's memory directory at {memoryDir}/index.db with three
 * virtual tables:
 *   lessons(rule, category, scope UNINDEXED, ts UNINDEXED, rule_key UNINDEXED)
 *   history(text, day UNINDEXED)
 *   context(text, kind UNINDEXED)   — kind: 'context' | 'preferences'
 *
 * Indexing is lazy at write time (hooks in LessonStore/MemoryFileStore); the
 * schema initializes on first open of a directory handle. Handles are cached
 * per memoryDir and reused; closeAll() drops the whole cache (tests).
 *
 * Failure contract: EVERYTHING here is fail-soft. Any sqlite error makes
 * search() return null so callers fall back to the recency path; upsert and
 * remove calls silently no-op. The index is a rebuildable projection of the
 * jsonl/markdown files — it must never break a write, a read, or a prompt
 * build.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import type { Lesson } from '@craft-agent/shared/memory/types'

/**
 * bun:sqlite доступен ТОЛЬКО под bun-рантаймом: electron-main (node) без lazy-резолва
 * падает на require ещё при загрузке бандла. Резолвим лениво и fail-soft, как и всё
 * остальное в этом файле: под node FTS выключен, search() отдаёт fallback на recency.
 */
type DatabaseCtor = new (path: string) => Database
let cachedCtor: DatabaseCtor | null | undefined
function getDatabaseCtor(): DatabaseCtor | null {
  if (cachedCtor === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cachedCtor = require('bun:sqlite').Database as DatabaseCtor
    } catch {
      cachedCtor = null
    }
  }
  return cachedCtor ?? null
}

/** Index file name inside each scope's memory directory. */
export const FTS_INDEX_FILE = 'index.db'

export interface FtsLessonHit {
  rule: string
  category: string
  scope: string
  ts: string
  /** FTS5 BM25 rank (lower = better). */
  rank: number
}

export interface FtsHistoryHit {
  day: string
  text: string
  rank: number
}

export interface FtsContextHit {
  kind: string
  text: string
  rank: number
}

export interface FtsSearchResult {
  lessons: FtsLessonHit[]
  history: FtsHistoryHit[]
  context: FtsContextHit[]
}

export interface FtsSearchOptions {
  /** Max rows returned per table (default 20). */
  limit?: number
}

const EMPTY_RESULT: FtsSearchResult = { lessons: [], history: [], context: [] }

/** Lazily-opened Database handles, keyed by the scope's memory directory. */
const handles = new Map<string, Database>()

function dbPathFor(memoryDir: string): string {
  return join(memoryDir, FTS_INDEX_FILE)
}

/** Open (and lazily schema-init) the index for a directory. Null on any error. */
function openFor(memoryDir: string): Database | null {
  const cached = handles.get(memoryDir)
  if (cached) return cached
  try {
    const Ctor = getDatabaseCtor()
    if (!Ctor) return null
    const db = new Ctor(dbPathFor(memoryDir))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(
      'CREATE VIRTUAL TABLE IF NOT EXISTS lessons USING fts5(rule, category, scope UNINDEXED, ts UNINDEXED, rule_key UNINDEXED)',
    )
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS history USING fts5(text, day UNINDEXED)')
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS "context" USING fts5(text, kind UNINDEXED)')
    handles.set(memoryDir, db)
    return db
  } catch {
    return null
  }
}

/** Normalize a rule to its dedup key (must mirror LessonStore.lessonKey). */
function keyOf(rule: string): string {
  return rule.trim().toLowerCase()
}

/**
 * Build a safe FTS5 MATCH expression from free-form user text: each token
 * becomes a quoted phrase (user text can never leak FTS5 syntax), OR'd for
 * best recall — BM25 orders the matches. '' when no usable tokens remain.
 */
function buildMatchQuery(query: string): string {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of query.split(/[^\p{L}\p{N}_]+/u)) {
    const term = raw.trim()
    if (!term) continue
    const folded = term.toLowerCase()
    if (seen.has(folded)) continue
    seen.add(folded)
    terms.push(term)
    if (terms.length >= 24) break
  }
  return terms.map(t => `"${t.replaceAll('"', '')}"`).join(' OR ')
}

/**
 * Ranked search over all three tables of one scope's index, BM25-ordered via
 * the FTS5 `rank` column (best first), each capped at `limit` rows.
 *
 * Returns null on ANY sqlite error (callers fall back to the recency path).
 * A missing index is NOT an error — it just means the scope was never
 * indexed, so empty arrays are returned without creating the db file.
 */
export function search(memoryDir: string, query: string, options: FtsSearchOptions = {}): FtsSearchResult | null {
  try {
    const match = buildMatchQuery(query)
    if (!match) return EMPTY_RESULT
    let db = handles.get(memoryDir)
    if (!db) {
      // Read path: never create the index on search.
      if (!existsSync(dbPathFor(memoryDir))) return EMPTY_RESULT
      db = openFor(memoryDir) ?? undefined
      if (!db) return null
    }
    const limit = options.limit ?? 20
    const lessons = db
      .query<FtsLessonHit, [string, number]>(
        'SELECT rule, category, scope, ts, rank FROM lessons WHERE lessons MATCH ? ORDER BY rank LIMIT ?',
      )
      .all(match, limit)
    const history = db
      .query<FtsHistoryHit, [string, number]>(
        'SELECT day, text, rank FROM history WHERE history MATCH ? ORDER BY rank LIMIT ?',
      )
      .all(match, limit)
    const context = db
      .query<FtsContextHit, [string, number]>(
        'SELECT kind, text, rank FROM "context" WHERE "context" MATCH ? ORDER BY rank LIMIT ?',
      )
      .all(match, limit)
    return { lessons, history, context }
  } catch {
    return null
  }
}

/** Insert-or-replace a lesson row (identity = normalized rule text). Never throws. */
export function upsertLesson(memoryDir: string, lesson: Lesson): void {
  try {
    const db = openFor(memoryDir)
    if (!db) return
    const key = keyOf(lesson.rule)
    db.run('DELETE FROM lessons WHERE rule_key = ?', [key])
    db.run('INSERT INTO lessons(rule, category, scope, ts, rule_key) VALUES (?, ?, ?, ?, ?)', [
      lesson.rule,
      lesson.category,
      lesson.scope,
      lesson.ts,
      key,
    ])
  } catch {
    // index is best-effort; the jsonl write already landed
  }
}

/** Remove a lesson row by (normalized or raw) rule text. Never throws. */
export function removeLesson(memoryDir: string, ruleKey: string): void {
  try {
    if (!handles.has(memoryDir) && !existsSync(dbPathFor(memoryDir))) return
    const db = openFor(memoryDir)
    if (!db) return
    db.run('DELETE FROM lessons WHERE rule_key = ?', [keyOf(ruleKey)])
  } catch {
    // best-effort
  }
}

/**
 * Insert-or-replace one daily-history document (identity = YYYY-MM-DD day).
 * Pass the FULL file content; empty content deletes the row. Never throws.
 */
export function upsertHistory(memoryDir: string, day: string, text: string): void {
  try {
    const db = openFor(memoryDir)
    if (!db) return
    db.run('DELETE FROM history WHERE day = ?', [day])
    if (text.trim()) db.run('INSERT INTO history(day, text) VALUES (?, ?)', [day, text])
  } catch {
    // best-effort
  }
}

/**
 * Insert-or-replace a whole context document (kind: 'context' for workspace
 * context.md, 'preferences' for global preferences.md; identity = kind).
 * Empty content deletes the row. Never throws.
 */
export function upsertContext(memoryDir: string, kind: 'context' | 'preferences', text: string): void {
  try {
    const db = openFor(memoryDir)
    if (!db) return
    db.run('DELETE FROM "context" WHERE kind = ?', [kind])
    if (text.trim()) db.run('INSERT INTO "context"(kind, text) VALUES (?, ?)', [kind, text])
  } catch {
    // best-effort
  }
}

/** Close every cached handle and drop the cache (tests). Never throws. */
export function closeAll(): void {
  for (const db of handles.values()) {
    try {
      db.close()
    } catch {
      // already closed / broken — the cache is dropped regardless
    }
  }
  handles.clear()
}
