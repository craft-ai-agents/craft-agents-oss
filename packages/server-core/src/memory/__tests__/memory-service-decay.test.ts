/**
 * M3 MemoryService wiring: runDecayJob() runs compactWorkspaceHistory with
 * the injected deps.summarizer at most once per 24h (lastRun guard), is a
 * no-op when memory is disabled, and never throws into the 60s tick.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryService, type MemoryServiceDeps } from '../MemoryService'
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from '@craft-agent/shared/memory/types'

const NOW = new Date('2026-08-06T12:00:00Z').getTime()

const roots: string[] = []
function mkroot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memsvc-decay-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function makeService(root: string, overrides: Partial<MemoryServiceDeps> = {}, config: MemoryConfig = { ...DEFAULT_MEMORY_CONFIG }): MemoryService {
  return new MemoryService({
    workspaceRoot: root,
    clock: () => NOW,
    logger: { warn: () => {} },
    getConfig: () => config,
    ...overrides,
  })
}

const ENABLED: MemoryConfig = { ...DEFAULT_MEMORY_CONFIG }
const DISABLED: MemoryConfig = { ...ENABLED, enabled: false }

function seedOldDaily(root: string): void {
  const dir = join(root, 'memory', 'history')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '2026-07-14.md'), '# 2026-07-14\n\nold stuff\n')
}

describe('MemoryService.runDecayJob (M3)', () => {
  it('compacts with the injected summarizer on the first call', async () => {
    const root = mkroot()
    seedOldDaily(root)
    const summarized: string[] = []
    const svc = makeService(root, { summarizer: async t => (summarized.push(t), 'SUMMED') })
    const result = await svc.runDecayJob()
    expect(result).not.toBeNull()
    expect(result!.weekly).toHaveLength(1)
    expect(summarized).toHaveLength(1)
    const names = readdirSync(join(root, 'memory', 'history'))
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^weekly-\d{4}-W\d{2}\.md$/)
  })

  it('runs at most once per 24h (lastRun guard)', async () => {
    const root = mkroot()
    seedOldDaily(root)
    const svc = makeService(root)
    expect(await svc.runDecayJob(NOW)).not.toBeNull()
    // Same tick hour and +23h are swallowed by the guard…
    expect(await svc.runDecayJob(NOW + 60_000)).toBeNull()
    expect(await svc.runDecayJob(NOW + 23 * 3_600_000)).toBeNull()
    // …24h later it fires again (nothing left to compact → empty result).
    const second = await svc.runDecayJob(NOW + 24 * 3_600_000)
    expect(second).toEqual({ deleted: 0, weekly: [], monthly: [] })
  })

  it('never decays when memory is disabled', async () => {
    const root = mkroot()
    seedOldDaily(root)
    const svc = makeService(root, {}, DISABLED)
    expect(await svc.runDecayJob()).toBeNull()
    expect(readdirSync(join(root, 'memory', 'history'))).toEqual(['2026-07-14.md'])
  })

  it('swallows decay errors (fail-soft for the 60s tick)', async () => {
    const root = mkroot()
    const warnings: unknown[] = []
    // Trigger the fallback path with an unreadable workspaceRoot parent:
    // summarizer throws → compactWorkspaceHistory rejects → warn + null.
    seedOldDaily(root)
    const svc = new MemoryService({
      workspaceRoot: root,
      clock: () => NOW,
      logger: { warn: (...a: unknown[]) => warnings.push(a) },
      getConfig: () => ENABLED,
      summarizer: () => Promise.reject(new Error('llm down')),
    })
    expect(await svc.runDecayJob()).toBeNull()
    expect(warnings.length).toBeGreaterThan(0)
  })
})
