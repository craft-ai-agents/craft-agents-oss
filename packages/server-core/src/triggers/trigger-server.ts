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
 *   include `X-Craft-Timestamp` and `X-Craft-Signature: sha256=<hex>`
 *   computed over `${timestamp}.${rawBody}`.
 *
 *   When `secretEnv` is unset, the trigger rejects requests unless the matcher
 *   explicitly sets `allowUnauthenticated: true`.
 *
 * Why a separate server (instead of folding into the WebUI HTTP handler):
 *   - Different audience (external services vs. browser UI)
 *   - Different auth (HMAC vs. session JWT)
 *   - Can be bound to 0.0.0.0 / behind a tunnel without weakening WebUI security
 *   - Mirrors the existing `startHealthHttpServer` pattern
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  appendWebhookDeliveryRecord,
  type AutomationSystem,
  type AutomationMatcher,
  type WebhookDeliveryRecord,
} from '@craft-agent/shared/automations'

const HEADER_SIGNATURE = 'x-craft-signature'
const HEADER_TIMESTAMP = 'x-craft-timestamp'
const SIGNATURE_PREFIX = 'sha256='
/** Hard cap on raw request body size; rejected with 413 when exceeded. */
const DEFAULT_BODY_MAX_BYTES = 1_048_576 // 1 MB
const DEFAULT_BODY_READ_TIMEOUT_MS = 30_000
const DEFAULT_SIGNATURE_SKEW_MS = 5 * 60_000
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
  /** Max time to read the raw request body. Defaults to 30s. */
  bodyReadTimeoutMs?: number
  /** Max allowed age/skew for X-Craft-Timestamp. Defaults to 5 minutes. */
  signatureSkewMs?: number
  /**
   * Proxy IPs whose X-Forwarded-For header should be trusted for remoteIp.
   * When omitted, CRAFT_TRIGGER_TRUSTED_PROXIES is parsed as a comma-separated list.
   * X-Forwarded-For is ignored by default.
   */
  trustedProxyIps?: string[]
  /** Logger. Defaults to no-op. */
  logger?: Logger
  /** Optional test hook/custom persistence for inbound webhook delivery history. */
  deliveryRecorder?: WebhookDeliveryRecorder
}

export type WebhookDeliveryRecorder = (
  workspaceRootPath: string,
  record: WebhookDeliveryRecord,
) => Promise<void>

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
  const bodyReadTimeoutMs = options.bodyReadTimeoutMs ?? DEFAULT_BODY_READ_TIMEOUT_MS
  const signatureSkewMs = options.signatureSkewMs ?? DEFAULT_SIGNATURE_SKEW_MS
  const ratePerMin = options.ratePerMin ?? DEFAULT_RATE_PER_MIN
  const trustedProxyIps = options.trustedProxyIps ?? parseTrustedProxyEnv()
  const log = options.logger ?? noopLogger

  // slug → { count, windowStart }. Per-slug bucket prevents one noisy trigger
  // from starving others. Keyed by `${workspaceId}:${slug}` to avoid collisions
  // across workspaces.
  const rateBuckets = new Map<string, { count: number; windowStart: number }>()

  const server = createServer((req, res) => {
    handleRequest(
      req,
      res,
      options.resolver,
      {
        bodyMaxBytes,
        bodyReadTimeoutMs,
        signatureSkewMs,
        ratePerMin,
        trustedProxyIps,
        deliveryRecorder: options.deliveryRecorder ?? appendWebhookDeliveryRecord,
      },
      rateBuckets,
      log,
    ).catch(
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
  config: {
    bodyMaxBytes: number
    bodyReadTimeoutMs: number
    signatureSkewMs: number
    ratePerMin: number
    trustedProxyIps: string[]
    deliveryRecorder: WebhookDeliveryRecorder
  },
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
  const remoteIp = extractRemoteIp(req, config.trustedProxyIps)

  const automationSystem = resolver.getAutomationSystemForWorkspaceId(workspaceId)
  if (!automationSystem) {
    log.warn(`[trigger-server] Webhook delivery rejected for unknown workspace: ${workspaceId}/${slug}`)
    return sendJson(res, 404, { error: 'workspace_not_found' })
  }
  const workspaceRootPath = getAutomationSystemWorkspaceRootPath(automationSystem)

  const matcher = automationSystem.findWebhookReceiveMatcher(slug)
  if (!matcher) {
    await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
      timestamp: Date.now(),
      workspaceId,
      slug,
      method,
      outcome: 'trigger_not_found',
      httpStatus: 404,
      remoteIp,
      reason: 'trigger_not_found',
    })
    return sendJson(res, 404, { error: 'trigger_not_found' })
  }

  // Method allow-listing — defaults to POST when not configured
  const allowed = matcher.allowedMethods ?? ['POST']
  if (!allowed.includes(method as typeof allowed[number])) {
    res.setHeader('Allow', allowed.join(', '))
    await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
      timestamp: Date.now(),
      workspaceId,
      slug,
      matcherId: matcher.id,
      method,
      outcome: 'method_not_allowed',
      httpStatus: 405,
      remoteIp,
      reason: 'method_not_allowed',
    })
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }

  // Read the raw body up to bodyMaxBytes. Reject 413 if exceeded.
  let bodyRaw: string
  try {
    bodyRaw = await readBody(req, config.bodyMaxBytes, config.bodyReadTimeoutMs)
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
        timestamp: Date.now(),
        workspaceId,
        slug,
        matcherId: matcher.id,
        method,
        outcome: 'body_too_large',
        httpStatus: 413,
        remoteIp,
        reason: 'body_too_large',
      })
      return sendJsonAndClose(req, res, 413, { error: 'body_too_large' })
    }
    if (err instanceof BodyReadTimeoutError) {
      await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
        timestamp: Date.now(),
        workspaceId,
        slug,
        matcherId: matcher.id,
        method,
        outcome: 'body_read_timeout',
        httpStatus: 408,
        remoteIp,
        reason: 'body_read_timeout',
      })
      return sendJsonAndClose(req, res, 408, { error: 'body_read_timeout' })
    }
    log.warn('[trigger-server] Body read failed:', err)
    await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
      timestamp: Date.now(),
      workspaceId,
      slug,
      matcherId: matcher.id,
      method,
      outcome: 'bad_request',
      httpStatus: 400,
      remoteIp,
      reason: 'bad_request',
    })
    return sendJson(res, 400, { error: 'bad_request' })
  }

  if (matcher.secretEnv) {
    const secret = process.env[matcher.secretEnv]
    if (!secret) {
      // Misconfigured: secretEnv is set but the env var is empty. Fail closed
      // to avoid silently downgrading to unauthenticated.
      log.warn(
        `[trigger-server] secretEnv "${matcher.secretEnv}" is unset on workspace ${workspaceId}/${slug}`,
      )
      await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
        timestamp: Date.now(),
        workspaceId,
        slug,
        matcherId: matcher.id,
        method,
        outcome: 'misconfigured_secret',
        httpStatus: 500,
        remoteIp,
        reason: 'misconfigured_secret',
      })
      return sendJson(res, 500, { error: 'misconfigured_secret' })
    }
    const provided = String(req.headers[HEADER_SIGNATURE] ?? '')
    const timestamp = String(req.headers[HEADER_TIMESTAMP] ?? '')
    const timestampCheck = verifyTimestamp(timestamp, config.signatureSkewMs)
    if (!timestampCheck.ok) {
      await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
        timestamp: Date.now(),
        workspaceId,
        slug,
        matcherId: matcher.id,
        method,
        outcome: timestampCheck.error,
        httpStatus: 401,
        remoteIp,
        reason: timestampCheck.error,
      })
      return sendJson(res, 401, { error: timestampCheck.error })
    }
    if (!verifyHmac(secret, timestamp, bodyRaw, provided)) {
      await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
        timestamp: Date.now(),
        workspaceId,
        slug,
        matcherId: matcher.id,
        method,
        outcome: 'invalid_signature',
        httpStatus: 401,
        remoteIp,
        reason: 'invalid_signature',
      })
      return sendJson(res, 401, { error: 'invalid_signature' })
    }
  } else if (!matcher.allowUnauthenticated) {
    await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
      timestamp: Date.now(),
      workspaceId,
      slug,
      matcherId: matcher.id,
      method,
      outcome: 'unauthenticated_denied',
      httpStatus: 401,
      remoteIp,
      reason: 'authentication_required',
    })
    return sendJson(res, 401, { error: 'authentication_required' })
  }

  const bucketKey = `${workspaceId}:${slug}`
  if (!checkRate(rateBuckets, bucketKey, config.ratePerMin)) {
    await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
      timestamp: Date.now(),
      workspaceId,
      slug,
      matcherId: matcher.id,
      method,
      outcome: 'rate_limited',
      httpStatus: 429,
      remoteIp,
      reason: 'rate_limited',
    })
    return sendJson(res, 429, { error: 'rate_limited' })
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

  const delivery = await automationSystem.fireWebhookReceive({
    slug,
    method,
    headers,
    query,
    body,
    bodyRaw,
    remoteIp,
  })

  if (delivery.status === 'rate_limited') {
    await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
      timestamp: Date.now(),
      workspaceId,
      slug,
      matcherId: matcher.id,
      method,
      outcome: 'event_bus_rate_limited',
      httpStatus: 429,
      remoteIp,
      reason: 'event_bus_rate_limited',
    })
    return sendJson(res, 429, {
      error: 'event_bus_rate_limited',
      limit: delivery.limit,
      count: delivery.count,
    })
  }
  if (delivery.status === 'disposed') {
    await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
      timestamp: Date.now(),
      workspaceId,
      slug,
      matcherId: matcher.id,
      method,
      outcome: 'automation_system_unavailable',
      httpStatus: 503,
      remoteIp,
      reason: 'automation_system_unavailable',
    })
    return sendJson(res, 503, { error: 'automation_system_unavailable' })
  }

  await recordDelivery(config.deliveryRecorder, workspaceRootPath, log, {
    timestamp: Date.now(),
    workspaceId,
    slug,
    matcherId: matcher.id,
    method,
    outcome: 'accepted',
    httpStatus: 202,
    remoteIp,
    reason: 'accepted',
  })
  return sendJson(res, 202, { ok: true, slug })
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

class BodyReadTimeoutError extends Error {
  constructor() {
    super('body read timeout')
    this.name = 'BodyReadTimeoutError'
  }
}

function readBody(req: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = 0
    let oversized = false
    let settled = false
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new BodyReadTimeoutError())
    }, timeoutMs)
    const cleanup = () => clearTimeout(timeout)
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    req.on('data', (chunk: Buffer) => {
      if (oversized) return // already over limit; drain remaining bytes
      received += chunk.length
      if (received > maxBytes) {
        oversized = true
        fail(new BodyTooLargeError())
        req.pause()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (oversized) {
        fail(new BodyTooLargeError())
        return
      }
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => fail(err))
  })
}

function verifyTimestamp(
  headerValue: string,
  skewMs: number,
): { ok: true } | { ok: false; error: 'missing_timestamp' | 'invalid_timestamp' | 'stale_timestamp' } {
  if (!headerValue) return { ok: false, error: 'missing_timestamp' }
  if (!/^\d+$/.test(headerValue)) return { ok: false, error: 'invalid_timestamp' }
  const numeric = Number(headerValue)
  if (!Number.isSafeInteger(numeric)) return { ok: false, error: 'invalid_timestamp' }
  const timestampMs = headerValue.length <= 10 ? numeric * 1000 : numeric
  if (Math.abs(Date.now() - timestampMs) > skewMs) return { ok: false, error: 'stale_timestamp' }
  return { ok: true }
}

function verifyHmac(secret: string, timestamp: string, bodyRaw: string, headerValue: string): boolean {
  if (!headerValue.startsWith(SIGNATURE_PREFIX)) return false
  const providedHex = headerValue.slice(SIGNATURE_PREFIX.length).trim()
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false

  const expectedHex = createHmac('sha256', secret)
    .update(`${timestamp}.${bodyRaw}`, 'utf8')
    .digest('hex')
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

function extractRemoteIp(req: IncomingMessage, trustedProxyIps: string[]): string {
  const socketIp = req.socket.remoteAddress ?? ''
  const xff = req.headers['x-forwarded-for']
  if (trustedProxyIps.includes(socketIp) && typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0]?.trim() ?? ''
  }
  return socketIp
}

function parseTrustedProxyEnv(): string[] {
  return (process.env.CRAFT_TRIGGER_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function getAutomationSystemWorkspaceRootPath(automationSystem: AutomationSystem): string {
  const candidate = automationSystem as AutomationSystem & { getWorkspaceRootPath?: () => string }
  return candidate.getWorkspaceRootPath?.() ?? ''
}

async function recordDelivery(
  recorder: WebhookDeliveryRecorder,
  workspaceRootPath: string,
  log: Logger,
  record: WebhookDeliveryRecord,
): Promise<void> {
  if (!workspaceRootPath) return
  try {
    await recorder(workspaceRootPath, record)
  } catch (err) {
    log.warn('[trigger-server] Failed to write webhook delivery history:', err)
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function sendJsonAndClose(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.setHeader('Connection', 'close')
  res.once('finish', () => req.destroy())
  sendJson(res, status, body)
}

// Re-export for consumers that want to type their own resolvers
export type { AutomationMatcher }
