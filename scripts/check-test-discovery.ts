#!/usr/bin/env bun
/**
 * scripts/check-test-discovery.ts
 *
 * Verifies there are NO `*.test.{ts,tsx}` files under
 * `apps/electron/release/`.  These are stale copies left behind by
 * electron-builder that pollute `bun test` runs — Bun's test runner
 * discovers them via its default glob and tries to execute them,
 * which fails with confusing import-resolution errors in the packaged
 * layout.
 *
 * Why walk the directory instead of `bun test --dry`?
 * Bun (as of v1.3.x) does not have a `--dry` flag. Even if it did, a
 * stale test file inside release/ would still execute during a real
 * test run because Bun does not limit discovery to workspace roots.
 * Walking the directory directly is simpler, faster, and more precise.
 *
 * Exit 0 when the directory is absent or contains no test files.
 * Exit 1 with a diagnostic listing every stale file otherwise.
 *
 * Wire into validate:dev and the pre-commit hook so the guard fires
 * before `bun test` ever sees the pollution.
 *
 * Usage:
 *   bun run check-test-discovery
 *   bun run scripts/check-test-discovery.ts
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(
  import.meta.dir ?? new URL('.', import.meta.url).pathname,
  '..',
);
const RELEASE_DIR = join(ROOT, 'apps', 'electron', 'release');

const TEST_FILE_RE = /\.test\.(ts|tsx)$/;
const EXCLUDE_DIRS = new Set(['node_modules']);

/**
 * Recursively walk `dir` and return paths (relative to `base`) of every
 * file matching TEST_FILE_RE.
 */
function walk(dir: string, base: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory does not exist or is inaccessible — clean state.
    return found;
  }
  for (const name of entries) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      found.push(...walk(full, base));
    } else if (TEST_FILE_RE.test(name)) {
      found.push(relative(base, full));
    }
  }
  return found;
}

function main(): void {
  const found = walk(RELEASE_DIR, RELEASE_DIR);

  if (found.length === 0) {
    console.log('OK — no stale test files under apps/electron/release/');
    process.exit(0);
  }

  console.error(
    `FAIL: ${found.length} stale test file(s) found under apps/electron/release/`,
  );
  for (const f of found) {
    console.error(`  ${f}`);
  }
  console.error('');
  console.error(
    'These files are picked up by `bun test` and cause confusing failures.',
  );
  console.error(
    'Delete them or add them to the relevant .gitignore / bun test exclude list.',
  );
  process.exit(1);
}

main();
