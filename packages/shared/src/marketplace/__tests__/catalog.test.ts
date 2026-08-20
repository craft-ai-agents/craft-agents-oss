import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CatalogValidationError,
  createMemoryMetaStore,
  getCatalog,
  marketplacePaths,
  parseCatalog,
  sha256HexOfString,
  type MarketplaceCatalog,
  type MarketplaceFetch,
} from '../catalog.ts'
import { signCatalogBody } from '../catalog-signing.ts'

const REF = 'a'.repeat(40)

const PIN = 'a'.repeat(64)

const VALID_CATALOG: MarketplaceCatalog = {
  catalogVersion: 1,
  entries: [
    {
      id: 'pack-one',
      kind: 'skillpack',
      title: 'Pack One',
      descriptionRu: 'Тестовый пак',
      source: { type: 'github', repo: 'owner/repo', ref: REF },
      expectedContentSha256: { 'pack-one': PIN },
    },
  ],
}

const failingFetch: MarketplaceFetch = async () => {
  throw new Error('network down')
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'craft-marketplace-catalog-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseCatalog', () => {
  it('accepts a valid catalog', () => {
    expect(parseCatalog(JSON.parse(JSON.stringify(VALID_CATALOG)))).toEqual(VALID_CATALOG)
  })

  it('rejects entries without descriptionRu (fail-closed)', () => {
    const bad = {
      catalogVersion: 1,
      entries: [{ id: 'x', kind: 'tool', title: 'X', source: { type: 'github', repo: 'o/r', ref: REF }, toolName: 'x' }],
    }
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
  })

  it('rejects floating refs', () => {
    const bad = JSON.parse(JSON.stringify(VALID_CATALOG))
    bad.entries[0].source.ref = 'main'
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
  })

  it('accepts valid expectedContentSha256 and lowercases digests', () => {
    const raw = JSON.parse(JSON.stringify(VALID_CATALOG))
    const upper = 'A'.repeat(64)
    raw.entries[0].expectedContentSha256 = { 'skill-a': upper }
    const parsed = parseCatalog(raw)
    expect(parsed.entries[0]!.expectedContentSha256).toEqual({ 'skill-a': 'a'.repeat(64) })
  })

  it('rejects expectedContentSha256 when not an object', () => {
    const bad = JSON.parse(JSON.stringify(VALID_CATALOG))
    bad.entries[0].expectedContentSha256 = ['not-an-object']
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
  })

  it('rejects expectedContentSha256 with bad hex values', () => {
    const bad = JSON.parse(JSON.stringify(VALID_CATALOG))
    bad.entries[0].expectedContentSha256 = { 'skill-a': 'deadbeef' }
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
  })

  it('rejects expectedContentSha256 keys that are empty or contain ..', () => {
    const emptyKey = JSON.parse(JSON.stringify(VALID_CATALOG))
    emptyKey.entries[0].expectedContentSha256 = { '': 'a'.repeat(64) }
    expect(() => parseCatalog(emptyKey)).toThrow(CatalogValidationError)

    const dotdot = JSON.parse(JSON.stringify(VALID_CATALOG))
    dotdot.entries[0].expectedContentSha256 = { '../escape': 'a'.repeat(64) }
    expect(() => parseCatalog(dotdot)).toThrow(CatalogValidationError)
  })
})

describe('getCatalog degradation ladder', () => {
  it('falls back to the bundled catalog when the network fails', async () => {
    const bundledCatalogPath = join(dir, 'bundle.json')
    writeFileSync(bundledCatalogPath, JSON.stringify(VALID_CATALOG))
    const result = await getCatalog({
      configDir: dir,
      metaStore: createMemoryMetaStore(),
      fetchFn: failingFetch,
      bundledCatalogPath,
    })
    expect(result.origin).toBe('bundled')
    expect(result.catalog).toEqual(VALID_CATALOG)
    expect(result.error).toBe('network down')
  })

  it('serves a fresh cache without touching the network', async () => {
    const now = 1_700_000_000_000
    const raw = JSON.stringify({ fetchedAt: now, catalog: VALID_CATALOG })
    mkdirSync(marketplacePaths(dir).dir, { recursive: true })
    writeFileSync(marketplacePaths(dir).catalogCache, raw)

    let calls = 0
    const countingFetch: MarketplaceFetch = async () => {
      calls++
      throw new Error('must not be called')
    }
    const result = await getCatalog({
      configDir: dir,
      metaStore: createMemoryMetaStore(),
      fetchFn: countingFetch,
      now: () => now + 1000, // within the 24h TTL
    })
    expect(calls).toBe(0)
    expect(result.origin).toBe('cache')
    expect(result.catalog).toEqual(VALID_CATALOG)
  })
})


describe('parseCatalog content pin requirements', () => {
  it('rejects skillpack without expectedContentSha256', () => {
    const bad = JSON.parse(JSON.stringify(VALID_CATALOG))
    delete bad.entries[0].expectedContentSha256
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
    try {
      parseCatalog(bad)
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogValidationError)
      expect((err as CatalogValidationError).issues.some((i) => i.includes('expectedContentSha256'))).toBe(true)
    }
  })

  it('rejects skillpack with empty expectedContentSha256', () => {
    const bad = JSON.parse(JSON.stringify(VALID_CATALOG))
    bad.entries[0].expectedContentSha256 = {}
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
  })

  it('rejects directory skillpack missing pin key for entry.id', () => {
    const bad = JSON.parse(JSON.stringify(VALID_CATALOG))
    bad.entries[0].installMode = 'directory'
    bad.entries[0].expectedContentSha256 = { 'other-skill': PIN }
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
    try {
      parseCatalog(bad)
    } catch (err) {
      expect((err as CatalogValidationError).message).toMatch(/entry\.id/)
    }
  })

  it('rejects context-doc missing pin for documents[].targetName', () => {
    const bad = {
      catalogVersion: 1,
      entries: [
        {
          id: 'doc-one',
          kind: 'context-doc',
          title: 'Doc One',
          descriptionRu: 'Документ',
          source: { type: 'github', repo: 'owner/repo', ref: REF },
          documents: [{ repoPath: 'AGENTS.md', targetName: 'agents.md' }],
          expectedContentSha256: { 'other.md': PIN },
        },
      ],
    }
    expect(() => parseCatalog(bad)).toThrow(CatalogValidationError)
    try {
      parseCatalog(bad)
    } catch (err) {
      expect((err as CatalogValidationError).message).toMatch(/targetName/)
    }
  })

  it('accepts tool without expectedContentSha256', () => {
    const toolOnly = {
      catalogVersion: 1,
      entries: [
        {
          id: 'tool-one',
          kind: 'tool',
          title: 'Tool One',
          descriptionRu: 'Инструмент',
          source: { type: 'github', repo: 'owner/repo', ref: REF },
          toolName: 'tool-one',
        },
      ],
    }
    expect(parseCatalog(toolOnly).entries[0]!.kind).toBe('tool')
    expect(parseCatalog(toolOnly).entries[0]!.expectedContentSha256).toBeUndefined()
  })
})

describe('catalog remote digest verification', () => {
  const remoteUrl = 'https://example.com/apps/electron/resources/marketplace/catalog.json'
  const body = JSON.stringify(VALID_CATALOG)
  const goodDigest = `${sha256HexOfString(body)}  catalog.json\n`
  const badDigest = `${'0'.repeat(64)}  catalog.json\n`

  const signingKeyPath = join(import.meta.dir, '../../../../../scripts/.marketplace-catalog-signing-key.b64')
  const signingKey = existsSync(signingKeyPath) ? readFileSync(signingKeyPath, 'utf8').trim() : undefined
  const goodSig = signingKey ? `${signCatalogBody(body, signingKey)}\n` : ''
  const badSig = Buffer.alloc(64, 7).toString('base64') + '\n'

  function makeFetch(opts: {
    catalogBody?: string
    digestBody?: string | null
    digestStatus?: number
    sigBody?: string | null
    sigStatus?: number
    catalogStatus?: number
  }): MarketplaceFetch {
    const catalogBody = opts.catalogBody ?? body
    return async (url) => {
      if (url.endsWith('catalog.json.sha256')) {
        if (opts.digestBody === null) {
          return {
            ok: false,
            status: opts.digestStatus ?? 404,
            text: async () => 'missing',
            headers: { get: () => null },
          }
        }
        return {
          ok: true,
          status: 200,
          text: async () => opts.digestBody ?? goodDigest,
          headers: { get: () => null },
        }
      }
      if (url.endsWith('catalog.json.sig')) {
        if (opts.sigBody === null) {
          return {
            ok: false,
            status: opts.sigStatus ?? 404,
            text: async () => 'missing',
            headers: { get: () => null },
          }
        }
        return {
          ok: true,
          status: 200,
          text: async () => opts.sigBody ?? goodSig,
          headers: { get: () => null },
        }
      }
      if (url.endsWith('catalog.json') || url === remoteUrl) {
        return {
          ok: (opts.catalogStatus ?? 200) >= 200 && (opts.catalogStatus ?? 200) < 300,
          status: opts.catalogStatus ?? 200,
          text: async () => catalogBody,
          headers: { get: () => null },
        }
      }
      throw new Error(`unexpected url ${url}`)
    }
  }

  // Accept paths need a real ed25519 signature (goodSig). Without the gitignored
  // dev signing key the tests are not registered — rejection paths below still run.
  if (signingKey) {
    it('accepts remote catalog when sibling digest matches', async () => {
      const result = await getCatalog({
        configDir: dir,
        metaStore: createMemoryMetaStore(),
        fetchFn: makeFetch({ digestBody: goodDigest }),
        remoteUrl,
        maxCacheAgeMs: 0,
      })
      expect(result.origin).toBe('remote')
      expect(result.catalog.catalogVersion).toBe(1)
    })
  }

  it('rejects remote catalog on digest mismatch and falls back', async () => {
    const bundledCatalogPath = join(dir, 'bundle.json')
    writeFileSync(bundledCatalogPath, JSON.stringify(VALID_CATALOG))
    const result = await getCatalog({
      configDir: dir,
      metaStore: createMemoryMetaStore(),
      fetchFn: makeFetch({ digestBody: badDigest }),
      remoteUrl,
      bundledCatalogPath,
      maxCacheAgeMs: 0,
    })
    expect(result.origin).not.toBe('remote')
    expect(result.origin === 'bundled' || result.origin === 'stale-cache').toBe(true)
    expect(result.error ?? '').toMatch(/sha256 mismatch|digest/i)
  })

  it('rejects remote catalog when digest fetch fails and falls back', async () => {
    const bundledCatalogPath = join(dir, 'bundle-miss.json')
    writeFileSync(bundledCatalogPath, JSON.stringify(VALID_CATALOG))
    const result = await getCatalog({
      configDir: dir,
      metaStore: createMemoryMetaStore(),
      fetchFn: makeFetch({ digestBody: null, digestStatus: 404 }),
      remoteUrl,
      bundledCatalogPath,
      maxCacheAgeMs: 0,
    })
    expect(result.origin).not.toBe('remote')
    expect(result.error ?? '').toMatch(/digest/i)
  })

  it('sha256HexOfString matches node crypto for known input', () => {
    expect(sha256HexOfString('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  if (signingKey) {
    it('accepts remote catalog when digest and ed25519 signature match', async () => {
      const result = await getCatalog({
        configDir: dir,
        metaStore: createMemoryMetaStore(),
        fetchFn: makeFetch({ digestBody: goodDigest, sigBody: goodSig }),
        remoteUrl,
        maxCacheAgeMs: 0,
      })
      expect(result.origin).toBe('remote')
    })
  }

  it('rejects remote catalog on signature mismatch and falls back', async () => {
    // badSig is self-contained — no local signing key required
    const bundledCatalogPath = join(dir, 'bundle-sig.json')
    writeFileSync(bundledCatalogPath, JSON.stringify(VALID_CATALOG))
    const result = await getCatalog({
      configDir: dir,
      metaStore: createMemoryMetaStore(),
      fetchFn: makeFetch({ digestBody: goodDigest, sigBody: badSig }),
      remoteUrl,
      bundledCatalogPath,
      maxCacheAgeMs: 0,
    })
    expect(result.origin).not.toBe('remote')
    expect(result.error ?? '').toMatch(/signature|ed25519/i)
  })

  it('rejects remote catalog when signature fetch fails', async () => {
    // sigBody:null is self-contained — no local signing key required
    const bundledCatalogPath = join(dir, 'bundle-sig-miss.json')
    writeFileSync(bundledCatalogPath, JSON.stringify(VALID_CATALOG))
    const result = await getCatalog({
      configDir: dir,
      metaStore: createMemoryMetaStore(),
      fetchFn: makeFetch({ digestBody: goodDigest, sigBody: null, sigStatus: 404 }),
      remoteUrl,
      bundledCatalogPath,
      maxCacheAgeMs: 0,
    })
    expect(result.origin).not.toBe('remote')
    expect(result.error ?? '').toMatch(/signature/i)
  })
})
