import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DecisionError,
  DecisionRecorder,
  normalizeDecisionLayerSettings,
  readDecisionLog,
  resolveDecisionEndpoint,
  type DecisionClientResolution,
  type DecisionRecord,
  type DecisionRequest,
  type DecisionResult,
} from '@craft-agent/shared/decisions'
import { DECISION_COLD_AFTER_MS, DECISION_COLD_DEADLINE_MS, openDecisionPoint } from './decision-point'

const REQUEST: DecisionRequest = { state: { message: 'hi' }, questions: { q: { type: 'noul', instructions: 'Is it a greeting?' } } }

// Before: every call ran under the 1.5 s default, and the calls after idle were the ones that timed out.
describe('cold-start deadline', () => {
  let dir: string
  let recorder: DecisionRecorder
  // Ahead of the real clock, so warmth left by other test files (real clock) reads as long idle.
  let clock: number
  const seen: number[] = []
  let failNext = false

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'decision-point-'))
    recorder = new DecisionRecorder({ path: join(dir, 'decisions.jsonl') })
    clock = Date.now() + 10 * 24 * 3600_000
    seen.length = 0
    failNext = false
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // A distinct provider per test keeps the process-wide warmth from leaking between tests.
  function open(provider: 'laya' | 'custom', maxDeadlineMs?: number) {
    const resolveClient = async (): Promise<DecisionClientResolution> => {
      const settings = normalizeDecisionLayerSettings({ enabled: true, provider, baseUrl: 'http://127.0.0.1:9', features: { turnOutcome: true } })
      const endpoint = resolveDecisionEndpoint(settings)
      const client = {
        decide: async (request: DecisionRequest): Promise<DecisionResult> => {
          seen.push(request.deadlineMs!)
          if (failNext) { failNext = false; throw new DecisionError('timeout', 'slow') }
          return { model: 'm', modelReported: true, requestedModel: 'm', answers: { q: { type: 'noul', noul: 0.9 } }, usage: { inputTokens: 1, outputTokens: 0 }, latencyMs: 5, state: { sha256: 'x', bytes: 2, truncated: false } }
        },
      }
      return { ok: true, value: { client: client as never, settings, provider, endpoint, keySource: 'none' } }
    }
    return openDecisionPoint({ feature: 'turnOutcome', record: 'turn_outcome', resolveClient, recorder, now: () => clock, maxDeadlineMs })
  }

  it('gives the first call after idle the longer deadline, and warm calls the configured one', async () => {
    const decide = (await open('laya'))!
    await decide(REQUEST)                       // never answered: cold
    clock += 10_000
    await decide(REQUEST)                       // 10 s later: warm
    clock += DECISION_COLD_AFTER_MS
    await decide(REQUEST)                       // 30 s since the last answer: cold again
    expect(seen).toEqual([DECISION_COLD_DEADLINE_MS, 1500, DECISION_COLD_DEADLINE_MS])

    await recorder.flush()
    const records = (await readDecisionLog(recorder.path)) as DecisionRecord[]
    expect(records.map(r => r.coldStart ?? false)).toEqual([true, false, true])
  })

  it('stays under the point\'s cap, and a failed call does not count as warm', async () => {
    const decide = (await open('custom', 2_000))!
    failNext = true
    expect(await decide(REQUEST)).toBeNull()
    clock += 1_000
    await decide(REQUEST)                       // still cold: the failure did not warm it
    clock += 1_000
    await decide(REQUEST)
    expect(seen).toEqual([2_000, 2_000, 1500])
  })
})
