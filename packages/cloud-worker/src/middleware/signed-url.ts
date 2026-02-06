/**
 * Signed URL middleware for secure file access without auth headers.
 *
 * Uses HMAC-SHA256 to create time-limited signed URLs that can be used
 * in <img> tags, direct browser access, etc.
 */

/**
 * Convert a hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate HMAC-SHA256 signature using Web Crypto API
 */
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate a signed URL's signature and expiration
 *
 * @param path - The file path (e.g., "workspace/session/attachments/file.png")
 * @param sig - The signature from query param
 * @param exp - The expiration timestamp from query param
 * @param secret - The API key used as HMAC secret
 * @returns true if valid, false if expired or invalid signature
 */
export async function validateSignedUrl(
  path: string,
  sig: string,
  exp: string,
  secret: string
): Promise<boolean> {
  // Check expiration
  const expTime = parseInt(exp, 10);
  if (isNaN(expTime) || Date.now() > expTime * 1000) {
    return false; // Expired
  }

  // Verify signature
  const expectedSig = await hmacSha256(secret, `${path}:${exp}`);
  return secureCompare(sig, expectedSig);
}

/**
 * Generate a signed URL for a file
 *
 * @param baseUrl - The base URL of the worker (e.g., "https://worker.dev")
 * @param path - The file path (e.g., "files/workspace/session/attachments/file.png")
 * @param secret - The API key used as HMAC secret
 * @param expiresInSeconds - How long the URL should be valid (default 15 minutes)
 * @returns The full signed URL
 */
export async function generateSignedUrl(
  baseUrl: string,
  path: string,
  secret: string,
  expiresInSeconds: number = 900
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sig = await hmacSha256(secret, `${path}:${exp}`);

  return `${baseUrl}/${path}?exp=${exp}&sig=${sig}`;
}
