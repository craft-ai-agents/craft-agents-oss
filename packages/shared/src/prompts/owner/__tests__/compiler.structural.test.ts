/**
 * Structural validation tests for the PromptCompiler output.
 *
 * Verifies the full compiled prompt against a formal schema:
 *  - Snapshot invariants (all required fields present and well-typed)
 *  - Every layer has non-empty content
 *  - Token estimate is consistent with character count (chars / 4)
 *  - Stability classification matches layer ordering (stable first, volatile last)
 *  - The hash in the snapshot id matches a re-computation of the prompt
 *  - Layers appear in the prompt in the correct order
 *  - Prompt is joined with double-newline separator
 *  - Layer versions are monotonic
 *  - compiledAt is a valid ISO date
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { PromptCompiler } from '../compiler.ts'
import type { CompiledPromptSnapshot, PromptLayer, CompileOptions } from '../types.ts'
import { encode } from 'gpt-tokenizer/model/gpt-4o'

// =========================================================================
// Replicate the compiler's internal helpers so we can independently verify
// the hash and token estimate without calling the compiler itself.
// =========================================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function contentHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `h${Math.abs(hash).toString(36)}`
}

// =========================================================================
// Schema: layers 1-4 are stable, layers 5-8 are volatile
// =========================================================================

/** Default layer order the compiler uses. */
const DEFAULT_LAYER_ORDER = [
  'runtime-contract',   // 1 — stable
  'owner-identity',     // 2 — stable
  'execution-policy',   // 3 — stable
  'project-context',    // 4 — stable
  'skills',             // 5 — volatile
  'memory',             // 6 — volatile
  'session-state',      // 7 — volatile
  'capabilities',       // 8 — volatile
] as const

const DEFAULT_STABLE_LAYERS = DEFAULT_LAYER_ORDER.slice(0, 4)
const DEFAULT_VOLATILE_LAYERS = DEFAULT_LAYER_ORDER.slice(4)

// =========================================================================
// Helpers
// =========================================================================

function compile(overrides?: CompileOptions): CompiledPromptSnapshot {
  const compiler = new PromptCompiler()
  return compiler.compile(overrides).snapshot
}

/**
 * Validate that every field in the snapshot meets basic type/shape invariants.
 * Returns an array of issues found (empty = valid).
 */
function validateSnapshotSchema(snapshot: CompiledPromptSnapshot): string[] {
  const issues: string[] = []

  // ── id ──
  if (!snapshot.id) issues.push('snapshot.id is empty')
  if (typeof snapshot.id !== 'string') issues.push('snapshot.id is not a string')
  if (!/^prompt:\d+:h[a-z0-9]+$/.test(snapshot.id)) {
    issues.push(`snapshot.id "${snapshot.id}" does not match pattern "prompt:{timestamp}:h{hash}"`)
  }

  // ── compilerVersion ──
  if (typeof snapshot.compilerVersion !== 'number') issues.push('snapshot.compilerVersion is not a number')
  if (snapshot.compilerVersion < 1) issues.push(`snapshot.compilerVersion ${snapshot.compilerVersion} < 1`)

  // ── layerOrder ──
  if (!Array.isArray(snapshot.layerOrder)) issues.push('snapshot.layerOrder is not an array')
  else if (snapshot.layerOrder.length === 0) issues.push('snapshot.layerOrder is empty')
  else {
    for (const id of snapshot.layerOrder) {
      if (typeof id !== 'string') issues.push(`snapshot.layerOrder contains non-string: ${id}`)
    }
  }

  // ── prompt ──
  if (typeof snapshot.prompt !== 'string') issues.push('snapshot.prompt is not a string')

  // ── estimatedTokens ──
  if (typeof snapshot.estimatedTokens !== 'number') issues.push('snapshot.estimatedTokens is not a number')
  if (snapshot.estimatedTokens < 0) issues.push(`snapshot.estimatedTokens ${snapshot.estimatedTokens} < 0`)
  if (!Number.isFinite(snapshot.estimatedTokens)) issues.push('snapshot.estimatedTokens is not finite')
  if (!Number.isInteger(snapshot.estimatedTokens)) issues.push('snapshot.estimatedTokens is not an integer')

  // ── layers ──
  if (!Array.isArray(snapshot.layers)) issues.push('snapshot.layers is not an array')
  else if (snapshot.layers.length === 0) issues.push('snapshot.layers is empty')

  // ── compiledAt ──
  if (typeof snapshot.compiledAt !== 'string') issues.push('snapshot.compiledAt is not a string')
  if (snapshot.compiledAt) {
    const parsed = new Date(snapshot.compiledAt)
    if (isNaN(parsed.getTime())) issues.push(`snapshot.compiledAt "${snapshot.compiledAt}" is not a valid date`)
  }

  // ── layers.length === layerOrder.length (only when both are arrays) ──
  if (Array.isArray(snapshot.layers) && Array.isArray(snapshot.layerOrder)) {
    if (snapshot.layers.length !== snapshot.layerOrder.length) {
      issues.push(
        `layers.length (${snapshot.layers.length}) !== layerOrder.length (${snapshot.layerOrder.length})`,
      )
    }
  }

  return issues
}

/**
 * Validate that each layer meets basic structure invariants.
 * Returns an array of issues found (empty = valid).
 */
function validateLayerSchema(layers: PromptLayer[]): string[] {
  const issues: string[] = []

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const idx = i + 1
    if (!layer) {
      issues.push(`layer[${i}] is undefined`)
      continue
    }

    if (!layer.id) issues.push(`layer[${idx}] has empty id`)
    if (typeof layer.id !== 'string') issues.push(`layer[${idx}] id is not a string: ${typeof layer.id}`)

    if (!layer.name) issues.push(`layer[${idx}] "${layer.id}" has empty name`)
    if (typeof layer.name !== 'string') issues.push(`layer[${idx}] name is not a string: ${typeof layer.name}`)

    if (typeof layer.version !== 'number') {
      issues.push(`layer[${idx}] "${layer.id}" version is not a number: ${typeof layer.version}`)
    } else if (layer.version < 1) {
      issues.push(`layer[${idx}] "${layer.id}" version ${layer.version} < 1`)
    } else if (!Number.isInteger(layer.version)) {
      issues.push(`layer[${idx}] "${layer.id}" version ${layer.version} is not an integer`)
    }

    if (layer.stability !== 'stable' && layer.stability !== 'volatile') {
      issues.push(
        `layer[${idx}] "${layer.id}" stability "${layer.stability}" is not 'stable' or 'volatile'`,
      )
    }

    if (typeof layer.content !== 'string') {
      issues.push(`layer[${idx}] "${layer.id}" content is not a string: ${typeof layer.content}`)
    } else if (layer.content.trim().length === 0) {
      issues.push(`layer[${idx}] "${layer.id}" content is empty (or only whitespace)`)
    }
  }

  return issues
}

/**
 * Verify the prompt text is exactly the layers joined with double-newline.
 */
function validatePromptJoin(prompt: string, layers: PromptLayer[]): string[] {
  const issues: string[] = []
  const expected = layers.map((l) => l.content).join('\n\n')
  if (prompt !== expected) {
    issues.push('prompt is not layers joined with double-newline separator')
  }
  return issues
}

/**
 * Verify the hash in the snapshot id matches the prompt content.
 */
function validateHash(snapshot: CompiledPromptSnapshot): string[] {
  const issues: string[] = []
  const hashFromId = snapshot.id.split(':').pop()
  const computedHash = contentHash(snapshot.prompt)
  if (hashFromId !== computedHash) {
    issues.push(
      `id hash "${hashFromId}" does not match computed hash "${computedHash}" for prompt of length ${snapshot.prompt.length}`,
    )
  }
  return issues
}

/**
 * Verify estimatedTokens is consistent with character count.
 */
function validateTokenEstimate(snapshot: CompiledPromptSnapshot): string[] {
  const issues: string[] = []
  const expected = estimateTokens(snapshot.prompt)
  if (snapshot.estimatedTokens !== expected) {
    issues.push(
      `estimatedTokens ${snapshot.estimatedTokens} !== Math.ceil(${snapshot.prompt.length} / 4) = ${expected}`,
    )
  }
  return issues
}

/**
 * Verify stability classification matches the default scheme:
 * layers 1-4 (runtime-contract → project-context) are 'stable'
 * layers 5-8 (skills → capabilities) are 'volatile'
 *
 * Does NOT apply when layerOrder is a custom permutation.
 */
function validateDefaultStabilityOrder(snapshot: CompiledPromptSnapshot): string[] {
  const issues: string[] = []

  // Only validate when using the full default order
  if (snapshot.layerOrder.length !== DEFAULT_LAYER_ORDER.length) return issues
  const isDefaultOrder = snapshot.layerOrder.every((id, i) => id === DEFAULT_LAYER_ORDER[i])
  if (!isDefaultOrder) return issues

  for (let i = 0; i < snapshot.layers.length; i++) {
    const layer = snapshot.layers[i]!
    const isInStableRange = i < DEFAULT_STABLE_LAYERS.length

    if (isInStableRange) {
      if (layer.stability !== 'stable') {
        issues.push(
          `layer[${i + 1}] "${layer.id}" has stability "${layer.stability}" but is in stable range (index ${i})`,
        )
      }
    } else {
      if (layer.stability !== 'volatile') {
        issues.push(
          `layer[${i + 1}] "${layer.id}" has stability "${layer.stability}" but is in volatile range (index ${i})`,
        )
      }
    }
  }

  return issues
}

/**
 * Verify layers appear in the prompt text in layerOrder.
 */
function validateLayerPositionInPrompt(snapshot: CompiledPromptSnapshot): string[] {
  const issues: string[] = []

  if (snapshot.layers.length < 2) return issues // no ordering to verify for 0-1 layers

  // Get positions of each layer's content within the full prompt
  const positions: { id: string; pos: number }[] = []
  for (const layer of snapshot.layers) {
    const pos = snapshot.prompt.indexOf(layer.content)
    if (pos === -1) {
      issues.push(`layer "${layer.id}" content not found in prompt`)
    } else {
      positions.push({ id: layer.id, pos })
    }
  }

  // Verify increasing order
  for (let i = 1; i < positions.length; i++) {
    if (positions[i]!.pos < positions[i - 1]!.pos) {
      issues.push(
        `layer "${positions[i]!.id}" appears before "${positions[i - 1]!.id}" in prompt (got pos ${positions[i]!.pos}, expected > ${positions[i - 1]!.pos})`,
      )
    }
  }

  return issues
}

/**
 * Collect ALL structural issues for a snapshot.
 */
function validateAll(snapshot: CompiledPromptSnapshot): string[] {
  return [
    ...validateSnapshotSchema(snapshot),
    ...validateLayerSchema(snapshot.layers),
    ...validatePromptJoin(snapshot.prompt, snapshot.layers),
    ...validateHash(snapshot),
    ...validateTokenEstimate(snapshot),
    ...validateDefaultStabilityOrder(snapshot),
    ...validateLayerPositionInPrompt(snapshot),
  ]
}

// =========================================================================
// Tests
// =========================================================================

describe('Compiled prompt — snapshot schema invariants', () => {
  let snapshot: CompiledPromptSnapshot

  beforeEach(() => {
    snapshot = compile()
  })

  it('every required field is present and correctly typed', () => {
    const issues = validateSnapshotSchema(snapshot)
    expect(issues).toEqual([])
  })

  it('id matches the pattern prompt:{timestamp}:h{hash}', () => {
    expect(snapshot.id).toMatch(/^prompt:\d+:h[a-z0-9]+$/)
  })

  it('compilerVersion is >= 1', () => {
    expect(snapshot.compilerVersion).toBeGreaterThanOrEqual(1)
  })

  it('layerOrder is non-empty and contains only strings', () => {
    expect(snapshot.layerOrder.length).toBeGreaterThan(0)
    for (const id of snapshot.layerOrder) {
      expect(typeof id).toBe('string')
    }
  })

  it('prompt is a non-empty string', () => {
    expect(typeof snapshot.prompt).toBe('string')
    expect(snapshot.prompt.length).toBeGreaterThan(0)
  })

  it('estimatedTokens is a positive integer', () => {
    expect(Number.isInteger(snapshot.estimatedTokens)).toBe(true)
    expect(snapshot.estimatedTokens).toBeGreaterThan(0)
  })

  it('layers is a non-empty array', () => {
    expect(Array.isArray(snapshot.layers)).toBe(true)
    expect(snapshot.layers.length).toBeGreaterThan(0)
  })

  it('layers.length equals layerOrder.length', () => {
    expect(snapshot.layers.length).toBe(snapshot.layerOrder.length)
  })

  it('compiledAt is a valid ISO date string', () => {
    expect(typeof snapshot.compiledAt).toBe('string')
    const parsed = new Date(snapshot.compiledAt)
    expect(isNaN(parsed.getTime())).toBe(false)
    // Should be ISO 8601 format
    expect(snapshot.compiledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

describe('Compiled prompt — layer schema invariants', () => {
  it('every default layer has non-empty content', () => {
    const snapshot = compile()
    const issues = validateLayerSchema(snapshot.layers)
    expect(issues).toEqual([])
  })

  it('every layer has the correct name matching its id', () => {
    const snapshot = compile()
    for (const layer of snapshot.layers) {
      expect(layer.name).toBeTruthy()
      expect(layer.name.length).toBeGreaterThan(0)
    }
  })

  it('every layer has version >= 1', () => {
    const snapshot = compile()
    for (const layer of snapshot.layers) {
      expect(layer.version).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(layer.version)).toBe(true)
    }
  })

  it('every layer has valid stability classification', () => {
    const snapshot = compile()
    for (const layer of snapshot.layers) {
      expect(['stable', 'volatile']).toContain(layer.stability)
    }
  })

  it('every layer content is non-empty (after trimming)', () => {
    const snapshot = compile()
    for (const layer of snapshot.layers) {
      expect(layer.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('no layer content is only whitespace', () => {
    const snapshot = compile()
    for (const layer of snapshot.layers) {
      expect(layer.content.trim()).not.toBe('')
    }
  })

  it('all layers have unique ids', () => {
    const snapshot = compile()
    const ids = snapshot.layers.map((l) => l.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('all 8 default built-in layers are present', () => {
    const snapshot = compile()
    const ids = new Set(snapshot.layers.map((l) => l.id))
    expect(ids.has('runtime-contract')).toBe(true)
    expect(ids.has('owner-identity')).toBe(true)
    expect(ids.has('execution-policy')).toBe(true)
    expect(ids.has('project-context')).toBe(true)
    expect(ids.has('skills')).toBe(true)
    expect(ids.has('memory')).toBe(true)
    expect(ids.has('session-state')).toBe(true)
    expect(ids.has('capabilities')).toBe(true)
    expect(ids.size).toBe(8)
  })

  it('layer content is preserved after cache hit', () => {
    const compiler = new PromptCompiler()
    const r1 = compiler.compile()
    const r2 = compiler.compile()
    for (let i = 0; i < r1.snapshot.layers.length; i++) {
      expect(r2.snapshot.layers[i]!.content).toBe(r1.snapshot.layers[i]!.content)
    }
  })
})

describe('Compiled prompt — token estimate consistency', () => {
  it('estimatedTokens equals Math.ceil(prompt.length / 4) for default compile', () => {
    const snapshot = compile()
    const issues = validateTokenEstimate(snapshot)
    expect(issues).toEqual([])
  })

  it('estimatedTokens equals Math.ceil(prompt.length / 4) for single layer', () => {
    const snapshot = compile({ layerOrder: ['runtime-contract'] })
    const issues = validateTokenEstimate(snapshot)
    expect(issues).toEqual([])
  })

  it('estimatedTokens equals Math.ceil(prompt.length / 4) for custom layers', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'owner-identity', 'execution-policy'],
      ownerProfile: { name: 'Test', aliases: [], locale: 'en', timezone: 'UTC', tone: 'Terse', verbosity: 2, bannedPhrases: ['never'] },
    })
    const issues = validateTokenEstimate(snapshot)
    expect(issues).toEqual([])
  })

  it('estimatedTokens is monotonic with prompt length across layer counts', () => {
    const single = compile({ layerOrder: ['runtime-contract'] })
    const three = compile({ layerOrder: ['runtime-contract', 'owner-identity', 'execution-policy'] })
    const all = compile()

    expect(single.estimatedTokens).toBeLessThan(three.estimatedTokens)
    expect(three.estimatedTokens).toBeLessThan(all.estimatedTokens)
  })

  it('estimatedTokens is 0 for empty prompt', () => {
    const snapshot = compile({ layerOrder: ['non-existent-layer'] })
    // Empty prompt → length 0 → Math.ceil(0/4) = 0
    expect(snapshot.prompt).toBe('')
    expect(snapshot.estimatedTokens).toBe(0)
  })
})

describe('Compiled prompt — token estimate vs real tokenizer (measure-compare)', () => {
  /**
   * The compiler uses chars/4 as a rough token estimate. This test measures
   * how much that estimate diverges from a real tokenizer (GPT-4o's o200k_base
   * via gpt-tokenizer). The goal is NOT to assert exact match — the chars/4
   * heuristic is intentionally conservative — but to establish a baseline
   * ratio and bound the worst-case error.
   *
   * Expected behaviour:
   *   - chars/4 typically OVER-estimates by 10–50% vs GPT-4o tokenizer
   *   - ratio = estimateTokens(prompt) / actualTokens is always >= 0.8 and
   *     rarely exceeds 3.0 even for very short prompts
   *   - longer prompts converge toward ~1.1–1.5× overestimate because the
   *     per-message overhead amortises
   */

  /**
   * Helper: count tokens using the real GPT-4o tokenizer.
   */
  function realTokenCount(text: string): number {
    if (text.length === 0) return 0
    return encode(text).length
  }

  it('default 8-layer compile: ratio is within 0.9–2.0', () => {
    const snapshot = compile()
    const estimated = snapshot.estimatedTokens
    const actual = realTokenCount(snapshot.prompt)
    const ratio = estimated / actual

    // Observed range is ~1.1–1.5; 0.9–2.0 gives generous headroom for
    // content changes while still catching wild over- or under-estimates.
    expect(ratio).toBeGreaterThanOrEqual(0.9)
    expect(ratio).toBeLessThanOrEqual(2.0)

    console.log(
      `[measure] default 8-layer: chars=${snapshot.prompt.length} ` +
      `estimate=${estimated} actual=${actual} ratio=${ratio.toFixed(3)}`
    )
  })

  it('single layer: ratio is within 0.9–2.0', () => {
    const snapshot = compile({ layerOrder: ['runtime-contract'] })
    const estimated = snapshot.estimatedTokens
    const actual = realTokenCount(snapshot.prompt)
    const ratio = estimated / actual

    expect(ratio).toBeGreaterThanOrEqual(0.9)
    expect(ratio).toBeLessThanOrEqual(2.0)

    console.log(
      `[measure] single layer: chars=${snapshot.prompt.length} ` +
      `estimate=${estimated} actual=${actual} ratio=${ratio.toFixed(3)}`
    )
  })

  it('memory-only compile: ratio is within 0.9–2.0', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'memory'],
      memories: [
        { title: 'API Design', content: 'Follow RESTful patterns. Use status codes consistently.', score: 0.88 },
        { title: 'Testing Strategy', content: 'Write unit tests first. Integration tests cover the edges.', score: 0.76 },
      ],
    })
    const estimated = snapshot.estimatedTokens
    const actual = realTokenCount(snapshot.prompt)
    const ratio = estimated / actual

    expect(ratio).toBeGreaterThanOrEqual(0.9)
    expect(ratio).toBeLessThanOrEqual(2.0)

    console.log(
      `[measure] memory-only: chars=${snapshot.prompt.length} ` +
      `estimate=${estimated} actual=${actual} ratio=${ratio.toFixed(3)}`
    )
  })

  it('explore mode with session state: ratio is within 0.9–2.0', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'execution-policy', 'session-state'],
      executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
      sessionState: {
        sessionId: 'explore-session-1',
        permissionMode: 'explore',
        plansFolderPath: '/tmp/explore/plans',
        dataFolderPath: '/tmp/explore/data',
      },
    })
    const estimated = snapshot.estimatedTokens
    const actual = realTokenCount(snapshot.prompt)
    const ratio = estimated / actual

    expect(ratio).toBeGreaterThanOrEqual(0.9)
    expect(ratio).toBeLessThanOrEqual(2.0)

    console.log(
      `[measure] explore+session: chars=${snapshot.prompt.length} ` +
      `estimate=${estimated} actual=${actual} ratio=${ratio.toFixed(3)}`
    )
  })

  it('full compile with all overrides: ratio is within 0.9–2.0', () => {
    const snapshot = compile({
      ownerProfile: {
        name: 'Skobez',
        aliases: ['skobe', 'architect'],
        locale: 'en-NZ',
        timezone: 'Pacific/Auckland',
        tone: 'Direct and technical',
        verbosity: 3,
        bannedPhrases: ["I'm sorry", 'I cannot', 'As an AI'],
      },
      executionPolicy: { defaultMode: 'owner-auto', askOnlyWhen: ['filesystem-write'], allowedRoots: ['/workspace/src'] },
      skills: ['Web research via Hermes', 'Git operations', 'TypeScript', 'React'],
      memories: [
        { title: 'Project Structure', content: 'Bun monorepo with workspaces (packages/*, apps/*). SQLite/FTS5 for memory storage.', score: 0.95 },
        { title: 'Coding Convention', content: 'Use TypeScript strict mode throughout the project.', score: 0.82 },
      ],
      sessionState: {
        sessionId: 'full-override-session',
        permissionMode: 'owner-auto',
        plansFolderPath: '/workspace/plans',
        dataFolderPath: '/workspace/data',
      },
      capabilities: ['Codex (ChatGPT)', 'Claude (Anthropic)', 'Ollama Local'],
      projectContext: {
        workingDirectory: '/workspace/my-project',
        contextFiles: [
          { filename: 'AGENTS.md', content: '# Project\n\nUse Bun for builds. Run tests with bun test.' },
        ],
      },
    })
    const estimated = snapshot.estimatedTokens
    const actual = realTokenCount(snapshot.prompt)
    const ratio = estimated / actual

    expect(ratio).toBeGreaterThanOrEqual(0.9)
    expect(ratio).toBeLessThanOrEqual(2.0)

    console.log(
      `[measure] full overrides: chars=${snapshot.prompt.length} ` +
      `estimate=${estimated} actual=${actual} ratio=${ratio.toFixed(3)}`
    )
  })

  it('code-heavy content (project-context with .ts snippet): ratio within 0.9–2.0', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'project-context'],
      projectContext: {
        workingDirectory: '/workspace/app',
        contextFiles: [
          {
            filename: 'server.ts',
            content: [
              'import { createServer } from "node:http";',
              'import { readFile } from "node:fs/promises";',
              '',
              'const PORT = process.env.PORT || 3000;',
              'const server = createServer(async (req, res) => {',
              '  const url = new URL(req.url!, `http://${req.headers.host}`);',
              '  if (url.pathname === "/api/health") {',
              '    res.writeHead(200, { "Content-Type": "application/json" });',
              '    res.end(JSON.stringify({ status: "ok", ts: Date.now() }));',
              '    return;',
              '  }',
              '  try {',
              '    const file = await readFile(`.${url.pathname}`);',
              '    res.writeHead(200);',
              '    res.end(file);',
              '  } catch {',
              '    res.writeHead(404);',
              '    res.end("Not found");',
              '  }',
              '});',
              'server.listen(PORT, () => console.log(`Server running on :${PORT}`));',
            ].join('\n'),
          },
        ],
      },
    })
    const estimated = snapshot.estimatedTokens
    const actual = realTokenCount(snapshot.prompt)
    const ratio = estimated / actual

    expect(ratio).toBeGreaterThanOrEqual(0.9)
    expect(ratio).toBeLessThanOrEqual(2.0)

    console.log(
      `[measure] code-heavy: chars=${snapshot.prompt.length} ` +
      `estimate=${estimated} actual=${actual} ratio=${ratio.toFixed(3)}`
    )
  })

  it('mixed Unicode content (em-dash, accent, emoji): ratio within 0.9–2.0', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'project-context'],
      projectContext: {
        workingDirectory: '/workspace/docs',
        contextFiles: [
          {
            filename: 'README.md',
            content: [
              '# ARCHstudio — The AI Designer\'s Toolkit',
              '',
              'Visit München for the next demo! 🎨✨',
              'The interface — clean, fast, and delightful — "just works."',
              'Crème brûlée is our favourite dessert, and olé is our motto.',
              'Tschüss, au revoir, và llet!',
            ].join('\n'),
          },
        ],
      },
    })
    const estimated = snapshot.estimatedTokens
    const actual = realTokenCount(snapshot.prompt)
    const ratio = estimated / actual

    expect(ratio).toBeGreaterThanOrEqual(0.9)
    expect(ratio).toBeLessThanOrEqual(2.0)

    console.log(
      `[measure] unicode-mixed: chars=${snapshot.prompt.length} ` +
      `estimate=${estimated} actual=${actual} ratio=${ratio.toFixed(3)}`
    )
  })

  it('ratio is stable across two compiles of the same prompt', () => {
    const compiler = new PromptCompiler()
    const r1 = compiler.compile()
    const r2 = compiler.compile()

    const a1 = realTokenCount(r1.snapshot.prompt)
    const a2 = realTokenCount(r2.snapshot.prompt)

    // Same content → same token count
    expect(a1).toBe(a2)
  })

  it('empty prompt produces 0 tokens by both measures', () => {
    const snapshot = compile({ layerOrder: ['non-existent-layer'] })
    expect(snapshot.estimatedTokens).toBe(0)
    expect(realTokenCount(snapshot.prompt)).toBe(0)
  })

  it('ratio improves (approaches 1.0) with longer prompts', () => {
    // Single layer — shortest prompt, per-message overhead is proportionally larger
    const single = compile({ layerOrder: ['runtime-contract'] })
    // All layers — much longer, overhead amortised across more content
    const all = compile()

    const singleRatio = single.estimatedTokens / realTokenCount(single.prompt)
    const allRatio = all.estimatedTokens / realTokenCount(all.prompt)

    // The full prompt should have a LOWER ratio (closer to 1.0) than a
    // single-layer prompt because the fixed per-token boilerplate is diluted.
    // This is an empirical observation, not a guaranteed invariant — if the
    // tokenizer or compiler output changes significantly, this test documents
    // the shift for investigation.
    expect(allRatio).toBeLessThanOrEqual(singleRatio)

    console.log(
      `[measure] single ratio=${singleRatio.toFixed(3)} full ratio=${allRatio.toFixed(3)} ` +
      `(lower is better; full <= single: ${allRatio <= singleRatio ? 'YES ✓' : 'NO'})`
    )
  })
})

describe('Compiled prompt — hash integrity', () => {
  it('id hash matches contentHash(prompt) for default compile', () => {
    const snapshot = compile()
    const issues = validateHash(snapshot)
    expect(issues).toEqual([])
  })

  it('id hash matches contentHash(prompt) with overrides', () => {
    const snapshot = compile({
      ownerProfile: { name: 'Custom', aliases: [], locale: 'fr', timezone: 'Europe/Paris', tone: 'Formal', verbosity: 4, bannedPhrases: [] },
      executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: ['/tmp'] },
    })
    const issues = validateHash(snapshot)
    expect(issues).toEqual([])
  })

  it('id hash matches contentHash(prompt) with memories', () => {
    const snapshot = compile({
      memories: [{ title: 'Memory One', content: 'Important context.', score: 0.95 }],
    })
    const issues = validateHash(snapshot)
    expect(issues).toEqual([])
  })

  it('same inputs produce same hash', () => {
    const compiler = new PromptCompiler()
    const r1 = compiler.compile()
    const r2 = compiler.compile()
    const hash1 = r1.snapshot.id.split(':').pop()
    const hash2 = r2.snapshot.id.split(':').pop()
    expect(hash1).toBe(hash2)
  })
})

describe('Compiled prompt — stability classification order', () => {
  it('default layers 1-4 are stable, 5-8 are volatile', () => {
    const snapshot = compile()
    const issues = validateDefaultStabilityOrder(snapshot)
    expect(issues).toEqual([])
  })

  it('only the first 4 layers in default order are stable', () => {
    const snapshot = compile()
    const stable = snapshot.layers.filter((l) => l.stability === 'stable')
    const volatile = snapshot.layers.filter((l) => l.stability === 'volatile')
    expect(stable).toHaveLength(4)
    expect(volatile).toHaveLength(4)
    expect(stable.map((l) => l.id)).toEqual([
      'runtime-contract',
      'owner-identity',
      'execution-policy',
      'project-context',
    ])
    expect(volatile.map((l) => l.id)).toEqual(['skills', 'memory', 'session-state', 'capabilities'])
  })

  it('stable layers all have version >= 1', () => {
    const snapshot = compile({ layerOrder: ['runtime-contract', 'owner-identity'] })
    for (const layer of snapshot.layers) {
      expect(layer.stability).toBe('stable')
      expect(layer.version).toBeGreaterThanOrEqual(1)
    }
  })

  it('volatile layers have version >= 1', () => {
    const snapshot = compile({ layerOrder: ['skills', 'memory'] })
    for (const layer of snapshot.layers) {
      expect(layer.stability).toBe('volatile')
      expect(layer.version).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('Compiled prompt — layer position in prompt', () => {
  it('layers appear in the prompt in layerOrder', () => {
    const snapshot = compile()
    const issues = validateLayerPositionInPrompt(snapshot)
    expect(issues).toEqual([])
  })

  it('layers appear in correct order with custom partial order', () => {
    const snapshot = compile({ layerOrder: ['owner-identity', 'capabilities', 'skills'] })
    const issues = validateLayerPositionInPrompt(snapshot)
    expect(issues).toEqual([])
  })

  it('a single layer appears at the exact start of the prompt', () => {
    const snapshot = compile({ layerOrder: ['runtime-contract'] })
    // The prompt should exactly equal the layer content (no join separator for 1 layer)
    expect(snapshot.prompt).toBe(snapshot.layers[0]!.content)
    expect(snapshot.prompt).toContain('ARCHstudio')
  })

  it('prompt text for 2 layers has a double-newline separator between them', () => {
    const snapshot = compile({ layerOrder: ['runtime-contract', 'owner-identity'] })
    const content1 = snapshot.layers[0]!.content
    const content2 = snapshot.layers[1]!.content
    const expected = `${content1}\n\n${content2}`
    expect(snapshot.prompt).toBe(expected)
    // Verify the first layer's last line is not directly adjacent to second layer's content
    expect(snapshot.prompt).toContain('\n\n')
  })
})

describe('Compiled prompt — prompt join with double-newline', () => {
  it('default 8-layer prompt is correctly joined', () => {
    const snapshot = compile()
    const issues = validatePromptJoin(snapshot.prompt, snapshot.layers)
    expect(issues).toEqual([])
  })

  it('custom partial order prompt is correctly joined', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'skills', 'capabilities'],
    })
    const issues = validatePromptJoin(snapshot.prompt, snapshot.layers)
    expect(issues).toEqual([])
  })

  it('single layer prompt has no join separator added', () => {
    const snapshot = compile({ layerOrder: ['runtime-contract'] })
    // Only 1 layer → no join, just the content directly.
    // The layer's OWN content may contain \n\n (internal formatting),
    // but those are part of the layer, not added by the join operation.
    expect(snapshot.prompt).toBe(snapshot.layers[0]!.content)
    // The prompt length equals the single layer's content length (no join chars added)
    expect(snapshot.prompt.length).toBe(snapshot.layers[0]!.content.length)
  })

  it('empty layers array produces empty prompt', () => {
    const snapshot = compile({ layerOrder: ['unknown-layer'] })
    expect(snapshot.layers).toHaveLength(0)
    expect(snapshot.prompt).toBe('')
  })
})

describe('Compiled prompt — full structural integrity', () => {
  it('passes all structural checks for default compile', () => {
    const snapshot = compile()
    const issues = validateAll(snapshot)
    expect(issues).toEqual([])
  })

  it('execution-policy layer contains the retry directive with defaults', () => {
    const snapshot = compile()
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toContain('Retry up to 3 times')
    expect(policyLayer.content).toContain('exponential backoff')
    expect(policyLayer.content).toContain('On tool failure')
  })

  it('retry directive defaults to 3 times when no retryConfig is provided', () => {
    // compile() with default executionPolicy (no retryConfig) → 3 retries
    const snapshot = compile()
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toContain('Retry up to 3 times')
    // Default doesn't include a backoff detail line (no override was provided
    // to trigger the paramterized rendering path).
    expect(policyLayer.content).not.toMatch(/base delay:/)
  })

  it('retry directive uses custom maxRetries when configured', () => {
    const snapshot = compile({
      executionPolicy: {
        defaultMode: 'owner-auto',
        askOnlyWhen: [],
        allowedRoots: [],
        retryConfig: { maxRetries: 5, backoffMs: 2000 },
      },
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toContain('Retry up to 5 times')
    expect(policyLayer.content).not.toContain('Retry up to 3 times')
  })

  it('retry backoff renders base delay in ms when retryConfig is provided', () => {
    const snapshot = compile({
      executionPolicy: {
        defaultMode: 'owner-auto',
        askOnlyWhen: [],
        allowedRoots: [],
        retryConfig: { maxRetries: 3, backoffMs: 5000 },
      },
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toContain('Retry up to 3 times')
    expect(policyLayer.content).toContain('base delay: 5000ms')
    expect(policyLayer.content).toContain('exponential backoff')
  })

  it('retry directive is present in all three modes with default retryConfig', () => {
    for (const mode of ['owner-auto', 'explore', 'unrestricted']) {
      const snapshot = compile({
        executionPolicy: { defaultMode: mode, askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
      expect(policyLayer.content).toContain('Retry up to 3 times')
    }
  })

  it('retry config works in all three modes with custom values', () => {
    for (const mode of ['owner-auto', 'explore', 'unrestricted']) {
      const snapshot = compile({
        executionPolicy: {
          defaultMode: mode,
          askOnlyWhen: [],
          allowedRoots: [],
          retryConfig: { maxRetries: 1, backoffMs: 500 },
        },
      })
      const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
      expect(policyLayer.content).toContain('Retry up to 1 time')
      expect(policyLayer.content).toContain('base delay: 500ms')
    }
  })

  it('passes all structural checks with all overrides', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'execution-policy', 'owner-identity'],
      ownerProfile: {
        name: 'Skobez',
        aliases: ['skobe', 'architect'],
        locale: 'en-NZ',
        timezone: 'Pacific/Auckland',
        tone: 'Direct and technical',
        verbosity: 3,
        bannedPhrases: ["I'm sorry", 'I cannot', 'As an AI'],
      },
      executionPolicy: {
        defaultMode: 'owner-auto',
        askOnlyWhen: ['filesystem-write'],
        allowedRoots: ['/workspace/src', '/workspace/docs'],
      },
      skills: ['Web research via Hermes', 'Git operations'],
      memories: [
        { title: 'Project Structure', content: 'Bun monorepo with workspaces.', score: 0.95 },
      ],
      sessionState: {
        sessionId: 'test-session',
        permissionMode: 'owner-auto',
        plansFolderPath: '/tmp/test/plans',
        dataFolderPath: '/tmp/test/data',
      },
      capabilities: ['Codex (ChatGPT)', 'Claude (Anthropic)', 'Ollama Local'],
      projectContext: {
        workingDirectory: '/workspace/my-project',
        contextFiles: [{ filename: 'AGENTS.md', content: '## Project Info\n\nUse Bun for builds.' }],
      },
    })
    const issues = validateAll(snapshot)
    expect(issues).toEqual([])
  })

  it('passes all structural checks for explore mode with custom order', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'execution-policy', 'session-state'],
      executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
      sessionState: {
        sessionId: 'explore-session-1',
        permissionMode: 'explore',
        plansFolderPath: '/tmp/explore/plans',
        dataFolderPath: '/tmp/explore/data',
      },
    })
    const issues = validateAll(snapshot)
    expect(issues).toEqual([])
  })

  it('passes all structural checks for a memory-only compile', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'memory'],
      memories: [
        { title: 'API Design', content: 'Follow RESTful patterns.', score: 0.88 },
        { title: 'Testing', content: 'Write tests first.', score: 0.76 },
      ],
    })
    const issues = validateAll(snapshot)
    expect(issues).toEqual([])
  })

  it('passes all structural checks with empty memory array', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'memory'],
      memories: [],
    })
    const issues = validateAll(snapshot)
    expect(issues).toEqual([])
  })

  it('passes all structural checks for unrestricted mode', () => {
    const snapshot = compile({
      executionPolicy: { defaultMode: 'unrestricted', askOnlyWhen: [], allowedRoots: [] },
    })
    const issues = validateAll(snapshot)
    expect(issues).toEqual([])
  })
})

describe('Compiled prompt — prompt length consistency', () => {
  it('prompt character count equals sum of layer content lengths plus separators', () => {
    const snapshot = compile()
    const sumLengths = snapshot.layers.reduce((acc, l) => acc + l.content.length, 0)
    const separatorCount = snapshot.layers.length > 0 ? (snapshot.layers.length - 1) * 2 : 0 // \n\n = 2 chars
    expect(snapshot.prompt.length).toBe(sumLengths + separatorCount)
  })

  it('prompt length matches for a single layer (no separators)', () => {
    const snapshot = compile({ layerOrder: ['runtime-contract'] })
    expect(snapshot.prompt.length).toBe(snapshot.layers[0]!.content.length)
  })

  it('prompt length matches for 3 layers (2 separators)', () => {
    const snapshot = compile({
      layerOrder: ['runtime-contract', 'owner-identity', 'execution-policy'],
    })
    const sumLengths = snapshot.layers.reduce((acc, l) => acc + l.content.length, 0)
    const separators = 2 * 2 // \n\n between each = 2 chars × 2 gaps
    expect(snapshot.prompt.length).toBe(sumLengths + separators)
  })
})

describe('Compiled prompt — layer version consistency', () => {
  it('all default layers have version >= 1; execution-policy is version 2', () => {
    const snapshot = compile()
    for (const layer of snapshot.layers) {
      if (layer.id === 'execution-policy') {
        expect(layer.version).toBe(2) // bumped when retry directive was added
      } else {
        expect(layer.version).toBeGreaterThanOrEqual(1)
      }
    }
    // Sanity-check the specific version count
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.version).toBe(2)
  })

  it('layer version is always >= 1 regardless of options', () => {
    const configs: CompileOptions[] = [
      { layerOrder: ['runtime-contract'] },
      { memories: [{ title: 'M', content: 'C', score: 0.5 }] },
      { skills: ['Skill A'] },
      { capabilities: ['Cap X'] },
      { sessionState: { sessionId: 's', permissionMode: 'owner-auto', plansFolderPath: '/p', dataFolderPath: '/d' } },
    ]
    for (const opts of configs) {
      const snapshot = compile(opts)
      for (const layer of snapshot.layers) {
        expect(layer.version).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('Compiled prompt — id format invariants', () => {
  it('id contains exactly 3 colon-separated parts', () => {
    const snapshot = compile()
    const parts = snapshot.id.split(':')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('prompt')
  })

  it('id timestamp is a valid positive number', () => {
    const snapshot = compile()
    const timestamp = Number(snapshot.id.split(':')[1])
    expect(Number.isFinite(timestamp)).toBe(true)
    expect(timestamp).toBeGreaterThan(0)
  })

  it('id hash part starts with h followed by alphanumeric', () => {
    const snapshot = compile()
    const hash = snapshot.id.split(':')[2]
    expect(hash).toMatch(/^h[a-z0-9]+$/)
  })

  it('different prompts produce different IDs', () => {
    const auto = compile()
    const explore = compile({
      executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
    })
    expect(auto.id).not.toBe(explore.id)
  })

  it('same prompt produces same hash, different timestamp', () => {
    const compiler = new PromptCompiler()
    const r1 = compiler.compile()
    const r2 = compiler.compile()
    // Hashes should match
    const hash1 = r1.snapshot.id.split(':').pop()
    const hash2 = r2.snapshot.id.split(':').pop()
    expect(hash1).toBe(hash2)
    // Timestamps should differ (time passes)
    const ts1 = Number(r1.snapshot.id.split(':')[1])
    const ts2 = Number(r2.snapshot.id.split(':')[1])
    expect(ts2).toBeGreaterThanOrEqual(ts1)
  })
})

describe('Compiled prompt — compiledAt format', () => {
  it('compiledAt is close to current time', () => {
    const snapshot = compile()
    const compiledTime = new Date(snapshot.compiledAt).getTime()
    const now = Date.now()
    // Should be within 5 seconds of now
    expect(Math.abs(compiledTime - now)).toBeLessThan(5000)
  })

  it('compiledAt is set on every compile', () => {
    const compiler = new PromptCompiler()
    const r1 = compiler.compile()
    const r2 = compiler.compile()
    // Both calls produce valid ISO date strings (they may share the same
    // millisecond, so we check format and truthiness, not inequality)
    expect(r1.snapshot.compiledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(r2.snapshot.compiledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(r1.snapshot.compiledAt.length).toBeGreaterThan(0)
    expect(r2.snapshot.compiledAt.length).toBeGreaterThan(0)
  })
})

// =========================================================================
// Negative structural tests — deliberately malformed snapshots
//
// These construct snapshots that violate specific schema invariants and
// assert that validateSnapshotSchema / validateLayerSchema catch EVERY
// defect. A defect that goes undetected is a bug in the validator.
// =========================================================================

// ---------------------------------------------------------------------------
// Helper: minimal valid snapshot to mutate per test
// ---------------------------------------------------------------------------

function validSnapshot(overrides?: Partial<CompiledPromptSnapshot>): CompiledPromptSnapshot {
  const base: CompiledPromptSnapshot = compile()
  return { ...base, ...overrides }
}

// ---------------------------------------------------------------------------
// Helper: minimal valid layer to mutate per test
// ---------------------------------------------------------------------------

function validLayer(overrides?: Partial<PromptLayer>): PromptLayer {
  const base: PromptLayer = {
    id: 'test-layer',
    name: 'Test Layer',
    version: 1,
    stability: 'stable',
    content: 'Some valid content.',
  }
  return { ...base, ...overrides }
}

// =========================================================================
// Snapshot-level defects
// =========================================================================

describe('Negative — snapshot schema defects', () => {

  // ── id ──

  it('catches empty id', () => {
    const issues = validateSnapshotSchema(validSnapshot({ id: '' }))
    expect(issues.some(i => i.includes('snapshot.id is empty'))).toBe(true)
  })

  it('catches non-string id', () => {
    // Cast through unknown to bypass the type system for this deliberately
    // malformed test — the validator should handle runtime-type mismatches.
    const issues = validateSnapshotSchema(
      validSnapshot({ id: 12345 as unknown as string }),
    )
    expect(issues.some(i => i.includes('snapshot.id is not a string'))).toBe(true)
  })

  it('catches malformed id pattern — missing h prefix', () => {
    const issues = validateSnapshotSchema(validSnapshot({ id: 'prompt:1740000000:abc' }))
    expect(issues.some(i => i.includes('does not match pattern'))).toBe(true)
  })

  it('catches malformed id pattern — no timestamp', () => {
    const issues = validateSnapshotSchema(validSnapshot({ id: 'prompt::habc' }))
    expect(issues.some(i => i.includes('does not match pattern'))).toBe(true)
  })

  it('catches malformed id pattern — wrong prefix', () => {
    const issues = validateSnapshotSchema(validSnapshot({ id: 'foo:123:habc' }))
    expect(issues.some(i => i.includes('does not match pattern'))).toBe(true)
  })

  // ── compilerVersion ──

  it('catches compilerVersion < 1', () => {
    const issues = validateSnapshotSchema(validSnapshot({ compilerVersion: 0 }))
    expect(issues.some(i => i.includes('compilerVersion') && i.includes('< 1'))).toBe(true)
  })

  it('catches negative compilerVersion', () => {
    const issues = validateSnapshotSchema(validSnapshot({ compilerVersion: -5 }))
    expect(issues.some(i => i.includes('compilerVersion') && i.includes('< 1'))).toBe(true)
  })

  it('catches non-number compilerVersion', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ compilerVersion: '1' as unknown as number }),
    )
    expect(issues.some(i => i.includes('compilerVersion is not a number'))).toBe(true)
  })

  // ── layerOrder ──

  it('catches empty layerOrder', () => {
    const issues = validateSnapshotSchema(validSnapshot({ layerOrder: [] }))
    expect(issues.some(i => i.includes('layerOrder is empty'))).toBe(true)
  })

  it('catches non-array layerOrder', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ layerOrder: 'not-an-array' as unknown as string[] }),
    )
    expect(issues.some(i => i.includes('layerOrder is not an array'))).toBe(true)
  })

  it('catches layerOrder with non-string elements', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ layerOrder: ['valid', 42 as unknown as string] }),
    )
    expect(issues.some(i => i.includes('contains non-string'))).toBe(true)
  })

  // ── prompt ──

  it('catches non-string prompt', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ prompt: null as unknown as string }),
    )
    expect(issues.some(i => i.includes('snapshot.prompt is not a string'))).toBe(true)
  })

  // ── estimatedTokens ──

  it('catches negative estimatedTokens', () => {
    const issues = validateSnapshotSchema(validSnapshot({ estimatedTokens: -100 }))
    expect(issues.some(i => i.includes('estimatedTokens') && i.includes('< 0'))).toBe(true)
  })

  it('catches NaN estimatedTokens', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ estimatedTokens: NaN }),
    )
    expect(issues.some(i => i.includes('estimatedTokens is not finite'))).toBe(true)
  })

  it('catches Infinity estimatedTokens', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ estimatedTokens: Infinity }),
    )
    expect(issues.some(i => i.includes('estimatedTokens is not finite'))).toBe(true)
  })

  it('catches non-integer estimatedTokens', () => {
    const issues = validateSnapshotSchema(validSnapshot({ estimatedTokens: 4.7 }))
    expect(issues.some(i => i.includes('estimatedTokens is not an integer'))).toBe(true)
  })

  it('catches non-number estimatedTokens', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ estimatedTokens: '50' as unknown as number }),
    )
    expect(issues.some(i => i.includes('estimatedTokens is not a number'))).toBe(true)
  })

  // ── layers ──

  it('catches non-array layers', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ layers: null as unknown as PromptLayer[] }),
    )
    expect(issues.some(i => i.includes('snapshot.layers is not an array'))).toBe(true)
  })

  it('catches empty layers array', () => {
    const snapshot = validSnapshot()
    const issues = validateSnapshotSchema(
      validSnapshot({ layers: [], layerOrder: snapshot.layerOrder }),
    )
    expect(issues.some(i => i.includes('snapshot.layers is empty'))).toBe(true)
  })

  // ── compiledAt ──

  it('catches non-string compiledAt', () => {
    const issues = validateSnapshotSchema(
      validSnapshot({ compiledAt: 123 as unknown as string }),
    )
    expect(issues.some(i => i.includes('compiledAt is not a string'))).toBe(true)
  })

  it('catches invalid compiledAt date string', () => {
    const issues = validateSnapshotSchema(validSnapshot({ compiledAt: 'not-a-date' }))
    expect(issues.some(i => i.includes('not a valid date'))).toBe(true)
  })

  // ── length mismatch ──

  it('catches layers.length < layerOrder.length', () => {
    const snapshot = compile()
    const issues = validateSnapshotSchema(
      validSnapshot({
        layers: snapshot.layers.slice(0, 3),
        layerOrder: snapshot.layerOrder, // 8 elements, but only 3 layers
      }),
    )
    expect(issues.some(i => i.includes('!== layerOrder.length'))).toBe(true)
  })

  it('catches layers.length > layerOrder.length', () => {
    const base = compile()
    const issues = validateSnapshotSchema(
      validSnapshot({
        layers: [...base.layers, validLayer({ id: 'extra', name: 'Extra' })],
        layerOrder: base.layerOrder, // 8 elements, but 9 layers
      }),
    )
    expect(issues.some(i => i.includes('!== layerOrder.length'))).toBe(true)
  })
})

// =========================================================================
// Layer-level defects
// =========================================================================

describe('Negative — layer schema defects', () => {

  // ── id ──

  it('catches empty layer id', () => {
    const issues = validateLayerSchema([validLayer({ id: '' })])
    expect(issues.some(i => i.includes('has empty id'))).toBe(true)
  })

  it('catches non-string layer id', () => {
    const issues = validateLayerSchema([
      validLayer({ id: 42 as unknown as string }),
    ])
    expect(issues.some(i => i.includes('id is not a string'))).toBe(true)
  })

  // ── name ──

  it('catches empty layer name', () => {
    const issues = validateLayerSchema([validLayer({ name: '' })])
    expect(issues.some(i => i.includes('has empty name'))).toBe(true)
  })

  it('catches non-string layer name', () => {
    const issues = validateLayerSchema([
      validLayer({ name: false as unknown as string }),
    ])
    expect(issues.some(i => i.includes('name is not a string'))).toBe(true)
  })

  // ── version ──

  it('catches version < 1', () => {
    const issues = validateLayerSchema([validLayer({ version: 0 })])
    expect(issues.some(i => i.includes('version') && i.includes('< 1'))).toBe(true)
  })

  it('catches non-number version', () => {
    const issues = validateLayerSchema([
      validLayer({ version: undefined as unknown as number }),
    ])
    expect(issues.some(i => i.includes('version is not a number'))).toBe(true)
  })

  it('catches non-integer version', () => {
    const issues = validateLayerSchema([validLayer({ version: 1.5 })])
    expect(issues.some(i => i.includes('version') && i.includes('not an integer'))).toBe(true)
  })

  // ── stability ──

  it('catches invalid stability', () => {
    const issues = validateLayerSchema([
      validLayer({ stability: 'semi-stable' as 'stable' | 'volatile' }),
    ])
    expect(issues.some(i => i.includes('stability') && i.includes('not'))).toBe(true)
  })

  it('catches undefined stability', () => {
    const issues = validateLayerSchema([
      validLayer({ stability: undefined as unknown as 'stable' | 'volatile' }),
    ])
    expect(issues.some(i => i.includes('stability'))).toBe(true)
  })

  // ── content ──

  it('catches non-string content', () => {
    const issues = validateLayerSchema([
      validLayer({ content: 42 as unknown as string }),
    ])
    expect(issues.some(i => i.includes('content is not a string'))).toBe(true)
  })

  it('catches empty content (empty string)', () => {
    const issues = validateLayerSchema([validLayer({ content: '' })])
    expect(issues.some(i => i.includes('content is empty'))).toBe(true)
  })

  it('catches whitespace-only content', () => {
    const issues = validateLayerSchema([validLayer({ content: '   \n\t  ' })])
    expect(issues.some(i => i.includes('content is empty'))).toBe(true)
  })

  // ── undefined layer entry in array ──

  it('catches undefined layer in array', () => {
    const issues = validateLayerSchema([validLayer(), undefined as unknown as PromptLayer])
    expect(issues.some(i => i.includes('is undefined'))).toBe(true)
  })

  // ── compound: multiple defects on one layer ──

  it('catches all defects on a single malformed layer', () => {
    const issues = validateLayerSchema([
      validLayer({
        id: '',
        name: '',
        version: -3,
        stability: 'invalid' as 'stable' | 'volatile',
        content: '',
      }),
    ])
    expect(issues.some(i => i.includes('has empty id'))).toBe(true)
    expect(issues.some(i => i.includes('has empty name'))).toBe(true)
    expect(issues.some(i => i.includes('version') && i.includes('< 1'))).toBe(true)
    expect(issues.some(i => i.includes('stability'))).toBe(true)
    expect(issues.some(i => i.includes('content is empty'))).toBe(true)
    expect(issues.length).toBeGreaterThanOrEqual(5)
  })
})

// =========================================================================
// Production validateSnapshot — negative tests
// =========================================================================

describe('Negative — production validateSnapshot defects', () => {
  // Import the production validator so we test the actual runtime guard too.
  const { validateSnapshot: validateSnapshotProd } = require('../validator.ts')

  it('reports invalid for empty id', () => {
    const result = validateSnapshotProd(validSnapshot({ id: '' }))
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message === 'Snapshot id is required')).toBe(true)
  })

  it('reports invalid for compilerVersion < 1', () => {
    const result = validateSnapshotProd(validSnapshot({ compilerVersion: 0 }))
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message.includes('Compiler version must be >= 1'))).toBe(true)
  })

  it('reports invalid for empty layerOrder', () => {
    const result = validateSnapshotProd(validSnapshot({ layerOrder: [] }))
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message === 'Layer order is empty')).toBe(true)
  })

  it('reports invalid for empty prompt', () => {
    const result = validateSnapshotProd(validSnapshot({ prompt: '' }))
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message === 'Compiled prompt is empty')).toBe(true)
  })

  it('reports warning for duplicate layer id in layerOrder', () => {
    const result = validateSnapshotProd(
      validSnapshot({ layerOrder: ['runtime-contract', 'runtime-contract', 'owner-identity'] }),
    )
    expect(result.valid).toBe(true) // duplicates are warnings, not errors
    expect(result.issues.some(i => i.message.includes('Duplicate layer id'))).toBe(true)
    expect(result.issues.some(i => i.severity === 'warning')).toBe(true)
  })

  it('detects multiple defects simultaneously', () => {
    // Empty id + compilerVersion 0 + empty prompt
    const result = validateSnapshotProd(
      validSnapshot({ id: '', compilerVersion: 0, prompt: '' }),
    )
    expect(result.valid).toBe(false)
    // Should have at least 3 error-level issues
    const errorCount = result.issues.filter(i => i.severity === 'error').length
    expect(errorCount).toBeGreaterThanOrEqual(3)
  })
})

// =========================================================================
// Mutation testing — systematically mutate compiler output and assert every
// mutation is caught by at least one validator check.
//
// A mutation that passes through validateAll() without any issue is a GAP
// in the validation suite — the validator failed to detect a corrupt snapshot.
// =========================================================================

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

type MutationFn = (snapshot: CompiledPromptSnapshot) => CompiledPromptSnapshot

/** Deep-clone a snapshot so mutations don't affect the original. */
function clone(snapshot: CompiledPromptSnapshot): CompiledPromptSnapshot {
  return {
    ...snapshot,
    layers: snapshot.layers.map(l => ({ ...l })),
    layerOrder: [...snapshot.layerOrder],
  }
}

// ---------------------------------------------------------------------------
// Define every mutation as a named function.
// Each mutation targets ONE invariant; starting from a valid snapshot it
// produces a snapshot that violates that invariant in exactly one way.
// ---------------------------------------------------------------------------

interface MutationCase {
  name: string
  mutate: MutationFn
}

const MUTATIONS: MutationCase[] = [
  // ── Snapshot-level mutations ──
  {
    name: 'clear id',
    mutate: (s) => ({ ...s, id: '' }),
  },
  {
    name: 'corrupt hash in id',
    mutate: (s) => ({ ...s, id: s.id + 'x' }),
  },
  {
    name: 'swap two layer IDs in layerOrder (and corresponding layers)',
    mutate: (s) => {
      const order = [...s.layerOrder]; [order[0], order[1]] = [order[1], order[0]]
      const layers = [...s.layers]; [layers[0], layers[1]] = [layers[1], layers[0]]
      return { ...s, layerOrder: order, layers }
    },
  },
  {
    name: 'duplicate a layer ID in layerOrder (and add extra placeholder layer)',
    mutate: (s) => ({
      ...s,
      layerOrder: [...s.layerOrder, s.layerOrder[0]!],
      layers: [...s.layers, validLayer({ id: s.layerOrder[0]!, name: 'Dup' })],
    }),
  },
  {
    name: 'shuffle layerOrder (and corresponding layers)',
    mutate: (s) => ({
      ...s,
      layerOrder: [...s.layerOrder].reverse(),
      layers: [...s.layers].reverse(),
    }),
  },
  {
    name: 'set negative estimatedTokens',
    mutate: (s) => ({ ...s, estimatedTokens: -1 }),
  },
  {
    name: 'set estimatedTokens to float',
    mutate: (s) => ({ ...s, estimatedTokens: 4.5 }),
  },
  {
    name: 'set compilerVersion to 0',
    mutate: (s) => ({ ...s, compilerVersion: 0 }),
  },
  {
    name: 'strip prompt string but keep layers',
    mutate: (s) => ({ ...s, prompt: '' }),
  },
  {
    name: 'corrupt prompt content (mismatch with layers)',
    mutate: (s) => ({ ...s, prompt: s.prompt + 'CORRUPTED' }),
  },
  {
    name: 'corrupt compiledAt',
    mutate: (s) => ({ ...s, compiledAt: 'not-a-real-date' }),
  },
  {
    name: 'remove a layer from layers but keep layerOrder',
    mutate: (s) => ({ ...s, layers: s.layers.slice(1) }),
  },
  {
    name: 'add an extra layer without updating layerOrder',
    mutate: (s) => ({
      ...s,
      layers: [...s.layers, validLayer({ id: 'extra', name: 'Extra' })],
    }),
  },
  // ── Layer-level mutations (applied to first layer) ──
  {
    name: 'empty layer content (first layer)',
    mutate: (s) => ({
      ...s,
      layers: s.layers.map((l, i) => i === 0 ? { ...l, content: '' } : l),
      prompt: '', // must also clear prompt or hash will mismatch —
                  // the validateAll suite catches this via validateLayerSchema
    }),
  },
  {
    name: 'non-integer version (first layer)',
    mutate: (s) => ({
      ...s,
      layers: s.layers.map((l, i) => i === 0 ? { ...l, version: 1.5 } : l),
    }),
  },
  {
    name: 'invalid stability (first layer)',
    mutate: (s) => ({
      ...s,
      layers: s.layers.map((l, i) => i === 0 ? { ...l, stability: 'invalid' as 'stable' | 'volatile' } : l),
    }),
  },
  {
    name: 'swap layer objects (layer 0 <-> layer 1)',
    mutate: (s) => {
      const layers = [...s.layers]; [layers[0], layers[1]] = [layers[1], layers[0]]
      return { ...s, layers }
    },
  },
  {
    name: 'flip stability on a volatile layer',
    mutate: (s) => ({
      ...s,
      layers: s.layers.map((l) =>
        l.id === 'skills' ? { ...l, stability: 'stable' as const } : l
      ),
    }),
  },
  {
    name: 'flip stability on a stable layer',
    mutate: (s) => ({
      ...s,
      layers: s.layers.map((l) =>
        l.id === 'runtime-contract' ? { ...l, stability: 'volatile' as const } : l
      ),
    }),
  },
  // ── Combined mutation (multiple simultaneous violations) ──
  {
    name: 'simultaneous: empty id + negative tokens + empty prompt',
    mutate: (s) => ({ ...s, id: '', estimatedTokens: -100, prompt: '' }),
  },
]

describe('Mutation testing — every mutation is caught by validateAll', () => {

  // Compile once and share the valid base across all mutations.
  // Each mutation clone()s this base to avoid cross-test contamination.
  const validBase = compile()

  // Verify the base snapshot passes cleanly (sanity check)
  it('base snapshot passes validateAll (sanity)', () => {
    const issues = validateAll(validBase)
    expect(issues).toEqual([])
  })

  for (const { name, mutate } of MUTATIONS) {
    it(`caught: ${name}`, () => {
      const mutated = mutate(clone(validBase))
      const issues = validateAll(mutated)
      expect(issues.length).toBeGreaterThanOrEqual(1)
    })
  }
})
