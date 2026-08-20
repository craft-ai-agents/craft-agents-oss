/**
 * M1 RPC tests: memory.GET_CONTEXT with the optional query argument returns an
 * FTS-ranked subset of the workspace bundle (matched context/preferences
 * documents + ranked history days only); no query, any index error, or zero
 * hits fall back to the full recent bundle. Follows the
 * memory-skills-pending.test.ts harness pattern.
 */
import './memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot: string
const configDir = process.env.CRAFT_CONFIG_DIR!

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) =>
    id === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
  getWorkspaces: () => [{ id: 'ws1', name: 'ws1', rootPath: workspaceRoot }],
}))

import { registerMemoryHandlers } from './memory'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { closeAll } from '../../memory/fts-index'
import type { MemoryContextDto } from './memory'

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerMemoryHandlers(server, deps)
  return {
    getContext: (...args: unknown[]) => {
      const handler = handlers.get(RPC_CHANNELS.memory.GET_CONTEXT)
      if (!handler) throw new Error('No handler for memory.GET_CONTEXT')
      return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args) as Promise<MemoryContextDto>
    },
  }
}

/** Seed a workspace scope (context + two history days) and global preferences. */
function seedMemory() {
  const wsStore = new MemoryFileStore('workspace', workspaceRoot)
  wsStore.writeContext('deploy pipeline uses vercel previews and pnpm deploys')
  wsStore.appendDailyHistory('# 2026-08-01\n\nshipped the vercel rollback fix', '2026-08-01')
  wsStore.appendDailyHistory('# 2026-08-02\n\ngardening the wiki pages', '2026-08-02')
  const gStore = new MemoryFileStore('global')
  gStore.writePreferences('prefers concise answers about deploys')
}

beforeEach(() => {
  closeAll() // drop any stale sqlite handles before wiping the shared config dir
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mem-fts-ws-'))
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
})

afterEach(() => {
  closeAll()
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('memory.GET_CONTEXT query (M1)', () => {
  it('without a query returns the full recent bundle (legacy shape)', async () => {
    const { getContext } = createHarness()
    seedMemory()
    const dto = await getContext('ws1')
    expect(dto.preferences).toContain('concise answers')
    expect(dto.context).toContain('vercel previews')
    expect(dto.workspaceMemory?.recentHistory).toContain('vercel rollback')
    expect(dto.workspaceMemory?.recentHistory).toContain('gardening')
  })

  it('with a query returns only the ranked subset', async () => {
    const { getContext } = createHarness()
    seedMemory()
    const dto = await getContext('ws1', 'vercel')
    expect(dto.context).toContain('vercel previews')
    expect(dto.workspaceMemory?.context).toContain('vercel previews')
    expect(dto.workspaceMemory?.recentHistory).toContain('vercel rollback')
    expect(dto.workspaceMemory?.recentHistory).not.toContain('gardening')
    // global preferences didn't match the query → excluded from the subset.
    expect(dto.preferences).toBe('')
    expect(dto.workspaceMemory?.preferences).toBe('')
  })

  it('query matching preferences keeps the global document', async () => {
    const { getContext } = createHarness()
    seedMemory()
    const dto = await getContext('ws1', 'concise')
    expect(dto.preferences).toContain('concise answers')
    expect(dto.context).toBe('')
    expect(dto.workspaceMemory?.recentHistory).toBe('')
  })

  it('falls back to the full bundle when the query matches nothing', async () => {
    const { getContext } = createHarness()
    seedMemory()
    const dto = await getContext('ws1', 'zzz-unindexed-term')
    expect(dto.workspaceMemory?.recentHistory).toContain('vercel rollback')
    expect(dto.workspaceMemory?.recentHistory).toContain('gardening')
    expect(dto.context).toContain('vercel previews')
  })

  it('falls back to the full bundle on index errors', async () => {
    const { getContext } = createHarness()
    seedMemory()
    const wsStore = new MemoryFileStore('workspace', workspaceRoot)
    closeAll()
    writeFileSync(join(wsStore.memoryDir, 'index.db'), 'definitely not a sqlite database')
    const dto = await getContext('ws1', 'vercel')
    expect(dto.workspaceMemory?.recentHistory).toContain('gardening')
    expect(dto.context).toContain('vercel previews')
  })

  it('empty/whitespace query stays on the full-bundle path', async () => {
    const { getContext } = createHarness()
    seedMemory()
    const dto = await getContext('ws1', '   ')
    expect(dto.workspaceMemory?.recentHistory).toContain('gardening')
  })
})
