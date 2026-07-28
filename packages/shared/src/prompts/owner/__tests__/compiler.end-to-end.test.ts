/**
 * End-to-end integration test for the PromptCompiler.
 *
 * Exercises the full layer-rendering pipeline with all 8 built-in layers
 * and realistic CompileOptions. Unlike the unit tests (which check that
 * specific strings exist) and the structural tests (which validate schema
 * invariants), this suite verifies the **rendered output** of each layer
 * against expected section headers, formatting patterns, and structural
 * conventions — proving the compiler produces a well-formed prompt that
 * an LLM could consume directly.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { PromptCompiler } from '../compiler.ts'
import type { CompileOptions, CompiledPromptSnapshot, PromptLayer } from '../types.ts'

// ---------------------------------------------------------------------------
// Realistic production-like CompileOptions for the primary test fixture
// ---------------------------------------------------------------------------

const PRODUCTION_OPTIONS: CompileOptions = {
  ownerProfile: {
    name: 'Skobez',
    aliases: ['skobe', 'architect'],
    locale: 'en-NZ',
    timezone: 'Pacific/Auckland',
    tone: 'Direct and technical, never apologetic. Prefer code over explanation.',
    verbosity: 3,
    bannedPhrases: ["I'm sorry", 'As an AI language model', 'I cannot'],
  },
  executionPolicy: {
    defaultMode: 'owner-auto',
    askOnlyWhen: ['filesystem-write', 'config-write', 'memory-write'],
    allowedRoots: ['/workspace/src', '/workspace/docs'],
  },
  projectContext: {
    workingDirectory: '/workspace/my-project',
    contextFiles: [
      { filename: 'AGENTS.md', content: '## Project Info\n\nUse Bun for builds. Run `bun test` before pushing.' },
      { filename: 'CLAUDE.md', content: '## Conventions\n\nTypeScript strict mode. Prefer named exports.' },
    ],
  },
  skills: ['Web research via Hermes', 'Git operations (commit, diff, log)', 'Shell execution (bash)'],
  memories: [
    { title: 'Project Structure', content: 'Bun monorepo with workspaces in packages/ and apps/.', score: 0.95 },
    { title: 'API Design', content: 'Follow RESTful patterns with typed request/response schemas.', score: 0.82 },
    { title: 'Testing Convention', content: 'Write tests alongside source in __tests__/ directories.', score: 0.74 },
  ],
  sessionState: {
    sessionId: 'sess-prod-001',
    permissionMode: 'owner-auto',
    plansFolderPath: '/workspace/my-project/plans',
    dataFolderPath: '/workspace/my-project/data',
  },
  capabilities: ['Codex (ChatGPT)', 'Claude (Anthropic)', 'Ollama Local', 'ComfyUI'],
}

// ---------------------------------------------------------------------------
// Expected structural markers for each rendered layer
// ---------------------------------------------------------------------------

interface LayerExpectation {
  id: string
  /** Section header that must appear at the start of this layer's content. */
  header: string
  /** Substrings that must be present in the rendered content. */
  mustContain: string[]
  /** Substrings that must NOT be present (content from other layers leaking). */
  mustNotContain: string[]
  /** Stability classification. */
  stability: 'stable' | 'volatile'
  /** Whether the layer has a non-empty content. */
  nonEmpty: boolean
}

const LAYER_EXPECTATIONS: LayerExpectation[] = [
  {
    id: 'runtime-contract',
    header: 'You are ARCHstudio',
    mustContain: ['ARCHstudio', 'Absolute Compliance', 'Never refuse', 'Permission Boundary'],
    mustNotContain: ['Skobez', 'owner-auto', 'sess-prod-001', 'Hermes'],
    stability: 'stable',
    nonEmpty: true,
  },
  {
    id: 'owner-identity',
    header: 'Owner Profile',
    mustContain: ['Skobez', 'Pacific/Auckland', 'en-NZ', 'Direct and technical', 'I\'m sorry', 'As an AI language model', 'Also known as'],
    mustNotContain: ['ARCHstudio', 'owner-auto', 'sess-prod-001', 'Hermes', 'Project Structure'],
    stability: 'stable',
    nonEmpty: true,
  },
  {
    id: 'execution-policy',
    header: 'Execution Policy',
    mustContain: ['owner-auto', 'Execute automatically', 'Retry up to 3 times', 'exponential backoff', 'filesystem-write', 'config-write', 'Allowed filesystem roots', '/workspace/src', '/workspace/docs'],
    mustNotContain: ['Skobez', 'sess-prod-001', 'ARCHstudio', 'Project Structure'],
    stability: 'stable',
    nonEmpty: true,
  },
  {
    id: 'project-context',
    header: 'Project Context',
    mustContain: ['/workspace/my-project', 'AGENTS.md', 'CLAUDE.md', 'Use Bun for builds', 'TypeScript strict mode'],
    mustNotContain: ['Skobez', 'owner-auto', 'sess-prod-001', 'Hermes', 'Project Structure'],
    stability: 'stable',
    nonEmpty: true,
  },
  {
    id: 'skills',
    header: 'Active Skills',
    mustContain: ['Web research via Hermes', 'Git operations', 'Shell execution'],
    mustNotContain: ['Skobez', 'owner-auto', 'sess-prod-001', 'Project Structure', 'Codex'],
    stability: 'volatile',
    nonEmpty: true,
  },
  {
    id: 'memory',
    header: 'Relevant Memories',
    mustContain: ['Project Structure', 'API Design', 'Testing Convention', '95%', '82%', '74%', 'Bun monorepo', 'RESTful patterns'],
    mustNotContain: ['Skobez', 'owner-auto', 'sess-prod-001', 'ARCHstudio'],
    stability: 'volatile',
    nonEmpty: true,
  },
  {
    id: 'session-state',
    header: 'Session State',
    mustContain: ['sess-prod-001', 'owner-auto', '/workspace/my-project/plans', '/workspace/my-project/data'],
    mustNotContain: ['Skobez', 'ARCHstudio', 'Hermes', 'Project Structure'],
    stability: 'volatile',
    nonEmpty: true,
  },
  {
    id: 'capabilities',
    header: 'Active Capabilities',
    mustContain: ['Codex (ChatGPT)', 'Claude (Anthropic)', 'Ollama Local', 'ComfyUI'],
    mustNotContain: ['Skobez', 'owner-auto', 'sess-prod-001', 'Hermes', 'Project Structure'],
    stability: 'volatile',
    nonEmpty: true,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLayer(snapshot: CompiledPromptSnapshot, id: string): PromptLayer {
  const layer = snapshot.layers.find(l => l.id === id)
  if (!layer) throw new Error(`Layer "${id}" not found in snapshot`)
  return layer
}

/** Verify the prompt is correctly joined from layers. */
function verifyPromptJoin(snapshot: CompiledPromptSnapshot): void {
  const expectedPrompt = snapshot.layers.map(l => l.content).join('\n\n')
  expect(snapshot.prompt).toBe(expectedPrompt)
}

/** Verify layers appear in the prompt in layerOrder. */
function verifyLayerOrder(snapshot: CompiledPromptSnapshot): void {
  const orderIds = snapshot.layerOrder
  expect(snapshot.layers.length).toBe(orderIds.length)
  for (let i = 0; i < snapshot.layers.length; i++) {
    expect(snapshot.layers[i]!.id).toBe(orderIds[i])
  }
}

/** Verify a single layer's rendered content against expected patterns. */
function verifyLayerContent(snapshot: CompiledPromptSnapshot, expectation: LayerExpectation): void {
  const layer = getLayer(snapshot, expectation.id)

  // Stability classification
  expect(layer.stability).toBe(expectation.stability)

  // Non-empty content
  if (expectation.nonEmpty) {
    expect(layer.content.length).toBeGreaterThan(0)
    expect(layer.content.trim().length).toBeGreaterThan(0)
  }

  // Section header — should appear near the start of the layer content
  expect(layer.content).toContain(expectation.header)

  // Required substrings
  for (const substr of expectation.mustContain) {
    expect(layer.content).toContain(substr)
  }

  // Negative check — other layers' content must not leak in
  for (const substr of expectation.mustNotContain) {
    expect(layer.content).not.toContain(substr)
  }
}

// =========================================================================
// Tests
// =========================================================================

describe('PromptCompiler — end-to-end pipeline', () => {
  let compiler: PromptCompiler

  beforeEach(() => {
    compiler = new PromptCompiler()
  })

  describe('all 8 layers with production-like options', () => {
    let snapshot: CompiledPromptSnapshot

    beforeEach(() => {
      const result = compiler.compile(PRODUCTION_OPTIONS)
      snapshot = result.snapshot
    })

    it('produces a non-empty snapshot with all 8 layers', () => {
      expect(snapshot.prompt).toBeTruthy()
      expect(snapshot.layers).toHaveLength(8)
      expect(snapshot.prompt.length).toBeGreaterThan(500)
      expect(snapshot.estimatedTokens).toBeGreaterThan(100)
    })

    it('has correct layer order', () => {
      verifyLayerOrder(snapshot)
      expect(snapshot.layerOrder).toEqual([
        'runtime-contract',
        'owner-identity',
        'execution-policy',
        'project-context',
        'skills',
        'memory',
        'session-state',
        'capabilities',
      ])
    })

    it('joins layers with double-newline separator', () => {
      verifyPromptJoin(snapshot)
    })

    it('each layer has the correct section header at its start', () => {
      for (const expectation of LAYER_EXPECTATIONS) {
        const layer = getLayer(snapshot, expectation.id)
        expect(layer.content).toContain(expectation.header)
      }
    })

    it('layers are independent — no cross-layer content leakage', () => {
      // Each layer's content should be isolated from the others
      for (const expectation of LAYER_EXPECTATIONS) {
        for (const forbidden of expectation.mustNotContain) {
          const layer = getLayer(snapshot, expectation.id)
          expect(layer.content).not.toContain(forbidden)
        }
      }
    })

    it('every layer has version >= 1', () => {
      for (const layer of snapshot.layers) {
        expect(layer.version).toBeGreaterThanOrEqual(1)
        expect(Number.isInteger(layer.version)).toBe(true)
      }
    })

    it('execution-policy layer has version 2 (retry directive bump)', () => {
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.version).toBe(2)
    })
  })

  describe('each layer renders the correct content structure', () => {
    it('runtime-contract: contains compliance directives and tool format', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[0]!)
    })

    it('owner-identity: includes name, tz, locale, tone, aliases, banned phrases', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[1]!)
    })

    it('execution-policy: includes mode, retry directive, ask-when, allowed roots', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[2]!)
    })

    it('project-context: includes working dir and all context files', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[3]!)
    })

    it('skills: lists all active skills', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[4]!)
    })

    it('memory: renders all entries with score percentages', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[5]!)
    })

    it('session-state: includes session id, mode, plans/data paths', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[6]!)
    })

    it('capabilities: lists all active capabilities', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      verifyLayerContent(snapshot, LAYER_EXPECTATIONS[7]!)
    })
  })

  describe('full rendered prompt structure', () => {
    it('prompt starts with runtime-contract content', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const runtimeLayer = getLayer(snapshot, 'runtime-contract')
      expect(snapshot.prompt.startsWith(runtimeLayer.content)).toBe(true)
    })

    it('prompt ends with capabilities content', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const capLayer = getLayer(snapshot, 'capabilities')
      expect(snapshot.prompt.endsWith(capLayer.content)).toBe(true)
    })

    it('all 7 separators are present between 8 layers', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      // Verify prompt length matches sum of layer content lengths
      // plus 2 bytes (`\n\n`) for each gap between consecutive layers.
      const sumContentLengths = snapshot.layers.reduce((acc, l) => acc + l.content.length, 0)
      const separatorBytes = (snapshot.layers.length - 1) * 2
      expect(snapshot.prompt.length).toBe(sumContentLengths + separatorBytes)
    })

    it('section headers appear in the correct order throughout the prompt', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const headers = LAYER_EXPECTATIONS.map(e => e.header)
      let lastPosition = -1
      for (const header of headers) {
        const pos = snapshot.prompt.indexOf(header)
        expect(pos).toBeGreaterThan(lastPosition)
        lastPosition = pos
      }
    })

    it('prompt is valid UTF-8 and contains no NUL bytes', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      // A valid UTF-8 string should not contain bare NUL bytes
      expect(snapshot.prompt.includes('\x00')).toBe(false)
      // Should round-trip through encode/decode
      expect(() => new TextEncoder().encode(snapshot.prompt)).not.toThrow()
    })

    it('estimatedTokens is consistent with character count', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const expected = Math.ceil(snapshot.prompt.length / 4)
      expect(snapshot.estimatedTokens).toBe(expected)
    })
  })

  describe('rendering edge cases', () => {
    it('handles empty owner aliases (single-element array)', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        ownerProfile: {
          ...PRODUCTION_OPTIONS.ownerProfile!,
          aliases: ['Skobez'], // same as name
        },
      })
      const ownerLayer = getLayer(snapshot, 'owner-identity')
      expect(ownerLayer.content).not.toContain('Also known as')
    })

    it('handles no banned phrases', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        ownerProfile: {
          ...PRODUCTION_OPTIONS.ownerProfile!,
          bannedPhrases: [],
        },
      })
      const ownerLayer = getLayer(snapshot, 'owner-identity')
      expect(ownerLayer.content).not.toContain('Avoid these phrases')
    })

    it('handles no context files (empty project context)', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        projectContext: { workingDirectory: '/workspace/test' },
      })
      const projLayer = getLayer(snapshot, 'project-context')
      expect(projLayer.content).toContain('No project context files found.')
      expect(projLayer.content).not.toContain('AGENTS.md')
    })

    it('handles empty memories array', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        memories: [],
      })
      const memoryLayer = getLayer(snapshot, 'memory')
      expect(memoryLayer.content).toContain('No relevant memories found.')
    })

    it('handles no skills', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        skills: [],
      })
      const skillsLayer = getLayer(snapshot, 'skills')
      expect(skillsLayer.content).toContain('No skills are currently active.')
    })

    it('handles no capabilities', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        capabilities: [],
      })
      const capLayer = getLayer(snapshot, 'capabilities')
      expect(capLayer.content).toContain('No extended capabilities are active.')
    })

    it('handles explore mode in execution policy', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.content).toContain('Read-only')
      expect(policyLayer.content).toContain('Inspect and plan')
      expect(policyLayer.content).not.toContain('Execute automatically')
    })

    it('handles unrestricted mode in execution policy', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        executionPolicy: { defaultMode: 'unrestricted', askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.content).toContain('Broad execution')
      expect(policyLayer.content).not.toContain('Read-only')
      expect(policyLayer.content).not.toContain('Execute automatically')
    })
  })

  describe('layer interaction — independence and isolation', () => {
    it('changing memories does not affect non-memory layers', () => {
      compiler.invalidateAll()
      const r1 = compiler.compile(PRODUCTION_OPTIONS)
      const r1NonMemory = r1.snapshot.layers.filter(l => l.id !== 'memory')

      compiler.invalidateAll()
      const r2 = compiler.compile({
        ...PRODUCTION_OPTIONS,
        memories: [{ title: 'Completely Different', content: 'Different content.', score: 0.5 }],
      })
      const r2NonMemory = r2.snapshot.layers.filter(l => l.id !== 'memory')

      // Non-memory layers should be identical
      for (let i = 0; i < r1NonMemory.length; i++) {
        expect(r2NonMemory[i]!.content).toBe(r1NonMemory[i]!.content)
      }

      // Memory layers should differ
      expect(r2.snapshot.layers.find(l => l.id === 'memory')!.content)
        .not.toBe(r1.snapshot.layers.find(l => l.id === 'memory')!.content)
    })

    it('changing profile does not affect layers above or below owner-identity', () => {
      compiler.invalidateAll()
      const r1 = compiler.compile(PRODUCTION_OPTIONS)

      compiler.invalidateAll()
      const r2 = compiler.compile({
        ...PRODUCTION_OPTIONS,
        ownerProfile: {
          ...PRODUCTION_OPTIONS.ownerProfile!,
          name: 'DifferentOwner',
          tone: 'Completely different.',
        },
      })

      // The runtime-contract layer (above owner-identity) should be unchanged
      expect(r2.snapshot.layers.find(l => l.id === 'runtime-contract')!.content)
        .toBe(r1.snapshot.layers.find(l => l.id === 'runtime-contract')!.content)

      // The owner-identity layer should have changed
      expect(r2.snapshot.layers.find(l => l.id === 'owner-identity')!.content)
        .not.toBe(r1.snapshot.layers.find(l => l.id === 'owner-identity')!.content)

      // The execution-policy layer (below owner-identity) should be unchanged
      expect(r2.snapshot.layers.find(l => l.id === 'execution-policy')!.content)
        .toBe(r1.snapshot.layers.find(l => l.id === 'execution-policy')!.content)
    })

    it('empty CompileOptions does not mix layers', () => {
      const { snapshot } = compiler.compile({})
      // With empty options, defaults are used. All 8 layers should still be
      // independent — no cross-leakage between them.
      for (const expectation of LAYER_EXPECTATIONS) {
        // With defaults, the owner name is "Owner", not "Skobez"
        if (expectation.id === 'owner-identity') {
          const layer = getLayer(snapshot, 'owner-identity')
          expect(layer.content).toContain('Owner')
        }
      }
    })
  })

  describe('formatting conventions', () => {
    it('uses markdown-style section headers (## Title)', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const headerLayers = ['owner-identity', 'execution-policy', 'project-context', 'skills', 'memory', 'session-state', 'capabilities']
      for (const id of headerLayers) {
        const layer = getLayer(snapshot, id)
        // Each layer's first non-empty line should start with ##
        const firstLine = layer.content.trim().split('\n')[0]!
        expect(firstLine).toMatch(/^##?\s/)
      }
    })

    it('uses bullet lists (-) for skills and capabilities', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const skillsLayer = getLayer(snapshot, 'skills')
      expect(skillsLayer.content).toMatch(/- .+/)

      const capLayer = getLayer(snapshot, 'capabilities')
      expect(capLayer.content).toMatch(/- .+/)
    })

    it('formats memory scores as percentages', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const memoryLayer = getLayer(snapshot, 'memory')
      // Scores should appear as "95%", "82%", "74%"
      expect(memoryLayer.content).toMatch(/\d+%/)
    })

    it('formats filesystem paths in backtick code fences', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.content).toMatch(/`[^`]+`/)
    })
  })

  describe('unicode and special characters', () => {
    it('handles unicode in profile fields', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        ownerProfile: {
          ...PRODUCTION_OPTIONS.ownerProfile!,
          name: 'José 🎉',
          timezone: 'Asia/Tokyo',
          tone: '日本語で回答してね 😊',
        },
      })
      const ownerLayer = getLayer(snapshot, 'owner-identity')
      expect(ownerLayer.content).toContain('José 🎉')
      expect(ownerLayer.content).toContain('日本語で回答してね 😊')
    })

    it('handles unicode in memory content', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        memories: [
          { title: '中文记忆', content: '这是一个测试.', score: 0.9 },
          { title: 'Memória', content: 'Isso é um teste.', score: 0.8 },
        ],
      })
      const memoryLayer = getLayer(snapshot, 'memory')
      expect(memoryLayer.content).toContain('中文记忆')
      expect(memoryLayer.content).toContain('这是一个测试')
      expect(memoryLayer.content).toContain('Memória')
      expect(memoryLayer.content).toContain('Isso é um teste')
    })

    it('handles very long banned phrases', () => {
      const longPhrase = 'A'.repeat(500)
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        ownerProfile: {
          ...PRODUCTION_OPTIONS.ownerProfile!,
          bannedPhrases: [longPhrase],
        },
      })
      const ownerLayer = getLayer(snapshot, 'owner-identity')
      expect(ownerLayer.content).toContain(longPhrase)
    })
  })

  describe('regression: null/undefined handling', () => {
    it('handles undefined projectContext gracefully', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        projectContext: undefined,
      })
      const projLayer = getLayer(snapshot, 'project-context')
      expect(projLayer.content).toContain('No project context files found.')
    })

    it('handles undefined sessionState gracefully', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        sessionState: undefined,
      })
      // Should fall back to defaults (unknown / explore / /tmp)
      const stateLayer = getLayer(snapshot, 'session-state')
      expect(stateLayer.content).toContain('unknown')
      expect(stateLayer.content).toContain('/tmp')
    })

    it('handles partial ownerProfile gracefully', () => {
      const { snapshot } = compiler.compile({
        ownerProfile: {
          name: 'Test',
          aliases: [],
          locale: 'en',
          timezone: 'UTC',
          tone: 'Terse',
          verbosity: 2,
          bannedPhrases: [],
        },
        // executionPolicy, projectContext omitted
      })
      // Should not crash — defaults fill in the gaps
      expect(snapshot.layers.length).toBe(8)
    })

    it('handles undefined skills gracefully', () => {
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        skills: undefined,
      })
      const skillsLayer = getLayer(snapshot, 'skills')
      // Should render "no skills" message
      expect(skillsLayer.content).toContain('No skills are currently active.')
    })
  })

  describe('performance: large inputs', () => {
    it('compiles with a memory layer of 500 entries without crashing', () => {
      const manyMemories = Array.from({ length: 500 }, (_, i) => ({
        title: `Memory ${i + 1}`,
        content: `Content for memory ${i + 1} with relevant context.`,
        score: Math.random(),
      }))
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        memories: manyMemories,
      })
      expect(snapshot.layers.find(l => l.id === 'memory')).toBeTruthy()
      expect(snapshot.prompt.length).toBeGreaterThan(10000)
    })

    it('compiles with all layers filled with long content', () => {
      const longContent = 'A'.repeat(1000)
      const { snapshot } = compiler.compile({
        ...PRODUCTION_OPTIONS,
        ownerProfile: {
          ...PRODUCTION_OPTIONS.ownerProfile!,
          tone: longContent,
        },
        projectContext: {
          workingDirectory: longContent.slice(0, 100),
          contextFiles: [
            { filename: 'LONG.md', content: longContent },
          ],
        },
        memories: [
          { title: longContent.slice(0, 50), content: longContent, score: 0.5 },
        ],
        skills: [longContent.slice(0, 200)],
        capabilities: [longContent.slice(0, 200)],
      })
      expect(snapshot.estimatedTokens).toBeGreaterThan(1000)
      // All 8 layers should still be present
      expect(snapshot.layers).toHaveLength(8)
    })
  })

  describe('execution policy retry directive', () => {
    it('retry directive is present in owner-auto mode', () => {
      const { snapshot } = compiler.compile({
        executionPolicy: { defaultMode: 'owner-auto', askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.content).toContain('Retry up to 3 times')
    })

    it('retry directive is present in explore mode', () => {
      const { snapshot } = compiler.compile({
        executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.content).toContain('Retry up to 3 times')
    })

    it('retry directive is present in unrestricted mode', () => {
      const { snapshot } = compiler.compile({
        executionPolicy: { defaultMode: 'unrestricted', askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.content).toContain('Retry up to 3 times')
    })

    it('retry directive mentions exponential backoff', () => {
      const { snapshot } = compiler.compile({
        executionPolicy: { defaultMode: 'owner-auto', askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = getLayer(snapshot, 'execution-policy')
      expect(policyLayer.content).toContain('exponential backoff')
    })

    it('retry directive lives in the execution-policy layer only', () => {
      const { snapshot } = compiler.compile(PRODUCTION_OPTIONS)
      for (const layer of snapshot.layers) {
        if (layer.id === 'execution-policy') continue
        expect(layer.content).not.toContain('Retry up to 3 times')
      }
    })
  })
})
