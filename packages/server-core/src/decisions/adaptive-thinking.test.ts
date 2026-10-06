import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DecisionRecorder,
  SystemOneClient,
  isDecisionFollowUpRecord,
  normalizeDecisionLayerSettings,
  readDecisionLog,
  resolveDecisionEndpoint,
  type DecisionClientResolution,
  type DecisionRecord,
} from '@craft-agent/shared/decisions'
import { buildDemandRequest, chooseTurnLevel, pickTurnThinkingLevel, recordThinkingFollowUp } from './adaptive-thinking'

/** A provider that rates `demand` at `score` and answers the yes/no questions with `nouls` (default 0). */
function rated(score: number, confidence: number, nouls: Record<string, number> = {}): () => Promise<DecisionClientResolution> {
  return async () => {
    const settings = normalizeDecisionLayerSettings({ enabled: true, provider: 'openrouter', features: { adaptiveThinking: true } })
    const endpoint = resolveDecisionEndpoint(settings)
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const asked = Object.keys((JSON.parse(init.body as string) as { questions: Record<string, unknown> }).questions)
      const answers = Object.fromEntries(asked.map(key => [key, key === 'demand'
        ? { type: 'score', score, confidence, probabilities: { '0': 0.25, '1': 0.25, '2': 0.25, '3': 0.25 } }
        : { noul: nouls[key] ?? 0 }]))
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 5, output_tokens: 1 } }), { status: 200 })
    }) as unknown as typeof fetch
    const client = new SystemOneClient({ baseUrl: endpoint.baseUrl, apiKey: 'k', model: endpoint.model, fetch: fetchImpl })
    return { ok: true, value: { client, settings, provider: 'openrouter', endpoint, keySource: 'provider' } }
  }
}

const levelFor = async (message: string, session: Parameters<typeof pickTurnThinkingLevel>[1], resolveClient: () => Promise<DecisionClientResolution>, extra = {}) =>
  (await pickTurnThinkingLevel({ message, ...extra }, session, { resolveClient })).level

describe('pickTurnThinkingLevel', () => {
  it('lowers the level for simple turns, never above the session level', async () => {
    expect(await levelFor('thanks!', 'high', rated(0, 0.9))).toBe('low')
    expect(await levelFor('rename this variable', 'xhigh', rated(1, 0.9))).toBe('medium')
    expect(await levelFor('refactor the module', 'max', rated(2.2, 0.9))).toBe('high')
  })

  it('keeps the session level for hard turns, unsure answers and low session levels', async () => {
    expect(await levelFor('design the architecture', 'high', rated(3, 0.95))).toBeNull()
    expect(await levelFor('thanks!', 'high', rated(0, 0.4))).toBeNull()
    expect(await levelFor('thanks!', 'low', rated(0, 0.9))).toBeNull()
    expect(await levelFor('refactor', 'medium', rated(2, 0.9))).toBeNull()
  })

  it('never asks when thinking is off or the feature is disabled', async () => {
    let asked = 0
    const counting = async () => { asked++; return { ok: false as const, failure: { kind: 'disabled' as const, message: 'off' } } }
    expect(await levelFor('thanks!', 'off', counting)).toBeNull()
    expect(asked).toBe(0)
    expect(await levelFor('thanks!', 'high', counting)).toBeNull()
  })

  // Found in the 2026-09-30 log: "Here" with an attached analysis was rated low twice, and a
  // production data update ran at medium.
  it('reads the message with the end of the previous reply and the attachments\' names, never their content', () => {
    const request = buildDemandRequest({ message: 'Here', previousReply: `${'x'.repeat(5_000)}Send me the doc when ready.`, attachments: ['analysis.md (text, 14 KB)'] })
    const state = request.state as { previous_assistant_reply: string; attachments: string[] }
    expect(state.previous_assistant_reply.endsWith('Send me the doc when ready.')).toBe(true)
    expect(state.previous_assistant_reply.length).toBe(1_201)
    expect(state.attachments).toEqual(['analysis.md (text, 14 KB)'])
    expect(Object.keys(request.questions)).toEqual(['demand', 'consequential', 'corrects_previous'])
    // Without a previous reply there is nothing to correct.
    expect(Object.keys(buildDemandRequest({ message: 'hi' }).questions)).toEqual(['demand', 'consequential'])
  })

  it('keeps full thinking when the user pushes back, and at least high for consequential requests', async () => {
    expect(await levelFor('no, that is wrong', 'max', rated(0, 0.9, { corrects_previous: 0.8 }), { previousReply: 'Done.' })).toBeNull()
    expect(await levelFor('update the end date ONLY on this event', 'max', rated(1, 0.9, { consequential: 0.7 }))).toBe('high')
    expect(await levelFor('send it', 'medium', rated(0, 0.9, { consequential: 0.9 }))).toBeNull()
    expect(await levelFor('rename it', 'max', rated(1, 0.9, { consequential: 0.2 }))).toBe('medium')
  })
})

describe('chooseTurnLevel', () => {
  it('says why it keeps the session level', () => {
    expect(chooseTurnLevel(null, 'max')).toEqual({ keep: 'no_answer' })
    const answer = (score: number, nouls: Record<string, number> = {}) => ({
      model: 'm', modelReported: true, requestedModel: 'm', usage: { inputTokens: 1, outputTokens: 0 }, latencyMs: 1, state: { sha256: 'x', bytes: 1, truncated: false },
      answers: { demand: { type: 'score' as const, score, confidence: 0.9, probabilities: {} }, ...Object.fromEntries(Object.entries(nouls).map(([k, v]) => [k, { type: 'noul' as const, noul: v }])) },
    })
    expect(chooseTurnLevel(answer(0, { corrects_previous: 0.6 }), 'max')).toEqual({ keep: 'correction' })
    expect(chooseTurnLevel(answer(3), 'max')).toEqual({ keep: 'needs_session_level' })
    expect(chooseTurnLevel(answer(0, { consequential: 0.5 }), 'max')).toEqual({ level: 'high', floored: true })
    expect(chooseTurnLevel(answer(2, { consequential: 0.9 }), 'max')).toEqual({ level: 'high', floored: false })
  })
})

describe('thinking follow-up', () => {
  let dir: string
  let recorder: DecisionRecorder
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adaptive-thinking-'))
    recorder = new DecisionRecorder({ path: join(dir, 'decisions.jsonl') })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes whether the user pushed back as a follow-up on the previous turn\'s decision', async () => {
    const first = await pickTurnThinkingLevel({ message: 'rename it' }, 'max', { resolveClient: rated(1, 0.9), recorder })
    const second = await pickTurnThinkingLevel({ message: 'that broke the build', previousReply: 'Renamed.' }, 'max', { resolveClient: rated(2, 0.9, { corrects_previous: 0.85 }), recorder })
    recordThinkingFollowUp(first.result!, second.result)
    const third = await pickTurnThinkingLevel({ message: 'thanks', previousReply: 'Fixed.' }, 'max', { resolveClient: rated(0, 0.9, { corrects_previous: 0.1 }), recorder })
    recordThinkingFollowUp(second.result!, third.result)
    await recorder.flush()
    const lines = await readDecisionLog(recorder.path)
    const decisions = lines.filter((line): line is DecisionRecord => !('kind' in line))
    expect(lines.filter(isDecisionFollowUpRecord).map(f => [f.decisionId, f.result, f.detail])).toEqual([
      [decisions[0]!.id, 'corrected', { p: 0.85 }],
      [decisions[1]!.id, 'accepted', { p: 0.1 }],
    ])
  })
})
