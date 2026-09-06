/**
 * Pages MCP executor: source resolution, usability gating, api-vs-mcp grant
 * mismatch, error propagation, and result capping. The pool and source
 * loading are injected fakes — connection behavior itself is covered by the
 * shared mcp-pool tests.
 */

import { describe, test, expect } from 'bun:test'
import { createPagesMcpExecutor, MCP_ACTION_BODY_MAX_CHARS } from '../mcp-executor'
import type { McpClientPool, McpToolResult } from '@craft-agent/shared/mcp'
import type { LoadedSource } from '@craft-agent/shared/sources'
import type { Logger } from '@craft-agent/server-core/runtime'

const log: Logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger

function makeSource(overrides: Record<string, unknown> = {}): LoadedSource {
  return {
    config: {
      slug: 'craft',
      type: 'mcp',
      enabled: true,
      isAuthenticated: true,
      mcp: { authType: 'oauth' },
      ...overrides,
    },
  } as unknown as LoadedSource
}

interface FakePoolOpts {
  result?: McpToolResult
  onCall?: (proxyName: string, args: Record<string, unknown>) => void
}

function makePool(opts: FakePoolOpts = {}): { pool: McpClientPool; ensured: string[] } {
  const ensured: string[] = []
  const pool = {
    ensureConnected: async (slug: string) => { ensured.push(slug) },
    callTool: async (proxyName: string, args: Record<string, unknown>): Promise<McpToolResult> => {
      opts.onCall?.(proxyName, args)
      return opts.result ?? { content: 'ok', isError: false }
    },
  } as unknown as McpClientPool
  return { pool, ensured }
}

function makeExecutor(opts: {
  sources?: LoadedSource[]
  pool?: McpClientPool
  built?: { mcpServers?: Record<string, unknown>; apiServers?: Record<string, unknown>; errors?: Array<{ sourceSlug: string; error: string }> }
  onCall?: FakePoolOpts['onCall']
  result?: McpToolResult
  /** Fake refresh manager; default records calls and reports success */
  ensureFreshToken?: (source: LoadedSource) => Promise<{ success: boolean }>
  /** Runs when buildServers is invoked — lets tests simulate build-time config mutation */
  onBuild?: () => void
}) {
  const { pool, ensured } = opts.pool ? { pool: opts.pool, ensured: [] } : makePool({ onCall: opts.onCall, result: opts.result })
  const refreshed: string[] = []
  const sources = opts.sources ?? [makeSource()]
  const executor = createPagesMcpExecutor({
    workspaceRootPath: '/tmp/ws',
    pool,
    log,
    loadSources: () => sources,
    refreshManager: {
      ensureFreshToken: async (source: LoadedSource) => {
        refreshed.push(source.config.slug)
        return opts.ensureFreshToken ? opts.ensureFreshToken(source) : { success: true }
      },
    } as never,
    buildServers: (async () => {
      opts.onBuild?.()
      return {
        mcpServers: { craft: { type: 'http', url: 'https://x.test' } },
        apiServers: {},
        errors: [],
        ...opts.built,
      }
    }) as never,
  })
  return { executor, ensured, refreshed }
}

const signal = new AbortController().signal

describe('createPagesMcpExecutor', () => {
  test('executes a tool and returns the content string', async () => {
    const calls: string[] = []
    const { executor, ensured } = makeExecutor({ onCall: (name) => calls.push(name) })
    const body = await executor({ sourceSlug: 'craft', toolName: 'craft_read', args: { command: 'x' } }, { signal })
    expect(body).toBe('ok')
    expect(ensured).toEqual(['craft'])
    expect(calls).toEqual(['mcp__craft__craft_read'])
  })

  test('throws for an unknown source', async () => {
    const { executor } = makeExecutor({ sources: [] })
    await expect(
      executor({ sourceSlug: 'nope', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow(/not found/)
  })

  test('throws for a disabled source', async () => {
    const { executor } = makeExecutor({ sources: [makeSource({ enabled: false })] })
    await expect(
      executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow(/disabled/)
  })

  test('throws the stable source-auth-required error for an unauthenticated source', async () => {
    const { executor } = makeExecutor({ sources: [makeSource({ isAuthenticated: false })] })
    // The prefix is part of the page authoring contract (docs/pages.md) —
    // pages match on it to disable buttons and defer to the reconnect banner.
    await expect(
      executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow(/^source-auth-required: reconnect "craft" in the app$/)
  })

  test('directs api sources to api-kind grants', async () => {
    const { executor } = makeExecutor({
      sources: [makeSource({ type: 'api', api: { authType: 'none' } })],
      built: { mcpServers: {}, apiServers: { craft: {} } },
    })
    await expect(
      executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow(/api-kind grant/)
  })

  test('surfaces non-auth build errors as connect prose', async () => {
    const { executor } = makeExecutor({
      built: { mcpServers: {}, errors: [{ sourceSlug: 'craft', error: 'Connection refused' }] },
    })
    await expect(
      executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow(/not connectable: Connection refused/)
  })

  test('refreshes refreshable sources before building', async () => {
    const { executor, refreshed } = makeExecutor({})
    await executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal })
    expect(refreshed).toEqual(['craft'])
  })

  test('skips refresh for non-refreshable sources', async () => {
    const { executor, refreshed } = makeExecutor({
      sources: [makeSource({ mcp: { authType: 'none' } })],
    })
    await executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal })
    expect(refreshed).toEqual([])
  })

  test('failed refresh surfaces the stable auth error, not connect prose', async () => {
    // The real TokenRefreshManager marks the source needs_auth on failure
    // (disk + in-memory) — the fake mirrors the in-memory part.
    const { executor } = makeExecutor({
      ensureFreshToken: async (source) => {
        source.config.isAuthenticated = false
        source.config.connectionStatus = 'needs_auth'
        return { success: false }
      },
    })
    await expect(
      executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow(/^source-auth-required/)
  })

  test('auth-shaped build errors become the stable auth error', async () => {
    // buildServersFromSources marks a source needs_auth when its token is
    // expired with no refresh path; the executor must re-check and prefer
    // the stable error over "not connectable" prose.
    const sources = [makeSource()]
    const { executor } = makeExecutor({
      sources,
      onBuild: () => {
        sources[0]!.config.isAuthenticated = false
        sources[0]!.config.connectionStatus = 'needs_auth'
      },
      built: { mcpServers: {}, errors: [{ sourceSlug: 'craft', error: 'Authentication required' }] },
    })
    await expect(
      executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow(/^source-auth-required/)
  })

  test('throws when the tool result is an error', async () => {
    const { executor } = makeExecutor({ result: { content: 'boom', isError: true } })
    await expect(
      executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal }),
    ).rejects.toThrow('boom')
  })

  test('caps oversized results', async () => {
    const big = 'x'.repeat(MCP_ACTION_BODY_MAX_CHARS * 2)
    const { executor } = makeExecutor({ result: { content: big, isError: false } })
    const body = (await executor({ sourceSlug: 'craft', toolName: 't', args: {} }, { signal })) as string
    expect(body.length).toBe(MCP_ACTION_BODY_MAX_CHARS)
    expect(body).toContain('…[truncated')
  })
})
