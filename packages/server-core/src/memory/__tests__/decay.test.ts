/**
 * M3 decay/compaction unit tests (spec §M3): crafted tmp history trees, a
 * fixed clock, and an injected summarizer — no LLM. Covers the tier
 * boundaries (14/60/365), rollup naming, the concat+truncate fallback,
 * skip-existing idempotence, and full second-run stability.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { compactWorkspaceHistory, isoWeek, FALLBACK_MAX_CHARS } from '../decay'

const NOW = new Date('2026-08-06T12:00:00Z').getTime()
const clock = () => NOW

const roots: string[] = []
function mkroot(): string {
  const root = mkdtempSync(join(tmpdir(), 'decay-test-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

/** Write daily history files from {YYYY-MM-DD: body} seed data. */
function seed(root: string, days: Record<string, string>): string {
  const dir = join(root, 'memory', 'history')
  mkdirSync(dir, { recursive: true })
  for (const [day, body] of Object.entries(days)) {
    writeFileSync(join(dir, `${day}.md`), `# ${day}\n\n${body}\n`)
  }
  return dir
}

/** Rollup file name for a week group anchored on a YYYY-MM-DD day. */
function weeklyName(day: string): string {
  const { year, week } = isoWeek(new Date(`${day}T00:00:00Z`))
  return `weekly-${year}-W${String(week).padStart(2, '0')}.md`
}

describe('compactWorkspaceHistory', () => {
  it('splits dailies into weekly/monthly rollups and drops >yearly files', async () => {
    const root = mkroot()
    const dir = seed(root, {
      '2026-08-05': 'fresh — keep as daily', // 1d old
      '2026-07-14': 'week-old A', // 23d old → weekly
      '2026-07-15': 'week-old B', // 22d old → weekly (same ISO week)
      '2026-05-20': 'month-old A', // 78d old → monthly
      '2026-05-28': 'month-old B', // 70d old → monthly
      '2025-07-01': 'ancient — drop', // >365d → delete
    })
    const summarized: string[] = []
    const result = await compactWorkspaceHistory(root, {
      clock,
      summarizer: async text => {
        summarized.push(text)
        return `SUMMARY(${text.length})`
      },
    })

    expect(result.deleted).toBe(1)
    expect(result.weekly).toEqual([weeklyName('2026-07-14')])
    expect(result.monthly).toEqual(['monthly-2026-05.md'])

    const remaining = readdirSync(dir).sort()
    expect(remaining).toEqual(['2026-08-05.md', 'monthly-2026-05.md', weeklyName('2026-07-14')].sort())

    // Both week-old dailies were fed to the summarizer as one text (day
    // sections in chronological order); the rollup holds only its summary.
    expect(summarized).toHaveLength(2)
    expect(summarized[0]).toContain('## 2026-07-14')
    expect(summarized[0]).toContain('## 2026-07-15')
    expect(summarized[0].indexOf('2026-07-14')).toBeLessThan(summarized[0].indexOf('2026-07-15'))
    const weekly = readFileSync(join(dir, weeklyName('2026-07-14')), 'utf8')
    expect(weekly).toBe(`# Week 2026-W29\n\nSUMMARY(${summarized[0].length})\n`)
    const monthly = readFileSync(join(dir, 'monthly-2026-05.md'), 'utf8')
    expect(monthly).toContain('# Month 2026-05')
    // rollup sources are gone; fresh daily is untouched verbatim
    expect(readFileSync(join(dir, '2026-08-05.md'), 'utf8')).toBe('# 2026-08-05\n\nfresh — keep as daily\n')
    // no tmp files leaked by atomic writes
    expect(readdirSync(dir).filter(n => n.endsWith('.tmp'))).toEqual([])
  })

  it('is idempotent: a second run changes nothing', async () => {
    const root = mkroot()
    seed(root, {
      '2026-07-14': 'week-old A',
      '2026-05-20': 'month-old A',
      '2025-07-01': 'ancient',
    })
    const first = await compactWorkspaceHistory(root, { clock, summarizer: async t => `S:${t.slice(0, 10)}` })
    expect(first.deleted + first.weekly.length + first.monthly.length).toBeGreaterThan(0)
    const after = readdirSync(join(root, 'memory', 'history')).sort()
    const second = await compactWorkspaceHistory(root, { clock, summarizer: async t => `S:${t.slice(0, 10)}` })
    expect(second).toEqual({ deleted: 0, weekly: [], monthly: [] })
    expect(readdirSync(join(root, 'memory', 'history')).sort()).toEqual(after)
  })

  it('skips groups whose rollup already exists (no regeneration, no source deletion)', async () => {
    const root = mkroot()
    const dir = seed(root, { '2026-07-14': 'week-old A' })
    // Pre-existing rollup for that ISO week → the daily keeps standing.
    writeFileSync(join(dir, weeklyName('2026-07-14')), '# Week (hand-written)\n')
    const result = await compactWorkspaceHistory(root, { clock })
    expect(result.weekly).toEqual([])
    expect(existsSync(join(dir, '2026-07-14.md'))).toBe(true)
    expect(readFileSync(join(dir, weeklyName('2026-07-14')), 'utf8')).toBe('# Week (hand-written)\n')
  })

  it('falls back to concat + 4000-char truncation without a summarizer', async () => {
    const root = mkroot()
    const dir = seed(root, {
      '2026-07-14': 'A'.repeat(3500),
      '2026-07-15': 'B'.repeat(1500),
    })
    const result = await compactWorkspaceHistory(root, { clock })
    expect(result.weekly).toEqual([weeklyName('2026-07-14')])
    const text = readFileSync(join(dir, weeklyName('2026-07-14')), 'utf8')
    const body = text.split('\n\n').slice(1).join('\n\n').replace(/\n*$/, '') // after the '# Week …' heading, sans trailing \n
    expect(body.length).toBeLessThanOrEqual(FALLBACK_MAX_CHARS)
    expect(text).toContain('## 2026-07-14')
  })

  it('keeps 14d/60d boundaries: 14d-old stays daily, 15d→weekly, 61d→monthly', async () => {
    const root = mkroot()
    const dir = seed(root, {
      '2026-07-23': 'exactly 14 days old', // age 14 → intact
      '2026-07-22': 'age 15 → weekly',
      '2026-06-06': 'age 61 → monthly',
    })
    await compactWorkspaceHistory(root, { clock })
    const names = readdirSync(dir).sort()
    expect(names).toContain('2026-07-23.md')
    expect(names).toContain(weeklyName('2026-07-22'))
    expect(names).toContain('monthly-2026-06.md')
  })

  it('no-ops on a missing history dir', async () => {
    const root = mkroot()
    expect(await compactWorkspaceHistory(root, { clock })).toEqual({ deleted: 0, weekly: [], monthly: [] })
  })
})
