/**
 * Sandbox API Key Encryption
 *
 * Encrypts Anthropic API keys before sending to the sandbox worker.
 * Uses the same algorithm as the worker's decryption for compatibility.
 *
 * The encryption key is derived from the workspace API key + slug,
 * so both client and server can derive the same key independently.
 */

/**
 * Derive a 256-bit encryption key from the workspace API key.
 * Uses PBKDF2 with the workspaceSlug as salt.
 */
export async function deriveKeyFromApiKey(apiKey: string, workspaceSlug: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiKey),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`craft-agent-sandbox:${workspaceSlug}`),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )

  return bytesToHex(new Uint8Array(derivedBits))
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns a base64-encoded string containing: iv (12 bytes) + ciphertext + auth tag (16 bytes)
 */
export async function encryptWithDerivedKey(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex)
  if (keyBytes.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)')
  }

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoder = new TextEncoder()
  const plaintextBytes = encoder.encode(plaintext)

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes
  )

  // Combine IV + ciphertext (which includes auth tag)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return bytesToBase64(combined)
}

/**
 * Convenience function to encrypt an Anthropic API key for sandbox use.
 */
export async function encryptAnthropicApiKey(
  anthropicApiKey: string,
  workspaceApiKey: string,
  workspaceSlug: string
): Promise<string> {
  const derivedKey = await deriveKeyFromApiKey(workspaceApiKey, workspaceSlug)
  return encryptWithDerivedKey(anthropicApiKey, derivedKey)
}

// Helper functions
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
