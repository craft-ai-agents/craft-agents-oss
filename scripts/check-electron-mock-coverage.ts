#!/usr/bin/env bun
/**
 * Audit script: walks the configured consumer files (those that import from
 * `electron` and use BrowserWindow / BrowserView / WebContents), collects the
 * union of every property/method name those consumers access, and emits
 * `scripts/__generated__/required-electron-members.ts` as the canonical list
 * the test suite uses to assert mock coverage.
 *
 * The generated list is consumed by `apps/electron/src/main/__tests__/_mock-coverage.ts`,
 * which verifies at `beforeAll` time that every required member exists on the
 * mock instance. Drift (real code adds `window.setVisibleOnAllWorkspaces`,
 * mock doesn't expose it) fails the test loud + early instead of silently
 * returning `undefined` and going green.
 *
 * Run:
 *   bun scripts/check-electron-mock-coverage.ts
 *
 * When consumer files change their call surface, the generated list changes;
 * pre-commit hook (`bun scripts/check-electron-mock-coverage.ts`) regenerates
 * and the test fails if the developer forgot to git-add the regenerated file.
 */import { Project, SyntaxKind } from 'ts-morph'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..')

/**
 * Consumer files: which production source files' call surface we audit.
 *
 * Scope is deliberately narrow: one entry maps to one mock.module('electron')
 * factory in one test file. Each test that mocks electron owns its own
 * consumer list. Extending coverage to a new test/consumer pair is a
 * coordinated change:
 *
 *   1. Add the consumer path here.
 *   2. Extend the corresponding mock.module('electron', ...) factory in the
 *      test file to expose every member the audit flags.
 *   3. Re-run this script to regenerate REQUIRED_ELECTRON_MEMBERS.
 *   4. Wire assertMockCoverage() into the test file (3 top-level calls for
 *      BrowserWindow / BrowserView / WebContents).
 *
 * Auto-discovering every Electron consumer under apps/electron/src/main
 * (an earlier iteration of this script did that) was rejected: each
 * test file's mock.module factory should match the call surface of the
 * source files THAT TEST IMPORTS transitively, not every consumer in the
 * monorepo. Bundling them together over-broadens REQUIRED_ELECTRON_MEMBERS
 * to a union that no single mock can fulfill.
 */
const CONSUMERS = [
  'apps/electron/src/main/browser-pane-manager.ts',
]  

// Types we're auditing. Matched by ts-morph's resolved type symbol name.
const TARGET_TYPES = ['BrowserWindow', 'BrowserView', 'WebContents'] as const

const project = new Project({
  tsConfigFilePath: resolve(projectRoot, 'apps/electron/tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
})

for (const path of CONSUMERS) {
  project.addSourceFileAtPathIfExists(resolve(projectRoot, path))
}

const usages = new Map<string, Set<string>>()
for (const k of TARGET_TYPES) usages.set(k, new Set())

let droppedPropertyAccesses = 0
let resolvedViaSymbol = 0
let resolvedViaText = 0

for (const sourceFile of project.getSourceFiles()) {
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.PropertyAccessExpression) return
    const access = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    const memberName = access.getName()
    if (!memberName || memberName.startsWith('_')) return // skip our `_emit` style helpers

    const base = access.getExpression()
    const baseType = base.getType()
    const symbolName = baseType.getSymbol()?.getName()

    let matched: string | undefined
    if (symbolName) {
      for (const t of TARGET_TYPES) {
        if (symbolName === t) {
          matched = t
          resolvedViaSymbol++
          break
        }
      }
    }
    if (!matched) {
      // Fallback: accept only when the rendered type's *first token* is the
      // target name. This catches nullable (`BrowserWindow | undefined`),
      // array (`BrowserWindow[]`), and promise-bearing flavours, while
      // ignoring compound types like `Set<BrowserWindow>` or
      // `Map<string, BrowserWindow>` whose first token is `Set`/`Map` (the
      // property access on those is on the container, not on BrowserWindow).
      const rendered = baseType.getText()
      const firstToken = rendered.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0]
      if (firstToken) {
        for (const t of TARGET_TYPES) {
          if (firstToken === t) {
            matched = t
            resolvedViaText++
            break
          }
        }
      }
    }
    if (!matched) {
      droppedPropertyAccesses++
      return
    }

    usages.get(matched)!.add(memberName)
  })
}

// Sort + emit
const sorted = Object.fromEntries(
  TARGET_TYPES.map((k) => [k, Array.from(usages.get(k)!).sort()]),
) as Record<(typeof TARGET_TYPES)[number], string[]>

const generatedPath = resolve(projectRoot, 'scripts/__generated__/required-electron-members.ts')
mkdirSync(dirname(generatedPath), { recursive: true })

const header = [
  '/**',
  ' * Auto-generated by scripts/check-electron-mock-coverage.ts — DO NOT edit by hand.',
  ` * Consumer ${CONSUMERS.length === 1 ? 'file' : 'files'} scanned: ${CONSUMERS.join(', ')}. Run 'bun scripts/check-electron-mock-coverage.ts' to refresh.`,
  ' *',
  ' * Required = union of every BrowserWindow / BrowserView / WebContents member',
  ' * accessed by the consumers above. The browser-pane-manager test asserts at',
  ' * module-load time that every entry here exists on the corresponding mock',
  ' * instance. Drift (real code adds a new BrowserWindow.setVisibleOnAllWorkspaces call,',
  " * the mock does not expose it) raises a top-level MockCoverageError.",
  ' */',
  '',
  `export const REQUIRED_ELECTRON_MEMBERS = ${JSON.stringify(sorted, null, 2)} as const`,
  '',
].join('\n')

writeFileSync(generatedPath, header)

console.log(`scanned ${CONSUMERS.length} consumer file(s)`)
console.log(`matched by symbol: ${resolvedViaSymbol}, by type-text: ${resolvedViaText}, dropped: ${droppedPropertyAccesses}`)
console.log()
console.log(`wrote ${generatedPath}`)
for (const k of TARGET_TYPES) {
  console.log(`  ${k}: ${sorted[k].length} required members`)
}
