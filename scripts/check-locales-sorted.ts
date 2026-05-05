#!/usr/bin/env bun
/**
 * check-locales-sorted.ts — verify every i18n locale file has keys sorted
 * alphabetically. Reports the first violation per file (matches the test in
 * `packages/shared/src/i18n/__tests__/locale-parity.test.ts`).
 *
 * If a file path argument is given, only that file is checked. Otherwise
 * every `packages/shared/src/i18n/locales/*.json` is scanned.
 *
 * Exit code: 0 if all sorted, 1 otherwise. Used by:
 *   - `bun run check:locales:sorted` (CLI / CI)
 *   - `scripts/lint-i18n-staged.sh` (pre-commit hook, when locale files are staged)
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES_DIR = 'packages/shared/src/i18n/locales'

const args = process.argv.slice(2)
const files =
  args.length > 0
    ? args
    : readdirSync(LOCALES_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(LOCALES_DIR, f))

const violations: string[] = []
for (const path of files) {
  const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
  const keys = Object.keys(data)
  const sorted = [...keys].sort()
  const idx = keys.findIndex((k, i) => k !== sorted[i])
  if (idx !== -1) {
    violations.push(`${path}: "${keys[idx]}" at index ${idx} should be "${sorted[idx]}"`)
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(v)
  console.error('\nFix: bun run sort:locales')
  process.exit(1)
}
