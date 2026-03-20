/**
 * Web UI HTTP server.
 *
 * Extends the existing health endpoint with:
 * - Static login page (no auth)
 * - POST /api/auth (verify password, set session cookie)
 * - POST /api/auth/logout (clear session cookie)
 * - SPA static file serving (requires valid session cookie)
 */

import { join, extname } from 'node:path'
import {
  RateLimiter,
  verifyPassword,
  createSessionToken,
  validateSession,
  buildSessionCookie,
  buildLogoutCookie,
} from './auth'
import type { PlatformServices } from '../runtime/platform'

// ---------------------------------------------------------------------------
// MIME types for static file serving
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
// Options
// ---------------------------------------------------------------------------

export interface WebuiHttpServerOptions {
  /** Port to bind on. Must be > 0. */
  port: number
  /** Path to built web UI dist/ directory. */
  webuiDir: string
  /** Secret used to sign JWTs — typically CRAFT_SERVER_TOKEN. */
  secret: string
  /** Optional separate web UI password. Falls back to `secret` for verification. */
  password?: string
  /** Whether the server is using TLS (affects Secure cookie flag). */
  secure: boolean
  /** WebSocket RPC server URL (ws:// or wss://host:port) — returned in /api/config. */
  wsUrl: string
  /** Health check function (injected from existing server handler). */
  getHealthCheck: () => { status: string }
  /** Logger. */
  logger: PlatformServices['logger']
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startWebuiHttpServer(
  options: WebuiHttpServerOptions,
): Promise<{ stop: () => void }> {
  const {
    port,
    webuiDir,
    secret,
    password,
    secure,
    wsUrl,
    getHealthCheck,
    logger,
  } = options

  const rateLimiter = new RateLimiter(5, 60_000)
  const cleanupTimer = setInterval(() => rateLimiter.cleanup(), 120_000)

  // The password used for the login form — separate web password or the server token
  const loginPassword = password || secret

  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname

      // ── Health endpoint (no auth) ──
      if (path === '/health') {
        const health = getHealthCheck()
        return Response.json(health, {
          status: health.status === 'ok' ? 200 : 503,
        })
      }

      // ── Login page (no auth) ──
      if (path === '/login' || path === '/login/') {
        const loginFile = Bun.file(join(webuiDir, 'login.html'))
        if (await loginFile.exists()) {
          return new Response(loginFile, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
        return new Response('Login page not found', { status: 404 })
      }

      // ── Static assets that login page needs (no auth) ──
      // Allow favicon and any /login-assets/ path without auth
      if (path === '/favicon.ico' || path.startsWith('/login-assets/')) {
        const file = Bun.file(join(webuiDir, path))
        if (await file.exists()) {
          return new Response(file, {
            headers: { 'Content-Type': getMimeType(path) },
          })
        }
        return new Response('Not Found', { status: 404 })
      }

      // ── Auth endpoint ──
      if (path === '/api/auth' && req.method === 'POST') {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? req.headers.get('x-real-ip')
          ?? 'unknown'

        if (!rateLimiter.check(ip)) {
          logger.warn(`[webui] Rate limited auth attempt from ${ip}`)
          return Response.json(
            { error: 'Too many attempts. Try again later.' },
            { status: 429 },
          )
        }

        let body: { password?: string }
        try {
          body = await req.json() as { password?: string }
        } catch {
          return Response.json({ error: 'Invalid request body' }, { status: 400 })
        }

        if (!body.password || typeof body.password !== 'string') {
          return Response.json({ error: 'Password is required' }, { status: 400 })
        }

        if (!verifyPassword(body.password, loginPassword)) {
          logger.warn(`[webui] Failed auth attempt from ${ip}`)
          return Response.json({ error: 'Invalid credentials' }, { status: 401 })
        }

        const jwt = await createSessionToken(secret)
        logger.info(`[webui] Successful auth from ${ip}`)

        return Response.json({ ok: true }, {
          status: 200,
          headers: {
            'Set-Cookie': buildSessionCookie(jwt, secure),
          },
        })
      }

      // ── Logout endpoint ──
      if (path === '/api/auth/logout' && req.method === 'POST') {
        return new Response(null, {
          status: 204,
          headers: {
            'Set-Cookie': buildLogoutCookie(),
          },
        })
      }

      // ── Config endpoint (requires session cookie) ──
      // Returns WS URL and other client configuration
      if (path === '/api/config' && req.method === 'GET') {
        const configSession = await validateSession(req.headers.get('cookie'), secret)
        if (!configSession) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return Response.json({ wsUrl })
      }

      // ── Everything below requires a valid session cookie ──
      const cookieHeader = req.headers.get('cookie')
      const session = await validateSession(cookieHeader, secret)

      if (!session) {
        // For HTML requests (browser navigation), redirect to login
        const accept = req.headers.get('accept') ?? ''
        if (accept.includes('text/html') || path === '/' || path === '') {
          return Response.redirect('/login', 302)
        }
        // For API/asset requests, return 401
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // ── Serve SPA static files ──
      // Try exact file match first
      if (path !== '/') {
        const file = Bun.file(join(webuiDir, path))
        if (await file.exists()) {
          return new Response(file, {
            headers: { 'Content-Type': getMimeType(path) },
          })
        }
      }

      // SPA fallback — serve index.html for all non-file routes
      const indexFile = Bun.file(join(webuiDir, 'index.html'))
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  logger.info(`[webui] Web UI server listening on http://0.0.0.0:${port}`)

  return {
    stop: () => {
      clearInterval(cleanupTimer)
      server.stop()
    },
  }
}
