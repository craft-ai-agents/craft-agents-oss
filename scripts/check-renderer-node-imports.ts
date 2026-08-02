#!/usr/bin/env bun
//
// scripts/check-renderer-node-imports.ts
//
// Guards the browser/Node boundary of @archstudio/shared.
//
// packages/shared is consumed by BOTH the Electron main process (Node) and
// the renderer (browser).  It has no runtime root barrel — every consumer
// enters through one of the ~66 subpath exports declared in
// packages/shared/package.json.  Some of those subpaths are browser-safe
// (labels, colors, protocol); others transitively pull in `fs`, `path`,
// `crypto` and friends (config, credentials, sources).
//
// Today nothing enforces that split.  The renderer imports
// '@archstudio/shared/config' in three places and gets away with it only
// because all three are `import type`, which the compiler erases.  Drop the
// `type` keyword on any of them and `fs` lands in the browser bundle, where
// it fails at runtime with a message that points nowhere near the cause.
//
// The check:
//   1. Read the subpath export map from packages/shared/package.json.
//   2. For each subpath, walk its relative-import graph and mark it UNSAFE
//      if any reachable module imports a Node builtin.  (Computed, not
//      hardcoded — moving code between files keeps this honest.)
//   3. Scan renderer + shared-UI sources for VALUE imports of an unsafe
//      subpath.  Type-only imports are erased at build time and allowed.
//
// Exit 0 when clean.  Exit 1 listing every offending import site otherwise.
//
// Usage:
//   bun run check:renderer-node-imports
//   bun run scripts/check-renderer-node-imports.ts

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = join(ROOT, 'packages/shared')

// Directories whose code ends up in the renderer (browser) bundle.
const RENDERER_ROOTS = ['apps/electron/src/renderer', 'packages/ui/src']

const NODE_BUILTINS = new Set([
  'fs', 'fs/promises', 'path', 'os', 'crypto', 'child_process', 'net', 'http',
  'https', 'http2', 'tls', 'dns', 'stream', 'zlib', 'worker_threads', 'cluster',
  'module', 'vm', 'repl', 'readline', 'perf_hooks', 'inspector', 'v8',
  'bun:sqlite', 'electron',
])

const isBuiltin = (spec: string): boolean =>
  NODE_BUILTINS.has(spec) ||
  NODE_BUILTINS.has(spec.replace(/^node:/, '')) ||
  spec.startsWith('node:')

/**
 * True when an import statement is fully erased at build time — either
 * `import type { X } from` or `import { type A, type B } from`.
 */
function isErasedImport(statement: string): boolean {
  if (/^\s*import\s+type\s/.test(statement)) return true
  const bindings = statement.match(/^\s*import\s*\{([\s\S]*?)\}\s*from/)?.[1]
  if (bindings === undefined) return false
  const names = bindings.split(',').map((s) => s.trim()).filter(Boolean)
  return names.length > 0 && names.every((b) => b.startsWith('type '))
}

/**
 * True when a re-export statement is fully erased at build time — either
 * `export type { X } from` or `export { type A, type B } from`.
 * Note `export * from` is never erased.
 */
function isErasedExport(statement: string): boolean {
  if (/^\s*export\s+type\s/.test(statement)) return true
  const bindings = statement.match(/^\s*export\s*\{([\s\S]*?)\}\s*from/)?.[1]
  if (bindings === undefined) return false
  const names = bindings.split(',').map((s) => s.trim()).filter(Boolean)
  return names.length > 0 && names.every((b) => b.startsWith('type '))
}

/**
 * Runtime `from '...'` / `require('...')` specifiers in a source file.
 *
 * Type-only imports are skipped: they carry no runtime edge, so a module
 * that only references Node-backed code through `import type` stays
 * browser-safe.  Without this, protocol/dto.ts would look like it drags in
 * child_process purely because it imports an agent *type*.
 */
function specifiersOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []

  // Whole import statements, braces and all, so multi-line `import type {\n
  // ...\n} from 'x'` is judged as one unit.  A line-based scan would see only
  // the trailing `} from 'x'` and mistake an erased import for a runtime one.
  const IMPORT_STATEMENT = /^[ \t]*import\s+(?:type\s+)?(?:\{[\s\S]*?\}|[^'"\n]*?)\s*from\s*['"]([^'"]+)['"]/gm

  for (const m of src.matchAll(IMPORT_STATEMENT)) {
    if (!isErasedImport(m[0])) out.push(m[1]!)
  }

  // Re-export edges (`export * from './storage.ts'`) are runtime edges too,
  // and they are how the barrels are actually written — config/index.ts pulls
  // in fs entirely through `export *`.  Missing these made the whole check
  // pass vacuously.
  const EXPORT_STATEMENT = /^[ \t]*export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})(?:\s+as\s+\w+)?\s*from\s*['"]([^'"]+)['"]/gm

  for (const m of src.matchAll(EXPORT_STATEMENT)) {
    if (!isErasedExport(m[0])) out.push(m[1]!)
  }

  // Side-effect imports (`import 'x'`) and require() calls are always runtime.
  for (const m of src.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]!)
  for (const m of src.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!)

  return out
}

/** Resolve a relative import to a real file on disk. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`,
    join(base, 'index.ts'), join(base, 'index.tsx'),
    base.replace(/\.js$/, '.ts'),
  ]
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/**
 * Walk a subpath entrypoint's relative-import graph.
 * Returns the offending "file -> builtin" pair, or null when browser-safe.
 */
function findNodeReach(entry: string): { file: string; builtin: string } | null {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const spec of specifiersOf(file)) {
      if (isBuiltin(spec)) {
        return { file: relative(ROOT, file).replace(/\\/g, '/'), builtin: spec }
      }
      // Only relative edges stay inside this package's graph.
      if (spec.startsWith('.')) {
        const next = resolveRelative(file, spec)
        // Tests are not shipped; they may use fs freely.
        if (next && !next.includes('__tests__') && !/\.(test|spec)\.tsx?$/.test(next)) {
          queue.push(next)
        }
      }
    }
  }
  return null
}

// ── 1. Classify every subpath export ────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(SHARED, 'package.json'), 'utf8'))
const exportsMap: Record<string, string> = pkg.exports ?? {}

/** subpath (e.g. 'config') -> why it is unsafe */
const unsafe = new Map<string, { file: string; builtin: string }>()

for (const [key, target] of Object.entries(exportsMap)) {
  if (key === '.') continue // documentation-only barrel, re-exports nothing
  const entry = join(SHARED, target)
  if (!existsSync(entry)) continue
  const reach = findNodeReach(entry)
  if (reach) unsafe.set(key.replace(/^\.\//, ''), reach)
}

// ── 2. Scan renderer sources for VALUE imports of unsafe subpaths ───────────

interface Violation {
  file: string
  line: number
  subpath: string
  reason: { file: string; builtin: string }
  statement: string
}

const violations: Violation[] = []

const listFiles = (dir: string): string[] => {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  return execSync(`git ls-files "${dir}"`, { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.includes('__tests__'))
}

for (const dir of RENDERER_ROOTS) {
  for (const rel of listFiles(dir)) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m = line.match(/^\s*import\s+(type\s+)?(.*?)from\s+['"]@archstudio\/shared\/([^'"]+)['"]/)
      if (!m) return

      const isTypeOnlyImport = Boolean(m[1])           // import type { X } from ...
      const clause = m[2] ?? ''
      // `import { type A, type B }` is also fully erased.
      const bindings = clause.match(/\{([^}]*)\}/)?.[1]
      const allBindingsTyped =
        bindings !== undefined &&
        bindings.split(',').map((s) => s.trim()).filter(Boolean).length > 0 &&
        bindings.split(',').map((s) => s.trim()).filter(Boolean).every((b) => b.startsWith('type '))

      if (isTypeOnlyImport || allBindingsTyped) return

      const subpath = m[3]!
      const reason = unsafe.get(subpath)
      if (reason) {
        violations.push({
          file: rel, line: i + 1, subpath, reason, statement: line.trim(),
        })
      }
    })
  }
}

// ── 3. Report ───────────────────────────────────────────────────────────────

if (violations.length === 0) {
  console.log(
    `OK — no renderer value-imports of Node-backed @archstudio/shared subpaths ` +
      `(${unsafe.size} of ${Object.keys(exportsMap).length - 1} subpaths are Node-backed).`,
  )
  process.exit(0)
}

console.error(`\nFAIL — ${violations.length} renderer import(s) pull Node builtins into the browser bundle:\n`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`)
  console.error(`    ${v.statement}`)
  console.error(
    `    '@archstudio/shared/${v.subpath}' reaches '${v.reason.builtin}' via ${v.reason.file}`,
  )
  console.error('')
}
console.error('Fix by one of:')
console.error("  - make it type-only:  import type { X } from '@archstudio/shared/...'")
console.error('  - import the browser-safe leaf module directly, adding a narrow')
console.error('    subpath export to packages/shared/package.json if one is missing')
console.error('  - move the Node-only code behind its own subpath (see labels/storage.ts)')
console.error('')
process.exit(1)
