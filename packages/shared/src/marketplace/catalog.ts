/**
 * Marketplace catalog — schema, validation, remote refresh.
 * Spec: docs/runtime-context-marketplace-prd.md §8.1, plan §5 (M4a).
 *
 * Trust model: the catalog is an index, not executable code. Entries are
 * curated (GitHub-only sources, pinned commit SHA). Remote refresh uses
 * ETag + 24h TTL; on any failure the last cache or the bundled copy wins.
 * Body integrity: sibling catalog.json.sha256 (SHA-256). Authenticity:
 * sibling catalog.json.sig (ed25519 over body bytes; public key baked in).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CONFIG_DIR } from '../config/paths.ts'
import { getBundledAssetsDir } from '../utils/paths.ts'
import { verifyCatalogEd25519Signature } from './catalog-signing.ts'

// ---------------------------------------------------------------------------
// Schema (PRD §8.1 + descriptionRu)
// ---------------------------------------------------------------------------

export type MarketplaceEntryKind = 'skillpack' | 'tool' | 'context-doc'

export interface MarketplaceSource {
  type: 'github'
  /** owner/repo */
  repo: string
  /** Pinned commit SHA (40 hex). Catalog entries are never floating refs. */
  ref: string
}

export interface MarketplaceDocument {
  /** Path inside the source repo, e.g. 'AGENTS.md'. */
  repoPath: string
  /** Target file name inside <CONFIG_DIR>/context/ (must end with .md). */
  targetName: string
}

export interface MarketplaceEntry {
  id: string
  kind: MarketplaceEntryKind
  title: string
  /** All marketplace descriptions are curated Russian text (PRD §8.2). */
  descriptionRu: string
  source: MarketplaceSource
  /** Informational list of skill slugs shipped by a skillpack. */
  skills?: string[]
  license?: string
  default?: 'installed' | 'available'
  sizeHintKb?: number
  tags?: string[]
  /** skillpack: restrict the SKILL.md scan to this subdirectory (e.g. 'skills', '.agents'). */
  skillsSubdir?: string
  /**
   * skillpack layout:
   * - 'skills' (default): scan for SKILL.md and install every discovered skill
   *    as ~/.agents/skills/<basename>.
   * - 'directory': install the whole repo as one ~/.agents/skills/<id> dir
   *    (clone-only; upstream install.sh is NEVER executed).
   */
  installMode?: 'skills' | 'directory'
  /** context-doc: repo files → <CONFIG_DIR>/context/<targetName>. */
  documents?: MarketplaceDocument[]
  /** tool: tool name in the toolchain manifest (deferred install via toolchain:update). */
  toolName?: string
  /** stats: npm package used for weekly-download metrics. */
  npm?: { package: string }
  /**
   * Content integrity pins — REQUIRED for skillpack and context-doc entries.
   * key = skill basename / entry.id (skillpack) or context targetName (context-doc);
   * value = 64-hex sha256 of installed content (dir tree or file body).
   * Tools do not require pins.
   */
  expectedContentSha256?: Record<string, string>
}

export interface MarketplaceCatalog {
  catalogVersion: number
  updatedAt?: string
  entries: MarketplaceEntry[]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const SHA_RE = /^[0-9a-f]{40}$/
const REPO_RE = /^[\w.-]+\/[\w.-]+$/
const DOC_NAME_RE = /^[a-z0-9][a-z0-9-]*\.md$/
const CONTENT_SHA256_RE = /^[0-9a-f]{64}$/i
const KINDS: Record<string, true> = { skillpack: true, tool: true, 'context-doc': true }

export class CatalogValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Invalid marketplace catalog: ${issues.join('; ')}`)
    this.name = 'CatalogValidationError'
    this.issues = issues
  }
}

/** SHA-256 hex digest of a UTF-8 string (catalog body / sidecar compare). */
export function sha256HexOfString(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

/**
 * Verify `body` against a GNU sha256 sidecar payload (`<hex>  catalog.json`).
 * Throws on missing/invalid token or digest mismatch.
 */
function assertCatalogBodyMatchesSidecar(body: string, sidecarBody: string, label: string): void {
  const token = (sidecarBody.trim().split(/\s+/)[0] ?? '').toLowerCase()
  if (!CONTENT_SHA256_RE.test(token)) {
    throw new Error(`${label}: catalog digest sidecar must start with a 64-hex sha256`)
  }
  const actual = sha256HexOfString(body)
  if (actual !== token) {
    throw new Error(`${label}: catalog sha256 mismatch (expected ${token}, got ${actual})`)
  }
}

/** Verify ed25519 signature (base64) over the exact catalog body bytes. */
function assertCatalogBodySignature(body: string, signatureBase64: string, label: string): void {
  try {
    verifyCatalogEd25519Signature(body, signatureBase64)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${label}: ${msg}`)
  }
}


/**
 * Parse + validate a catalog payload. Throws CatalogValidationError on any
 * schema violation — callers MUST treat an invalid remote catalog as a fetch
 * failure and fall back to cache/bundle (fail-closed).
 */
export function parseCatalog(raw: unknown): MarketplaceCatalog {
  const issues: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CatalogValidationError(['root must be an object'])
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.catalogVersion !== 'number' || !Number.isInteger(obj.catalogVersion) || obj.catalogVersion < 1) {
    issues.push('catalogVersion must be a positive integer')
  }
  if (obj.updatedAt !== undefined && typeof obj.updatedAt !== 'string') {
    issues.push('updatedAt must be a string when present')
  }
  if (!Array.isArray(obj.entries)) {
    issues.push('entries must be an array')
  }
  if (issues.length > 0) throw new CatalogValidationError(issues)

  const seen = new Set<string>()
  const entries = obj.entries as unknown[]
  for (let i = 0; i < entries.length; i++) {
    const where = `entries[${i}]`
    const e = entries[i]
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      issues.push(`${where} must be an object`)
      continue
    }
    const rec = e as Record<string, unknown>
    if (typeof rec.id !== 'string' || !ID_RE.test(rec.id)) issues.push(`${where}.id must match ${ID_RE}`)
    else if (seen.has(rec.id)) issues.push(`${where}.id '${rec.id}' is duplicated`)
    else seen.add(rec.id)
    if (typeof rec.kind !== 'string' || !KINDS[rec.kind]) issues.push(`${where}.kind must be one of skillpack|tool|context-doc`)
    if (typeof rec.title !== 'string' || rec.title.length === 0) issues.push(`${where}.title is required`)
    if (typeof rec.descriptionRu !== 'string' || rec.descriptionRu.length === 0) issues.push(`${where}.descriptionRu is required (PRD §8.2)`)

    const src = rec.source as Record<string, unknown> | undefined
    if (typeof src !== 'object' || src === null) {
      issues.push(`${where}.source is required`)
    } else {
      if (src.type !== 'github') issues.push(`${where}.source.type must be 'github' (curated GitHub-only sources)`)
      if (typeof src.repo !== 'string' || !REPO_RE.test(src.repo)) issues.push(`${where}.source.repo must be owner/repo`)
      if (typeof src.ref !== 'string' || !SHA_RE.test(src.ref)) issues.push(`${where}.source.ref must be a pinned 40-hex commit SHA`)
    }

    const kind = rec.kind as MarketplaceEntryKind | undefined
    if (kind === 'skillpack') {
      if (rec.installMode !== undefined && rec.installMode !== 'skills' && rec.installMode !== 'directory') {
        issues.push(`${where}.installMode must be 'skills'|'directory'`)
      }
      if (rec.skills !== undefined && !Array.isArray(rec.skills)) issues.push(`${where}.skills must be an array`)
      if (
        rec.skillsSubdir !== undefined &&
        (typeof rec.skillsSubdir !== 'string' ||
          rec.skillsSubdir.length === 0 ||
          rec.skillsSubdir.includes('..') ||
          rec.skillsSubdir.startsWith('/') ||
          rec.skillsSubdir.startsWith('\\') ||
          /^[A-Za-z]:[\\/]/.test(rec.skillsSubdir))
      ) {
        issues.push(`${where}.skillsSubdir must be a safe relative path (no abs/..)`)
      }
    }
    if (kind === 'tool') {
      if (typeof rec.toolName !== 'string' || rec.toolName.length === 0) issues.push(`${where}.toolName is required for kind 'tool'`)
      const npm = rec.npm as Record<string, unknown> | undefined
      if (npm !== undefined && (typeof npm !== 'object' || npm === null || typeof npm.package !== 'string' || npm.package.length === 0)) {
        issues.push(`${where}.npm.package must be a non-empty string when npm is present`)
      }
    }
    if (kind === 'context-doc') {
      if (!Array.isArray(rec.documents) || rec.documents.length === 0) {
        issues.push(`${where}.documents is required for kind 'context-doc'`)
      } else {
        for (const [j, d] of (rec.documents as unknown[]).entries()) {
          const doc = d as Record<string, unknown>
          if (typeof doc?.repoPath !== 'string' || doc.repoPath.length === 0 || doc.repoPath.includes('..')) {
            issues.push(`${where}.documents[${j}].repoPath must be a safe repo-relative path`)
          }
          if (typeof doc?.targetName !== 'string' || !DOC_NAME_RE.test(doc.targetName)) {
            issues.push(`${where}.documents[${j}].targetName must match ${DOC_NAME_RE}`)
          }
        }
      }
    }

    // Content pins: required for skillpack/context-doc; optional for tools.
    if (kind === 'skillpack' || kind === 'context-doc') {
      const pins = rec.expectedContentSha256
      if (typeof pins !== 'object' || pins === null || Array.isArray(pins)) {
        issues.push(`${where}.expectedContentSha256 must be a non-empty object`)
      } else {
        const pinEntries = Object.entries(pins as Record<string, unknown>)
        if (pinEntries.length === 0) {
          issues.push(`${where}.expectedContentSha256 must be a non-empty object`)
        } else {
          const normalized: Record<string, string> = {}
          for (const [key, value] of pinEntries) {
            if (typeof key !== 'string' || key.length === 0 || key.includes('..')) {
              issues.push(`${where}.expectedContentSha256 key must be a non-empty string without '..'`)
              continue
            }
            if (typeof value !== 'string' || !CONTENT_SHA256_RE.test(value)) {
              issues.push(`${where}.expectedContentSha256['${key}'] must be a 64-hex sha256`)
              continue
            }
            normalized[key] = value.toLowerCase()
          }
          // Normalize in place so returned catalog stores lowercase digests.
          rec.expectedContentSha256 = normalized

          if (kind === 'context-doc' && Array.isArray(rec.documents)) {
            for (const [j, d] of (rec.documents as unknown[]).entries()) {
              const doc = d as Record<string, unknown>
              const targetName = typeof doc?.targetName === 'string' ? doc.targetName : ''
              if (targetName && !(targetName in normalized)) {
                issues.push(
                  `${where}.expectedContentSha256 must include pin for documents[${j}].targetName '${targetName}'`,
                )
              }
            }
          }

          if (kind === 'skillpack') {
            if (rec.installMode === 'directory') {
              const id = typeof rec.id === 'string' ? rec.id : ''
              if (id && !(id in normalized)) {
                issues.push(`${where}.expectedContentSha256 must include pin key for entry.id '${id}'`)
              }
            } else if (Object.keys(normalized).length === 0) {
              // Defensive: pinEntries.length already guards emptiness above.
              issues.push(`${where}.expectedContentSha256 must include at least one pin key`)
            }
          }
        }
      }
    } else if (rec.expectedContentSha256 !== undefined) {
      // Tools: pins optional but must be well-formed when present.
      const pins = rec.expectedContentSha256
      if (typeof pins !== 'object' || pins === null || Array.isArray(pins)) {
        issues.push(`${where}.expectedContentSha256 must be an object when present`)
      } else {
        const normalized: Record<string, string> = {}
        for (const [key, value] of Object.entries(pins as Record<string, unknown>)) {
          if (typeof key !== 'string' || key.length === 0 || key.includes('..')) {
            issues.push(`${where}.expectedContentSha256 key must be a non-empty string without '..'`)
            continue
          }
          if (typeof value !== 'string' || !CONTENT_SHA256_RE.test(value)) {
            issues.push(`${where}.expectedContentSha256['${key}'] must be a 64-hex sha256`)
            continue
          }
          normalized[key] = value.toLowerCase()
        }
        rec.expectedContentSha256 = normalized
      }
    }
  }
  if (issues.length > 0) throw new CatalogValidationError(issues)
  return obj as unknown as MarketplaceCatalog
}

// ---------------------------------------------------------------------------
// Meta store (ETag + lastCatalogFetchAt). Production wiring persists these in
// StoredConfig.marketplace (plan §0.1) via createConfigMetaStore; tests inject
// createMemoryMetaStore.
// ---------------------------------------------------------------------------

export interface MarketplaceMeta {
  catalogEtag?: string
  lastCatalogFetchAt?: number
}

export interface MarketplaceMetaStore {
  get(): MarketplaceMeta
  set(meta: MarketplaceMeta): void
}

export function createMemoryMetaStore(initial: MarketplaceMeta = {}): MarketplaceMetaStore & { value: MarketplaceMeta } {
  const box: { value: MarketplaceMeta } = { value: { ...initial } }
  return {
    get value() {
      return box.value
    },
    get: () => ({ ...box.value }),
    set: (meta) => {
      box.value = { ...meta }
    },
  }
}

type StoredConfigLike = { marketplace?: MarketplaceMeta } & Record<string, unknown>

/** Meta store backed by StoredConfig.marketplace (plan §0.1). IO functions are injected for testability. */
export function createConfigMetaStore(
  loadConfig: () => StoredConfigLike | null,
  saveConfig: (config: StoredConfigLike) => void,
): MarketplaceMetaStore {
  return {
    get: () => ({ ...(loadConfig()?.marketplace ?? {}) }),
    set: (meta) => {
      const existing = loadConfig()
      // Never synthesize a bare {marketplace} config — that would wipe workspaces
      // if loadConfig transiently returned null (torn read / missing file).
      if (!existing) return
      saveConfig({ ...existing, marketplace: { ...meta } })
    },
  }
}

// ---------------------------------------------------------------------------
// Minimal fetch shape (trivially mockable; no DOM Response typing needed)
// ---------------------------------------------------------------------------

export interface MarketplaceResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

export type MarketplaceFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<MarketplaceResponse>

// ---------------------------------------------------------------------------
// Catalog loading: ETag / 24h TTL / atomic swap / fallback bundle
// ---------------------------------------------------------------------------

export const MARKETPLACE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Remote catalog source of truth (PRD §8.1). Path note: the catalog lives at
 * apps/electron/resources/marketplace/catalog.json in the repo layout (the PRD
 * snippet omitted the apps/electron prefix).
 */
export const DEFAULT_CATALOG_REMOTE_URL =
  'https://raw.githubusercontent.com/agisota/craft-agents-oss/main/apps/electron/resources/marketplace/catalog.json'

export interface MarketplacePaths {
  /** <configDir>/marketplace */
  dir: string
  /** Catalog cache (last known-good remote copy). */
  catalogCache: string
  /** Install registry. */
  lockFile: string
  /** Stats cache (6h TTL). */
  statsCache: string
  /** Temp staging area for clones/downloads. */
  tmpDir: string
}

export function marketplacePaths(configDir: string = CONFIG_DIR): MarketplacePaths {
  const dir = join(configDir, 'marketplace')
  return {
    dir,
    catalogCache: join(dir, 'catalog.cache.json'),
    lockFile: join(dir, 'lock.json'),
    statsCache: join(dir, 'stats-cache.json'),
    tmpDir: join(dir, 'tmp'),
  }
}

export type CatalogOrigin = 'cache' | 'remote' | 'stale-cache' | 'bundled' | 'empty'

export interface CatalogLoadResult {
  catalog: MarketplaceCatalog
  origin: CatalogOrigin
  lastCatalogFetchAt: number | null
  /** Present when a degraded origin was used. */
  error?: string
}

export interface GetCatalogOptions {
  configDir?: string
  /** Path of the bundled fallback catalog (default: resolved via getBundledAssetsDir('marketplace')). */
  bundledCatalogPath?: string
  remoteUrl?: string
  metaStore?: MarketplaceMetaStore
  fetchFn?: MarketplaceFetch
  now?: () => number
  maxCacheAgeMs?: number
}

function defaultBundledCatalogPath(): string | null {
  const dir = getBundledAssetsDir('marketplace')
  if (!dir) return null
  const file = join(dir, 'catalog.json')
  return existsSync(file) ? file : null
}

/** Write file atomically: tmp sibling + rename (same filesystem → atomic on POSIX/NTFS). */
export function atomicWriteFileSync(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, content)
  renameSync(tmp, path)
}

function readCache(paths: MarketplacePaths): { catalog: MarketplaceCatalog; fetchedAt: number | null } | null {
  try {
    if (!existsSync(paths.catalogCache)) return null
    const parsed = JSON.parse(readFileSync(paths.catalogCache, 'utf8')) as { fetchedAt?: unknown; catalog?: unknown }
    return { catalog: parseCatalog(parsed.catalog), fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : null }
  } catch {
    return null // corrupt cache is treated as absent; bundled fallback still works
  }
}

function writeCache(paths: MarketplacePaths, rawCatalogJson: string): void {
  atomicWriteFileSync(paths.catalogCache, JSON.stringify({ fetchedAt: Date.now(), catalog: JSON.parse(rawCatalogJson) }))
}

function loadBundled(bundledCatalogPath?: string): MarketplaceCatalog | null {
  const file = bundledCatalogPath ?? defaultBundledCatalogPath()
  if (!file || !existsSync(file)) return null
  try {
    const body = readFileSync(file, 'utf8')
    const sidecarPath = `${file}.sha256`
    if (existsSync(sidecarPath)) {
      assertCatalogBodyMatchesSidecar(body, readFileSync(sidecarPath, 'utf8'), 'bundled catalog')
    }
    const sigPath = `${file}.sig`
    if (existsSync(sigPath)) {
      assertCatalogBodySignature(body, readFileSync(sigPath, 'utf8'), 'bundled catalog')
    }
    return parseCatalog(JSON.parse(body))
  } catch {
    return null
  }
}


const EMPTY_CATALOG: MarketplaceCatalog = { catalogVersion: 0, entries: [] }

/**
 * Load the catalog honoring ETag + TTL with graceful degradation:
 * fresh cache → remote (304 reuses cache) → stale cache → bundled → empty.
 */
export async function getCatalog(options: GetCatalogOptions = {}): Promise<CatalogLoadResult> {
  return refreshCatalogInternal({ ...options, allowFreshCache: true })
}

/** Force a remote fetch (still honors ETag; 304 keeps the cache body). */
export async function refreshCatalog(options: GetCatalogOptions = {}): Promise<CatalogLoadResult> {
  return refreshCatalogInternal({ ...options, allowFreshCache: false })
}

async function refreshCatalogInternal(options: GetCatalogOptions & { allowFreshCache: boolean }): Promise<CatalogLoadResult> {
  const paths = marketplacePaths(options.configDir)
  const fetchFn: MarketplaceFetch | undefined = options.fetchFn ?? (globalThis.fetch as unknown as MarketplaceFetch | undefined)
  const now = options.now ?? (() => Date.now())
  const ttl = options.maxCacheAgeMs ?? MARKETPLACE_CACHE_TTL_MS
  const metaStore = options.metaStore ?? createMemoryMetaStore()
  const remoteUrl = options.remoteUrl ?? process.env.CRAFT_MARKETPLACE_CATALOG_URL ?? DEFAULT_CATALOG_REMOTE_URL
  const meta = metaStore.get()

  const cached = readCache(paths)

  // Fresh cache short-circuit (24h TTL).
  const cacheAge = cached?.fetchedAt != null ? now() - cached.fetchedAt : Number.POSITIVE_INFINITY
  if (options.allowFreshCache && cached && cacheAge < ttl) {
    return { catalog: cached.catalog, origin: 'cache', lastCatalogFetchAt: meta.lastCatalogFetchAt ?? cached.fetchedAt }
  }

  // Remote attempt (may be skipped entirely when there is no fetch — tests, airgapped).
  let remoteError: string | undefined
  if (fetchFn) {
    try {
      // Supply-scope: каталог — доверенный вход в каждый install; только https
      // (в т.ч. CRAFT_MARKETPLACE_CATALOG_URL override), жёсткий таймаут и cap.
      const parsedUrl = new URL(remoteUrl)
      if (parsedUrl.protocol !== 'https:') throw new Error(`catalog URL must be https: ${remoteUrl}`)
      const headers: Record<string, string> = { 'user-agent': 'craft-agents-marketplace' }
      if (meta.catalogEtag) headers['if-none-match'] = meta.catalogEtag
      const res = await fetchFn(remoteUrl, { headers, signal: AbortSignal.timeout(30_000) })
      if (res.status === 304 && cached) {
        const fetchedAt = now()
        metaStore.set({ ...meta, lastCatalogFetchAt: fetchedAt })
        return { catalog: cached.catalog, origin: 'cache', lastCatalogFetchAt: fetchedAt }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.text()
      const MAX_CATALOG_BYTES = 4 * 1024 * 1024
      if (Buffer.byteLength(body) > MAX_CATALOG_BYTES) {
        throw new Error(`catalog exceeds 4MB cap (${Buffer.byteLength(body)} bytes)`)
      }
      // Integrity + authenticity when URL ends with catalog.json:
      // sibling .sha256 (body digest) and .sig (ed25519 over body bytes).
      if (remoteUrl.endsWith('catalog.json')) {
        const digestUrl = remoteUrl.replace(/catalog\.json$/, 'catalog.json.sha256')
        const digestRes = await fetchFn(digestUrl, {
          headers: { 'user-agent': 'craft-agents-marketplace' },
          signal: AbortSignal.timeout(30_000),
        })
        if (!digestRes.ok) throw new Error(`catalog digest HTTP ${digestRes.status}`)
        assertCatalogBodyMatchesSidecar(body, await digestRes.text(), 'remote catalog')
        const sigUrl = remoteUrl.replace(/catalog\.json$/, 'catalog.json.sig')
        const sigRes = await fetchFn(sigUrl, {
          headers: { 'user-agent': 'craft-agents-marketplace' },
          signal: AbortSignal.timeout(30_000),
        })
        if (!sigRes.ok) throw new Error(`catalog signature HTTP ${sigRes.status}`)
        assertCatalogBodySignature(body, await sigRes.text(), 'remote catalog')
      }

      const catalog = parseCatalog(JSON.parse(body)) // throws CatalogValidationError
      // Version monotonicity: never replace a newer cache with an older catalog.
      if (cached && catalog.catalogVersion < cached.catalog.catalogVersion) {
        throw new Error(`catalogVersion regression (${catalog.catalogVersion} < ${cached.catalog.catalogVersion})`)
      }
      writeCache(paths, body) // atomic swap
      const fetchedAt = now()
      const etag = res.headers.get('etag') ?? undefined
      metaStore.set({ catalogEtag: etag, lastCatalogFetchAt: fetchedAt })
      return { catalog, origin: 'remote', lastCatalogFetchAt: fetchedAt }
    } catch (err) {
      remoteError = err instanceof Error ? err.message : String(err)
    }
  } else {
    remoteError = 'fetch unavailable'
  }

  // Degradation ladder.
  if (cached) {
    return { catalog: cached.catalog, origin: 'stale-cache', lastCatalogFetchAt: meta.lastCatalogFetchAt ?? cached.fetchedAt, error: remoteError }
  }
  const bundled = loadBundled(options.bundledCatalogPath)
  if (bundled) {
    return { catalog: bundled, origin: 'bundled', lastCatalogFetchAt: meta.lastCatalogFetchAt ?? null, error: remoteError }
  }
  return { catalog: EMPTY_CATALOG, origin: 'empty', lastCatalogFetchAt: null, error: remoteError ?? 'no catalog available' }
}
