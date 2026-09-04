/**
 * Web UI session authentication.
 *
 * Cookie-based JWT session auth for the browser-served web UI.
 * - Login: verify password → issue signed JWT → set HttpOnly cookie
 * - Validation: check cookie on every HTTP request + WebSocket upgrade
 * - Rate limiting: per-IP brute-force protection on /api/auth
 */

import { SignJWT, jwtVerify, decodeJwt } from 'jose'
import { randomUUID } from 'node:crypto'
import type { AccountStore } from './accounts'

// ---------------------------------------------------------------------------
// JWT helpers (via jose library)
// ---------------------------------------------------------------------------

const JWT_EXPIRY_SECONDS = 86_400 // 24 hours

export interface JwtPayload {
  sub: string
  iat: number
  exp: number
  ver?: number
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ sub: payload.sub, ver: payload.ver ?? 0 } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .sign(key)
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || !payload.sub || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || (payload.ver !== undefined && (!Number.isSafeInteger(payload.ver) || Number(payload.ver) < 0))) return null
    return {
      sub: payload.sub as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      ver: (payload.ver as number | undefined) ?? 0,
    }
  } catch {
    return null
  }
}

export async function createSessionToken(secret: string, subject = 'webui', authVersion = 0): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({ sub: subject, iat: now, exp: now + JWT_EXPIRY_SECONDS, ver: authVersion }, secret)
}

/** Supplemental revocation check ONLY for an already signature-verified WS cookie. Never use to authenticate a new connection. */
export function isEstablishedAccountSessionActive(cookie: string | null, principalId: string, accounts: AccountStore): boolean {
  try {
    const token = extractSessionCookie(cookie)
    if (!token || accounts.isTokenRevoked(token)) return false
    const claims = decodeJwt(token)
    return claims.sub === principalId && typeof claims.exp === 'number' && claims.exp > Date.now() / 1000
      && accounts.isSessionActive(principalId, (claims.ver as number | undefined) ?? 0)
  } catch { return false }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'craft_session'

export function buildSessionCookie(jwt: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${JWT_EXPIRY_SECONDS}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildLogoutCookie(secure = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function extractSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const pair of cookieHeader.split(';')) {
    const [name, ...rest] = pair.trim().split('=')
    if (name === SESSION_COOKIE_NAME) return rest.join('=')
  }
  return null
}

// ---------------------------------------------------------------------------
// Password verification (argon2id via Bun.password)
// ---------------------------------------------------------------------------

let hashedPassword: string | null = null

/**
 * Hash the login password at startup. Must be called before any auth requests.
 * The hash is stored in memory — the raw password is not retained.
 */
export async function initPasswordHash(plaintext: string): Promise<void> {
  hashedPassword = await Bun.password.hash(plaintext, { algorithm: 'argon2id' })
}

/**
 * Verify a user-supplied password against the pre-hashed password.
 * Uses Bun's built-in argon2id verification (constant-time).
 */
export async function verifyPassword(input: string): Promise<boolean> {
  if (!hashedPassword) return false
  return Bun.password.verify(input, hashedPassword)
}

// ---------------------------------------------------------------------------
// Rate limiter (per-IP + global, sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  attempts: number
  windowStart: number
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>()
  private readonly maxAttempts: number
  private readonly windowMs: number
  /** Global counter — blocks all IPs after too many total failures (defeats IP spoofing). */
  private readonly maxGlobalAttempts: number
  private globalAttempts = 0
  private globalWindowStart = Date.now()

  constructor(maxAttempts = 5, windowMs = 60_000, maxGlobalAttempts = 20) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
    this.maxGlobalAttempts = maxGlobalAttempts
  }

  /** Returns true if the request should be allowed, false if rate-limited. */
  check(ip: string): boolean {
    const now = Date.now()

    // Reset global window if expired
    if (now - this.globalWindowStart > this.windowMs) {
      this.globalAttempts = 0
      this.globalWindowStart = now
    }

    // Global rate limit — blocks everyone if too many total attempts
    this.globalAttempts++
    if (this.globalAttempts > this.maxGlobalAttempts) return false

    // Per-IP rate limit
    const entry = this.entries.get(ip)

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.entries.set(ip, { attempts: 1, windowStart: now })
      return true
    }

    entry.attempts++
    if (entry.attempts > this.maxAttempts) return false
    return true
  }

  /** Periodic cleanup of stale entries (call on a timer). */
  cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.entries) {
      if (now - entry.windowStart > this.windowMs * 2) {
        this.entries.delete(ip)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session validator (used by both HTTP and WebSocket)
// ---------------------------------------------------------------------------

export async function validateSession(
  cookieHeader: string | null,
  secret: string,
): Promise<JwtPayload | null> {
  const token = extractSessionCookie(cookieHeader)
  if (!token) return null
  return verifyJwt(token, secret)
}
