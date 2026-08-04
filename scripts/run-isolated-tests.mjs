#!/usr/bin/env node
/**
 * Runs every `*.isolated.ts` test file in its own `bun test` process.
 *
 * Why a script and not shell: the old `package.json` recipe
 *   `for f in $(find . -name '*.isolated.ts' ...); do bun test "$f" || exit 1; done`
 * is POSIX bash and does not parse under bun on Windows ("bun: command not found: done").
 * Isolated tests must run one-per-process, so we find them recursively and
 * spawn a fresh `bun test <file>` for each, failing the run if any of them fail.
 */

import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { sanitizeChildProcessEnv } from '@archstudio/shared/utils/env'

const ROOT = resolve(import.meta.dirname, '..')

// Directories that never contain codebase tests.
// NOTE: `release` is excluded because electron-builder writes staged source
// trees to apps/electron/release/** (win-unpacked, mac, linux-unpacked) that
// contain stale *.isolated.ts copies — walking them produces phantom failures
// (the same reason the old bunfig pathIgnorePatterns existed).
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.worktrees', 'dist', 'build', 'release'])
const SUFFIX = '.isolated.ts'

/** Depth-first walk collecting absolute paths of isolated test files. */
function findIsolated(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) out.push(...findIsolated(full))
    else if (entry.endsWith(SUFFIX)) out.push(full)
  }
  return out
}

const files = findIsolated(ROOT)

if (files.length === 0) {
  console.log('run-isolated-tests: no *.isolated.ts files found, nothing to run.')
  process.exit(0)
}

console.log(`run-isolated-tests: running ${files.length} isolated test file(s)`)
let failed = 0
for (const file of files) {
  const rel = relative(ROOT, file)
  const res = spawnSync(process.execPath /* bun */, ['test', file], {
    cwd: ROOT,
    stdio: 'inherit',
    env: sanitizeChildProcessEnv(process.env),
  })
  if (res.status !== 0) {
    failed++
    console.error(`\nrun-isolated-tests: FAILED ${rel} (exit ${res.status})\n`)
  } else {
    console.log(`run-isolated-tests: ok ${rel}`)
  }
}

if (failed > 0) {
  console.error(`run-isolated-tests: ${failed}/${files.length} isolated file(s) FAILED`)
  process.exit(1)
}
console.log(`run-isolated-tests: all ${files.length} isolated file(s) passed`)
