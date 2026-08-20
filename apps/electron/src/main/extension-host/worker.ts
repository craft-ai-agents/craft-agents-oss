/**
 * Craft Extension Host worker (craft-sandbox).
 *
 * Runs inside Electron utilityProcess (or a test MessagePort harness).
 * - Does NOT read process.env for API keys / secrets
 * - Loads only allowlisted entry paths under sandbox roots
 * - Never special-cases SiYuan plugin paths
 * - Permission check on inbound `call` (basic: method must be a function;
 *   optional permissions list is accepted and recorded for future broker)
 * - Injects globalThis.__craftCapability for mint/fetch RPC to main
 *   (raw secrets never returned from mint)
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { pathToFileURL } from 'node:url'
import {
  assertPathAllowlisted,
  resolveSandboxRoots,
} from './path-allowlist'
import type {
  MainToWorkerMessage,
  MessagePortLike,
  WorkerToMainMessage,
} from './protocol'

interface LoadedExtension {
  extensionId: string
  entryPath: string
  module: Record<string, unknown>
}

export interface WorkerOptions {
  /** Injectable port (tests). Defaults to process.parentPort. */
  port?: MessagePortLike
  configDir?: string
  sandboxRootEnv?: string
  /** Dynamic import hook for tests. */
  importFn?: (url: string) => Promise<unknown>
}

export interface CraftCapabilityApi {
  /**
   * Request a scoped capability token from main.
   * Only load-time grants stored in main authorize mint.
   */
  mint(
    permission: string,
    options?: { extensionId?: string; ttlMs?: number; singleUse?: boolean },
  ): Promise<{ token: string; expiresAt: number; permission: string }>
  fetch(
    capabilityToken: string,
    url: string,
    init?: {
      method?: string
      headers?: Record<string, string>
      body?: string
      extensionId?: string
    },
  ): Promise<{ status: number; body: string; headers: Record<string, string> }>
}

declare global {
  // eslint-disable-next-line no-var
  var __craftCapability: CraftCapabilityApi | undefined
}

function getParentPort(): MessagePortLike | null {
  const p = (process as NodeJS.Process & { parentPort?: MessagePortLike }).parentPort
  return p ?? null
}

function send(port: MessagePortLike, msg: WorkerToMainMessage): void {
  port.postMessage(msg)
}

function attachListener(
  port: MessagePortLike,
  handler: (data: unknown) => void,
): void {
  if (typeof port.on === 'function') {
    // Node/Electron EventEmitter / MessagePortMain style: on('message', (msg) => ...)
    port.on('message', (message: unknown) => {
      // Electron MessagePortMain delivers { data }; plain EventEmitter may deliver raw.
      if (
        message &&
        typeof message === 'object' &&
        'data' in message &&
        (message as { data: unknown }).data !== undefined
      ) {
        handler((message as { data: unknown }).data)
      } else {
        handler(message)
      }
    })
    return
  }
  if (typeof port.addEventListener === 'function') {
    port.addEventListener('message', (event: { data: unknown }) => {
      handler(event.data)
    })
  }
}

function resolveCallable(
  mod: Record<string, unknown>,
  method: string,
): ((...args: unknown[]) => unknown) | null {
  const direct = mod[method]
  if (typeof direct === 'function') {
    return direct as (...args: unknown[]) => unknown
  }
  const def = mod.default
  if (def && typeof def === 'object') {
    const nested = (def as Record<string, unknown>)[method]
    if (typeof nested === 'function') {
      return nested as (...args: unknown[]) => unknown
    }
  }
  if (typeof def === 'function' && method === 'default') {
    return def as (...args: unknown[]) => unknown
  }
  return null
}

let brokerSeq = 0
function nextBrokerId(): string {
  brokerSeq += 1
  return `b-${brokerSeq}-${Date.now().toString(36)}`
}

/**
 * Start the worker message loop. Exported for unit tests.
 */
export function startWorker(options: WorkerOptions = {}): {
  dispose: () => void
  loaded: Map<string, LoadedExtension>
} {
  const port = options.port ?? getParentPort()
  if (!port) {
    throw new Error('Extension host worker: no parentPort available')
  }

  const loaded = new Map<string, LoadedExtension>()
  /** Per-async-call identity for capability authorization. */
  const callAls = new AsyncLocalStorage<{ extensionId: string }>()
  const importFn =
    options.importFn ??
    ((url: string) => import(url))

  const roots = () =>
    resolveSandboxRoots({
      configDir: options.configDir ?? process.env.CRAFT_CONFIG_DIR,
      sandboxRootEnv: options.sandboxRootEnv ?? process.env.CRAFT_EXTENSION_SANDBOX_ROOT,
    })

  // Pending broker RPCs: id → resolvers
  const pendingBroker = new Map<
    string,
    {
      resolve: (v: unknown) => void
      reject: (e: Error) => void
    }
  >()

  const rpcToMain = (msg: WorkerToMainMessage & { id: string }): Promise<unknown> => {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    pendingBroker.set(msg.id, {
      resolve,
      reject: (e) => reject(e),
    })
    try {
      send(port, msg)
    } catch (err) {
      pendingBroker.delete(msg.id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    return promise
  }

  // Inject capability surface for loaded modules (never returns raw secrets).
  const craftCapability: CraftCapabilityApi = {
    async mint(permission, opts = {}) {
      // Authorization identity is bound to this async extension call only.
      // Do NOT trust opts.extensionId (peer steal / anonymous forge).
      const extensionId = callAls.getStore()?.extensionId
      if (!extensionId) {
        throw new Error('Capability mint only allowed during extension call')
      }
      void opts.extensionId // deliberately ignored for authorization
      const id = nextBrokerId()
      // Main uses only load-time stored grants for this extensionId.
      const result = await rpcToMain({
        type: 'broker-request',
        id,
        extensionId,
        action: 'mint',
        permission,
        ttlMs: opts.ttlMs,
        singleUse: opts.singleUse,
      })
      return result as { token: string; expiresAt: number; permission: string }
    },
    async fetch(capabilityToken, url, init = {}) {
      // Bind fetch identity the same way; main still validates token↔extension.
      const extensionId = callAls.getStore()?.extensionId ?? '__anonymous__'
      void init.extensionId
      const id = nextBrokerId()
      const result = await rpcToMain({
        type: 'broker-request',
        id,
        extensionId,
        action: 'fetch',
        capabilityToken,
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      })
      return result as {
        status: number
        body: string
        headers: Record<string, string>
      }
    },
  }

  ;(globalThis as typeof globalThis & { __craftCapability?: CraftCapabilityApi }).__craftCapability =
    craftCapability

  const onMessage = async (raw: unknown) => {
    const msg = raw as MainToWorkerMessage
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return

    // Broker responses from main
    if (msg.type === 'broker-ok' || msg.type === 'broker-error') {
      const pending = pendingBroker.get(msg.id)
      if (!pending) return
      pendingBroker.delete(msg.id)
      if (msg.type === 'broker-ok') {
        pending.resolve(msg.result)
      } else {
        pending.reject(new Error(msg.error || 'broker error'))
      }
      return
    }

    try {
      switch (msg.type) {
        case 'ping': {
          send(port, { id: msg.id, type: 'pong' })
          return
        }
        case 'load': {
          const resolved = assertPathAllowlisted(msg.entryPath, roots())
          const url = pathToFileURL(resolved).href
          const mod = (await importFn(url)) as Record<string, unknown>
          loaded.set(msg.extensionId, {
            extensionId: msg.extensionId,
            entryPath: resolved,
            module: mod && typeof mod === 'object' ? mod : { default: mod },
          })
          send(port, { id: msg.id, type: 'ok' })
          return
        }
        case 'list-commands': {
          const ext = loaded.get(msg.extensionId)
          if (!ext) {
            send(port, {
              id: msg.id,
              type: 'error',
              error: `Extension not loaded: ${msg.extensionId}`,
            })
            return
          }
          const raw = ext.module?.commands
          const commands = Array.isArray(raw)
            ? raw
                .filter(
                  (c) =>
                    c &&
                    typeof c === 'object' &&
                    typeof (c as { id?: unknown }).id === 'string' &&
                    typeof (c as { title?: unknown }).title === 'string',
                )
                .map((c) => {
                  const cmd = c as {
                    id: string
                    title: string
                    when?: string
                    defaultHotkey?: string
                    keywords?: string[]
                  }
                  return {
                    id: cmd.id,
                    title: cmd.title,
                    ...(typeof cmd.when === 'string' ? { when: cmd.when } : {}),
                    ...(typeof cmd.defaultHotkey === 'string'
                      ? { defaultHotkey: cmd.defaultHotkey }
                      : {}),
                    ...(Array.isArray(cmd.keywords)
                      ? { keywords: cmd.keywords.filter((k): k is string => typeof k === 'string') }
                      : {}),
                  }
                })
            : []
          send(port, { id: msg.id, type: 'ok', result: { commands } })
          return
        }
        case 'unload': {
          loaded.delete(msg.extensionId)
          send(port, { id: msg.id, type: 'ok' })
          return
        }
        case 'call': {
          // Basic permission presence check: if permissions array is provided
          // empty, reject. Missing permissions is allowed for internal ping-style
          // calls from trusted main (main is the broker). Non-function methods reject.
          if (Array.isArray(msg.permissions) && msg.permissions.length === 0) {
            send(port, {
              id: msg.id,
              type: 'error',
              error: 'Permission check failed: empty permissions',
            })
            return
          }
          const ext = loaded.get(msg.extensionId)
          if (!ext) {
            send(port, {
              id: msg.id,
              type: 'error',
              error: `Extension not loaded: ${msg.extensionId}`,
            })
            return
          }
          const fn = resolveCallable(ext.module, msg.method)
          if (!fn) {
            send(port, {
              id: msg.id,
              type: 'error',
              error: `Method not found or not a function: ${msg.method}`,
            })
            return
          }
          const args = Array.isArray(msg.args) ? msg.args : []
          const result = await callAls.run(
            { extensionId: msg.extensionId },
            () => Promise.resolve(fn.apply(ext.module, args)),
          )
          send(port, { id: msg.id, type: 'ok', result })
          return
        }
        default: {
          const id = (msg as { id?: string }).id
          if (id) {
            send(port, { id, type: 'error', error: 'Unknown message type' })
          }
        }
      }
    } catch (err) {
      const id = (msg as { id?: string }).id
      const error = err instanceof Error ? err.message : String(err)
      if (id) send(port, { id, type: 'error', error })
    }
  }

  attachListener(port, (data) => {
    void onMessage(data)
  })

  send(port, { type: 'ready' })

  return {
    loaded,
    dispose: () => {
      loaded.clear()
      for (const [, p] of pendingBroker) {
        p.reject(new Error('Worker disposed'))
      }
      pendingBroker.clear()
      try {
        delete (globalThis as { __craftCapability?: CraftCapabilityApi }).__craftCapability
      } catch {
        // ignore
      }
    },
  }
}

// Auto-start when executed as utilityProcess entry (not when imported by tests).
const isDirectRun =
  typeof process !== 'undefined' &&
  // utilityProcess sets parentPort; bun test imports the module without it usually.
  Boolean((process as NodeJS.Process & { parentPort?: unknown }).parentPort)

if (isDirectRun) {
  try {
    startWorker()
  } catch (err) {
    // Last-resort stderr — no secrets.
    const message = err instanceof Error ? err.message : String(err)
    try {
      process.stderr?.write?.(`extension-host worker failed: ${message}\n`)
    } catch {
      // ignore
    }
    process.exitCode = 1
  }
}
