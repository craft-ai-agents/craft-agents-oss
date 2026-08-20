/**
 * Marketplace stats — live metrics for catalog cards (PRD §8.2).
 *
 * Sources: GitHub REST (stars, pushed_at) + npm registry (weekly downloads).
 * Cache: 6h TTL in <CONFIG_DIR>/marketplace/stats-cache.json.
 * Offline: fetch failures degrade to the last cached value flagged `stale`,
 * or to `{ stale: true, error }` when nothing was ever fetched.
 */

import { existsSync, readFileSync } from 'node:fs'

import { atomicWriteFileSync, type MarketplaceEntry } from './catalog.ts'

export const MARKETPLACE_STATS_TTL_MS = 6 * 60 * 60 * 1000

export interface MarketplaceEntryStats {
  id: string
  stars?: number
  /** ISO date of the last push to the source repo (GitHub pushed_at). */
  pushedAt?: string
  /** npm downloads over the last 7 days (only for entries with npm.package). */
  npmWeeklyDownloads?: number
  /**
   * Sum of GitHub release asset download_count across recent releases
   * (GET /repos/{owner}/{repo}/releases?per_page=100, at most 2 pages).
   */
  githubReleaseDownloads?: number
  /** When this datapoint was fetched from the network (0 = never). */
  fetchedAt: number
  /** true when the value comes from cache older than TTL or fetch failed. */
  stale: boolean
  error?: string
}

interface StatsCacheEntry {
  stars?: number
  pushedAt?: string
  npmWeeklyDownloads?: number
  githubReleaseDownloads?: number
  fetchedAt: number
}

export type StatsCacheData = Record<string, StatsCacheEntry>

export interface StatsStore {
  read(): StatsCacheData
  write(data: StatsCacheData): void
}

export function createFileStatsStore(cachePath: string): StatsStore {
  return {
    read: () => {
      try {
        if (!existsSync(cachePath)) return {}
        const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as { entries?: unknown }
        if (typeof raw !== 'object' || raw === null || typeof raw.entries !== 'object' || raw.entries === null) return {}
        return raw.entries as StatsCacheData
      } catch {
        return {} // corrupt cache behaves as empty; network refresh will rebuild it
      }
    },
    write: (data) => {
      atomicWriteFileSync(cachePath, JSON.stringify({ version: 1, entries: data }))
    },
  }
}

export function createMemoryStatsStore(initial: StatsCacheData = {}): StatsStore & { data: StatsCacheData } {
  const box = { data: { ...initial } }
  return {
    get data() {
      return box.data
    },
    read: () => JSON.parse(JSON.stringify(box.data)) as StatsCacheData,
    write: (data) => {
      box.data = JSON.parse(JSON.stringify(data)) as StatsCacheData
    },
  }
}

export interface MarketplaceStatsFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type MarketplaceStatsFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<MarketplaceStatsFetchResponse>

export interface FetchStatsOptions {
  store: StatsStore
  fetchFn?: MarketplaceStatsFetch
  now?: () => number
  ttlMs?: number
  /** Max parallel upstream requests (politeness, default 4). */
  concurrency?: number
}

async function fetchEntryStats(
  entry: MarketplaceEntry,
  fetchFn: MarketplaceStatsFetch,
  headers: Record<string, string>,
): Promise<Omit<StatsCacheEntry, 'fetchedAt'>> {
  const ghUrl = `https://api.github.com/repos/${entry.source.repo}`
  const releasesUrl = `https://api.github.com/repos/${entry.source.repo}/releases?per_page=100`
  const npmPackage = entry.kind === 'tool' ? entry.npm?.package : undefined
  const npmUrl = npmPackage ? `https://registry.npmjs.org/downloads/point/last-week/${encodeURIComponent(npmPackage)}` : null

  const [gh, npm, releases] = await Promise.all([
    fetchFn(ghUrl, { headers }).then(async (res) => {
      if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`)
      const data = (await res.json()) as Record<string, unknown>
      return {
        stars: typeof data.stargazers_count === 'number' ? data.stargazers_count : undefined,
        pushedAt: typeof data.pushed_at === 'string' ? data.pushed_at : undefined,
      }
    }),
    npmUrl
      ? fetchFn(npmUrl, { headers }).then(async (res) => {
          if (!res.ok) throw new Error(`npm HTTP ${res.status}`)
          const data = (await res.json()) as Record<string, unknown>
          return { npmWeeklyDownloads: typeof data.downloads === 'number' ? data.downloads : undefined }
        })
      : Promise.resolve({}),
    // Release download totals are best-effort: failure leaves the field undefined
    // without failing the whole entry (stars/npm still useful).
    fetchFn(releasesUrl, { headers })
      .then(async (res) => {
        if (!res.ok) return {}
        const data: unknown = await res.json()
        if (!Array.isArray(data)) return {}
        let total = 0
        for (const release of data) {
          if (!release || typeof release !== 'object' || !('assets' in release)) continue
          const assets = release.assets
          if (!Array.isArray(assets)) continue
          for (const asset of assets) {
            if (!asset || typeof asset !== 'object' || !('download_count' in asset)) continue
            const count = asset.download_count
            if (typeof count === 'number' && Number.isFinite(count)) total += count
          }
        }
        return { githubReleaseDownloads: total }
      })
      .catch(() => ({})),
  ])
  return { ...gh, ...npm, ...releases }
}

/**
 * Fetch stats for catalog entries with a 6h cache. Cache hits pay zero
 * network. Failures keep the previous cached value (stale) so the UI always
 * has something to render.
 */
export async function fetchMarketplaceStats(
  entries: MarketplaceEntry[],
  options: FetchStatsOptions,
): Promise<Record<string, MarketplaceEntryStats>> {
  const { store } = options
  const fetchFn: MarketplaceStatsFetch | undefined = options.fetchFn ?? (globalThis.fetch as unknown as MarketplaceStatsFetch | undefined)
  const now = options.now ?? (() => Date.now())
  const ttl = options.ttlMs ?? MARKETPLACE_STATS_TTL_MS
  const cache = store.read()
  const result: Record<string, MarketplaceEntryStats> = {}
  const pending: MarketplaceEntry[] = []

  for (const entry of entries) {
    const hit = cache[entry.id]
    if (hit && now() - hit.fetchedAt < ttl) {
      result[entry.id] = { id: entry.id, ...hit, stale: false }
    } else {
      pending.push(entry)
    }
  }

  let cacheDirty = false
  const headers = { 'user-agent': 'craft-agents-marketplace', accept: 'application/vnd.github+json' }
  const concurrency = Math.max(1, options.concurrency ?? 4)
  for (let i = 0; i < pending.length; i += concurrency) {
    const wave = pending.slice(i, i + concurrency)
    await Promise.all(
      wave.map(async (entry) => {
        const hit = cache[entry.id]
        if (!fetchFn) {
          result[entry.id] = { id: entry.id, ...(hit ?? { fetchedAt: 0 }), stale: true, error: 'fetch unavailable' }
          return
        }
        try {
          const fresh = await fetchEntryStats(entry, fetchFn, headers)
          const record: StatsCacheEntry = { ...fresh, fetchedAt: now() }
          cache[entry.id] = record
          cacheDirty = true
          result[entry.id] = { id: entry.id, ...record, stale: false }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          result[entry.id] = hit
            ? { id: entry.id, ...hit, stale: true, error: message }
            : { id: entry.id, fetchedAt: 0, stale: true, error: message }
        }
      }),
    )
  }

  if (cacheDirty) store.write(cache)
  return result
}
