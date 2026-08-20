/**
 * lesson-graph tests (self-learning v2, spec L2/L3).
 *
 * L3: scanPromotionCandidates across three tmp workspaces (two share a rule
 * under different casing/whitespace → one candidate), promoteLessonToGlobal
 * marking + dedup against an already-global rule.
 * L2: buildConflictPrompt/parseConflicts contract — strict JSON, fences
 * stripped, hallucinated rules and invalid relations dropped, garbage → [].
 *
 * process.env.CRAFT_CONFIG_DIR is rebound per test (MemoryFileStore reads it
 * lazily at construction) so the global store never touches the real home.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LessonCategory } from '@craft-agent/shared/memory/types'
import { LessonStore, lessonKey } from '../LessonStore'
import { MemoryFileStore } from '../MemoryFileStore'
import { buildConflictPrompt, parseConflicts, promoteLessonToGlobal, scanPromotionCandidates } from '../lesson-graph'

let configDir: string
let wsRoots: string[]
let realConfigDir: string | undefined

const addWorkspaceLesson = (rootPath: string, rule: string, category: LessonCategory = 'workflow') =>
  new LessonStore(new MemoryFileStore('workspace', rootPath).lessonsPath, 'workspace').add({
    ts: '2026-08-06T00:00:00.000Z',
    rule,
    category,
    scope: 'workspace',
    source: { trigger: 'explicit' },
  })

const workspaces = () => wsRoots.map((rootPath, i) => ({ id: `ws${i + 1}`, rootPath }))

const globalStore = () => new LessonStore(new MemoryFileStore('global').lessonsPath, 'global')

beforeEach(() => {
  realConfigDir = process.env.CRAFT_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'lesson-graph-config-'))
  process.env.CRAFT_CONFIG_DIR = configDir
  wsRoots = [0, 1, 2].map(() => mkdtempSync(join(tmpdir(), 'lesson-graph-ws-')))
})

afterEach(() => {
  if (realConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = realConfigDir
  rmSync(configDir, { recursive: true, force: true })
  for (const root of wsRoots) rmSync(root, { recursive: true, force: true })
})

describe('scanPromotionCandidates', () => {
  it('flags a normalized rule shared by ≥2 distinct workspaces, ignores the rest', () => {
    addWorkspaceLesson(wsRoots[0], 'Use bun, not npm')
    addWorkspaceLesson(wsRoots[1], '  use BUN, not npm  ') // same normalized key
    addWorkspaceLesson(wsRoots[2], 'Always run tests', 'knowledge')

    expect(scanPromotionCandidates(workspaces())).toEqual([
      { rule: 'Use bun, not npm', category: 'workflow', workspaceIds: ['ws1', 'ws2'] },
    ])
  })

  it('does not flag a rule duplicated within a single workspace', () => {
    addWorkspaceLesson(wsRoots[0], 'Use bun, not npm')
    expect(scanPromotionCandidates([{ id: 'ws1-a', rootPath: wsRoots[0] }, { id: 'ws1-b', rootPath: wsRoots[0] }])).toEqual([])
  })

  it('skips unreadable stores instead of throwing', () => {
    addWorkspaceLesson(wsRoots[0], 'Use bun, not npm')
    addWorkspaceLesson(wsRoots[1], 'use bun, not npm')
    const candidates = scanPromotionCandidates([...workspaces(), { id: 'ghost', rootPath: join(tmpdir(), 'no-such-root-xyz') }])
    expect(candidates).toHaveLength(1)
  })
})

describe('promoteLessonToGlobal', () => {
  it('writes the rule to the global store with the promoted marker', () => {
    addWorkspaceLesson(wsRoots[0], 'Use bun, not npm')
    addWorkspaceLesson(wsRoots[1], 'use bun, not npm', 'preference')

    const result = promoteLessonToGlobal(workspaces(), 'USE BUN, NOT NPM')
    expect(result).not.toBeNull()
    expect(result!.alreadyGlobal).toBe(false)
    expect(result!.workspaceIds).toEqual(['ws1', 'ws2'])
    expect(result!.lesson.scope).toBe('global')
    expect(result!.lesson.source.trigger).toBe('explicit')
    expect(result!.lesson.promoted).toMatchObject({ fromScope: 'workspace', workspaceIds: ['ws1', 'ws2'] })
    expect(typeof result!.lesson.promoted!.ts).toBe('string')

    const stored = globalStore().list()
    expect(stored).toHaveLength(1)
    expect(lessonKey(stored[0].rule)).toBe(lessonKey('Use bun, not npm'))
    expect(stored[0].promoted?.workspaceIds).toEqual(['ws1', 'ws2'])
    // fresh copy lands as an 'add' in the global audit log
    expect(readFileSync(join(configDir, 'memory', 'audit.jsonl'), 'utf8')).toContain('"action":"add"')
  })

  it('dedups against an already-global rule and re-marks it in place', () => {
    addWorkspaceLesson(wsRoots[0], 'Use bun, not npm')
    globalStore().add({
      ts: '2026-08-06T00:00:00.000Z',
      rule: 'Use bun, not npm',
      category: 'workflow',
      scope: 'global',
      source: { trigger: 'explicit' },
    })

    const result = promoteLessonToGlobal(workspaces(), 'use bun, not npm')
    expect(result).toMatchObject({ alreadyGlobal: true, workspaceIds: ['ws1'] })
    const stored = globalStore().list()
    expect(stored).toHaveLength(1)
    expect(stored[0].promoted).toMatchObject({ fromScope: 'workspace', workspaceIds: ['ws1'] })
    // dedup path is an in-place patch → audited 'promote'
    expect(readFileSync(join(configDir, 'memory', 'audit.jsonl'), 'utf8')).toContain('"action":"promote"')
  })

  it('returns null when no workspace store carries the rule', () => {
    addWorkspaceLesson(wsRoots[0], 'Something else')
    expect(promoteLessonToGlobal(workspaces(), 'Use bun, not npm')).toBeNull()
    expect(globalStore().list()).toEqual([])
  })
})

describe('L2 conflict prompt/parse contract', () => {
  const existing = ['Always run tests', 'Never commit on Friday']

  it('prompt lists the new rule and every existing rule', () => {
    const prompt = buildConflictPrompt('Deploy on Fridays', existing)
    expect(prompt).toContain('Deploy on Fridays')
    for (const rule of existing) expect(prompt).toContain(`- ${rule}`)
    expect(prompt).toContain('"contradicts"')
  })

  it('parses strict JSON, dropping hallucinated rules and bad relations', () => {
    const text = JSON.stringify({
      conflicts: [
        { existingRule: 'never COMMIT on Friday ', relation: 'contradicts' },
        { existingRule: 'nonexistent rule', relation: 'subsumes' }, // hallucination
        { existingRule: 'Always run tests', relation: 'tangent' }, // invalid enum
      ],
      rationale: 'Friday rule vs deploy on Fridays',
    })
    expect(parseConflicts(text, existing)).toEqual([
      { existingRule: 'Never commit on Friday', relation: 'contradicts', rationale: 'Friday rule vs deploy on Fridays' },
    ])
  })

  it('strips markdown fences', () => {
    const text = '```json\n{"conflicts":[{"existingRule":"Always run tests","relation":"subsumes"}]}\n```'
    expect(parseConflicts(text, existing).map(v => v.relation)).toEqual(['subsumes'])
  })

  it('returns [] on garbage, empty replies and missing arrays', () => {
    expect(parseConflicts('not json at all', existing)).toEqual([])
    expect(parseConflicts('', existing)).toEqual([])
    expect(parseConflicts('{"oops": true}', existing)).toEqual([])
    expect(parseConflicts('[1,2,3]', existing)).toEqual([])
  })
})
