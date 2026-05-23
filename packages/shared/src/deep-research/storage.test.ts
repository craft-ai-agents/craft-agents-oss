import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  deleteDeepResearchRun,
  listDeepResearchRuns,
  markRunningDeepResearchRunsInterrupted,
  readDeepResearchRun,
  writeDeepResearchRun,
} from './storage.ts'
import type { DeepResearchRunSnapshot } from './types.ts'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'runneros-deep-research-'))
  roots.push(root)
  return root
}

function sampleRun(id = randomUUID(), createdAt = '2026-05-23T12:00:00.000Z'): DeepResearchRunSnapshot {
  return {
    schemaVersion: 1,
    id,
    workspaceId: 'workspace-1',
    title: 'Research test',
    topic: 'Research test',
    state: 'awaiting_plan_approval',
    planPolicy: 'approve',
    sourceReadiness: { requested: [], usable: [], missing: [], unusable: [] },
    plan: {
      id: randomUUID(),
      title: 'Research test',
      objective: 'Research test',
      policy: 'approve',
      depth: 'standard',
      reportFormat: 'standard',
      loopBudget: { depth: 'standard', maxSearchRounds: 3, maxPagesToOpen: 8, minFollowUpRounds: 1 },
      sourceProfiles: [],
      steps: [
        {
          id: 'collect-evidence',
          kind: 'research',
          title: 'Collect Evidence',
          instructions: 'Collect evidence.',
          requiredSourceSlugs: [],
        },
      ],
      requiredSourceSlugs: [],
      assumptions: [],
      riskNotes: [],
      createdAt,
    },
    steps: [{ id: 'collect-evidence', kind: 'research', title: 'Collect Evidence', state: 'queued' }],
    events: [{ ts: createdAt, type: 'created', message: 'created' }],
    createdAt,
    updatedAt: createdAt,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('deep research run storage', () => {
  test('writes and reads a run snapshot', () => {
    const root = tempRoot()
    const run = sampleRun()
    writeDeepResearchRun(root, run)
    expect(readDeepResearchRun(root, run.id)).toEqual(run)
  })

  test('lists newest runs first', () => {
    const root = tempRoot()
    const older = sampleRun(randomUUID(), '2026-05-23T12:00:00.000Z')
    const newer = sampleRun(randomUUID(), '2026-05-23T13:00:00.000Z')
    writeDeepResearchRun(root, older)
    writeDeepResearchRun(root, newer)
    expect(listDeepResearchRuns(root).map((run) => run.id)).toEqual([newer.id, older.id])
  })

  test('rejects path-like run ids', () => {
    const root = tempRoot()
    expect(readDeepResearchRun(root, '../bad')).toBeNull()
    expect(deleteDeepResearchRun(root, '../bad')).toBe(false)
  })

  test('marks running runs interrupted on recovery', () => {
    const root = tempRoot()
    const run = sampleRun()
    run.state = 'running'
    run.steps[0]!.state = 'running'
    writeDeepResearchRun(root, run)
    const changed = markRunningDeepResearchRunsInterrupted(root, 'recovered after restart')
    expect(changed).toHaveLength(1)
    const recovered = readDeepResearchRun(root, run.id)
    expect(recovered?.state).toBe('interrupted')
    expect(recovered?.steps[0]?.state).toBe('failed')
    expect(recovered?.error).toBe('recovered after restart')
  })
})
