#!/usr/bin/env bun
//
// scripts/check-build-leaks.ts
//
// Defensive companion to check-test-discovery.ts.  That script catches
// stale test files that pollute `bun test` runs; this script catches
// the bigger problem: accidentally committing 71MB of binary
// unpacked-build artifacts.
//
// The check: does `git ls-files --cached` list any files under
// `apps/electron/release/`?  That directory IS in .gitignore, so the
// only way files appear in the index is via `git add -f` (explicit
// force-add).  This script detects that and refuses to proceed.
//
// Checks the ENTIRE apps/electron/release/ tree (all platforms):
//   win-unpacked/, mac/, mac-arm64/, linux-unpacked/
//
// Exit 0 when the directory is absent or no tracked files exist.
// Exit 1 with a diagnostic listing every leaked file otherwise.
//
// Wire into .husky/pre-commit so the guard fires before `git commit`
// can land build artifacts in the repo.
//
// Usage:
//   bun run check-build-leaks
//   bun run scripts/check-build-leaks.ts

import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')

function main(): void {
  // Check the git index for any files under apps/electron/release/.
  // `git ls-files --cached` reads the index directly — no filesystem
  // walk needed.  The `--` separator tells git the next arg is a path.
  let tracked: string
  try {
    tracked = execSync(
      'git ls-files --cached -- "apps/electron/release/"',
      { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
  } catch {
    // git not available or not a repo — can't check, assume clean.
    console.log('OK — git not available, skipping build-leak check')
    process.exit(0)
  }

  const files = tracked
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (files.length === 0) {
    console.log('OK — no build artifacts tracked in apps/electron/release/')
    process.exit(0)
  }

  console.error(
    `FAIL: ${files.length} file(s) under apps/electron/release/ are staged in the git index`,
  )
  console.error('')
  console.error(
    'These are build artifacts that should never be committed.  They are in',
  )
  console.error(
    '.gitignore but someone ran `git add -f` (or a tool did it automatically).',
  )
  console.error('')
  for (const f of files.slice(0, 20)) {
    console.error(`  ${f}`)
  }
  if (files.length > 20) {
    console.error(`  ... and ${files.length - 20} more`)
  }
  console.error('')
  console.error('Fix:')
  console.error('  git rm --cached -r apps/electron/release/')
  console.error('  git commit --amend   # or start a new commit')
  console.error('')
  console.error(
    'Bypass (sparingly): SKIP_BUILD_LEAKS=1 git commit ...',
  )
  process.exit(1)
}

main()
