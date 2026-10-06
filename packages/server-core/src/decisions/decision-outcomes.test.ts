import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DecisionRecorder,
  SystemOneClient,
  isDecisionOutcomeRecord,
  normalizeDecisionLayerSettings,
  readDecisionLog,
  resolveDecisionEndpoint,
  type DecisionClientResolution,
  type DecisionLayerFeature,
  type DecisionOutcomeRecord,
  type DecisionRecord,
} from '@craft-agent/shared/decisions'
import { pickTurnThinkingLevel } from './adaptive-thinking'
import { checkAutomationCondition } from './automation-condition'
import { buildLargeResultFilter } from './large-results'
import { buildTurnOutcomeRequest, classifyTurnOutcome } from './turn-outcome'

function answering(feature: DecisionLayerFeature, answers: Record<string, unknown>): () => Promise<DecisionClientResolution> {
  return async () => {
    const settings = normalizeDecisionLayerSettings({ enabled: true, provider: 'openrouter', features: { [feature]: true } })
    const endpoint = resolveDecisionEndpoint(settings)
    const fetchImpl = (async () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 5, output_tokens: 1 } }), { status: 200 })) as unknown as typeof fetch
    const client = new SystemOneClient({ baseUrl: endpoint.baseUrl, apiKey: 'k', model: endpoint.model, fetch: fetchImpl })
    return { ok: true, value: { client, settings, provider: 'openrouter', endpoint, keySource: 'provider' } }
  }
}

describe('decision outcome records', () => {
  let dir: string
  let recorder: DecisionRecorder
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'decision-outcomes-'))
    recorder = new DecisionRecorder({ path: join(dir, 'decisions.jsonl') })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function lines(): Promise<{ decisions: DecisionRecord[]; outcomes: DecisionOutcomeRecord[] }> {
    await recorder.flush()
    const all = await readDecisionLog(recorder.path)
    return {
      decisions: all.filter((line): line is DecisionRecord => !isDecisionOutcomeRecord(line)),
      outcomes: all.filter(isDecisionOutcomeRecord),
    }
  }

  it('joins each outcome to its decision by id and says whether the answer changed anything', async () => {
    const lowered = answering('adaptiveThinking', { demand: { type: 'score', score: 1, confidence: 0.9, probabilities: { '1': 0.9 } }, consequential: { noul: 0.1 } })
    const unsure = answering('adaptiveThinking', { demand: { type: 'score', score: 0, confidence: 0.3, probabilities: { '0': 0.3 } }, consequential: { noul: 0.1 } })
    expect((await pickTurnThinkingLevel({ message: 'rename this' }, 'max', { resolveClient: lowered, recorder, sessionId: 's1' })).level).toBe('medium')
    expect((await pickTurnThinkingLevel({ message: 'thanks' }, 'max', { resolveClient: unsure, recorder, sessionId: 's1' })).level).toBeNull()

    const { decisions, outcomes } = await lines()
    expect(decisions).toHaveLength(2)
    expect(outcomes).toHaveLength(2)
    expect(outcomes.map(o => o.decisionId)).toEqual(decisions.map(d => d.id!))
    expect(outcomes[0]).toMatchObject({ feature: 'adaptive_thinking', sessionId: 's1', action: 'thinking:medium', changed: true, detail: { sessionLevel: 'max' } })
    expect(outcomes[1]).toMatchObject({ action: 'keep', changed: false, detail: { reason: 'low_confidence' } })
  })

  it('records no outcome when the call failed', async () => {
    const failing: () => Promise<DecisionClientResolution> = async () => {
      const resolution = await answering('adaptiveThinking', {})()
      if (!resolution.ok) return resolution
      const fetchImpl = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
      const client = new SystemOneClient({ baseUrl: resolution.value.endpoint.baseUrl, apiKey: 'k', model: resolution.value.endpoint.model, fetch: fetchImpl })
      return { ok: true, value: { ...resolution.value, client } }
    }
    expect((await pickTurnThinkingLevel({ message: 'thanks' }, 'max', { resolveClient: failing, recorder })).level).toBeNull()
    const { decisions, outcomes } = await lines()
    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.ok).toBe(false)
    expect(outcomes).toHaveLength(0)
  })

  it('tags large results and automation conditions with their session', async () => {
    const secondPart = answering('largeResults', Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}`, { noul: i === 1 ? 0.9 : 0.1 }])))
    const filter = buildLargeResultFilter({ resolveClient: secondPart, recorder })
    const text = Array.from({ length: 6 }, (_, i) => `${i} ${'x'.repeat(1_400)}`).join('\n\n')
    expect(await filter({ text, context: { toolName: 'grep', intent: 'find part 1' }, budgetChars: 24_000, filePath: '/f', sessionId: 'big' })).toMatchObject({ kept: 2, total: 6 })

    const no = answering('automationConditions', { condition: { type: 'noul', noul: 0.1 } })
    expect(await checkAutomationCondition({ question: 'Bug report?' }, { event: 'LabelAdd' }, { resolveClient: no, recorder, sessionId: 'auto', matcherId: 'm1' }))
      .toEqual({ run: false, probability: 0.1 })

    const { decisions, outcomes } = await lines()
    expect(decisions.map(d => [d.feature, d.sessionId])).toEqual([['large_results', 'big'], ['automation_condition', 'auto']])
    expect(decisions[1]!.meta).toMatchObject({ matcherId: 'm1' })
    expect(outcomes.map(o => [o.action, o.changed])).toEqual([['filter', true], ['skip', true]])
  })

  it('turn outcome: a closing offer is described as finished, and the outcome is recorded', async () => {
    const criteria = (buildTurnOutcomeRequest({ reply: 'Done.' }).questions.outcome as { criteria: Record<string, string> }).criteria
    expect(criteria.finished).toContain('closing offer')
    expect(criteria.needs_input).toContain('cannot continue without')

    const needsInput = answering('turnOutcome', { outcome: { type: 'choice', choice: 'needs_input', confidence: 0.95, probabilities: { needs_input: 0.95, finished: 0.05, blocked: 0 } } })
    expect(await classifyTurnOutcome({ reply: 'Which address should I use?' }, { resolveClient: needsInput, recorder, sessionId: 't' }))
      .toEqual({ outcome: 'needs_input', confidence: 0.95 })
    const { outcomes } = await lines()
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ feature: 'turn_outcome', sessionId: 't', action: 'needs_input', changed: true })
  })
})
