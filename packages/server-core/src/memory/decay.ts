/**
 * M3 — workspace history decay/compaction (spec §M3, self-learning v2).
 *
 * Daily history files in `{workspaceRoot}/memory/history/YYYY-MM-DD.md` are
 * rolled up as they age:
 * - older than `dailyKeepDays` (14) → week rollup `weekly-YYYY-Wnn.md`
 * - older than `weeklyKeepDays` (60) → month rollup `monthly-YYYY-MM.md`
 * - older than `yearlyDrop` (365) → deleted
 * Files within the last `dailyKeepDays` days stay daily, untouched.
 *
 * Summary text comes from the injected `summarizer` (LLM one-shot in prod,
 * canned text in tests); without one the dailies are concatenated and
 * truncated to FALLBACK_MAX_CHARS.
 *
 * Idempotent: a week/month whose rollup file already exists is skipped
 * entirely (no regeneration, no source deletion) — a crashed run never
 * compounds. Rollup writes are atomic (tmp file + rename in the same dir),
 * and daily sources are removed only after their rollup is on disk.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/** Max chars of concatenated daily text kept in a rollup when no summarizer is configured. */
export const FALLBACK_MAX_CHARS = 4000

const DAY_MS = 86_400_000
const DAILY_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/

export interface CompactOptions {
  /** Days a daily file stays untouched (default 14). */
  dailyKeepDays?: number
  /** Days after which dailies roll into months instead of weeks (default 60). */
  weeklyKeepDays?: number
  /** Days after which dailies are deleted outright (default 365). */
  yearlyDrop?: number
  /** One-shot text summarizer (LLM in prod, canned in tests). */
  summarizer?: (text: string) => Promise<string>
  /** Clock for deterministic tests (default Date.now). */
  clock?: () => number
}

export interface CompactResult {
  /** Daily files dropped outright (older than yearlyDrop). */
  deleted: number
  /** Names of weekly rollup files created this run (e.g. 'weekly-2026-W03.md'). */
  weekly: string[]
  /** Names of monthly rollup files created this run (e.g. 'monthly-2026-01.md'). */
  monthly: string[]
}

/** ISO-8601 week (Mon-based) of a UTC date: {year, week} with week ∈ [1, 53]. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // Move to Thursday of this week (ISO week/year anchor).
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)
  return { year: d.getUTCFullYear(), week: 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS)) }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`)
  writeFileSync(tmp, content)
  renameSync(tmp, path)
}

interface DayFile {
  /** 'YYYY-MM-DD' */
  day: string
  path: string
  /** UTC-midnight epoch of the day */
  ts: number
  ageDays: number
}

async function buildRollup(
  kind: 'week' | 'month',
  groupFiles: DayFile[],
  read: (f: DayFile) => string,
  summarizer?: (text: string) => Promise<string>,
): Promise<string> {
  const sorted = [...groupFiles].sort((a, b) => a.day.localeCompare(b.day))
  const body = sorted
    .map(f => `## ${f.day}\n\n${read(f).trim()}`)
    .join('\n\n')
  const heading =
    kind === 'week'
      ? (() => {
          const { year, week } = isoWeek(new Date(sorted[0].ts))
          return `# Week ${year}-W${String(week).padStart(2, '0')}`
        })()
      : `# Month ${sorted[0].day.slice(0, 7)}`
  if (summarizer) {
    const summary = (await summarizer(body)).trim()
    return `${heading}\n\n${summary}\n`
  }
  const trimmed = body.length > FALLBACK_MAX_CHARS ? body.slice(0, FALLBACK_MAX_CHARS) : body
  return `${heading}\n\n${trimmed}\n`
}

/**
 * Compact `{workspaceRoot}/memory/history/*.md` according to the spec tiers.
 * Safe to call repeatedly — after the first run everything is either fresh
 * enough to keep, rolled up (skipped), or gone.
 */
export async function compactWorkspaceHistory(workspaceRoot: string, opts: CompactOptions = {}): Promise<CompactResult> {
  const dailyKeepDays = opts.dailyKeepDays ?? 14
  const weeklyKeepDays = opts.weeklyKeepDays ?? 60
  const yearlyDrop = opts.yearlyDrop ?? 365
  const now = (opts.clock ?? (() => Date.now()))()

  const result: CompactResult = { deleted: 0, weekly: [], monthly: [] }
  const dir = join(workspaceRoot, 'memory', 'history')
  if (!existsSync(dir)) return result

  const todayUtc = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  const files: DayFile[] = []
  for (const name of readdirSync(dir)) {
    const m = DAILY_RE.exec(name)
    if (!m) continue
    const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    files.push({ day: `${m[1]}-${m[2]}-${m[3]}`, path: join(dir, name), ts, ageDays: Math.floor((todayUtc - ts) / DAY_MS) })
  }
  // Negative ages (files dated in the future) stay untouched.
  files.sort((a, b) => a.day.localeCompare(b.day))

  const read = (f: DayFile): string => {
    try {
      return readFileSync(f.path, 'utf8')
    } catch {
      return ''
    }
  }

  // Tier 1: outright deletion.
  for (const f of files.filter(f => f.ageDays > yearlyDrop)) {
    try {
      unlinkSync(f.path)
      result.deleted++
    } catch {
      // best-effort; a vanished file is not an error
    }
  }

  const weekGroups = new Map<string, DayFile[]>()
  const monthGroups = new Map<string, DayFile[]>()
  for (const f of files) {
    if (f.ageDays > yearlyDrop) continue // already dropped
    if (f.ageDays > weeklyKeepDays) {
      const key = f.day.slice(0, 7)
      monthGroups.set(key, [...(monthGroups.get(key) ?? []), f])
    } else if (f.ageDays > dailyKeepDays) {
      const { year, week } = isoWeek(new Date(f.ts))
      const key = `${year}-W${String(week).padStart(2, '0')}`
      weekGroups.set(key, [...(weekGroups.get(key) ?? []), f])
    }
  }

  const rollUp = async (
    kind: 'week' | 'month',
    groups: Map<string, DayFile[]>,
    fileName: (key: string) => string,
    created: string[],
  ): Promise<void> => {
    for (const [key, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const rollupName = fileName(key)
      const rollupPath = join(dir, rollupName)
      // Idempotence: an existing rollup means this period is done — skip the
      // whole group (no regeneration, no source deletion).
      if (existsSync(rollupPath)) continue
      const content = await buildRollup(kind, group, read, opts.summarizer)
      atomicWrite(rollupPath, content)
      created.push(rollupName)
      // Sources are dropped only after their rollup is safely on disk.
      for (const f of group) {
        try {
          unlinkSync(f.path)
        } catch {
          // best-effort
        }
      }
    }
  }

  await rollUp('week', weekGroups, key => `weekly-${key}.md`, result.weekly)
  await rollUp('month', monthGroups, key => `monthly-${key}.md`, result.monthly)
  return result
}
