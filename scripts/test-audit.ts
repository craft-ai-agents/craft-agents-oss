#!/usr/bin/env bun
//
// scripts/test-audit.ts
//
// Reactive test-discovery lint.  Uses Bun.Glob to discover every
// *.test.{ts,tsx} file the runner would load, applies the same
// pathIgnorePatterns from bunfig.toml that `bun test` uses, and
// then asserts each surviving path lives in a *canonical* location:
//
//   apps/<pkg>/src/.../__tests__/<name>.test.tsx
//   apps/<pkg>/src/.../<name>.test.tsx          (colocated)
//   apps/<pkg>/eslint-rules/__tests__/<name>.test.tsx
//   packages/<pkg>/src/.../__tests__/<name>.test.tsx
//   packages/<pkg>/src/.../<name>.test.tsx      (colocated)
//   packages/<pkg>/tests/<name>.test.tsx
//   packages/<pkg>/eslint-rules/__tests__/<name>.test.tsx
//   scripts/<name>.test.tsx
//
// Anything outside those patterns (e.g. a test living directly in
// release/, dist/, node_modules/, or a new package that puts tests
// in the wrong place) causes a non-zero exit.
//
// The script is intentionally self-contained — it re-reads
// bunfig.toml instead of importing other scripts so it can run in
// CI without module-resolution surprises.
//
// Pair with pathIgnorePatterns so contributors know the rule is
// codified, not hidden in an implicit bun config.
//
// Usage:
//   bun run test:audit            # check + print, exit 1 on violations
//   bun run test:audit --json     # machine-readable output

import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Constants ──────────────────────────────────────────────────────

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const BUNFIG = resolve(ROOT, 'bunfig.toml')

// Canonical test-file locations (POSIX-style, forward slashes).
// A path is valid if it matches ANY of these regexes.
//
// NOTE: We use // line comments (not JSDoc /** */) because glob
// patterns like __tests__/*.test.tsx contain the literal "*/"
// sequence which Bun's parser treats as a block-comment close.
const CANONICAL_PATTERNS: RegExp[] = [
  // ── __tests__/ colocated under src ────────────────────────────────
  // apps/<pkg>/src/**/__tests__/<name>.test.tsx?
  // packages/<pkg>/src/**/__tests__/<name>.test.tsx?
  /^(apps|packages)\/[^/]+\/src\/.*__tests__\/.*\.test\.tsx?$/,

  // ── eslint-rules/__tests__/ under apps or packages ────────────────
  // packages/ui/eslint-rules/__tests__/no-hardcoded-z-index.test.ts
  // apps/electron/eslint-rules/__tests__/no-hardcoded-z-index.test.ts
  /^(apps|packages)\/[^/]+\/eslint-rules\/__tests__\/.*\.test\.tsx?$/,

  // ── Colocated in src (no __tests__ subdirectory) ──────────────────
  // packages/shared/src/tasks/schema.test.ts
  // packages/session-tools-core/src/validation.test.ts
  // apps/electron/src/renderer/playground/owner-agent/OwnerAgentShell.test.tsx
  /^(apps|packages)\/[^/]+\/src\/.*\.test\.tsx?$/,

  // ── Top-level tests/ directory in packages ────────────────────────
  // packages/shared/tests/content-validators.test.ts
  /^packages\/[^/]+\/tests\/.*\.test\.tsx?$/,

  // ── Root-level scripts/ ──────────────────────────────────────────
  // scripts/check-i18n-coverage.test.ts
  /^scripts\/.*\.test\.tsx?$/,
]

// ── pathIgnorePatterns parser ──────────────────────────────────────

// Read the [test].pathIgnorePatterns array from bunfig.toml.
// Returns bare directory names like ["dist", "release", ".build", "out-tsc"].
function parsePathIgnorePatterns(tomlText: string): string[] {
  const m = /pathIgnorePatterns\s*=\s*\[\s*\n([\s\S]*?)\n\s*\]/m.exec(
    tomlText,
  )
  if (!m) return []
  return m[1]!
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const q = /^["']([^"']+)["']/.exec(l)
      return q ? q[1]! : null
    })
    .filter((v): v is string => v !== null)
}

// Check whether a POSIX path is excluded by any pathIgnorePatterns entry.
function isExcluded(posixPath: string, patterns: string[]): boolean {
  const segments = posixPath.split('/')
  return patterns.some((p) => segments.includes(p))
}

// ── Discovery ──────────────────────────────────────────────────────

// Scan only the project source directories — never descend into
// node_modules (Bun.Glob does not respect .gitignore by default).
const SCAN_DIRS = ['apps', 'packages', 'scripts'] as const

async function discoverTestFiles(): Promise<string[]> {
  const glob = new Glob('**/*.test.ts*')
  const files: string[] = []

  for (const dir of SCAN_DIRS) {
    const absDir = resolve(ROOT, dir)
    for await (const f of glob.scan(absDir)) {
      // Skip node_modules — Bun.Glob descends into nested deps
      // even when scanning from apps/packages, and bun test ignores them.
      // Normalize first: Bun.Glob uses backslashes on Windows.
      const normalized = f.replace(/\\/g, '/')
      if (normalized.includes('node_modules/')) continue
      // Make paths relative to ROOT with forward slashes
      files.push(`${dir}/${normalized}`)
    }
  }

  return files
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const jsonMode = process.argv.includes('--json')

  // 1. Read exclusion patterns from bunfig.toml
  const tomlText = readFileSync(BUNFIG, 'utf-8')
  const ignorePatterns = parsePathIgnorePatterns(tomlText)

  // 2. Discover every test file Bun would load (scoped to source dirs)
  const allFiles = await discoverTestFiles()

  // 3. Filter through pathIgnorePatterns (same as bun test)
  const afterExclusions = allFiles.filter(
    (f) => !isExcluded(f, ignorePatterns),
  )

  // 4. Validate each surviving path against canonical patterns
  const violations: string[] = []
  const valid: string[] = []

  for (const f of afterExclusions) {
    if (CANONICAL_PATTERNS.some((re) => re.test(f))) {
      valid.push(f)
    } else {
      violations.push(f)
    }
  }

  // 5. Report
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          totalDiscovered: allFiles.length,
          excludedByPathIgnorePatterns: allFiles.length - afterExclusions.length,
          canonical: valid.length,
          violations,
          ignorePatterns,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`test-audit — ${allFiles.length} file(s) discovered by Glob`)
    console.log(
      `  ${allFiles.length - afterExclusions.length} excluded by pathIgnorePatterns [${ignorePatterns.join(', ')}]`,
    )
    console.log(`  ${valid.length} canonical`)
    console.log(`  ${violations.length} violation(s)\n`)

    if (violations.length > 0) {
      console.log('Violations (test files outside canonical locations):\n')
      for (const v of violations) {
        console.log(`  ${v}`)
      }
      console.log(
        '\nCanonical locations are:\n' +
          '  apps/<pkg>/src/**/__tests__/<name>.test.tsx\n' +
          '  apps/<pkg>/src/**/<name>.test.tsx  (colocated)\n' +
          '  packages/<pkg>/src/**/__tests__/<name>.test.tsx\n' +
          '  packages/<pkg>/src/**/<name>.test.tsx  (colocated)\n' +
          '  packages/<pkg>/tests/<name>.test.tsx\n' +
          '  packages/<pkg>/eslint-rules/__tests__/<name>.test.tsx\n' +
          '  scripts/<name>.test.tsx\n',
      )
      console.log(
        'Move the test file into a __tests__/ directory or add the\n' +
          'path to pathIgnorePatterns in bunfig.toml if the location is intentional.',
      )
    }
  }

  process.exit(violations.length > 0 ? 1 : 0)
}

main()
