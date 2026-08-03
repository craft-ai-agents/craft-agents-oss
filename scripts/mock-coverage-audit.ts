#!/usr/bin/env bun
/**
 * scripts/mock-coverage-audit.ts
 *
 * Takes a real TypeScript class file and a mock file, walks the AST via
 * ts-morph, and emits a coverage matrix: realMethod → mockSurface.
 *
 * Usage:
 *   bun scripts/mock-coverage-audit.ts <real-file> <mock-file>
 *   bun scripts/mock-coverage-audit.ts --check <real-file> <mock-file>
 *
 * The script:
 *   1. Parses the real class file and extracts all public methods + properties
 *   2. Parses the mock file and finds the mock object/class literal
 *   3. Compares the two surfaces and reports:
 *      - COVERED: mock exposes the member
 *      - MISSING: member exists in real but not in mock
 *      - EXTRA: mock exposes a member not in the real class
 *   4. --check mode exits non-zero if any members are MISSING
 */
import { Project, SyntaxKind, type ClassDeclaration } from 'ts-morph'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..')
const CHECK_MODE = process.argv.includes('--check')
const JSON_MODE = process.argv.includes('--json')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageEntry {
  member: string
  status: 'covered' | 'missing' | 'extra'
  realKind: 'method' | 'property' | 'accessor'
  mockKind: 'method' | 'property' | 'accessor' | null
}

interface CoverageReport {
  realFile: string
  mockFile: string
  realClass: string
  realMemberCount: number
  mockMemberCount: number
  covered: CoverageEntry[]
  missing: CoverageEntry[]
  extra: CoverageEntry[]
  coveragePercent: number
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/**
 * Extract public instance methods and properties from a class declaration.
 */
function extractClassMembers(classDecl: ClassDeclaration): Map<string, { kind: 'method' | 'property' | 'accessor' }> {
  const members = new Map<string, { kind: 'method' | 'property' | 'accessor' }>()

  for (const member of classDecl.getMembers()) {
    const name = member.getName()
    if (!name || name.startsWith('_')) continue // skip private/internal

    const hasPublicModifier = member.hasModifier(SyntaxKind.PublicKeyword) ||
      (!member.hasModifier(SyntaxKind.PrivateKeyword) && !member.hasModifier(SyntaxKind.ProtectedKeyword))
    if (!hasPublicModifier) continue

    if (member.getKind() === SyntaxKind.MethodDeclaration) {
      members.set(name, { kind: 'method' })
    } else if (member.getKind() === SyntaxKind.PropertyDeclaration) {
      members.set(name, { kind: 'property' })
    } else if (member.getKind() === SyntaxKind.GetAccessor || member.getKind() === SyntaxKind.SetAccessor) {
      if (!members.has(name)) {
        members.set(name, { kind: 'accessor' })
      }
    }
  }

  return members
}

/**
 * Extract properties from an object literal expression.
 */
function extractObjectLiteralMembers(
  objLit: import('ts-morph').ObjectLiteralExpression,
): Map<string, { kind: 'method' | 'property' | 'accessor' }> {
  const members = new Map<string, { kind: 'method' | 'property' | 'accessor' }>()
  for (const prop of objLit.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
      const key = pa.getName()
      if (!key || key.startsWith('_')) continue
      const init = pa.getInitializer()
      if (!init) continue
      if (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression) {
        members.set(key, { kind: 'method' })
      } else {
        members.set(key, { kind: 'property' })
      }
    } else if (prop.getKind() === SyntaxKind.MethodDeclaration) {
      const md = prop.asKindOrThrow(SyntaxKind.MethodDeclaration)
      const key = md.getName()
      if (key && !key.startsWith('_')) {
        members.set(key, { kind: 'method' })
      }
    } else if (prop.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
      const spa = prop.asKindOrThrow(SyntaxKind.ShorthandPropertyAssignment)
      const key = spa.getName()
      if (key && !key.startsWith('_')) {
        members.set(key, { kind: 'property' })
      }
    }
  }
  return members
}

/**
 * Extract members from mock.module('...', () => ({...})) factories.
 * Also falls back to top-level class declarations and object literals
 * if no mock.module calls are found.
 */
function extractMockMembers(
  project: Project,
  mockFilePath: string,
): Map<string, { kind: 'method' | 'property' | 'accessor' }> {
  const members = new Map<string, { kind: 'method' | 'property' | 'accessor' }>()
  const absPath = resolve(projectRoot, mockFilePath)
  const sf = project.addSourceFileAtPathIfExists(absPath)
  if (!sf) return members

  // Strategy 1: Find mock.module('...', () => ({...})) calls — the primary mock surface.
  let foundMockModule = false
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const call = node.asKindOrThrow(SyntaxKind.CallExpression)
    const expr = call.getExpression()

    // Check if it's mock.module(...)
    const exprText = expr.getText()
    const isMockModule = exprText === 'mock.module' || exprText.endsWith('.module')
    if (!isMockModule) return

    // Find the factory function (second argument) and its returned object literal.
    const args = call.getArguments()
    if (args.length < 2) return

    const factory = args[1]
    // Handle: () => ({...})
    if (factory.getKind() === SyntaxKind.ArrowFunction || factory.getKind() === SyntaxKind.FunctionExpression) {
      const fn = factory.asKind(SyntaxKind.ArrowFunction) || factory.asKindOrThrow(SyntaxKind.FunctionExpression)
      const body = fn.getBody()
      // Direct return: () => ({...})
      if (body.getKind() === SyntaxKind.ParenthesizedExpression) {
        const inner = body.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression()
        if (inner.getKind() === SyntaxKind.ObjectLiteralExpression) {
          const objMembers = extractObjectLiteralMembers(inner.asKindOrThrow(SyntaxKind.ObjectLiteralExpression))
          for (const [k, v] of objMembers) members.set(k, v)
          foundMockModule = true
        }
      }
      // Block body: () => { return {...} }
      if (body.getKind() === SyntaxKind.Block) {
        const block = body.asKindOrThrow(SyntaxKind.Block)
        for (const stmt of block.getStatements()) {
          if (stmt.getKind() === SyntaxKind.ReturnStatement) {
            const ret = stmt.asKindOrThrow(SyntaxKind.ReturnStatement)
            const retExpr = ret.getExpression()
            if (retExpr && retExpr.getKind() === SyntaxKind.ObjectLiteralExpression) {
              const objMembers = extractObjectLiteralMembers(retExpr.asKindOrThrow(SyntaxKind.ObjectLiteralExpression))
              for (const [k, v] of objMembers) members.set(k, v)
              foundMockModule = true
            }
          }
        }
      }
    }
  })

  // Strategy 2: If no mock.module calls found, fall back to top-level classes
  // and exported object literals.
  if (!foundMockModule) {
    for (const classDecl of sf.getClasses()) {
      for (const member of classDecl.getMembers()) {
        const memberName = member.getName()
        if (!memberName || memberName.startsWith('_')) continue
        if (member.getKind() === SyntaxKind.MethodDeclaration) {
          members.set(memberName, { kind: 'method' })
        } else if (member.getKind() === SyntaxKind.PropertyDeclaration) {
          members.set(memberName, { kind: 'property' })
        } else if (member.getKind() === SyntaxKind.GetAccessor || member.getKind() === SyntaxKind.SetAccessor) {
          if (!members.has(memberName)) members.set(memberName, { kind: 'accessor' })
        }
      }
    }

    for (const varDecl of sf.getVariableStatements()) {
      for (const decl of varDecl.getDeclarations()) {
        const init = decl.getInitializer()
        if (init && init.getKind() === SyntaxKind.ObjectLiteralExpression) {
          const objMembers = extractObjectLiteralMembers(init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression))
          for (const [k, v] of objMembers) members.set(k, v)
        }
      }
    }
  }

  return members
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (args.length < 2) {
    console.error('Usage: bun scripts/mock-coverage-audit.ts [--check] [--json] <real-file> <mock-file>')
    console.error('  <real-file>  Path to the real TypeScript class file (relative to project root)')
    console.error('  <mock-file>  Path to the mock file (relative to project root)')
    process.exit(2)
  }

  const realRel = args[0]
  const mockRel = args[1]

  const project = new Project({
    tsConfigFilePath: resolve(projectRoot, 'apps/electron/tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  })

  // Parse the real class file
  const realAbs = resolve(projectRoot, realRel)
  const realSf = project.addSourceFileAtPathIfExists(realAbs)
  if (!realSf) {
    console.error(`[error] Real file not found: ${realRel}`)
    process.exit(1)
  }

  // Find the first class declaration
  const classDecls = realSf.getClasses()
  if (classDecls.length === 0) {
    console.error(`[error] No class declarations found in ${realRel}`)
    process.exit(1)
  }

  const realClass = classDecls[0]
  const className = realClass.getName() || '<anonymous>'
  const realMembers = extractClassMembers(realClass)

  // Parse the mock file
  const mockMembers = extractMockMembers(project, mockRel)

  // Build coverage matrix
  const covered: CoverageEntry[] = []
  const missing: CoverageEntry[] = []
  const extra: CoverageEntry[] = []

  for (const [member, { kind }] of realMembers) {
    if (mockMembers.has(member)) {
      covered.push({
        member,
        status: 'covered',
        realKind: kind,
        mockKind: mockMembers.get(member)!.kind,
      })
    } else {
      missing.push({
        member,
        status: 'missing',
        realKind: kind,
        mockKind: null,
      })
    }
  }

  for (const [member, { kind }] of mockMembers) {
    if (!realMembers.has(member)) {
      extra.push({
        member,
        status: 'extra',
        realKind: 'method',
        mockKind: kind,
      })
    }
  }

  const coveragePercent = realMembers.size > 0
    ? Math.round((covered.length / realMembers.size) * 100)
    : 100

  const report: CoverageReport = {
    realFile: realRel,
    mockFile: mockRel,
    realClass: className,
    realMemberCount: realMembers.size,
    mockMemberCount: mockMembers.size,
    covered: covered.sort((a, b) => a.member.localeCompare(b.member)),
    missing: missing.sort((a, b) => a.member.localeCompare(b.member)),
    extra: extra.sort((a, b) => a.member.localeCompare(b.member)),
    coveragePercent,
  }

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`\n╔══════════════════════════════════════════════════╗`)
    console.log(`║  Mock Coverage Audit                              ║`)
    console.log(`╚══════════════════════════════════════════════════╝\n`)
    console.log(`  Real class:    ${className} (${realRel})`)
    console.log(`  Mock file:     ${mockRel}`)
    console.log(`  Real members:  ${realMembers.size}`)
    console.log(`  Mock members:  ${mockMembers.size}`)
    console.log(`  Coverage:      ${coveragePercent}% (${covered.length}/${realMembers.size})\n`)

    if (covered.length > 0) {
      console.log(`  ✓ COVERED (${covered.length})`)
      for (const entry of covered) {
        const kindTag = entry.realKind === 'method' ? '()' : entry.realKind === 'accessor' ? ' accessor' : ''
        console.log(`    ${entry.member}${kindTag}`)
      }
      console.log()
    }

    if (missing.length > 0) {
      console.log(`  ✗ MISSING (${missing.length})`)
      for (const entry of missing) {
        const kindTag = entry.realKind === 'method' ? '()' : entry.realKind === 'accessor' ? ' accessor' : ''
        console.log(`    ${entry.member}${kindTag}`)
      }
      console.log()
    }

    if (extra.length > 0) {
      console.log(`  + EXTRA (${extra.length})`)
      for (const entry of extra) {
        console.log(`    ${entry.member}`)
      }
      console.log()
    }
  }

  if (CHECK_MODE && missing.length > 0) {
    console.error(`\n✗ ${missing.length} member(s) in ${className} are not mocked:`)
    for (const entry of missing) {
      console.error(`  - ${entry.member} (${entry.realKind})`)
    }
    console.error(`\nAdd these to the mock and re-run.`)
    process.exit(1)
  }

  if (missing.length === 0) {
    console.log(`\n✓ All ${realMembers.size} members covered`)
  }
}

main()
