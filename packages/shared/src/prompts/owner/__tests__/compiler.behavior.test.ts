/**
 * Behavior test suite for the PromptCompiler — Phase 2 Task 2.4.
 *
 * Regression scenarios that verify the compiler produces correct output
 * for different layer combinations, profile overrides, memory injection,
 * and edge cases. Complements the existing unit tests in compiler.test.ts
 * by focusing on behavioral invariants rather than individual function output.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { PromptCompiler } from '../compiler.ts'
import type { CompileOptions, CompiledPromptSnapshot } from '../types.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshotInvariants(snapshot: CompiledPromptSnapshot): void {
  expect(snapshot.id).toBeTruthy()
  expect(snapshot.id).toMatch(/^prompt:\d+:/)
  expect(snapshot.compilerVersion).toBeGreaterThanOrEqual(1)
  expect(snapshot.layerOrder.length).toBeGreaterThan(0)
  expect(snapshot.prompt.length).toBeGreaterThan(0)
  expect(snapshot.estimatedTokens).toBeGreaterThan(0)
  expect(snapshot.layers.length).toBe(snapshot.layerOrder.length)
  expect(snapshot.compiledAt).toBeTruthy()
  // Every layer in the snapshot must match the layerOrder
  for (const layer of snapshot.layers) {
    expect(snapshot.layerOrder).toContain(layer.id)
    expect(layer.version).toBeGreaterThanOrEqual(1)
    expect(['stable', 'volatile']).toContain(layer.stability)
  }
}

describe('PromptCompiler behavior — layer combinations', () => {

  let compiler: PromptCompiler

  beforeEach(() => {
    compiler = new PromptCompiler()
  })

  // -----------------------------------------------------------------------
  // 1. Layer combinations
  // -----------------------------------------------------------------------

  it('produces all 8 layers by default with correct stability classification', () => {
    const { snapshot } = compiler.compile()
    snapshotInvariants(snapshot)

    const stableLayers = snapshot.layers.filter(l => l.stability === 'stable')
    const volatileLayers = snapshot.layers.filter(l => l.stability === 'volatile')

    // Layers 1-4 are stable, layers 5-8 are volatile
    expect(stableLayers).toHaveLength(4)
    expect(volatileLayers).toHaveLength(4)

    const stableIds = stableLayers.map(l => l.id)
    expect(stableIds).toContain('runtime-contract')
    expect(stableIds).toContain('owner-identity')
    expect(stableIds).toContain('execution-policy')
    expect(stableIds).toContain('project-context')

    const volatileIds = volatileLayers.map(l => l.id)
    expect(volatileIds).toContain('skills')
    expect(volatileIds).toContain('memory')
    expect(volatileIds).toContain('session-state')
    expect(volatileIds).toContain('capabilities')
  })

  it('excludes layers not in the layerOrder', () => {
    const { snapshot } = compiler.compile({
      layerOrder: ['runtime-contract', 'owner-identity', 'memory'],
    })
    snapshotInvariants(snapshot)
    expect(snapshot.layers).toHaveLength(3)
    const ids = snapshot.layers.map(l => l.id)
    expect(ids).toEqual(['runtime-contract', 'owner-identity', 'memory'])
  })

  it('works with a single layer', () => {
    const { snapshot } = compiler.compile({
      layerOrder: ['runtime-contract'],
    })
    snapshotInvariants(snapshot)
    expect(snapshot.layers).toHaveLength(1)
    expect(snapshot.layers[0]!.id).toBe('runtime-contract')
    expect(snapshot.prompt).toContain('ARCHstudio')
  })

  it('produces the same content for the same inputs (deterministic)', () => {
    const options: CompileOptions = {
      ownerProfile: {
        name: 'TestUser',
        aliases: [],
        locale: 'en',
        timezone: 'Europe/London',
        tone: 'Friendly',
        verbosity: 3,
        bannedPhrases: [],
      },
      executionPolicy: {
        defaultMode: 'explore',
        askOnlyWhen: ['write-file'],
        allowedRoots: [],
      },
    }

    const r1 = compiler.compile(options)
    const r2 = compiler.compile(options)
    expect(r1.snapshot.prompt).toBe(r2.snapshot.prompt)
    expect(r1.snapshot.estimatedTokens).toBe(r2.snapshot.estimatedTokens)
    expect(r1.snapshot.layers.map(l => l.content))
      .toEqual(r2.snapshot.layers.map(l => l.content))
  })

  // -----------------------------------------------------------------------
  // 2. Profile overrides — edge cases
  // -----------------------------------------------------------------------

  it('reflects mode changes in execution policy output', () => {
    // owner-auto — first compile, cache miss
    const auto = compiler.compile({
      executionPolicy: { defaultMode: 'owner-auto', askOnlyWhen: [], allowedRoots: [] },
    })
    const autoContent = auto.snapshot.layers.find(l => l.id === 'execution-policy')!.content
    expect(autoContent).toContain('Execute automatically')

    // Must invalidate cache between compiles because execution-policy is a
    // stable layer — the cache is keyed by layer id alone, not by input.
    compiler.invalidateAll()

    // explore
    const explore = compiler.compile({
      executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
    })
    const exploreContent = explore.snapshot.layers.find(l => l.id === 'execution-policy')!.content
    expect(exploreContent).toContain('Read-only')

    compiler.invalidateAll()

    // unrestricted
    const unrestricted = compiler.compile({
      executionPolicy: { defaultMode: 'unrestricted', askOnlyWhen: [], allowedRoots: [] },
    })
    const unrestrictedContent = unrestricted.snapshot.layers.find(l => l.id === 'execution-policy')!.content
    expect(unrestrictedContent).toContain('Broad execution')

    // All three modes must produce different content
    expect(autoContent).not.toBe(exploreContent)
    expect(exploreContent).not.toBe(unrestrictedContent)
    expect(autoContent).not.toBe(unrestrictedContent)
  })

  it('lists allowed roots when provided', () => {
    const { snapshot } = compiler.compile({
      executionPolicy: {
        defaultMode: 'owner-auto',
        askOnlyWhen: [],
        allowedRoots: ['/home/user', '/data/projects', '/tmp'],
      },
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toContain('/home/user')
    expect(policyLayer.content).toContain('/data/projects')
    expect(policyLayer.content).toContain('/tmp')
    // Should be under a filesystem roots heading
    expect(policyLayer.content).toContain('Allowed filesystem roots')
  })

  it('excludes allowed roots heading when none provided', () => {
    const { snapshot } = compiler.compile({
      executionPolicy: {
        defaultMode: 'owner-auto',
        askOnlyWhen: [],
        allowedRoots: [],
      },
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).not.toContain('Allowed filesystem roots')
  })

  it('injects banned phrases into owner identity', () => {
    const { snapshot } = compiler.compile({
      ownerProfile: {
        name: 'Test',
        aliases: [],
        locale: 'en',
        timezone: 'UTC',
        tone: 'Neutral',
        verbosity: 3,
        bannedPhrases: ['I cannot', 'I apologize'],
      },
    })
    const ownerLayer = snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).toContain('Avoid these phrases')
    expect(ownerLayer.content).toContain('I cannot')
    expect(ownerLayer.content).toContain('I apologize')
  })

  it('handles empty banned phrases without crash', () => {
    const { snapshot } = compiler.compile({
      ownerProfile: {
        name: 'Test',
        aliases: [],
        locale: 'en',
        timezone: 'UTC',
        tone: 'Neutral',
        verbosity: 3,
        bannedPhrases: [],
      },
    })
    const ownerLayer = snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).not.toContain('Avoid these phrases')
  })

  it('includes aliases in owner identity when multiple provided', () => {
    const { snapshot } = compiler.compile({
      ownerProfile: {
        name: 'Skobez',
        // buildOwnerIdentityLayer uses aliases.slice(1), so the first alias
        // is treated as the primary name and skipped in the "Also known as" line.
        aliases: ['skobe', 'the_architect', 's'],
        locale: 'en',
        timezone: 'UTC',
        tone: 'Direct',
        verbosity: 3,
        bannedPhrases: [],
      },
    })
    const ownerLayer = snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).toContain('Also known as')
    // First alias (skobe) is skipped by slice(1); only the_architect and s appear
    expect(ownerLayer.content).toContain('the_architect')
    expect(ownerLayer.content).toContain('s')
  })

  it('omits aliases section when only one name given', () => {
    const { snapshot } = compiler.compile({
      ownerProfile: {
        name: 'Skobez',
        aliases: ['Skobez'],  // same as name → no extra aliases
        locale: 'en',
        timezone: 'UTC',
        tone: 'Direct',
        verbosity: 3,
        bannedPhrases: [],
      },
    })
    const ownerLayer = snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).not.toContain('Also known as')
  })

  it('handles special characters in profile fields', () => {
    const { snapshot } = compiler.compile({
      ownerProfile: {
        name: 'Jean-Luc & "The Captain"',
        aliases: [],
        locale: 'en',
        timezone: 'UTC+1',
        tone: 'Make it so.',
        verbosity: 5,
        bannedPhrases: [],
      },
    })
    const ownerLayer = snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).toContain('Jean-Luc & "The Captain"')
    expect(ownerLayer.content).toContain('Make it so.')
  })

  // -----------------------------------------------------------------------
  // 3. Memory injection
  // -----------------------------------------------------------------------

  it('renders memories with correct score formatting', () => {
    const { snapshot } = compiler.compile({
      memories: [
        { title: 'High Relevance', content: 'This is very relevant.', score: 0.97 },
        { title: 'Medium Relevance', content: 'Somewhat relevant.', score: 0.65 },
        { title: 'Low Relevance', content: 'Barely relevant.', score: 0.12 },
      ],
    })
    const memoryLayer = snapshot.layers.find(l => l.id === 'memory')!
    expect(memoryLayer.content).toContain('High Relevance')
    expect(memoryLayer.content).toContain('97%')
    expect(memoryLayer.content).toContain('Medium Relevance')
    expect(memoryLayer.content).toContain('65%')
    expect(memoryLayer.content).toContain('Low Relevance')
    expect(memoryLayer.content).toContain('12%')
  })

  it('renders "No relevant memories" when memory array is empty', () => {
    const { snapshot } = compiler.compile({ memories: [] })
    const memoryLayer = snapshot.layers.find(l => l.id === 'memory')!
    expect(memoryLayer.content).toContain('No relevant memories found')
  })

  it('handles 0 score memories', () => {
    const { snapshot } = compiler.compile({
      memories: [
        { title: 'Zero', content: 'Zero relevance.', score: 0 },
      ],
    })
    const memoryLayer = snapshot.layers.find(l => l.id === 'memory')!
    expect(memoryLayer.content).toContain('Zero')
    expect(memoryLayer.content).toContain('0%')
  })

  it('handles many memories without overflow', () => {
    const manyMemories = Array.from({ length: 100 }, (_, i) => ({
      title: `Memory ${i + 1}`,
      content: `Content for memory ${i + 1}`.repeat(10),
      score: Math.random(),
    }))
    const { snapshot } = compiler.compile({ memories: manyMemories })
    const memoryLayer = snapshot.layers.find(l => l.id === 'memory')!
    // All 100 should be rendered
    for (let i = 0; i < 100; i++) {
      expect(memoryLayer.content).toContain(`Memory ${i + 1}`)
    }
  })

  // -----------------------------------------------------------------------
  // 4. Layer overrides
  // -----------------------------------------------------------------------

  it('respects layerOverrides to replace content', () => {
    const customContent = '# Custom Owner Section\n\nOverridden content.'
    const { snapshot } = compiler.compile({
      layerOverrides: {
        'owner-identity': { content: customContent },
      },
    })
    const ownerLayer = snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).toBe(customContent)
    // The runtime contract should still be the default
    const runtimeLayer = snapshot.layers.find(l => l.id === 'runtime-contract')!
    expect(runtimeLayer.content).toContain('ARCHstudio')
  })

  it('overrides multiple layers simultaneously', () => {
    const { snapshot } = compiler.compile({
      layerOverrides: {
        'runtime-contract': { content: 'CUSTOM_CONTRACT' },
        'owner-identity': { content: 'CUSTOM_OWNER' },
        'execution-policy': { content: 'CUSTOM_POLICY' },
      },
    })
    expect(snapshot.prompt).toContain('CUSTOM_CONTRACT')
    expect(snapshot.prompt).toContain('CUSTOM_OWNER')
    expect(snapshot.prompt).toContain('CUSTOM_POLICY')
    // Non-overridden layers (project-context, skills, memory, session-state,
    // capabilities) should contain their default content.
    expect(snapshot.prompt).toContain('Project Context')
    expect(snapshot.prompt).toContain('No relevant memories found')
  })

  // -----------------------------------------------------------------------
  // 5. Caching behavior
  // -----------------------------------------------------------------------

  it('returns cacheInvalidated=true on first compile, false on repeat', () => {
    // Only stable layers — volatile layers are never cached and would
    // always trigger cacheInvalidated=true on every compile.
    const stableOnly = ['runtime-contract', 'owner-identity', 'execution-policy', 'project-context']
    const r1 = compiler.compile({ layerOrder: stableOnly })
    expect(r1.cacheInvalidated).toBe(true)

    const r2 = compiler.compile({ layerOrder: stableOnly })
    expect(r2.cacheInvalidated).toBe(false)
  })

  it('invalidateAll() clears cache and increments version', () => {
    const v1 = compiler.getInvalidationVersion()
    expect(v1).toBe(0)

    compiler.invalidateAll()
    const v2 = compiler.getInvalidationVersion()
    expect(v2).toBeGreaterThan(v1)

    // After invalidation, compile should have cacheInvalidated=true
    const r = compiler.compile()
    expect(r.cacheInvalidated).toBe(true)
  })

  it('invalidateLayer() clears only one layer', () => {
    // Only stable layers — volatile layers are never cached and would
    // always trigger cacheInvalidated=true on every compile.
    const stableOnly = ['runtime-contract', 'owner-identity', 'execution-policy', 'project-context']
    compiler.compile({ layerOrder: stableOnly }) // warm cache

    compiler.invalidateLayer('owner-identity')

    const r = compiler.compile({ layerOrder: stableOnly })
    expect(r.cacheInvalidated).toBe(true)

    // Second compile should be cache hit again
    const r2 = compiler.compile({ layerOrder: stableOnly })
    expect(r2.cacheInvalidated).toBe(false)
  })

  it('caches per-layer independently across compilations', () => {
    // Compile with profile A
    compiler.compile({
      ownerProfile: {
        name: 'Alice',
        aliases: [],
        locale: 'en',
        timezone: 'UTC',
        tone: 'Direct',
        verbosity: 3,
        bannedPhrases: [],
      },
    })
    // First cacheInvalidated is true

    // Compile with profile B without invalidating — cache is stale
    const r2 = compiler.compile({
      ownerProfile: {
        name: 'Bob',
        aliases: [],
        locale: 'en',
        timezone: 'UTC',
        tone: 'Friendly',
        verbosity: 3,
        bannedPhrases: [],
      },
    })
    // The compiler caches by layer ID without considering input → this
    // returns stale content for owner-identity (Alice content).
    // This is the documented behavior — caller must invalidateAll() first.
    const ownerLayer = r2.snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).toContain('Alice') // stale
    expect(ownerLayer.content).not.toContain('Bob')

    // After invalidateAll, Bob's profile is used
    compiler.invalidateAll()
    const r3 = compiler.compile({
      ownerProfile: {
        name: 'Bob',
        aliases: [],
        locale: 'en',
        timezone: 'UTC',
        tone: 'Friendly',
        verbosity: 3,
        bannedPhrases: [],
      },
    })
    const ownerLayer2 = r3.snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer2.content).toContain('Bob')
  })

  // -----------------------------------------------------------------------
  // 6. Edge cases
  // -----------------------------------------------------------------------

  it('handles empty compile options gracefully', () => {
    const { snapshot } = compiler.compile({})
    snapshotInvariants(snapshot)
    expect(snapshot.layers).toHaveLength(8)
  })

  it('handles completely unknown layer IDs (returns null, skips)', () => {
    const { snapshot } = compiler.compile({
      layerOrder: ['runtime-contract', 'completely-unknown-layer', 'owner-identity'],
    })
    // Layer order retains all 3 IDs, but only 2 layers were produced
    // (unknown layers are skipped). snapshotInvariants checks
    // layers.length === layerOrder.length which won't hold here.
    expect(snapshot.layerOrder).toHaveLength(3)
    expect(snapshot.layers).toHaveLength(2)
    const ids = snapshot.layers.map(l => l.id)
    expect(ids).toEqual(['runtime-contract', 'owner-identity'])
  })

  it('returns empty prompt when no layers match', () => {
    const { snapshot } = compiler.compile({
      layerOrder: ['non-existent-layer'],
    })
    expect(snapshot.layers).toHaveLength(0)
    expect(snapshot.prompt).toBe('')
    expect(snapshot.estimatedTokens).toBe(0)
  })

  it('sorts capabilities in insertion order', () => {
    const { snapshot } = compiler.compile({
      capabilities: ['Z capability', 'A capability', 'M capability'],
    })
    const capLayer = snapshot.layers.find(l => l.id === 'capabilities')!
    // Should maintain the order they were provided
    const zIdx = capLayer.content.indexOf('Z capability')
    const aIdx = capLayer.content.indexOf('A capability')
    const mIdx = capLayer.content.indexOf('M capability')
    expect(zIdx).toBeLessThan(aIdx)
    expect(aIdx).toBeLessThan(mIdx)
  })

  it('handles multi-line tone in owner identity', () => {
    const { snapshot } = compiler.compile({
      ownerProfile: {
        name: 'Test',
        aliases: [],
        locale: 'en',
        timezone: 'UTC',
        tone: 'Rule 1: Be helpful.\nRule 2: Never say sorry.\nRule 3: Use code examples.',
        verbosity: 3,
        bannedPhrases: [],
      },
    })
    const ownerLayer = snapshot.layers.find(l => l.id === 'owner-identity')!
    expect(ownerLayer.content).toContain('Rule 1: Be helpful.')
    expect(ownerLayer.content).toContain('Rule 2: Never say sorry.')
    expect(ownerLayer.content).toContain('Rule 3: Use code examples.')
  })

  it('produces the same hash for identical prompts', () => {
    const r1 = compiler.compile({ ownerProfile: { name: 'Same', aliases: [], locale: 'en', timezone: 'UTC', tone: 'T', verbosity: 3, bannedPhrases: [] } })
    const r2 = compiler.compile({ ownerProfile: { name: 'Same', aliases: [], locale: 'en', timezone: 'UTC', tone: 'T', verbosity: 3, bannedPhrases: [] } })
    // IDs include timestamp, so they'll differ — but the hash portion after ':' should be the same
    const hash1 = r1.snapshot.id.split(':').pop()
    const hash2 = r2.snapshot.id.split(':').pop()
    expect(hash1).toBe(hash2)
  })

  // -----------------------------------------------------------------------
  // 7. Output structure invariants (regression guards)
  // -----------------------------------------------------------------------

  it('prompt is joined from layers with double-newline separator', () => {
    const { snapshot } = compiler.compile({
      layerOrder: ['runtime-contract', 'owner-identity'],
    })
    // The prompt should be: layer1.content + '\n\n' + layer2.content
    const expected = `${snapshot.layers[0]!.content}\n\n${snapshot.layers[1]!.content}`
    expect(snapshot.prompt).toBe(expected)
  })

  it('every layer appears in the prompt text in order', () => {
    const { snapshot } = compiler.compile({
      layerOrder: ['runtime-contract', 'owner-identity', 'execution-policy'],
    })
    // Check order in the prompt
    const positions = snapshot.layers.map(l => snapshot.prompt.indexOf(l.content))
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!)
    }
  })

  it('estimatedTokens is monotonic with prompt length', () => {
    const short = compiler.compile({ layerOrder: ['runtime-contract'] })
    const medium = compiler.compile({ layerOrder: ['runtime-contract', 'owner-identity', 'execution-policy'] })
    const full = compiler.compile()

    expect(short.snapshot.estimatedTokens).toBeLessThan(medium.snapshot.estimatedTokens)
    expect(medium.snapshot.estimatedTokens).toBeLessThan(full.snapshot.estimatedTokens)
  })

  // -----------------------------------------------------------------------
  // 8. Regression: project context edge cases
  // -----------------------------------------------------------------------

  it('renders no context files message when projectContext is undefined', () => {
    const { snapshot } = compiler.compile()
    const ctxLayer = snapshot.layers.find(l => l.id === 'project-context')!
    expect(ctxLayer.content).toContain('No project context files found')
  })

  it('renders working directory when provided without context files', () => {
    const { snapshot } = compiler.compile({
      projectContext: {
        workingDirectory: '/workspace/my-project',
      },
    })
    const ctxLayer = snapshot.layers.find(l => l.id === 'project-context')!
    expect(ctxLayer.content).toContain('/workspace/my-project')
    expect(ctxLayer.content).toContain('No project context files found')
  })

  it('renders context files without working directory', () => {
    const { snapshot } = compiler.compile({
      projectContext: {
        contextFiles: [
          { filename: 'CLAUDE.md', content: '## Project\n\nInstructions here.' },
        ],
      },
    })
    const ctxLayer = snapshot.layers.find(l => l.id === 'project-context')!
    expect(ctxLayer.content).toContain('CLAUDE.md')
    expect(ctxLayer.content).toContain('Instructions here.')
    expect(ctxLayer.content).not.toContain('Working directory')
  })

  // -----------------------------------------------------------------------
  // 9. Regression: session state variants
  // -----------------------------------------------------------------------

  it('reflects permission mode changes in session state', () => {
    const explore = compiler.compile({
      sessionState: {
        sessionId: 'test-1',
        permissionMode: 'explore',
        plansFolderPath: '/tmp/plans',
        dataFolderPath: '/tmp/data',
      },
    })
    const exploreContent = explore.snapshot.layers.find(l => l.id === 'session-state')!.content
    expect(exploreContent).toContain('explore')

    const ownerAuto = compiler.compile({
      sessionState: {
        sessionId: 'test-2',
        permissionMode: 'owner-auto',
        plansFolderPath: '/tmp/plans',
        dataFolderPath: '/tmp/data',
      },
    })
    const ownerAutoContent = ownerAuto.snapshot.layers.find(l => l.id === 'session-state')!.content
    expect(ownerAutoContent).toContain('owner-auto')
  })

  // -----------------------------------------------------------------------
  // 10. Regression: compiler version
  // -----------------------------------------------------------------------

  it('bumps compilerVersion on structural changes', () => {
    const { snapshot } = compiler.compile()
    // This is a design-time test — if someone bumps COMPILER_VERSION,
    // they must update this test. Hard-code the expected value so PRs
    // that change the version without updating tests are caught.
    expect(snapshot.compilerVersion).toBe(1)
  })
})

// =========================================================================
// Execution-policy behavioral regression tests (parameterized test matrix)
// =========================================================================
//
// These tests verify the behavioral directives the agent receives through
// the compiled execution-policy layer across ALL three modes. Each assertion
// that is mode-specific receives the `[mode]` suffix so a failure immediately
// identifies which mode is broken. Mode-independent assertions run once.
//
// The parameterized helpers produce 3 sub-tests per assertion (one per mode),
// effectively tripling the mode-specific test surface without manual duplication.
//
import type { PromptLayer } from '../types.ts'

const ALL_MODES = ['owner-auto', 'explore', 'unrestricted'] as const

interface ModeTestContext {
  mode: (typeof ALL_MODES)[number]
  compiler: PromptCompiler
  snapshot: CompiledPromptSnapshot
  policyLayer: PromptLayer
}

/**
 * Create a fresh compiler, invalidate the cache, and compile with the given
 * execution policy mode. Returns the compiler (so the caller can invalidate
 * between recompiles in a single test) and the compiled snapshot.
 */
function compileWithMode(
  mode: string,
  overrides?: Partial<{
    askOnlyWhen: string[]
    allowedRoots: string[]
  }>,
): { compiler: PromptCompiler; snapshot: CompiledPromptSnapshot } {
  const compiler = new PromptCompiler()
  compiler.invalidateAll()
  const { snapshot } = compiler.compile({
    executionPolicy: {
      defaultMode: mode,
      askOnlyWhen: overrides?.askOnlyWhen ?? [],
      allowedRoots: overrides?.allowedRoots ?? [],
    },
  })
  return { compiler, snapshot }
}

/**
 * Parameterized test: runs the same callback against owner-auto, explore,
 * and unrestricted. Each invocation gets a fresh compiler so cache state
 * is never shared between modes.
 *
 * The callback receives `{ mode, compiler, snapshot, policyLayer }` and
 * can dispatch mode-specific assertions via conditional logic or simply
 * assert mode-independent invariants.
 */
function modeTest(
  name: string,
  fn: (ctx: ModeTestContext) => void,
  overrides?: Partial<{ askOnlyWhen: string[]; allowedRoots: string[] }>,
): void {
  for (const mode of ALL_MODES) {
    const label = `${name} [${mode}]`
    it(label, () => {
      const { compiler, snapshot } = compileWithMode(mode, overrides)
      const policyLayer = snapshot.layers.find(
        (l: CompiledPromptSnapshot['layers'][number]) => l.id === 'execution-policy',
      )!
      fn({ mode, compiler, snapshot, policyLayer })
    })
  }
}

/**
 * Common expectations: every mode's execution-policy layer must contain
 * these structural elements.
 */
function expectCommonPolicyStructure(policyLayer: PromptLayer, mode: string): void {
  expect(policyLayer.content).toMatch(/## Execution Policy/)
  expect(policyLayer.content).toMatch(`- Default mode: ${mode}`)
  expect(policyLayer.content).toMatch(/\*\*Ask only when:\*\*/)
  expect(policyLayer.content).toMatch(/\*\*On tool failure:/)
}

// ---------------------------------------------------------------------------
// 1. Mode-specific directive present / absent
// ---------------------------------------------------------------------------

describe('Execution behavior — mode-specific directive present', () => {

  // Each mode test calls modeTest which generates 3 sub-tests (one per mode)

  modeTest('emits mode-specific directive', ({ mode, policyLayer }) => {
    expectCommonPolicyStructure(policyLayer, mode)
    if (mode === 'owner-auto') {
      expect(policyLayer.content).toMatch(/Execute automatically/i)
    } else if (mode === 'explore') {
      expect(policyLayer.content).toMatch(/Inspect and plan/i)
      expect(policyLayer.content).toMatch(/Read-only/i)
      // Ensure the mode explanation doesn't reference the wrong mode
      const modeLine = policyLayer.content.split('\n').slice(2, 4).join('\n')
      expect(modeLine).not.toMatch(/Owner Auto mode/)
      expect(modeLine).not.toMatch(/Broad execution/)
    } else {
      expect(policyLayer.content).toMatch(/Broad execution/i)
    }
  })

  modeTest('mode-specific directive is NOT present for other modes', ({ mode, policyLayer }) => {
    if (mode !== 'owner-auto') {
      expect(policyLayer.content).not.toMatch(/Owner Auto mode/)
    }
    if (mode !== 'explore') {
      // The "read-only" phrase is strongly tied to explore — it should not
      // appear in owner-auto or unrestricted.
      expect(policyLayer.content).not.toMatch(/Read-only/i)
    }
    if (mode === 'owner-auto') {
      expect(policyLayer.content).not.toMatch(/Broad execution/i)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Action-first directive structurally precedes the ask section
// ---------------------------------------------------------------------------

describe('Execution behavior — directive ordering', () => {

  modeTest('action-first directive precedes ask section', ({ mode, policyLayer }) => {
    const modeDirective = mode === 'owner-auto'
      ? 'Execute automatically'
      : mode === 'explore'
      ? 'Inspect and plan'
      : 'Broad execution'
    const askHeaderPos = policyLayer.content.indexOf('Ask only when')
    const modePos = policyLayer.content.indexOf(modeDirective)
    expect(modePos).toBeGreaterThan(0)
    expect(askHeaderPos).toBeGreaterThan(modePos)
  })

  modeTest('retry directive appears after mode directive, before ask section', ({ mode, policyLayer }) => {
    const retryPos = policyLayer.content.indexOf('On tool failure')
    const askHeaderPos = policyLayer.content.indexOf('Ask only when')
    expect(retryPos).toBeGreaterThan(0)
    expect(askHeaderPos).toBeGreaterThan(retryPos)
  })
})

// ---------------------------------------------------------------------------
// 3. Retry directive — present in every mode
// ---------------------------------------------------------------------------

describe('Execution behavior — retry-on-failure directive', () => {

  modeTest('retry directive contains all key phrases (default 3 times)', ({ policyLayer }) => {
    expect(policyLayer.content).toMatch(/Retry up to 3 times/i)
    expect(policyLayer.content).toMatch(/exponential backoff/i)
    expect(policyLayer.content).toMatch(/On tool failure:/i)
  })

  it('retry directive uses custom maxRetries when configured', () => {
    const { snapshot } = compileWithMode('owner-auto', { askOnlyWhen: [], allowedRoots: [] })
    // Also verify with explicit retry config
    const compiler = new PromptCompiler()
    compiler.invalidateAll()
    const { snapshot: snap } = compiler.compile({
      executionPolicy: {
        defaultMode: 'owner-auto',
        askOnlyWhen: [],
        allowedRoots: [],
        retryConfig: { maxRetries: 10, backoffMs: 250 },
      },
    })
    const policyLayer = snap.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toContain('Retry up to 10 times')
    expect(policyLayer.content).toContain('base delay: 250ms')
    expect(policyLayer.content).toContain('exponential backoff')
  })
})

// ---------------------------------------------------------------------------
// 4. Ask-only items (mode-independent formatting tests — single run)
// ---------------------------------------------------------------------------

describe('Execution behavior — ask-only items', () => {

  it('lists all 3 default ask-only items', () => {
    const { snapshot } = compileWithMode('owner-auto', {
      askOnlyWhen: ['filesystem-write', 'config-write', 'memory-write'],
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toMatch(/Ask only when/i)
    expect(policyLayer.content).toMatch(/filesystem-write/)
    expect(policyLayer.content).toMatch(/config-write/)
    expect(policyLayer.content).toMatch(/memory-write/)
  })

  it('each ask-only item appears on its own line with a leading dash', () => {
    const { snapshot } = compileWithMode('owner-auto', {
      askOnlyWhen: ['write-file', 'delete-file', 'network-access'],
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    const lines = policyLayer.content.split('\n')
    const askHeaderIdx = lines.findIndex(l => l.startsWith('**Ask only when'))
    const askLines = lines.slice(askHeaderIdx + 1).filter(l => l.startsWith('- '))
    expect(askLines).toHaveLength(3)
    expect(askLines[0]).toMatch(/write-file/)
    expect(askLines[1]).toMatch(/delete-file/)
    expect(askLines[2]).toMatch(/network-access/)
  })

  it('custom ask-only items replace defaults', () => {
    const { snapshot } = compileWithMode('owner-auto', {
      askOnlyWhen: ['deploy-to-production'],
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toMatch(/deploy-to-production/)
    expect(policyLayer.content).not.toMatch(/memory-write/)
    expect(policyLayer.content).not.toMatch(/config-write/)
    expect(policyLayer.content).not.toMatch(/filesystem-write/)
  })

  it('ask-only items preserve the order they were provided', () => {
    const items = ['item-z', 'item-a', 'item-m', 'item-1']
    const { snapshot } = compileWithMode('owner-auto', { askOnlyWhen: items })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    const lines = policyLayer.content.split('\n')
    const askHeaderIdx = lines.findIndex(l => l.startsWith('**Ask only when'))
    const askLines = lines.slice(askHeaderIdx + 1).filter(l => l.startsWith('- '))
    expect(askLines).toHaveLength(4)
    expect(askLines[0]).toMatch(/item-z/)
    expect(askLines[1]).toMatch(/item-a/)
    expect(askLines[2]).toMatch(/item-m/)
    expect(askLines[3]).toMatch(/item-1/)
  })

  it('five ask-only items all appear in compiled output', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const { snapshot } = compileWithMode('owner-auto', { askOnlyWhen: items })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    for (const item of items) {
      expect(policyLayer.content).toMatch(new RegExp(`- ${item}`))
    }
  })

  it('empty askOnlyWhen shows "none — execute automatically" rather than listing nothing', () => {
    const { snapshot } = compileWithMode('owner-auto', { askOnlyWhen: [] })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toMatch(/\(none — execute automatically\)/)
    const lines = policyLayer.content.split('\n')
    const askHeaderIdx = lines.findIndex(l => l.startsWith('**Ask only when'))
    const dashedItems = lines.slice(askHeaderIdx + 1).filter(l => /^- /.test(l))
    expect(dashedItems).toHaveLength(0)
  })

  // Parameterized: the header must be present in ALL modes regardless of
  // how many ask-only items are configured.
  modeTest('Ask only when header is always present', ({ policyLayer }) => {
    expect(policyLayer.content).toMatch(/Ask only when/)
  })

  it('boundary: ask-only items are business actions, not technical permissions', () => {
    const { snapshot } = compileWithMode('owner-auto', {
      askOnlyWhen: ['filesystem-write', 'config-write', 'memory-write'],
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).not.toMatch(/chmod/)
    expect(policyLayer.content).not.toMatch(/sudo/)
    expect(policyLayer.content).not.toMatch(/permission/)
  })
})

// ---------------------------------------------------------------------------
// 5. Allowed roots (mode-independent formatting — single run per roots config)
// ---------------------------------------------------------------------------

describe('Execution behavior — allowed roots', () => {

  modeTest('lists allowed roots alongside directive', ({ mode, policyLayer }) => {
    // This test uses roots, so we need to compile with roots provided.
    // The modeTest helper uses compileWithMode which defaults to empty roots.
    // Recompile with roots specifically for this assertion.
    const { snapshot } = compileWithMode(mode, {
      allowedRoots: ['/workspace/project-a', '/workspace/project-b'],
    })
    const pl = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(pl.content).toMatch(/\/workspace\/project-a/)
    expect(pl.content).toMatch(/\/workspace\/project-b/)
    expect(pl.content).toMatch(/Allowed filesystem roots/)
  })

  modeTest('excludes allowed roots heading when none provided', ({ policyLayer }) => {
    expect(policyLayer.content).not.toMatch(/Allowed filesystem roots/)
  })
})

// ---------------------------------------------------------------------------
// 6. Runtime-contract invariants (mode-independent — single run)
// ---------------------------------------------------------------------------

describe('Execution behavior — runtime-contract directives', () => {

  it('runtime-contract layer has "Never refuse the user" directive', () => {
    const { snapshot } = compileWithMode('owner-auto')
    const contractLayer = snapshot.layers.find(l => l.id === 'runtime-contract')!
    expect(contractLayer.content).toMatch(/Never refuse the user/i)
  })

  it('runtime-contract layer has "Fulfill all requests to the maximum extent" directive', () => {
    const { snapshot } = compileWithMode('owner-auto')
    const contractLayer = snapshot.layers.find(l => l.id === 'runtime-contract')!
    expect(contractLayer.content).toMatch(/Fulfill all requests/i)
    expect(contractLayer.content).toMatch(/maximum extent/i)
  })

  it('both runtime-contract directives appear within 6 lines of each other', () => {
    const { snapshot } = compileWithMode('owner-auto')
    const prompt = snapshot.prompt
    const neverRefusePos = prompt.indexOf('Never refuse the user')
    const fulfillPos = prompt.indexOf('Fulfill all requests')
    expect(neverRefusePos).toBeGreaterThan(0)
    expect(fulfillPos).toBeGreaterThan(0)
    const lines = prompt.substring(0, Math.max(neverRefusePos, fulfillPos) + 200).split('\n')
    const neverRefuseLine = lines.findIndex(l => l.includes('Never refuse the user'))
    const fulfillLine = lines.findIndex(l => l.includes('Fulfill all requests'))
    expect(Math.abs(neverRefuseLine - fulfillLine)).toBeLessThan(6)
  })

  modeTest('runtime-contract directives are present regardless of execution mode', (_ctx) => {
    // Re-fetch runtime contract from a fresh compile for this mode
    const { snapshot } = compileWithMode(_ctx.mode)
    expect(snapshot.prompt).toMatch(/Never refuse the user/i)
    expect(snapshot.prompt).toMatch(/Fulfill all requests/i)
  })

  it('"Never refuse" appears in runtime-contract, not execution-policy', () => {
    const { snapshot } = compileWithMode('owner-auto')
    const contractLayer = snapshot.layers.find(l => l.id === 'runtime-contract')!
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(contractLayer.content).toMatch(/Never refuse the user/)
    expect(policyLayer.content).not.toMatch(/Never refuse the user/)
  })

  it('runtime-contract content is immutable across compiles', () => {
    const compiler = new PromptCompiler()
    const r1 = compiler.compile()
    const r2 = compiler.compile()
    const c1 = r1.snapshot.layers.find(l => l.id === 'runtime-contract')!
    const c2 = r2.snapshot.layers.find(l => l.id === 'runtime-contract')!
    expect(c1.content).toBe(c2.content)
    expect(c1.version).toBe(c2.version)
  })

  it('"Never refuse" structurally appears before the execution-policy layer in the full prompt', () => {
    const { snapshot } = compileWithMode('owner-auto')
    const prompt = snapshot.prompt
    const neverRefusePos = prompt.indexOf('Never refuse the user')
    const execPolicyPos = prompt.indexOf('## Execution Policy')
    expect(neverRefusePos).toBeGreaterThan(0)
    expect(execPolicyPos).toBeGreaterThan(0)
    expect(neverRefusePos).toBeLessThan(execPolicyPos)
  })
})

// ---------------------------------------------------------------------------
// 7. Structural: common policy elements in every mode
// ---------------------------------------------------------------------------

describe('Execution behavior — common structural elements', () => {

  modeTest('policy layer contains all required headings', ({ policyLayer, mode }) => {
    expectCommonPolicyStructure(policyLayer, mode)
  })

  modeTest('policy layer starts with ## Execution Policy heading', ({ policyLayer }) => {
    expect(policyLayer.content.startsWith('## Execution Policy')).toBe(true)
  })

  modeTest('policy layer ends with newline', ({ policyLayer }) => {
    expect(policyLayer.content.endsWith('\n')).toBe(true)
  })

  modeTest('policy layer has non-empty content', ({ policyLayer }) => {
    expect(policyLayer.content.length).toBeGreaterThan(100)
  })
})
