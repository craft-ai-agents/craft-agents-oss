/**
 * Unit tests for the env-sanitizer-audit ESLint rule.
 *
 * We bypass ESLint's RuleTester (it's Mocha-coupled) and drive the
 * rule via ESLint's `Linter` directly so the tests run cleanly under
 * bun:test.  Each `lint(code)` call exercises one snippet through the
 * rule with default options; we assert the messageId(s) returned.
 *
 * The rule should:
 *   - Flag every spawn/spawnSync/execFile/exec/Bun.spawn/Bun.spawnSync
 *     call whose `env` option references `process.env` directly or
 *     via spread, without first passing through `sanitizeChildProcessEnv`.
 *   - Allow callers that wrap the env through that helper.
 */

import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import envSanitizerAudit from '../env-sanitizer-audit.cjs'

function lint(code: string, options?: unknown[]) {
  const linter = new Linter()
  return linter.verify(code, {
    plugins: {
      'archstudio-process': {
        rules: {
          'env-sanitizer-audit': envSanitizerAudit as any,
        },
      },
    },
    rules: {
      'archstudio-process/env-sanitizer-audit': options
        ? (['error', ...options] as any)
        : 'error',
    },
    languageOptions: {
      parser: tsParser as any,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  })
}

const OK = '_' // marker for "expected to be allowed"
const FAIL_DIRECT = 'unsafeProcessEnvDirect'
const FAIL_SPREAD = 'unsafeProcessEnvSpread'

describe('env-sanitizer-audit', () => {
  it('allows calls wrapped in sanitizeChildProcessEnv', () => {
    expect(
      lint("Bun.spawn(['x'], { env: sanitizeChildProcessEnv(process.env) })"),
    ).toEqual([])
    expect(
      lint(
        "Bun.spawn(['x'], { env: sanitizeChildProcessEnv({ ...process.env, X: '1' }) })",
      ),
    ).toEqual([])
    expect(
      lint(
        "Bun.spawnSync(['x'], { env: sanitizeChildProcessEnv(process.env) })",
      ),
    ).toEqual([])
    expect(
      lint(
        "spawn('x', [], { env: sanitizeChildProcessEnv({ ...process.env }) })",
      ),
    ).toEqual([])
  })

  it('allows bun spawn calls that omit the env option entirely', () => {
    expect(lint("Bun.spawn(['x'])")).toEqual([])
    expect(lint("Bun.spawnSync(['x'])")).toEqual([])
  })

  it('allows env maps that do not reference process.env', () => {
    expect(lint("Bun.spawn(['x'], { env: { X: '1' } })")).toEqual([])
    expect(
      lint("spawn('x', [], { env: { ...fooEnv, X: '1' } })"),
    ).toEqual([])
  })

  it('allows a sanitizer wrapped around a non-process.env source', () => {
    expect(
      lint("Bun.spawn(['x'], { env: sanitizeChildProcessEnv(parentEnv) })"),
    ).toEqual([])
  })

  it('flags Bun.spawn with a direct process.env spread', () => {
    const errs = lint("Bun.spawn(['x'], { env: { ...process.env, X: '1' } })")
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL_SPREAD)
  })

  it('flags Bun.spawn with a bare spread', () => {
    const errs = lint("Bun.spawn(['x'], { env: { ...process.env } })")
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL_SPREAD)
  })

  it('flags Bun.spawn with `env: process.env` directly', () => {
    const errs = lint("Bun.spawn(['x'], { env: process.env })")
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL_DIRECT)
  })

  it('flags a TS-cast assignment of process.env to env', () => {
    const errs = lint(
      "Bun.spawn(['x'], { env: process.env as Record<string, string> })",
    )
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL_DIRECT)
  })

  it('flags Bun.spawnSync variants', () => {
    expect(
      lint("Bun.spawnSync(['x'], { env: { ...process.env } })")[0]?.messageId,
    ).toBe(FAIL_SPREAD)
    expect(
      lint("Bun.spawnSync(['x'], { env: process.env })")[0]?.messageId,
    ).toBe(FAIL_DIRECT)
  })

  it('flags node:child_process `spawn` (two-arg form)', () => {
    expect(
      lint("spawn('x', { env: { ...process.env } })")[0]?.messageId,
    ).toBe(FAIL_SPREAD)
  })

  it('flags node:child_process `spawn` / `spawnSync` (three-arg form)', () => {
    expect(
      lint(
        "spawnSync('x', ['--flag'], { env: { ...process.env, ARCHSTUDIO_X: '1' } })",
      )[0]?.messageId,
    ).toBe(FAIL_SPREAD)
    expect(
      lint("spawnSync('x', ['--flag'], { env: process.env })")[0]?.messageId,
    ).toBe(FAIL_DIRECT)
  })

  it('flags exec and execFile variants', () => {
    expect(
      lint("execFile('x', [], { env: { ...process.env } })")[0]?.messageId,
    ).toBe(FAIL_SPREAD)
    expect(
      lint("exec('x --flag', { env: { ...process.env } })")[0]?.messageId,
    ).toBe(FAIL_SPREAD)
  })

  it('flags locally aliased `processEnv` spreads (the refactor shape)', () => {
    const code =
      "const processEnv = process.env; Bun.spawn(['x'], { env: { ...processEnv } })"
    expect(lint(code)[0]?.messageId).toBe(FAIL_SPREAD)
  })

  it('does not flag non-spawn calls named `process`', () => {
    expect(lint("foo({ env: { ...process.env } })")).toEqual([])
  })

  it('honors `allowedSanitizers` rule option', () => {
    // Whitelist-cleanEnv only — sanitizeChildProcessEnv is rejected.
    const code1 = "Bun.spawn(['x'], { env: cleanEnv() })"
    const code2 = "Bun.spawn(['x'], { env: sanitizeChildProcessEnv(process.env) })"
    expect(lint(code1, [{ allowedSanitizers: ['cleanEnv'] }])).toEqual([])
    expect(
      lint(code2, [{ allowedSanitizers: ['cleanEnv'] }])[0]?.messageId,
    ).toBe(FAIL_DIRECT)
  })

  it('only-fires-when-prefixed-by-Bun OR a tracked child_process name', () => {
    // `.spawn` on some other namespace is not our concern unless the
    // user opts in via `additionalCallNames`.
    expect(lint("CustomNamespace.spawn(['x'], { env: { ...process.env } })")).toEqual([])
    expect(
      lint(
        "CustomNamespace.spawn(['x'], { env: { ...process.env } })",
        [{ additionalCallNames: ['spawn'] }],
      )[0]?.messageId,
    ).toBe(FAIL_SPREAD)
  })
})
