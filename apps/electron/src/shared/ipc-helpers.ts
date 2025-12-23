/**
 * IPC Helpers - Utilities for Type-Safe IPC Communication
 *
 * These helpers reduce boilerplate when working with IPC channels.
 * Used in preload and main process to ensure type safety.
 */

import type { IpcChannel, IpcParams, IpcReturn, IpcEventChannel, IpcEventData } from './ipc-schema'

// Re-export schema types for convenience
export type { IpcChannel, IpcParams, IpcReturn, IpcEventChannel, IpcEventData }

/**
 * Type-safe IPC invoke wrapper for preload.
 * Ensures params match the schema definition.
 *
 * Usage in preload:
 *   const invoke = createInvoke(ipcRenderer)
 *   const sessions = await invoke('sessions:get')
 *   const session = await invoke('sessions:create', workspaceId, agentId)
 */
export function createInvoke(ipcRenderer: {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}) {
  return function invoke<K extends IpcChannel>(
    channel: K,
    ...args: IpcParams<K>
  ): Promise<IpcReturn<K>> {
    return ipcRenderer.invoke(channel, ...args) as Promise<IpcReturn<K>>
  }
}

/**
 * Type-safe event listener wrapper for preload.
 * Returns cleanup function for proper resource management.
 *
 * Usage in preload:
 *   const listen = createListener(ipcRenderer)
 *   const cleanup = listen('session:event', (event) => { ... })
 */
export function createListener(ipcRenderer: {
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
}) {
  return function listen<K extends IpcEventChannel>(
    channel: K,
    callback: (data: IpcEventData<K>) => void
  ): () => void {
    const handler = (_event: unknown, ...args: unknown[]) => {
      // For array-typed events (like agent:statusChanged), spread the args
      // For single-value events, pass the first arg
      if (Array.isArray(args) && args.length > 1) {
        callback(args as unknown as IpcEventData<K>)
      } else {
        callback(args[0] as IpcEventData<K>)
      }
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler as (...args: unknown[]) => void)
    }
  }
}

/**
 * Type-safe handler registration for main process.
 * Ensures handler signature matches schema definition.
 *
 * Usage in main:
 *   const handle = createHandler(ipcMain)
 *   handle('sessions:get', async () => sessionManager.getSessions())
 *   handle('sessions:create', async (wsId, agentId) => sessionManager.createSession(wsId, agentId))
 */
export function createHandler(ipcMain: {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown) => void
}) {
  return function handle<K extends IpcChannel>(
    channel: K,
    handler: (
      ...args: IpcParams<K>
    ) => Promise<IpcReturn<K>> | IpcReturn<K>
  ): void {
    ipcMain.handle(channel, async (_event: unknown, ...args: unknown[]) => {
      return handler(...(args as IpcParams<K>))
    })
  }
}

/**
 * Type-safe event sender for main process.
 * Sends events to all windows or specific window.
 *
 * Usage in main:
 *   const send = createSender(webContents)
 *   send('session:event', sessionEvent)
 *   send('agent:statusChanged', workspaceId, agentId, status)
 */
export function createSender(webContents: {
  send: (channel: string, ...args: unknown[]) => void
}) {
  return function send<K extends IpcEventChannel>(
    channel: K,
    ...args: IpcEventData<K> extends unknown[] ? IpcEventData<K> : [IpcEventData<K>]
  ): void {
    webContents.send(channel, ...args)
  }
}
