import { afterEach, describe, expect, it } from 'bun:test'
import type { SessionFile } from '../../../../shared/types'
import {
  activateWorkspaceEntry,
  collapseWorkspaceDirectory,
  doubleActivateWorkspaceEntry,
  expandWorkspaceDirectory,
  getWorkspaceVisibleTree,
  loadWorkspaceRootFiles,
  openWorkspaceEntry,
  refreshWorkspaceVisibleFiles,
  subscribeToWorkspaceFileChanges,
  type WorkspaceFilesTreeState,
} from '../WorkspaceFilesSection'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    writable: true,
    configurable: true,
  })
})

function mockWorkspaceElectronApi(filesByDirPath: Map<string | undefined, SessionFile[]>) {
  const calls: Array<[string, string | undefined]> = []
  let filesChangedListener: ((workspaceId: string) => void) | undefined
  const api = {
    getWorkspaceFiles: async (workspaceId: string, dirPath?: string) => {
      calls.push([workspaceId, dirPath])
      return filesByDirPath.get(dirPath) ?? []
    },
    onWorkspaceFilesChanged: (callback: (workspaceId: string) => void) => {
      filesChangedListener = callback
      return () => {}
    },
  }

  Object.defineProperty(globalThis, 'window', {
    value: { electronAPI: api },
    writable: true,
    configurable: true,
  })

  return {
    api,
    calls,
    emitFilesChanged: (workspaceId: string) => filesChangedListener?.(workspaceId),
  }
}

describe('WorkspaceFilesSection data loading', () => {
  it('on mount loads the workspace root without a dirPath', async () => {
    const rootFiles: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
      { name: 'README.md', path: '/workspace/README.md', type: 'file', size: 42 },
    ]
    const { calls } = mockWorkspaceElectronApi(new Map([[undefined, rootFiles]]))

    const result = await loadWorkspaceRootFiles('ws-1')

    expect(result.map((file) => file.path)).toEqual(['/workspace/src', '/workspace/README.md'])
    expect(calls).toEqual([['ws-1', undefined]])
  })

  it('expanding an unfetched directory loads that directory and renders its children', async () => {
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map(),
      expandedPaths: new Set(),
    }
    const rootFiles: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
    ]
    const children: SessionFile[] = [
      { name: 'index.ts', path: '/workspace/src/index.ts', type: 'file', size: 10 },
    ]
    const { calls } = mockWorkspaceElectronApi(new Map([['/workspace/src', children]]))

    const next = await expandWorkspaceDirectory(state, 'ws-1', '/workspace/src')

    expect(calls).toEqual([['ws-1', '/workspace/src']])
    expect(getWorkspaceVisibleTree(rootFiles, next).map(({ file, depth }) => [file.path, depth])).toEqual([
      ['/workspace/src', 0],
      ['/workspace/src/index.ts', 1],
    ])
  })

  it('re-expanding a cached directory does not fetch it again', async () => {
    const cachedChildren: SessionFile[] = [
      { name: 'index.ts', path: '/workspace/src/index.ts', type: 'file', size: 10 },
    ]
    const rootFiles: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
    ]
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([['/workspace/src', cachedChildren]]),
      expandedPaths: new Set(),
    }
    const { calls } = mockWorkspaceElectronApi(new Map([['/workspace/src', []]]))

    const next = await expandWorkspaceDirectory(state, 'ws-1', '/workspace/src')

    expect(calls).toEqual([])
    expect(getWorkspaceVisibleTree(rootFiles, next).map(({ file, depth }) => [file.path, depth])).toEqual([
      ['/workspace/src', 0],
      ['/workspace/src/index.ts', 1],
    ])
  })

  it('collapsing then re-expanding a directory hides and restores cached children without another fetch', async () => {
    const cachedChildren: SessionFile[] = [
      { name: 'index.ts', path: '/workspace/src/index.ts', type: 'file', size: 10 },
    ]
    const rootFiles: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
    ]
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([['/workspace/src', cachedChildren]]),
      expandedPaths: new Set(['/workspace/src']),
    }
    const { calls } = mockWorkspaceElectronApi(new Map([['/workspace/src', []]]))

    const collapsed = collapseWorkspaceDirectory(state, '/workspace/src')
    const reExpanded = await expandWorkspaceDirectory(collapsed, 'ws-1', '/workspace/src')

    expect(calls).toEqual([])
    expect(getWorkspaceVisibleTree(rootFiles, collapsed).map(({ file }) => file.path)).toEqual(['/workspace/src'])
    expect(getWorkspaceVisibleTree(rootFiles, reExpanded).map(({ file, depth }) => [file.path, depth])).toEqual([
      ['/workspace/src', 0],
      ['/workspace/src/index.ts', 1],
    ])
  })

  it('supports multiple expanded directories at the same time', async () => {
    const rootFiles: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
      { name: 'tests', path: '/workspace/tests', type: 'directory' },
    ]
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([['/workspace/src', [
        { name: 'index.ts', path: '/workspace/src/index.ts', type: 'file', size: 10 },
      ]]]),
      expandedPaths: new Set(['/workspace/src']),
    }
    mockWorkspaceElectronApi(new Map([['/workspace/tests', [
      { name: 'index.test.ts', path: '/workspace/tests/index.test.ts', type: 'file', size: 12 },
    ]]]))

    const next = await expandWorkspaceDirectory(state, 'ws-1', '/workspace/tests')

    expect(getWorkspaceVisibleTree(rootFiles, next).map(({ file, depth }) => [file.path, depth])).toEqual([
      ['/workspace/src', 0],
      ['/workspace/src/index.ts', 1],
      ['/workspace/tests', 0],
      ['/workspace/tests/index.test.ts', 1],
    ])
  })

  it('builds visible rows for expanded cached directories recursively', () => {
    const rootFiles: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
    ]
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([
        ['/workspace/src', [
          { name: 'components', path: '/workspace/src/components', type: 'directory' },
        ]],
        ['/workspace/src/components', [
          { name: 'Button.tsx', path: '/workspace/src/components/Button.tsx', type: 'file', size: 25 },
        ]],
      ]),
      expandedPaths: new Set(['/workspace/src', '/workspace/src/components']),
    }

    expect(getWorkspaceVisibleTree(rootFiles, state).map(({ file, depth }) => [file.path, depth])).toEqual([
      ['/workspace/src', 0],
      ['/workspace/src/components', 1],
      ['/workspace/src/components/Button.tsx', 2],
    ])
  })

  it('refreshes the root and expanded directories while preserving expanded state', async () => {
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([
        ['/workspace/src', [
          { name: 'old.ts', path: '/workspace/src/old.ts', type: 'file', size: 3 },
        ]],
        ['/workspace/docs', [
          { name: 'cached.md', path: '/workspace/docs/cached.md', type: 'file', size: 6 },
        ]],
      ]),
      expandedPaths: new Set(['/workspace/src']),
    }
    const refreshedRoot: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
      { name: 'README.md', path: '/workspace/README.md', type: 'file', size: 12 },
    ]
    const refreshedSrc: SessionFile[] = [
      { name: 'new.ts', path: '/workspace/src/new.ts', type: 'file', size: 3 },
    ]
    const { calls } = mockWorkspaceElectronApi(new Map([
      [undefined, refreshedRoot],
      ['/workspace/src', refreshedSrc],
    ]))

    const refreshed = await refreshWorkspaceVisibleFiles(state, 'ws-1')

    expect(calls).toEqual([
      ['ws-1', undefined],
      ['ws-1', '/workspace/src'],
    ])
    expect(refreshed.rootFiles.map((file) => file.path)).toEqual(['/workspace/src', '/workspace/README.md'])
    expect(getWorkspaceVisibleTree(refreshed.rootFiles, refreshed.treeState).map(({ file, depth }) => [file.path, depth])).toEqual([
      ['/workspace/src', 0],
      ['/workspace/src/new.ts', 1],
      ['/workspace/README.md', 0],
    ])
  })

  it('refreshes visible files when workspace file changes fire for the active workspace', () => {
    const refreshed: string[] = []
    let listener: ((workspaceId: string) => void) | undefined
    let unsubscribed = false
    const api = {
      onWorkspaceFilesChanged: (callback: (workspaceId: string) => void) => {
        listener = callback
        return () => {
          unsubscribed = true
        }
      },
    }

    const unsubscribe = subscribeToWorkspaceFileChanges('ws-1', () => {
      refreshed.push('ws-1')
    }, api)

    listener?.('ws-2')
    listener?.('ws-1')
    unsubscribe()

    expect(refreshed).toEqual(['ws-1'])
    expect(unsubscribed).toBe(true)
  })
})

describe('WorkspaceFilesSection file interactions', () => {
  it('activates file rows and directory rows with the expected click behavior', () => {
    const opened: string[] = []
    const toggled: string[] = []
    const file: SessionFile = {
      name: 'README.md',
      path: '/workspace/README.md',
      type: 'file',
      size: 42,
    }
    const directory: SessionFile = {
      name: 'src',
      path: '/workspace/src',
      type: 'directory',
    }

    activateWorkspaceEntry(file, {
      onOpenFile: (path) => opened.push(path),
      onToggleDirectory: (entry) => toggled.push(entry.path),
    })
    doubleActivateWorkspaceEntry(file, {
      onOpenFile: (path) => opened.push(path),
    })
    activateWorkspaceEntry(directory, {
      onOpenFile: (path) => opened.push(path),
      onToggleDirectory: (entry) => toggled.push(entry.path),
    })
    doubleActivateWorkspaceEntry(directory, {
      onOpenFile: (path) => opened.push(path),
    })

    expect(opened).toEqual(['/workspace/README.md', '/workspace/README.md'])
    expect(toggled).toEqual(['/workspace/src'])
  })

  it('opens files through the app shell interceptor', () => {
    const opened: string[] = []
    const externallyOpened: string[] = []
    const file: SessionFile = {
      name: 'README.md',
      path: '/workspace/README.md',
      type: 'file',
      size: 42,
    }

    openWorkspaceEntry(file, {
      onOpenFile: (path) => opened.push(path),
      openFile: (path) => externallyOpened.push(path),
    })

    expect(opened).toEqual(['/workspace/README.md'])
    expect(externallyOpened).toEqual([])
  })

  it('opens directories through the platform file manager', () => {
    const opened: string[] = []
    const externallyOpened: string[] = []
    const directory: SessionFile = {
      name: 'src',
      path: '/workspace/src',
      type: 'directory',
    }

    openWorkspaceEntry(directory, {
      onOpenFile: (path) => opened.push(path),
      openFile: (path) => externallyOpened.push(path),
    })

    expect(opened).toEqual([])
    expect(externallyOpened).toEqual(['/workspace/src'])
  })
})
