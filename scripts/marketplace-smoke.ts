#!/usr/bin/env bun
/**
 * Clean-profile smoke for marketplace catalog + installer (M4 / finish D4).
 *
 * Zero-network: remote fetch is forced to fail; catalog falls back to bundled.
 * Install uses a fake git execFileFn (same pattern as installer.test.ts).
 *
 * Requires an external CRAFT_CONFIG_DIR under /tmp (never touch real ~/.craft-agent):
 *   CRAFT_CONFIG_DIR=$(mktemp -d /tmp/mp.XXXX) bun scripts/marketplace-smoke.ts
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ExecFileFn } from '../packages/shared/src/marketplace/installer.ts'

const CRAFT_CONFIG_DIR = process.env.CRAFT_CONFIG_DIR
if (!CRAFT_CONFIG_DIR || !CRAFT_CONFIG_DIR.startsWith('/tmp/')) {
  console.error(
    'FAIL: set CRAFT_CONFIG_DIR to a fresh /tmp/... directory (e.g. $(mktemp -d /tmp/mp.XXXX))',
  )
  process.exit(2)
}

const REPO_ROOT = resolve(import.meta.dir, '..')
const ELECTRON_ROOT = join(REPO_ROOT, 'apps', 'electron')
const BUNDLED_CATALOG = join(ELECTRON_ROOT, 'resources', 'marketplace', 'catalog.json')
const REF = 'd'.repeat(40)

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []

function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail })
  if (!ok) console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`)
  else console.log(`  ✓ ${name}${detail ? `: ${detail}` : ''}`)
}

// Minimal config so storage getters do not no-op.
if (!existsSync(join(CRAFT_CONFIG_DIR, 'config.json'))) {
  mkdirSync(CRAFT_CONFIG_DIR, { recursive: true })
  writeFileSync(
    join(CRAFT_CONFIG_DIR, 'config.json'),
    JSON.stringify({ version: 1 }, null, 2),
  )
}

const { setBundledAssetsRoot } = await import('../packages/shared/src/utils/paths.ts')
setBundledAssetsRoot(ELECTRON_ROOT)

const { CONFIG_DIR } = await import('../packages/shared/src/config/paths.ts')
check(
  'config_dir_external',
  CONFIG_DIR === CRAFT_CONFIG_DIR || CONFIG_DIR.startsWith(CRAFT_CONFIG_DIR),
  `CONFIG_DIR=${CONFIG_DIR}`,
)

const {
  createMemoryMetaStore,
  getCatalog,
  marketplacePaths,
  parseCatalog,
} = await import('../packages/shared/src/marketplace/catalog.ts')
// Dynamic import: CONFIG_DIR is locked by bunfig preload before static imports would run.
const { installEntry, removeEntry } = await import('../packages/shared/src/marketplace/installer.ts')
const { readLock } = await import('../packages/shared/src/marketplace/lock.ts')

// 1) Failing remote → bundled origin, entries > 0
const failingFetch = async () => {
  throw new Error('network disabled for marketplace-smoke')
}

const catalogResult = await getCatalog({
  configDir: CRAFT_CONFIG_DIR,
  metaStore: createMemoryMetaStore(),
  fetchFn: failingFetch,
  bundledCatalogPath: existsSync(BUNDLED_CATALOG) ? BUNDLED_CATALOG : undefined,
})

check(
  'catalog_origin_bundled',
  catalogResult.origin === 'bundled',
  `origin=${catalogResult.origin} err=${catalogResult.error ?? '-'}`,
)
check(
  'catalog_entries_nonempty',
  catalogResult.catalog.entries.length > 0,
  `n=${catalogResult.catalog.entries.length}`,
)

// 2) parseCatalog on bundled succeeds; skillpack/context-doc pins when present
check('bundled_catalog_on_disk', existsSync(BUNDLED_CATALOG), BUNDLED_CATALOG)

let parseOk = false
let pinIssues: string[] = []
try {
  const raw = JSON.parse(await Bun.file(BUNDLED_CATALOG).text()) as unknown
  const catalog = parseCatalog(raw)
  parseOk = catalog.entries.length > 0
  const SHA256_RE = /^[0-9a-f]{64}$/
  for (const entry of catalog.entries) {
    if (entry.kind !== 'skillpack' && entry.kind !== 'context-doc') continue
    const pins = entry.expectedContentSha256
    if (!pins || typeof pins !== 'object' || Array.isArray(pins)) {
      // Robust: if peer A1 not landed, do not hard-fail the whole smoke —
      // note and continue. When pins exist they must be well-formed.
      pinIssues.push(`${entry.id}: missing expectedContentSha256`)
      continue
    }
    const keys = Object.keys(pins)
    if (keys.length === 0) {
      pinIssues.push(`${entry.id}: empty pin map`)
      continue
    }
    for (const [k, v] of Object.entries(pins)) {
      if (typeof v !== 'string' || !SHA256_RE.test(v)) {
        pinIssues.push(`${entry.id}.${k}: bad digest`)
      }
    }
  }
  check('parse_catalog_bundled', parseOk, `entries=${catalog.entries.length}`)
  // Soft: report pin coverage; fail only on malformed digests (not missing pins during parallel land).
  const malformed = pinIssues.filter((i) => i.includes('bad digest'))
  check(
    'skillpack_context_doc_pins',
    malformed.length === 0,
    pinIssues.length
      ? `issues=${pinIssues.length} sample=${pinIssues.slice(0, 3).join('; ')}`
      : 'all pinned entries well-formed',
  )
} catch (err) {
  check('parse_catalog_bundled', false, err instanceof Error ? err.message : String(err))
  check('skillpack_context_doc_pins', false, 'parse failed')
}

// 3) Synthetic installEntry (directory skillpack) with fake git — lock + path, then remove
const skillsDir = join(CRAFT_CONFIG_DIR, 'agents-skills-mp')
mkdirSync(skillsDir, { recursive: true })

const PACK_ENTRY = {
  id: 'smoke-mega-pack',
  kind: 'skillpack' as const,
  title: 'Smoke Mega Pack',
  descriptionRu: 'Синтетический пакет для smoke',
  source: { type: 'github' as const, repo: 'owner/smoke-pack', ref: REF },
  installMode: 'directory' as const,
}

const fakeGit: ExecFileFn = async (_file, args, options) => {
  if (args.includes('checkout')) {
    const cwd = options.cwd!
    writeFileSync(join(cwd, 'SKILL.md'), '# Smoke Mega Skill\n')
    mkdirSync(join(cwd, 'docs'), { recursive: true })
    writeFileSync(join(cwd, 'docs', 'GUIDE.md'), 'guide')
  }
  return { stdout: args[0] === 'rev-parse' ? `${REF}\n` : '', stderr: '' }
}

let installOk = false
try {
  const result = await installEntry(PACK_ENTRY, {
    configDir: CRAFT_CONFIG_DIR,
    skillsDir,
    execFileFn: fakeGit,
    now: () => 1_700_000_000_000,
  })
  const target = join(skillsDir, 'smoke-mega-pack')
  const lock = readLock(marketplacePaths(CRAFT_CONFIG_DIR).lockFile)
  const rec = lock.entries['smoke-mega-pack']
  installOk =
    result.status === 'installed' &&
    existsSync(join(target, 'SKILL.md')) &&
    rec?.status === 'installed' &&
    rec.ref === REF
  check(
    'install_entry_synthetic',
    installOk,
    `status=${result.status} path=${target} lock=${rec?.status ?? 'missing'}`,
  )
} catch (err) {
  check('install_entry_synthetic', false, err instanceof Error ? err.message : String(err))
}

let removeOk = false
try {
  const removed = removeEntry('smoke-mega-pack', { configDir: CRAFT_CONFIG_DIR })
  const lock = readLock(marketplacePaths(CRAFT_CONFIG_DIR).lockFile)
  const target = join(skillsDir, 'smoke-mega-pack')
  removeOk =
    (removed.status === 'removed' || removed.status === 'partial') &&
    !lock.entries['smoke-mega-pack'] &&
    !existsSync(target)
  check(
    'remove_entry_clean',
    removeOk,
    `status=${removed.status} removed=${removed.removed.length} kept=${removed.kept.length}`,
  )
} catch (err) {
  check('remove_entry_clean', false, err instanceof Error ? err.message : String(err))
}

// Staging cleanup
const tmpDir = marketplacePaths(CRAFT_CONFIG_DIR).tmpDir
const tmpLeft = existsSync(tmpDir) ? readdirSync(tmpDir) : []
check('staging_tmp_clean', tmpLeft.length === 0, tmpLeft.join(',') || '(empty)')

// Best-effort wipe of synthetic skills dir under config
try {
  rmSync(skillsDir, { recursive: true, force: true })
} catch {
  /* ignore */
}

const failed = checks.filter((c) => !c.ok)
const summary = {
  ok: failed.length === 0,
  configDir: CRAFT_CONFIG_DIR,
  electronRoot: ELECTRON_ROOT,
  catalogOrigin: catalogResult.origin,
  catalogEntries: catalogResult.catalog.entries.length,
  pinIssues,
  checks,
}

console.log(JSON.stringify(summary, null, 2))

if (failed.length) {
  console.error(`FAIL: ${failed.map((f) => f.name).join(', ')}`)
  process.exit(1)
}

console.log('OK: marketplace smoke passed')
process.exit(0)
