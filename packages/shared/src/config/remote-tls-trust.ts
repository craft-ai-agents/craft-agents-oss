import { Buffer } from 'node:buffer'
import type { RemoteServerConfig, RemoteTlsTrust } from '@craft-agent/core/types'

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function canonicalWssOrigin(
  value: string,
  label: string,
  requireCanonicalOrigin = true,
): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid wss:// origin`)
  }

  if (parsed.protocol !== 'wss:' || parsed.origin === 'null') {
    throw new Error(`${label} must use wss://`)
  }

  if (requireCanonicalOrigin && value !== parsed.origin) {
    throw new Error(`${label} must be canonical`)
  }

  return parsed.origin
}

function isSha256Base64(value: string): boolean {
  if (!BASE64_PATTERN.test(value)) return false

  const digest = Buffer.from(value, 'base64')
  return digest.length === 32 && digest.toString('base64') === value
}

/**
 * Validates and normalizes direct remote TLS trust persisted alongside a
 * workspace. The persisted shape is security-sensitive input, not a hint: an
 * invalid pin is rejected before any connection code can use it.
 */
export function normalizeRemoteTlsTrust(remote: RemoteServerConfig): RemoteTlsTrust {
  const candidate: unknown = remote.tlsTrust
  if (candidate === undefined) return { mode: 'public-ca' }

  if (!candidate || typeof candidate !== 'object' || !('mode' in candidate)) {
    throw new Error('Remote TLS trust must be a recognized policy')
  }

  if (candidate.mode === 'public-ca') return { mode: 'public-ca' }
  if (candidate.mode !== 'spki-pin') {
    throw new Error('Remote TLS trust must be a recognized policy')
  }

  const remoteOrigin = canonicalWssOrigin(
    remote.url,
    'SPKI pin requires a wss:// remote URL',
    false,
  )
  if (
    !('origin' in candidate) ||
    !('spkiSha256' in candidate) ||
    !('enrolledAt' in candidate)
  ) {
    throw new Error('SPKI pin must include an origin, digest, and enrollment time')
  }

  const { origin, spkiSha256, enrolledAt } = candidate
  if (typeof origin !== 'string') {
    throw new Error('SPKI pin origin must be a valid wss:// origin')
  }
  const pinOrigin = canonicalWssOrigin(origin, 'SPKI pin origin')
  if (pinOrigin !== remoteOrigin) {
    throw new Error('SPKI pin origin must match the remote URL origin')
  }

  if (typeof spkiSha256 !== 'string' || !isSha256Base64(spkiSha256)) {
    throw new Error('SPKI pin must contain a base64-encoded SHA-256 digest')
  }
  if (typeof enrolledAt !== 'number' || !Number.isFinite(enrolledAt) || enrolledAt < 0) {
    throw new Error('SPKI pin enrollment time must be a non-negative timestamp')
  }

  return { mode: 'spki-pin', origin: pinOrigin, spkiSha256, enrolledAt }
}
