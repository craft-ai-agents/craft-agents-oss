import { readdir, stat } from 'node:fs/promises'
import { watch, type Dirent, type FSWatcher } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { RPC_CHANNELS, type SessionFile } from '@craft-agent/shared/protocol'
import { pushTyped } from '../../transport'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const EXCLUDED_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  '.cache',
  '.turbo',
  'coverage',
  '.svelte-kit',
])

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workspace.GET_FILES,
  RPC_CHANNELS.workspace.WATCH_FILES,
  RPC_CHANNELS.workspace.UNWATCH_FILES,
] as const

interface ClientWorkspaceWatchState {
  watcher: FSWatcher
  clearDebounce: () => void
}

const clientWorkspaceWatches = new Map<string, ClientWorkspaceWatchState>()
const WORKSPACE_FILE_CHANGE_DEBOUNCE_MS = 300

/**
 * Clean up workspace file watcher for a client.
 * Called from disconnect hooks to prevent watcher leaks.
 */
export function cleanupWorkspaceFileWatchForClient(clientId: string): void {
  const state = clientWorkspaceWatches.get(clientId)
  if (!state) return

  state.clearDebounce()
  state.watcher.close()
  clientWorkspaceWatches.delete(clientId)
}

function createWorkspaceFileWatchState(
  server: RpcServer,
  clientId: string,
  workspaceId: string,
  rootPath: string,
): ClientWorkspaceWatchState {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const clearDebounce = () => {
    if (!debounceTimer) return
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  const watcher = watch(rootPath, { recursive: true }, () => {
    clearDebounce()

    debounceTimer = setTimeout(() => {
      pushTyped(server, RPC_CHANNELS.workspace.FILES_CHANGED, { to: 'client', clientId }, workspaceId)
    }, WORKSPACE_FILE_CHANGE_DEBOUNCE_MS)
  })

  return {
    watcher,
    clearDebounce,
  }
}

function isExcluded(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_NAMES.has(name)
}

function isInsideRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function toSessionFile(parentPath: string, entry: Dirent): Promise<SessionFile> {
  const fullPath = join(parentPath, entry.name)
  if (entry.isDirectory()) {
    return {
      name: entry.name,
      path: fullPath,
      type: 'directory',
    }
  }

  const stats = await stat(fullPath)
  return {
    name: entry.name,
    path: fullPath,
    type: 'file',
    size: stats.size,
  }
}

function compareSessionFiles(a: SessionFile, b: SessionFile): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name)
}

async function listWorkspaceFiles(rootPath: string, dirPath?: string): Promise<SessionFile[]> {
  const resolvedRoot = resolve(rootPath)
  const target = dirPath ? resolve(dirPath) : resolvedRoot
  if (!isInsideRoot(resolvedRoot, target)) return []

  try {
    const entries = await readdir(target, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter(entry => !isExcluded(entry.name))
      .map(entry => toSessionFile(target, entry)))

    return files.sort(compareSessionFiles)
  } catch {
    return []
  }
}

export function registerWorkspaceFilesHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.workspace.GET_FILES, async (
    _ctx,
    workspaceId: string,
    dirPath?: string,
    rootPath?: string,
  ) => {
    const workspace = deps.sessionManager.getWorkspaces().find(w => w.id === workspaceId)
    if (!workspace) return []
    return listWorkspaceFiles(rootPath ?? workspace.rootPath, dirPath)
  })

  server.handle(RPC_CHANNELS.workspace.WATCH_FILES, async (ctx, workspaceId: string, rootPath?: string) => {
    const clientId = ctx.clientId
    cleanupWorkspaceFileWatchForClient(clientId)

    const workspace = deps.sessionManager.getWorkspaces().find(w => w.id === workspaceId)
    if (!workspace) return

    try {
      clientWorkspaceWatches.set(
        clientId,
        createWorkspaceFileWatchState(server, clientId, workspaceId, rootPath ?? workspace.rootPath),
      )
    } catch (error) {
      deps.platform.logger.error('Failed to start workspace file watcher:', error)
    }
  })

  server.handle(RPC_CHANNELS.workspace.UNWATCH_FILES, async (ctx) => {
    cleanupWorkspaceFileWatchForClient(ctx.clientId)
  })
}
