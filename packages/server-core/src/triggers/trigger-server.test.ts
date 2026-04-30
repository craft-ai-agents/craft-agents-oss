import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  startTriggerHttpServer,
  type AutomationSystemResolver,
  type TriggerHttpServerHandle,
} from './trigger-server.ts'
import type { AutomationSystem, AutomationMatcher } from '@craft-agent/shared/automations'

/**
 * In-memory stub of the parts of AutomationSystem the trigger server uses.
 * Lets us assert exact arguments passed to fireWebhookReceive.
 */
function makeStubAutomationSystem(matcher: AutomationMatcher | undefined) {
  const fireCalls: Array<Parameters<AutomationSystem['fireWebhookReceive']>[0]> = []
  const stub = {
    findWebhookReceiveMatcher: (slug: string) => (matcher && matcher.slug === slug ? matcher : undefined),
    fireWebhookReceive: async (input: Parameters<AutomationSystem['fireWebhookReceive']>[0]) => {
      fireCalls.push(input)
    },
  } as unknown as AutomationSystem
  return { stub, fireCalls }
}

function makeResolver(systemsByWorkspaceId: Record<string, AutomationSystem>): AutomationSystemResolver {
  return {
    getAutomationSystemForWorkspaceId: (id) => systemsByWorkspaceId[id],
  }
}

/** Pick an ephemeral port — node:http picks one when port=0. We just start with 0
 *  and read the bound port from the URL. */
async function startWithResolver(resolver: AutomationSystemResolver): Promise<TriggerHttpServerHandle> {
  const handle = await startTriggerHttpServer({
    port: await pickPort(),
    host: '127.0.0.1',
    resolver,
    ratePerMin: 1000, // raise so most tests don't accidentally hit the limit
  })
  if (!handle) throw new Error('handle should not be null when port > 0')
  return handle
}

async function pickPort(): Promise<number> {
  // Bun's net is convenient; falls back to a hard-coded high port if not available.
  const { createServer } = await import('node:net')
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(0, () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 9999
      s.close(() => resolve(port))
    })
  })
}

describe('trigger HTTP server', () => {
  let handle: TriggerHttpServerHandle | null = null

  beforeEach(() => {
    handle = null
  })

  afterEach(async () => {
    if (handle) await handle.stop()
    handle = null
  })

  test('returns null when port=0 (opt-out)', async () => {
    const result = await startTriggerHttpServer({
      port: 0,
      resolver: makeResolver({}),
    })
    expect(result).toBeNull()
  })

  test('GET /v1/health → 200 ok', async () => {
    handle = await startWithResolver(makeResolver({}))
    const res = await fetch(`${handle.url}/v1/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  test('unknown path → 404', async () => {
    handle = await startWithResolver(makeResolver({}))
    const res = await fetch(`${handle.url}/some/random/path`)
    expect(res.status).toBe(404)
  })

  test('unknown workspace → 404', async () => {
    handle = await startWithResolver(makeResolver({}))
    const res = await fetch(`${handle.url}/v1/triggers/missing/whatever`, { method: 'POST' })
    expect(res.status).toBe(404)
    expect((await res.json() as { error: string }).error).toBe('workspace_not_found')
  })

  test('unknown slug → 404', async () => {
    const { stub } = makeStubAutomationSystem(undefined)
    handle = await startWithResolver(makeResolver({ ws1: stub }))
    const res = await fetch(`${handle.url}/v1/triggers/ws1/missing`, { method: 'POST' })
    expect(res.status).toBe(404)
    expect((await res.json() as { error: string }).error).toBe('trigger_not_found')
  })

  test('fires WebhookReceive with parsed JSON body and headers', async () => {
    const matcher: AutomationMatcher = {
      slug: 'stripe-events',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const res = await fetch(`${handle.url}/v1/triggers/ws1/stripe-events?source=stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-custom': 'hi' },
      body: JSON.stringify({ event: 'invoice.paid', amount: 4200 }),
    })

    expect(res.status).toBe(200)
    expect(fireCalls).toHaveLength(1)
    const call = fireCalls[0]!
    expect(call.slug).toBe('stripe-events')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ event: 'invoice.paid', amount: 4200 })
    expect(call.bodyRaw).toContain('invoice.paid')
    expect(call.headers['x-custom']).toBe('hi')
    expect(call.query.source).toBe('stripe')
  })

  test('non-JSON body remains as bodyRaw with body=null', async () => {
    const matcher: AutomationMatcher = {
      slug: 'plain',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    await fetch(`${handle.url}/v1/triggers/ws1/plain`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    })
    expect(fireCalls[0]?.body).toBeNull()
    expect(fireCalls[0]?.bodyRaw).toBe('hello')
  })

  test('method allow-list rejects with 405 + Allow header', async () => {
    const matcher: AutomationMatcher = {
      slug: 'only-post',
      allowedMethods: ['POST'],
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const res = await fetch(`${handle.url}/v1/triggers/ws1/only-post`, { method: 'GET' })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })

  test('HMAC verification — accepts valid signature', async () => {
    const SECRET_ENV = 'CRAFT_WH_TEST_SECRET'
    const SECRET = 'super-secret-shared-key'
    process.env[SECRET_ENV] = SECRET

    const matcher: AutomationMatcher = {
      slug: 'signed',
      secretEnv: SECRET_ENV,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const body = JSON.stringify({ hello: 'world' })
    const sig = 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')

    const res = await fetch(`${handle.url}/v1/triggers/ws1/signed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-craft-signature': sig },
      body,
    })

    expect(res.status).toBe(200)
    expect(fireCalls).toHaveLength(1)

    delete process.env[SECRET_ENV]
  })

  test('HMAC verification — rejects bad signature with 401', async () => {
    const SECRET_ENV = 'CRAFT_WH_TEST_SECRET2'
    process.env[SECRET_ENV] = 'expected-secret'

    const matcher: AutomationMatcher = {
      slug: 'signed2',
      secretEnv: SECRET_ENV,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const res = await fetch(`${handle.url}/v1/triggers/ws1/signed2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-craft-signature': 'sha256=abcd' },
      body: '{"a":1}',
    })

    expect(res.status).toBe(401)
    expect(fireCalls).toHaveLength(0)

    delete process.env[SECRET_ENV]
  })

  test('HMAC verification — fails closed when env var is unset', async () => {
    const matcher: AutomationMatcher = {
      slug: 'unset',
      secretEnv: 'CRAFT_WH_DEFINITELY_NOT_SET_XYZ',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const res = await fetch(`${handle.url}/v1/triggers/ws1/unset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    // 500 (misconfigured), NOT 200 — must never silently downgrade to unauth
    expect(res.status).toBe(500)
    expect(fireCalls).toHaveLength(0)
  })

  test('rate limit returns 429 once exceeded', async () => {
    const matcher: AutomationMatcher = {
      slug: 'rated',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub } = makeStubAutomationSystem(matcher)
    handle = await startTriggerHttpServer({
      port: await pickPort(),
      host: '127.0.0.1',
      resolver: makeResolver({ ws1: stub }),
      ratePerMin: 2, // tight bucket so we trip it deterministically
    })

    if (!handle) throw new Error('handle should not be null')

    const r1 = await fetch(`${handle.url}/v1/triggers/ws1/rated`, { method: 'POST' })
    const r2 = await fetch(`${handle.url}/v1/triggers/ws1/rated`, { method: 'POST' })
    const r3 = await fetch(`${handle.url}/v1/triggers/ws1/rated`, { method: 'POST' })

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r3.status).toBe(429)
  })

  test('body too large returns 413', async () => {
    const matcher: AutomationMatcher = {
      slug: 'small',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startTriggerHttpServer({
      port: await pickPort(),
      host: '127.0.0.1',
      resolver: makeResolver({ ws1: stub }),
      bodyMaxBytes: 32,
    })
    if (!handle) throw new Error('handle should not be null')

    const big = 'x'.repeat(100)
    const res = await fetch(`${handle.url}/v1/triggers/ws1/small`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: big,
    })

    expect(res.status).toBe(413)
    expect(fireCalls).toHaveLength(0)
  })
})
