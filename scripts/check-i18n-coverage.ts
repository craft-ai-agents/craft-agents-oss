#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — CI-safe i18n callsite coverage check.
 *
 * Verifies that every statically-known translation key referenced from code
 * exists in packages/shared/src/i18n/locales/en.json.
 *
 * This intentionally checks only literal keys. Dynamic expressions such as
 * `t(`status.${id}`)` are skipped because they are validated at runtime by
 * i18next's missing-key warnings and often map to user-defined identifiers.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const EN_LOCALE_PATH = resolve(REPO_ROOT, 'packages', 'shared', 'src', 'i18n', 'locales', 'en.json')

const SCAN_ROOTS = ['apps', 'packages', 'scripts']
const CODE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.vite',
])

const en = JSON.parse(readFileSync(EN_LOCALE_PATH, 'utf-8')) as Record<string, string>
const enKeys = new Set(Object.keys(en))

type Reference = {
  key: string
  file: string
  line: number
  column: number
  kind: string
}

function isCodeFile(path: string): boolean {
  for (const extension of CODE_EXTENSIONS) {
    if (path.endsWith(extension)) return true
  }
  return false
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      yield* walk(path)
    } else if (stat.isFile() && isCodeFile(path)) {
      yield path
    }
  }
}

function lineColumn(source: string, index: number): { line: number; column: number } {
  let line = 1
  let lastLineStart = 0
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++
      lastLineStart = i + 1
    }
  }
  return { line, column: index - lastLineStart + 1 }
}

function isStaticKey(key: string): boolean {
  // Locale keys are flat dotted identifiers. Skipping non-dotted strings avoids
  // false positives for unrelated helpers named `t` in tests or libraries.
  return key.includes('.') && !key.includes('${')
}

function collectReferences(file: string): Reference[] {
  const source = readFileSync(file, 'utf-8')
  const rel = relative(REPO_ROOT, file)
  const refs: Reference[] = []

  const patterns: Array<{ kind: string; regex: RegExp; keyGroup: number }> = [
    // t('key'), t("key"), i18n.t('key'), i18next.t('key')
    { kind: 't()', regex: /\b(?:i18n|i18next)?\.?t\(\s*(['"])([^'"`]+)\1/g, keyGroup: 2 },
    // <Trans i18nKey="key" />
    { kind: 'i18nKey', regex: /\bi18nKey\s*=\s*(['"])([^'"]+)\1/g, keyGroup: 2 },
    // <Trans i18nKey={'key'} />
    { kind: 'i18nKey', regex: /\bi18nKey\s*=\s*\{\s*(['"])([^'"]+)\1\s*\}/g, keyGroup: 2 },
  ]

  for (const { kind, regex, keyGroup } of patterns) {
    for (const match of source.matchAll(regex)) {
      const key = match[keyGroup]
      if (!key || !isStaticKey(key)) continue
      const { line, column } = lineColumn(source, match.index ?? 0)
      refs.push({ key, file: rel, line, column, kind })
    }
  }

  return refs
}

const references: Reference[] = []
for (const root of SCAN_ROOTS) {
  const path = resolve(REPO_ROOT, root)
  try {
    if (statSync(path).isDirectory()) {
      for (const file of walk(path)) references.push(...collectReferences(file))
    }
  } catch {
    // Optional scan root absent in some checkouts.
  }
}

function hasLocaleKey(key: string): boolean {
  if (enKeys.has(key)) return true
  // i18next pluralization callsites use the base key with `{ count }`, while
  // locale files store the concrete plural forms. Treat the base key as
  // covered when the required English plural pair exists.
  return enKeys.has(`${key}_one`) && enKeys.has(`${key}_other`)
}

const missing = references.filter((ref) => !hasLocaleKey(ref.key))

if (missing.length) {
  console.error('i18n coverage check failed:')
  for (const ref of missing) {
    console.error(`  ${ref.file}:${ref.line}:${ref.column} ${ref.kind} references missing key "${ref.key}"`)
  }
  console.error(`\n${missing.length} missing i18n key reference(s).`)
  process.exit(1)
}

const uniqueKeys = new Set(references.map((ref) => ref.key))
console.log(`i18n coverage OK (${uniqueKeys.size} static keys referenced, ${enKeys.size} keys available)`)
