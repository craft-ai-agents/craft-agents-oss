import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerUserProfileHandlers } from './userProfile'
import type { RpcServer } from '@craft-agent/server-core/transport'

describe('userProfile RPC handlers', () => {
  function setup() {
    const handlers = new Map<string, Function>()
    const server = {
      handle: (channel: string, handler: Function) => { handlers.set(channel, handler) },
    } as unknown as RpcServer

    let refreshResult = { userName: 'Refreshed', ystId: 'OS-999', zuName: 'Eng', shiName: 'AI' }
    let getResult = { userName: 'Cached', ystId: 'OS-888', zuName: 'Eng', shiName: 'AI' }

    const deps = {
      sessionManager: {
        refreshUserProfile: async () => refreshResult,
        getUserProfile: async () => getResult,
      },
    }

    registerUserProfileHandlers(server, deps as any)
    return { handlers, deps }
  }

  it('registers userProfile:refresh handler', () => {
    const { handlers } = setup()
    expect(handlers.has(RPC_CHANNELS.userProfile.REFRESH)).toBe(true)
  })

  it('registers userProfile:get handler', () => {
    const { handlers } = setup()
    expect(handlers.has(RPC_CHANNELS.userProfile.GET)).toBe(true)
  })

  it('userProfile:refresh delegates to sessionManager.refreshUserProfile', async () => {
    const { handlers } = setup()
    const handler = handlers.get(RPC_CHANNELS.userProfile.REFRESH)!
    const result = await handler()
    expect(result).toEqual({ userName: 'Refreshed', ystId: 'OS-999', zuName: 'Eng', shiName: 'AI' })
  })

  it('userProfile:get delegates to sessionManager.getUserProfile', async () => {
    const { handlers } = setup()
    const handler = handlers.get(RPC_CHANNELS.userProfile.GET)!
    const result = await handler()
    expect(result).toEqual({ userName: 'Cached', ystId: 'OS-888', zuName: 'Eng', shiName: 'AI' })
  })
})
