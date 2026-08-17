#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — Validate every `t('...')` callsite resolves to a
 * key in en.json.
 *
 * Catches the failure mode the locale parity check cannot detect:
 *   - merge-conflict resolutions that drop keys symmetrically across locales
 *   - manual en.json edits that miss a referenced key
 *   - renamed keys with stragglers in source code
 *
 * Scans `apps/{electron,viewer,webui}/src` and `packages/{shared,ui}/src` for
 * literal-string i18n key references and asserts each exists in en.json.
 * Plural-aware: a reference to `foo.bar` is satisfied when either `foo.bar`
 * or both `foo.bar_one` + `foo.bar_other` exist (i18next selects at runtime).
 *
 * Dynamic keys (`t(\`status.${id}\`)`, `t(variable)`) are skipped silently —
 * those surface via i18next's runtime missing-key warnings, not static check.
 *
 * Exit 0 when all references resolve; 1 with a diagnostic otherwise.
 *
 * Pass --all to print every missing reference (default truncates to 20).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const EN_PATH = join(ROOT, 'packages/shared/src/i18n/locales/en.json')

const SCAN_DIRS = [
  'apps/electron/src',
  'apps/viewer/src',
  'apps/webui/src',
  'packages/shared/src',
  'packages/ui/src',
]

const EXCLUDE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '__tests__',
  'playground',
  'registry',
])

const EXCLUDE_FILE_PATTERNS = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /\.d\.ts$/]

const SOURCE_EXT = /\.(?:ts|tsx)$/

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/

type Reference = { file: string; line: number; key: string }

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (EXCLUDE_DIR_NAMES.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, out)
      continue
    }
    if (!SOURCE_EXT.test(name)) continue
    if (EXCLUDE_FILE_PATTERNS.some((p) => p.test(name))) continue
    out.push(full)
  }
  return out
}

const KEY_PATTERNS: RegExp[] = [
  // t('key') / t("key") — bare call. Negative lookbehind avoids matching
  // `.t(` (handled separately) and identifiers ending in t (e.g. `cat`).
  /(?<![A-Za-z0-9_$.])t\(\s*(['"])([^'"`\\\n]+)\1/g,
  // i18n.t('key') / i18next.t('key')
  /\bi18n(?:ext)?\.t\(\s*(['"])([^'"`\\\n]+)\1/g,
  // <Trans i18nKey="key" /> — JSX prop
  /\bi18nKey\s*=\s*(['"])([^'"`\\\n]+)\1/g,
]

function extractRefs(file: string, content: string): Reference[] {
  const refs: Reference[] = []
  for (const pattern of KEY_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const key = match[2]
      if (!key) continue
      // Compute line number from match index. Cheap enough for our scale.
      const line = content.slice(0, match.index).split('\n').length
      refs.push({ file, line, key })
    }
  }
  return refs
}

function isResolved(key: string, enKeys: Set<string>): boolean {
  if (enKeys.has(key)) return true
  // Plural lookup: callsites pass the base key; en.json holds suffixed forms.
  if (enKeys.has(`${key}_one`) && enKeys.has(`${key}_other`)) return true
  // Some callsites pass an already-suffixed key (e.g. `pending.attempts_one`);
  // accept those when the suffixed form exists directly. The first branch
  // already handles that, so this is a no-op — but document the case.
  if (PLURAL_SUFFIX.test(key) && enKeys.has(key)) return true
  return false
}

function main(): void {
  const en = JSON.parse(readFileSync(EN_PATH, 'utf-8')) as Record<string, string>
  const enKeys = new Set(Object.keys(en))

  const files: string[] = []
  for (const dir of SCAN_DIRS) {
    walk(join(ROOT, dir), files)
  }

  const missing: Reference[] = []
  let totalRefs = 0
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const refs = extractRefs(file, content)
    totalRefs += refs.length
    for (const ref of refs) {
      if (!isResolved(ref.key, enKeys)) missing.push(ref)
    }
  }

  if (missing.length === 0) {
    console.log(
      `i18n coverage OK (${totalRefs} references across ${files.length} files, ${enKeys.size} en keys)`,
    )
    return
  }

  // De-dupe by key for the summary; show file:line for the first occurrence
  // of each missing key.
  const firstByKey = new Map<string, Reference>()
  for (const m of missing) {
    if (!firstByKey.has(m.key)) firstByKey.set(m.key, m)
  }

  const showAll = process.argv.includes('--all')
  const items = [...firstByKey.values()]
  const limit = showAll ? items.length : Math.min(20, items.length)

  console.error(`i18n coverage check failed: ${firstByKey.size} missing keys`)
  console.error('')
  for (let i = 0; i < limit; i++) {
    const m = items[i]!
    console.error(`${relative(ROOT, m.file)}:${m.line}`)
    console.error(`  → ${m.key}`)
    console.error('')
  }
  if (!showAll && items.length > limit) {
    console.error(`… (truncated to first ${limit}; run with --all to see all)`)
    console.error('')
  }
  console.error('Fix: add the missing keys to packages/shared/src/i18n/locales/en.json,')
  console.error('     then run [skill:localize-agents] (or manual translation) for the')
  console.error('     other locales, and re-run `bun run lint:i18n:parity`.')
  process.exit(1)
}

main()
