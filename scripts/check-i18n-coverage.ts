#!/usr/bin/env bun
/**
 * Verifies literal translation keys referenced by application source files
 * exist in the canonical English locale. Dynamic keys are intentionally
 * ignored because their possible values cannot be proven statically.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const EN_LOCALE_PATH = resolve(ROOT, 'packages/shared/src/i18n/locales/en.json')
const SOURCE_ROOTS = [resolve(ROOT, 'apps'), resolve(ROOT, 'packages')]
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const TRANSLATION_CALL = /(?:\bt|\bi18n\.t)\(\s*(['"])([^'"\r\n]+)\1/g

const localeKeys = new Set(Object.keys(JSON.parse(readFileSync(EN_LOCALE_PATH, 'utf-8')) as Record<string, string>))
const missing = new Map<string, Set<string>>()
let checkedCalls = 0

function scanDirectory(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      scanDirectory(path)
      continue
    }
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue

    const source = readFileSync(path, 'utf-8')
    // Avoid treating unrelated local functions named `t` as translations.
    if (!/(?:useTranslation|getFixedT|\bi18n\.t\s*\()/.test(source)) continue

    for (const match of source.matchAll(TRANSLATION_CALL)) {
      const key = match[2]!
      checkedCalls += 1
      const hasPluralVariants = localeKeys.has(`${key}_one`) && localeKeys.has(`${key}_other`)
      if (localeKeys.has(key) || hasPluralVariants) continue
      const relativePath = path.slice(ROOT.length + 1)
      const paths = missing.get(key) ?? new Set<string>()
      paths.add(relativePath)
      missing.set(key, paths)
    }
  }
}

for (const sourceRoot of SOURCE_ROOTS) scanDirectory(sourceRoot)

if (missing.size > 0) {
  console.error(`i18n coverage failed: ${missing.size} referenced literal key(s) are missing from en.json`)
  for (const [key, paths] of [...missing.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    console.error(`  ${key}: ${[...paths].sort().join(', ')}`)
  }
  process.exit(1)
}

console.log(`i18n coverage OK (${checkedCalls} literal translation calls checked against ${localeKeys.size} keys)`)
