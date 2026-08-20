/**
 * Ed25519 authenticity for marketplace catalog.json.
 *
 * Public key is baked into the app. Private key is NEVER shipped —
 * sign via CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY (PKCS8 DER base64) or
 * scripts/.marketplace-catalog-signing-key.b64 (gitignored) when running
 * scripts/marketplace-content-sha.ts.
 *
 * Signature file: sibling catalog.json.sig = base64(raw 64-byte ed25519 sig) + newline.
 * Verifies the exact UTF-8 bytes of catalog.json (same body as sha256 sidecar).
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

/** SPKI DER (base64) for the craft-agents marketplace catalog signing key. */
export const CATALOG_ED25519_PUBLIC_KEY_SPKI_B64 =
  'MCowBQYDK2VwAyEAnAtxpkyt/xKLtIeSF/4mthvaKzbMSYOrtlKx8D91r18='

export function verifyCatalogEd25519Signature(
  body: string | Buffer,
  signatureBase64: string,
  publicKeySpkiB64: string = CATALOG_ED25519_PUBLIC_KEY_SPKI_B64,
): void {
  const sigText = signatureBase64.trim()
  if (!sigText) throw new Error('catalog signature empty')
  let sig: Buffer
  try {
    sig = Buffer.from(sigText, 'base64')
  } catch {
    throw new Error('catalog signature is not valid base64')
  }
  if (sig.length !== 64) {
    throw new Error(`catalog signature must decode to 64 bytes (got ${sig.length})`)
  }
  const key = createPublicKey({
    key: Buffer.from(publicKeySpkiB64, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const data = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  const ok = verify(null, data, key, sig)
  if (!ok) throw new Error('catalog ed25519 signature mismatch')
}

/** Produce base64 ed25519 signature for catalog body bytes (signing side only). */
export function signCatalogBody(body: string | Buffer, privateKeyPkcs8B64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8B64.trim(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  const data = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  return sign(null, data, key).toString('base64')
}
