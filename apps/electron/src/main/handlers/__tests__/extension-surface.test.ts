/**
 * Tests for the extension UI surface handlers (durable-key registry over
 * BrowserPaneManager with per-extension×workspace session partition).
 *
 * Harness shape mirrors siyuan.test.ts: recorder RpcServer + HandlerDeps with
 * a stubbed browserPaneManager. Contract under test: partition
 * `persist:ext-${ws||'default'}-${extensionId}`, workspace-scoped durableKey
 * (spoof rejected), dedup, STATE_CHANGED / REMOVED, owner refcount, LIST.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS, type ExtensionSurfaceState } from '@craft-agent/shared/protocol'
import type { HandlerDeps } from '../handler-deps'

mock.module('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {} },
}))

type HandlerFn = (...args: unknown[]) => unknown
type Push = { channel: string; target: unknown; args: unknown[] }

interface Recorder {
  server: RpcServer
  handlers: Map<string, HandlerFn>
  pushes: Push[]
}

function makeServer(): Recorder {
  const handlers = new Map<string, HandlerFn>()
  const pushes: Push[] = []
  const server: RpcServer = {
    handle: (channel: string, fn: HandlerFn) => {
      handlers.set(channel, fn)
    },
    push: (channel: string, target: unknown, ...args: unknown[]) => {
      pushes.push({ channel, target, args })
    },
  } as unknown as RpcServer
  return { server, handlers, pushes }
}

interface EmbeddedCalls {
  created: Array<{ url?: string; workspaceId?: string | null; partition?: string }>
  destroyed: string[]
  focused: string[]
  bounds: Array<{ id: string; rect: unknown }>
  nextInstanceId: number
}

function makeDeps(calls: EmbeddedCalls): HandlerDeps {
  return {
    sessionManager: {} as HandlerDeps['sessionManager'],
    platform: {
      appRootPath: '',
      resourcesPath: '',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: false,
      logger: console,
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
    windowManager: {} as HandlerDeps['windowManager'],
    browserPaneManager: {
      createEmbeddedInstance: (input?: {
        url?: string
        workspaceId?: string | null
        partition?: string
      }) => {
        calls.created.push(input ?? {})
        return `browser-embedded-${++calls.nextInstanceId}`
      },
      destroyInstance: (id: string) => {
        calls.destroyed.push(id)
      },
      syncEmbeddedBounds: (id: string, rect: unknown) => {
        calls.bounds.push({ id, rect })
      },
      focus: (id: string) => {
        calls.focused.push(id)
      },
      onStateChange: () => {},
      onRemoved: () => {},
      onInteracted: () => {},
    } as unknown as NonNullable<HandlerDeps['browserPaneManager']>,
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
  }
}

function makeCalls(): EmbeddedCalls {
  return { created: [], destroyed: [], focused: [], bounds: [], nextInstanceId: 0 }
}

const CTX = {} as never

describe('extension surface handlers', () => {
  let recorder: Recorder
  let calls: EmbeddedCalls
  let register: (typeof import('../extension-surface'))['registerExtensionSurfaceHandlers']
  let HANDLED_CHANNELS: readonly string[]

  beforeEach(async () => {
    recorder = makeServer()
    calls = makeCalls()
    const mod = await import('../extension-surface')
    register = mod.registerExtensionSurfaceHandlers
    HANDLED_CHANNELS = mod.HANDLED_CHANNELS
  })

  it('declares exactly the 5 invoke channels — push events are handler-external', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED,
      RPC_CHANNELS.extensionSurface.DESTROY,
      RPC_CHANNELS.extensionSurface.LIST,
      RPC_CHANNELS.extensionSurface.SYNC_BOUNDS,
      RPC_CHANNELS.extensionSurface.FOCUS,
    ])
    expect([...HANDLED_CHANNELS]).not.toContain(RPC_CHANNELS.extensionSurface.STATE_CHANGED)
    expect([...HANDLED_CHANNELS]).not.toContain(RPC_CHANNELS.extensionSurface.REMOVED)
  })

  it('registers a handler for every declared channel and nothing else', () => {
    register(recorder.server, makeDeps(calls))
    expect(recorder.handlers.size).toBe(HANDLED_CHANNELS.length)
    for (const ch of HANDLED_CHANNELS) {
      expect(recorder.handlers.has(ch)).toBe(true)
    }
  })

  it('registers nothing when the browser pane manager is absent', () => {
    const deps = makeDeps(calls)
    deps.browserPaneManager = undefined
    register(recorder.server, deps)
    expect(recorder.handlers.size).toBe(0)
  })

  it('createEmbedded passes workspace-scoped partition and broadcasts STATE_CHANGED', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!

    const instanceId = handler(CTX, {
      durableKey: 'ext:ws-1:hello:main',
      url: 'https://ext.example/ui',
      extensionId: 'hello',
      viewId: 'main',
      workspaceId: 'ws-1',
    })

    expect(instanceId).toBe('browser-embedded-1')
    expect(calls.created).toEqual([
      {
        url: 'https://ext.example/ui',
        workspaceId: 'ws-1',
        partition: 'persist:ext-ws-1-hello',
      },
    ])

    const pushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.extensionSurface.STATE_CHANGED)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].target).toEqual({ to: 'all' })
    expect(pushes[0].args[0]).toEqual({
      instanceId: 'browser-embedded-1',
      durableKey: 'ext:ws-1:hello:main',
      extensionId: 'hello',
      viewId: 'main',
      url: 'https://ext.example/ui',
      workspaceId: 'ws-1',
    } satisfies ExtensionSurfaceState)
  })

  it('createEmbedded builds workspace-scoped durableKey when omitted', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!
    const list = recorder.handlers.get(RPC_CHANNELS.extensionSurface.LIST)!

    handler(CTX, {
      url: 'about:blank',
      extensionId: 'pack',
      viewId: 'panel-a',
      workspaceId: 'ws-1',
    })

    const states = list(CTX) as ExtensionSurfaceState[]
    expect(states).toHaveLength(1)
    expect(states[0].durableKey).toBe('ext:ws-1:pack:panel-a')
    expect(calls.created[0].partition).toBe('persist:ext-ws-1-pack')
  })

  it('createEmbedded uses _default / default when workspaceId absent', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!
    const list = recorder.handlers.get(RPC_CHANNELS.extensionSurface.LIST)!

    handler(CTX, {
      url: 'about:blank',
      extensionId: 'solo',
      viewId: 'main',
    })

    const states = list(CTX) as ExtensionSurfaceState[]
    expect(states[0].durableKey).toBe('ext:_default:solo:main')
    expect(calls.created[0].partition).toBe('persist:ext-default-solo')
  })

  it('createEmbedded rejects durableKey spoof that mismatches extension/view/workspace', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!

    expect(() =>
      handler(CTX, {
        durableKey: 'ext:other-ws:evil:panel',
        url: 'u://x',
        extensionId: 'hello',
        viewId: 'main',
        workspaceId: 'ws-1',
      }),
    ).toThrow(/durableKey does not match/i)
    expect(calls.created).toHaveLength(0)
  })

  it('createEmbedded rejects empty extensionId / viewId', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!

    expect(() =>
      handler(CTX, { url: 'u://x', extensionId: '', viewId: 'main' }),
    ).toThrow(/extensionId/)
    expect(() =>
      handler(CTX, { url: 'u://x', extensionId: 'hello', viewId: '  ' }),
    ).toThrow(/viewId/)
    expect(calls.created).toHaveLength(0)
  })

  it('createEmbedded dedups on durableKey: reuses the surface, focuses it, re-broadcasts state', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!

    const first = handler(CTX, {
      durableKey: 'ext:ws-1:hello:main',
      url: 'https://ext.example/ui',
      extensionId: 'hello',
      viewId: 'main',
      workspaceId: 'ws-1',
    }) as string
    const second = handler(CTX, {
      durableKey: 'ext:ws-1:hello:main',
      url: 'https://ext.example/ui',
      extensionId: 'hello',
      viewId: 'main',
      workspaceId: 'ws-1',
    })

    expect(second).toBe(first)
    expect(calls.created).toHaveLength(1)
    expect(calls.focused).toEqual([first])
    expect(
      recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.extensionSurface.STATE_CHANGED),
    ).toHaveLength(2)
  })

  it('same extension in two workspaces creates two surfaces and partitions', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!

    const a = handler(CTX, {
      extensionId: 'shared',
      viewId: 'main',
      url: 'u://a',
      workspaceId: 'ws-1',
    })
    const b = handler(CTX, {
      extensionId: 'shared',
      viewId: 'main',
      url: 'u://b',
      workspaceId: 'ws-2',
    })

    expect(a).not.toBe(b)
    expect(calls.created).toHaveLength(2)
    expect(calls.created[0].partition).toBe('persist:ext-ws-1-shared')
    expect(calls.created[1].partition).toBe('persist:ext-ws-2-shared')
  })

  it('createEmbedded with distinct extension ids creates distinct surfaces', () => {
    register(recorder.server, makeDeps(calls))
    const handler = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!

    const a = handler(CTX, {
      extensionId: 'a',
      viewId: 'main',
      url: 'u://a',
      workspaceId: 'ws-1',
    })
    const b = handler(CTX, {
      extensionId: 'b',
      viewId: 'main',
      url: 'u://b',
      workspaceId: 'ws-2',
    })

    expect(a).not.toBe(b)
    expect(calls.created).toHaveLength(2)
    expect(calls.created[0].partition).toBe('persist:ext-ws-1-a')
    expect(calls.created[1].partition).toBe('persist:ext-ws-2-b')
  })

  it('list returns all surfaces, workspace-scopes on request, and always passes unbound surfaces', () => {
    register(recorder.server, makeDeps(calls))
    const create = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!
    const list = recorder.handlers.get(RPC_CHANNELS.extensionSurface.LIST)!

    create(CTX, { extensionId: 'a', viewId: 'v', url: 'u://a', workspaceId: 'ws-1' })
    create(CTX, { extensionId: 'b', viewId: 'v', url: 'u://b', workspaceId: 'ws-2' })
    create(CTX, { extensionId: 'c', viewId: 'v', url: 'u://c' })

    const all = list(CTX) as ExtensionSurfaceState[]
    expect(all.map((s) => s.durableKey).sort()).toEqual([
      'ext:_default:c:v',
      'ext:ws-1:a:v',
      'ext:ws-2:b:v',
    ])
    expect(all.find((s) => s.durableKey === 'ext:_default:c:v')?.workspaceId).toBeNull()

    const ws1 = list(CTX, { workspaceId: 'ws-1' }) as ExtensionSurfaceState[]
    expect(ws1.map((s) => s.durableKey).sort()).toEqual(['ext:_default:c:v', 'ext:ws-1:a:v'])
  })


  it('syncBounds forwards the rect verbatim and tolerates unknown instances', () => {
    register(recorder.server, makeDeps(calls))
    const create = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!
    const sync = recorder.handlers.get(RPC_CHANNELS.extensionSurface.SYNC_BOUNDS)!

    const id = create(CTX, {
      extensionId: 'a',
      viewId: 'v',
      url: 'u://a',
      workspaceId: 'ws-1',
    }) as string
    const rect = { x: 1, y: 2, width: 300, height: 400 }
    sync(CTX, { instanceId: id, rect })
    sync(CTX, { instanceId: 'ghost', rect: null })

    expect(calls.bounds).toEqual([
      { id, rect },
      { id: 'ghost', rect: null },
    ])
  })

  it('destroy forwards to the manager, purges the registry and broadcasts REMOVED to all', () => {
    register(recorder.server, makeDeps(calls))
    const create = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!
    const destroy = recorder.handlers.get(RPC_CHANNELS.extensionSurface.DESTROY)!
    const list = recorder.handlers.get(RPC_CHANNELS.extensionSurface.LIST)!

    const id = create(CTX, {
      extensionId: 'a',
      viewId: 'v',
      url: 'u://a',
      workspaceId: 'ws-1',
    }) as string
    destroy(CTX, { instanceId: id })

    expect(calls.destroyed).toEqual([id])
    expect(list(CTX)).toEqual([])

    const removedPushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.extensionSurface.REMOVED)
    expect(removedPushes).toHaveLength(1)
    expect(removedPushes[0].target).toEqual({ to: 'all' })
    expect(removedPushes[0].args).toEqual([id])

    const reused = create(CTX, {
      extensionId: 'a',
      viewId: 'v',
      url: 'u://a',
      workspaceId: 'ws-1',
    })
    expect(reused).not.toBe(id)
    expect(calls.created).toHaveLength(2)
  })

  it('destroy of an unknown instance forwards but does not broadcast REMOVED', () => {
    register(recorder.server, makeDeps(calls))
    const destroy = recorder.handlers.get(RPC_CHANNELS.extensionSurface.DESTROY)!

    destroy(CTX, { instanceId: 'browser-embedded-99' })

    expect(calls.destroyed).toEqual(['browser-embedded-99'])
    expect(recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.extensionSurface.REMOVED)).toHaveLength(0)
  })

  it('shares one surface across holders: a non-last destroy keeps it alive, the last destroy removes it', () => {
    register(recorder.server, makeDeps(calls))
    const create = recorder.handlers.get(RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED)!
    const destroy = recorder.handlers.get(RPC_CHANNELS.extensionSurface.DESTROY)!
    const list = recorder.handlers.get(RPC_CHANNELS.extensionSurface.LIST)!

    const first = create(CTX, {
      extensionId: 'hello',
      viewId: 'main',
      url: 'u://x',
      workspaceId: 'ws-1',
    }) as string
    const second = create(CTX, {
      extensionId: 'hello',
      viewId: 'main',
      url: 'u://x',
      workspaceId: 'ws-1',
    })
    expect(second).toBe(first)

    destroy(CTX, { instanceId: first })
    expect(calls.destroyed).toEqual([])
    expect(recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.extensionSurface.REMOVED)).toHaveLength(0)
    expect((list(CTX) as ExtensionSurfaceState[]).map((s) => s.instanceId)).toEqual([first])

    destroy(CTX, { instanceId: first })
    expect(calls.destroyed).toEqual([first])
    expect(list(CTX)).toEqual([])
    const removedPushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.extensionSurface.REMOVED)
    expect(removedPushes).toHaveLength(1)
    expect(removedPushes[0].args).toEqual([first])

    const reopened = create(CTX, {
      extensionId: 'hello',
      viewId: 'main',
      url: 'u://x',
      workspaceId: 'ws-1',
    })
    expect(reopened).not.toBe(first)
    expect(calls.created).toHaveLength(2)
  })

  it('focus forwards to the browser pane manager', () => {
    register(recorder.server, makeDeps(calls))
    const focus = recorder.handlers.get(RPC_CHANNELS.extensionSurface.FOCUS)!

    focus(CTX, { instanceId: 'browser-embedded-1' })
    expect(calls.focused).toEqual(['browser-embedded-1'])
  })
})
