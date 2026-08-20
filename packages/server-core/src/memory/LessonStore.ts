/**
 * LessonStore — manages one lessons.jsonl file for a single scope
 * ('global' or 'workspace').
 *
 * - Append-only writes for new lessons, full atomic rewrite (tmp + rename)
 *   for updates/deletes.
 * - Case-insensitive dedup on the rule text (lowercase + trim): a duplicate
 *   updates ts/source of the existing lesson in place.
 * - Enforces LESSON_LIMITS.total by pruning the oldest lessons after writes.
 * - Schema v2 (spec F1): usage metadata via touchUsed, conflict feedback via
 *   recordConflict, distillation lessons marked generated.
 * - Every mutation also appends to the scope's audit.jsonl via the internal
 *   AuditLog (spec F2); callers pass just their actor (default 'rpc').
 * - list() reads are mtime-cached: the file is re-parsed only when its mtime
 *   changed (another process appended to it, tests wrote to it, ...).
 * - Corrupt lines are skipped, never thrown.
 *
 * See docs/superpowers/specs/2026-08-06-self-learning-memory-design.md §1.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { LESSON_LIMITS, type AuditActor, type Lesson, type LessonConflict, type LessonScope } from '@craft-agent/shared/memory/types'
import { AuditLog, type AuditInput } from './AuditLog'
import { removeLesson as ftsRemoveLesson, upsertLesson as ftsUpsertLesson } from './fts-index'

/** Normalized dedup key for a lesson rule (case-insensitive, whitespace-trimmed). */
export function lessonKey(rule: string): string {
  return rule.trim().toLowerCase()
}

/**
 * Drop malformed schema-v2 fields (wrong types) while preserving everything
 * else verbatim — unknown keys from newer writers must round-trip untouched.
 */
function normalizeLesson(lesson: Lesson): Lesson {
  if (lesson.usageCount !== undefined && (typeof lesson.usageCount !== 'number' || !Number.isFinite(lesson.usageCount) || lesson.usageCount < 0)) {
    delete lesson.usageCount
  }
  if (lesson.lastUsedAt !== undefined && typeof lesson.lastUsedAt !== 'string') delete lesson.lastUsedAt
  if (lesson.generated !== undefined && typeof lesson.generated !== 'boolean') delete lesson.generated
  if (lesson.conflicts !== undefined) {
    lesson.conflicts = Array.isArray(lesson.conflicts)
      ? lesson.conflicts
          .filter(c => c && typeof c.sessionId === 'string' && typeof c.ts === 'string' && (c.reason === 'branch' || c.reason === 'interrupted' || c.reason === 'error'))
          .slice(-LESSON_LIMITS.conflicts)
      : undefined
  }
  if (lesson.promoted !== undefined) {
    const p = lesson.promoted
    if (!p || p.fromScope !== 'workspace' || !Array.isArray(p.workspaceIds) || typeof p.ts !== 'string') delete lesson.promoted
  }
  return lesson
}

/**
 * Parse a lessons.jsonl payload resiliently. Blank lines are ignored and any
 * line that fails JSON.parse or doesn't look like a lesson is skipped — a
 * store must never fail to load because one line is corrupt.
 */
export function parseLessons(content: string): Lesson[] {
  const lessons: Lesson[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Lesson
      if (parsed && typeof parsed === 'object' && typeof parsed.rule === 'string') {
        lessons.push(normalizeLesson(parsed))
      }
    } catch {
      // skip corrupt line
    }
  }
  return lessons
}

export class LessonStore {
  readonly filePath: string
  readonly scope: LessonScope
  /** Scope's audit log (audit.jsonl next to lessons.jsonl) — wired internally, callers pass nothing. */
  readonly auditLog: AuditLog
  /** Cached lessons, keyed by file mtime. */
  private cache: { mtimeMs: number; lessons: Lesson[] } | null = null

  constructor(filePath: string, scope: LessonScope) {
    this.filePath = filePath
    this.scope = scope
    this.auditLog = AuditLog.inDir(dirname(filePath), scope)
  }

  /** All lessons, oldest first. `limit` returns the most recent N. */
  list(limit?: number): Lesson[] {
    const lessons = this.read()
    if (limit === undefined) return lessons
    return lessons.slice(-limit)
  }

  /**
   * Add a lesson. If a lesson with the same rule (case-insensitive) exists,
   * its ts and source are updated instead (and it moves to the end).
   * Enforces LESSON_LIMITS.total by pruning the oldest lessons.
   * Schema v2: lessons whose source trigger is anything but 'explicit'
   * (distillation, branch, interrupted, error) are marked `generated: true`.
   * Returns the stored lesson.
   */
  add(lesson: Lesson, actor: AuditActor = 'rpc'): Lesson {
    const lessons = this.read()
    const entry: Lesson = lesson.source.trigger === 'explicit' ? lesson : { ...lesson, generated: true }
    const key = lessonKey(entry.rule)
    const existingIdx = lessons.findIndex(l => lessonKey(l.rule) === key)
    if (existingIdx >= 0) {
      const existing = lessons[existingIdx]
      lessons.splice(existingIdx, 1)
      lessons.push({ ...existing, ts: entry.ts, source: entry.source, ...(entry.generated !== undefined ? { generated: entry.generated } : {}) })
      this.rewrite(lessons)
      this.auditWrite({ actor, action: 'add', target: entry.rule, detail: entry.source.trigger })
      return this.indexed(lessons[lessons.length - 1])
    }
    // Append-only fast path when we're under the limit.
    if (lessons.length < LESSON_LIMITS.total) {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(entry) + '\n', { flag: 'a' })
      this.cache = this.cache
        ? { mtimeMs: this.mtime(), lessons: [...lessons, entry] }
        : null
      this.auditWrite({ actor, action: 'add', target: entry.rule, detail: entry.source.trigger })
      return this.indexed(entry)
    }
    lessons.push(entry)
    this.rewrite(lessons)
    this.auditWrite({ actor, action: 'add', target: entry.rule, detail: entry.source.trigger })
    return this.indexed(entry)
  }

  /**
   * Patch a lesson identified by rule text (case-insensitive) or by index.
   * Audited as 'promote' when the patch carries a `promoted` marker, else
   * 'update'. Returns the patched lesson, or null when no lesson matches.
   */
  update(match: string | number, patch: Partial<Omit<Lesson, 'scope'>>, actor: AuditActor = 'rpc'): Lesson | null {
    const lessons = this.read()
    const idx = this.resolveIndex(lessons, match)
    if (idx < 0) return null
    const target = lessons[idx].rule
    lessons[idx] = { ...lessons[idx], ...patch }
    this.rewrite(lessons)
    this.auditWrite({ actor, action: patch.promoted ? 'promote' : 'update', target, detail: Object.keys(patch).join(',') })
    // M1 FTS: the patch may have renamed the rule — drop the stale key first.
    if (lessonKey(lessons[idx].rule) !== lessonKey(target)) this.unindexed(target)
    return this.indexed(lessons[idx])
  }

  /**
   * Delete a lesson identified by rule text (case-insensitive) or by index.
   * Returns true when a lesson was removed.
   */
  delete(match: string | number, actor: AuditActor = 'rpc'): boolean {
    const lessons = this.read()
    const idx = this.resolveIndex(lessons, match)
    if (idx < 0) return false
    const target = lessons[idx].rule
    lessons.splice(idx, 1)
    this.rewrite(lessons)
    this.auditWrite({ actor, action: 'delete', target })
    this.unindexed(target)
    return true
  }

  /**
   * Mark the given lessons (by rule text, case-insensitive) as included in an
   * assembled prompt: usageCount++, lastUsedAt = now. Atomic rewrite.
   * Returns the number of lessons updated. Not audited — prompt assembly runs
   * per turn and would drown every real mutation in the log.
   */
  touchUsed(rules: string[]): number {
    if (rules.length === 0) return 0
    const keys = new Set(rules.map(lessonKey))
    const lessons = this.read()
    const now = new Date().toISOString()
    let touched = 0
    for (let i = 0; i < lessons.length; i++) {
      if (!keys.has(lessonKey(lessons[i].rule))) continue
      lessons[i] = { ...lessons[i], usageCount: (lessons[i].usageCount ?? 0) + 1, lastUsedAt: now }
      touched++
    }
    if (touched > 0) this.rewrite(lessons)
    return touched
  }

  /**
   * Record a violation of a lesson (feedback loop, spec F1/L1). The event is
   * appended to lesson.conflicts, capped at the most recent
   * LESSON_LIMITS.conflicts. Atomic rewrite. Returns the patched lesson, or
   * null when no lesson matches the rule text (case-insensitive).
   */
  recordConflict(ruleMatch: string, evt: LessonConflict, actor: AuditActor = 'rpc'): Lesson | null {
    const lessons = this.read()
    const key = lessonKey(ruleMatch)
    const idx = lessons.findIndex(l => lessonKey(l.rule) === key)
    if (idx < 0) return null
    const conflicts = [...(lessons[idx].conflicts ?? []), evt].slice(-LESSON_LIMITS.conflicts)
    lessons[idx] = { ...lessons[idx], conflicts }
    this.rewrite(lessons)
    this.auditWrite({ actor, action: 'conflict', target: lessons[idx].rule, detail: `${evt.reason} (session ${evt.sessionId})` })
    return lessons[idx]
  }

  /** Most recent lessons (max LESSON_LIMITS.context), most recent first. */
  forContext(): Lesson[] {
    return this.read().slice(-LESSON_LIMITS.context).reverse()
  }

  /** Drop the cache so the next list() re-reads the file. */
  invalidate(): void {
    this.cache = null
  }

  /** Best-effort audit write — the secondary log must never break a mutation. */
  private auditWrite(input: AuditInput): void {
    try {
      this.auditLog.append(input)
    } catch {
      // auditing is best-effort; the mutation already landed
    }
  }

  /** M1 FTS: (re)index the stored lesson; the index may never break a mutation. */
  private indexed(lesson: Lesson): Lesson {
    try {
      ftsUpsertLesson(dirname(this.filePath), lesson)
    } catch {
      // best-effort projection of the jsonl file
    }
    return lesson
  }

  /** M1 FTS: drop a lesson from the scope's index (matched by normalized rule). */
  private unindexed(rule: string): void {
    try {
      ftsRemoveLesson(dirname(this.filePath), rule)
    } catch {
      // best-effort
    }
  }

  private resolveIndex(lessons: Lesson[], match: string | number): number {
    if (typeof match === 'number') {
      return match >= 0 && match < lessons.length ? match : -1
    }
    const key = lessonKey(match)
    return lessons.findIndex(l => lessonKey(l.rule) === key)
  }

  private mtime(): number {
    try {
      return statSync(this.filePath).mtimeMs
    } catch {
      return -1
    }
  }

  private read(): Lesson[] {
    if (!existsSync(this.filePath)) {
      this.cache = { mtimeMs: -1, lessons: [] }
      return []
    }
    const mtimeMs = this.mtime()
    if (this.cache && this.cache.mtimeMs === mtimeMs) {
      return this.cache.lessons
    }
    const lessons = parseLessons(readFileSync(this.filePath, 'utf8'))
    this.cache = { mtimeMs, lessons }
    return lessons
  }

  /** Full atomic rewrite: write a tmp file in the same dir, then rename. */
  private rewrite(lessons: Lesson[]): void {
    const pruned = lessons.slice(-LESSON_LIMITS.total)
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = join(dirname(this.filePath), `.${Date.now()}-${process.pid}.lessons.tmp`)
    writeFileSync(tmp, pruned.map(l => JSON.stringify(l)).join('\n') + (pruned.length ? '\n' : ''))
    renameSync(tmp, this.filePath)
    this.cache = { mtimeMs: this.mtime(), lessons: pruned }
  }
}
