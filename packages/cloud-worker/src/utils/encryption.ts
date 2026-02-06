/**
 * Credential Encryption Utilities
 *
 * Uses AES-256-GCM for encrypting sensitive credentials at rest.
 * The encryption key should be a 32-byte hex string stored as a secret.
 *
 * For client-server encryption (e.g., Anthropic API keys in WebSocket messages),
 * use deriveKeyFromApiKey() to derive a shared key from the workspace API key.
 */

/**
 * Encrypt a credential string using AES-256-GCM
 * Returns a base64-encoded string containing: iv (12 bytes) + ciphertext + auth tag (16 bytes)
 */
export async function encryptCredential(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes
  );

  // Combine IV + ciphertext (which includes auth tag)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return bytesToBase64(combined);
}

/**
 * Decrypt a credential string encrypted with encryptCredential
 */
export async function decryptCredential(encrypted: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }

  const combined = base64ToBytes(encrypted);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const plaintextBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(plaintextBytes);
}

/**
 * Derive a 256-bit encryption key from the workspace API key.
 * Both client and server can compute this to encrypt/decrypt API keys in transit.
 * Uses PBKDF2 with the workspaceSlug as salt.
 */
export async function deriveKeyFromApiKey(apiKey: string, workspaceSlug: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiKey),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`craft-agent-sandbox:${workspaceSlug}`),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

// Helper functions
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Export helpers for client-side use
export { hexToBytes, bytesToHex, bytesToBase64, base64ToBytes };
