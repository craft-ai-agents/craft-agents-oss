import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCatalog, sha256HexOfString } from '../catalog.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../')
const CATALOG_PATH = join(REPO_ROOT, 'apps/electron/resources/marketplace/catalog.json')
const SIDECAR_PATH = `${CATALOG_PATH}.sha256`
const SHA256_RE = /^[0-9a-f]{64}$/

describe('bundled catalog content pins', () => {
  it('parseCatalog accepts on-disk catalog.json', () => {
    expect(existsSync(CATALOG_PATH)).toBe(true)
    const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown
    const catalog = parseCatalog(raw)
    expect(catalog.catalogVersion).toBeGreaterThanOrEqual(1)
    expect(catalog.entries.length).toBeGreaterThan(0)
  })

  it('every skillpack and context-doc has non-empty expectedContentSha256 pins', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')))
    let pinCount = 0
    for (const entry of catalog.entries) {
      if (entry.kind !== 'skillpack' && entry.kind !== 'context-doc') continue
      const pins = entry.expectedContentSha256
      expect(pins).toBeDefined()
      expect(typeof pins).toBe('object')
      expect(Object.keys(pins!).length).toBeGreaterThan(0)
      for (const [key, value] of Object.entries(pins!)) {
        expect(key.length).toBeGreaterThan(0)
        expect(key.includes('..')).toBe(false)
        expect(value).toMatch(SHA256_RE)
        pinCount++
      }
      if (entry.kind === 'skillpack' && entry.installMode === 'directory') {
        expect(pins![entry.id]).toMatch(SHA256_RE)
      }
      if (entry.kind === 'context-doc') {
        for (const doc of entry.documents ?? []) {
          // Use bracket access — toHaveProperty treats '.' as a path separator.
          expect(pins![doc.targetName]).toMatch(SHA256_RE)
        }
      }
    }
    expect(pinCount).toBeGreaterThan(0)
  })

  it('catalog.json.sha256 sidecar matches catalog.json body (GNU format)', () => {
    expect(existsSync(SIDECAR_PATH)).toBe(true)
    const body = readFileSync(CATALOG_PATH, 'utf8')
    const sidecar = readFileSync(SIDECAR_PATH, 'utf8')
    const token = sidecar.trim().split(/\s+/)[0] ?? ''
    expect(token).toMatch(SHA256_RE)
    expect(token).toBe(sha256HexOfString(body))
    // GNU shasum format: "<hex>  catalog.json"
    expect(sidecar.trim().split(/\s+/).slice(1).join(' ')).toBe('catalog.json')
  })
})
