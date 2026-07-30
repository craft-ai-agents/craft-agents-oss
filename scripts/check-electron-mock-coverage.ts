#!/usr/bin/env bun
/**
 * Audit script: discovers every coverage.config.ts under
 * apps/electron/src/main/, reads each test's declared consumer files,
 * collects the union of BrowserWindow / BrowserView / WebContents members
 * those consumers access, and writes per-test __snapshots__/coverage.ts.
 *
 * Default — WRITE (regenerates every snapshot in place):
 *   bun scripts/check-electron-mock-coverage.ts
 *   bun run mock:audit:write
 *
 * --check (no writes; exits non-zero if any snapshot is missing or differs
 * from the content this run would produce). This is the gate mode used by
 * the pre-commit hook and CI:
 *   bun scripts/check-electron-mock-coverage.ts --check
 *   bun run mock:audit
 *
 * After adding a new test file that mocks electron:
 *   1. Create <test-dir>/coverage.config.ts with coverageConsumers
 *   2. Run this script (default mode) to generate coverage.ts
 *   3. Wire assertCoverage in the test file using the generated snapshot
 */
import { Project, SyntaxKind } from 'ts-morph'
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..')
const MAIN_SRC = resolve(projectRoot, 'apps/electron/src/main')
const CHECK_MODE = process.argv.includes('--check') || process.argv.includes('--ci')

// Types we're auditing.
const TARGET_TYPES = ['BrowserWindow', 'BrowserView', 'WebContents'] as const

// Shared ts-morph Project (expensive to create — do once, add files lazily).
const project = new Project({
  tsConfigFilePath: resolve(projectRoot, 'apps/electron/tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
})

// ---------------------------------------------------------------------------
// Discovery: find every coverage.config.ts under apps/electron/src/main/
// ---------------------------------------------------------------------------

interface CoverageConfig {
  /** Absolute path to the config file itself. */
  configPath: string
  /** Absolute path to the directory containing the config (the test dir). */
  dir: string
  /** Absolute path to the snapshot file. */
  snapPath: string
  /** Consumer source file paths (relative to projectRoot). */
  consumers: string[]
}

function discoverConfigs(): CoverageConfig[] {
  const configs: CoverageConfig[] = []

  function walk(dir: string) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = resolve(dir, entry)
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const s = statSync(full)
      if (s.isDirectory()) {
        walk(full)
      } else if (entry === 'coverage.config.ts') {
        // Extract coverageConsumers via ts-morph AST (robust against formatting).
        const sf = project.addSourceFileAtPathIfExists(full)
        if (!sf) {
          console.error(`[warn] ${full}: could not add to ts-morph project — skipping`)
          continue
        }
        const decl = sf.getVariableDeclaration('coverageConsumers')
        if (!decl) {
          console.error(`[warn] ${full}: variable coverageConsumers not found — skipping`)
          continue
        }
        // Handle `[...] as const` — ts-morph wraps the array in an AsExpression.
        let rawInit = decl.getInitializer()
        if (!rawInit) {
          console.error(`[warn] ${full}: coverageConsumers has no initializer — skipping`)
          continue
        }
        if (rawInit.getKind() === SyntaxKind.AsExpression) {
          rawInit = (rawInit as import('ts-morph').AsExpression).getExpression()
        }
        const init = rawInit.asKind(SyntaxKind.ArrayLiteralExpression)
        if (!init) {
          console.error(`[warn] ${full}: coverageConsumers initializer is not an array literal — got ${rawInit.getKindName()} — skipping`)
          continue
        }
        const items = init.getElements().map((e) => {
          const text = e.getText()
          return text.replace(/^['"]|['"]$/g, '')
        })

        const configDir = dirname(full)
        configs.push({
          configPath: full,
          dir: configDir,
          snapPath: resolve(configDir, '__snapshots__', 'coverage.ts'),
          consumers: items,
        })
      }
    }
  }

  walk(MAIN_SRC)
  return configs.sort((a, b) => a.dir.localeCompare(b.dir))
}

// ---------------------------------------------------------------------------
// Consumer scanning (same logic as before, but per-config-set)
// ---------------------------------------------------------------------------

function scanConsumers(
  consumerPaths: string[],
): Record<string, string[]> {
  const usages = new Map<string, Set<string>>()
  for (const k of TARGET_TYPES) usages.set(k, new Set())

  let resolvedViaSymbol = 0
  let resolvedViaText = 0
  let dropped = 0

  for (const relPath of consumerPaths) {
    const absPath = resolve(projectRoot, relPath)
    const sf = project.addSourceFileAtPathIfExists(absPath)
    if (!sf) {
      console.error(`[warn] consumer file not found: ${relPath}`)
      continue
    }

    sf.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.PropertyAccessExpression) return
      const access = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
      const memberName = access.getName()
      if (!memberName || memberName.startsWith('_')) return

      const base = access.getExpression()
      if (base.getKind() === SyntaxKind.Identifier && TARGET_TYPES.includes(base.getText() as any)) {
        dropped++
        return
      }

      const baseType = base.getType()
      const symbolName = baseType.getSymbol()?.getName()

      let matched: string | undefined
      if (symbolName) {
        for (const t of TARGET_TYPES) {
          if (symbolName === t) { matched = t; resolvedViaSymbol++; break }
        }
      }
      if (!matched) {
        const rendered = baseType.getText()
        const firstToken = rendered.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0]
        if (firstToken) {
          for (const t of TARGET_TYPES) {
            if (firstToken === t) { matched = t; resolvedViaText++; break }
          }
        }
      }
      if (!matched) { dropped++; return }

      usages.get(matched)!.add(memberName)
    })
  }

  const sorted: Record<string, string[]> = {}
  for (const k of TARGET_TYPES) {
    sorted[k] = Array.from(usages.get(k)!).sort()
  }
  return sorted
}

// ---------------------------------------------------------------------------
// Snapshot rendering (extracted so --check mode can diff against disk)
// ---------------------------------------------------------------------------

function renderSnapshot(
  members: Record<string, string[]>,
  consumers: string[],
): string {
  const header = [
    '/**',
    ' * Auto-generated by scripts/check-electron-mock-coverage.ts — DO NOT edit by hand.',
    ` * Consumer files: ${consumers.join(', ')}.`,
    ' * Run `bun scripts/check-electron-mock-coverage.ts` to refresh.',
    ' */',
    '',
    'export const coverageSnapshot = {',
  ]
  const body: string[] = []
  for (let i = 0; i < TARGET_TYPES.length; i++) {
    const k = TARGET_TYPES[i]
    const isLast = i === TARGET_TYPES.length - 1
    body.push(`  "${k}": ${JSON.stringify(members[k])}${isLast ? '' : ','}`)
  }
  const footer = ['} as const', '']
  return [...header, ...body, ...footer].join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const configs = discoverConfigs()
console.log(`${CHECK_MODE ? '[check] ' : ''}discovered ${configs.length} coverage config(s)\n`)

const drifted: string[] = []
let written = 0

for (const cfg of configs) {
  const relDir = relative(projectRoot, cfg.dir)
  console.log(`  ${relDir}/`)

  const members = scanConsumers(cfg.consumers)
  const desired = renderSnapshot(members, cfg.consumers)
  const onDisk = existsSync(cfg.snapPath) ? readFileSync(cfg.snapPath, 'utf-8') : null
  const relSnap = relative(projectRoot, cfg.snapPath)

  if (CHECK_MODE) {
    if (onDisk === null) {
      console.log(`    MISSING: ${relSnap}`)
      drifted.push(relSnap)
    } else if (onDisk !== desired) {
      console.log(`    DRIFTED: ${relSnap}`)
      drifted.push(relSnap)
    } else {
      console.log(`    OK`)
    }
  } else {
    if (onDisk !== desired) {
      mkdirSync(dirname(cfg.snapPath), { recursive: true })
      writeFileSync(cfg.snapPath, desired)
      written++
    }
    console.log(`    consumers: ${cfg.consumers.join(', ')}`)
    for (const k of TARGET_TYPES) {
      console.log(`    ${k}: ${members[k].length} required members`)
    }
  }
  console.log()
}

if (CHECK_MODE) {
  if (drifted.length === 0) {
    console.log(`\u2713 all ${configs.length} snapshot(s) match`)
    process.exit(0)
  }
  console.log(
    `\u2717 ${drifted.length}/${configs.length} snapshot(s) need updating`,
  )
  console.log('  Run `bun run mock:audit:write` to regenerate, then git-add the changed files.')
  for (const f of drifted) {
    console.log(`    ${f}`)
  }
  process.exit(1)
}

console.log(
  written === 0
    ? `all ${configs.length} snapshot(s) already up to date`
    : `wrote ${written} snapshot file(s) (${configs.length} total)`,
)

