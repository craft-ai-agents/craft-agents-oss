/**
 * LOAD RPC must ignore renderer grantedPermissions and resolve grants only
 * from workspace permissions.json (extensions[id].granted − revoked).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const workspaceRoots = new Map<string, string>()

mock.module('@craft-agent/shared/config', () => ({
  CONFIG_DIR: '/tmp/craft-ext-host-load-grants-config',
  getWorkspaceByNameOrId: (id: string) => {
    const root = workspaceRoots.get(id)
    return root ? { id, name: id, rootPath: root } : null
  },
}))

// Import after mock so handler sees stubbed getWorkspaceByNameOrId.
const { registerExtensionHostHandlers, resolveExtensionGrantsFromPermissions } = await import(
  '../extension-host'
)
const {
  ExtensionHostManager,
  resetExtensionHostManagers,
  setExtensionHostManagerForTests,
} = await import('../../extension-host-manager')
const { CapabilityBroker } = await import('../../extension-host/capability-broker')
const { startWorker } = await import('../../extension-host/worker')

import { EventEmitter } from 'node:events'
import type { ExtensionHostChild, ExtensionHostForkFn } from '../../extension-host-manager'

class FakeChild extends EventEmitter implements ExtensionHostChild {
  pid = 9100
  killed = false
  messages: unknown[] = []
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
  kill(): void {
    this.killed = true
  }
}

function createInProcessFork(configDir: string): ExtensionHostForkFn {
  return () => {
    const child = new FakeChild()
    const port = {
      postMessage: (msg: unknown) => {
        queueMicrotask(() => child.emit('message', msg))
      },
      on: (event: string, handler: (data: unknown) => void) => {
        if (event === 'message') {
          child.on('message-to-worker', handler)
        }
      },
      once: () => {},
      removeListener: () => {},
      addListener: () => {},
    }
    // Bridge manager → worker
    const origPost = child.postMessage.bind(child)
    child.postMessage = (message: unknown) => {
      origPost(message)
      queueMicrotask(() => {
        child.emit('message-to-worker', message)
      })
    }
    // Worker → manager
    const workerPort = {
      postMessage: (msg: unknown) => {
        queueMicrotask(() => child.emit('message', msg))
      },
      on: (event: string, handler: (data: unknown) => void) => {
        if (event === 'message') child.on('message-to-worker', handler)
      },
      once: () => {},
      removeListener: () => {},
      addListener: () => {},
    }
    // Use same EventEmitter bridge as manager tests
    const ee = new EventEmitter()
    const mainSide = {
      postMessage: (m: unknown) => {
        queueMicrotask(() => ee.emit('to-worker', m))
      },
      on: (ev: string, h: (...a: unknown[]) => void) => {
        if (ev === 'message') ee.on('to-main', h)
      },
      once: () => {},
      removeListener: () => {},
      addListener: () => {},
    }
    // Simpler: reuse manager test pattern via startWorker with dual emitters
    void port
    void workerPort
    void mainSide

    const childEe = child as FakeChild & {
      _workerDispose?: () => void
    }
    const toWorker = new EventEmitter()
    const toMain = new EventEmitter()

    child.postMessage = (message: unknown) => {
      child.messages.push(message)
      queueMicrotask(() => toWorker.emit('message', message))
    }

    const workerApi = startWorker({
      port: {
        postMessage: (msg: unknown) => {
          queueMicrotask(() => child.emit('message', msg))
        },
        on: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.on('message', handler)
        },
        addListener: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.on('message', handler)
        },
        removeListener: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.off('message', handler)
        },
        once: (event: string, handler: (data: unknown) => void) => {
          if (event === 'message') toWorker.once('message', handler)
        },
      } as never,
      configDir,
      importFn: async (url: string) => {
        const { pathToFileURL } = await import('node:url')
        // url is already file URL
        void pathToFileURL
        return import(url)
      },
    })
    childEe._workerDispose = workerApi.dispose
    void toMain
    return child
  }
}

type HandlerFn = (...args: unknown[]) => unknown

function makeServer(): { server: RpcServer; handlers: Map<string, HandlerFn> } {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, fn: HandlerFn) => {
      handlers.set(channel, fn)
    },
  } as unknown as RpcServer
  return { server, handlers }
}

const CTX = {} as never

describe('resolveExtensionGrantsFromPermissions', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ext-grants-'))
    workspaceRoots.clear()
    workspaceRoots.set('ws-grants', root)
  })

  afterEach(() => {
    workspaceRoots.clear()
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('returns [] when workspace missing', () => {
    expect(resolveExtensionGrantsFromPermissions('nope', 'ext-a')).toEqual([])
  })

  it('returns [] when permissions.json missing or no extension entry', () => {
    expect(resolveExtensionGrantsFromPermissions('ws-grants', 'ext-a')).toEqual([])
    writeFileSync(join(root, 'permissions.json'), JSON.stringify({ version: "2026-08-08" }) + '\n')
    expect(resolveExtensionGrantsFromPermissions('ws-grants', 'ext-a')).toEqual([])
  })

  it('returns granted minus revoked', () => {
    writeFileSync(
      join(root, 'permissions.json'),
      JSON.stringify({
        version: "2026-08-08",
        extensions: {
          'ext-a': {
            granted: ['network.request', 'ui.command', 'shell.execute'],
            grantedAt: new Date().toISOString(),
            revoked: ['shell.execute'],
          },
        },
      }) + '\n',
    )
    expect(resolveExtensionGrantsFromPermissions('ws-grants', 'ext-a').sort()).toEqual(
      ['network.request', 'ui.command'].sort(),
    )
  })
})

describe('extensionHost.LOAD ignores client grantedPermissions', () => {
  let tmp: string
  let root: string
  let handlers: Map<string, HandlerFn>

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'eh-load-'))
    root = mkdtempSync(join(tmpdir(), 'eh-ws-'))
    workspaceRoots.clear()
    workspaceRoots.set('ws-load', root)
    resetExtensionHostManagers()

    const sandbox = join(tmp, 'extensions', 'sandbox', 'load-ext')
    mkdirSync(sandbox, { recursive: true })
    writeFileSync(join(sandbox, 'index.mjs'), 'export function ping() { return 1 }\n')

    const broker = new CapabilityBroker()
    const mgr = new ExtensionHostManager({
      forkFn: createInProcessFork(tmp),
      configDir: tmp,
      workerPath: '/virtual/worker.cjs',
      broker,
      getCredential: async () => null,
      messageTimeoutMs: 3000,
    })
    setExtensionHostManagerForTests(mgr, 'ws-load')
    await mgr.start()

    const rec = makeServer()
    registerExtensionHostHandlers(rec.server, {} as never)
    handlers = rec.handlers
  })

  afterEach(() => {
    resetExtensionHostManagers()
    workspaceRoots.clear()
    for (const p of [tmp, root]) {
      try {
        rmSync(p, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  it('client-supplied grants do not authorize mint; file grants do', async () => {
    const load = handlers.get(RPC_CHANNELS.extensionHost.LOAD)!
    const mint = handlers.get(RPC_CHANNELS.extensionHost.MINT_CAPABILITY)!
    const entryPath = join(tmp, 'extensions', 'sandbox', 'load-ext', 'index.mjs')

    // No permissions.json — LOAD ignores client grants → empty stored grants
    await load(CTX, {
      extensionId: 'load-ext',
      entryPath,
      workspaceId: 'ws-load',
      grantedPermissions: ['network.request', 'shell.execute'],
    })

    await expect(
      mint(CTX, {
        extensionId: 'load-ext',
        permission: 'network.request',
        workspaceId: 'ws-load',
      }),
    ).rejects.toThrow(/not granted/i)

    // Write real grants to permissions.json and reload
    writeFileSync(
      join(root, 'permissions.json'),
      JSON.stringify({
        version: "2026-08-08",
        extensions: {
          'load-ext': {
            granted: ['network.request'],
            grantedAt: new Date().toISOString(),
          },
        },
      }) + '\n',
    )

    await load(CTX, {
      extensionId: 'load-ext',
      entryPath,
      workspaceId: 'ws-load',
      // Still trying to escalate — must be ignored
      grantedPermissions: ['network.request', 'shell.execute'],
    })

    const ok = (await mint(CTX, {
      extensionId: 'load-ext',
      permission: 'network.request',
      workspaceId: 'ws-load',
    })) as { token: string; permission: string }
    expect(ok.token).toBeTruthy()
    expect(ok.permission).toBe('network.request')

    await expect(
      mint(CTX, {
        extensionId: 'load-ext',
        permission: 'shell.execute',
        workspaceId: 'ws-load',
      }),
    ).rejects.toThrow(/not granted/i)
  })
})
