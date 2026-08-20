#!/usr/bin/env bun
/**
 * scripts/marketplace-content-sha.ts — pin expectedContentSha256 for marketplace catalog entries.
 *
 * For each skillpack / context-doc entry in
 * apps/electron/resources/marketplace/catalog.json:
 *   1. checkout the pinned github ref (same depth-1 fetch as installer)
 *   2. hash with the SAME algorithms as packages/shared marketplace installer
 *   3. write expectedContentSha256 onto the entry
 *
 * Pin keys mirror installer verify:
 *   - skillpack directory mode → entry.id → sha256Directory(checkout)
 *   - skillpack skills mode    → skill basename (scanSkillDirs) → sha256Directory(skillDir)
 *   - context-doc              → documents[].targetName → sha256FileContent(repoPath body)
 *
 * Failures are logged and skipped (partial pin is OK). Tools are ignored.
 *
 * After rewriting catalog.json, also writes:
 *   - catalog.json.sha256 (GNU shasum format) for body digest verify
 *   - catalog.json.sig when CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY or
 *     scripts/.marketplace-catalog-signing-key.b64 is available (ed25519)
 *
 * Usage:
 *   bun scripts/marketplace-content-sha.ts
 *   bun scripts/marketplace-content-sha.ts --only next-skills,superpowers
 *   bun scripts/marketplace-content-sha.ts --dry-run
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkoutPinnedRef,
  scanSkillDirs,
  sha256Directory,
  sha256FileContent,
} from '../packages/shared/src/marketplace/installer.ts'
import { parseCatalog, sha256HexOfString, type MarketplaceCatalog, type MarketplaceEntry } from '../packages/shared/src/marketplace/catalog.ts'
import { signCatalogBody } from '../packages/shared/src/marketplace/catalog-signing.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CATALOG = join(REPO_ROOT, 'apps/electron/resources/marketplace/catalog.json')

function parseArgs(argv: string[]): { only: Set<string> | null; dryRun: boolean; catalogPath: string } {
  let only: Set<string> | null = null
  let dryRun = false
  let catalogPath = DEFAULT_CATALOG
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--dry-run') dryRun = true
    else if (a === '--only') {
      const v = argv[++i]
      if (!v) throw new Error('--only requires a comma-separated id list')
      only = new Set(v.split(',').map((s) => s.trim()).filter(Boolean))
    } else if (a === '--catalog') {
      const v = argv[++i]
      if (!v) throw new Error('--catalog requires a path')
      catalogPath = resolve(v)
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: bun scripts/marketplace-content-sha.ts [--only id1,id2] [--catalog path] [--dry-run]`)
      process.exit(0)
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }
  return { only, dryRun, catalogPath }
}

function log(msg: string): void {
  console.log(msg)
}

function warn(msg: string): void {
  console.warn(msg)
}

async function pinEntry(entry: MarketplaceEntry, workRoot: string): Promise<Record<string, string> | null> {
  const staging = join(workRoot, `${entry.id}-${entry.source.ref.slice(0, 12)}`)
  try {
    log(`  checkout ${entry.source.repo}@${entry.source.ref.slice(0, 8)}…`)
    await checkoutPinnedRef(entry.source.repo, entry.source.ref, staging)

    if (entry.kind === 'context-doc') {
      const pins: Record<string, string> = {}
      for (const doc of entry.documents ?? []) {
        const filePath = join(staging, doc.repoPath)
        if (!existsSync(filePath)) {
          throw new Error(`missing document ${doc.repoPath} in checkout`)
        }
        const body = readFileSync(filePath)
        pins[doc.targetName] = sha256FileContent(body)
        log(`    ${doc.targetName} ← ${pins[doc.targetName]!.slice(0, 12)}… (${doc.repoPath})`)
      }
      if (Object.keys(pins).length === 0) throw new Error('no documents to pin')
      return pins
    }

    // skillpack
    if (entry.installMode === 'directory') {
      // Match installer: hash installed tree (sha256Directory skips .git / node_modules / install marker).
      const hash = sha256Directory(staging)
      log(`    ${entry.id} (directory) ← ${hash.slice(0, 12)}…`)
      return { [entry.id]: hash }
    }

    const skills = scanSkillDirs(staging, entry)
    if (skills.length === 0) {
      throw new Error(`no SKILL.md found (subdir '${entry.skillsSubdir ?? '.'}')`)
    }
    const pins: Record<string, string> = {}
    for (const skill of skills) {
      // pin key = skill basename as discovered (installer uses finalName; no collision rename here)
      pins[skill.name] = sha256Directory(skill.dir)
      log(`    ${skill.name} ← ${pins[skill.name]!.slice(0, 12)}…`)
    }
    return pins
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const { only, dryRun, catalogPath } = parseArgs(process.argv.slice(2))
  if (!existsSync(catalogPath)) {
    throw new Error(`catalog not found: ${catalogPath}`)
  }

  const rawText = readFileSync(catalogPath, 'utf8')
  const raw = JSON.parse(rawText) as unknown
  // Validate shape first (fail closed on schema bugs).
  const catalog: MarketplaceCatalog = parseCatalog(raw)

  const targets = catalog.entries.filter((e) => {
    if (e.kind !== 'skillpack' && e.kind !== 'context-doc') return false
    if (only && !only.has(e.id)) return false
    return true
  })

  log(`pinning ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'} from ${catalogPath}`)
  const workRoot = mkdtempSync(join(tmpdir(), 'craft-marketplace-pins-'))
  let pinned = 0
  let failed = 0
  try {
    for (const entry of targets) {
      log(`→ ${entry.id} (${entry.kind}${entry.kind === 'skillpack' ? `/${entry.installMode ?? 'skills'}` : ''})`)
      try {
        const pins = await pinEntry(entry, workRoot)
        if (!pins) {
          failed++
          continue
        }
        entry.expectedContentSha256 = pins
        pinned++
        log(`  ok (${Object.keys(pins).length} pin${Object.keys(pins).length === 1 ? '' : 's'})`)
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        warn(`  FAIL ${entry.id}: ${msg}`)
        // Leave any pre-existing pins untouched on failure.
      }
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }

  // Re-validate after mutation (normalized lowercase digests).
  const validated = parseCatalog(catalog)
  const out = `${JSON.stringify(validated, null, 2)}\n`

  if (dryRun) {
    log(`\n--dry-run: would write ${out.length} bytes (${pinned} pinned, ${failed} failed)`)
    return
  }

  writeFileSync(catalogPath, out, 'utf8')
  // GNU shasum -a 256 sidecar used by catalog remote/bundled digest verify.
  const sidecarPath = `${catalogPath}.sha256`
  writeFileSync(sidecarPath, `${sha256HexOfString(out)}  catalog.json\n`, 'utf8')
  log(`\nwrote ${catalogPath}`)
  log(`wrote ${sidecarPath}`)

  // Ed25519 signature (optional if no signing key in env / local gitignored file).
  const keyFromEnv = process.env.CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY?.trim()
  const keyFile = join(SCRIPT_DIR, '.marketplace-catalog-signing-key.b64')
  const keyFromFile = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : ''
  const signingKey = keyFromEnv || keyFromFile
  if (signingKey) {
    const sigPath = `${catalogPath}.sig`
    writeFileSync(sigPath, `${signCatalogBody(out, signingKey)}\n`, 'utf8')
    log(`wrote ${sigPath}`)
  } else {
    warn('no catalog signing key (CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY or scripts/.marketplace-catalog-signing-key.b64) — left existing .sig untouched')
  }

  log(`summary: pinned=${pinned} failed=${failed} total=${targets.length}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
