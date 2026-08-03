/**
 * Shared test setup for LayoutShell integration tests.
 *
 * Provides a happy-dom window, the DOM globals that React + happy-dom expect,
 * and a fully-typed `window.electronAPI` mock that covers every method
 * `LayoutShell.tsx` (or any of its descendants) calls. Tests can override
 * individual methods on the returned `api` object to inject fixtures.
 *
 * Usage:
 *   import { setupTestEnvironment, type TestApi } from './support/test-env'
 *
 *   const { win, doc, api, tree } = setupTestEnvironment({ tree: { '/': [...] } })
 *   // then dynamically import LayoutShell
 */

import { Window } from 'happy-dom'

type DirectoryEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  isSymlink: boolean
}

type DirectoryTree = Record<string, DirectoryEntry[]>

export type TestApi = {
  listDirectoryFiles: (path: string) => Promise<{ entries: DirectoryEntry[] }>
  getGitBranch: (path: string) => Promise<string>
  getGitStatus: (path: string) => Promise<{ files: unknown[] }>
  getGitUserName: () => Promise<string>
  getFileGitDiff: () => Promise<{ diff: string }>
  getServerStatus: () => Promise<{ running: boolean; url?: string }>
  getRuntimeEnvironment: () => string
  openFile: (path: string) => Promise<void>
  openFileDialog: () => Promise<string[]>
  sessionCommand: (...args: unknown[]) => Promise<unknown>
  showInFolder: (path: string) => Promise<void>
  watchSessionFiles: () => Promise<void>
  unwatchSessionFiles: () => Promise<void>
  onSessionFilesChanged: (cb: () => void) => () => void
  writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  [key: string]: unknown
}

type SetupOptions = {
  tree?: DirectoryTree
  branch?: string | null
  initialGitFiles?: unknown[]
}

export function setupTestEnvironment(options: SetupOptions = {}): {
  win: Window
  doc: Window['document']
  api: TestApi
  tree: DirectoryTree
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  const win = new Window({ url: 'http://localhost:5173', height: 900, width: 1400 })
  const doc = win.document

  const gs = globalThis as Record<string, unknown>
  gs.window = win
  gs.document = doc
  gs.HTMLElement = win.HTMLElement
  gs.Element = win.Element
  gs.Node = win.Node
  gs.getComputedStyle = win.getComputedStyle.bind(win)
  gs.navigator = win.navigator
  gs.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)
  gs.cancelAnimationFrame = (id: number) => clearTimeout(id)

  if (!gs.ResizeObserver) {
    class MockResizeObserver {
      private cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe(target: Element) {
        this.cb(
          [
            {
              contentRect: { width: 1400, height: 900 },
              target,
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    }
    gs.ResizeObserver = MockResizeObserver
  }

  if (!gs.IntersectionObserver) {
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
    gs.IntersectionObserver = MockIntersectionObserver
  }

  if (!gs.customElements) {
    gs.customElements = {
      define: () => {},
      get: () => undefined,
      whenDefined: () => Promise.resolve(),
      upgrade: () => {},
    }
  }

  const tree: DirectoryTree = options.tree ?? {}
  const branch = options.branch ?? 'main'
  const initialGitFiles = options.initialGitFiles ?? []

  const api: TestApi = {
    listDirectoryFiles: async (dirPath: string) => {
      const entries = tree[dirPath]
      if (!entries) throw new Error(`ENOENT: ${dirPath}`)
      return { entries }
    },
    getGitBranch: async () => branch ?? 'main',
    getGitStatus: async () => ({ files: initialGitFiles }),
    getGitUserName: async () => 'Test User',
    getFileGitDiff: async () => ({ diff: '' }),
    getServerStatus: async () => ({ running: false }),
    getRuntimeEnvironment: () => 'electron',
    openFile: async () => undefined,
    openFileDialog: async () => [],
    sessionCommand: async () => ({ success: true }),
    showInFolder: async () => undefined,
    watchSessionFiles: async () => undefined,
    unwatchSessionFiles: async () => undefined,
    onSessionFilesChanged: () => () => undefined,
    writeFile: async () => ({ success: true }),
  }

  ;(win as unknown as { electronAPI: TestApi }).electronAPI = api

  return { win, doc, api, tree }
}
