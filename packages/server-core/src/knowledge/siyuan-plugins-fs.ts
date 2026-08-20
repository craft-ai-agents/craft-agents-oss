/**
 * Filesystem feed for installed SiYuan plugins (offline-capable).
 *
 * Scans known SiYuan *data* directories for plugins/<name>/plugin.json and
 * storage/petal/petals.json. Also exposes conf.json api.token readers for
 * external-local kernel assist (G2-safe: read-only, never spawn/download).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseSiYuanPluginManifest, type SiYuanBridgeManifest } from '@craft-agent/shared/extensions'
import { SIYUAN_DEFAULT_BASE_URL } from './siyuan-detect'
/** Test-only override of candidate data dirs (null = use platform defaults). */
let candidateDataDirsOverride: string[] | null = null

/** @internal test seam — pass null to restore platform candidates. */
export function __setSiyuanDataDirCandidatesForTests(dirs: string[] | null): void {
  candidateDataDirsOverride = dirs
}

/**
 * Platform candidate SiYuan *data* directories (the folder that contains
 * `plugins/`, `storage/`, notebooks, …). Not the app install path.
 */
export function candidateSiyuanDataDirs(platform: NodeJS.Platform = process.platform): string[] {
  if (candidateDataDirsOverride !== null) return [...candidateDataDirsOverride]

  const home = homedir()
  const fromEnv = process.env.CRAFT_SIYUAN_DATA_DIRS
  if (fromEnv && fromEnv.trim()) {
    return fromEnv
      .split(platform === 'win32' ? ';' : ':')
      .map((p) => p.trim())
      .filter(Boolean)
  }

  switch (platform) {
    case 'darwin':
      return [join(home, 'Library', 'Application Support', 'SiYuan', 'data')]
    case 'win32': {
      const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
      return [join(appData, 'SiYuan', 'data')]
    }
    default:
      // Linux / others — desktop packages commonly use ~/.config/siyuan or ~/.siyuan
      return [
        join(home, '.config', 'siyuan', 'data'),
        join(home, '.config', 'SiYuan', 'data'),
        join(home, '.siyuan', 'data'),
        join(home, 'SiYuan', 'data'),
      ]
  }
}

/** Existing candidate data dirs only. */
export function findSiyuanDataDirs(platform: NodeJS.Platform = process.platform): string[] {
  return candidateSiyuanDataDirs(platform).filter((p) => {
    try {
      return existsSync(p) && statSync(p).isDirectory()
    } catch {
      return false
    }
  })
}

/**
 * Candidate SiYuan conf.json paths (contain api.token).
 * Layout: <workspaceRoot>/conf/conf.json next to data/; also nested under
 * Application Support / .config roots when data candidates are known.
 */
export function candidateSiyuanConfPaths(platform: NodeJS.Platform = process.platform): string[] {
  const fromEnv = process.env.CRAFT_SIYUAN_CONF_PATHS
  if (fromEnv && fromEnv.trim()) {
    return fromEnv
      .split(platform === 'win32' ? ';' : ':')
      .map((p) => p.trim())
      .filter(Boolean)
  }

  const out: string[] = []
  const seen = new Set<string>()
  const push = (p: string) => {
    if (!p || seen.has(p)) return
    seen.add(p)
    out.push(p)
  }

  // Derive conf.json from known data dirs: .../SiYuan/data → .../SiYuan/conf/conf.json
  for (const dataDir of candidateSiyuanDataDirs(platform)) {
    const workspaceRoot = dirname(dataDir)
    push(join(workspaceRoot, 'conf', 'conf.json'))
    // Some installs keep conf under the data parent as conf.json
    push(join(workspaceRoot, 'conf.json'))
  }

  // Explicit platform roots (same as data candidates' parents)
  const home = homedir()
  switch (platform) {
    case 'darwin':
      push(join(home, 'Library', 'Application Support', 'SiYuan', 'conf', 'conf.json'))
      break
    case 'win32': {
      const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
      push(join(appData, 'SiYuan', 'conf', 'conf.json'))
      break
    }
    default:
      push(join(home, '.config', 'siyuan', 'conf', 'conf.json'))
      push(join(home, '.config', 'SiYuan', 'conf', 'conf.json'))
      push(join(home, '.siyuan', 'conf', 'conf.json'))
      push(join(home, 'SiYuan', 'conf', 'conf.json'))
      break
  }

  return out
}

/** Existing conf.json candidates only. */
export function findSiyuanConfPaths(platform: NodeJS.Platform = process.platform): string[] {
  return candidateSiyuanConfPaths(platform).filter((p) => {
    try {
      return existsSync(p) && statSync(p).isFile()
    } catch {
      return false
    }
  })
}

export interface SiyuanConfApiToken {
  /** Non-empty api.token from conf.json — NEVER log. */
  token: string
  /** Kernel base URL (default 127.0.0.1:6806). */
  baseUrl: string
  /** conf.json path the token was read from. */
  confPath: string
}

/**
 * Read api.token (+ optional baseUrl hints) from a SiYuan conf.json.
 * Fail-soft: missing/malformed/empty token → null. Never logs token.
 */
export function readSiyuanApiTokenFromConf(confPath: string): SiyuanConfApiToken | null {
  if (!confPath) return null
  try {
    if (!existsSync(confPath)) return null
    const raw = JSON.parse(readFileSync(confPath, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return null
    const root = raw as Record<string, unknown>
    const api = root.api
    let token = ''
    if (api && typeof api === 'object' && !Array.isArray(api)) {
      const t = (api as Record<string, unknown>).token
      if (typeof t === 'string') token = t.trim()
    }
    // Also accept top-level apiToken / token (defensive; official shape is api.token)
    if (!token && typeof root.apiToken === 'string') token = root.apiToken.trim()
    if (!token) return null

    let baseUrl = SIYUAN_DEFAULT_BASE_URL
    // Prefer serverAddrs local loopback when present
    const addrs = root.serverAddrs
    if (Array.isArray(addrs)) {
      const loopback = addrs.find(
        (a): a is string => typeof a === 'string' && /127\.0\.0\.1|localhost/i.test(a),
      )
      if (loopback) {
        baseUrl = loopback.replace(/\/+$/, '')
      } else if (typeof addrs[0] === 'string' && addrs[0]) {
        baseUrl = String(addrs[0]).replace(/\/+$/, '')
      }
    }
    // Optional explicit fields if ever present
    if (typeof root.baseUrl === 'string' && root.baseUrl.trim()) {
      baseUrl = root.baseUrl.trim().replace(/\/+$/, '')
    } else if (typeof root.apiUrl === 'string' && root.apiUrl.trim()) {
      baseUrl = root.apiUrl.trim().replace(/\/+$/, '')
    }

    return { token, baseUrl, confPath }
  } catch {
    return null
  }
}

/**
 * First readable non-empty api.token across conf candidates.
 * Never logs token values.
 */
export function readFirstSiyuanApiTokenFromConf(
  platform: NodeJS.Platform = process.platform,
): SiyuanConfApiToken | null {
  for (const confPath of findSiyuanConfPaths(platform)) {
    const hit = readSiyuanApiTokenFromConf(confPath)
    if (hit) return hit
  }
  return null
}

/**
 * Parse petals.json → Map<packageName, enabled>.
 * Accepts array form (current SiYuan) or object map. Fail-soft → empty Map.
 */
export function readPetalsEnabledMap(dataDir: string): Map<string, boolean> {
  const out = new Map<string, boolean>()
  const path = join(dataDir, 'storage', 'petal', 'petals.json')
  if (!existsSync(path)) return out
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        if (typeof rec.name !== 'string' || !rec.name) continue
        if (typeof rec.enabled === 'boolean') out.set(rec.name, rec.enabled)
      }
      return out
    }
    if (raw && typeof raw === 'object') {
      for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!name) continue
        if (typeof value === 'boolean') {
          out.set(name, value)
          continue
        }
        if (value && typeof value === 'object' && 'enabled' in value) {
          const enabled = value.enabled
          if (typeof enabled === 'boolean') out.set(name, enabled)
        }
      }
    }
  } catch {
    /* corrupt petals — treat as absent */
  }
  return out
}

/**
 * Read plugins/<name>/plugin.json under a data dir. Malformed entries are skipped.
 */
export function listInstalledPluginManifests(dataDir: string): SiYuanBridgeManifest[] {
  const pluginsDir = join(dataDir, 'plugins')
  if (!existsSync(pluginsDir)) return []
  let entries: string[]
  try {
    entries = readdirSync(pluginsDir)
  } catch {
    return []
  }
  const out: SiYuanBridgeManifest[] = []
  for (const name of entries) {
    const dir = join(pluginsDir, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const manifestPath = join(dir, 'plugin.json')
    if (!existsSync(manifestPath)) continue
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
      const parsed = parseSiYuanPluginManifest(raw)
      if (parsed) out.push(parsed)
    } catch {
      /* skip malformed */
    }
  }
  // Stable order by package name
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export interface InstalledPluginFeedItem {
  manifest: SiYuanBridgeManifest
  /** petals.json enabled when known; undefined → caller falls back to local store */
  petalsEnabled?: boolean
  dataDir: string
}

/**
 * Scan known data dirs; first dir that yields any plugins wins (typical single install).
 * Merges petals enabled flags when present.
 */
export function listInstalledPluginsFromFilesystem(
  platform: NodeJS.Platform = process.platform,
): InstalledPluginFeedItem[] {
  for (const dataDir of findSiyuanDataDirs(platform)) {
    const manifests = listInstalledPluginManifests(dataDir)
    if (manifests.length === 0) continue
    const petals = readPetalsEnabledMap(dataDir)
    return manifests.map((manifest) => {
      const item: InstalledPluginFeedItem = { manifest, dataDir }
      if (petals.has(manifest.name)) {
        item.petalsEnabled = petals.get(manifest.name)
      }
      return item
    })
  }
  return []
}
