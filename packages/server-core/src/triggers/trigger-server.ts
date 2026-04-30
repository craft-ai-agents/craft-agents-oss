/**
 * Inbound Webhook Trigger HTTP Server
 *
 * Accepts POST/GET/PUT/PATCH/DELETE requests on /v1/triggers/:workspaceId/:slug
 * and fires `WebhookReceive` events on the matching workspace's automation bus.
 *
 * Off by default. Opt-in via `CRAFT_TRIGGER_PORT` env var.
 *
 * Auth model:
 *   Per-automation HMAC-SHA256. The matcher's `secretEnv` field names an
 *   environment variable holding the shared secret. Inbound requests must
 *   include `X-Craft-Signature: sha256=<hex>` computed over the raw body.
 *
 *   When `secretEnv` is unset, the trigger accepts unauthenticated requests —
 *   only safe on trusted networks / loopback.
 *
 * Why a separate server (instead of folding into the WebUI HTTP handler):
 *   - Different audience (external services vs. browser UI)
 *   - Different auth (HMAC vs. session JWT)
 *   - Can be bound to 0.0.0.0 / behind a tunnel without weakening WebUI security
 *   - Mirrors the existing `startHealthHttpServer` pattern
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AutomationSystem, AutomationMatcher } from '@craft-agent/shared/automations'

const HEADER_SIGNATURE = 'x-craft-signature'
const SIGNATURE_PREFIX = 'sha256='
/** Hard cap on raw request body size; rejected with 413 when exceeded. */
const DEFAULT_BODY_MAX_BYTES = 1_048_576 // 1 MB
/** Per-slug token-bucket rate limit. */
const DEFAULT_RATE_PER_MIN = 60
const RATE_WINDOW_MS = 60_000
/** Path: /v1/triggers/:workspaceId/:slug */
const TRIGGER_PATH_REGEX = /^\/v1\/triggers\/([^/]+)\/([^/]+)\/?$/
const HEALTH_PATH = '/v1/health'

type Logger = {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

/**
 * Resolves a workspace ID to its automation system. Lives on SessionManager,
 * but typed here as an injectable interface so the trigger server doesn't
 * depend on the full SessionManager surface.
 */
export interface AutomationSystemResolver {
  getAutomationSystemForWorkspaceId(workspaceId: string): AutomationSystem | undefined
}

export interface TriggerHttpServerOptions {
  /** TCP port. Server is started only when port > 0. */
  port: number
  /** Bind address. Defaults to 127.0.0.1 (loopback only). */
  host?: string
  /** Workspace + automation lookup. */
  resolver: AutomationSystemResolver
  /** Max raw body size in bytes. Defaults to 1 MB. */
  bodyMaxBytes?: number
  /** Max requests per slug per minute. Defaults to 60. */
  ratePerMin?: number
  /** Logger. Defaults to no-op. */
  logger?: Logger
}

export interface TriggerHttpServerHandle {
  /** Final bound URL (http://host:port). */
  url: string
  /** Stop the server. */
  stop: () => Promise<void>
}

/**
 * Start the trigger HTTP server. When `options.port` is 0 or negative,
 * returns null (opt-out path matches startHealthHttpServer convention).
 */
export async function startTriggerHttpServer(
  options: TriggerHttpServerOptions,
): Promise<TriggerHttpServerHandle | null> {
  if (options.port <= 0) return null

  const host = options.host ?? '127.0.0.1'
  const bodyMaxBytes = options.bodyMaxBytes ?? DEFAULT_BODY_MAX_BYTES
  const ratePerMin = options.ratePerMin ?? DEFAULT_RATE_PER_MIN
  const log = options.logger ?? noopLogger

  // slug → { count, windowStart }. Per-slug bucket prevents one noisy trigger
  // from starving others. Keyed by `${workspaceId}:${slug}` to avoid collisions
  // across workspaces.
  const rateBuckets = new Map<string, { count: number; windowStart: number }>()

  const server = createServer((req, res) => {
    handleRequest(req, res, options.resolver, bodyMaxBytes, ratePerMin, rateBuckets, log).catch(
      (err) => {
        log.error('[trigger-server] Unhandled request error:', err)
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'internal_error' })
        }
      },
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : options.port
  const url = `http://${host}:${port}`
  log.info(`[trigger-server] Listening on ${url}`)

  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  resolver: AutomationSystemResolver,
  bodyMaxBytes: number,
  ratePerMin: number,
  rateBuckets: Map<string, { count: number; windowStart: number }>,
  log: Logger,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === HEALTH_PATH) {
    if (method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
    return sendJson(res, 200, { status: 'ok' })
  }

  const match = TRIGGER_PATH_REGEX.exec(url.pathname)
  if (!match) return sendJson(res, 404, { error: 'not_found' })

  const workspaceId = decodeURIComponent(match[1] ?? '')
  const slug = decodeURIComponent(match[2] ?? '')
  if (!workspaceId || !slug) return sendJson(res, 404, { error: 'not_found' })

  // Rate limit before doing any expensive work
  const bucketKey = `${workspaceId}:${slug}`
  if (!checkRate(rateBuckets, bucketKey, ratePerMin)) {
    return sendJson(res, 429, { error: 'rate_limited' })
  }

  const automationSystem = resolver.getAutomationSystemForWorkspaceId(workspaceId)
  if (!automationSystem) return sendJson(res, 404, { error: 'workspace_not_found' })

  const matcher = automationSystem.findWebhookReceiveMatcher(slug)
  if (!matcher) return sendJson(res, 404, { error: 'trigger_not_found' })

  // Method allow-listing — defaults to POST when not configured
  const allowed = matcher.allowedMethods ?? ['POST']
  if (!allowed.includes(method as typeof allowed[number])) {
    res.setHeader('Allow', allowed.join(', '))
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }

  // Read the raw body up to bodyMaxBytes. Reject 413 if exceeded.
  let bodyRaw: string
  try {
    bodyRaw = await readBody(req, bodyMaxBytes)
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return sendJson(res, 413, { error: 'body_too_large' })
    }
    log.warn('[trigger-server] Body read failed:', err)
    return sendJson(res, 400, { error: 'bad_request' })
  }

  // HMAC verification when secretEnv is configured
  if (matcher.secretEnv) {
    const secret = process.env[matcher.secretEnv]
    if (!secret) {
      // Misconfigured: secretEnv is set but the env var is empty. Fail closed
      // to avoid silently downgrading to unauthenticated.
      log.warn(
        `[trigger-server] secretEnv "${matcher.secretEnv}" is unset on workspace ${workspaceId}/${slug}`,
      )
      return sendJson(res, 500, { error: 'misconfigured_secret' })
    }
    const provided = String(req.headers[HEADER_SIGNATURE] ?? '')
    if (!verifyHmac(secret, bodyRaw, provided)) {
      return sendJson(res, 401, { error: 'invalid_signature' })
    }
  }

  // Best-effort JSON parse for application/json content-type
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  let body: unknown = null
  if (bodyRaw.length > 0 && contentType.includes('application/json')) {
    try {
      body = JSON.parse(bodyRaw)
    } catch {
      // Leave body=null; bodyRaw is still available for downstream actions
    }
  }

  // Lowercase header keys; collapse multi-value headers to comma-joined strings.
  // Matches the expectation of CRAFT_WH_HEADER_* env-var expansion downstream.
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v)
  }

  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    // Keep first value when duplicates appear (predictable; matches most APIs)
    if (!(key in query)) query[key] = value
  })

  const remoteIp = extractRemoteIp(req)

  await automationSystem.fireWebhookReceive({
    slug,
    method,
    headers,
    query,
    body,
    bodyRaw,
    remoteIp,
  })

  return sendJson(res, 200, { ok: true, slug })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class BodyTooLargeError extends Error {
  constructor() {
    super('body too large')
    this.name = 'BodyTooLargeError'
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = 0
    let oversized = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      if (oversized) return // already over limit; drain remaining bytes
      received += chunk.length
      if (received > maxBytes) {
        oversized = true
        // Drain rather than destroy — we still want to write a 413 response,
        // and destroying the socket here causes a client-side ECONNRESET
        // before headers flush.
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (oversized) {
        reject(new BodyTooLargeError())
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function verifyHmac(secret: string, bodyRaw: string, headerValue: string): boolean {
  if (!headerValue.startsWith(SIGNATURE_PREFIX)) return false
  const providedHex = headerValue.slice(SIGNATURE_PREFIX.length).trim()
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false

  const expectedHex = createHmac('sha256', secret).update(bodyRaw, 'utf8').digest('hex')
  if (providedHex.length !== expectedHex.length) return false
  try {
    return timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expectedHex, 'hex'))
  } catch {
    return false
  }
}

function checkRate(
  buckets: Map<string, { count: number; windowStart: number }>,
  key: string,
  ratePerMin: number,
): boolean {
  const now = Date.now()
  const bucket = buckets.get(key) ?? { count: 0, windowStart: now }
  if (now - bucket.windowStart >= RATE_WINDOW_MS) {
    bucket.count = 0
    bucket.windowStart = now
  }
  if (bucket.count >= ratePerMin) {
    buckets.set(key, bucket)
    return false
  }
  bucket.count += 1
  buckets.set(key, bucket)
  return true
}

function extractRemoteIp(req: IncomingMessage): string {
  // Prefer X-Forwarded-For when running behind a trusted proxy. Callers that
  // bind to localhost won't see this header from arbitrary peers.
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0]?.trim() ?? ''
  }
  return req.socket.remoteAddress ?? ''
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

// Re-export for consumers that want to type their own resolvers
export type { AutomationMatcher }
