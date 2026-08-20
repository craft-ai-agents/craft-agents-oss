/**
 * source-index — per-workspace SQLite FTS index for local source folders.
 *
 * Path: {workspaceRoot}/.craft/source-index.sqlite
 * Table files(path UNIQUE, hash, chars, tokens, mtime, body_text)
 * Optional FTS5 virtual table files_fts when available; LIKE fallback otherwise.
 *
 * bun:sqlite is lazy-required so electron-main (node) never crashes on load.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import type { Database } from 'bun:sqlite'

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

export const SOURCE_INDEX_REL = join('.craft', 'source-index.sqlite')

const TEXT_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.css',
  '.html',
  '.xml',
  '.csv',
  '.toml',
  '.ini',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
])

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.craft',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
])

const MAX_FILES = 2000
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_BODY_CHARS = 200_000

export interface SourceIndexFileRow {
  path: string
  hash: string
  chars: number
  tokens: number
  mtime: number
  body_text: string
}

export interface SourceSearchHit {
  path: string
  chars: number
  tokens: number
  mtime: number
  /** Short excerpt around the first match when available. */
  snippet: string
  rank: number
}

export interface SourceReindexResult {
  indexed: number
  skipped: number
  truncated: boolean
  dbPath: string
  fts: boolean
}

export interface SourceSearchResult {
  hits: SourceSearchHit[]
  total: number
  fts: boolean
  query: string
}

/** Retrieved hit with a budgeted excerpt for system-prompt injection. */
export interface SourceRetrieveHit {
  path: string
  excerpt: string
  rank: number
  tokens: number
}

export interface SourceRetrieveResult {
  hits: SourceRetrieveHit[]
  totalTokens: number
  query: string
}

/** Default token budget for source docs injected into the agent system prompt. */
export const SOURCE_RETRIEVE_MAX_TOKENS = 2000

/** Default max ranked hits considered before token budget fill. */
export const SOURCE_RETRIEVE_DEFAULT_LIMIT = 5

/** Cap on a single hit excerpt so one huge file cannot dominate the budget. */
const SOURCE_RETRIEVE_MAX_EXCERPT_CHARS = 4_000

const handles = new Map<string, { db: Database; fts: boolean }>()

function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

function indexPathFor(workspaceRoot: string): string {
  return join(workspaceRoot, SOURCE_INDEX_REL)
}

function isProbablyText(filePath: string, size: number): boolean {
  if (size <= 0 || size > MAX_FILE_BYTES) return false
  const ext = extname(filePath).toLowerCase()
  if (TEXT_EXTS.has(ext)) return true
  if (!ext && size < 64 * 1024) return true
  return false
}

function openDb(workspaceRoot: string): { db: Database; fts: boolean } | null {
  const cached = handles.get(workspaceRoot)
  if (cached) return cached
  try {
    const Ctor = getDatabaseCtor()
    if (!Ctor) return null
    const dbPath = indexPathFor(workspaceRoot)
    mkdirSync(dirname(dbPath), { recursive: true })
    const db = new Ctor(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY NOT NULL,
        hash TEXT NOT NULL,
        chars INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        mtime INTEGER NOT NULL DEFAULT 0,
        body_text TEXT NOT NULL DEFAULT ''
      )
    `)
    let fts = false
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
          path UNINDEXED,
          body_text,
          content='files',
          content_rowid='rowid'
        )
      `)
      // Keep FTS in sync via triggers when content= is used
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
          INSERT INTO files_fts(rowid, path, body_text) VALUES (new.rowid, new.path, new.body_text);
        END;
      `)
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
          INSERT INTO files_fts(files_fts, rowid, path, body_text) VALUES('delete', old.rowid, old.path, old.body_text);
        END;
      `)
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
          INSERT INTO files_fts(files_fts, rowid, path, body_text) VALUES('delete', old.rowid, old.path, old.body_text);
          INSERT INTO files_fts(rowid, path, body_text) VALUES (new.rowid, new.path, new.body_text);
        END;
      `)
      fts = true
    } catch {
      fts = false
    }
    const handle = { db, fts }
    handles.set(workspaceRoot, handle)
    return handle
  } catch {
    return null
  }
}

/** Walk a source tree and yield indexable file payloads (relative paths). */
export function walkSourceTree(root: string): {
  files: Array<{ absPath: string; relPath: string; mtime: number; body: string }>
  truncated: boolean
  skipped: number
} {
  const files: Array<{ absPath: string; relPath: string; mtime: number; body: string }> = []
  let truncated = false
  let skipped = 0
  let totalBytes = 0
  if (!existsSync(root)) return { files, truncated, skipped }

  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      skipped++
      continue
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.env.example') {
        // skip hidden except common examples; .craft already in SKIP_DIRS
      }
      if (SKIP_DIRS.has(ent.name)) continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!ent.isFile()) continue
      if (files.length >= MAX_FILES) {
        truncated = true
        return { files, truncated, skipped }
      }
      let st
      try {
        st = statSync(full)
      } catch {
        skipped++
        continue
      }
      if (!isProbablyText(full, st.size)) {
        skipped++
        continue
      }
      totalBytes += st.size
      if (totalBytes > MAX_TOTAL_BYTES) {
        truncated = true
        return { files, truncated, skipped }
      }
      let body = ''
      try {
        body = readFileSync(full, 'utf-8')
      } catch {
        skipped++
        continue
      }
      if (body.length > MAX_BODY_CHARS) {
        body = body.slice(0, MAX_BODY_CHARS)
      }
      const relPath = relative(root, full).split('\\').join('/')
      files.push({ absPath: full, relPath, mtime: Math.floor(st.mtimeMs), body })
    }
  }
  return { files, truncated, skipped }
}

/**
 * Index one root directory into the workspace source index.
 * Paths are stored as `{sourceSlug}/{relPath}` when sourceSlug is provided,
 * otherwise as absolute-relative under the given root label.
 */
export function indexSourceTree(
  workspaceRoot: string,
  root: string,
  options: { sourceSlug?: string; clearSource?: boolean } = {},
): SourceReindexResult {
  const handle = openDb(workspaceRoot)
  const dbPath = indexPathFor(workspaceRoot)
  if (!handle) {
    return { indexed: 0, skipped: 0, truncated: false, dbPath, fts: false }
  }
  const { db, fts } = handle
  const { files, truncated, skipped } = walkSourceTree(root)
  const prefix = options.sourceSlug ? `${options.sourceSlug}/` : ''

  try {
    if (options.clearSource && options.sourceSlug) {
      db.query('DELETE FROM files WHERE path = ? OR path LIKE ?').run(
        options.sourceSlug,
        `${options.sourceSlug}/%`,
      )
    }

    const upsert = db.query(`
      INSERT INTO files (path, hash, chars, tokens, mtime, body_text)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        hash = excluded.hash,
        chars = excluded.chars,
        tokens = excluded.tokens,
        mtime = excluded.mtime,
        body_text = excluded.body_text
    `)

    const tx = db.transaction(() => {
      for (const f of files) {
        const path = `${prefix}${f.relPath}`
        const hash = hashText(f.body)
        const chars = f.body.length
        const tokens = estimateTokens(f.body)
        upsert.run(path, hash, chars, tokens, f.mtime, f.body)
      }
    })
    tx()
  } catch {
    return { indexed: 0, skipped: skipped + files.length, truncated, dbPath, fts }
  }

  return {
    indexed: files.length,
    skipped,
    truncated,
    dbPath,
    fts,
  }
}

/** Rebuild index for multiple local roots: `{ slug, path }[]`. Clears previous rows. */
export function reindexWorkspaceSources(
  workspaceRoot: string,
  roots: Array<{ slug: string; path: string }>,
): SourceReindexResult {
  const handle = openDb(workspaceRoot)
  const dbPath = indexPathFor(workspaceRoot)
  if (!handle) {
    return { indexed: 0, skipped: 0, truncated: false, dbPath, fts: false }
  }

  try {
    handle.db.exec('DELETE FROM files')
    // Rebuild FTS content after bulk delete
    if (handle.fts) {
      try {
        handle.db.exec(`INSERT INTO files_fts(files_fts) VALUES('rebuild')`)
      } catch {
        // ignore rebuild failures; triggers will refill on insert
      }
    }
  } catch {
    // continue
  }

  let indexed = 0
  let skipped = 0
  let truncated = false
  let fts = handle.fts
  for (const root of roots) {
    const r = indexSourceTree(workspaceRoot, root.path, {
      sourceSlug: root.slug,
      clearSource: false,
    })
    indexed += r.indexed
    skipped += r.skipped
    truncated = truncated || r.truncated
    fts = fts || r.fts
  }
  return { indexed, skipped, truncated, dbPath, fts }
}

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
  return terms.map((t) => `"${t.replaceAll('"', '')}"`).join(' OR ')
}

function snippetFor(body: string, query: string, maxLen = 160): string {
  const q = query.trim().toLowerCase()
  if (!body) return ''
  const lower = body.toLowerCase()
  let idx = -1
  for (const token of q.split(/\s+/).filter(Boolean)) {
    idx = lower.indexOf(token.toLowerCase())
    if (idx >= 0) break
  }
  if (idx < 0) {
    return body.slice(0, maxLen).replace(/\s+/g, ' ').trim()
  }
  const start = Math.max(0, idx - 40)
  const end = Math.min(body.length, start + maxLen)
  const slice = body.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${end < body.length ? '…' : ''}`
}

/**
 * Keyword search over the workspace source index.
 * Prefers FTS5; falls back to LIKE on path/body_text.
 */
export function searchSourceIndex(
  workspaceRoot: string,
  query: string,
  options: { limit?: number } = {},
): SourceSearchResult {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
  const q = query.trim()
  const empty: SourceSearchResult = { hits: [], total: 0, fts: false, query: q }
  if (!q) return empty

  const dbPath = indexPathFor(workspaceRoot)
  if (!existsSync(dbPath)) return empty

  const handle = openDb(workspaceRoot)
  if (!handle) return empty
  const { db, fts } = handle

  try {
    if (fts) {
      const match = buildMatchQuery(q)
      if (!match) return empty
      const rows = db
        .query<
          { path: string; chars: number; tokens: number; mtime: number; body_text: string; rank: number },
          [string, number]
        >(
          `SELECT f.path, f.chars, f.tokens, f.mtime, f.body_text, files_fts.rank AS rank
           FROM files_fts
           JOIN files f ON f.rowid = files_fts.rowid
           WHERE files_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(match, limit)

      const hits: SourceSearchHit[] = rows.map((r) => ({
        path: r.path,
        chars: r.chars,
        tokens: r.tokens,
        mtime: r.mtime,
        snippet: snippetFor(r.body_text, q),
        rank: r.rank,
      }))
      return { hits, total: hits.length, fts: true, query: q }
    }

    // LIKE fallback
    const tokens = q
      .split(/[^\p{L}\p{N}_]+/u)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8)
    if (tokens.length === 0) return empty

    const clauses = tokens.map(() => `(path LIKE ? OR body_text LIKE ?)`)
    const params: Array<string | number> = []
    for (const t of tokens) {
      const like = `%${t.replaceAll('%', '').replaceAll('_', '')}%`
      params.push(like, like)
    }
    params.push(limit)

    const rows = db
      .query<
        { path: string; chars: number; tokens: number; mtime: number; body_text: string },
        Array<string | number>
      >(
        `SELECT path, chars, tokens, mtime, body_text FROM files
         WHERE ${clauses.join(' AND ')}
         LIMIT ?`,
      )
      .all(...params)

    const hits: SourceSearchHit[] = rows.map((r, i) => ({
      path: r.path,
      chars: r.chars,
      tokens: r.tokens,
      mtime: r.mtime,
      snippet: snippetFor(r.body_text, q),
      rank: i,
    }))
    return { hits, total: hits.length, fts: false, query: q }
  } catch {
    return empty
  }
}

/**
 * Fetch short body excerpts for ranked paths (top hits only). Fail-soft: any
 * SQL error yields an empty map and callers fall back to search snippets.
 */
function loadBodyExcerpts(
  workspaceRoot: string,
  paths: string[],
  query: string,
): Map<string, string> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const handle = openDb(workspaceRoot)
  if (!handle) return out
  try {
    const placeholders = paths.map(() => '?').join(', ')
    const rows = handle.db
      .query<{ path: string; body_text: string }, string[]>(
        `SELECT path, body_text FROM files WHERE path IN (${placeholders})`,
      )
      .all(...paths)
    for (const row of rows) {
      const body = row.body_text ?? ''
      if (!body) continue
      // Prefer a match-centered window; fall back to head when no match.
      const excerpt = snippetFor(body, query, SOURCE_RETRIEVE_MAX_EXCERPT_CHARS)
      if (excerpt) out.set(row.path, excerpt)
    }
  } catch {
    // fail-soft
  }
  return out
}

/**
 * Ranked source retrieve for agent system-prompt injection.
 * Greedy-fills hit excerpts by search rank until SOURCE_RETRIEVE_MAX_TOKENS
 * (or options.maxTokens). Fail-soft: missing index / blank query / errors →
 * empty hits (caller omits the prompt block).
 */
export function retrieveSourcesForPrompt(
  workspaceRoot: string,
  query: string,
  options: { limit?: number; maxTokens?: number } = {},
): SourceRetrieveResult {
  const q = (query ?? '').trim()
  const empty: SourceRetrieveResult = { hits: [], totalTokens: 0, query: q }
  if (!q || !workspaceRoot) return empty

  const limit = Math.max(1, Math.min(options.limit ?? SOURCE_RETRIEVE_DEFAULT_LIMIT, 20))
  const maxTokens = Math.max(1, options.maxTokens ?? SOURCE_RETRIEVE_MAX_TOKENS)

  let search: SourceSearchResult
  try {
    search = searchSourceIndex(workspaceRoot, q, { limit })
  } catch {
    return empty
  }
  if (!search.hits.length) return empty

  let bodies: Map<string, string>
  try {
    bodies = loadBodyExcerpts(
      workspaceRoot,
      search.hits.map((h) => h.path),
      q,
    )
  } catch {
    bodies = new Map()
  }

  const hits: SourceRetrieveHit[] = []
  let totalTokens = 0

  for (const hit of search.hits) {
    const raw =
      bodies.get(hit.path)?.trim() ||
      hit.snippet?.trim() ||
      ''
    if (!raw) continue

    // Header cost: "### path\n" plus blank line around the excerpt.
    const header = `### ${hit.path}\n`
    const headerTokens = estimateTokens(header)
    const remaining = maxTokens - totalTokens - headerTokens
    if (remaining <= 0) break

    let excerpt = raw
    let excerptTokens = estimateTokens(excerpt)
    if (excerptTokens > remaining) {
      // Reserve 1 token for the truncation marker when we slice.
      const bodyBudget = Math.max(0, remaining - 1)
      const charBudget = bodyBudget * 4
      if (charBudget < 24) {
        // Not enough room for a useful excerpt on a subsequent hit.
        if (hits.length > 0) break
        // First hit: take a minimal head so the block is non-empty.
        excerpt = `${raw.slice(0, Math.min(raw.length, 80)).trimEnd()}…`
        excerptTokens = estimateTokens(excerpt)
      } else {
        excerpt = `${raw.slice(0, charBudget).trimEnd()}…`
        excerptTokens = estimateTokens(excerpt)
        // If ceil still overshoots, shave a few more chars.
        while (excerptTokens > remaining && excerpt.length > 4) {
          excerpt = `${excerpt.slice(0, Math.max(0, excerpt.length - 8)).trimEnd()}…`
          excerptTokens = estimateTokens(excerpt)
        }
      }
      if (excerptTokens <= 0) break
    }

    const cost = headerTokens + excerptTokens
    // Prefer omitting a later hit over blowing the budget; allow the first hit
    // only when even the minimal excerpt still edges over (tiny maxTokens).
    if (totalTokens + cost > maxTokens) {
      if (hits.length > 0) break
      // Still accept first hit, but clamp reported total to maxTokens below.
    }

    hits.push({
      path: hit.path,
      excerpt,
      rank: hit.rank,
      tokens: cost,
    })
    totalTokens = Math.min(maxTokens, totalTokens + cost)
    if (totalTokens >= maxTokens) break
  }

  return { hits, totalTokens, query: q }
}

/** Count indexed files (0 if missing). */
export function countIndexedFiles(workspaceRoot: string): number {
  const dbPath = indexPathFor(workspaceRoot)
  if (!existsSync(dbPath)) return 0
  const handle = openDb(workspaceRoot)
  if (!handle) return 0
  try {
    const row = handle.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM files').get()
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/** Close cached handles (tests). */
export function closeAllSourceIndexes(): void {
  for (const { db } of handles.values()) {
    try {
      db.close()
    } catch {
      // ignore
    }
  }
  handles.clear()
}
