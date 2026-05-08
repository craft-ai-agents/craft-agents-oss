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
  resolveCwdRoot,
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
  let unsubscribed = false
  const api = {
    getWorkspaceFiles: async (workspaceId: string, dirPath?: string) => {
      calls.push([workspaceId, dirPath])
      return filesByDirPath.get(dirPath) ?? []
    },
    onWorkspaceFilesChanged: (callback: (workspaceId: string) => void) => {
      filesChangedListener = callback
      return () => {
        unsubscribed = true
      }
    },
  }

  Object.defineProperty(globalThis, 'window', {
    value: { electronAPI: api },
    writable: true,
    configurable: true,
  })

  return {
    calls,
    emitFilesChanged: (workspaceId: string) => filesChangedListener?.(workspaceId),
    wasUnsubscribed: () => unsubscribed,
  }
}

function visibleRows(rootFiles: SessionFile[], state: WorkspaceFilesTreeState) {
  return getWorkspaceVisibleTree(rootFiles, state).map(({ file, depth }) => [file.path, depth])
}

function visiblePaths(rootFiles: SessionFile[], state: WorkspaceFilesTreeState) {
  return getWorkspaceVisibleTree(rootFiles, state).map(({ file }) => file.path)
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
    expect(visibleRows(rootFiles, next)).toEqual([
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
    expect(visibleRows(rootFiles, next)).toEqual([
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
    expect(visiblePaths(rootFiles, collapsed)).toEqual(['/workspace/src'])
    expect(visibleRows(rootFiles, reExpanded)).toEqual([
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

    expect(visibleRows(rootFiles, next)).toEqual([
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

    expect(visibleRows(rootFiles, state)).toEqual([
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
    expect(visibleRows(refreshed.rootFiles, refreshed.treeState)).toEqual([
      ['/workspace/src', 0],
      ['/workspace/src/new.ts', 1],
      ['/workspace/README.md', 0],
    ])
  })

  it('refreshes visible files when workspace file changes fire for the active workspace', () => {
    const refreshed: string[] = []
    const filesChanged = mockWorkspaceElectronApi(new Map())

    const unsubscribe = subscribeToWorkspaceFileChanges('ws-1', () => {
      refreshed.push('ws-1')
    })

    filesChanged.emitFilesChanged('ws-2')
    filesChanged.emitFilesChanged('ws-1')
    unsubscribe()

    expect(refreshed).toEqual(['ws-1'])
    expect(filesChanged.wasUnsubscribed()).toBe(true)
  })
})

describe('resolveCwdRoot', () => {
  it('returns a real working directory inside the workspace', () => {
    expect(resolveCwdRoot('/workspace/src', '/workspace')).toBe('/workspace/src')
  })

  it('returns a Windows-style working directory inside the workspace', () => {
    expect(resolveCwdRoot('C:\\workspace\\src', 'C:\\workspace')).toBe('C:\\workspace\\src')
  })

  it('returns the workspace path when the working directory equals the workspace path', () => {
    expect(resolveCwdRoot('/workspace', '/workspace')).toBe('/workspace')
  })

  it('returns undefined for absent or sentinel working directories', () => {
    expect(resolveCwdRoot(undefined, '/workspace')).toBeUndefined()
    expect(resolveCwdRoot('none', '/workspace')).toBeUndefined()
    expect(resolveCwdRoot('user_default', '/workspace')).toBeUndefined()
  })

  it('returns undefined when the workspace path is absent', () => {
    expect(resolveCwdRoot('/workspace/src', undefined)).toBeUndefined()
  })

  it('returns undefined for a working directory outside the workspace', () => {
    expect(resolveCwdRoot('/other-project/src', '/workspace')).toBeUndefined()
    expect(resolveCwdRoot('/workspace-sibling/src', '/workspace')).toBeUndefined()
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
