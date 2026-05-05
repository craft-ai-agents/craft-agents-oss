#!/usr/bin/env bun
/**
 * sort-locales.ts — re-emit every i18n locale file with keys sorted
 * alphabetically.
 *
 * `JSON.parse → Object.keys().sort() → JSON.stringify(data, null, 2) + '\n'`
 * round-trips byte-cleanly: no escape-encoding drift, no indentation drift.
 * Diffs are limited to key reordering.
 *
 * Run from repo root: `bun run sort:locales`.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES_DIR = 'packages/shared/src/i18n/locales'

let touched = 0
for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'))) {
  const path = join(LOCALES_DIR, file)
  const raw = readFileSync(path, 'utf-8')
  const data = JSON.parse(raw) as Record<string, string>
  const sorted = Object.fromEntries(
    Object.keys(data)
      .sort()
      .map((k) => [k, data[k]] as const),
  )
  const out = `${JSON.stringify(sorted, null, 2)}\n`
  if (out !== raw) {
    writeFileSync(path, out)
    touched++
    console.log(`sorted ${file}`)
  }
}

console.log(touched === 0 ? 'all locales already sorted' : `${touched} file(s) re-sorted`)
