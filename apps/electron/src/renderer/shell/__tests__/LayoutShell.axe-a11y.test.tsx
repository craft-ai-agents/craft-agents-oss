/**
 * Accessibility integration test — proves the happy-dom → jsdom migration is
 * provably equivalent for a11y detection.
 *
 * Renders the real LayoutShell with the Files rail (SessionFilesSection) under
 * the jsdom-backed setupTestEnvironment, then runs axe-core via vitest-axe and
 * asserts `toHaveNoViolations`. Under happy-dom, axe-core could not run at all
 * (missing DOM APIs); under jsdom it produces a real audit, so a green result
 * here is the migration's a11y-equivalence proof.
 *
 * IMPORTANT: All mock.module() calls MUST appear before any static import
 * that could transitively load the real pdfjs-dist/?url or brand-icon?url
 * modules. We keep only bun:test and jsdom as static imports; everything
 * else is dynamically imported AFTER the mocks register.
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { setupTestEnvironment } from './support/test-env'

// -------------------------------------------------------------------------
// 1. Mocks — MUST register before ANY module that uses them
// -------------------------------------------------------------------------
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('@resources/icon-set/icon-512.png?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({}),
}))

// -------------------------------------------------------------------------
// 2. IPC mock — minimal two-level tree with one dir + one file
// -------------------------------------------------------------------------
const tree: Record<string, { name: string; path: string; type: 'file' | 'directory'; size?: number; isSymlink: boolean }[]> = {
  '/test/wd': [
    { name: 'src', path: '/test/wd/src', type: 'directory', size: 0, isSymlink: false },
    { name: 'README.md', path: '/test/wd/README.md', type: 'file', size: 42, isSymlink: false },
  ],
  '/test/wd/src': [],
}

const { doc, api } = setupTestEnvironment({ tree })

api.listDirectoryFiles = async (dirPath: string) => {
  const entries = tree[dirPath]
  if (!entries) throw new Error(`ENOENT: ${dirPath}`)
  return { entries }
}
api.getGitBranch = async () => 'main'
api.getGitStatus = async () => ({ files: [] })

// -------------------------------------------------------------------------
// 3. Dynamic imports — all modules that could trigger pdfjs-dist loads
//    come AFTER the mocks above.
// -------------------------------------------------------------------------
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { Provider, createStore } = await import('jotai')
const { activeSessionIdAtom } = await import('../../atoms/sessions')
const { TooltipProvider } = await import('@archstudio/ui')
const { axe } = await import('vitest-axe/dist/index.js')

const MockAppShellContext = React.createContext<any>(null)
mock.module('../../context/AppShellContext', () => ({
  AppShellContext: MockAppShellContext,
  useAppShellContext: () => {
    const ctx = React.useContext(MockAppShellContext)
    if (!ctx) throw new Error('useAppShellContext must be used within an AppShellProvider')
    return ctx
  },
  useOptionalAppShellContext: () => React.useContext(MockAppShellContext),
  useSession: () => null,
  useActiveWorkspace: () => null,
  usePendingPermission: () => undefined,
  usePendingCredential: () => undefined,
  useSessionOptionsFor: () => ({
    options: undefined as unknown as Record<string, never>,
    setOption: () => {},
    setOptions: () => {},
    setPermissionMode: () => {},
    isSafeModeActive: () => false,
  }),
  AppShellProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const { default: LayoutShell } = await import('../LayoutShell')

// -------------------------------------------------------------------------
// 4. Helpers
// -------------------------------------------------------------------------
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const SESSION = {
  sessionName: 'Axe A11y Test',
  connectionLabel: 'test-model',
  permissionModeLabel: 'Safe',
  thinkingLabel: 'Medium',
  sourceNames: [],
  workingDirectory: '/test/wd',
}

async function renderShell() {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()
  store.set(activeSessionIdAtom, 'test-session')

  await act(async () => {
    ;(root as any).render(
      React.createElement(
        Provider as any,
        { store },
        React.createElement(
          TooltipProvider as any,
          { delayDuration: 0, skipDelayDuration: 0 },
          React.createElement(
            LayoutShell,
            { initialRailTab: 'files', sessionContext: SESSION },
            React.createElement('div', null, 'chat'),
          ),
        ),
      ),
    )
  })

  // Let fetchDirectory resolve for the initial root listing.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
    await flush()
    await flush()
  })

  return { container, root }
}

// -------------------------------------------------------------------------
// 5. Tests
// -------------------------------------------------------------------------
describe('LayoutShell Files rail accessibility (jsdom + axe-core)', () => {
  let lastContainer: HTMLElement | null = null
  let lastRoot: { unmount: () => void } | null = null

  afterEach(() => {
    if (lastRoot) {
      lastRoot.unmount()
      lastRoot = null
    }
    if (lastContainer && lastContainer.parentNode) {
      lastContainer.parentNode.removeChild(lastContainer)
      lastContainer = null
    }
    while (doc.body.firstChild) {
      doc.body.removeChild(doc.body.firstChild)
    }
  })

  it('SessionFilesSection renders with no axe violations', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root

    // The files rail renders the directory tree (dir + file rows).
    expect(container.querySelectorAll('.wd-files-item').length).toBeGreaterThan(0)

    // The axe helper audits against the jsdom document. Await before the
    // matcher — vitest-axe's axe() is promise-returning.
    const results = await axe(container as unknown as Element)
    expect(results).toHaveNoViolations()
  })
})
