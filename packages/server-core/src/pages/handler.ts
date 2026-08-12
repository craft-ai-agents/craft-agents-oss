/**
 * Craft Pages — request handler.
 *
 * A web-standard `(Request) => Promise<Response>` written against `node:fs`.
 *
 * NOT reusable from `webui/http-server.ts`: that module is Bun-only (`Bun.file`
 * at 217/228/386/395, `Bun.password` in `webui/auth.ts`) and Electron main runs
 * Electron's Node, so mounting pages there throws `Bun is not defined` at
 * request time. This handler avoids every Bun global so one implementation
 * serves both hosts.
 */

import { extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { currentRev } from '@craft-agent/session-tools-core'
import { resolveWithinPublicRoot, isReadMethod } from './containment.ts'
import { pagePublicDir, sessionPagesRoot, type PageCatalogService } from './catalog.ts'
import { renderWrapperHtml, WRAPPER_CSS, WRAPPER_JS, PAGE_QUERY_JS } from './wrapper-asset.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * CSP for generated (untrusted) content.
 *
 * `sandbox allow-scripts` is the whole trust model and MUST be a header: the
 * directive is header-only by spec, so it also applies when `/p/*` is opened
 * directly rather than framed. `'self'` is correct — a header policy takes its
 * self-origin from the response URL, not from the document's opaque origin
 * (verified in Chromium and WebKit; ADR 0001 D4).
 */
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  'sandbox allow-scripts',
].join('; ')

/**
 * CSP for the trusted wrapper. No sandbox — it owns the bridge.
 *
 * `frame-src 'self'` is not incidental: it is what blocks a framed page from
 * navigating itself off-origin, which is the primary defence against
 * exfiltration and works in every browser (ADR 0001 D6).
 */
const WRAPPER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'self'",
].join('; ')

const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
}

/**
 * Cross-Origin-Resource-Policy.
 *
 * Page content MUST be 'cross-origin'. A sandboxed page has an OPAQUE origin,
 * which is never same-origin (or same-site) with anything — so 'same-origin'
 * makes the browser fetch every subresource and then DISCARD the response.
 * Scripts never execute, styles never apply, and the server log looks perfectly
 * healthy because the requests genuinely arrived. Verified in Chrome: with
 * 'same-origin' the page is blank; without it every probe passes.
 *
 * This is not a weakening. These resources sit behind Host pinning on a
 * loopback listener, carry no CORS headers (so a foreign origin can embed but
 * never READ them), and are addressed by an unguessable pageId.
 *
 * The wrapper is a normal same-origin document and keeps the stricter value.
 */
const PAGE_CORP = 'cross-origin'
const WRAPPER_CORP = 'same-origin'

export interface PagesHandlerOptions {
  catalog: PageCatalogService
  workspaceRootPath: string
  /** Bound port, used to pin the Host header. */
  getPort: () => number
  /**
   * Live-data bridge. Absent when the feature is off, in which case
   * /internal/query reports live_data_unavailable rather than 404ing like an
   * unknown route — the difference matters when diagnosing.
   */
  bridge?: (req: Request) => Promise<Response>
  /** True when the page holds connector grants (drives Sec-Fetch-Dest gating). */
  pageHasGrants?: (pageId: string) => Promise<boolean>
  /** Source slugs a page may read, for the always-visible wrapper chrome. */
  grantedSources?: (pageId: string) => Promise<string[]>
  /** The page's approved handles → grant ids, inlined into the wrapper. */
  grantsForPage?: (pageId: string) => Promise<Record<string, string>>
  logger?: { warn: (m: string) => void; info: (m: string) => void }
}

function res(status: number, body: string | Uint8Array, headers: Record<string, string> = {}): Response {
  // server-core's tsconfig omits the DOM lib, so the BodyInit type is not in
  // scope; both runtime values here are valid Response bodies.
  return new Response(body as ConstructorParameters<typeof Response>[0], {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  })
}
const text = (status: number, msg: string) =>
  res(status, msg, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })

export function createPagesHandler(opts: PagesHandlerOptions) {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const port = opts.getPort()

    // ── Host pinning ──
    // Without this, a hostile site can DNS-rebind its own name to 127.0.0.1 and
    // reach this server with the browser treating it as same-origin.
    const host = req.headers.get('host')
    if (!host || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      return text(400, 'Bad Host')
    }

    // ── Wrapper assets ──
    if (path === '/w-assets/wrapper.css') {
      return res(200, WRAPPER_CSS, {
        'Content-Type': 'text/css; charset=utf-8',
        'Content-Security-Policy': WRAPPER_CSP,
        'Cross-Origin-Resource-Policy': WRAPPER_CORP,
        'Cache-Control': 'no-store',
      })
    }
    if (path === '/w-assets/wrapper.js') {
      return res(200, WRAPPER_JS, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Security-Policy': WRAPPER_CSP,
        'Cross-Origin-Resource-Policy': WRAPPER_CORP,
        'Cache-Control': 'no-store',
      })
    }

    // Loaded BY THE SANDBOXED PAGE, so it needs the page's CORP, not the
    // wrapper's. An opaque origin is cross-origin to this server: with
    // same-origin CORP the browser fetches this and discards it, leaving the
    // page with no craftQuery and no error anywhere to explain why.
    if (path === '/w-assets/craft-query.js') {
      return res(200, PAGE_QUERY_JS, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Security-Policy': PAGE_CSP,
        'Cross-Origin-Resource-Policy': PAGE_CORP,
        'Cache-Control': 'no-store',
      })
    }

    // ── Trusted wrapper ──
    if (path.startsWith('/w/')) {
      if (!isReadMethod(req.method)) return text(405, 'Method Not Allowed')
      const pageId = decodeURIComponent(path.slice('/w/'.length).replace(/\/+$/, ''))
      const entry = await opts.catalog.resolve(pageId)
      if (!entry) return text(404, 'Page not found')

      const pagesRoot = sessionPagesRoot(opts.workspaceRootPath, entry.sessionId)
      const rev = currentRev(pagesRoot, entry.slug)
      if (rev === 0) return text(404, 'Page has no revisions')

      const sources = opts.grantedSources ? await opts.grantedSources(pageId).catch(() => []) : []
      // Fail closed: if the handles cannot be read, the page gets none and
      // every query it makes is refused, rather than the page loading with
      // stale or partial access.
      const grants = opts.grantsForPage
        ? await opts.grantsForPage(pageId).catch(() => ({}))
        : {}
      return res(200, renderWrapperHtml({ pageId, rev, title: entry.title, sources, grants }), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': WRAPPER_CSP,
        'Cross-Origin-Resource-Policy': WRAPPER_CORP,
        'Cache-Control': 'no-store',
      })
    }

    // ── Untrusted page content: /p/{pageId}/r/{rev}/... ──
    const m = /^\/p\/([^/]+)\/r\/(\d+)(?:\/(.*))?$/.exec(path)
    if (m) {
      if (!isReadMethod(req.method)) return text(405, 'Method Not Allowed')
      const pageId = decodeURIComponent(m[1]!)
      const rev = Number(m[2])
      const rest = m[3] ?? ''

      const entry = await opts.catalog.resolve(pageId)
      if (!entry) return text(404, 'Page not found')

      // A page holding connector grants must never load as a TOP-LEVEL
      // document: frame-src — the control that blocks a page navigating itself
      // off-origin — does not apply there, and nothing replaces it in a
      // third-party browser (ADR 0001 D6). Sec-Fetch-Dest: document means a
      // top-level navigation; iframes report "iframe".
      if (req.headers.get('sec-fetch-dest') === 'document' && opts.pageHasGrants) {
        if (await opts.pageHasGrants(pageId)) {
          opts.logger?.warn(`[pages] refused top-level load of grant-holding page ${pageId}`)
          return text(403, 'This page uses live data and can only be viewed inside Craft Agents.')
        }
      }

      const publicRoot = pagePublicDir(opts.workspaceRootPath, entry.sessionId, entry.slug, rev)
      const resolved = await resolveWithinPublicRoot(publicRoot, rest)
      if (!resolved.ok) {
        if (resolved.status === 400) {
          opts.logger?.warn(`[pages] rejected ${path}: ${resolved.reason}`)
        }
        return text(resolved.status, resolved.status === 400 ? 'Bad Request' : 'Not Found')
      }

      let body: Buffer
      try {
        body = await readFile(resolved.absolutePath)
      } catch {
        return text(404, 'Not Found')
      }

      const headers: Record<string, string> = {
        'Content-Type': MIME[extname(resolved.absolutePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': PAGE_CSP,
        'Cross-Origin-Resource-Policy': PAGE_CORP,
        // Revisions are immutable, so a revisioned URL could be cached forever.
        // It is not, because a stale asset after an edit is the single most
        // likely way this feature feels broken (plan.md WS5).
        'Cache-Control': 'no-store',
      }
      if (req.method === 'HEAD') return res(200, new Uint8Array(0), headers)
      return res(200, new Uint8Array(body), headers)
    }

    // ── Live-data bridge ──
    if (path === '/internal/query') {
      if (!opts.bridge) {
        // Explicit, not a generic 404: "the feature is off" and "your route is
        // wrong" are different diagnoses.
        return res(404, JSON.stringify({ error: 'live_data_unavailable' }), {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
      }
      return opts.bridge(req)
    }

    return text(404, 'Not Found')
  }
}
