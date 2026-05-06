#!/usr/bin/env bun
/**
 * sort-locales.ts — Sort top-level keys alphabetically in every locale JSON.
 *
 * Convention enforced by `packages/shared/CLAUDE.md` § i18n Rules #7 and the
 * `locale-parity.test.ts` test. New keys appended to a file in any order get
 * normalized in-place. Run via `bun run sort-locales` (or `--check` in CI).
 *
 * Format: 2-space indent, trailing newline, no other transformations.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOCALES_DIR = resolve(
  import.meta.dir ?? new URL('.', import.meta.url).pathname,
  '..',
  'packages',
  'shared',
  'src',
  'i18n',
  'locales',
)

const checkOnly = process.argv.includes('--check')

const localeFiles = readdirSync(LOCALES_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

let drift = 0
for (const file of localeFiles) {
  const path = resolve(LOCALES_DIR, file)
  const original = readFileSync(path, 'utf-8')
  const parsed = JSON.parse(original) as Record<string, unknown>

  const sortedKeys = Object.keys(parsed).sort()
  const sorted: Record<string, unknown> = {}
  for (const key of sortedKeys) sorted[key] = parsed[key]

  const formatted = JSON.stringify(sorted, null, 2) + '\n'

  if (formatted === original) continue

  drift++
  if (checkOnly) {
    console.error(`drift: ${file} is not sorted`)
  } else {
    writeFileSync(path, formatted, 'utf-8')
    console.log(`sorted: ${file}`)
  }
}

if (checkOnly && drift > 0) {
  console.error(`\n${drift} locale file(s) out of order. Run \`bun run sort-locales\` to fix.`)
  process.exit(1)
}

if (!checkOnly && drift === 0) {
  console.log('all locale files already sorted')
}
