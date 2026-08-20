import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CATALOG_ED25519_PUBLIC_KEY_SPKI_B64,
  signCatalogBody,
  verifyCatalogEd25519Signature,
} from '../catalog-signing.ts'

const KEY_PATH = join(
  import.meta.dir,
  '../../../../../scripts/.marketplace-catalog-signing-key.b64',
)
const KEY = existsSync(KEY_PATH) ? readFileSync(KEY_PATH, 'utf8').trim() : ''

describe('catalog ed25519 signing', () => {
  it('round-trips sign/verify for a body', () => {
    if (!KEY) return // private key not present in this environment
    const body = '{"catalogVersion":1,"entries":[]}\n'
    const sig = signCatalogBody(body, KEY)
    expect(() => verifyCatalogEd25519Signature(body, sig)).not.toThrow()
    expect(CATALOG_ED25519_PUBLIC_KEY_SPKI_B64.length).toBeGreaterThan(40)
  })

  it('rejects tampered body', () => {
    if (!KEY) return
    const body = 'hello-catalog'
    const sig = signCatalogBody(body, KEY)
    expect(() => verifyCatalogEd25519Signature(body + 'x', sig)).toThrow(/mismatch/i)
  })

  it('verifies committed catalog.json.sig', () => {
    const root = join(import.meta.dir, '../../../../../apps/electron/resources/marketplace')
    if (!existsSync(join(root, 'catalog.json')) || !existsSync(join(root, 'catalog.json.sig'))) {
      return
    }
    const body = readFileSync(join(root, 'catalog.json'))
    const sig = readFileSync(join(root, 'catalog.json.sig'), 'utf8')
    expect(() => verifyCatalogEd25519Signature(body, sig)).not.toThrow()
  })
})
