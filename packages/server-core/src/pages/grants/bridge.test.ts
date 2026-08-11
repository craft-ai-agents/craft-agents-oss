/**
 * The page → connector bridge.
 *
 * This is the one endpoint a hostile page can reach, so every check here is
 * load-bearing. Notably: errors must be OPAQUE. An upstream 401, a rate-limit
 * body, or a URL leaked back to page JS is an information channel out of the
 * sandbox.
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GrantStore } from './store.ts'
import { createBridgeHandler } from './bridge.ts'

const ORIGIN = 'http://127.0.0.1:51234'

let ws: string
let store: GrantStore
let grantId: string
let calls: Array<{ sourceSlug: string; toolName: string; args: Record<string, unknown> }>
let executorResult: unknown
let executorError: Error | null
let executorDelayMs: number

function handler(overrides: Partial<Parameters<typeof createBridgeHandler>[0]> = {}) {
  return createBridgeHandler({
    grantStore: store,
    pagesOrigin: () => ORIGIN,
    execute: async (sourceSlug, toolName, args) => {
      calls.push({ sourceSlug, toolName, args })
      if (executorDelayMs) await new Promise(r => setTimeout(r, executorDelayMs))
      if (executorError) throw executorError
      return executorResult
    },
    ...overrides,
  })
}

function post(body: unknown, init: { origin?: string | null; method?: string } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.origin !== null) headers['Origin'] = init.origin ?? ORIGIN
  return new Request(`${ORIGIN}/internal/query`, {
    method: init.method ?? 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(async () => {
  ws = mkdtempSync(join(tmpdir(), 'craft-bridge-'))
  store = new GrantStore(ws)
  grantId = await store.approve({
    pageId: 'page-1',
    sourceSlug: 'gmail',
    toolName: 'list_messages',
    fixedArgs: { maxResults: 20 },
    paramSchema: { q: { type: 'string', maxLength: 50 } },
  })
  calls = []
  executorResult = { messages: [] }
  executorError = null
  executorDelayMs = 0
})

describe('happy path', () => {
  it('executes the granted tool with merged arguments', async () => {
    const res = await handler()(post({ grantId, params: { q: 'invoice' } }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      sourceSlug: 'gmail',
      toolName: 'list_messages',
      args: { q: 'invoice', maxResults: 20 },
    })
  })

  it('never caches a response', async () => {
    const res = await handler()(post({ grantId, params: {} }))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('origin and method', () => {
  it('rejects a foreign Origin', async () => {
    const res = await handler()(post({ grantId, params: {} }, { origin: 'https://evil.com' }))
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('rejects a missing Origin', async () => {
    const res = await handler()(post({ grantId, params: {} }, { origin: null }))
    expect(res.status).toBe(403)
  })

  it('rejects non-POST, including preflight', async () => {
    for (const method of ['GET', 'OPTIONS', 'PUT', 'DELETE']) {
      const res = await handler()(post({ grantId }, { method }))
      expect(res.status).toBe(405)
    }
  })

  it('emits no permissive CORS headers', async () => {
    const res = await handler()(post({ grantId, params: {} }))
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('authorization', () => {
  it('rejects an unknown grantId without calling the connector', async () => {
    const res = await handler()(post({ grantId: 'nope', params: {} }))
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('rejects params that violate the grant schema', async () => {
    const res = await handler()(post({ grantId, params: { q: 'x'.repeat(51) } }))
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('rejects a revoked grant', async () => {
    await store.revoke(grantId)
    const res = await handler()(post({ grantId, params: {} }))
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })
})

describe('request shape', () => {
  it('rejects malformed JSON', async () => {
    const res = await handler()(post('{not json', {}))
    expect(res.status).toBe(400)
  })

  it('rejects a body over the size cap BEFORE parsing it', async () => {
    const huge = JSON.stringify({ grantId, params: { q: 'x'.repeat(200_000) } })
    const res = await handler()(post(huge, {}))
    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('rejects a missing grantId', async () => {
    expect((await handler()(post({ params: {} }))).status).toBe(400)
  })
})

describe('error redaction — the sandbox must not become an information channel', () => {
  it('never returns upstream error text', async () => {
    executorError = new Error('401 Unauthorized: token abc123 for https://gmail.googleapis.com/v1')
    const res = await handler()(post({ grantId, params: {} }))
    const body = await res.text()
    expect(res.status).toBe(502)
    expect(body).not.toContain('abc123')
    expect(body).not.toContain('gmail.googleapis.com')
    expect(body).not.toContain('401')
    expect(body).toContain('upstream_error')
  })

  it('reports schema failures as an opaque code too', async () => {
    const body = await (await handler()(post({ grantId, params: { q: 123 } }))).text()
    // The page learns "invalid", not which internal rule tripped.
    expect(body).toContain('invalid_params')
    expect(body).not.toContain('maxLength')
  })
})

describe('limits', () => {
  it('times out a slow connector rather than hanging the page', async () => {
    executorDelayMs = 200
    const res = await handler({ timeoutMs: 40 })(post({ grantId, params: {} }))
    expect(res.status).toBe(504)
  })

  it('rate-limits per page', async () => {
    const h = handler({ maxRequestsPerMinute: 3 })
    const codes: number[] = []
    for (let i = 0; i < 5; i++) {
      codes.push((await h(post({ grantId, params: {} }))).status)
    }
    expect(codes.filter(c => c === 200)).toHaveLength(3)
    expect(codes.filter(c => c === 429)).toHaveLength(2)
  })

  it('rejects an oversized connector RESPONSE', async () => {
    // A read-only tool returning 50MB is still a denial-of-service on the
    // renderer, and possibly an exfiltration volume signal.
    executorResult = { blob: 'x'.repeat(3_000_000) }
    const res = await handler({ maxResponseBytes: 1_000 })(post({ grantId, params: {} }))
    expect(res.status).toBe(502)
  })
})
