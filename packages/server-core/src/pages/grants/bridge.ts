/**
 * Page → connector bridge (ADR 0001, WS7).
 *
 * The single endpoint a hostile page can reach. Everything here is a control:
 *
 * - Origin is pinned to the pages origin, and no CORS headers are emitted.
 * - Only POST; preflights are refused rather than answered.
 * - The body is size-capped BEFORE parsing.
 * - Authorization is the grant store, re-checked on every call.
 * - Errors are OPAQUE. An upstream 401, a token, or a URL echoed back to page
 *   JS is an information channel straight out of the sandbox — the page learns
 *   a code, the server log keeps the detail.
 */

import type { GrantStore } from './store.ts'

export interface BridgeOptions {
  grantStore: GrantStore
  /** Current pages origin; a function because the port is chosen at runtime. */
  pagesOrigin: () => string | null
  /** Runs the granted tool. Injected so the bridge is testable without a pool. */
  execute: (sourceSlug: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>
  maxBodyBytes?: number
  maxResponseBytes?: number
  timeoutMs?: number
  maxRequestsPerMinute?: number
  logger?: { warn: (m: string) => void }
}

const DEFAULTS = {
  maxBodyBytes: 64 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRequestsPerMinute: 60,
}

/** Opaque codes. Deliberately coarse — detail belongs in the server log. */
type ErrorCode =
  | 'forbidden'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'invalid_request'
  | 'invalid_params'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_error'

function fail(status: number, code: ErrorCode): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export function createBridgeHandler(opts: BridgeOptions) {
  const cfg = { ...DEFAULTS, ...opts }
  // Sliding window per page. Keyed on pageId rather than grantId so a page
  // cannot multiply its budget by holding several grants.
  const hits = new Map<string, number[]>()

  function rateLimited(pageId: string): boolean {
    const now = Date.now()
    const recent = (hits.get(pageId) ?? []).filter(t => now - t < 60_000)
    if (recent.length >= cfg.maxRequestsPerMinute) {
      hits.set(pageId, recent)
      return true
    }
    recent.push(now)
    hits.set(pageId, recent)
    return false
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed')

    // Pin the Origin. Never derive trust from Host, and never answer a
    // preflight — an endpoint that no cross-origin caller may use does not
    // need one.
    const origin = req.headers.get('origin')
    const expected = opts.pagesOrigin()
    if (!expected || origin !== expected) return fail(403, 'forbidden')

    // Size-cap before parsing. Content-Length is a hint, so the read is capped
    // too — a chunked body can lie about its length.
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > cfg.maxBodyBytes) {
      return fail(413, 'payload_too_large')
    }
    const raw = await req.text()
    if (raw.length > cfg.maxBodyBytes) return fail(413, 'payload_too_large')

    let body: { grantId?: unknown; params?: unknown }
    try {
      body = JSON.parse(raw)
    } catch {
      return fail(400, 'invalid_request')
    }
    if (typeof body?.grantId !== 'string') return fail(400, 'invalid_request')
    const params = (body.params ?? {}) as Record<string, unknown>

    const grant = await opts.grantStore.get(body.grantId)
    if (!grant) return fail(403, 'forbidden')

    if (rateLimited(grant.pageId)) return fail(429, 'rate_limited')

    // Authorization and parameter validation in one place, re-checked every
    // call — including the allowlist, which a tool may have left since the
    // grant was approved.
    const resolved = await opts.grantStore.resolveArgs(body.grantId, params)
    if (!resolved.ok) {
      opts.logger?.warn(`[pages] bridge rejected ${body.grantId}: ${resolved.reason}`)
      // 403 when the grant itself is no longer valid, 400 when the page sent
      // bad values — but the page only ever sees the coarse code.
      const authFailure = /allowlist|unknown grant/i.test(resolved.reason)
      return fail(authFailure ? 403 : 400, authFailure ? 'forbidden' : 'invalid_params')
    }

    let result: unknown
    try {
      result = await Promise.race([
        opts.execute(resolved.grant.sourceSlug, resolved.grant.toolName, resolved.args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('__bridge_timeout__')), cfg.timeoutMs)),
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === '__bridge_timeout__') {
        opts.logger?.warn(`[pages] bridge timeout on ${grant.sourceSlug}.${grant.toolName}`)
        return fail(504, 'timeout')
      }
      // Full detail to the log, opaque code to the page.
      opts.logger?.warn(`[pages] bridge upstream error on ${grant.sourceSlug}.${grant.toolName}: ${msg}`)
      return fail(502, 'upstream_error')
    }

    const serialized = JSON.stringify({ ok: true, data: result })
    if (serialized.length > cfg.maxResponseBytes) {
      opts.logger?.warn(
        `[pages] response from ${grant.sourceSlug}.${grant.toolName} exceeded ${cfg.maxResponseBytes} bytes`,
      )
      return fail(502, 'upstream_error')
    }

    return new Response(serialized, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
}
