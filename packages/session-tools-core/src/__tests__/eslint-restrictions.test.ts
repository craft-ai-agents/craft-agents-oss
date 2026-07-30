/**
 * eslint-restrictions.test.ts
 *
 * Positive test for the no-restricted-imports ESLint rules in
 * session-tools-core.  Creates temporary fixture files with known
 * violations and verifies that ESLint flags each one with the
 * expected error message.
 *
 * If a future refactor removes or relaxes the restriction rules,
 * this test fails — surfacing the drift before a contributor
 * accidentally pulls in a renderer dependency.
 *
 * Uses bun:test + Bun.spawnSync (no ESLint Node API dependency).
 *
 * Fixtures are created inside src/__tests__/__eslint-fixtures__/ so
 * they match the ESLint config's `files: ['src/**\/*.{ts,tsx}']`
 * pattern.  The directory is cleaned up in afterAll.
 */

import { describe, it, expect, afterAll } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dir, '__eslint-fixtures__')
const ESLINT_CONFIG = join(import.meta.dir, '../../eslint.config.mjs')

if (!existsSync(ESLINT_CONFIG)) {
  throw new Error(
    `ESLint config not found at ${ESLINT_CONFIG}. ` +
      'This test must run from the packages/session-tools-core directory.',
  )
}

// Ensure the fixtures directory exists.
mkdirSync(FIXTURES_DIR, { recursive: true })

afterAll(() => {
  if (existsSync(FIXTURES_DIR)) {
    rmSync(FIXTURES_DIR, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a fixture file, run ESLint on it, and return { exitCode, output }.
 * The fixture file is placed in FIXTURES_DIR and cleaned up after each call.
 * Each call uses a unique filename so concurrent runs don't collide.
 *
 * ESLint's flat config outputs violation messages to **stdout** (not stderr).
 * Both stdout and stderr are merged via `2>&1` for robust detection.
 */
function runEslintOnFixture(
  content: string,
  label: string,
): { exitCode: number | null; output: string } {
  const fixturePath = join(FIXTURES_DIR, `${label}.ts`)
  writeFileSync(fixturePath, content, 'utf-8')

  const result = Bun.spawnSync({
    cmd: [
      'npx',
      '--no-install',
      'eslint',
      '--config',
      ESLINT_CONFIG,
      '--format',
      'stylish',
      fixturePath,
    ],
    cwd: join(import.meta.dir, '../..'),
    env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'true' },
  })

  // Merge stdout + stderr — ESLint 9 writes violations to stdout on
  // some platforms and stderr on others.
  const output =
    result.stdout.toString() +
    (result.stderr.length > 0 ? '\n' + result.stderr.toString() : '')

  return {
    exitCode: result.exitCode,
    output,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ESLint no-restricted-imports', () => {
  it('blocks @craft-agent/core with the expected message', () => {
    const { exitCode, output } = runEslintOnFixture(
      `import type {} from '@craft-agent/core'\n`,
      'blocked-core',
    )
    expect(exitCode).toBe(1)
    expect(output).toContain('@craft-agent/core')
    expect(output).toContain('no-restricted-imports')
  })

  it('blocks @craft-agent/ui with the expected message', () => {
    const { exitCode, output } = runEslintOnFixture(
      `import type {} from '@craft-agent/ui'\n`,
      'blocked-ui',
    )
    expect(exitCode).toBe(1)
    expect(output).toContain('@craft-agent/ui')
    expect(output).toContain('no-restricted-imports')
  })

  it('blocks react with the expected message', () => {
    const { exitCode, output } = runEslintOnFixture(
      `import { useState } from 'react'\n`,
      'blocked-react',
    )
    expect(exitCode).toBe(1)
    expect(output).toContain('react')
    expect(output).toContain('no-restricted-imports')
  })

  it('blocks react-dom with the expected message', () => {
    const { exitCode, output } = runEslintOnFixture(
      `import { render } from 'react-dom'\n`,
      'blocked-react-dom',
    )
    expect(exitCode).toBe(1)
    expect(output).toContain('react-dom')
    expect(output).toContain('no-restricted-imports')
  })

  it('allows permitted imports (no false positives)', () => {
    // Guard against the test itself growing stale — if each permitted dep
    // import passes, the rule is not overreaching.
    //
    // All four fixtures are combined into a single file so ESLint runs
    // once, avoiding sequential-process overhead that can cause hangs.
    const combinedContent = [
      `import { z } from 'zod'`,
      `import type { Context } from '../context.ts'`,
      `import type {} from '@craft-agent/shared'`,
      `import { parse } from 'path'`,
    ].join('\n') + '\n'

    const { exitCode, output } = runEslintOnFixture(combinedContent, 'perm-combined')
    expect(exitCode).toBe(0)
  })
})
