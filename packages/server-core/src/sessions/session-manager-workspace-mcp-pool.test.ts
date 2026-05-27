import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { McpClientPool } from '@craft-agent/shared/mcp'
import { TokenRefreshManager } from '@craft-agent/shared/sources'
import type { McpServerConfig } from '@craft-agent/shared/sources'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type PoolMaps = {
  sessions: Map<string, unknown>
  workspaceMcpPools: Map<string, McpClientPool>
  workspaceTokenRefreshManagers: Map<string, TokenRefreshManager>
}

type SyncCall = {
  pool: McpClientPool
  mcpServers: Record<string, McpServerConfig>
}

describe('SessionManager workspace MCP pool bootstrap', () => {
  const originalSync = McpClientPool.prototype.sync
  const originalDisconnectAll = McpClientPool.prototype.disconnectAll

  let roots: string[]
  let sm: SessionManager
  let syncCalls: SyncCall[]
  let disconnectCalls: McpClientPool[]

  beforeEach(() => {
    roots = []
    syncCalls = []
    disconnectCalls = []
    sm = new SessionManager()

    McpClientPool.prototype.sync = async function (
      this: McpClientPool,
      mcpServers: Record<string, McpServerConfig>,
    ) {
      syncCalls.push({ pool: this, mcpServers })
      return []
    }

    McpClientPool.prototype.disconnectAll = async function (this: McpClientPool) {
      disconnectCalls.push(this)
    }
  })

  afterEach(async () => {
    await Promise.all(roots.map((root) => sm.closeWorkspace(root)))
    McpClientPool.prototype.sync = originalSync
    McpClientPool.prototype.disconnectAll = originalDisconnectAll
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function makeWorkspaceRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix))
    roots.push(root)
    return root
  }

  function writeMcpSource(workspaceRoot: string, slug: string): void {
    const dir = join(workspaceRoot, 'sources', slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        id: slug,
        slug,
        name: slug,
        type: 'mcp',
        enabled: true,
        provider: 'custom',
        mcp: {
          transport: 'streamable_http',
          url: `https://${slug}.example.com/mcp`,
          authType: 'none',
        },
      }),
    )
    writeFileSync(join(dir, 'guide.md'), `# ${slug}\n`)
  }

  async function waitForSyncCalls(count: number): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      if (syncCalls.length >= count) return
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  it('creates one workspace pool and token refresh manager, then syncs all workspace MCP sources', async () => {
    const workspaceRoot = makeWorkspaceRoot('sm-workspace-mcp-')
    writeMcpSource(workspaceRoot, 'linear')
    writeMcpSource(workspaceRoot, 'github')

    sm.setupConfigWatcher(workspaceRoot, 'ws_test')
    sm.setupConfigWatcher(workspaceRoot, 'ws_test')
    await waitForSyncCalls(1)

    const internals = sm as unknown as PoolMaps
    expect(internals.workspaceMcpPools.size).toBe(1)
    expect(internals.workspaceTokenRefreshManagers.size).toBe(1)
    expect(syncCalls).toHaveLength(1)
    const workspacePool = internals.workspaceMcpPools.get(workspaceRoot)
    expect(workspacePool).toBeDefined()
    expect(syncCalls[0]!.pool).toBe(workspacePool!)
    expect(Object.keys(syncCalls[0]!.mcpServers).sort()).toEqual(['github', 'linear'])
  })

  it('keeps separate pool instances for sessions in different workspaces', async () => {
    const workspaceA = makeWorkspaceRoot('sm-workspace-a-')
    const workspaceB = makeWorkspaceRoot('sm-workspace-b-')
    writeMcpSource(workspaceA, 'linear-a')
    writeMcpSource(workspaceB, 'linear-b')

    sm.setupConfigWatcher(workspaceA, 'ws_a')
    sm.setupConfigWatcher(workspaceB, 'ws_b')
    await waitForSyncCalls(2)

    const internals = sm as unknown as PoolMaps
    internals.sessions.set(
      'session-a',
      createManagedSession({ id: 'session-a' }, { id: 'ws_a', slug: 'ws-a', name: 'A', rootPath: workspaceA, createdAt: Date.now() }),
    )
    internals.sessions.set(
      'session-b',
      createManagedSession({ id: 'session-b' }, { id: 'ws_b', slug: 'ws-b', name: 'B', rootPath: workspaceB, createdAt: Date.now() }),
    )

    const poolA = internals.workspaceMcpPools.get(workspaceA)
    const poolB = internals.workspaceMcpPools.get(workspaceB)
    expect(poolA).toBeDefined()
    expect(poolB).toBeDefined()
    expect(poolA).not.toBe(poolB)
  })

  it('disconnects and removes workspace pool state when the workspace closes', async () => {
    const workspaceRoot = makeWorkspaceRoot('sm-workspace-close-')
    writeMcpSource(workspaceRoot, 'linear')

    sm.setupConfigWatcher(workspaceRoot, 'ws_close')
    await waitForSyncCalls(1)
    const internals = sm as unknown as PoolMaps
    const pool = internals.workspaceMcpPools.get(workspaceRoot)!

    await sm.closeWorkspace(workspaceRoot)

    expect(disconnectCalls).toEqual([pool])
    expect(internals.workspaceMcpPools.has(workspaceRoot)).toBe(false)
    expect(internals.workspaceTokenRefreshManagers.has(workspaceRoot)).toBe(false)
  })
})
