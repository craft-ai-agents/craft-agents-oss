/**
 * Self-hosted conversation-share server.
 *
 * Serves the open-source session viewer (`apps/viewer`) plus the `/s/api`
 * storage endpoints that the desktop/web client talks to when its
 * `CRAFT_VIEWER_URL` points here — so shared transcripts never leave the
 * operator's own infrastructure.
 *
 * Mirrors `webui/http-server.ts`: the core is a web-standard fetch handler
 * (`createShareHandler`) that can be wrapped by `Bun.serve` on its own port
 * (`startShareHttpServer`), separate from the RPC/WebSocket port.
 *
 * Endpoints (contract matches the hosted service so the client is unchanged):
 *   POST   /s/api        body: StoredSession JSON        -> { id, url }
 *   GET    /s/api/:id                                    -> StoredSession JSON | 404
 *   PUT    /s/api/:id    body: StoredSession JSON        -> 204
 *   DELETE /s/api/:id                                    -> 204 | 404
 *   GET    /s, /s/:id, /s/assets/*                       -> viewer SPA (static)
 *   GET    /health                                       -> { status }
 *
 * Optional built-in HTTP Basic auth (`CRAFT_SHARE_BASIC_AUTH=user:pass`) gates
 * every `/s/*` route. Operators fronting this with a reverse proxy (Traefik,
 * nginx) can leave it unset and enforce auth there instead.
 */

import { join, extname } from 'node:path'
import { RateLimiter } from '../webui/auth'
import type { PlatformServices } from '../runtime/platform'
import { isSafeShareId, type ShareStore } from './store'

const authEncoder = new TextEncoder()

/**
 * Constant-time string comparison — avoids leaking length/prefix via timing.
 * (The webui `verifyPassword` is bound to a single global hashed password, so
 * the share server rolls its own compare for its user:pass credentials.)
 */
function timingSafeEqual(input: string, expected: string): boolean {
  const a = authEncoder.encode(input)
  const b = authEncoder.encode(expected)
  const len = Math.max(a.length, b.length)
  let mismatch = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return mismatch === 0
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.map': 'application/json',
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// Request helpers (proxy-aware, mirrors webui/http-server.ts)
// ---------------------------------------------------------------------------

function getRequestProto(req: Request): string {
  return req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || new URL(req.url).protocol.replace(/:$/, '')
}

function getRequestHost(req: Request): string | null {
  return req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || req.headers.get('host')
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BasicAuthCredentials {
  user: string
  pass: string
}

export interface ShareHandlerOptions {
  /** Path to the built viewer (`apps/viewer/dist`). */
  viewerDir: string
  /** Persistence backend (hash copies or live sessions). */
  store: ShareStore
  /**
   * Absolute public base URL for building share links (e.g.
   * `https://share.example.com`). When unset, derived from request headers.
   */
  publicBaseUrl?: string
  /** When set, all `/s/*` routes require HTTP Basic auth with these creds. */
  basicAuth?: BasicAuthCredentials
  /** Reject upload bodies larger than this (bytes). Surfaced to client as 413. */
  maxBodyBytes: number
  logger: PlatformServices['logger']
}

export interface ShareHandler {
  fetch: (req: Request) => Promise<Response>
  dispose: () => void
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createShareHandler(options: ShareHandlerOptions): ShareHandler {
  const { viewerDir, store, publicBaseUrl, basicAuth, maxBodyBytes, logger } = options

  // Brute-force protection for the Basic auth gate (per-IP sliding window).
  const rateLimiter = new RateLimiter(10, 60_000)
  const cleanupTimer = setInterval(() => rateLimiter.cleanup(), 120_000)

  function clientIp(req: Request): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown'
  }

  /** Returns an error Response if the request fails the Basic auth gate, else null. */
  function checkBasicAuth(req: Request): Response | null {
    if (!basicAuth) return null

    const unauthorized = (msg: string, status = 401) =>
      new Response(msg, {
        status,
        headers: { 'WWW-Authenticate': 'Basic realm="Craft Agent Shared Sessions"' },
      })

    const ip = clientIp(req)
    if (!rateLimiter.check(ip)) {
      logger.warn(`[share] Rate limited auth attempt from ${ip}`)
      return new Response('Too many attempts. Try again later.', { status: 429 })
    }

    const header = req.headers.get('authorization')
    if (!header || !header.startsWith('Basic ')) {
      return unauthorized('Authentication required')
    }
    let decoded = ''
    try {
      decoded = atob(header.slice(6).trim())
    } catch {
      return unauthorized('Invalid credentials')
    }
    const idx = decoded.indexOf(':')
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded
    const pass = idx >= 0 ? decoded.slice(idx + 1) : ''
    // Constant-time compare on both fields (evaluate both to avoid short-circuit timing).
    const userOk = timingSafeEqual(user, basicAuth.user)
    const passOk = timingSafeEqual(pass, basicAuth.pass)
    const ok = userOk && passOk
    if (!ok) {
      logger.warn(`[share] Failed auth attempt from ${ip}`)
      return unauthorized('Invalid credentials')
    }
    return null
  }

  function buildShareUrl(req: Request, id: string): string {
    if (publicBaseUrl) return `${publicBaseUrl.replace(/\/+$/, '')}/s/${id}`
    const host = getRequestHost(req) ?? '127.0.0.1'
    return `${getRequestProto(req)}://${host}/s/${id}`
  }

  async function serveStatic(relPath: string): Promise<Response | null> {
    const file = Bun.file(join(viewerDir, relPath))
    if (await file.exists()) {
      return new Response(file, { headers: { 'Content-Type': getMimeType(relPath) } })
    }
    return null
  }

  async function serveIndex(): Promise<Response> {
    const index = Bun.file(join(viewerDir, 'index.html'))
    if (await index.exists()) {
      return new Response(index, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    return new Response('Viewer not built', { status: 404 })
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    // ── Health (no auth) ──
    if (path === '/health') {
      return Response.json({ status: 'ok', mode: store.mode })
    }

    // Everything under /s is gated by optional Basic auth.
    const authError = checkBasicAuth(req)
    if (authError) return authError

    // ── API: /s/api and /s/api/:id ──
    if (path === '/s/api' || path.startsWith('/s/api/')) {
      return handleApi(req, path)
    }

    // ── Viewer SPA static assets: /s/assets/* -> <viewerDir>/assets/* ──
    if (path.startsWith('/s/assets/')) {
      const asset = await serveStatic(path.slice('/s/'.length))
      return asset ?? new Response('Not Found', { status: 404 })
    }

    // ── Viewer SPA: /s, /s/, /s/<id> -> index.html (client-side routing) ──
    if (path === '/s' || path === '/s/' || /^\/s\/[^/]+$/.test(path)) {
      // Allow real files that happen to sit at the root (favicon, etc.).
      if (path !== '/s' && path !== '/s/') {
        const maybeFile = await serveStatic(path.slice('/s/'.length))
        if (maybeFile) return maybeFile
      }
      return serveIndex()
    }

    return new Response('Not Found', { status: 404 })
  }

  async function readJsonBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
    const declaredLen = Number(req.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLen) && declaredLen > maxBodyBytes) {
      return { ok: false, response: new Response('Payload too large', { status: 413 }) }
    }
    const raw = await req.text()
    if (raw.length > maxBodyBytes) {
      return { ok: false, response: new Response('Payload too large', { status: 413 }) }
    }
    try {
      return { ok: true, value: JSON.parse(raw) }
    } catch {
      return { ok: false, response: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    }
  }

  async function handleApi(req: Request, path: string): Promise<Response> {
    // POST /s/api — create a new share.
    if (path === '/s/api') {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
      const body = await readJsonBody(req)
      if (!body.ok) return body.response
      try {
        const id = await store.create(body.value as Record<string, unknown>)
        return Response.json({ id, url: buildShareUrl(req, id) })
      } catch (err) {
        logger.error('[share] create failed:', err)
        return Response.json({ error: 'Failed to create share' }, { status: 500 })
      }
    }

    // /s/api/:id — read / update / revoke.
    const id = decodeURIComponent(path.slice('/s/api/'.length))
    if (!isSafeShareId(id)) return new Response('Not Found', { status: 404 })

    if (req.method === 'GET') {
      const session = await store.get(id)
      if (!session) return new Response('Not Found', { status: 404 })
      return Response.json(session)
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req)
      if (!body.ok) return body.response
      try {
        await store.put(id, body.value as Record<string, unknown>)
        return new Response(null, { status: 204 })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }

    if (req.method === 'DELETE') {
      const removed = await store.delete(id)
      return new Response(null, { status: removed ? 204 : 404 })
    }

    return new Response('Method Not Allowed', { status: 405 })
  }

  return {
    fetch,
    dispose: () => clearInterval(cleanupTimer),
  }
}

// ---------------------------------------------------------------------------
// Standalone server (separate port, via Bun.serve)
// ---------------------------------------------------------------------------

export interface ShareHttpServerOptions extends ShareHandlerOptions {
  /** Port to bind. Use 0 for an ephemeral port (tests). */
  port: number
  /** Bind address. Defaults to 0.0.0.0 so a reverse proxy can reach it. */
  host?: string
}

export async function startShareHttpServer(
  options: ShareHttpServerOptions,
): Promise<{ port: number; stop: () => void }> {
  const { port, host, logger, ...handlerOpts } = options
  const handler = createShareHandler({ ...handlerOpts, logger })

  const server = Bun.serve({
    port,
    hostname: host ?? '0.0.0.0',
    fetch: handler.fetch,
  })

  const boundPort = server.port ?? port
  logger.info(
    `[share] Share server listening on http://${host ?? '0.0.0.0'}:${boundPort} ` +
    `(id mode: ${handlerOpts.store.mode}${handlerOpts.basicAuth ? ', basic auth on' : ''})`,
  )

  return {
    port: boundPort,
    stop: () => {
      handler.dispose()
      server.stop()
    },
  }
}
