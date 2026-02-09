/**
 * Sync Token Generation & Validation
 *
 * Generates g4sync_ prefixed tokens and computes SHA-256 hashes
 * for secure R2 key derivation.
 */

import { randomBytes, createHash } from 'crypto'
import type { SyncToken } from './types.ts'

const TOKEN_PREFIX = 'g4sync_'
const TOKEN_REGEX = /^g4sync_[0-9a-f]{32}$/

/** Generate a new sync token */
export function generateSyncToken(): SyncToken {
  const hex = randomBytes(16).toString('hex')
  const raw = `${TOKEN_PREFIX}${hex}`
  return {
    raw,
    hash: hashSyncToken(raw),
  }
}

/** Compute SHA-256 hex hash of a raw sync token */
export function hashSyncToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Validate that a string is a valid sync token format */
export function isValidSyncToken(token: string): boolean {
  return TOKEN_REGEX.test(token)
}
