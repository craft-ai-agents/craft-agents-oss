#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — CI-safe translation key coverage check.
 *
 * Scans TypeScript/TSX source for literal translation keys in `t(...)`,
 * `i18n.t(...)`, and Trans `i18nKey` callsites, then verifies those keys
 * resolve against the English locale. Dynamic keys are intentionally
 * skipped because they cannot be proven statically.
 */

import { readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const LOCALES_DIR = resolve(REPO_ROOT, 'packages', 'shared', 'src', 'i18n', 'locales')
const EN_LOCALE_PATH = resolve(LOCALES_DIR, 'en.json')

const SOURCE_ROOTS = ['apps', 'packages', 'scripts']
const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other']

type Locale = Record<string, string>
type Reference = {
  kind: 't' | 'i18n.t' | 'Trans'
  key: string
  file: string
  line: number
  column: number
}

const en = JSON.parse(readFileSync(EN_LOCALE_PATH, 'utf-8')) as Locale
const enKeys = new Set(Object.keys(en))

const sourceFiles = SOURCE_ROOTS.flatMap(root => collectSourceFiles(resolve(REPO_ROOT, root)))
  .sort((a, b) => a.localeCompare(b))

const references = sourceFiles.flatMap(file => extractReferences(file))
const missing = references.filter(ref => !hasLocaleKey(ref.key))

if (missing.length > 0) {
  console.error('i18n coverage check failed:')
  for (const ref of missing) {
    console.error(
      `  ${ref.file}:${ref.line}:${ref.column} ${ref.kind}("${ref.key}") is missing from packages/shared/src/i18n/locales/en.json`,
    )
  }
  console.error(`\n${missing.length} missing translation reference(s).`)
  process.exit(1)
}

const uniqueKeys = new Set(references.map(ref => ref.key))
console.log(
  `i18n coverage OK (${references.length} literal references, ${uniqueKeys.size} unique keys, ${enKeys.size} English keys)`,
)

function collectSourceFiles(dir: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) files.push(...collectSourceFiles(path))
      continue
    }

    if (!entry.isFile()) continue
    if (basename(entry.name).endsWith('.d.ts')) continue
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue
    files.push(path)
  }

  return files
}

function extractReferences(file: string): Reference[] {
  const source = readFileSync(file, 'utf-8')
  const relFile = relative(REPO_ROOT, file)
  const refs: Reference[] = []

  const patterns: Array<{ kind: Reference['kind']; regex: RegExp }> = [
    { kind: 'i18n.t', regex: /(?<![\w$])i18n\.t\s*\(\s*'((?:\\.|[^'\\])*)'/g },
    { kind: 'i18n.t', regex: /(?<![\w$])i18n\.t\s*\(\s*"((?:\\.|[^"\\])*)"/g },
    { kind: 't', regex: /(?<![\w$.])t\s*\(\s*'((?:\\.|[^'\\])*)'/g },
    { kind: 't', regex: /(?<![\w$.])t\s*\(\s*"((?:\\.|[^"\\])*)"/g },
    { kind: 'Trans', regex: /<Trans\b[^>]*\bi18nKey\s*=\s*'((?:\\.|[^'\\])*)'/g },
    { kind: 'Trans', regex: /<Trans\b[^>]*\bi18nKey\s*=\s*"((?:\\.|[^"\\])*)"/g },
  ]

  for (const { kind, regex } of patterns) {
    for (const match of source.matchAll(regex)) {
      const rawKey = match[1]
      if (!rawKey) continue
      const key = unescapeStringLiteral(rawKey)
      const position = lineAndColumn(source, match.index ?? 0)
      refs.push({ kind, key, file: relFile, ...position })
    }
  }

  return refs.sort((a, b) => a.line - b.line || a.column - b.column || a.key.localeCompare(b.key))
}

function hasLocaleKey(key: string): boolean {
  if (enKeys.has(key)) return true
  return PLURAL_SUFFIXES.some(suffix => enKeys.has(`${key}_${suffix}`))
}

function lineAndColumn(source: string, index: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: index - lineStart + 1 }
}

function unescapeStringLiteral(value: string): string {
  return value.replace(/\\(['"\\bfnrtv])/g, (_match, char: string) => {
    switch (char) {
      case 'b': return '\b'
      case 'f': return '\f'
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      case 'v': return '\v'
      default: return char
    }
  })
}
