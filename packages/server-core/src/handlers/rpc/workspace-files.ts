import { readdir, stat } from 'node:fs/promises'
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
] as const

function isExcluded(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_NAMES.has(name)
}

function isInsideWorkspace(workspaceRoot: string, dirPath: string): boolean {
  const rel = relative(workspaceRoot, dirPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function listWorkspaceFiles(workspaceRoot: string, dirPath?: string): Promise<SessionFile[]> {
  const root = resolve(workspaceRoot)
  const target = dirPath ? resolve(dirPath) : root
  if (!isInsideWorkspace(root, target)) return []

  try {
    const entries = await readdir(target, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter(entry => !isExcluded(entry.name))
      .map(async (entry): Promise<SessionFile> => {
        const fullPath = join(target, entry.name)
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
      }))

    return files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
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
}
