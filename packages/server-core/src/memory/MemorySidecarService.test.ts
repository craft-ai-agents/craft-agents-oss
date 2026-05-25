import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listAgentMemoryEntries, listMemoryReviewItems, saveMemoryEntry } from '@craft-agent/shared/memory'
import {
  buildMemorySidecarPrompt,
  createAgentMemorySidecarApplyMemory,
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
  test('auto-applies one safe high-confidence agent save proposal', async () => {
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
      applyMemory: async (proposal) => {
        const saved = await saveMemoryEntry({
          scope: 'agent',
          agentSlug: proposal.agentSlug,
          name: proposal.name,
          type: proposal.type!,
          body: proposal.body!,
        }, { globalAgentsDir: agentsRoot })
        return { ok: true, name: saved.name }
      },
    })

    const result = await service.reviewTurn({
      userMessage: 'browser loops matter',
      assistantResponse: 'noted',
      activeAgentSlug: 'deep-researcher',
      runId: 'run_123',
    })

    expect(result).toMatchObject({
      queued: false,
      applied: true,
      scope: 'agent',
      agentSlug: 'deep-researcher',
      name: 'prefers browser loops',
    })
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([])
    expect(listAgentMemoryEntries('deep-researcher', { globalAgentsDir: agentsRoot })).toEqual([
      expect.objectContaining({
        name: 'prefers browser loops',
        body: 'Deep Research should perform browser follow-up loops before synthesis.',
      }),
    ])
  })

  test('queues safe save proposal when no auto-apply hook is configured', async () => {
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
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([expect.objectContaining({
      action: 'save',
      scope: 'agent',
      agentSlug: 'deep-researcher',
      name: 'prefers browser loops',
      sourceRunId: 'run_123',
    })])
  })

  test('queues user save proposals even when auto-apply hook exists', async () => {
    const service = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'user',
        name: 'short answers',
        type: 'feedback',
        content: 'User prefers concise answers.',
        confidence: 0.97,
        evidence: 'User said be concise.',
      }),
      storage: { globalAgentsDir: agentsRoot },
      applyMemory: async () => {
        throw new Error('should not auto-apply user memory')
      },
    })

    const result = await service.reviewTurn({
      userMessage: 'be concise',
      assistantResponse: 'ok',
      activeAgentSlug: 'deep-researcher',
    })

    expect(result.queued).toBe(true)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([
      expect.objectContaining({ action: 'save', scope: 'user', name: 'short answers' }),
    ])
  })

  test('queues update proposals even when auto-apply hook exists', async () => {
    const service = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'update',
        scope: 'agent',
        agentSlug: 'deep-researcher',
        name: 'answer style',
        type: 'feedback',
        content: 'Deep Research should be concise but complete.',
        confidence: 0.94,
        evidence: 'User clarified answer style.',
      }),
      storage: { globalAgentsDir: agentsRoot },
      applyMemory: async () => {
        throw new Error('should not auto-apply updates')
      },
    })

    const result = await service.reviewTurn({
      userMessage: 'concise but complete',
      assistantResponse: 'ok',
      activeAgentSlug: 'deep-researcher',
    })

    expect(result.queued).toBe(true)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([
      expect.objectContaining({ action: 'update', scope: 'agent', name: 'answer style' }),
    ])
  })

  test('queues agent save proposal when auto-apply fails', async () => {
    const service = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'browser loops',
        type: 'feedback',
        content: 'Deep Research should follow browser leads before synthesis.',
        confidence: 0.94,
        evidence: 'User asked for browser follow-up loops.',
      }),
      storage: { globalAgentsDir: agentsRoot },
      applyMemory: async () => ({ ok: false, error: 'write failed' }),
    })

    const result = await service.reviewTurn({
      userMessage: 'browser loops matter',
      assistantResponse: 'ok',
      activeAgentSlug: 'deep-researcher',
    })

    expect(result.queued).toBe(true)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([
      expect.objectContaining({ action: 'save', scope: 'agent', name: 'browser loops' }),
    ])
  })

  test('auto-apply dedupes concurrent agent save proposals before writing', async () => {
    const applyMemory = createAgentMemorySidecarApplyMemory({
      activeAgentSlug: 'deep-researcher',
      runId: 'run_race',
      storage: { globalAgentsDir: agentsRoot },
    })
    const makeService = () => new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'browser loops',
        type: 'feedback',
        content: 'Deep Research should follow browser leads before synthesis.',
        confidence: 0.94,
        evidence: 'User asked for browser follow-up loops.',
      }),
      storage: { globalAgentsDir: agentsRoot },
      applyMemory,
    })

    const [first, second] = await Promise.all([
      makeService().reviewTurn({
        userMessage: 'browser loops matter',
        assistantResponse: 'ok',
        activeAgentSlug: 'deep-researcher',
      }),
      makeService().reviewTurn({
        userMessage: 'browser loops matter',
        assistantResponse: 'ok',
        activeAgentSlug: 'deep-researcher',
      }),
    ])

    expect(first).toMatchObject({ queued: false, applied: true, name: 'browser loops' })
    expect(second).toMatchObject({ queued: false, applied: true, name: 'browser loops' })
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([])
    expect(listAgentMemoryEntries('deep-researcher', { globalAgentsDir: agentsRoot })).toEqual([
      expect.objectContaining({ name: 'browser loops' }),
    ])
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

  test('rejects provider tokens and env assignment secrets', async () => {
    const githubToken = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'github token',
        type: 'reference',
        content: 'Use ghp_1234567890abcdefghijklmnop for GitHub API calls.',
        confidence: 0.99,
        evidence: 'User pasted a GitHub token.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    expect((await githubToken.reviewTurn({
      userMessage: 'remember this token',
      assistantResponse: 'no',
      activeAgentSlug: 'coder',
    })).queued).toBe(false)

    const envSecret = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'openrouter env',
        type: 'reference',
        content: 'OPENROUTER_API_KEY=or-secret-1234567890',
        confidence: 0.99,
        evidence: 'User pasted an env var.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    expect((await envSecret.reviewTurn({
      userMessage: 'remember this env',
      assistantResponse: 'no',
      activeAgentSlug: 'coder',
    })).queued).toBe(false)
    expect(listMemoryReviewItems({ globalAgentsDir: agentsRoot })).toEqual([])
  })

  test('rejects transient workspace and runtime facts', async () => {
    const branchFact = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'current branch',
        type: 'project',
        content: 'The active branch is codex/memory-os-hardening.',
        confidence: 0.96,
        evidence: 'Branch status showed codex/memory-os-hardening.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    expect((await branchFact.reviewTurn({
      userMessage: 'where are we',
      assistantResponse: 'branch is codex/memory-os-hardening',
      activeAgentSlug: 'coder',
    })).queued).toBe(false)

    const runtimeFact = new MemorySidecarService({
      reviewer: reviewer({
        decision: 'save',
        scope: 'agent',
        name: 'electron runner',
        type: 'project',
        content: 'Electron dev server is running on localhost:5173.',
        confidence: 0.96,
        evidence: 'Smoke test launched the dev server.',
      }),
      storage: { globalAgentsDir: agentsRoot },
    })

    expect((await runtimeFact.reviewTurn({
      userMessage: 'launch electron',
      assistantResponse: 'running',
      activeAgentSlug: 'coder',
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

  test('prompt routes workspace-specific facts away from memory', () => {
    const prompt = buildMemorySidecarPrompt({
      userMessage: 'The RunnerOS branch is codex/memory-os.',
      assistantResponse: 'Noted.',
    })

    expect(prompt).toContain('Workspace-specific project facts belong in workspace context')
    expect(prompt).not.toContain('project facts, agent instructions')
  })
})

function reviewer(decision: Awaited<ReturnType<MemorySidecarReviewer['review']>>): MemorySidecarReviewer {
  return { review: async () => decision }
}
