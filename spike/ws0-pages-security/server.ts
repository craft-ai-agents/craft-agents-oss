/**
 * WS0 SPIKE — throwaway. Delete after the ADR lands.
 *
 * Minimal PagesServer prototype whose only job is to let us run the WS0 exit
 * criteria against real browser engines. This is NOT the shipping
 * implementation: no catalog, no revisions-on-disk, no grants, no RPC.
 *
 * What it does model faithfully, because the exit criteria depend on it:
 *   - a dedicated node:http listener on loopback (never the RPC/WS port)
 *   - /w/{pageId}  trusted wrapper  — strict CSP, NO sandbox
 *   - /p/{pageId}/r/{rev}/*  untrusted page — CSP *response header* carrying
 *     `sandbox allow-scripts`, so the sandbox applies even when the URL is
 *     opened directly in a tab rather than framed by the wrapper
 *   - Host header pinning
 *   - a containment guard that rejects symlinked components (validateFilePath
 *     is unsuitable: it allows all of homedir())
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, realpath, lstat } from 'node:fs/promises'
import { join, resolve, sep, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PAGES_ROOT = join(HERE, 'fixtures', 'pages')
const WRAPPER_FILE = join(HERE, 'fixtures', 'wrapper.html')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/**
 * CSP for generated (untrusted) page content.
 *
 * `sandbox allow-scripts` is the load-bearing part and is the reason this must
 * be a header: the CSP sandbox directive is header-only by spec, and an iframe
 * sandbox attribute would not apply to a directly-opened URL.
 *
 * `style-src 'self'` deliberately omits 'unsafe-inline' so the spike can
 * MEASURE what that costs (inline <style>, style="" attributes, CSSOM writes)
 * rather than guessing. That is an open decision the ADR has to close.
 */
function pageCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    'sandbox allow-scripts',
  ].join('; ')
}

/** CSP for the trusted wrapper. No sandbox — it owns the bridge. */
function wrapperCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    // The wrapper must be allowed to frame the page origin.
    "frame-src 'self'",
  ].join('; ')
}

/**
 * Containment guard.
 *
 * Deliberately NOT packages/server-core/src/handlers/utils.ts:validateFilePath —
 * that realpath()s and then checks against [homedir(), tmpdir(), ...], so a
 * symlink to ~/.craft-agent/credentials.enc resolves under homedir() and passes.
 */
async function resolveWithin(root: string, relPath: string): Promise<string | null> {
  // Reject before touching the filesystem.
  const decoded = decodeURIComponent(relPath)
  if (decoded.includes('\0')) return null
  if (decoded.includes('\\')) return null
  if (decoded.includes(':')) return null // Windows drive-relative + ADS
  if (/(^|\/)\.[^/]/.test(decoded)) return null // dotfiles

  const candidate = resolve(join(root, normalize(decoded)))
  const realRoot = await realpath(root).catch(() => null)
  if (!realRoot) return null
  if (candidate !== realRoot && !candidate.startsWith(realRoot + sep)) return null

  // Reject if ANY component below the root is a symlink — checking only the
  // final realpath is not enough when the allowed set is broad.
  const rel = candidate.slice(realRoot.length).split(sep).filter(Boolean)
  let walk = realRoot
  for (const part of rel) {
    walk = join(walk, part)
    const st = await lstat(walk).catch(() => null)
    if (!st) return null
    if (st.isSymbolicLink()) return null
  }
  return candidate
}

function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
    ...headers,
  })
  res.end(body)
}

export function createPagesServer(opts: { port?: number } = {}) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const bound = server.address()
    const boundPort = typeof bound === 'object' && bound ? bound.port : opts.port
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${boundPort}`)
    const path = url.pathname

    // ── Host pinning (DNS-rebinding defence) ──
    // Only the exact bound loopback authority is acceptable.
    const host = req.headers.host
    const allowedHosts = new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`])
    if (!host || !allowedHosts.has(host)) {
      send(res, 400, 'Bad Host', { 'Content-Type': 'text/plain' })
      return
    }

    // ── Trusted wrapper ──
    if (path.startsWith('/w/')) {
      const html = await readFile(WRAPPER_FILE, 'utf-8').catch(() => null)
      if (!html) return send(res, 404, 'no wrapper', { 'Content-Type': 'text/plain' })
      const pageId = path.slice('/w/'.length).replace(/\/$/, '')
      return send(res, 200, html.replace(/__PAGE_ID__/g, pageId), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': wrapperCsp(),
        'Cache-Control': 'no-store',
      })
    }

    // ── Wrapper assets (trusted, same strict policy, no sandbox) ──
    if (path.startsWith('/w-assets/')) {
      const file = await resolveWithin(join(HERE, 'fixtures', 'w-assets'), path.slice('/w-assets/'.length))
      if (!file) return send(res, 400, 'Rejected', { 'Content-Type': 'text/plain' })
      const buf = await readFile(file).catch(() => null)
      if (!buf) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' })
      return send(res, 200, buf, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': wrapperCsp(),
        'Cache-Control': 'no-store',
      })
    }

    // ── Untrusted page content ──
    // /p/{pageId}/r/{rev}/{...file}
    const m = /^\/p\/([^/]+)\/r\/([^/]+)\/(.*)$/.exec(path)
    if (m) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain' })
      }
      const [, pageId, rev, restRaw] = m
      const rest = restRaw === '' ? 'index.html' : restRaw
      const root = join(PAGES_ROOT, pageId!, 'r', rev!, 'public')
      const file = await resolveWithin(root, rest)
      if (!file) return send(res, 400, 'Rejected by containment guard', { 'Content-Type': 'text/plain' })

      const buf = await readFile(file).catch(() => null)
      if (!buf) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' })

      return send(res, 200, buf, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': pageCsp(),
        'Cache-Control': 'no-store',
      })
    }

    // ── Bridge stub (WS7 shape only — proves the postMessage path, no grants) ──
    if (path === '/internal/query' && req.method === 'POST') {
      const origin = req.headers.origin
      if (origin !== `http://127.0.0.1:${boundPort}`) {
        return send(res, 403, JSON.stringify({ error: 'bad_origin' }), {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
      }
      return send(res, 200, JSON.stringify({ ok: true, data: { stub: true } }), {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      })
    }

    send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' })
  })

  return {
    server,
    listen: (port = opts.port ?? 0) =>
      new Promise<number>((ok) => {
        server.listen(port, '127.0.0.1', () => {
          const a = server.address()
          ok(typeof a === 'object' && a ? a.port : port)
        })
      }),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  }
}

// Run standalone: `node spike/ws0-pages-security/server.ts`
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const s = createPagesServer()
  const port = await s.listen(Number(process.env.PORT ?? 0))
  console.log(`[ws0] pages server on http://127.0.0.1:${port}`)
  console.log(`[ws0] wrapper:  http://127.0.0.1:${port}/w/test-page`)
  console.log(`[ws0] direct:   http://127.0.0.1:${port}/p/test-page/r/1/index.html`)
}
