/**
 * Pack Loader — discovers, loads, and validates CESP v1.0 sound packs.
 *
 * Scans multiple directories for openpeon.json manifests,
 * validates them against the CESP schema, and resolves category aliases.
 */

import { readFile, readdir, stat, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import type {
  CespManifest,
  CespCategory,
  CespCategoryDef,
  SoundPack,
} from '@craft-agent/shared/audio'
import {
  CESP_ALL_CATEGORIES,
  SUPPORTED_AUDIO_EXTENSIONS,
  AUDIO_MAGIC_BYTES,
} from '@craft-agent/shared/audio'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getBuiltinPackDir(): string {
  return join(process.resourcesPath, 'sound-packs')
}

function getUserPackDir(): string {
  return join(app.getPath('home'), '.craft-agent', 'sound-packs')
}

function getPeonPingPackDir(): string {
  return join(app.getPath('home'), '.claude', 'hooks', 'peon-ping', 'packs')
}

// ---------------------------------------------------------------------------
// Manifest Validation
// ---------------------------------------------------------------------------

const REQUIRED_MANIFEST_FIELDS = ['cesp_version', 'name', 'display_name', 'version', 'categories'] as const

export function validateManifest(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Manifest is not an object'] }
  }

  const manifest = raw as Record<string, unknown>

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest)) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  if (manifest.cesp_version && manifest.cesp_version !== '1.0') {
    errors.push(`Unsupported CESP version: ${manifest.cesp_version} (expected 1.0)`)
  }

  if (manifest.categories && typeof manifest.categories === 'object') {
    const categories = manifest.categories as Record<string, unknown>
    for (const [cat, def] of Object.entries(categories)) {
      if (!CESP_ALL_CATEGORIES.includes(cat as CespCategory)) {
        errors.push(`Unknown category: ${cat}`)
      }
      if (!def || typeof def !== 'object' || !('sounds' in (def as object))) {
        errors.push(`Category "${cat}" missing "sounds" array`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Audio File Validation
// ---------------------------------------------------------------------------

export async function validateAudioFile(filePath: string): Promise<boolean> {
  try {
    const buffer = Buffer.alloc(16)
    const handle = await readFile(filePath)
    handle.copy(buffer, 0, 0, 16)

    for (const [, sig] of Object.entries(AUDIO_MAGIC_BYTES)) {
      const actual = buffer.slice(sig.offset, sig.offset + sig.bytes.length)
      const expected = Buffer.from(sig.bytes)
      if (actual.equals(expected)) return true
    }
    return false
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Pack Loading
// ---------------------------------------------------------------------------

async function loadPackFromDirectory(
  dir: string,
  source: SoundPack['source'],
): Promise<SoundPack | null> {
  const manifestPath = join(dir, 'openpeon.json')
  if (!existsSync(manifestPath)) return null

  try {
    const raw = await readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw)

    const { valid, errors } = validateManifest(parsed)
    if (!valid) {
      console.warn(`[sound] Invalid manifest in ${dir}:`, errors.join(', '))
      return null
    }

    const manifest = parsed as CespManifest
    let soundCount = 0
    let totalSizeBytes = 0

    // Count sounds and compute total size
    for (const [, catDef] of Object.entries(manifest.categories)) {
      const cat = catDef as CespCategoryDef
      for (const sound of cat.sounds) {
        soundCount++
        try {
          const s = await stat(join(dir, sound.file))
          totalSizeBytes += s.size
        } catch {
          // File might not exist yet — skip
        }
      }
    }

    return {
      name: manifest.name,
      displayName: manifest.display_name,
      version: manifest.version,
      directory: resolve(dir),
      manifest,
      soundCount,
      totalSizeBytes,
      source,
    }
  } catch (err) {
    console.warn(`[sound] Error loading pack from ${dir}:`, err)
    return null
  }
}

async function scanDirectoryForPacks(
  baseDir: string,
  source: SoundPack['source'],
): Promise<SoundPack[]> {
  if (!existsSync(baseDir)) return []

  const packs: SoundPack[] = []
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pack = await loadPackFromDirectory(join(baseDir, entry.name), source)
      if (pack) packs.push(pack)
    }
  } catch (err) {
    console.warn(`[sound] Error scanning ${baseDir}:`, err)
  }
  return packs
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all available sound packs from all sources.
 * Later sources override earlier ones with the same name.
 */
export async function discoverPacks(): Promise<Map<string, SoundPack>> {
  const packMap = new Map<string, SoundPack>()

  // 1. Built-in packs
  const builtinDir = getBuiltinPackDir()
  for (const pack of await scanDirectoryForPacks(builtinDir, 'builtin')) {
    packMap.set(pack.name, pack)
  }

  // 2. User-installed packs
  const userDir = getUserPackDir()
  for (const pack of await scanDirectoryForPacks(userDir, 'installed')) {
    packMap.set(pack.name, pack)
  }

  // 3. peon-ping packs (read-only reference)
  const peonPingDir = getPeonPingPackDir()
  for (const pack of await scanDirectoryForPacks(peonPingDir, 'peon-ping')) {
    if (!packMap.has(pack.name)) {
      pack.source = 'peon-ping'
      packMap.set(pack.name, pack)
    }
  }

  return packMap
}

/**
 * Load a single pack by name.
 */
export async function loadPack(name: string): Promise<SoundPack | null> {
  const packs = await discoverPacks()
  return packs.get(name) ?? null
}

/**
 * Get the path where user-installed packs are stored.
 * Creates the directory if it doesn't exist.
 */
export async function getUserPackDirectory(): Promise<string> {
  const dir = getUserPackDir()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  return dir
}

/**
 * Resolve a category for a pack, considering aliases.
 */
export function resolveCategory(
  manifest: CespManifest,
  category: CespCategory,
): CespCategoryDef | undefined {
  // Direct match first
  if (manifest.categories[category]) {
    return manifest.categories[category]
  }

  // Check aliases
  if (manifest.category_aliases) {
    for (const alias of manifest.category_aliases) {
      if (alias.to === category) {
        // The alias "to" maps to the CESP category,
        // but the sounds are under the "from" key
        return manifest.categories[alias.from as CespCategory]
      }
    }
  }

  return undefined
}

/**
 * Pick a random sound from a category, optionally avoiding the last played file.
 */
export function pickRandomSound(
  categoryDef: CespCategoryDef,
  packDir: string,
  lastPlayed?: string | null,
): { filePath: string; entry: CespCategoryDef['sounds'][number] } | null {
  const sounds = categoryDef.sounds
  if (sounds.length === 0) return null

  // Filter out last played if noRepeat is active
  const candidates = lastPlayed
    ? sounds.filter(s => s.file !== lastPlayed)
    : sounds

  // If all sounds were the last played, just use all
  const pool = candidates.length > 0 ? candidates : sounds

  const idx = Math.floor(Math.random() * pool.length)
  const entry = pool[idx]

  return {
    filePath: join(packDir, entry.file),
    entry,
  }
}
