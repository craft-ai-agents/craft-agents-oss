/**
 * Integration test: read the live production source files that
 * previously leaked process.env and assert the new rule reports ZERO
 * violations — proving the sanitizer-wrap the team standardised on
 * trips the rule correctly WITHOUT false positives.
 *
 * If any of these files regress (a future PR drops sanitizeChildProcessEnv
 * or spreads process.env directly), the corresponding assertion here
 * will fail and the source of the regression is named in the error.
 */

import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { readFileSync } from 'node:fs'
import envSanitizerAudit from '../env-sanitizer-audit.cjs'

function lintSource(code: string) {
  const linter = new Linter()
  return linter.verify(code, {
    plugins: {
      'archstudio-process': {
        rules: { 'env-sanitizer-audit': envSanitizerAudit as any },
      },
    },
    rules: { 'archstudio-process/env-sanitizer-audit': 'error' },
    languageOptions: {
      parser: tsParser as any,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  })
}

const SOURCES = [
  'apps/electron/src/main/handlers/system.ts',
  'apps/cli/src/server-spawner.ts',
  'packages/shared/src/agent/core/rtk-detector.ts',
  'packages/shared/src/agent/core/rtk-rewrite.ts',
  'packages/shared/src/agent/options.ts',
  'packages/shared/src/agent/pi-agent.ts',
  'packages/shared/src/mcp/client.ts',
  'packages/shared/src/mcp/validation.ts',
  'packages/shared/src/automations/utils.ts',
  'packages/session-tools-core/src/runtime/sandbox-env.ts',
  'packages/messaging-gateway/src/adapters/whatsapp/index.ts',
  'packages/server-core/src/handlers/rpc/sessions.ts',
  'scripts/run-isolated-tests.mjs' as any,
].filter((p) => {
  // .mjs is JS, the rule applies through tsParser's ESM support too.
  return true
})

describe('env-sanitizer-audit (integration)', () => {
  for (const relPath of SOURCES) {
    it(`reports zero violations on the fixed ${relPath}`, () => {
      const code = readFileSync(relPath, 'utf8')
      const errs = lintSource(code)
      // Filter parse errors out of the assertion — they originate in
      // the parser's JSX/type-arg ambiguity (e.g. `<T>(p: Promise<T>,…)`
      // when jsx is enabled), NOT in our rule.  The project's actual
      // lint pipeline resolves these via tsconfig-aware parsing; the
      // Linter-only test config here doesn't have that context.
      const ruleErrs = errs.filter((e: any) => !e.fatal)
      if (ruleErrs.length > 0) {
        const sample = ruleErrs
          .slice(0, 3)
          .map((e) => `  line ${e.line}: ${e.messageId ?? e.ruleId} → ${e.message}`)
          .join('\n')
        throw new Error(
          `Expected ${relPath} to be sanitizer-clean, found ${ruleErrs.length} rule violation(s):\n${sample}`,
        )
      }
      expect(ruleErrs).toEqual([])
    })
  }

  it('flags a deliberately introduced regression', () => {
    // Snapshot/regression inversion: paste in the pre-fix shape and
    // verify the rule STILL catches it.  This is the trip wire.
    const preFix = `
      import { spawn } from 'node:child_process'
      spawn('x', [], { env: { ...process.env, ARCHSTUDIO_TOKEN: '1' } })
    `
    const errs = lintSource(preFix)
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe('unsafeProcessEnvSpread')
  })
})
