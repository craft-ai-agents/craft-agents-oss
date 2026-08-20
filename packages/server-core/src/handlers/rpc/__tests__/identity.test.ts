import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { resetIdentityStoreCache } from '@craft-agent/core/platform/identity/store'
import { HANDLED_CHANNELS, registerIdentityHandlers } from '../identity'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createMockServer() {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  return {
    handlers,
    pushes,
    handle(channel: string, fn: Handler) {
      handlers.set(channel, fn)
    },
    push(channel: string, target: unknown, ...args: unknown[]) {
      pushes.push({ channel, target, args })
    },
  }
}

describe('identity RPC handlers', () => {
  let dir: string
  let prev: string | undefined

  beforeEach(() => {
    resetIdentityStoreCache()
    dir = mkdtempSync(join(tmpdir(), 'craft-identity-rpc-'))
    prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = dir
  })

  afterEach(() => {
    resetIdentityStoreCache()
    if (prev === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers every HANDLED_CHANNELS entry', () => {
    const server = createMockServer()
    registerIdentityHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    expect(HANDLED_CHANNELS).toEqual([
      RPC_CHANNELS.identity.GET_STATE,
      RPC_CHANNELS.identity.UPDATE_PROFILE,
      RPC_CHANNELS.identity.CONNECT,
      RPC_CHANNELS.identity.DISCONNECT,
      RPC_CHANNELS.identity.REFRESH_STATUS,
    ])
    for (const ch of HANDLED_CHANNELS) {
      expect(server.handlers.has(ch)).toBe(true)
    }
  })

  it('connect then disconnect only one connection', async () => {
    const server = createMockServer()
    registerIdentityHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)

    const connect = server.handlers.get(RPC_CHANNELS.identity.CONNECT)!
    const disconnect = server.handlers.get(RPC_CHANNELS.identity.DISCONNECT)!
    const getState = server.handlers.get(RPC_CHANNELS.identity.GET_STATE)!

    // github does not require a credential token in v1
    await connect({}, {
      provider: 'github',
      workspaceId: 'ws-1',
      accountLabel: 'a@x.com',
      connectionId: 'svc-a',
    })
    await connect({}, {
      provider: 'github',
      workspaceId: 'ws-1',
      accountLabel: 'b',
      connectionId: 'svc-b',
    })

    let state = (await getState({}, { workspaceId: 'ws-1' })) as {
      connections: Array<{ id: string; status: string }>
    }
    const ownedBefore = state.connections.filter((c) => c.id === 'svc-a' || c.id === 'svc-b')
    expect(ownedBefore).toHaveLength(2)
    expect(ownedBefore.every((c) => c.status === 'connected')).toBe(true)

    await disconnect({}, { connectionId: 'svc-a' })
    state = (await getState({}, { workspaceId: 'ws-1' })) as typeof state
    const a = state.connections.find((c) => c.id === 'svc-a')
    const b = state.connections.find((c) => c.id === 'svc-b')
    expect(a?.status).toBe('disconnected')
    expect(b?.status).toBe('connected')
  })

  it('rejects siyuan-cloud connect without credentialValue', async () => {
    const server = createMockServer()
    registerIdentityHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const connect = server.handlers.get(RPC_CHANNELS.identity.CONNECT)!
    await expect(
      connect({}, {
        provider: 'siyuan-cloud',
        workspaceId: 'ws-1',
        connectionId: 'svc-siyuan-cloud',
      }),
    ).rejects.toThrow(/credentialValue is required/)

    await expect(
      connect({}, {
        provider: 'siyuan-cloud',
        workspaceId: 'ws-1',
        credentialValue: '   ',
        connectionId: 'svc-siyuan-cloud',
      }),
    ).rejects.toThrow(/credentialValue is required/)
  })

  it('updateProfile persists displayName', async () => {
    const server = createMockServer()
    registerIdentityHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const update = server.handlers.get(RPC_CHANNELS.identity.UPDATE_PROFILE)!
    const state = (await update({}, { displayName: 'Rox' })) as {
      profile: { displayName: string }
    }
    expect(state.profile.displayName).toBe('Rox')
  })
})
