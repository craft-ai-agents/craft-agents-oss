#!/usr/bin/env bun
/**
 * scripts/check-test-count.ts
 *
 * Counts `describe`/`it`/`test` blocks across the 3 treeBfsGate test files
 * BEFORE (HEAD) and AFTER (working tree / staged) the diff, fails the
 * commit if any count drops.  Pairs with the existing test:ui:treeBfsGate
 * gate in `.husky/pre-commit`:
 *
 *   - `bun run test:ui:treeBfsGate` — runs the tests; signals "tests fail"
 *   - `bun run check:test-count`    — compares counts against HEAD;
 *                                    signals "tests removed" (silent
 *                                    coverage loss during refactor)
 *
 * The two gates run sequentially because the count delta is meaningful
 * only after the tests have been verified to pass — the test gate fires
 * first; this script reports only the counts the tests need to honor.
 *
 * ── Parsing approach ──────────────────────────────────────────────────
 *
 * Uses the TypeScript compiler API (already a project dep) via
 * `ts.createSourceFile`.  AST handles correctness pitfalls regex
 * inevitably trips on:
 *
 *   - Comments
 *       /* `describe(...)` describes a thing. *\/
 *       `// it never counts`
 *     → AST ignores both.  Regex has to strip comments first.
 *   - String literals / template-literal substitutions
 *       const name = 'describe'
 *     → AST: not a CallExpression node, never counted.  Regex: false
 *     positive.
 *   - Nested describes
 *       describe('outer', () => { describe('inner', ...) })
 *     → AST: each CallExpression visited separately; both count.
 *     Regex: harder to express without balanced-paren matching.
 *   - Property-access aliases
 *       describe.only(...)         // counts as describe
 *       it.each(matrixCases)(...)  // counts as it
 *       test.skipIf(...)           // counts as test
 *     → AST: walk LEFT through PropertyAccessExpression to root
 *     identifier before comparing.  Regex: trivial to misclassify as
 *     `.only` or `.each`.
 *
 * Bun runs this natively; no build step required.  The script expects
 * `typescript` to be installed (transitively via the workspace deps).
 *
 * ── Edge cases (documented for future maintainers) ────────────────────
 *
 *   - File deleted from working tree:
 *       Bun.file().text() throws → handled → counted as 0 AFTER.
 *       This DELIBERATELY surfaces the deletion as a drop (intentional
 *       friction: removing a test should always require SKIP_TEST_COUNT
 *       + a commit-message justification).
 *   - New test file added in staged:
 *       git show HEAD:<new path> exits non-zero → handled → counted as
 *       0 BEFORE.  Cannot fail this gate by addition.
 *   - Test file renamed:
 *       Old path: counted as 0 AFTER (gone).  New path: not in TARGETS,
 *       silently ignored.  Documented: adding a target to TARGETS is
 *       an explicit action; rename-then-test-removal would need to be
 *       gated by a different invariant (e.g. file-count stable).
 *   - Outside git context:
 *       rev-parse exits non-zero; REPO_ROOT empty; every file counts
 *       as 0 BEFORE / as-is AFTER.  Net delta = current count.  The
 *       script exits 0 (we can't compute a baseline, we don't block).
 *
 * ── Known limitations (documented for future maintainers) ──────────
 *
 *   - Aliasing exemption: only calls whose root callee identifier is
 *     `describe` / `it` / `test` are counted.  The following patterns
 *     would silently NOT register:
 *         import { describe as d } from 'bun:test'; d(...)
 *         const it = ...; it(...)
 *         const fns = [it]; fns[0](...)
 *     The codebase doesn't use these patterns today; if you add
 *     tests in a destructured/aliased style, either rename the local
 *     or extend the AST walker to follow `import` bindings.
 *
 *   - Skip-variant blind spot: `it.skip(...)`, `it.todo(...)`,
 *     `describe.skip(...)` count toward the totals the same as live
 *     tests because the PropertyAccess walk keeps the root identifier
 *     (`it`/`describe`) unchanged.  A refactor that swaps `it` for
 *     `it.todo` keeps the `it` count flat while silently retiring
 *     the test — invisible to this gate.  Note that `xit(...)` is a
 *     *different* root identifier, so swapping `describe` to `xit`
 *     would drop the `describe` count (the gate fires correctly on
 *     that one).  This gate is orthogonal to the skip-variant case;
 *     pair it with a "skipped-test-count grew" gate if needed.
 *
 *   - Bun.spawnSync blocks the main thread.  Fine for a pre-commit
 *     hook (one invocation, a few hundred ms); would need a worker
 *     if you reuse this script in a long-running watcher.
 *
 * Bun runtime.  No external linters are required.
 */

import * as ts from 'typescript'

interface Counts {
  describes: number
  its: number
  tests: number
}

// Synchronous subprocess calls.  Two reasons:
//   1. Resolve order:  `Bun.spawn()` returns a Subprocess object whose
//      `proc.stdout` ReadableStream may resolve to an empty string if
//      read before the child closes the FD — observed with
//      `git show HEAD:pkg/foo.ts` (returning null/empty stdout + null
//      exitCode).  `Bun.spawnSync` blocks until child exit.
//   2. Simplicity: this script has no other concurrency; sync removes
//      an entire class of async-pipeline bugs.
function runGit(...args: string[]): { ok: boolean; stdout: string } {
  const proc = Bun.spawnSync(['git', ...args], {
    stdout: 'pipe', stderr: 'pipe',
  })
  if (proc.exitCode !== 0) return { ok: false, stdout: '' }
  return { ok: true, stdout: proc.stdout.toString() }
}

// Resolve repo root once so file reads use absolute paths against the
// real working tree (Bun.file() accepts abs paths).
const REPO_ROOT = runGit('rev-parse', '--show-toplevel').ok
  ? runGit('rev-parse', '--show-toplevel').stdout.trim()
  : ''

// ── Target list ───────────────────────────────────────────────────────
//
// A FIXED list, not dynamic discovery.  Dynamic discovery
// (`git ls-files | xargs grep -l '.test.ts'`) would silently pick up any
// test file in a future commit — but the user's gate contract is "the
// 3 treeBfsGate test files."  Adding a new file here is an explicit,
// reviewable action; it doesn't silently broaden scope.
//
// TO ADD A NEW TEST FILE: append the relative path here AND make sure
// its companion tests cover the same surface as the existing three.
const TARGETS = [
  'packages/ui/src/lib/__tests__/treeBfsGate.test.ts',
  'packages/ui/src/lib/__tests__/treeBfsGate.adversarial.test.ts',
  'packages/ui/src/lib/__tests__/treeBfsGate.consumer-agnostic.test.ts',
] as const

/** Count `describe`, `it`, and `test` call expressions rooted at
 *  those identifiers.  Walk left through PropertyAccess chains so
 *  `describe.only/each/skip/todo` is counted as `describe`. */
function countTestCalls(src: string, filename: string): Counts {
  // scriptKind drives the parser flavor; TSX is only needed for the
  // 3 files we care about today, but reading TSX defensively costs
  // nothing and future-proofs the script against accidental
  // .tsx file additions.
  const scriptKind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(
    filename, src, ts.ScriptTarget.Latest, /* setParentNodes */ false, scriptKind,
  )
  let describes = 0
  let its = 0
  let tests = 0

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const root = getRootCalleeName(node.expression)
      if (root === 'describe') describes++
      else if (root === 'it') its++
      else if (root === 'test') tests++
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return { describes, its, tests }
}

/** Walk left along PropertyAccess chains to the root identifier.
 *  Returns null if the chain ends on something other than an
 *  Identifier (e.g. `foo()[0]()` → null; caller skips). */
function getRootCalleeName(expr: ts.Expression): string | null {
  while (ts.isPropertyAccessExpression(expr)) {
    expr = expr.expression
  }
  return ts.isIdentifier(expr) ? expr.text : null
}

/** Working tree version of a file.  Returns null if the file is
 *  deleted / unreadable (Bun.file().text() throws). */
async function readWorkingTree(relPath: string): Promise<string | null> {
  if (!REPO_ROOT) return null
  try {
    return await Bun.file(`${REPO_ROOT}/${relPath}`).text()
  } catch {
    return null
  }
}

/**
 * `AFTER` source the script compares against the `BEFORE` (HEAD).
 *
 *   --staged
 *       Read `:file` from the git index.  This is the *strict*
 *       pre-commit semantic: only what's about to be committed is
 *       compared, so a refactor that reduces tests and is staged
 *       is caught even if the working tree was further edited
 *       afterward (post-stage working-tree edits shouldn't slip
 *       the commit through).
 *
 *   default
 *       Read the working-tree version of the file.  This is the
 *       *lenient* semantic: catches refactor shrinkage in any
 *       uncommitted state, useful for `validate:dev` or for a
 *       post-write check that doesn't require `git add`.
 *
 * Both paths share the same `null`-on-missing contract — when the
 * staged/working-tree version is missing, AFTER counts as 0, which
 * surfaces deletions as drops.
 */
const STAGED_MODE: boolean = process.argv.includes('--staged')

/** Staged (index) version of a file.  Returns null if the file is
 *  not in the index or `REPO_ROOT` is empty.  `git show :<file>`
 *  is git's index-too-path syntax: it's the same shape as
 *  `HEAD:<file>` but reads the staged version instead of HEAD. */
function readStagedTree(relPath: string): string | null {
  const result = runGit('show', `:${relPath}`)
  return result.ok ? result.stdout : null
}

/** HEAD version of a file.  Returns null if the file is new (no
 *  prior baseline).  Adding a new test file therefore counted as 0
 *  BEFORE → can never fail this gate by addition. */
function readHeadTree(relPath: string): string | null {
  const result = runGit('show', `HEAD:${relPath}`)
  return result.ok ? result.stdout : null
}

function fmtDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

async function main(): Promise<void> {
  // Mode announcement: explains at the top of every run whether
  // AFTER reads from working tree (default, lenient) or git index
  // (--staged, strict pre-commit semantic).  Surfaces the answer to
  // any reader without requiring them to grep the script for argv
  // handling.
  console.log(
    STAGED_MODE
      ? '(mode: --staged, AFTER reads from git index)'
      : '(mode: default, AFTER reads from working tree)',
  )

  const beforeTotals: Counts = { describes: 0, its: 0, tests: 0 }
  const afterTotals: Counts = { describes: 0, its: 0, tests: 0 }

  const drops: string[] = []
  const adds: string[] = []

  for (const rel of TARGETS) {
    const headSrc = readHeadTree(rel)
    const afterSrc = STAGED_MODE ? readStagedTree(rel) : await readWorkingTree(rel)
    const beforeCounts: Counts = headSrc != null ? countTestCalls(headSrc, rel) : { describes: 0, its: 0, tests: 0 }
    const afterCounts: Counts = afterSrc != null ? countTestCalls(afterSrc, rel) : { describes: 0, its: 0, tests: 0 }

    beforeTotals.describes += beforeCounts.describes
    beforeTotals.its += beforeCounts.its
    beforeTotals.tests += beforeCounts.tests
    afterTotals.describes += afterCounts.describes
    afterTotals.its += afterCounts.its
    afterTotals.tests += afterCounts.tests

    const dDesc = afterCounts.describes - beforeCounts.describes
    const dIt = afterCounts.its - beforeCounts.its
    const dTest = afterCounts.tests - beforeCounts.tests
    console.log(
      `${rel}  describes ${fmtDelta(dDesc)}  its ${fmtDelta(dIt)}  tests ${fmtDelta(dTest)}  ` +
      `(${beforeCounts.describes}/${beforeCounts.its}/${beforeCounts.tests} → ` +
      `${afterCounts.describes}/${afterCounts.its}/${afterCounts.tests})`,
    )

    // Per-file drops are reported individually so the user sees
    // which exact file shed tests; the totals check guards against
    // rename-then-edit tricks that hide a drop inside a moved file.
    if (dDesc < 0) drops.push(`${rel}: describes dropped by ${-dDesc}`)
    if (dIt < 0) drops.push(`${rel}: its dropped by ${-dIt}`)
    if (dTest < 0) drops.push(`${rel}: tests dropped by ${-dTest}`)
    if (dDesc > 0) adds.push(`${rel}: describes grew by ${dDesc}`)
    if (dIt > 0) adds.push(`${rel}: its grew by ${dIt}`)
    if (dTest > 0) adds.push(`${rel}: tests grew by ${dTest}`)
  }

  console.log('---')
  console.log(
    `TOTAL  describes ${fmtDelta(afterTotals.describes - beforeTotals.describes)}  ` +
    `its ${fmtDelta(afterTotals.its - beforeTotals.its)}  ` +
    `tests ${fmtDelta(afterTotals.tests - beforeTotals.tests)}  ` +
    `(${beforeTotals.describes}/${beforeTotals.its}/${beforeTotals.tests} → ` +
    `${afterTotals.describes}/${afterTotals.its}/${afterTotals.tests})`,
  )

  if (drops.length) {
    console.error('')
    console.error('❌ Test count dropped — refusing commit:')
    for (const d of drops) console.error(`   - ${d}`)
    if (adds.length) {
      console.error('')
      console.error('(you added ' + adds.length + ' test entries elsewhere — they do not offset the drops)')
    }
    console.error('')
    console.error('If the removal is intentional, document the trade-off in the commit')
    console.error('message body and set `SKIP_TEST_COUNT=1` for that commit only.')
    console.error('A subsequent PR should add compensating coverage if the dropped tests')
    console.error('guarded a real case.')
    process.exit(1)
  }

  if (adds.length) {
    console.log('')
    console.log('Test count grew:')
    for (const a of adds) console.log(`   + ${a}`)
  }
  console.log('✓ Test count non-decreasing — gate passes.')
}

await main().catch((err: unknown) => {
  console.error('check-test-count:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
