#!/usr/bin/env node
/**
 * Cross-platform smoke runner.
 *
 * Composes aj-geddes/useful-ai-prompts@cross-platform-compatibility's Quick
 * Start fixture and testing-across-platforms strategy with the repo's 3-OS CI
 * matrix (ubuntu-latest, windows-latest, macos-latest). Every probe below is a
 * "Quick Start" invariant that must hold on ALL three OSes; where behavior is
 * legitimately platform-specific (e.g. `isAbsolute('C:\\...')`), the probe
 * asserts the platform-appropriate expectation, so a red probe means a real
 * regression, not expected divergence.
 *
 * The probes exercise the repo's REAL cross-platform utilities
 * (`@archstudio/shared/utils`: expandPath, toPortablePath, normalizePath,
 * pathStartsWith, stripPathPrefix, sanitizeChildProcessEnv) — the exact code
 * paths behind the Windows backslash-path and literal-"undefined" env bug
 * classes — plus the raw node:path fixture the skill teaches.
 *
 * Modes:
 *   bun scripts/cross-platform-smoke.mjs                    run probes, exit 1 on any failure
 *   bun scripts/cross-platform-smoke.mjs --json <file>      also write machine-readable report
 *   bun scripts/cross-platform-smoke.mjs --diff <files...>  compare reports across OSes,
 *                                                            exit 1 on divergence
 *   ... --diff --expected-os <os1,os2,...> <files...>       also exit 1 when an OS named
 *                                                            in the list has no report file
 *                                                            (matched by smoke-report-<os>.json)
 *
 * CI wiring: the test-suite matrix job runs `--json smoke-report-<os>.json`,
 * uploads it as an artifact; a follow-up job runs `--diff --expected-os <list>`
 * over the reports. A probe that passes on linux but fails on windows shows up
 * there as named workflow noise instead of a postmortem, and a report that is
 * absent entirely (a leg that died before uploading) is named by --expected-os
 * rather than silently dropping out of the comparison.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const TOOL = 'cross-platform-smoke'
const SKILL = 'aj-geddes/useful-ai-prompts@cross-platform-compatibility'

// ---------------------------------------------------------------------------
// Probe framework
// ---------------------------------------------------------------------------

/**
 * Each probe receives the real shared utils (lazily imported so --diff mode
 * needs zero workspace deps) and returns { pass, detail }.
 */
const PROBES = [
  // -- aj-geddes Quick Start fixture: use the path module, never hardcode ----
  {
    id: 'quickstart.path-join-homedir',
    origin: 'aj-geddes Quick Start',
    run: (_u, s) => {
      const p = path.join(os.homedir(), 'config', 'app.json')
      return {
        pass: path.isAbsolute(p) && path.basename(p) === 'app.json',
        detail: `${p} (absolute=${path.isAbsolute(p)}, basename=${path.basename(p)})`,
      }
    },
  },
  {
    id: 'quickstart.path-resolve-relative',
    origin: 'aj-geddes Quick Start',
    run: (_u, s) => {
      const p = path.resolve('./config/settings.json')
      return { pass: path.isAbsolute(p) && p.endsWith(path.join('config', 'settings.json')), detail: p }
    },
  },
  {
    id: 'quickstart.path-components',
    origin: 'aj-geddes Quick Start',
    run: (_u, s) => {
      const file = '/path/to/file.txt'
      const base = path.basename(file)
      const ext = path.extname(file)
      const dir = path.dirname(file)
      // basename/extname are separator-agnostic everywhere; dirname must
      // contain the directory part (not the whole path, not empty).
      return {
        pass: base === 'file.txt' && ext === '.txt' && dir.length > 0 && dir !== file && !dir.endsWith('file.txt'),
        detail: `dirname=${dir} basename=${base} extname=${ext}`,
      }
    },
  },
  {
    id: 'quickstart.path-normalize-dotdot',
    origin: 'aj-geddes Quick Start',
    run: (_u, s) => {
      const n = path.normalize('/path/to/../file.txt')
      return {
        pass: !n.includes('..') && n.endsWith('file.txt'),
        detail: `normalize('/path/to/../file.txt') -> ${n}`,
      }
    },
  },
  {
    id: 'quickstart.no-hardcoded-win32-path-on-posix',
    origin: 'aj-geddes Quick Start (BAD example)',
    run: (_u, s) => {
      // The skill's anti-pattern: a hardcoded `C:\...` path must NOT look
      // absolute on non-Windows — that is the classic silent cross-OS break.
      const hardcoded = 'C:\\Users\\user\\config.json'
      const expected = process.platform === 'win32'
      const actual = path.isAbsolute(hardcoded)
      return {
        pass: actual === expected,
        detail: `isAbsolute('${hardcoded}') = ${actual} (expected ${expected} on ${process.platform})`,
      }
    },
  },

  // -- repo bug class: Windows backslash-path leaks --------------------------
  {
    id: 'paths.expandPath-tilde',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const out = u.expandPath('~')
      return { pass: path.isAbsolute(out) && out === os.homedir(), detail: `expandPath('~') -> ${out}` }
    },
  },
  {
    id: 'paths.expandPath-tilde-slash',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const out = u.expandPath('~/Documents')
      return { pass: path.isAbsolute(out) && out.startsWith(os.homedir()), detail: `expandPath('~/Documents') -> ${out}` }
    },
  },
  {
    id: 'paths.expandPath-tilde-backslash',
    origin: 'ARCHstudio paths.ts (win32 portable variant)',
    run: (u) => {
      // toPortablePath produces the ~\ variant on win32; expandPath must
      // handle it on every OS, not just Windows.
      const out = u.expandPath('~\\Documents')
      return { pass: path.isAbsolute(out) && out.startsWith(os.homedir()), detail: `expandPath('~\\\\Documents') -> ${out}` }
    },
  },
  {
    id: 'paths.expandPath-home-env',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const out = u.expandPath('${HOME}/projects')
      return { pass: path.isAbsolute(out) && out.startsWith(os.homedir()), detail: `expandPath('${'${HOME}'}/projects') -> ${out}` }
    },
  },
  {
    id: 'paths.toPortablePath-home',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const out = u.toPortablePath(os.homedir())
      return { pass: out === '~', detail: `toPortablePath(homedir) -> ${out}` }
    },
  },
  {
    id: 'paths.toPortablePath-inside-home',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const out = u.toPortablePath(path.join(os.homedir(), 'docs'))
      return { pass: out.startsWith('~/') && !out.includes(os.homedir()), detail: `toPortablePath(homedir/docs) -> ${out}` }
    },
  },
  {
    id: 'paths.normalizePath-backslashes',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const out = u.normalizePath('C:\\Users\\foo\\bar')
      return { pass: out === 'C:/Users/foo/bar', detail: `normalizePath('C:\\\\Users\\\\foo\\\\bar') -> ${out}` }
    },
  },
  {
    id: 'paths.pathStartsWith-win32-input',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const ok = u.pathStartsWith('C:\\Users\\foo\\file.txt', 'C:\\Users\\foo')
      return { pass: ok, detail: `pathStartsWith('C:\\\\Users\\\\foo\\\\file.txt', 'C:\\\\Users\\\\foo') -> ${ok}` }
    },
  },
  {
    id: 'paths.pathStartsWith-boundary',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      // /home/user2 must NOT start with /home/user (prefix boundary bug).
      const ok = !u.pathStartsWith('/home/user2/file.txt', '/home/user')
      return { pass: ok, detail: `pathStartsWith('/home/user2/file.txt', '/home/user') -> ${!ok}` }
    },
  },
  {
    id: 'paths.stripPathPrefix',
    origin: 'ARCHstudio paths.ts',
    run: (u) => {
      const posix = u.stripPathPrefix('/home/user/docs/file.txt', '/home/user')
      const win = u.stripPathPrefix('C:\\foo\\bar\\baz.txt', 'C:\\foo')
      return {
        pass: posix === 'docs/file.txt' && win === 'bar/baz.txt',
        detail: `posix -> ${posix}, win32 -> ${win}`,
      }
    },
  },

  // -- repo bug class: literal-"undefined" env leaks -------------------------
  {
    id: 'env.sanitize-removes-undefined-and-literal',
    origin: 'ARCHstudio env.ts + env-sanitizer-audit rule',
    run: (u) => {
      const out = u.sanitizeChildProcessEnv({
        KEEP: 'value',
        REMOVE_UNDEFINED: undefined,
        REMOVE_LITERAL: 'undefined',
      })
      return {
        pass: out.KEEP === 'value' && !('REMOVE_UNDEFINED' in out) && !('REMOVE_LITERAL' in out),
        detail: JSON.stringify(out),
      }
    },
  },
  {
    id: 'env.sanitize-processEnv-leak-class',
    origin: 'ARCHstudio env.ts (Windows WSL leak)',
    run: (u) => {
      const leakedKey = 'ARCHSTUDIO_SMOKE_LITERAL_UNDEFINED'
      const prev = process.env[leakedKey]
      process.env[leakedKey] = 'undefined'
      try {
        const sanitized = u.sanitizeChildProcessEnv(process.env)
        return {
          pass: !(leakedKey in sanitized),
          detail: `${leakedKey} present=${leakedKey in sanitized}`,
        }
      } finally {
        if (prev === undefined) delete process.env[leakedKey]
        else process.env[leakedKey] = prev
      }
    },
  },
  {
    id: 'env.sanitize-preserves-sentinel-lookalikes',
    origin: 'ARCHstudio env.test.ts carve-out',
    run: (u) => {
      const out = u.sanitizeChildProcessEnv({
        UPPERCASE: 'UNDEFINED',
        WHITESPACE: ' undefined ',
        EMPTY: '',
      })
      return {
        pass: out.UPPERCASE === 'UNDEFINED' && out.WHITESPACE === ' undefined ' && out.EMPTY === '',
        detail: JSON.stringify(out),
      }
    },
  },
  {
    id: 'spawn.child-sees-sanitized-env',
    origin: 'ARCHstudio spawn pipeline (end-to-end)',
    run: (u) => {
      // Spawn a real child with the sanitized env and assert the literal
      // "undefined" sentinel never reaches it — the full pipeline check.
      const leakedKey = 'ARCHSTUDIO_SMOKE_CHILD_LEAK'
      const prev = process.env[leakedKey]
      process.env[leakedKey] = 'undefined'
      try {
        const res = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(process.env))`], {
          env: u.sanitizeChildProcessEnv(process.env),
          encoding: 'utf8',
          timeout: 30_000,
        })
        if (res.status !== 0) {
          return { pass: false, detail: `child exited ${res.status}: ${String(res.stderr).slice(0, 300)}` }
        }
        const childEnv = JSON.parse(res.stdout)
        const leaked = Object.entries(childEnv).filter(([, v]) => v === 'undefined').map(([k]) => k)
        return {
          pass: leaked.length === 0,
          detail: leaked.length ? `child env contained literal 'undefined' for: ${leaked.join(', ')}` : 'child env clean',
        }
      } finally {
        if (prev === undefined) delete process.env[leakedKey]
        else process.env[leakedKey] = prev
      }
    },
  },

  // -- platform sanity (aj-geddes testing-across-platforms reference) --------
  {
    id: 'platform.class-and-separator',
    origin: 'aj-geddes testing-across-platforms reference',
    run: () => {
      const known = ['win32', 'darwin', 'linux'].includes(process.platform)
      const expectedSep = process.platform === 'win32' ? '\\' : '/'
      return {
        pass: known && path.sep === expectedSep,
        detail: `platform=${process.platform} sep=${path.sep} (expected ${expectedSep})`,
      }
    },
  },
]

// ---------------------------------------------------------------------------
// Run mode
// ---------------------------------------------------------------------------

async function loadShared() {
  const utils = await import('@archstudio/shared/utils')
  return {
    expandPath: utils.expandPath,
    toPortablePath: utils.toPortablePath,
    normalizePath: utils.normalizePath,
    pathStartsWith: utils.pathStartsWith,
    stripPathPrefix: utils.stripPathPrefix,
    sanitizeChildProcessEnv: utils.sanitizeChildProcessEnv,
  }
}

async function runProbes() {
  const shared = await loadShared()
  const results = []
  for (const probe of PROBES) {
    try {
      const r = await probe.run(shared, {})
      results.push({ id: probe.id, origin: probe.origin, pass: !!r.pass, detail: String(r.detail ?? '') })
    } catch (err) {
      results.push({ id: probe.id, origin: probe.origin, pass: false, detail: `threw: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  return results
}

function buildReport(results) {
  const passed = results.filter(r => r.pass).length
  return {
    tool: TOOL,
    skill: SKILL,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    timestamp: new Date().toISOString(),
    summary: { total: results.length, passed },
    probes: results,
  }
}

function printTable(results) {
  const rows = results.map(r => `  [${r.pass ? 'PASS' : 'FAIL'}] ${r.id}  ${r.detail}`)
  const summary = results.filter(r => r.pass).length
  console.log(`${TOOL} on ${process.platform}-${process.arch}: ${summary}/${results.length} probes passed`)
  for (const row of rows) console.log(row)
}

async function mainRun(jsonPath) {
  const results = await runProbes()
  printTable(results)
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify(buildReport(results), null, 2))
    console.log(`${TOOL}: report written to ${jsonPath}`)
  }
  const failed = results.filter(r => !r.pass)
  if (failed.length > 0) {
    console.error(`${TOOL}: ${failed.length} probe(s) FAILED on ${process.platform}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Diff mode — compare reports from multiple OSes
// ---------------------------------------------------------------------------

function loadReport(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return { file, platform: file, parseError: `unreadable: ${err instanceof Error ? err.message : String(err)}`, probes: [] }
  }
  try {
    const parsed = JSON.parse(raw)
    return {
      file,
      platform: String(parsed.platform ?? file),
      probes: Array.isArray(parsed.probes) ? parsed.probes : [],
    }
  } catch (err) {
    return { file, platform: file, parseError: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`, probes: [] }
  }
}

// Extract the OS name from a report's filename (smoke-report-<os>.json) —
// the join key the CI artifact upload preserves. Returns null for files that
// don't follow the convention, so an ad-hoc local --diff (no --expected-os)
// never fabricates OS names.
function osFromFilename(file) {
  const base = path.basename(file)
  const prefix = 'smoke-report-'
  if (!base.startsWith(prefix) || !base.endsWith('.json')) return null
  return base.slice(prefix.length, -'.json'.length)
}

function mainDiff(files, expectedOses) {
  if (!expectedOses && files.length < 2) {
    console.error(`${TOOL}: --diff requires at least two report files`)
    process.exit(2)
  }
  const reports = files.map(loadReport)

  // Collect per-probe observations keyed by report INDEX (not platform): two
  // reports from the same OS (e.g. local re-runs) must compare independently.
  const byProbe = new Map() // id -> Array<{ idx, platform, pass, detail }>
  for (const [idx, report] of reports.entries()) {
    for (const probe of report.probes) {
      if (!byProbe.has(probe.id)) byProbe.set(probe.id, [])
      byProbe.get(probe.id).push({
        idx,
        platform: report.platform,
        pass: !!probe.pass,
        detail: String(probe.detail ?? ''),
      })
    }
  }

  const divergences = []

  // Missing-report detection: when the caller names the expected OS set
  // (matrix values, joined on the smoke-report-<os>.json filename), a leg
  // that died before uploading is named here instead of silently vanishing
  // from the diff. This keeps fail-closed in the script, not the workflow.
  if (expectedOses) {
    const provided = new Set(reports.map(r => osFromFilename(r.file)).filter(Boolean))
    for (const os of expectedOses) {
      if (!provided.has(os)) divergences.push(`  ! report for ${os} is missing`)
    }
  }

  for (const report of reports) {
    if (report.parseError) divergences.push(`  ! report ${report.file}: ${report.parseError}`)
  }

  for (const [id, observations] of byProbe) {
    const failed = observations.filter(o => !o.pass)
    const passStates = new Set(observations.map(o => o.pass))
    if (observations.length < reports.length) {
      // Probe missing from at least one report.
      const present = observations.map(o => o.platform).join(', ')
      divergences.push(`  ! ${id}: missing from some reports (present on ${present})`)
    } else if (passStates.size > 1) {
      // Passes on one OS, fails on another — the named-divergence contract.
      const detail = observations.map(o => `${o.platform}=${o.pass ? 'pass' : 'FAIL'}`).join(', ')
      const failedDetail = failed.map(o => o.detail).join(' | ')
      divergences.push(`  ! ${id}: divergent across OSes (${detail})  [${failedDetail}]`)
    } else if (failed.length > 0) {
      const detail = failed.map(o => o.detail).join(' | ')
      divergences.push(`  ! ${id}: FAILS on every OS  [${detail}]`)
    }
  }

  if (divergences.length > 0) {
    console.log(`${TOOL}: divergence detected across ${reports.length} report(s):`)
    for (const line of divergences) console.log(line)
    process.exit(1)
  }
  console.log(`${TOOL}: no divergence across ${reports.map(r => r.platform).join(', ')} (${[...byProbe.keys()].length} probes compared)`)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`Usage:
  ${TOOL}                     run probes; exit 1 if any fail on this OS
  ${TOOL} --json <file>       also write a machine-readable report JSON
  ${TOOL} --diff <files...>   compare 2+ report JSONs; exit 1 on divergence
  ${TOOL} --diff --expected-os <os1,os2,...> <files...>
                              also exit 1 when an expected OS has no report
                              file (matched by the smoke-report-<os>.json name)
  ${TOOL} --help              show this help
`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    usage()
    process.exit(0)
  }
  const diffIdx = args.indexOf('--diff')
  if (diffIdx !== -1) {
    const rest = args.slice(diffIdx + 1)
    const files = []
    let expectedOses = null
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]
      if (a === '--expected-os') {
        const val = rest[i + 1]
        if (val && !val.startsWith('--')) {
          expectedOses = val.split(',').map(s => s.trim()).filter(Boolean)
          i++
        }
      } else if (!a.startsWith('--')) {
        files.push(a)
      }
    }
    mainDiff(files, expectedOses && expectedOses.length ? expectedOses : null)
    return
  }
  const jsonIdx = args.indexOf('--json')
  const jsonPath = jsonIdx !== -1 ? args[jsonIdx + 1] : null
  await mainRun(jsonPath)
}

main().catch(err => {
  console.error(`${TOOL}: fatal: ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
