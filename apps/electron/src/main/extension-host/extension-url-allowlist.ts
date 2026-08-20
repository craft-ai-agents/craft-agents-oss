/**
 * Per-extension network.request URL allowlist store.
 *
 * Path: `{configDir}/extensions/url-allowlist.json`
 * Shape: `{ version: 1, byExtension: { [extensionId]: string[] } }`
 *
 * Empty allowlist → allow all (dev default). Non-empty → enforce startsWith.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config'

const FILE_VERSION = 1 as const
const REL_PATH = join('extensions', 'url-allowlist.json')

export interface UrlAllowlistFile {
  version: typeof FILE_VERSION
  byExtension: Record<string, string[]>
}

function emptyFile(): UrlAllowlistFile {
  return { version: FILE_VERSION, byExtension: {} }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normalize prefixes: non-empty trimmed strings, unique, stable order. */
export function normalizeUrlPrefixes(prefixes: unknown): string[] {
  if (!Array.isArray(prefixes)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of prefixes) {
    if (typeof p !== 'string') continue
    const t = p.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function parseFile(raw: unknown): UrlAllowlistFile {
  if (!isObject(raw)) return emptyFile()
  const byExtension: Record<string, string[]> = {}
  if (isObject(raw.byExtension)) {
    for (const [id, list] of Object.entries(raw.byExtension)) {
      if (typeof id !== 'string' || !id.trim()) continue
      const normalized = normalizeUrlPrefixes(list)
      if (normalized.length > 0) byExtension[id] = normalized
    }
  }
  return { version: FILE_VERSION, byExtension }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

function resolveConfigDir(configDir?: string): string {
  return typeof configDir === 'string' && configDir.trim() ? configDir.trim() : CONFIG_DIR
}

function filePath(configDir: string): string {
  return join(configDir, REL_PATH)
}

/** In-memory cache keyed by configDir. */
const cache = new Map<string, UrlAllowlistFile>()

function load(configDir: string): UrlAllowlistFile {
  const cached = cache.get(configDir)
  if (cached) return cached
  const path = filePath(configDir)
  if (!existsSync(path)) {
    const empty = emptyFile()
    cache.set(configDir, empty)
    return empty
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const parsed = parseFile(raw)
    cache.set(configDir, parsed)
    return parsed
  } catch {
    const empty = emptyFile()
    cache.set(configDir, empty)
    return empty
  }
}

function save(configDir: string, file: UrlAllowlistFile): UrlAllowlistFile {
  const next: UrlAllowlistFile = {
    version: FILE_VERSION,
    byExtension: { ...file.byExtension },
  }
  atomicWrite(filePath(configDir), `${JSON.stringify(next, null, 2)}\n`)
  cache.set(configDir, next)
  return next
}

/** Read URL prefixes for an extension. Missing → []. */
export function getUrlAllowlist(extensionId: string, configDir?: string): string[] {
  if (typeof extensionId !== 'string' || !extensionId.trim()) return []
  const dir = resolveConfigDir(configDir)
  const file = load(dir)
  const list = file.byExtension[extensionId.trim()]
  return list ? [...list] : []
}

/**
 * Replace URL prefixes for an extension.
 * Returns the normalized unique non-empty prefix list that was stored.
 * Empty list removes the extension entry.
 */
export function setUrlAllowlist(
  extensionId: string,
  prefixes: string[],
  configDir?: string,
): string[] {
  if (typeof extensionId !== 'string' || !extensionId.trim()) {
    throw new Error('setUrlAllowlist requires a non-empty extensionId')
  }
  const id = extensionId.trim()
  const dir = resolveConfigDir(configDir)
  const file = load(dir)
  const normalized = normalizeUrlPrefixes(prefixes)
  const byExtension = { ...file.byExtension }
  if (normalized.length === 0) {
    delete byExtension[id]
  } else {
    byExtension[id] = normalized
  }
  save(dir, { version: FILE_VERSION, byExtension })
  return [...normalized]
}

/** Absolute path helper (tests / diagnostics). */
export function urlAllowlistPath(configDir?: string): string {
  return filePath(resolveConfigDir(configDir))
}

/** Test helper — drop in-memory cache. */
export function resetUrlAllowlistCacheForTests(): void {
  cache.clear()
}
