import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  startTriggerHttpServer,
  type AutomationSystemResolver,
  type TriggerHttpServerHandle,
} from './trigger-server.ts'
import type { AutomationSystem, AutomationMatcher } from '@craft-agent/shared/automations'
import type { WebhookDeliveryRecord } from '@craft-agent/shared/automations'

/**
 * In-memory stub of the parts of AutomationSystem the trigger server uses.
 * Lets us assert exact arguments passed to fireWebhookReceive.
 */
function makeStubAutomationSystem(matcher: AutomationMatcher | undefined, workspaceRootPath = '/tmp/test-workspace') {
  const fireCalls: Array<Parameters<AutomationSystem['fireWebhookReceive']>[0]> = []
  const stub = {
    findWebhookReceiveMatcher: (slug: string) => (matcher && matcher.slug === slug ? matcher : undefined),
    getWorkspaceRootPath: () => workspaceRootPath,
    fireWebhookReceive: async (input: Parameters<AutomationSystem['fireWebhookReceive']>[0]) => {
      fireCalls.push(input)
      return { status: 'accepted' as const, handlerCount: 1, anyHandlerCount: 0 }
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
async function startWithResolver(
  resolver: AutomationSystemResolver,
  options: Partial<Parameters<typeof startTriggerHttpServer>[0]> = {},
): Promise<TriggerHttpServerHandle> {
  const handle = await startTriggerHttpServer({
    port: await pickPort(),
    host: '127.0.0.1',
    resolver,
    ratePerMin: 1000, // raise so most tests don't accidentally hit the limit
    ...options,
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

function signBody(secret: string, timestamp: string, body: string): string {
  return (
    'sha256=' +
    createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex')
  )
}

function makeDeliveryRecorder() {
  const records: WebhookDeliveryRecord[] = []
  return {
    records,
    recorder: async (_workspaceRootPath: string, record: WebhookDeliveryRecord) => {
      records.push(record)
    },
  }
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
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const res = await fetch(`${handle.url}/v1/triggers/ws1/stripe-events?source=stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-custom': 'hi' },
      body: JSON.stringify({ event: 'invoice.paid', amount: 4200 }),
    })

    expect(res.status).toBe(202)
    expect(fireCalls).toHaveLength(1)
    const call = fireCalls[0]!
    expect(call.slug).toBe('stripe-events')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ event: 'invoice.paid', amount: 4200 })
    expect(call.bodyRaw).toContain('invoice.paid')
    expect(call.headers['x-custom']).toBe('hi')
    expect(call.query.source).toBe('stripe')
  })

  test('records accepted deliveries without request body or headers', async () => {
    const matcher: AutomationMatcher = {
      id: 'matcher-accepted',
      slug: 'recorded',
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub } = makeStubAutomationSystem(matcher, '/tmp/ws-recorded')
    const { records, recorder } = makeDeliveryRecorder()
    handle = await startWithResolver(makeResolver({ ws1: stub }), { deliveryRecorder: recorder })

    const res = await fetch(`${handle.url}/v1/triggers/ws1/recorded`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ sensitive: 'do-not-store' }),
    })

    expect(res.status).toBe(202)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      workspaceId: 'ws1',
      slug: 'recorded',
      matcherId: 'matcher-accepted',
      method: 'POST',
      outcome: 'accepted',
      httpStatus: 202,
      reason: 'accepted',
    })
    expect(JSON.stringify(records[0])).not.toContain('do-not-store')
    expect(JSON.stringify(records[0])).not.toContain('Bearer secret')
  })

  test('non-JSON body remains as bodyRaw with body=null', async () => {
    const matcher: AutomationMatcher = {
      slug: 'plain',
      allowUnauthenticated: true,
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

  test('unsigned WebhookReceive is denied unless matcher opts in', async () => {
    const matcher: AutomationMatcher = {
      slug: 'signed-by-default',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const res = await fetch(`${handle.url}/v1/triggers/ws1/signed-by-default`, {
      method: 'POST',
      body: '{}',
    })

    expect(res.status).toBe(401)
    expect((await res.json() as { error: string }).error).toBe('authentication_required')
    expect(fireCalls).toHaveLength(0)
  })

  test('method allow-list rejects with 405 + Allow header', async () => {
    const matcher: AutomationMatcher = {
      slug: 'only-post',
      allowUnauthenticated: true,
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
    const timestamp = String(Math.floor(Date.now() / 1000))
    const sig = signBody(SECRET, timestamp, body)

    const res = await fetch(`${handle.url}/v1/triggers/ws1/signed`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-craft-timestamp': timestamp,
        'x-craft-signature': sig,
      },
      body,
    })

    expect(res.status).toBe(202)
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
      headers: {
        'content-type': 'application/json',
        'x-craft-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-craft-signature': 'sha256=abcd',
      },
      body: '{"a":1}',
    })

    expect(res.status).toBe(401)
    expect(fireCalls).toHaveLength(0)

    delete process.env[SECRET_ENV]
  })

  test('records invalid signatures', async () => {
    const SECRET_ENV = 'CRAFT_WH_TEST_SECRET_RECORD_BAD_SIG'
    process.env[SECRET_ENV] = 'expected-secret'

    const matcher: AutomationMatcher = {
      id: 'matcher-bad-sig',
      slug: 'signed-recorded',
      secretEnv: SECRET_ENV,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    const { records, recorder } = makeDeliveryRecorder()
    handle = await startWithResolver(makeResolver({ ws1: stub }), { deliveryRecorder: recorder })

    const res = await fetch(`${handle.url}/v1/triggers/ws1/signed-recorded`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-craft-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-craft-signature': 'sha256=abcd',
      },
      body: '{"a":1}',
    })

    expect(res.status).toBe(401)
    expect(fireCalls).toHaveLength(0)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      workspaceId: 'ws1',
      slug: 'signed-recorded',
      matcherId: 'matcher-bad-sig',
      method: 'POST',
      outcome: 'invalid_signature',
      httpStatus: 401,
      reason: 'invalid_signature',
    })

    delete process.env[SECRET_ENV]
  })

  test('HMAC verification — rejects missing timestamp with 401', async () => {
    const SECRET_ENV = 'CRAFT_WH_TEST_SECRET_MISSING_TS'
    const SECRET = 'expected-secret'
    process.env[SECRET_ENV] = SECRET

    const matcher: AutomationMatcher = {
      slug: 'missing-ts',
      secretEnv: SECRET_ENV,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const body = '{"a":1}'
    const res = await fetch(`${handle.url}/v1/triggers/ws1/missing-ts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-craft-signature': signBody(SECRET, '', body) },
      body,
    })

    expect(res.status).toBe(401)
    expect((await res.json() as { error: string }).error).toBe('missing_timestamp')
    expect(fireCalls).toHaveLength(0)

    delete process.env[SECRET_ENV]
  })

  test('HMAC verification — rejects stale timestamp with 401', async () => {
    const SECRET_ENV = 'CRAFT_WH_TEST_SECRET_STALE_TS'
    const SECRET = 'expected-secret'
    process.env[SECRET_ENV] = SECRET

    const matcher: AutomationMatcher = {
      slug: 'stale-ts',
      secretEnv: SECRET_ENV,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const body = '{"a":1}'
    const timestamp = String(Math.floor((Date.now() - 10 * 60_000) / 1000))
    const res = await fetch(`${handle.url}/v1/triggers/ws1/stale-ts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-craft-timestamp': timestamp,
        'x-craft-signature': signBody(SECRET, timestamp, body),
      },
      body,
    })

    expect(res.status).toBe(401)
    expect((await res.json() as { error: string }).error).toBe('stale_timestamp')
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
      allowUnauthenticated: true,
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

    expect(r1.status).toBe(202)
    expect(r2.status).toBe(202)
    expect(r3.status).toBe(429)
  })

  test('records trigger-server rate-limited deliveries', async () => {
    const matcher: AutomationMatcher = {
      id: 'matcher-rate',
      slug: 'record-rate',
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub } = makeStubAutomationSystem(matcher)
    const { records, recorder } = makeDeliveryRecorder()
    handle = await startTriggerHttpServer({
      port: await pickPort(),
      host: '127.0.0.1',
      resolver: makeResolver({ ws1: stub }),
      ratePerMin: 1,
      deliveryRecorder: recorder,
    })

    if (!handle) throw new Error('handle should not be null')

    const r1 = await fetch(`${handle.url}/v1/triggers/ws1/record-rate`, { method: 'POST' })
    const r2 = await fetch(`${handle.url}/v1/triggers/ws1/record-rate`, { method: 'POST' })

    expect(r1.status).toBe(202)
    expect(r2.status).toBe(429)
    expect(records.map((record) => record.outcome)).toEqual(['accepted', 'rate_limited'])
    expect(records[1]).toMatchObject({
      workspaceId: 'ws1',
      slug: 'record-rate',
      matcherId: 'matcher-rate',
      method: 'POST',
      httpStatus: 429,
      reason: 'rate_limited',
    })
  })

  test('bad HMAC does not consume the trigger rate bucket', async () => {
    const SECRET_ENV = 'CRAFT_WH_TEST_SECRET_RATE_ORDER'
    const SECRET = 'expected-secret'
    process.env[SECRET_ENV] = SECRET

    const matcher: AutomationMatcher = {
      slug: 'signed-rate',
      secretEnv: SECRET_ENV,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startTriggerHttpServer({
      port: await pickPort(),
      host: '127.0.0.1',
      resolver: makeResolver({ ws1: stub }),
      ratePerMin: 1,
    })
    if (!handle) throw new Error('handle should not be null')

    const body = '{}'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const bad = await fetch(`${handle.url}/v1/triggers/ws1/signed-rate`, {
      method: 'POST',
      headers: {
        'x-craft-timestamp': timestamp,
        'x-craft-signature': 'sha256=abcd',
      },
      body,
    })
    const good = await fetch(`${handle.url}/v1/triggers/ws1/signed-rate`, {
      method: 'POST',
      headers: {
        'x-craft-timestamp': timestamp,
        'x-craft-signature': signBody(SECRET, timestamp, body),
      },
      body,
    })

    expect(bad.status).toBe(401)
    expect(good.status).toBe(202)
    expect(fireCalls).toHaveLength(1)

    delete process.env[SECRET_ENV]
  })

  test('event bus rate limit result returns 429 instead of silent success', async () => {
    const matcher: AutomationMatcher = {
      slug: 'bus-limited',
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const stub = {
      findWebhookReceiveMatcher: (slug: string) => (slug === matcher.slug ? matcher : undefined),
      fireWebhookReceive: async () => ({ status: 'rate_limited' as const, limit: 10, count: 10, windowStart: Date.now() }),
    } as unknown as AutomationSystem
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    const res = await fetch(`${handle.url}/v1/triggers/ws1/bus-limited`, { method: 'POST' })
    expect(res.status).toBe(429)
    expect((await res.json() as { error: string }).error).toBe('event_bus_rate_limited')
  })

  test('ignores X-Forwarded-For unless the socket IP is trusted', async () => {
    const matcher: AutomationMatcher = {
      slug: 'xff',
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }))

    await fetch(`${handle.url}/v1/triggers/ws1/xff`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })

    expect(fireCalls[0]?.remoteIp).not.toBe('203.0.113.10')
  })

  test('uses X-Forwarded-For when the socket IP is explicitly trusted', async () => {
    const matcher: AutomationMatcher = {
      slug: 'trusted-xff',
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startWithResolver(makeResolver({ ws1: stub }), {
      trustedProxyIps: ['127.0.0.1', '::ffff:127.0.0.1'],
    })

    await fetch(`${handle.url}/v1/triggers/ws1/trusted-xff`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.2' },
    })

    expect(fireCalls[0]?.remoteIp).toBe('203.0.113.10')
  })

  test('body too large returns 413', async () => {
    const matcher: AutomationMatcher = {
      slug: 'small',
      allowUnauthenticated: true,
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

  test('records body-too-large deliveries', async () => {
    const matcher: AutomationMatcher = {
      id: 'matcher-body-large',
      slug: 'record-large',
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    const { records, recorder } = makeDeliveryRecorder()
    handle = await startTriggerHttpServer({
      port: await pickPort(),
      host: '127.0.0.1',
      resolver: makeResolver({ ws1: stub }),
      bodyMaxBytes: 8,
      deliveryRecorder: recorder,
    })
    if (!handle) throw new Error('handle should not be null')

    const res = await fetch(`${handle.url}/v1/triggers/ws1/record-large`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x'.repeat(100),
    })

    expect(res.status).toBe(413)
    expect(fireCalls).toHaveLength(0)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      workspaceId: 'ws1',
      slug: 'record-large',
      matcherId: 'matcher-body-large',
      method: 'POST',
      outcome: 'body_too_large',
      httpStatus: 413,
      reason: 'body_too_large',
    })
  })

  test('body read timeout returns 408', async () => {
    const matcher: AutomationMatcher = {
      slug: 'slow',
      allowUnauthenticated: true,
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const { stub, fireCalls } = makeStubAutomationSystem(matcher)
    handle = await startTriggerHttpServer({
      port: await pickPort(),
      host: '127.0.0.1',
      resolver: makeResolver({ ws1: stub }),
      bodyReadTimeoutMs: 10,
    })
    if (!handle) throw new Error('handle should not be null')

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
      },
    })

    const res = await fetch(`${handle.url}/v1/triggers/ws1/slow`, {
      method: 'POST',
      body,
      // Required by Node's fetch implementation for streaming request bodies.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    expect(res.status).toBe(408)
    expect(fireCalls).toHaveLength(0)
  })
})
