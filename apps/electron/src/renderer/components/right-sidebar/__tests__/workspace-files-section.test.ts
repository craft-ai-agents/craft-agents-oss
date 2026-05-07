import { describe, expect, it } from 'bun:test'
import type { SessionFile } from '../../../../shared/types'
import {
  collapseWorkspaceDirectory,
  expandWorkspaceDirectory,
  getWorkspaceVisibleTree,
  loadWorkspaceRootFiles,
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
