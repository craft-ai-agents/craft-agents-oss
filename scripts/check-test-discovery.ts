#!/usr/bin/env bun
/**
 * scripts/check-test-discovery.ts
 *
 * Two independent guards on test discovery:
 *
 * CHECK 1 — no stale tests in the build output.
 * Verifies there are NO `*.test.{ts,tsx}` files under
 * `apps/electron/release/`.  These are stale copies left behind by
 * electron-builder that pollute `bun test` runs — Bun's test runner
 * discovers them via its default glob and tries to execute them,
 * which fails with confusing import-resolution errors in the packaged
 * layout.
 *
 * CHECK 2 — no test file falls outside the roots in the `test` script.
 * `package.json`'s `test` script passes explicit roots to `bun test`.
 * Bun treats those as SUBSTRING FILTERS on the file path, and — this is
 * the trap — it only errors when EVERY filter matches nothing.  Verified
 * on bun 1.3.10: `bun test zzz-nope` exits 1, but
 * `bun test apps/cli/src zzz-nope` exits 0 and prints no warning at all.
 * So renaming a directory, or adding a test under a workspace nobody
 * listed, drops those files from the suite while `bun run test` stays
 * green.  This check enumerates every first-party test file and fails if
 * any of them is not matched by at least one root, so the allowlist in
 * package.json and the tests on disk cannot silently diverge.
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

import { readdirSync, readFileSync, statSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// CHECK 2 — every first-party test file is reachable from the `test` script
// ---------------------------------------------------------------------------

/** Directories that never contain first-party tests we intend to run. */
const ORPHAN_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.tmp-tools',
  // Build output — CHECK 1 owns this one, and its tests are *meant* to be
  // unreachable.  Listing it here keeps the two checks from double-reporting.
  'release',
  // Full repo copies; their tests belong to another checkout entirely.
  'worktrees',
  '.worktrees',
  // Vendored upstream sources — not ours to run.
  'repo',
]);

const ANY_TEST_RE = /\.(test|spec)\.(ts|tsx)$/;

/** Walk from `dir`, collecting repo-relative POSIX paths of every test file. */
function walkAll(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (ORPHAN_SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      found.push(...walkAll(full));
    } else if (ANY_TEST_RE.test(name)) {
      found.push(relative(ROOT, full).split('\\').join('/'));
    }
  }
  return found;
}

/**
 * Pull the positional roots out of the `test` script — everything between
 * `bun test` and the first `&&`, minus any flags.  Parsing the real script
 * (rather than hardcoding a copy) is the point: the check cannot drift out
 * of sync with the command it is guarding.
 */
function readTestRoots(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const script: string = pkg?.scripts?.test ?? '';
  const firstCommand = script.split('&&')[0] ?? '';
  const tokens = firstCommand.trim().split(/\s+/);
  const testIdx = tokens.indexOf('test');
  if (testIdx === -1) return [];
  return tokens
    .slice(testIdx + 1)
    .filter((t) => t.length > 0 && !t.startsWith('-'))
    .map((t) => t.split('\\').join('/'));
}

function checkOrphanedTests(): boolean {
  const roots = readTestRoots();
  if (roots.length === 0) {
    // A bare `bun test` discovers everything under cwd, so there is no
    // allowlist that could drift — nothing to guard.
    console.log('OK — `test` script passes no explicit roots; discovery is repo-wide.');
    return true;
  }

  const all = walkAll(ROOT);
  // Bun matches these roots as plain substrings of the path, so mirror that
  // exactly rather than doing prefix or glob matching.
  const orphans = all.filter((f) => !roots.some((r) => f.includes(r)));

  if (orphans.length === 0) {
    console.log(
      `OK — all ${all.length} test file(s) are matched by the ${roots.length} root(s) in the \`test\` script.`,
    );
    return true;
  }

  console.error(
    `FAIL: ${orphans.length} test file(s) are NOT matched by any root in the \`test\` script,`,
  );
  console.error('      so `bun run test` silently never executes them:');
  for (const f of orphans) {
    console.error(`  ${f}`);
  }
  console.error('');
  console.error(`Roots currently declared: ${roots.join(' ')}`);
  console.error(
    'Fix by adding a root to the `test` script in package.json, or by moving',
  );
  console.error('the file under an existing root.');
  return false;
}

// ---------------------------------------------------------------------------

function main(): void {
  let ok = true;

  const stale = walk(RELEASE_DIR, RELEASE_DIR);
  if (stale.length === 0) {
    console.log('OK — no stale test files under apps/electron/release/');
  } else {
    ok = false;
    console.error(
      `FAIL: ${stale.length} stale test file(s) found under apps/electron/release/`,
    );
    for (const f of stale) {
      console.error(`  ${f}`);
    }
    console.error('');
    console.error(
      'These files are picked up by `bun test` and cause confusing failures.',
    );
    console.error(
      'Delete them or add them to the relevant .gitignore / bun test exclude list.',
    );
  }

  if (!checkOrphanedTests()) {
    ok = false;
  }

  process.exit(ok ? 0 : 1);
}

main();
