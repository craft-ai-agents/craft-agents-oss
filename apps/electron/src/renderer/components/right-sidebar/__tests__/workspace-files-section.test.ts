import { describe, expect, it } from 'bun:test'
import type { SessionFile } from '../../../../shared/types'
import {
  activateWorkspaceEntry,
  collapseWorkspaceDirectory,
  doubleActivateWorkspaceEntry,
  expandWorkspaceDirectory,
  getWorkspaceEntryContextMenuActions,
  getWorkspaceVisibleTree,
  loadWorkspaceRootFiles,
  openWorkspaceEntry,
  type WorkspaceFilesTreeState,
} from '../WorkspaceFilesSection'

describe('WorkspaceFilesSection data loading', () => {
  it('loads the workspace root without a dirPath', async () => {
    const files: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
      { name: 'README.md', path: '/workspace/README.md', type: 'file', size: 42 },
    ]
    const calls: Array<[string, string | undefined]> = []

    const result = await loadWorkspaceRootFiles('ws-1', async (workspaceId, dirPath) => {
      calls.push([workspaceId, dirPath])
      return files
    })

    expect(result).toEqual(files)
    expect(calls).toEqual([['ws-1', undefined]])
  })

  it('expanding an unfetched directory loads its children and caches them', async () => {
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map(),
      expandedPaths: new Set(),
    }
    const children: SessionFile[] = [
      { name: 'index.ts', path: '/workspace/src/index.ts', type: 'file', size: 10 },
    ]
    const calls: Array<[string, string | undefined]> = []

    const next = await expandWorkspaceDirectory(state, 'ws-1', '/workspace/src', async (workspaceId, dirPath) => {
      calls.push([workspaceId, dirPath])
      return children
    })

    expect(calls).toEqual([['ws-1', '/workspace/src']])
    expect(next.childrenByDirPath.get('/workspace/src')).toEqual(children)
    expect(next.expandedPaths.has('/workspace/src')).toBe(true)
  })

  it('collapsing a directory hides it without clearing cached children', () => {
    const cachedChildren: SessionFile[] = [
      { name: 'index.ts', path: '/workspace/src/index.ts', type: 'file', size: 10 },
    ]
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([['/workspace/src', cachedChildren]]),
      expandedPaths: new Set(['/workspace/src']),
    }

    const next = collapseWorkspaceDirectory(state, '/workspace/src')

    expect(next.expandedPaths.has('/workspace/src')).toBe(false)
    expect(next.childrenByDirPath.get('/workspace/src')).toEqual(cachedChildren)
  })

  it('re-expanding a cached directory does not fetch it again', async () => {
    const cachedChildren: SessionFile[] = [
      { name: 'index.ts', path: '/workspace/src/index.ts', type: 'file', size: 10 },
    ]
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([['/workspace/src', cachedChildren]]),
      expandedPaths: new Set(),
    }
    const calls: Array<[string, string | undefined]> = []

    const next = await expandWorkspaceDirectory(state, 'ws-1', '/workspace/src', async (workspaceId, dirPath) => {
      calls.push([workspaceId, dirPath])
      return []
    })

    expect(calls).toEqual([])
    expect(next.childrenByDirPath.get('/workspace/src')).toEqual(cachedChildren)
    expect(next.expandedPaths.has('/workspace/src')).toBe(true)
  })

  it('supports multiple expanded directories at the same time', async () => {
    const state: WorkspaceFilesTreeState = {
      childrenByDirPath: new Map([['/workspace/src', []]]),
      expandedPaths: new Set(['/workspace/src']),
    }

    const next = await expandWorkspaceDirectory(state, 'ws-1', '/workspace/tests', async () => [])

    expect(next.expandedPaths.has('/workspace/src')).toBe(true)
    expect(next.expandedPaths.has('/workspace/tests')).toBe(true)
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

  it('builds context menu actions for opening and revealing entries', () => {
    const opened: string[] = []
    const externallyOpened: string[] = []
    const revealed: string[] = []
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

    const fileActions = getWorkspaceEntryContextMenuActions(file, 'Finder', {
      onOpenFile: (path) => opened.push(path),
      openFile: (path) => externallyOpened.push(path),
      showInFolder: (path) => revealed.push(path),
    })
    const directoryActions = getWorkspaceEntryContextMenuActions(directory, 'Finder', {
      onOpenFile: (path) => opened.push(path),
      openFile: (path) => externallyOpened.push(path),
      showInFolder: (path) => revealed.push(path),
    })

    expect(fileActions.map((action) => action.label)).toEqual(['Open', 'Show in Finder'])
    expect(directoryActions.map((action) => action.label)).toEqual(['Open', 'Show in Finder'])

    fileActions[0].select()
    directoryActions[0].select()
    fileActions[1].select()
    directoryActions[1].select()

    expect(opened).toEqual(['/workspace/README.md'])
    expect(externallyOpened).toEqual(['/workspace/src'])
    expect(revealed).toEqual(['/workspace/README.md', '/workspace/src'])
  })
})
