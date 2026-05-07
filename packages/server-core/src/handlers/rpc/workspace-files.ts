import { readdir, stat } from 'node:fs/promises'
import { watch, type Dirent, type FSWatcher } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { RPC_CHANNELS, type SessionFile } from '@craft-agent/shared/protocol'
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
  workspaceId: string
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const clientWorkspaceWatches = new Map<string, ClientWorkspaceWatchState>()

export function cleanupWorkspaceFileWatchForClient(clientId: string): void {
  const state = clientWorkspaceWatches.get(clientId)
  if (!state) return

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }

  state.watcher.close()
  clientWorkspaceWatches.delete(clientId)
}

function isExcluded(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_NAMES.has(name)
}

function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const rel = relative(workspaceRoot, targetPath)
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

async function listWorkspaceFiles(workspaceRoot: string, dirPath?: string): Promise<SessionFile[]> {
  const root = resolve(workspaceRoot)
  const target = dirPath ? resolve(dirPath) : root
  if (!isInsideWorkspace(root, target)) return []

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
  server.handle(RPC_CHANNELS.workspace.GET_FILES, async (_ctx, workspaceId: string, dirPath?: string) => {
    const workspace = deps.sessionManager.getWorkspaces().find(w => w.id === workspaceId)
    if (!workspace) return []
    return listWorkspaceFiles(workspace.rootPath, dirPath)
  })

  server.handle(RPC_CHANNELS.workspace.WATCH_FILES, async (ctx, workspaceId: string) => {
    const clientId = ctx.clientId
    cleanupWorkspaceFileWatchForClient(clientId)

    const workspace = deps.sessionManager.getWorkspaces().find(w => w.id === workspaceId)
    if (!workspace) return

    try {
      const state: ClientWorkspaceWatchState = {
        watcher: null as unknown as FSWatcher,
        workspaceId,
        debounceTimer: null,
      }

      state.watcher = watch(workspace.rootPath, { recursive: true }, () => {
        if (state.debounceTimer) {
          clearTimeout(state.debounceTimer)
        }

        state.debounceTimer = setTimeout(() => {
          server.push(RPC_CHANNELS.workspace.FILES_CHANGED, { to: 'client', clientId }, state.workspaceId)
        }, 300)
      })

      clientWorkspaceWatches.set(clientId, state)
    } catch (error) {
      deps.platform.logger.error('Failed to start workspace file watcher:', error)
    }
  })

  server.handle(RPC_CHANNELS.workspace.UNWATCH_FILES, async (ctx) => {
    cleanupWorkspaceFileWatchForClient(ctx.clientId)
  })
}
