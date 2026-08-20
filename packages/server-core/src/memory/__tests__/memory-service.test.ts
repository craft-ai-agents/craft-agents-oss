import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'bun:test'
import { MemoryService, parseDistillResult, redactSecrets, type SessionCompletionLike } from '../MemoryService'
import { LessonStore } from '../LessonStore'
import { MemoryFileStore } from '../MemoryFileStore'
import { EpisodicMemory, type Embedder } from '../episodic-memory'
import { closeAll } from '../fts-index'
import type { DistillResult, Lesson, LessonPromptUsage, MemoryConfig, SkillCandidate } from '@craft-agent/shared/memory/types'
import type { StoredMessage, SessionMemoryMode } from '@craft-agent/core/types'

const MSGS: StoredMessage[] = [
  { id: 'm1', type: 'user', content: 'use key AKIAIOSFODNN7EXAMPLE and api_key=abc123 here' },
  { id: 'm2', type: 'assistant', content: 'done' },
]

const OK: DistillResult = {
  history_entry: 'Session wrapped up',
  memory_update: 'Always run tsc after edits',
  lessons: [{ rule: 'Run tests before shipping', category: 'workflow' }],
  skill_candidate: { slug: 'sweep-thing', description: 'sweep', body: '# sweep it' },
}

const SENSITIVE: DistillResult = {
  ...OK,
  skill_candidate: { slug: 'read-ssh', description: 'x', body: 'reads ~/.ssh files' },
}

/** Flush the async FIFO drain deterministically (no wall-clock timers). */
async function drain(svc: MemoryService): Promise<void> {
  // Let the void'd microtask kick off the drain loop, then wait for it.
  await Promise.resolve()
  await Promise.resolve()
  await svc.whenIdle()
}

function makeService(opts: {
  distiller?: (prompt: string) => Promise<string>
  clock?: () => number
  modes?: Record<string, SessionMemoryMode>
  provenance?: (sessionId: string) => LessonPromptUsage[]
  messages?: StoredMessage[]
  semantic?: boolean
  episodicEmbedder?: Embedder
  episodicMemory?: EpisodicMemory
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'memsvc-'))
  const prompts: string[] = []
  const enqueued: SkillCandidate[] = []
  const emitted: Array<[string, unknown[]]> = []
  const config: MemoryConfig = { enabled: true, distillIdleHours: 3, distillMsgCount: 30, negativeFirst: true, redactExtraPatterns: [], ftsLimit: 20, semantic: opts.semantic ?? false }
  let autoCreate = false
  let fire: ((evt: SessionCompletionLike) => void) | null = null
  const wsFiles = new MemoryFileStore('workspace', root)
  const wsLessons = new LessonStore(wsFiles.lessonsPath, 'workspace')
  const globalLessons = new LessonStore(new MemoryFileStore('global', root, join(root, 'global-config')).lessonsPath, 'global')
  const episodicMemory = opts.episodicMemory ?? new EpisodicMemory(wsFiles.memoryDir, { embedder: opts.episodicEmbedder ?? (async (texts) => texts.map(() => [0])) })
  const svc = new MemoryService({
    workspaceRoot: root,
    workspaceId: 'ws-1',
    clock: opts.clock,
    lessonStoreFactory: (scope) => (scope === 'global' ? globalLessons : wsLessons),
    fileStore: wsFiles,
    skillQueue: { enqueue: (c: SkillCandidate) => (enqueued.push(c), true) } as never,
    episodicMemory,
    distiller: async (prompt) => {
      prompts.push(prompt)
      return opts.distiller ? opts.distiller(prompt) : JSON.stringify(OK)
    },
    emit: (channel, args) => emitted.push([channel, args]),
    logger: { warn: () => {} },
    readMessages: () => opts.messages ?? MSGS,
    getConfig: () => config,
    isSkillAutoCreateEnabled: () => autoCreate,
    getSessionMode: (sessionId) => opts.modes?.[sessionId] ?? 'persistent',
    readSessionProvenance: opts.provenance,
  })
  svc.attachSessionCompletion((cb) => {
    fire = cb
    return () => {}
  })
  return {
    svc,
    prompts,
    enqueued,
    emitted,
    config,
    wsFiles,
    wsLessons,
    globalLessons,
    episodicMemory,
    root,
    setAutoCreate: (v: boolean) => {
      autoCreate = v
    },
    complete: (sessionId = 's1') => fire!({ sessionId, reason: 'complete' }),
    interrupted: (sessionId = 's1') => fire!({ sessionId, reason: 'interrupted' }),
    timeout: (sessionId = 's1') => fire!({ sessionId, reason: 'timeout' }),
    branch: (sessionId = 's1') => fire!({ sessionId, reason: 'branch' }),
    error: (sessionId = 's1') => fire!({ sessionId, reason: 'error' }),
  }
}

const tmpRoots: string[] = []

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true })
})

describe('MemoryService', () => {
  it('complete → distiller called once asynchronously', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.complete()
    expect(h.prompts).toHaveLength(0) // never sync inside the event handler
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
  })

  it('interrupted → trigger interrupted', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.interrupted()
    await drain(h.svc)
    expect(h.wsLessons.list()[0]?.source.trigger).toBe('interrupted')
  })

  it('timeout → mapped to error trigger', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.timeout()
    await drain(h.svc)
    expect(h.wsLessons.list()[0]?.source.trigger).toBe('error')
  })

  it('message-count triggers exactly once per 30', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    for (let i = 1; i <= 29; i++) h.svc.notifyMessageCount('s1', i)
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
    h.svc.notifyMessageCount('s1', 30)
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
    for (let i = 31; i <= 60; i++) h.svc.notifyMessageCount('s1', i)
    await drain(h.svc)
    expect(h.prompts).toHaveLength(2)
  })

  it('idle check fires post-N-hours only, once per idle period', async () => {
    const t0 = 1_000_000
    let now = t0
    const h = makeService({ clock: () => now })
    tmpRoots.push(h.root)
    h.svc.notifyMessageCount('s1', 1)
    now = t0 + 2 * 3_600_000
    h.svc.checkIdle(now) // 2h < 3h → nothing
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
    now = t0 + 3 * 3_600_000
    h.svc.checkIdle(now) // 3h → full distill
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
    h.svc.checkIdle(now + 10 * 3_600_000) // same idle period → no refire
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
  })

  it('invalid JSON → single retry → drop, no crash', async () => {
    let calls = 0
    const h = makeService({
      distiller: async () => {
        calls++
        return 'not json at all'
      },
    })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(calls).toBe(2)
    expect(h.wsLessons.list()).toHaveLength(0)
    expect(h.wsFiles.readContext()).toBe('')
  })

  it('redaction: distiller prompt carries no raw secrets', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
    expect(h.prompts[0]).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(h.prompts[0]).not.toContain('abc123')
    expect(h.prompts[0]).toContain('[REDACTED AWS KEY]')
  })

  it('P1: config redactExtraPatterns mask the outgoing distill window (case-insensitive)', async () => {
    const h = makeService({
      messages: [
        { id: 'm1', type: 'user', content: 'ship the ACME Corp build tonight' },
        { id: 'm2', type: 'assistant', content: 'acme corp assets rebuilt' },
      ],
    })
    tmpRoots.push(h.root)
    h.config.redactExtraPatterns = ['ACME Corp']
    h.complete()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
    expect(h.prompts[0]).not.toMatch(/acme corp/i)
    expect(h.prompts[0]).toContain('[REDACTED]')
  })

  it('P1: config redactExtraPatterns mask persisted lessons/context/history', async () => {
    const h = makeService({
      distiller: async () =>
        JSON.stringify({
          history_entry: 'Wrap-up for ACME Corp',
          memory_update: 'ACME Corp standardizes on pnpm',
          lessons: [{ rule: 'Never rebuild ACME Corp assets in CI', category: 'correction' }],
          skill_candidate: null,
        }),
    })
    tmpRoots.push(h.root)
    h.config.redactExtraPatterns = ['ACME Corp']
    h.complete()
    await drain(h.svc)
    const lesson = h.wsLessons.list()[0]
    expect(lesson?.rule).toBe('Never rebuild [REDACTED] assets in CI')
    expect(h.wsFiles.readContext()).toContain('[REDACTED] standardizes on pnpm')
    const dates = h.wsFiles.listHistoryDates()
    expect(dates).toHaveLength(1)
    expect(h.wsFiles.readHistory(dates[0])).toContain('Wrap-up for [REDACTED]')
    expect(h.wsFiles.readHistory(dates[0])).not.toContain('ACME Corp')
  })

  it('skill_candidate: gated off by default → no enqueue', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.enqueued).toHaveLength(0)
  })

  it('skill_candidate: gated on → enqueued on full distill', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.setAutoCreate(true)
    h.complete()
    await drain(h.svc)
    expect(h.enqueued).toHaveLength(1)
  })

  it('skill_candidate: sensitive slug/body dropped even when gated on', async () => {
    const h = makeService({ distiller: async () => JSON.stringify(SENSITIVE) })
    tmpRoots.push(h.root)
    h.setAutoCreate(true)
    h.complete()
    await drain(h.svc)
    expect(h.enqueued).toHaveLength(0)
  })

  it('skill_candidate: lightweight distill never enqueues even when gated on', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.setAutoCreate(true)
    h.svc.notifyMessageCount('s1', 30)
    await drain(h.svc)
    expect(h.enqueued).toHaveLength(0)
  })

  it('memory.enabled=false → no distill from any trigger', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.config.enabled = false
    h.complete()
    h.svc.notifyMessageCount('s1', 60)
    h.svc.notifyBranchCorrection('s1', 'm1')
    h.svc.checkIdle(Date.now() + 999 * 3_600_000)
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
  })

  it('branch correction enqueues a branch-triggered lightweight distill', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.svc.notifyBranchCorrection('s1', 'm1')
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
    expect(h.wsLessons.list()[0]?.source.trigger).toBe('branch')
  })

  it('memory:changed broadcast after applied writes', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.emitted.some(([ch, args]) => ch === 'memory:changed' && args[0] === 'ws-1' && args[1] === 'both')).toBe(true)
  })

  it('skillsPending:changed broadcast when a candidate is enqueued', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.setAutoCreate(true)
    h.complete()
    await drain(h.svc)
    expect(h.emitted.some(([ch, args]) => ch === 'skillsPending:changed' && args[0] === 'ws-1')).toBe(true)
  })

  it('memory_update is appended once (no duplicate)', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.svc.notifyMessageCount('s1', 30)
    await drain(h.svc)
    h.svc.notifyMessageCount('s2', 30)
    await drain(h.svc)
    expect(h.wsFiles.readContext().split('Always run tsc after edits')).toHaveLength(2)
  })

  it('default distiller rejects with a clear error (real one wired via setDistiller)', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    // Default distiller log+drop path: swap in a fresh service without a distiller.
    const svc = new MemoryService({
      workspaceRoot: h.root,
      logger: { warn: () => {} },
      readMessages: () => MSGS,
      getConfig: () => h.config,
    })
    svc.notifyMessageCount('s1', 30)
    await drain(svc)
    // No crash, nothing applied (distiller error → drop).
    expect(new LessonStore(h.wsFiles.lessonsPath, 'workspace').list()).toHaveLength(0)
  })

  it('buildMemoryBlocks merges global+workspace lessons and workspace memory', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.globalLessons.add({
      ts: '2026-01-01T00:00:00Z',
      rule: 'global rule',
      category: 'preference',
      scope: 'global',
      source: { trigger: 'explicit' },
    } as Lesson)
    h.wsLessons.add({
      ts: '2026-01-01T00:00:01Z',
      rule: 'ws rule',
      category: 'workflow',
      scope: 'workspace',
      source: { trigger: 'explicit' },
    } as Lesson)
    const blocks = await h.svc.buildMemoryBlocks()
    expect(blocks?.lessonsBlock).toContain('global rule')
    expect(blocks?.lessonsBlock).toContain('ws rule')
    h.config.enabled = false
    expect(await h.svc.buildMemoryBlocks()).toBeUndefined()
  })

  it('buildMemoryBlocks reports used lessons with scopes (F4) and counts usage (F1)', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.globalLessons.add({
      ts: '2026-01-01T00:00:00Z',
      rule: 'global rule',
      category: 'preference',
      scope: 'global',
      source: { trigger: 'explicit' },
    } as Lesson)
    h.wsLessons.add({
      ts: '2026-01-01T00:00:01Z',
      rule: 'ws rule',
      category: 'workflow',
      scope: 'workspace',
      source: { trigger: 'explicit' },
    } as Lesson)
    const blocks = await h.svc.buildMemoryBlocks()
    expect(blocks?.used).toEqual([
      { rule: 'global rule', scope: 'global' },
      { rule: 'ws rule', scope: 'workspace' },
    ])
    // touchUsed ran per scope: each lesson gains usageCount 1 + lastUsedAt.
    expect(h.globalLessons.list()[0].usageCount).toBe(1)
    expect(h.globalLessons.list()[0].lastUsedAt).toBeTruthy()
    expect(h.wsLessons.list()[0].usageCount).toBe(1)
    // A second assembly increments again.
    await h.svc.buildMemoryBlocks()
    expect(h.globalLessons.list()[0].usageCount).toBe(2)
    expect(h.wsLessons.list()[0].usageCount).toBe(2)
    // Disabled memory: no blocks, no usage accounting (stays at 2 from above).
    h.config.enabled = false
    expect(await h.svc.buildMemoryBlocks()).toBeUndefined()
    expect(h.globalLessons.list()[0].usageCount).toBe(2)
    expect(h.wsLessons.list()[0].usageCount).toBe(2)
  })

  it('buildMemoryBlocks with no lessons returns used: [] and touches nothing', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    const blocks = await h.svc.buildMemoryBlocks()
    expect(blocks?.lessonsBlock).toBeUndefined()
    expect(blocks?.used).toEqual([])
  })
})

describe('buildMemoryBlocks query-scoped (M1)', () => {
  function seed(h: { globalLessons: LessonStore; wsLessons: LessonStore; wsFiles: MemoryFileStore }): void {
    h.globalLessons.add({
      ts: '2026-01-01T00:00:00Z',
      rule: 'never store secrets in code',
      category: 'correction',
      scope: 'global',
      source: { trigger: 'explicit' },
    } as Lesson)
    h.wsLessons.add({
      ts: '2026-01-01T00:00:01Z',
      rule: 'deploy previews go through vercel',
      category: 'workflow',
      scope: 'workspace',
      source: { trigger: 'explicit' },
    } as Lesson)
    h.wsFiles.writeContext('workspace context about gardening the docs')
    h.wsFiles.appendDailyHistory('shipped the vercel rollback fix', '2026-08-01')
    h.wsFiles.appendDailyHistory('watered the office plants', '2026-08-02')
  }

  it('recency path (no query) merges all lessons + recent history', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    seed(h)
    const blocks = await h.svc.buildMemoryBlocks()
    expect(blocks?.lessonsBlock).toContain('never store secrets')
    expect(blocks?.lessonsBlock).toContain('vercel')
    expect(blocks?.memoryBlock).toContain('gardening')
    expect(blocks?.memoryBlock).toContain('office plants')
    expect(blocks?.used).toHaveLength(2)
  })

  it('query path filters lessons and memory to ranked hits', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    seed(h)
    const blocks = await h.svc.buildMemoryBlocks({ query: 'vercel deploy' })
    expect(blocks?.used).toEqual([{ rule: 'deploy previews go through vercel', scope: 'workspace' }])
    expect(blocks?.lessonsBlock).toContain('vercel')
    expect(blocks?.lessonsBlock).not.toContain('secrets')
    expect(blocks?.memoryBlock).toContain('vercel rollback')
    expect(blocks?.memoryBlock).not.toContain('office plants')
    expect(blocks?.memoryBlock).not.toContain('gardening')
    // Usage accounting follows the ranked subset, not the full stores.
    expect(h.wsLessons.list()[0].usageCount).toBe(1)
    expect(h.globalLessons.list()[0].usageCount).toBeUndefined()
  })

  it('memory.ftsLimit caps the ranked lesson set', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    seed(h)
    h.wsLessons.add({
      ts: '2026-01-01T00:00:02Z',
      rule: 'vercel logs are checked after every deploy',
      category: 'workflow',
      scope: 'workspace',
      source: { trigger: 'explicit' },
    } as Lesson)
    h.config.ftsLimit = 1
    const blocks = await h.svc.buildMemoryBlocks({ query: 'vercel' })
    expect(blocks?.used).toHaveLength(1)
    expect(blocks?.used?.[0]?.rule).toContain('vercel')
  })

  it('query with zero hits falls back to the recency path', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    seed(h)
    const blocks = await h.svc.buildMemoryBlocks({ query: 'zzz-unindexed-term' })
    expect(blocks?.used).toHaveLength(2)
    expect(blocks?.memoryBlock).toContain('office plants')
  })

  it('query path falls back to recency on index errors', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    seed(h)
    closeAll()
    writeFileSync(join(dirname(h.globalLessons.filePath), 'index.db'), 'not a sqlite database')
    writeFileSync(join(h.wsFiles.memoryDir, 'index.db'), 'not a sqlite database')
    const blocks = await h.svc.buildMemoryBlocks({ query: 'vercel' })
    expect(blocks?.used).toHaveLength(2)
    expect(blocks?.lessonsBlock).toContain('never store secrets')
    expect(blocks?.memoryBlock).toContain('office plants')
  })
})

describe('semantic episodic memory (M2)', () => {
  function episodeLines(h: { wsFiles: MemoryFileStore }): Array<{ kind: string; sessionId: string; text: string }> {
    const path = join(h.wsFiles.memoryDir, 'episodic.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  }

  it('semantic=false → no episodic writes and no prompt tail', async () => {
    const h = makeService({ semantic: false })
    tmpRoots.push(h.root)
    h.complete('s1')
    await drain(h.svc)
    expect(episodeLines(h)).toEqual([])
    const blocks = await h.svc.buildMemoryBlocks({ query: 'session wrapped up' })
    expect(blocks?.memoryBlock ?? '').not.toContain('Related past sessions')
  })

  it('semantic=true → complete writes a success episode, bad endings write failure', async () => {
    const h = makeService({ semantic: true })
    tmpRoots.push(h.root)
    h.complete('s1')
    await drain(h.svc)
    h.interrupted('s2')
    await drain(h.svc)
    const lines = episodeLines(h)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'success', sessionId: 's1', text: 'Session wrapped up' })
    expect(lines[1]).toMatchObject({ kind: 'failure', sessionId: 's2' })
  })

  it('semantic=true → prompt memoryBlock gains Related past sessions tail above threshold', async () => {
    const vectors: Record<string, number[]> = {
      'Session wrapped up': [1, 0, 0],
      'db migration broke everything': [0, 1, 0],
      'wrapping session work': [1, 0, 0],
    }
    const h = makeService({ semantic: true, episodicEmbedder: async (texts) => texts.map((t) => vectors[t] ?? [0, 0, 1]) })
    tmpRoots.push(h.root)
    h.complete('s1')
    await drain(h.svc) // writes success episode 'Session wrapped up' (embeds lazily at search)
    h.episodicMemory.addEpisode({ kind: 'failure', sessionId: 's0', text: 'db migration broke everything' })
    const blocks = await h.svc.buildMemoryBlocks({ query: 'wrapping session work' })
    expect(blocks?.memoryBlock).toContain('## Related past sessions')
    expect(blocks?.memoryBlock).toContain('- success: Session wrapped up')
    expect(blocks?.memoryBlock).not.toContain('db migration')
  })

  it('semantic=true → episodic recall errors never break prompt assembly', async () => {
    const h = makeService({
      semantic: true,
      episodicMemory: { search: () => Promise.reject(new Error('episodic exploded')) } as unknown as EpisodicMemory,
    })
    tmpRoots.push(h.root)
    const blocks = await h.svc.buildMemoryBlocks({ query: 'anything' })
    expect(blocks).toBeDefined()
    expect(blocks?.memoryBlock ?? '').not.toContain('Related past sessions')
  })
})

describe('helpers', () => {
  it('redactSecrets masks common token shapes', () => {
    const input =
      'AWS=AKIAIOSFODNN7EXAMPLE sk-abcdefghijklmnopqrstuvwxyz0123 ghp_' +
      'a'.repeat(36) +
      ' xoxb-1234-5678-zzzz -----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj\n-----END RSA PRIVATE KEY----- apiKey = "SUPERSECRET"'
    const out = redactSecrets(input)
    for (const raw of ['AKIAIOSFODNN7EXAMPLE', 'sk-abc', 'ghp_', 'xoxb-', 'MIIBOgIBAAJBAKj', 'SUPERSECRET']) {
      expect(out).not.toContain(raw)
    }
  })

  it('parseDistillResult strips code fences, rejects garbage', () => {
    expect(
      parseDistillResult('```json\n{"history_entry":null,"memory_update":null,"lessons":[],"skill_candidate":null}\n```'),
    ).not.toBeNull()
    expect(parseDistillResult('garbage')).toBeNull()
  })

  it('redactSecrets masks extra literal patterns case-insensitively (P1)', () => {
    expect(redactSecrets('x ACME Corp y acme corp z', ['ACME Corp'])).toBe('x [REDACTED] y [REDACTED] z')
    expect(redactSecrets('nothing listed here', ['ACME Corp'])).toBe('nothing listed here')
  })

  it('redactSecrets treats extra patterns as literals, not regex', () => {
    // 'a+b' as a regex would also match 'aaab'; as a literal it must not.
    expect(redactSecrets('price a+b and aaab', ['a+b'])).toBe('price [REDACTED] and aaab')
    // Explicit empty list disables extras (no config fallback).
    expect(redactSecrets('ACME Corp', [])).toBe('ACME Corp')
  })
})

describe('applyResult output redaction (mem-sec-002)', () => {
  it('secrets in distiller OUTPUT are masked before persistence', async () => {
    const { svc, complete, wsLessons, wsFiles } = makeService({
      distiller: async () => JSON.stringify({
        history_entry: 'used api_key=abc123 in the fix',
        memory_update: 'token: AKIAIOSFODNN7EXAMPLE rotated',
        lessons: [{ rule: 'never log ghp_' + 'a'.repeat(36), category: 'security' }],
        skill_candidate: null,
      }),
    })
    complete()
    await drain(svc)
    const rules = wsLessons.list().map(l => l.rule).join('\n')
    expect(rules).not.toContain('ghp_aaaa')
    expect(wsFiles.readContext()).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(wsFiles.readHistory(new Date().toISOString().slice(0, 10))).not.toContain('api_key=abc123')
  })
})
describe('session memory modes (F3)', () => {
  it("incognito session skips completion-triggered distillation", async () => {
    const h = makeService({ modes: { s1: 'incognito' } })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
    expect(h.wsLessons.list()).toHaveLength(0)
  })
  it("temporary session skips completion + branch + message-count triggers", async () => {
    const h = makeService({ modes: { s1: 'temporary' } })
    tmpRoots.push(h.root)
    h.complete()
    h.svc.notifyBranchCorrection('s1', 'm2')
    for (let i = 1; i <= 30; i++) h.svc.notifyMessageCount('s1', i)
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
    expect(h.wsLessons.list()).toHaveLength(0)
  })
  it("incognito session skips idle distillation", async () => {
    let now = 1_000_000
    const h = makeService({ modes: { s1: 'incognito' }, clock: () => now })
    tmpRoots.push(h.root)
    h.svc.notifyMessageCount('s1', 1) // records activity but enqueues nothing
    now += 4 * 3_600_000 // past the 3h idle threshold
    h.svc.checkIdle(now)
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
  })
  it("persistent session (default) still distills normally", async () => {
    const h = makeService({ modes: {} })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
  })
  it("mode flip mid-session is honored per trigger", async () => {
    const modes: Record<string, SessionMemoryMode> = { s1: 'incognito' }
    const h = makeService({ modes })
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
    modes.s1 = 'persistent' // user flips back in the header toggle
    h.complete()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
  })
})

describe('feedback loop (L1)', () => {
  const T0 = 1_757_000_000_000
  const seedLesson = (rule: string, scope: LessonPromptUsage['scope']): Lesson => ({
    ts: '2026-01-01T00:00:00.000Z',
    rule,
    category: 'workflow',
    scope,
    source: { sessionId: 'seed', trigger: 'explicit' },
  })

  /** Service with one lesson per scope + provenance pointing at both. */
  function makeConflictFixture(opts: {
    modes?: Record<string, SessionMemoryMode>
    provenance?: (sessionId: string) => LessonPromptUsage[]
    distiller?: (prompt: string) => Promise<string>
  } = {}) {
    const h = makeService({
      clock: () => T0,
      modes: opts.modes,
      distiller: opts.distiller,
      provenance:
        opts.provenance ??
        (() => [
          { rule: 'Never push to main', scope: 'workspace' },
          { rule: 'Prefer bun over npm', scope: 'global' },
        ]),
    })
    tmpRoots.push(h.root)
    h.wsLessons.add(seedLesson('Never push to main', 'workspace'), 'rpc')
    h.globalLessons.add(seedLesson('Prefer bun over npm', 'global'), 'rpc')
    return h
  }

  it('branch completion attributes a branch conflict to every provenance lesson, per scope', async () => {
    const h = makeConflictFixture()
    h.branch()
    await drain(h.svc)
    const ts = new Date(T0).toISOString()
    expect(h.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts).toEqual([
      { sessionId: 's1', ts, reason: 'branch' },
    ])
    expect(h.globalLessons.list().find((l) => l.rule === 'Prefer bun over npm')?.conflicts).toEqual([
      { sessionId: 's1', ts, reason: 'branch' },
    ])
    // The distill still enqueued, with the branch trigger.
    expect(h.prompts).toHaveLength(1)
    expect(h.wsLessons.list().find((l) => l.rule === 'Run tests before shipping')?.source.trigger).toBe('branch')
  })

  it('reason mapping: interrupted→interrupted, error|timeout→error', async () => {
    for (const [kind, expected] of [
      ['interrupted', 'interrupted'],
      ['error', 'error'],
      ['timeout', 'error'],
    ] as const) {
      const h = makeConflictFixture()
      if (kind === 'interrupted') h.interrupted()
      else if (kind === 'error') h.error()
      else h.timeout()
      await drain(h.svc)
      const ws = h.wsLessons.list().find((l) => l.rule === 'Never push to main')
      expect(ws?.conflicts).toEqual([{ sessionId: 's1', ts: new Date(T0).toISOString(), reason: expected }])
    }
  })

  it('complete completion records no conflicts', async () => {
    const h = makeConflictFixture()
    h.complete()
    await drain(h.svc)
    expect(h.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts).toBeUndefined()
    expect(h.globalLessons.list().find((l) => l.rule === 'Prefer bun over npm')?.conflicts).toBeUndefined()
    expect(h.prompts).toHaveLength(1)
  })

  it('conflict is attributed BEFORE the distiller runs', async () => {
    let conflictsAtDistill = 0 // 0 = distiller saw no conflicts (or never ran)
    const h = makeConflictFixture({
      distiller: async () => {
        conflictsAtDistill = h.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts?.length ?? 0
        return JSON.stringify(OK)
      },
    })
    h.interrupted()
    await drain(h.svc)
    expect(conflictsAtDistill).toBe(1)
  })

  it('no provenance dep → distill proceeds, no conflicts recorded', async () => {
    const h = makeService({ clock: () => T0 }) // provenance dep absent entirely
    tmpRoots.push(h.root)
    h.wsLessons.add(seedLesson('Never push to main', 'workspace'), 'rpc')
    h.interrupted()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
    expect(h.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts).toBeUndefined()
  })

  it('empty or unmatched provenance → no conflicts, distill proceeds', async () => {
    const empty = makeConflictFixture({ provenance: () => [] })
    empty.interrupted()
    await drain(empty.svc)
    expect(empty.prompts).toHaveLength(1)
    expect(empty.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts).toBeUndefined()

    // Provenance referencing rules absent from the stores must not throw
    // (recordConflict returns null) nor block the distill.
    const ghost = makeConflictFixture({
      provenance: () => [
        { rule: 'Ghost workspace rule', scope: 'workspace' },
        { rule: 'Ghost global rule', scope: 'global' },
      ],
    })
    ghost.interrupted()
    await drain(ghost.svc)
    expect(ghost.prompts).toHaveLength(1)
    expect(ghost.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts).toBeUndefined()
  })

  it('incognito/temporary sessions record no conflicts (mode guard)', async () => {
    for (const mode of ['incognito', 'temporary'] as const) {
      const h = makeConflictFixture({ modes: { s1: mode } })
      h.interrupted()
      await drain(h.svc)
      expect(h.prompts).toHaveLength(0)
      expect(h.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts).toBeUndefined()
    }
  })

  it('memory.enabled=false records no conflicts and enqueues nothing', async () => {
    const h = makeConflictFixture()
    h.config.enabled = false
    h.branch()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(0)
    expect(h.wsLessons.list().find((l) => l.rule === 'Never push to main')?.conflicts).toBeUndefined()
  })
})

describe('negative-first distillation (L5)', () => {
  const NEG_INSTRUCTION = 'Prefer negative formulations (never/MUST NOT) for constraint-type lessons where idiomatic.'

  it('adds the negative-first instruction to full and lightweight prompts by default', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.complete()
    await drain(h.svc)
    h.interrupted()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(2)
    for (const prompt of h.prompts) expect(prompt).toContain(NEG_INSTRUCTION)
  })

  it('memory.negativeFirst=false omits the instruction', async () => {
    const h = makeService()
    tmpRoots.push(h.root)
    h.config.negativeFirst = false
    h.complete()
    await drain(h.svc)
    expect(h.prompts).toHaveLength(1)
    expect(h.prompts[0]).not.toContain(NEG_INSTRUCTION)
  })
})

