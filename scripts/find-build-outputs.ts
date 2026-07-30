#!/usr/bin/env bun
/**
 * scripts/find-build-outputs.ts
 *
 * Audit script: walks every package.json (under workspaces), every config
 * file (tsconfig*.json, vite.config.*), and the string literals inside
 * scripts/build/*.ts to discover every directory where the repo's build
 * pipeline emits artifacts. Emits the UNION as the
 * `[test] pathIgnorePatterns` array in bunfig.toml so `bun test`'s default
 * discovery never wastes time scanning staged source copies / transpiled
 * bundles / copy-of-source-trees that the build pipeline wrote.
 *
 * Run --check (default, mirrors the mock:audit gate) to verify that the
 * in-bunfig.toml array matches the auto-discovered union; exits 1 on
 * drift. Run with --write to rewrite the array when drift is detected:
 *
 *   bun run config:refresh-excludes          # check, exit 1 on drift
 *   bun run config:refresh-excludes:write    # rewrite bunfig.toml
 *
 * The intent: when a new package adds a new build-output convention,
 * the next `config:refresh-excludes` reveals the drift so the
 * exclusion list can be refreshed -- the list itself can't silently
 * fall out of date.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const BUNFIG = join(ROOT, 'bunfig.toml')

// -- Canonical baseline -------------------------------------------------
// Seeded entries that ALWAYS belong in the union -- they correspond to
// known build outputs in this codebase and act as defense-in-depth even
// if the auto-discovery below misses a producer (e.g. a script deleted
// in a refactor but the dir still gets written by another tool).
const SEEDED: ReadonlyArray<{ dir: string; reason: string }> = [
  { dir: 'dist', reason: "esbuild / vite / `bun build --target node`" },
  { dir: 'release', reason: 'electron-builder win-unpacked/mac/linux-unpacked' },
  { dir: '.build', reason: 'scripts/build/common.ts upload manifest dir' },
  {
    dir: 'out-tsc',
    reason: "`tsc --outDir` from a noEmit:false tsconfig (defensive -- none today)",
  },
]

const args = process.argv.slice(2)
const MODE: '--check' | '--write' = args.includes('--write')
  ? '--write'
  : '--check'

interface Hit {
  /** Top-level output directory name (e.g. `dist`). */
  dir: string
  /** Producer (file path relative to project). */
  producer: string
}

const hits: Hit[] = []
const seen = new Set<string>()

function push(dir: string, producer: string): void {
  if (!dir || seen.has(dir)) return
  seen.add(dir)
  hits.push({ dir, producer })
}

// -- Discovery helpers --------------------------------------------------

/** Skip these when walking workspace directories. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.bun'])

function isSelfFile(p: string): boolean {
  const base = relative(ROOT, p)
  return base === 'scripts/find-build-outputs.ts'
}

function stripNoiseForHarvest(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\$\{[^}]*\}/g, ' ')
}

function isPathLike(s: string): boolean {
  if (!s) return false
  if (s === '...') return false
  if (/\s/.test(s)) return false
  if (s.includes('$')) return false
  if (s.includes('/') || s.includes('\\')) return true
  return SEEDED.some(seed => seed.dir === s)
}

function isSkipped(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

function walkWorkspaces(): void {
  for (const wsRoot of ['apps', 'packages']) {
    const wsAbs = join(ROOT, wsRoot)
    if (!existsSync(wsAbs)) continue
    for (const entry of readdirSync(wsAbs)) {
      if (isSkipped(entry)) continue
      if (entry === 'online-docs') continue
      const sub = join(wsAbs, entry)
      let s: ReturnType<typeof statSync>
      try {
        s = statSync(sub)
      } catch {
        continue
      }
      if (!s.isDirectory()) continue

      const pkgPath = join(sub, 'package.json')
      if (existsSync(pkgPath)) {
        harvestPackageJson(pkgPath)
      }
      harvestWorkspaceConfigs(sub)
    }
  }
  const rootPkg = join(ROOT, 'package.json')
  if (existsSync(rootPkg)) harvestPackageJson(rootPkg)
}

function harvestWorkspaceConfigs(wsDir: string): void {
  for (const name of readdirSync(wsDir)) {
    if (isSkipped(name)) continue
    if (name === 'tsconfig.json' || /^tsconfig\.[^/]+\.json$/.test(name)) {
      harvestTsconfig(join(wsDir, name))
    }
    if (name === 'vite.config.ts' || name === 'vite.config.mts') {
      harvestViteConfig(join(wsDir, name))
    }
    if (name === 'electron-builder.yml' || name === 'electron-builder.yaml') {
      harvestElectronBuilderConfig(join(wsDir, name))
    }
  }
}

function harvestPackageJson(pkgPath: string): void {
  let pkg: any
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch {
    return
  }
  for (const [name, script] of Object.entries<string>(pkg.scripts ?? {})) {
    harvestScriptString(
      script,
      `package.json[${name}]: ${relative(ROOT, pkgPath)}`,
    )
  }
}

function harvestScriptString(s: string, producer: string): void {
  const cleaned = stripNoiseForHarvest(s)
  const flagRe = /--out(?:file|dir)\s*=?\s*['"]?([^\s'"`,}]+)['"]?/g
  let m: RegExpExecArray | null
  while ((m = flagRe.exec(cleaned)) !== null) {
    if (!isPathLike(m[1]!)) continue
    const dir = topLevelDir(m[1]!)
    if (dir) push(dir, producer)
  }
  const outDirRe = /\boutDir\s*[:=]\s*['"]([^'"]+)['"]/g
  while ((m = outDirRe.exec(cleaned)) !== null) {
    if (!isPathLike(m[1]!)) continue
    const dir = topLevelDir(m[1]!)
    if (dir) push(dir, producer)
  }
}

function harvestTsconfig(p: string): void {
  let text: string
  try {
    text = readFileSync(p, 'utf-8')
  } catch {
    return
  }
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  let obj: any
  try {
    obj = JSON.parse(stripped)
  } catch {
    return
  }
  const od = obj?.compilerOptions?.outDir
  if (typeof od === 'string') {
    const dir = topLevelDir(od)
    if (dir) push(dir, `tsconfig outDir: ${relative(ROOT, p)}`)
  }
}

function harvestViteConfig(p: string): void {
  let text: string
  try {
    text = readFileSync(p, 'utf-8')
  } catch {
    return
  }
  const re = /\boutDir\s*[:=]\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const dir = topLevelDir(m[1]!)
    if (dir) push(dir, `vite build.outDir: ${relative(ROOT, p)}`)
  }
}

function harvestElectronBuilderConfig(p: string): void {
  let text: string
  try {
    text = readFileSync(p, 'utf-8')
  } catch {
    return
  }
  const m = /^\s*output\s*:\s*['"]?([^'"\s#]+)/m.exec(text)
  if (!m || !m[1]) return
  const dir = topLevelDir(m[1]!)
  if (dir) push(dir, `electron-builder output: ${relative(ROOT, p)}`)
}

function harvestScriptsBuildTs(): void {
  const buildDir = join(ROOT, 'scripts', 'build')
  if (!existsSync(buildDir)) return
  for (const f of readdirSync(buildDir)) {
    if (!/\.(ts|mjs|cjs|js)$/.test(f)) continue
    const full = join(buildDir, f)
    if (isSelfFile(full)) continue
    let text: string
    try {
      text = readFileSync(full, 'utf-8')
    } catch {
      continue
    }
    harvestScriptString(text, `scripts/build/${f}`)
  }
}

function topLevelDir(p: string): string | null {
  const trimmed = p.replace(/^\.\//, '').replace(/^[/\\]+/, '')
  if (!trimmed) return null
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return null
  const segs = trimmed.split(/[/\\]+/).filter(Boolean)
  if (!segs.length) return null
  for (const seg of segs) {
    if (SEEDED.some(s => s.dir === seg)) return seg
  }
  return segs[0]!
}

// ── Metadata helpers ────────────────────────────────────────────────

/**
 * Regex that matches the entire [[config.test.excludePaths]] metadata
 * block in bunfig.toml, from the comment header to the [install] section.
 */
// Match the metadata comment header in bunfig.toml.
// The header uses Unicode box-drawing characters (U+2500 "─"):
//   # ── Exclusion metadata ─────────────────────
// Match the metadata comment header in bunfig.toml.
// The header uses Unicode box-drawing characters (U+2500 "─"):
//   # ── Exclusion metadata ─────────────────────
//
// Terminators: the [install] section header OR the inline comment
// that precedes it.  We intentionally omit \n$ because with the m
// flag $ matches end-of-line, which fires at the first blank line
// between [[config.test.excludePaths]] blocks and truncates the match.
const META_SECTION_RE =
  /^# ── Exclusion metadata[\s\S]*?(?=\n# Use the hoisted linker|\n\[install\])/m

/** Build a pattern-to-reason map from hits + SEEDED. */
function buildReasonMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const s of SEEDED) map.set(s.dir, s.reason)
  for (const h of hits) {
    if (!map.has(h.dir)) map.set(h.dir, h.producer)
  }
  return map
}

/** Read existing [[config.test.excludePaths]] entries to preserve since dates. */
function readExistingSince(tomlText: string): Map<string, string> {
  const map = new Map<string, string>()
  const sectionMatch = META_SECTION_RE.exec(tomlText)
  if (!sectionMatch) return map
  // Terminates on the next [[ block or end-of-string.
  // NOTE: no `m` flag — $ must match end-of-string, not end-of-line,
  // so blank lines between TOML blocks don't truncate the match.
  const blockRe =
    /\[\[config\.test\.excludePaths\]\]\s*\n([\s\S]*?)(?=\n\[\[|$)/g
  let bm: RegExpExecArray | null
  while ((bm = blockRe.exec(sectionMatch[0])) !== null) {
    const pm = /^\s*pattern\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(bm[1]!)
    const sm = /^\s*since\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(bm[1]!)
    if (pm && sm) map.set(pm[1]!, sm[1]!)
  }
  return map
}

/** Render the full metadata block (comment header + entries). */
function renderMetadataBlock(
  union: string[],
  reasonMap: Map<string, string>,
  existingSince: Map<string, string>,
): string {
  const today = new Date().toISOString().slice(0, 10)
  const entries = union
    .map((dir) => {
      const reason = reasonMap.get(dir) ?? 'auto-discovered build output'
      const safeReason = reason.replace(/`/g, "'")
      const since = existingSince.get(dir) ?? today
      return (
        `[[config.test.excludePaths]]\n` +
        `pattern = "${dir}"\n` +
        `reason  = "${safeReason}"\n` +
        `since   = "${since}"`
      )
    })
    .join('\n\n')

  return (
    `# ── Exclusion metadata ─────────────────────────────────────────\n` +
    `# Auto-managed by \`bun run config:refresh-excludes\`. Each entry mirrors\n` +
    `# a pattern in [test].pathIgnorePatterns above, but carries provenance\n` +
    `# so the test-setup preloader can explain *why* a path is hidden, and\n` +
    `# \`bun run test:why-excluded <glob>\` can look it up.\n` +
    `#\n` +
    `# Run \`bun run config:refresh-excludes:write\` to regenerate both the\n` +
    `# pathIgnorePatterns array and this metadata section in one pass.\n` +
    entries + '\n'
  )
}

/** Check if [[config.test.excludePaths]] patterns match the union. */
function checkMetadataParity(
  tomlText: string,
  union: string[],
): { ok: boolean; inMetaNotUnion: string[]; inUnionNotMeta: string[] } {
  const sectionMatch = META_SECTION_RE.exec(tomlText)
  if (!sectionMatch) {
    return { ok: false, inMetaNotUnion: [], inUnionNotMeta: [...union] }
  }
  const metaPatterns: string[] = []
  const metaRe = /^\s*pattern\s*=\s*['"]([^'"]+)['"]\s*$/gm
  let pm: RegExpExecArray | null
  while ((pm = metaRe.exec(sectionMatch[0])) !== null) {
    metaPatterns.push(pm[1]!)
  }
  const metaSorted = [...metaPatterns].sort()
  const unionSorted = [...union].sort()
  const ok =
    metaSorted.length === unionSorted.length &&
    metaSorted.every((e, i) => unionSorted[i] === e)
  return {
    ok,
    inMetaNotUnion: metaSorted.filter((e) => !unionSorted.includes(e)),
    inUnionNotMeta: unionSorted.filter((e) => !metaSorted.includes(e)),
  }
}

// ── Main ──────────────────────────────────────────────────────────────

walkWorkspaces()
harvestScriptsBuildTs()

for (const s of SEEDED) push(s.dir, s.reason)

const union = Array.from(new Set(hits.map(h => h.dir))).sort((a, b) =>
  a.localeCompare(b),
)

const bunfigText = readFileSync(BUNFIG, 'utf-8')

const ARRAY_RE = /^pathIgnorePatterns\s*=\s*\[\s*\n([\s\S]*?)\n^\s*\]/m
const m = ARRAY_RE.exec(bunfigText)
if (!m) {
  console.error(
    `could not locate pathIgnorePatterns = [...] array in [test] block of bunfig.toml`,
  )
  console.error(`  Add the array manually before running --write.`)
  process.exit(2)
}

function parseExistingEntries(body: string): string[] {
  return body
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const match = /^['"]([^'"]+)['"](,)?$/.exec(line)
      return match ? match[1]! : null
    })
    .filter((v): v is string => v !== null)
}

const currentEntries = parseExistingEntries(m[1]!)
const sameSet =
  currentEntries.length === union.length &&
  currentEntries.every((e, i) => union[i] === e)

// ── Report ────────────────────────────────────────────────────────────

console.log(`build-output discovery -- ${hits.length} hit(s) across ${union.length} dir(s):`)
for (const h of hits) {
  console.log(`  + ${h.dir.padEnd(10)}  <- ${h.producer}`)
}
console.log('')
console.log(`union:`)
for (const g of union) console.log(`  **/${g}/**`)
console.log('')

if (sameSet) {
  console.log(`pathIgnorePatterns in bunfig.toml matches the union.`)

  const { ok, inMetaNotUnion, inUnionNotMeta } = checkMetadataParity(bunfigText, union)
  if (ok) {
    console.log(`[[config.test.excludePaths]] metadata matches the union.`)
    if (MODE === '--write') {
      console.log(`  (already in sync, no write performed)`)
    }
    process.exit(0)
  }

  console.log(`[[config.test.excludePaths]] metadata drift:`)
  if (inMetaNotUnion.length) {
    console.log(`  in metadata, not in union: ${inMetaNotUnion.join(', ')}`)
  }
  if (inUnionNotMeta.length) {
    console.log(`  in union, not in metadata: ${inUnionNotMeta.join(', ')}`)
  }

  if (MODE === '--check') {
    console.log(`  Run \`bun run config:refresh-excludes:write\` to refresh.`)
    process.exit(1)
  }

  // --write: only metadata is stale, regenerate it in place
  const reasonMap = buildReasonMap()
  const existingSince = readExistingSince(bunfigText)
  const newMetaBlock = renderMetadataBlock(union, reasonMap, existingSince)
  let updatedBunfig = bunfigText
  if (META_SECTION_RE.test(bunfigText)) {
    updatedBunfig = updatedBunfig.replace(META_SECTION_RE, newMetaBlock)
  }
  writeFileSync(BUNFIG, updatedBunfig)
  console.log(`\nregenerated [[config.test.excludePaths]] metadata (since dates preserved)`)
  process.exit(0)
}

// ── Drift: pathIgnorePatterns differs from union ────────────────────

console.log(`drift detected:`)
const inCurrentNotDesired = currentEntries.filter(e => !union.includes(e))
const inDesiredNotCurrent = union.filter(e => !currentEntries.includes(e))
if (inCurrentNotDesired.length) {
  console.log(`  in bunfig.toml, not in union:`)
  for (const e of inCurrentNotDesired) console.log(`    - ${e}`)
}
if (inDesiredNotCurrent.length) {
  console.log(`  in union, not in bunfig.toml:`)
  for (const e of inDesiredNotCurrent) console.log(`    + ${e}`)
}

if (MODE === '--check') {
  console.log('')
  console.log(`Run \`bun run config:refresh-excludes:write\` to refresh.`)
  process.exit(1)
}

// --write: rewrite both pathIgnorePatterns and metadata
const desiredLines = union.map(g => `  "${g}",`).join('\n')
const desiredBlock = `pathIgnorePatterns = [\n${desiredLines}\n]`
let newBunfig = bunfigText.replace(ARRAY_RE, desiredBlock)

const reasonMap = buildReasonMap()
const existingSince = readExistingSince(bunfigText)
const newMetaBlock = renderMetadataBlock(union, reasonMap, existingSince)

if (META_SECTION_RE.test(newBunfig)) {
  newBunfig = newBunfig.replace(META_SECTION_RE, newMetaBlock)
} else {
  // Insert metadata section right after pathIgnorePatterns array.
  newBunfig = newBunfig.replace(
    /pathIgnorePatterns\s*=\s*\[[\s\S]*?\]/,
    (match) => match + '\n\n' + newMetaBlock,
  )
}

writeFileSync(BUNFIG, newBunfig)
console.log('')
console.log(
  `wrote ${union.length} entries to bunfig.toml [test].pathIgnorePatterns`,
)
console.log(
  `wrote ${union.length} [[config.test.excludePaths]] metadata entries`,
)
