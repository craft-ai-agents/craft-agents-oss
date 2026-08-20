/**
 * AuditLog — append-only JSONL record of every memory mutation (spec F2).
 *
 * Lives at {memoryDir}/audit.jsonl next to lessons.jsonl:
 * - global:    ~/.craft-agent/memory/audit.jsonl
 * - workspace: {workspaceRoot}/memory/audit.jsonl
 *
 * Append-only: entries are never edited, only rotated tail-first when the
 * file grows past AUDIT_LIMITS.maxLines (10k): the file is atomically
 * rewritten keeping the most recent AUDIT_LIMITS.keepLines (7k) entries.
 * Rotation rewrites the whole file every keepLines lines only, amortized O(1).
 *
 * Path resolution mirrors MemoryFileStore (same lazy CRAFT_CONFIG_DIR
 * convention, read at construction time — not the frozen CONFIG_DIR
 * constant — so late-bound test harnesses resolve the right directory).
 * Corrupt lines are skipped on read, never thrown.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import type { AuditEntry, LessonScope } from '@craft-agent/shared/memory/types'

/** Rotation thresholds: rotate once past maxLines, keep the tail. */
export const AUDIT_LIMITS = {
  maxLines: 10_000,
  keepLines: 7_000,
} as const

/** Everything a writer must supply; ts/scope are filled in by the log itself. */
export type AuditInput = Omit<AuditEntry, 'ts' | 'scope'> & { ts?: string }

/**
 * Parse audit.jsonl resiliently. Blank lines are ignored and any line that
 * fails JSON.parse or doesn't look like an entry is skipped.
 */
export function parseAuditEntries(content: string): AuditEntry[] {
  const entries: AuditEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as AuditEntry
      if (parsed && typeof parsed === 'object' && typeof parsed.ts === 'string' && typeof parsed.action === 'string') {
        entries.push(parsed)
      }
    } catch {
      // skip corrupt line
    }
  }
  return entries
}

export class AuditLog {
  /** The scope's memory directory (~/.craft-agent/memory or {workspaceRoot}/memory). */
  readonly memoryDir: string
  readonly scope: LessonScope
  /** Lazily-initialized line counter so appends stay O(1) between rotations. */
  private lineCount: number | null = null

  /**
   * @param scope  'global' (config dir) or 'workspace' (needs workspaceRoot)
   * @param workspaceRoot  required for workspace scope
   * @param configDir  override for the global config dir (tests); defaults to
   *                   process.env.CRAFT_CONFIG_DIR || CONFIG_DIR
   * @param memoryDir  bind to an explicit memory directory instead of deriving
   *                   one (used by LessonStore, which only knows its file path)
   */
  constructor(
    scope: LessonScope,
    workspaceRoot?: string,
    configDir: string = process.env.CRAFT_CONFIG_DIR || CONFIG_DIR,
    memoryDir?: string,
  ) {
    if (memoryDir) {
      this.memoryDir = memoryDir
    } else if (scope === 'global') {
      this.memoryDir = join(configDir, 'memory')
    } else {
      if (!workspaceRoot) throw new Error('AuditLog: workspaceRoot is required for workspace scope')
      this.memoryDir = join(workspaceRoot, 'memory')
    }
    this.scope = scope
  }

  /** Bind an audit log to an explicit memory directory. */
  static inDir(memoryDir: string, scope: LessonScope): AuditLog {
    return new AuditLog(scope, undefined, undefined, memoryDir)
  }

  /** Path of this scope's audit.jsonl. */
  get filePath(): string {
    return join(this.memoryDir, 'audit.jsonl')
  }

  /**
   * Append one entry (ts defaults to now, scope to this log's scope).
   * Rotates the file tail-first when it grows past AUDIT_LIMITS.maxLines.
   */
  append(entry: AuditInput): void {
    // Count BEFORE writing: the count is the file's state prior to this line.
    const count = this.count() + 1
    mkdirSync(this.memoryDir, { recursive: true })
    const full: AuditEntry = { ts: entry.ts ?? new Date().toISOString(), ...entry, scope: this.scope }
    appendFileSync(this.filePath, JSON.stringify(full) + '\n')
    if (count > AUDIT_LIMITS.maxLines) {
      this.rotate()
    } else {
      this.lineCount = count
    }
  }

  /**
   * Read entries, most recent first. `limit` returns only the tail-most N
   * (from the newest end).
   */
  read(limit?: number): AuditEntry[] {
    if (!existsSync(this.filePath)) return []
    const entries = parseAuditEntries(readFileSync(this.filePath, 'utf8')).reverse()
    return limit === undefined ? entries : entries.slice(0, limit)
  }

  /** Current line count, lazily read from disk once per instance. */
  private count(): number {
    if (this.lineCount !== null) return this.lineCount
    if (!existsSync(this.filePath)) {
      this.lineCount = 0
      return 0
    }
    const raw = readFileSync(this.filePath, 'utf8')
    let n = 0
    for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) n++
    if (raw.length > 0 && !raw.endsWith('\n')) n++
    this.lineCount = n
    return n
  }

  /** Rewrite keeping the most recent AUDIT_LIMITS.keepLines lines (atomic tmp + rename). */
  private rotate(): void {
    const lines = readFileSync(this.filePath, 'utf8').split('\n').filter(l => l.trim().length > 0)
    const kept = lines.slice(-AUDIT_LIMITS.keepLines)
    const tmp = join(this.memoryDir, `.${Date.now()}-${process.pid}.audit.tmp`)
    writeFileSync(tmp, kept.join('\n') + (kept.length ? '\n' : ''))
    renameSync(tmp, this.filePath)
    this.lineCount = kept.length
  }
}
