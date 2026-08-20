import { describe, expect, it } from 'bun:test'

import type { MarketplaceEntry } from '../catalog.ts'
import {
  createMemoryStatsStore,
  fetchMarketplaceStats,
  type MarketplaceStatsFetch,
} from '../stats.ts'

const ENTRY: MarketplaceEntry = {
  id: 'pack-one',
  kind: 'skillpack',
  title: 'Pack One',
  descriptionRu: 'Тестовый пак',
  source: { type: 'github', repo: 'owner/repo', ref: 'c'.repeat(40) },
}

describe('fetchMarketplaceStats', () => {
  it('serves fresh cache hits with zero network calls', async () => {
    const now = 1_700_000_000_000
    const store = createMemoryStatsStore({
      'pack-one': { stars: 5, pushedAt: '2026-01-01T00:00:00Z', fetchedAt: now },
    })
    let calls = 0
    const fetchFn: MarketplaceStatsFetch = async () => {
      calls++
      throw new Error('must not be called')
    }
    const result = await fetchMarketplaceStats([ENTRY], { store, fetchFn, now: () => now + 60_000 })
    expect(calls).toBe(0)
    expect(result['pack-one']).toEqual({
      id: 'pack-one',
      stars: 5,
      pushedAt: '2026-01-01T00:00:00Z',
      fetchedAt: now,
      stale: false,
    })
  })

  it('fetches on a cache miss and updates the store', async () => {
    const now = 1_700_000_000_000
    const store = createMemoryStatsStore()
    const requested: string[] = []
    const fetchFn: MarketplaceStatsFetch = async (url) => {
      requested.push(url)
      if (url.includes('/releases')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              assets: [{ download_count: 10 }, { download_count: 5 }],
            },
            {
              assets: [{ download_count: 7 }],
            },
          ],
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ stargazers_count: 42, pushed_at: '2026-08-01T00:00:00Z' }),
      }
    }
    const result = await fetchMarketplaceStats([ENTRY], { store, fetchFn, now: () => now })
    expect(requested).toContain('https://api.github.com/repos/owner/repo')
    expect(requested).toContain('https://api.github.com/repos/owner/repo/releases?per_page=100')
    expect(result['pack-one']!.stars).toBe(42)
    expect(result['pack-one']!.githubReleaseDownloads).toBe(22)
    expect(result['pack-one']!.stale).toBe(false)
    expect(store.data['pack-one']).toEqual({
      stars: 42,
      pushedAt: '2026-08-01T00:00:00Z',
      githubReleaseDownloads: 22,
      fetchedAt: now,
    })
  })

  it('leaves githubReleaseDownloads undefined when releases fetch fails', async () => {
    const now = 1_700_000_000_000
    const store = createMemoryStatsStore()
    const fetchFn: MarketplaceStatsFetch = async (url) => {
      if (url.includes('/releases')) {
        return { ok: false, status: 500, json: async () => ({}) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ stargazers_count: 3, pushed_at: '2026-07-01T00:00:00Z' }),
      }
    }
    const result = await fetchMarketplaceStats([ENTRY], { store, fetchFn, now: () => now })
    expect(result['pack-one']!.stars).toBe(3)
    expect(result['pack-one']!.githubReleaseDownloads).toBeUndefined()
    expect(result['pack-one']!.stale).toBe(false)
  })
})
