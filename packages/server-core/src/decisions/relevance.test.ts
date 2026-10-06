import { describe, expect, it } from 'bun:test'
import type { DecisionRequest, DecisionResult } from '@craft-agent/shared/decisions'
import { packRelevanceCalls, scoreRelevance } from './relevance'

const result = (answers: DecisionResult['answers']): DecisionResult => ({ model: 'm', modelReported: true, requestedModel: 'm', answers, usage: { inputTokens: 1, outputTokens: 0 }, latencyMs: 1, state: { sha256: 'x', bytes: 1, truncated: false } })

describe('relevance scoring', () => {
  it('packs at most 64 questions and the state budget into each call', () => {
    expect(packRelevanceCalls(Array.from({ length: 130 }, () => 'x')).map(call => call.length)).toEqual([64, 64, 2])
    expect(packRelevanceCalls(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(10)], 50)).toEqual([[0], [1, 2]])
    expect(packRelevanceCalls(['a'.repeat(80), 'b'], 50)).toEqual([[0], [1]])
  })

  it('asks one question per part, with the part in the question and only the goal in the state, and maps the answers back', async () => {
    const requests: DecisionRequest[] = []
    const decide = async (request: DecisionRequest) => {
      requests.push(request)
      return result(Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: 'noul' as const, noul: key === 'p70' ? 0.8 : 0.1 }])))
    }
    const scored = await scoreRelevance(decide, 'find the outage', Array.from({ length: 100 }, (_, i) => `part ${i}`))
    expect(requests).toHaveLength(2)
    expect(requests[0]!.state).toEqual({ goal: 'find the outage' })
    expect(Object.keys(requests[0]!.questions)).toHaveLength(64)
    expect(requests[1]!.questions.p70).toEqual({ type: 'noul', instructions: 'Does this part of a tool result contain information needed to accomplish the goal?\n\nPart:\npart 70' })
    expect(scored!.scores[70]).toBe(0.8)
    expect(scored!.scores[0]).toBe(0.1)
    expect(scored!.results).toHaveLength(2)
  })

  it('has no answer when any call has none', async () => {
    let n = 0
    const flaky = async (request: DecisionRequest) => (n++ === 1 ? null : result(Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: 'noul' as const, noul: 0.5 }]))))
    expect(await scoreRelevance(flaky, 'g', Array.from({ length: 100 }, () => 'p'))).toBeNull()
  })
})
