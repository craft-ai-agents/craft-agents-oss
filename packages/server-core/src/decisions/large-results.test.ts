import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DecisionRecorder,
  SystemOneClient,
  isDecisionFollowUpRecord,
  isDecisionOutcomeRecord,
  normalizeDecisionLayerSettings,
  readDecisionLog,
  resolveDecisionEndpoint,
  type DecisionClientResolution,
} from '@craft-agent/shared/decisions'
import {
  buildLargeResultFilter,
  chooseRelevantParts,
  finishLargeResultExcerpts,
  formatExcerpt,
  noteLargeResultFileUse,
  splitLargeResult,
} from './large-results'

/** A provider that answers each part's question with `score(part text)`. */
function scoringParts(score: (part: string) => number, calls: { questions: number }[] = []): () => Promise<DecisionClientResolution> {
  return async () => {
    const settings = normalizeDecisionLayerSettings({ enabled: true, provider: 'openrouter', features: { largeResults: true } })
    const endpoint = resolveDecisionEndpoint(settings)
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { questions: Record<string, { instructions: string }> }
      calls.push({ questions: Object.keys(body.questions).length })
      const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => [key, { noul: score(question.instructions) }]))
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 5, output_tokens: 0 } }), { status: 200 })
    }) as unknown as typeof fetch
    const client = new SystemOneClient({ baseUrl: endpoint.baseUrl, apiKey: 'k', model: endpoint.model, fetch: fetchImpl })
    return { ok: true, value: { client, settings, provider: 'openrouter', endpoint, keySource: 'provider' } }
  }
}

// Shaped like a Slack search.messages response.
const slackSearch = (count: number) => JSON.stringify({
  ok: true,
  query: 'in:#launches after:2026-09-01',
  messages: {
    total: count,
    matches: Array.from({ length: count }, (_, i) => ({
      ts: `17000000${i}.000`,
      user: `U${i % 4}`,
      text: i % 10 === 3 ? `NHL tab launch moved to Oct ${i}, confirmed by product` : `Standup notes ${i}: ${'nothing notable '.repeat(60)}`,
    })),
  },
  users: { U0: { name: 'ana' }, U1: { name: 'ben' } },
})

describe('splitLargeResult', () => {
  it('cuts a JSON result into the items of its main array, the rest of the object first', () => {
    const parts = splitLargeResult(slackSearch(40))
    expect(JSON.parse(parts[0]!)).toMatchObject({ query: 'in:#launches after:2026-09-01', messages: { total: 40, matches: '[40 items, the relevant ones follow]' }, users: { U0: { name: 'ana' } } })
    expect(parts).toHaveLength(41)
    expect(JSON.parse(parts[4]!)).toMatchObject({ text: expect.stringContaining('NHL tab launch moved to Oct 3') })
    // Short items are grouped.
    const tiny = splitLargeResult(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ i }))))
    expect(tiny.length).toBeLessThan(10)
    expect(tiny.every(part => part.length <= 300)).toBe(true)
  })

  it('starts a new part at every markdown heading', () => {
    const parts = splitLargeResult(['# Policies', 'intro', '## Gift cards', 'a'.repeat(200), '## Refunds', 'b'.repeat(200)].join('\n'))
    expect(parts).toEqual(['# Policies\nintro', `## Gift cards\n${'a'.repeat(200)}`, `## Refunds\n${'b'.repeat(200)}`])
  })

  it('cuts other text at blank lines, then lines, then characters', () => {
    const text = ['# Title', 'a'.repeat(1_000), 'b'.repeat(1_000), `${'line\n'.repeat(400)}`, 'x'.repeat(30_000)].join('\n\n')
    const parts = splitLargeResult(text)
    expect(parts[0]!.startsWith('# Title')).toBe(true)
    expect(parts.every(part => part.length <= 12_000)).toBe(true)
    expect(parts.join('').replace(/\s/g, '').length).toBe(text.replace(/\s/g, '').length)
  })
})

describe('chooseRelevantParts', () => {
  const parts = ['head', 'a', 'b', 'c', 'd', 'e']
  it('keeps the first part and the relevant ones in their order', () => {
    expect(chooseRelevantParts(parts, [0, 0.9, 0.1, 0.6, 0.2, 0.1], 1_000)).toEqual({ kept: [0, 1, 3] })
  })
  it('summarizes when nothing or nearly everything is relevant, or nothing fits', () => {
    expect(chooseRelevantParts(parts, [1, 0.4, 0.1, 0.2, 0.3, 0.1], 1_000)).toEqual({ reason: 'none_relevant' })
    expect(chooseRelevantParts(parts, [0, 0.9, 0.9, 0.9, 0.9, 0.9], 1_000)).toEqual({ reason: 'nearly_all_relevant' })
    expect(chooseRelevantParts(['head', 'x'.repeat(50), 'y', 'z', 'w'], [0, 0.9, 0, 0, 0], 20)).toEqual({ reason: 'over_budget' })
  })
  it('over budget, keeps the most relevant parts that fit', () => {
    const big = ['h', 'aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']
    expect(chooseRelevantParts(big, [0, 0.6, 0.95, 0.7, 0, 0], 9)).toEqual({ kept: [0, 2, 3] })
  })
  it('marks every gap', () => {
    expect(formatExcerpt(parts, [0, 3])).toBe('head\n[… 2 parts left out, see the saved file …]\nc\n[… 2 parts left out, see the saved file …]')
  })
})

describe('large result filter (decision model)', () => {
  let dir: string
  let recorder: DecisionRecorder
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'large-results-'))
    recorder = new DecisionRecorder({ path: join(dir, 'decisions.jsonl') })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const input = (intent?: string) => ({ text: slackSearch(40), context: { toolName: 'api_slack', intent }, budgetChars: 24_000, filePath: '/s/long_responses/2026-09-30T20-16-41_api_slack_.txt', sessionId: 'sess' })

  it('keeps the parts the intent needs, records the outcome, and whether the saved file was opened', async () => {
    const calls: { questions: number }[] = []
    const filter = buildLargeResultFilter({ resolveClient: scoringParts(part => (part.includes('NHL') ? 0.9 : 0.05), calls), recorder })
    const excerpt = await filter(input('When did the NHL tab launch move?'))
    expect(excerpt).not.toBeNull()
    expect(excerpt!.text).toContain('NHL tab launch moved to Oct 3')
    expect(excerpt!.text).not.toContain('Standup notes 0:')
    expect(excerpt!.text).toContain('left out, see the saved file')
    expect(excerpt!.kept).toBeLessThan(excerpt!.total)
    expect(calls.length).toBeGreaterThanOrEqual(1)

    noteLargeResultFileUse('sess', { pattern: 'NHL' })
    noteLargeResultFileUse('sess', { file_path: '/s/long_responses/2026-09-30T20-16-41_api_slack_.txt' })
    finishLargeResultExcerpts('sess')
    await recorder.flush()
    const lines = await readDecisionLog(recorder.path)
    expect(lines.filter(isDecisionOutcomeRecord)).toMatchObject([{ feature: 'large_results', action: 'filter', changed: true, detail: { total: excerpt!.total } }])
    expect(lines.filter(isDecisionFollowUpRecord).map(line => line.result)).toEqual(['file_read'])
  })

  it('writes file_not_read when the request ends with the file unopened', async () => {
    const filter = buildLargeResultFilter({ resolveClient: scoringParts(part => (part.includes('NHL') ? 0.9 : 0.05)), recorder })
    expect(await filter(input('When did the NHL tab launch move?'))).not.toBeNull()
    finishLargeResultExcerpts('sess')
    await recorder.flush()
    expect((await readDecisionLog(recorder.path)).filter(isDecisionFollowUpRecord).map(line => line.result)).toEqual(['file_not_read'])
  })

  it('asks nothing without an intent or with too few parts, and summarizes when the cut would not help', async () => {
    const calls: { questions: number }[] = []
    const everything = buildLargeResultFilter({ resolveClient: scoringParts(() => 0.9, calls), recorder })
    expect(await everything(input())).toBeNull()
    expect(await everything({ ...input('x'), text: 'short\n\nresult' })).toBeNull()
    expect(calls).toHaveLength(0)
    expect(await everything(input('everything'))).toBeNull()
    await recorder.flush()
    expect((await readDecisionLog(recorder.path)).filter(isDecisionOutcomeRecord)).toMatchObject([{ action: 'summarize', changed: false, detail: { reason: 'nearly_all_relevant' } }])
  })

  it('has no answer when the feature is off or the model fails', async () => {
    const off = buildLargeResultFilter({ resolveClient: async () => ({ ok: false, failure: { kind: 'disabled', message: 'off' } }) })
    expect(await off(input('x'))).toBeNull()
    const failing = buildLargeResultFilter({ resolveClient: scoringParts(() => { throw new Error('boom') }), recorder })
    expect(await failing(input('x'))).toBeNull()
  })
})
