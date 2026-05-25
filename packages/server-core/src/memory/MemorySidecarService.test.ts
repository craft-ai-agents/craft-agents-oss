import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listMemoryReviewItems } from '@craft-agent/shared/memory'
import {
  createMemorySidecarReviewer,
  MemorySidecarService,
  parseMemorySidecarDecision,
  type MemorySidecarReviewer,
} from './MemorySidecarService'

let root: string
let agentsRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'runneros-memory-sidecar-'))
  agentsRoot = join(root, '.agents')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('MemorySidecarService', () => {
  test('queues one safe high-confidence save proposal', async () => {
    const service = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'prefers browser loops',
        type: 'feedback',
        content: 'Deep Research should perform browser follow-up loops before synthesis.',
        confidence: 0.93,
        evidence: 'User said browser work loop and follow-up search are most important.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    const result = await service.reviewTurn({
      userMessage: 'browser loops matter',
      assistantResponse: 'noted',
      activeAgentSlug: 'deep-researcher',
      runId: 'run_123',
    })

    expect(result.queued).toBe(true)
    const queued = listMemoryReviewItems({ globalAgentsDir: agentsRoot })
    expect(queued).toEqual([expect.objectContaining({
      action: 'save',
      scope: 'agent',
      agentSlug: 'deep-researcher',
      name: 'prefers browser loops',
      sourceRunId: 'run_123',
    })])
  })

  test('rejects low-confidence or secret-looking proposals', async () => {
    const lowConfidence = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'user',
        name: 'maybe preference',
        type: 'feedback',
        content: 'Might like long reports.',
        confidence: 0.4,
        evidence: 'Weak signal.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    expect((await lowConfidence.reviewTurn({
      userMessage: 'ok',
      assistantResponse: 'done',
    })).queued).toBe(false)

    const secret = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'user',
        name: 'api key',
        type: 'reference',
        content: 'api_key=sk-testsecret123456',
        confidence: 0.99,
        evidence: 'User pasted a token.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    expect((await secret.reviewTurn({
      userMessage: 'remember this api_key=sk-testsecret123456',
      assistantResponse: 'no',
    })).queued).toBe(false)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([])
  })

  test('rejects duplicate proposals against compact memory index', async () => {
    const service = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'user',
        name: 'short answers',
        type: 'feedback',
        content: 'User prefers short answers.',
        confidence: 0.91,
        evidence: 'User asked for concise output.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    const result = await service.reviewTurn({
      userMessage: 'keep it short',
      assistantResponse: 'ok',
      existingMemoryIndex: [{
        scope: 'user',
        name: 'short answers',
        type: 'feedback',
        body: 'User prefers short answers.',
      }],
    })

    expect(result.queued).toBe(false)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([])
  })

  test('rejects duplicate agent proposals when reviewer omits agent slug', async () => {
    const service = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'browser loops',
        type: 'feedback',
        content: 'Deep Research should use browser follow-up loops.',
        confidence: 0.92,
        evidence: 'User emphasized browser loops.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    const result = await service.reviewTurn({
      userMessage: 'browser loops matter',
      assistantResponse: 'ok',
      activeAgentSlug: 'deep-researcher',
      existingMemoryIndex: [{
        scope: 'agent',
        agentSlug: 'deep-researcher',
        name: 'browser loops',
        type: 'feedback',
        body: 'Deep Research should use browser follow-up loops.',
      }],
    })

    expect(result.queued).toBe(false)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([])
  })

  test('allows update proposals for existing memory names', async () => {
    const service = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'update',
        scope: 'user',
        name: 'answer length',
        type: 'feedback',
        content: 'User now prefers concise but complete answers.',
        confidence: 0.9,
        evidence: 'User clarified answer style.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    const result = await service.reviewTurn({
      userMessage: 'keep it concise but complete',
      assistantResponse: 'ok',
      existingMemoryIndex: [{
        scope: 'user',
        name: 'answer length',
        type: 'feedback',
        body: 'User prefers very short answers.',
      }],
    })

    expect(result.queued).toBe(true)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([
      expect.objectContaining({ action: 'update', name: 'answer length' }),
    ])
  })

  test('parses fenced JSON reviewer output', async () => {
    const decision = parseMemorySidecarDecision('```json\n{"decision":"save","scope":"user","name":"short answers","type":"feedback","content":"User prefers concise responses.","confidence":0.91,"evidence":"User asked for concise output."}\n```')
    expect(decision).toMatchObject({
      decision: 'save',
      scope: 'user',
      name: 'short answers',
      type: 'feedback',
      content: 'User prefers concise responses.',
    })
  })

  test('LLM reviewer returns none for invalid model output', async () => {
    const llmReviewer = createMemorySidecarReviewer(async () => 'not json')
    expect(await llmReviewer.review({
      userMessage: 'remember this',
      assistantResponse: 'ok',
    })).toMatchObject({ decision: 'none', reason: 'invalid json' })
  })
})

function reviewer(decision: Awaited<ReturnType<MemorySidecarReviewer['review']>>): MemorySidecarReviewer {
  return { review: async () => decision }
}
