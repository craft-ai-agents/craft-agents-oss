import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createStore } from 'jotai'
import {
  editorTabsAtom,
  activeTabIdAtom,
  hasOpenTabsAtom,
  openFileTabAtom,
  openWorkingTreeDiffTabAtom,
  openCommitTabAtom,
  closeTabAtom,
  type EditorTab,
} from '../editor-tabs'

function makeStore() {
  return createStore()
}

function seedTabs(store: ReturnType<typeof createStore>, tabs: EditorTab[]) {
  store.set(editorTabsAtom, tabs)
  if (tabs.length > 0) store.set(activeTabIdAtom, tabs[0].id)
}

describe('editor-tabs atoms', () => {
  const originalWindow = globalThis.window
  let gitFileDiffCalls = 0
  let gitCommitDetailCalls = 0

  beforeEach(() => {
    gitFileDiffCalls = 0
    gitCommitDetailCalls = 0
    // Minimal window.electronAPI shim for openFileTabAtom
    Object.defineProperty(globalThis, 'window', {
      value: {
        electronAPI: {
          readFile: async (path: string) => `content of ${path}`,
          getGitFileDiff: async (_workspacePath: string, filePath: string) => {
            gitFileDiffCalls += 1
            return `diff for ${filePath}`
          },
          getGitCommitDetail: async (_workspacePath: string, hash: string) => {
            gitCommitDetailCalls += 1
            return {
              hash,
              shortHash: hash.slice(0, 7),
              message: 'Add editor diff tabs',
              author: 'Sherlock',
              date: '2026-05-06T00:00:00.000Z',
              filesChanged: [
                {
                  path: 'src/index.ts',
                  additions: 3,
                  deletions: 1,
                  status: 'modified',
                  diff: 'diff --git a/src/index.ts b/src/index.ts',
                },
              ],
            }
          },
        },
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    })
  })

  it('starts with empty tabs list', () => {
    const store = makeStore()
    expect(store.get(editorTabsAtom)).toEqual([])
  })

  it('hasOpenTabs is false for empty list', () => {
    const store = makeStore()
    expect(store.get(hasOpenTabsAtom)).toBe(false)
  })

  it('hasOpenTabs is true when tabs exist', () => {
    const store = makeStore()
    seedTabs(store, [{ id: 't1', type: 'file', filePath: '/foo.ts', content: 'x' }])
    expect(store.get(hasOpenTabsAtom)).toBe(true)
  })

  it('opening a new path adds a tab', async () => {
    const store = makeStore()
    await store.set(openFileTabAtom, '/src/index.ts')
    const tabs = store.get(editorTabsAtom)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toEqual(expect.objectContaining({
      type: 'file',
      filePath: '/src/index.ts',
      content: 'content of /src/index.ts',
    }))
  })

  it('opening a new path sets it as active', async () => {
    const store = makeStore()
    await store.set(openFileTabAtom, '/src/index.ts')
    const tabs = store.get(editorTabsAtom)
    expect(store.get(activeTabIdAtom)).toBe(tabs[0].id)
  })

  it('opening a working-tree diff fetches the patch and focuses the tab', async () => {
    const store = makeStore()
    await store.set(openWorkingTreeDiffTabAtom, {
      workspacePath: '/repo',
      filePath: 'src/index.ts',
    })

    const tabs = store.get(editorTabsAtom)
    expect(tabs).toEqual([
      expect.objectContaining({
        type: 'git-diff',
        filePath: 'src/index.ts',
        patch: 'diff for src/index.ts',
      }),
    ])
    expect(store.get(activeTabIdAtom)).toBe(tabs[0].id)
  })

  it('opening a duplicate working-tree diff focuses the existing tab without refetching', async () => {
    const store = makeStore()
    await store.set(openWorkingTreeDiffTabAtom, {
      workspacePath: '/repo',
      filePath: 'src/index.ts',
    })
    const firstId = store.get(activeTabIdAtom)
    await store.set(openFileTabAtom, '/src/other.ts')

    await store.set(openWorkingTreeDiffTabAtom, {
      workspacePath: '/repo',
      filePath: 'src/index.ts',
    })

    expect(store.get(editorTabsAtom)).toHaveLength(2)
    expect(store.get(activeTabIdAtom)).toBe(firstId)
    expect(gitFileDiffCalls).toBe(1)
  })

  it('opening a commit tab fetches commit detail and focuses the tab', async () => {
    const store = makeStore()
    await store.set(openCommitTabAtom, {
      workspacePath: '/repo',
      hash: 'abcdef1234567890',
    })

    const tabs = store.get(editorTabsAtom)
    expect(tabs).toEqual([
      expect.objectContaining({
        type: 'git-commit',
        hash: 'abcdef1234567890',
        commit: expect.objectContaining({
          message: 'Add editor diff tabs',
          filesChanged: [
            expect.objectContaining({
              path: 'src/index.ts',
              additions: 3,
              deletions: 1,
              diff: 'diff --git a/src/index.ts b/src/index.ts',
            }),
          ],
        }),
      }),
    ])
    expect(store.get(activeTabIdAtom)).toBe(tabs[0].id)
    expect(gitCommitDetailCalls).toBe(1)
  })

  it('opening a duplicate commit tab focuses the existing tab without refetching', async () => {
    const store = makeStore()
    await store.set(openCommitTabAtom, {
      workspacePath: '/repo',
      hash: 'abcdef1234567890',
    })
    const firstId = store.get(activeTabIdAtom)
    await store.set(openFileTabAtom, '/src/other.ts')

    await store.set(openCommitTabAtom, {
      workspacePath: '/repo',
      hash: 'abcdef1234567890',
    })

    expect(store.get(editorTabsAtom)).toHaveLength(2)
    expect(store.get(activeTabIdAtom)).toBe(firstId)
    expect(gitCommitDetailCalls).toBe(1)
  })

  it('opening a duplicate path focuses the existing tab without duplicating', async () => {
    const store = makeStore()
    await store.set(openFileTabAtom, '/src/index.ts')
    const firstId = store.get(activeTabIdAtom)
    // Open a second different file so active changes
    await store.set(openFileTabAtom, '/src/other.ts')
    expect(store.get(editorTabsAtom)).toHaveLength(2)
    // Re-open the first path
    await store.set(openFileTabAtom, '/src/index.ts')
    expect(store.get(editorTabsAtom)).toHaveLength(2)
    expect(store.get(activeTabIdAtom)).toBe(firstId)
  })

  it('closing the last tab results in an empty list', () => {
    const store = makeStore()
    seedTabs(store, [{ id: 't1', type: 'file', filePath: '/foo.ts', content: 'x' }])
    store.set(closeTabAtom, 't1')
    expect(store.get(editorTabsAtom)).toEqual([])
  })

  it('closing the last tab sets activeTabId to null', () => {
    const store = makeStore()
    seedTabs(store, [{ id: 't1', type: 'file', filePath: '/foo.ts', content: 'x' }])
    store.set(closeTabAtom, 't1')
    expect(store.get(activeTabIdAtom)).toBeNull()
  })

  it('closing active tab focuses the next tab', () => {
    const store = makeStore()
    seedTabs(store, [
      { id: 't1', type: 'file', filePath: '/a.ts', content: 'a' },
      { id: 't2', type: 'file', filePath: '/b.ts', content: 'b' },
    ])
    store.set(closeTabAtom, 't1')
    expect(store.get(editorTabsAtom)).toHaveLength(1)
    expect(store.get(activeTabIdAtom)).toBe('t2')
  })

  it('closing active last tab focuses the previous tab', () => {
    const store = makeStore()
    seedTabs(store, [
      { id: 't1', type: 'file', filePath: '/a.ts', content: 'a' },
      { id: 't2', type: 'file', filePath: '/b.ts', content: 'b' },
    ])
    store.set(activeTabIdAtom, 't2')
    store.set(closeTabAtom, 't2')
    expect(store.get(activeTabIdAtom)).toBe('t1')
  })

  it('closing non-active tab does not change active tab', () => {
    const store = makeStore()
    seedTabs(store, [
      { id: 't1', type: 'file', filePath: '/a.ts', content: 'a' },
      { id: 't2', type: 'file', filePath: '/b.ts', content: 'b' },
    ])
    store.set(activeTabIdAtom, 't2')
    store.set(closeTabAtom, 't1')
    expect(store.get(activeTabIdAtom)).toBe('t2')
    expect(store.get(editorTabsAtom)).toHaveLength(1)
  })
})
