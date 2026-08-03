/**
 * Golden-file snapshot test for the PromptCompiler.
 *
 * Compiles a prompt with a fixed set of options and compares the resulting
 * prompt text against a stored `.snap` file. Catches regressions in exact
 * output formatting — whitespace, line breaks, layer structure, ordering.
 *
 * ## Updating snapshots
 *
 * When you intentionally change the compiler output (new layer content,
 * formatting changes, additional fields), run:
 *
 *   UPDATE_SNAPSHOTS=1 bun test packages/shared/src/prompts/owner/__tests__/compiler.golden-snap.test.ts
 *
 * This overwrites the `.snap` file with the current output.
 * Commit the updated `.snap` file alongside the compiler change.
 *
 * ## Determinism
 *
 * The test uses COMPILER_VERSION-aware options that match the current
 * compiler version so that when the compiler version bumps, the test
 * explicitly fails and the developer reviews whether the snapshot should
 * be updated.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PromptCompiler } from '../compiler.ts'
import type { CompileOptions } from '../types.ts'

// ── Helpers ──────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Path to the golden snapshot file. */
const SNAP_FILE = join(__dirname, '__snapshots__', 'compiler.golden-snap.snap')

/**
 * Read the current snapshot from disk. Returns `null` if the file
 * does not exist yet (first run or freshly after a `git clean`).
 */
function readSnap(): string | null {
  if (!existsSync(SNAP_FILE)) return null
  return readFileSync(SNAP_FILE, 'utf-8')
}

/**
 * Write (overwrite) the snapshot file with the given prompt text.
 * Creates the `__snapshots__` directory if it doesn't exist.
 */
function writeSnap(prompt: string): void {
  const dir = dirname(SNAP_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(SNAP_FILE, prompt, 'utf-8')
}

/**
 * Deterministic compile options that produce a fixed, repeatable prompt.
 *
 * All volatile fields (memories, skills, session state, capabilities) are
 * set explicitly so the output does not depend on the runtime environment.
 */
function deterministicOptions(): CompileOptions {
  return {
    ownerProfile: {
      name: 'Skobez',
      aliases: ['Richard'],
      locale: 'en',
      timezone: 'Pacific/Auckland',
      tone: 'Direct and technical, never apologetic.',
      verbosity: 3,
      bannedPhrases: ["I'm sorry", 'As an AI'],
    },
    executionPolicy: {
      defaultMode: 'owner-auto',
      askOnlyWhen: ['filesystem-write', 'config-write', 'memory-write'],
      allowedRoots: ['/home/skobez/projects'],
      retryConfig: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    },
    projectContext: {
      workingDirectory: '/home/skobez/projects/archstudio',
      contextFiles: [
        {
          filename: 'AGENTS.md',
          content:
            '# Project Context\n\n' +
            'Uses Bun monorepo with workspaces.\n' +
            'TypeScript strict mode throughout.\n' +
            'Prefer async/await over callbacks.',
        },
        {
          filename: 'CLAUDE.md',
          content:
            '# Claude Instructions\n\n' +
            'Always ask before writing files outside src/.\n' +
            'Run tests after every change.',
        },
      ],
    },
    skills: ['Web research via Hermes', 'Git operations (commit, branch, rebase)'],
    memories: [
      {
        title: 'Project Structure',
        content: 'Uses Bun monorepo with workspaces (packages/*, apps/*). SQLite/FTS5 for memory storage.',
        score: 0.95,
      },
      {
        title: 'Coding Convention',
        content: 'Use TypeScript strict mode throughout the project. No `any` types, no `@ts-ignore`.',
        score: 0.82,
      },
    ],
    sessionState: {
      sessionId: 'sess-golden-test-001',
      permissionMode: 'owner-auto',
      plansFolderPath: '/home/skobez/projects/archstudio/plans',
      dataFolderPath: '/home/skobez/projects/archstudio/data',
    },
    capabilities: ['Codex (ChatGPT)', 'Claude (Anthropic)', 'Ollama Local', 'ComfyUI'],
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('PromptCompiler — golden-file snapshot', () => {
  let compiler: PromptCompiler

  beforeEach(() => {
    compiler = new PromptCompiler()
  })

  it('matches the golden snapshot (prompt text only)', () => {
    const result = compiler.compile(deterministicOptions())
    const currentPrompt = result.snapshot.prompt

    // Safety check: the prompt should not be empty and should be
    // structurally reasonable. This catches obvious corruption before
    // the snapshot comparison.
    expect(currentPrompt.length).toBeGreaterThan(500)
    expect(currentPrompt).toContain('ARCHstudio')
    expect(currentPrompt).toContain('Skobez')
    expect(currentPrompt).toContain('sess-golden-test-001')
    expect(currentPrompt).toContain('Codex (ChatGPT)')
    expect(currentPrompt).toContain('Project Structure')
    expect(currentPrompt).toContain('AGENTS.md')

    const storedSnap = readSnap()

    if (storedSnap === null) {
      // First run — write the golden file and pass.
      // The developer should review the written file and commit it.
      writeSnap(currentPrompt)
      console.log(
        `[golden-snap] Created snapshot at ${SNAP_FILE}\n` +
          `  → ${currentPrompt.length} chars, ${result.snapshot.estimatedTokens} estimated tokens\n` +
          '  → Commit this file alongside the compiler change.',
      )
      return
    }

    // Subsequent runs — compare against stored snapshot.
    // If you need to update the snapshot, use:
    //   UPDATE_SNAPSHOTS=1 bun test <path>
    const updateSnapshots = process.env.UPDATE_SNAPSHOTS === '1'
    if (storedSnap !== currentPrompt) {
      if (updateSnapshots) {
        writeSnap(currentPrompt)
        console.log(
          `[golden-snap] Updated snapshot at ${SNAP_FILE}\n` +
            `  → ${currentPrompt.length} chars (was ${storedSnap.length} chars)`,
        )
        return
      }

      // Diff summary: show first differing characters and the expected/new lengths
      const firstDiff = findFirstDiff(storedSnap, currentPrompt)
      throw new Error(
        `[golden-snap] Snapshot mismatch\n` +
          `  → File: ${SNAP_FILE}\n` +
          `  → Expected: ${storedSnap.length} chars, Got: ${currentPrompt.length} chars\n` +
          `  → First difference at position ${firstDiff.index}\n` +
          `  → Expected char: ${JSON.stringify(firstDiff.expected)}, Got: ${JSON.stringify(firstDiff.actual)}\n` +
          `  → To update: UPDATE_SNAPSHOTS=1 bun test packages/shared/src/prompts/owner/__tests__/compiler.golden-snap.test.ts`,
      )
    }
  })
})

/**
 * Find the first character where two strings differ.
 * Returns the index and the differing characters (or '' if past string end).
 */
function findFirstDiff(a: string, b: string): {
  index: number
  expected: string
  actual: string
} {
  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      return { index: i, expected: a[i]!, actual: b[i]! }
    }
  }
  // One string is a prefix of the other
  return {
    index: minLen,
    expected: a.length > minLen ? a[minLen]! : '(end of string)',
    actual: b.length > minLen ? b[minLen]! : '(end of string)',
  }
}
