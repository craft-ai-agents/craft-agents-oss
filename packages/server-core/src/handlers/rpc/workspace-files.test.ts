import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import { cleanupWorkspaceFileWatchForClient, registerWorkspaceFilesHandlers } from './workspace-files'

const tempRoots: string[] = []

function createHarness(workspaceRoot: string) {
  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string, target: unknown, args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, target, ...args) {
      pushes.push({ channel, target, args })
    },
    async invokeClient() {
      return undefined
    },
  }
  const deps = {
    sessionManager: {
      getWorkspaces: () => [{
        id: 'ws-1',
        name: 'Workspace',
        slug: 'workspace',
        rootPath: workspaceRoot,
        createdAt: 0,
      }],
    },
  } as HandlerDeps

  registerWorkspaceFilesHandlers(server, deps)

  const getFiles = handlers.get(RPC_CHANNELS.workspace.GET_FILES)
  if (!getFiles) {
    throw new Error('workspace files handler not registered')
  }

  return { getFiles, handlers, pushes }
}

function ctx(): RequestContext {
  return { clientId: 'client-1', workspaceId: 'ws-1', webContentsId: 1 }
}

function createWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-workspace-files-rpc-'))
  tempRoots.push(root)
  return root
}

function createExternalRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-workspace-files-external-rpc-'))
  tempRoots.push(root)
  return root
}

function waitForFileWatcherReady(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 25))
}

afterEach(() => {
  cleanupWorkspaceFileWatchForClient('client-1')
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('workspace files RPC handlers', () => {
  it('getWorkspaceFiles defaults to the workspace root and returns only immediate children', async () => {
    const root = createWorkspaceRoot()
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'src', 'nested'))
    writeFileSync(join(root, 'README.md'), '# Test\n')
    writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
    const { getFiles } = createHarness(root)

    const files = await getFiles(ctx(), 'ws-1')

    expect(files).toEqual([
      { name: 'src', path: join(root, 'src'), type: 'directory' },
      { name: 'README.md', path: join(root, 'README.md'), type: 'file', size: 7 },
    ])
  })

  it('getWorkspaceFiles excludes hidden and generated entries', async () => {
    const root = createWorkspaceRoot()
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, '.next'))
    mkdirSync(join(root, 'dist'))
    mkdirSync(join(root, 'build'))
    mkdirSync(join(root, 'out'))
    mkdirSync(join(root, '.cache'))
    mkdirSync(join(root, '.turbo'))
    mkdirSync(join(root, 'coverage'))
    mkdirSync(join(root, '.svelte-kit'))
    writeFileSync(join(root, '.env'), 'secret\n')
    writeFileSync(join(root, 'visible.txt'), 'visible\n')
    const { getFiles } = createHarness(root)

    const files = await getFiles(ctx(), 'ws-1')

    expect(files).toEqual([
      { name: 'visible.txt', path: join(root, 'visible.txt'), type: 'file', size: 8 },
    ])
  })

  it('getWorkspaceFiles returns an empty list for an unknown workspace', async () => {
    const root = createWorkspaceRoot()
    writeFileSync(join(root, 'README.md'), '# Test\n')
    const { getFiles } = createHarness(root)

    await expect(getFiles(ctx(), 'missing-workspace')).resolves.toEqual([])
  })

  it('getWorkspaceFiles returns children for the requested directory path', async () => {
    const root = createWorkspaceRoot()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'README.md'), '# Test\n')
    writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
    const { getFiles } = createHarness(root)

    const files = await getFiles(ctx(), 'ws-1', join(root, 'src'))

    expect(files).toEqual([
      { name: 'index.ts', path: join(root, 'src', 'index.ts'), type: 'file', size: 10 },
    ])
  })

  it('getWorkspaceFiles uses rootPath when provided outside the workspace root', async () => {
    const root = createWorkspaceRoot()
    const cwdRoot = createExternalRoot()
    writeFileSync(join(root, 'metadata.json'), '{}\n')
    writeFileSync(join(cwdRoot, 'package.json'), '{}\n')
    const { getFiles } = createHarness(root)

    const files = await getFiles(ctx(), 'ws-1', undefined, cwdRoot)

    expect(files).toEqual([
      { name: 'package.json', path: join(cwdRoot, 'package.json'), type: 'file', size: 3 },
    ])
  })

  it('getWorkspaceFiles constrains requested directories to the provided rootPath', async () => {
    const root = createWorkspaceRoot()
    const cwdRoot = createExternalRoot()
    mkdirSync(join(cwdRoot, 'src'))
    writeFileSync(join(cwdRoot, 'src', 'index.ts'), 'export {}\n')
    writeFileSync(join(root, 'metadata.json'), '{}\n')
    const { getFiles } = createHarness(root)

    await expect(getFiles(ctx(), 'ws-1', join(cwdRoot, 'src'), cwdRoot)).resolves.toEqual([
      { name: 'index.ts', path: join(cwdRoot, 'src', 'index.ts'), type: 'file', size: 10 },
    ])
    await expect(getFiles(ctx(), 'ws-1', root, cwdRoot)).resolves.toEqual([])
  })

  it('getWorkspaceFiles returns [] for unreadable or outside paths', async () => {
    const root = createWorkspaceRoot()
    const { getFiles } = createHarness(root)

    await expect(getFiles(ctx(), 'ws-1', join(root, 'missing'))).resolves.toEqual([])
    await expect(getFiles(ctx(), 'ws-1', tmpdir())).resolves.toEqual([])
  })

  it('getWorkspaceFiles omits children from returned directories', async () => {
    const root = createWorkspaceRoot()
    mkdirSync(join(root, 'src'))
    const { getFiles } = createHarness(root)

    const files = await getFiles(ctx(), 'ws-1')

    expect(files[0]).not.toHaveProperty('children')
  })

  it('watchWorkspaceFiles pushes a debounced change event to the calling client', async () => {
    const root = createWorkspaceRoot()
    const { handlers, pushes } = createHarness(root)
    const watchFiles = handlers.get(RPC_CHANNELS.workspace.WATCH_FILES)
    const unwatchFiles = handlers.get(RPC_CHANNELS.workspace.UNWATCH_FILES)

    if (!watchFiles || !unwatchFiles) {
      throw new Error('workspace file watcher handlers not registered')
    }

    await watchFiles(ctx(), 'ws-1')
    await waitForFileWatcherReady()
    writeFileSync(join(root, 'created.txt'), 'created\n')
    await new Promise(resolve => setTimeout(resolve, 450))

    expect(pushes).toContainEqual({
      channel: RPC_CHANNELS.workspace.FILES_CHANGED,
      target: { to: 'client', clientId: 'client-1' },
      args: ['ws-1'],
    })

    await unwatchFiles(ctx())
  })

  it('watchWorkspaceFiles watches rootPath when provided outside the workspace root', async () => {
    const root = createWorkspaceRoot()
    const cwdRoot = createExternalRoot()
    const { handlers, pushes } = createHarness(root)
    const watchFiles = handlers.get(RPC_CHANNELS.workspace.WATCH_FILES)
    const unwatchFiles = handlers.get(RPC_CHANNELS.workspace.UNWATCH_FILES)

    if (!watchFiles || !unwatchFiles) {
      throw new Error('workspace file watcher handlers not registered')
    }

    await watchFiles(ctx(), 'ws-1', cwdRoot)
    await waitForFileWatcherReady()
    writeFileSync(join(cwdRoot, 'created.txt'), 'created\n')
    await new Promise(resolve => setTimeout(resolve, 450))

    expect(pushes).toContainEqual({
      channel: RPC_CHANNELS.workspace.FILES_CHANGED,
      target: { to: 'client', clientId: 'client-1' },
      args: ['ws-1'],
    })

    await unwatchFiles(ctx())
  })

  it('cleanupWorkspaceFileWatchForClient stops further change notifications', async () => {
    const root = createWorkspaceRoot()
    const { handlers, pushes } = createHarness(root)
    const watchFiles = handlers.get(RPC_CHANNELS.workspace.WATCH_FILES)

    if (!watchFiles) {
      throw new Error('workspace file watcher handler not registered')
    }

    await watchFiles(ctx(), 'ws-1')
    cleanupWorkspaceFileWatchForClient('client-1')
    writeFileSync(join(root, 'after-cleanup.txt'), 'ignored\n')
    await new Promise(resolve => setTimeout(resolve, 450))

    expect(pushes).toEqual([])
  })
})
