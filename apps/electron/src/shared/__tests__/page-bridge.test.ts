/**
 * Page bridge validation: strict parsing of untrusted iframe messages,
 * URL gating, mutating-invocation classification, and the per-frame
 * rate limiter.
 */

import { describe, test, expect } from 'bun:test'
import {
  PAGE_BRIDGE_PROTOCOL,
  PageActionRateLimiter,
  buildPageActionResultMessage,
  buildPageDataMessage,
  buildPageGrantsMessage,
  buildPageInitMessage,
  descriptorEquals,
  grantIdsEqual,
  isMutatingInvocation,
  isSafeExternalUrl,
  parsePageBridgeMessage,
  reconcileGrantSummaries,
  type PageGrantSummary,
} from '../page-bridge'

const validAction = {
  protocol: PAGE_BRIDGE_PROTOCOL,
  type: 'action',
  requestId: 'req-1',
  nonce: 'a'.repeat(32),
  grantId: 'grant_1',
  invocation: { kind: 'api', method: 'GET', path: '/gmail/v1/users/me/messages' },
}

describe('parsePageBridgeMessage', () => {
  test('accepts a well-formed api action', () => {
    const msg = parsePageBridgeMessage(validAction)
    expect(msg).toEqual({
      type: 'action',
      requestId: 'req-1',
      nonce: 'a'.repeat(32),
      grantId: 'grant_1',
      invocation: { kind: 'api', method: 'GET', path: '/gmail/v1/users/me/messages' },
    })
  })

  test('accepts a bare script action trigger', () => {
    const msg = parsePageBridgeMessage({
      protocol: PAGE_BRIDGE_PROTOCOL,
      type: 'action',
      requestId: 'r',
      nonce: 'n',
      grantId: 'g',
      // A page cannot smuggle script/args here — the parser strips to a bare trigger.
      invocation: { kind: 'script', script: 'pages/evil/pwn.sh', args: ['--sudo'] },
    })
    expect(msg?.type).toBe('action')
    if (msg?.type === 'action') {
      expect(msg.invocation).toEqual({ kind: 'script' })
    }
  })

  test('accepts a well-formed mcp action with args', () => {
    const msg = parsePageBridgeMessage({
      protocol: PAGE_BRIDGE_PROTOCOL,
      type: 'action',
      requestId: 'r',
      nonce: 'n',
      grantId: 'g',
      invocation: { kind: 'mcp', toolName: 'list_issues', args: { limit: 5 } },
    })
    expect(msg?.type).toBe('action')
    if (msg?.type === 'action') {
      expect(msg.invocation).toEqual({ kind: 'mcp', toolName: 'list_issues', args: { limit: 5 } })
    }
  })

  test('accepts ready / action-cancel / open-url', () => {
    expect(parsePageBridgeMessage({ protocol: PAGE_BRIDGE_PROTOCOL, type: 'ready' })).toEqual({ type: 'ready' })
    expect(
      parsePageBridgeMessage({ protocol: PAGE_BRIDGE_PROTOCOL, type: 'action-cancel', requestId: 'r', nonce: 'n' }),
    ).toEqual({ type: 'action-cancel', requestId: 'r', nonce: 'n' })
    expect(
      parsePageBridgeMessage({ protocol: PAGE_BRIDGE_PROTOCOL, type: 'open-url', nonce: 'n', url: 'https://example.com' }),
    ).toEqual({ type: 'open-url', nonce: 'n', url: 'https://example.com' })
  })

  test('rejects wrong/missing protocol and unknown types', () => {
    expect(parsePageBridgeMessage(null)).toBeNull()
    expect(parsePageBridgeMessage('hi')).toBeNull()
    expect(parsePageBridgeMessage({ type: 'ready' })).toBeNull()
    expect(parsePageBridgeMessage({ protocol: 'craft-pages/v0', type: 'ready' })).toBeNull()
    expect(parsePageBridgeMessage({ protocol: PAGE_BRIDGE_PROTOCOL, type: 'eval' })).toBeNull()
  })

  test('rejects malformed actions', () => {
    expect(parsePageBridgeMessage({ ...validAction, requestId: '' })).toBeNull()
    expect(parsePageBridgeMessage({ ...validAction, nonce: 42 })).toBeNull()
    expect(parsePageBridgeMessage({ ...validAction, invocation: { kind: 'api', method: 'TRACE', path: '/x' } })).toBeNull()
    expect(parsePageBridgeMessage({ ...validAction, invocation: { kind: 'api', method: 'GET', path: '' } })).toBeNull()
    expect(parsePageBridgeMessage({ ...validAction, invocation: { kind: 'mcp' } })).toBeNull()
    expect(parsePageBridgeMessage({ ...validAction, invocation: { kind: 'api', method: 'GET', path: '/x', params: [] } })).toBeNull()
  })

  test('rejects oversized and cyclic payloads', () => {
    expect(
      parsePageBridgeMessage({
        ...validAction,
        invocation: { kind: 'api', method: 'GET', path: '/x', params: { blob: 'x'.repeat(300 * 1024) } },
      }),
    ).toBeNull()

    const cyclic: Record<string, unknown> = { protocol: PAGE_BRIDGE_PROTOCOL, type: 'ready' }
    cyclic.self = cyclic
    expect(parsePageBridgeMessage(cyclic)).toBeNull()
  })

  test('rejects pathologically deep params', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 20; i++) deep = { nested: deep }
    expect(
      parsePageBridgeMessage({
        ...validAction,
        invocation: { kind: 'api', method: 'GET', path: '/x', params: deep },
      }),
    ).toBeNull()
  })
})

describe('parsePageBridgeMessage: grant-request', () => {
  const mcpEntry = {
    key: 'read',
    description: 'Refresh the task list',
    action: { kind: 'mcp', sourceSlug: 'craft-private', toolName: 'craft_read' },
  }
  const apiEntry = {
    key: 'weather',
    action: { kind: 'api', sourceSlug: 'openweather', method: 'GET', pathPattern: '/data/2\\.5/weather.*' },
  }
  const valid = { protocol: PAGE_BRIDGE_PROTOCOL, type: 'grant-request', nonce: 'n', requests: [mcpEntry, apiEntry] }

  test('accepts well-formed mcp and api entries', () => {
    expect(parsePageBridgeMessage(valid)).toEqual({
      type: 'grant-request',
      nonce: 'n',
      requests: [
        { key: 'read', description: 'Refresh the task list', action: { kind: 'mcp', sourceSlug: 'craft-private', toolName: 'craft_read' } },
        { key: 'weather', action: { kind: 'api', sourceSlug: 'openweather', method: 'GET', pathPattern: '/data/2\\.5/weather.*' } },
      ],
    })
  })

  test('rejects missing nonce, empty/oversized request lists, duplicate keys', () => {
    expect(parsePageBridgeMessage({ ...valid, nonce: undefined })).toBeNull()
    expect(parsePageBridgeMessage({ ...valid, requests: [] })).toBeNull()
    expect(parsePageBridgeMessage({ ...valid, requests: 'nope' })).toBeNull()
    expect(parsePageBridgeMessage({ ...valid, requests: Array.from({ length: 9 }, (_, i) => ({ ...mcpEntry, key: `k${i}` })) })).toBeNull()
    expect(parsePageBridgeMessage({ ...valid, requests: [mcpEntry, mcpEntry] })).toBeNull()
  })

  test('rejects malformed descriptors', () => {
    const withAction = (action: unknown) => ({ ...valid, requests: [{ key: 'k', action }] })
    expect(parsePageBridgeMessage(withAction({ kind: 'mcp', toolName: 'craft_read' }))).toBeNull() // no sourceSlug
    expect(parsePageBridgeMessage(withAction({ kind: 'mcp', sourceSlug: 's' }))).toBeNull() // no toolName
    expect(parsePageBridgeMessage(withAction({ kind: 'api', sourceSlug: 's', method: 'FETCH', pathPattern: '/x' }))).toBeNull()
    expect(parsePageBridgeMessage(withAction({ kind: 'api', sourceSlug: 's', method: 'GET' }))).toBeNull() // no pathPattern
    expect(parsePageBridgeMessage(withAction({ kind: 'exec', sourceSlug: 's', command: 'rm -rf /' }))).toBeNull()
    expect(parsePageBridgeMessage(withAction(null))).toBeNull()
  })

  test('accepts a well-formed script descriptor', () => {
    const withAction = (action: unknown) => ({ ...valid, requests: [{ key: 'k', action }] })
    const parsed = parsePageBridgeMessage(
      withAction({ kind: 'script', script: 'pages/p/run.sh', runtime: 'bun', args: ['--once'] }),
    )
    expect(parsed).toEqual({
      type: 'grant-request',
      nonce: 'n',
      requests: [{ key: 'k', action: { kind: 'script', script: 'pages/p/run.sh', runtime: 'bun', args: ['--once'] } }],
    })
    // runtime + args are optional
    expect(parsePageBridgeMessage(withAction({ kind: 'script', script: 'pages/p/run.ts' }))).not.toBeNull()
  })

  test('rejects unsafe or malformed script descriptors', () => {
    const withAction = (action: unknown) => ({ ...valid, requests: [{ key: 'k', action }] })
    expect(parsePageBridgeMessage(withAction({ kind: 'script' }))).toBeNull() // no script path
    expect(parsePageBridgeMessage(withAction({ kind: 'script', script: '/etc/passwd' }))).toBeNull() // absolute
    expect(parsePageBridgeMessage(withAction({ kind: 'script', script: '../escape.sh' }))).toBeNull() // .. escape
    expect(parsePageBridgeMessage(withAction({ kind: 'script', script: 'a/../../b.sh' }))).toBeNull() // .. mid-path
    expect(parsePageBridgeMessage(withAction({ kind: 'script', script: 'ok.sh', runtime: 'ruby' }))).toBeNull() // bad runtime
    expect(parsePageBridgeMessage(withAction({ kind: 'script', script: 'ok.sh', args: 'nope' }))).toBeNull() // args not array
    expect(parsePageBridgeMessage(withAction({ kind: 'script', script: 'ok.sh', args: [1, 2] }))).toBeNull() // non-string args
    expect(
      parsePageBridgeMessage(withAction({ kind: 'script', script: 'ok.sh', args: Array.from({ length: 33 }, () => 'x') })),
    ).toBeNull() // too many args
  })

  test('rejects oversized descriptions', () => {
    expect(
      parsePageBridgeMessage({ ...valid, requests: [{ ...mcpEntry, description: 'x'.repeat(501) }] }),
    ).toBeNull()
  })
})

describe('descriptorEquals', () => {
  test('matches on all fields per kind, never across kinds', () => {
    const mcp = { kind: 'mcp' as const, sourceSlug: 's', toolName: 't' }
    expect(descriptorEquals(mcp, { ...mcp })).toBe(true)
    expect(descriptorEquals(mcp, { ...mcp, toolName: 'other' })).toBe(false)
    expect(descriptorEquals(mcp, { ...mcp, sourceSlug: 'other' })).toBe(false)
    const api = { kind: 'api' as const, sourceSlug: 's', method: 'GET' as const, pathPattern: '/x' }
    expect(descriptorEquals(api, { ...api })).toBe(true)
    expect(descriptorEquals(api, { ...api, method: 'POST' })).toBe(false)
    expect(descriptorEquals(api, { ...api, pathPattern: '/y' })).toBe(false)
    expect(descriptorEquals(mcp, api)).toBe(false)
  })

  test('script matches on path, runtime (bun default), and ordered args', () => {
    const script = { kind: 'script' as const, script: 'pages/p/run.sh', runtime: 'bun' as const, args: ['a', 'b'] }
    expect(descriptorEquals(script, { ...script })).toBe(true)
    // omitted runtime defaults to bun
    expect(descriptorEquals({ kind: 'script', script: 'pages/p/run.sh', args: ['a', 'b'] }, script)).toBe(true)
    expect(descriptorEquals(script, { ...script, script: 'pages/p/other.sh' })).toBe(false)
    expect(descriptorEquals(script, { ...script, runtime: 'node' })).toBe(false)
    expect(descriptorEquals(script, { ...script, args: ['b', 'a'] })).toBe(false)
    expect(descriptorEquals(script, { ...script, args: ['a'] })).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  test('allows only http(s)', () => {
    expect(isSafeExternalUrl('https://example.com/a?b=c')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('craftagents://action/new-chat')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})

describe('isMutatingInvocation', () => {
  test('api GET is the only activation-exempt invocation', () => {
    expect(isMutatingInvocation({ kind: 'api', method: 'POST', path: '/x' })).toBe(true)
    expect(isMutatingInvocation({ kind: 'api', method: 'DELETE', path: '/x' })).toBe(true)
    expect(isMutatingInvocation({ kind: 'api', method: 'GET', path: '/x' })).toBe(false)
  })

  test('mcp always mutates (opaque tools — no method to infer read vs write)', () => {
    // A granted MCP tool may write ("create issue"); without user activation a
    // page could fire it from setInterval or on load. Never exempt it.
    expect(isMutatingInvocation({ kind: 'mcp', toolName: 't' })).toBe(true)
    expect(isMutatingInvocation({ kind: 'mcp', toolName: 'list_issues' })).toBe(true)
  })

  test('script always mutates (host command execution needs a fresh gesture)', () => {
    expect(isMutatingInvocation({ kind: 'script' })).toBe(true)
  })
})

describe('outgoing message builders', () => {
  test('stamp the protocol and wrap payloads', () => {
    const snapshot = { version: 1 as const, generatedAt: 1, kv: {}, series: {} }
    expect(buildPageInitMessage({ slug: 's', kind: 'live' }, 'nonce', snapshot)).toEqual({
      protocol: PAGE_BRIDGE_PROTOCOL,
      type: 'init',
      payload: { page: { slug: 's', kind: 'live' }, nonce: 'nonce', snapshot, grants: [] },
    })
    expect(buildPageDataMessage(null)).toEqual({
      protocol: PAGE_BRIDGE_PROTOCOL,
      type: 'data',
      payload: { snapshot: null },
    })
    const result = { requestId: 'r', ok: true, durationMs: 5 }
    expect(buildPageActionResultMessage(result)).toEqual({
      protocol: PAGE_BRIDGE_PROTOCOL,
      type: 'action-result',
      payload: { result },
    })
  })

  test('init and grants messages carry grant summaries', () => {
    const grants = [
      { id: 'grant_1', action: { kind: 'mcp' as const, sourceSlug: 's', toolName: 't' }, expiresAt: 99 },
    ]
    const init = buildPageInitMessage({ slug: 's', kind: 'live' }, 'n', null, grants)
    expect((init.payload as { grants: unknown }).grants).toEqual(grants)
    expect(buildPageGrantsMessage(grants)).toEqual({
      protocol: PAGE_BRIDGE_PROTOCOL,
      type: 'grants',
      payload: { grants },
    })
  })
})

describe('PageActionRateLimiter', () => {
  test('caps concurrent requests', () => {
    const limiter = new PageActionRateLimiter(2, 1, 100)
    expect(limiter.canStart(0, false)).toBeNull()
    limiter.start('a', 0, false)
    limiter.start('b', 0, false)
    expect(limiter.canStart(0, false)).toBe('in-flight-limit')
    limiter.finish('a')
    expect(limiter.canStart(0, false)).toBeNull()
  })

  test('caps mutating requests to one in flight', () => {
    const limiter = new PageActionRateLimiter(5, 1, 100)
    limiter.start('m1', 0, true)
    expect(limiter.canStart(0, true)).toBe('in-flight-limit')
    expect(limiter.canStart(0, false)).toBeNull()
    limiter.finish('m1')
    expect(limiter.canStart(0, true)).toBeNull()
  })

  test('enforces a sliding one-minute window', () => {
    const limiter = new PageActionRateLimiter(100, 100, 3)
    for (let i = 0; i < 3; i++) {
      expect(limiter.canStart(i, false)).toBeNull()
      limiter.start(`r${i}`, i, false)
      limiter.finish(`r${i}`)
    }
    expect(limiter.canStart(10, false)).toBe('rate-limit')
    // Window slides: the earliest start falls out after 60s
    expect(limiter.canStart(60_001, false)).toBeNull()
  })

  test('exposes in-flight ids for unmount cancellation', () => {
    const limiter = new PageActionRateLimiter()
    limiter.start('a', 0, false)
    limiter.start('b', 0, true)
    expect(limiter.inFlightIds.sort()).toEqual(['a', 'b'])
  })
})

describe('reconcileGrantSummaries', () => {
  const summary = (id: string): PageGrantSummary => ({
    id,
    action: { kind: 'mcp', sourceSlug: 'slack', toolName: `tool_${id}` },
    expiresAt: 9999,
  })

  test('config additions appear, revocations disappear', () => {
    const current = [summary('g1'), summary('g2')]
    // g2 revoked, g3 issued elsewhere
    const next = reconcileGrantSummaries(current, [summary('g1'), summary('g3')], new Set())
    expect(next.map(g => g.id).sort()).toEqual(['g1', 'g3'])
  })

  test('an in-render approval survives until the config confirms it', () => {
    const issued = new Set(['g2'])
    const current = [summary('g1'), summary('g2')]

    // Watcher lag: config doesn't know g2 yet — keep it.
    const lagged = reconcileGrantSummaries(current, [summary('g1')], issued)
    expect(lagged.map(g => g.id).sort()).toEqual(['g1', 'g2'])
    expect(issued.has('g2')).toBe(true)

    // Config catches up: g2 confirmed, local tracking released.
    const confirmed = reconcileGrantSummaries(lagged, [summary('g1'), summary('g2')], issued)
    expect(confirmed.map(g => g.id).sort()).toEqual(['g1', 'g2'])
    expect(issued.has('g2')).toBe(false)

    // A later revoke of g2 now propagates like any other removal.
    const revoked = reconcileGrantSummaries(confirmed, [summary('g1')], issued)
    expect(revoked.map(g => g.id)).toEqual(['g1'])
  })

  test('grantIdsEqual is order-insensitive set equality', () => {
    expect(grantIdsEqual([summary('a'), summary('b')], [summary('b'), summary('a')])).toBe(true)
    expect(grantIdsEqual([summary('a')], [summary('a'), summary('b')])).toBe(false)
    expect(grantIdsEqual([summary('a')], [summary('b')])).toBe(false)
    expect(grantIdsEqual([], [])).toBe(true)
  })
})
