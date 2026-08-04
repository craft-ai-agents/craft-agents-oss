/**
 * Integration test for the DEPTH term of the count-cap trim ordering.
 *
 * Sibling to LayoutShell.count-cap-bfs.test.tsx, which uses a deliberately
 * flat fixture (every dir at depth 1) and therefore only exercises
 * `trimExpandedByCount`'s alphabetic tiebreaker.  This file supplies the
 * two-level fixture that the depth key actually needs: with a constant
 * depth you could delete `a.depth - b.depth` from the comparator
 * (packages/ui/src/lib/treeBfsGate.ts) and every assertion over there
 * would still pass.
 *
 * The contract under test: when the open-dir count cap fires, it sheds the
 * DEEPEST directories first and preserves the shallow ones — so a user who
 * expands too far loses leaf directories, never their top-level folders.
 *
 * Uses happy-dom + createRoot + act() for a full client render.
 *
 * IMPORTANT: All mock.module() calls MUST appear before any static import
 * that could transitively load the real pdfjs-dist/?url or brand-icon?url
 * modules.  We keep only bun:test and happy-dom as static imports;
 * everything else is dynamically imported AFTER the mocks register.
 *
 * Fixture design (62 dirs across two depths):
 *
 *   /test/wd
 *     ├── A                  (depth 1)
 *     │     ├── A-child-00   (depth 2, empty)
 *     │     ├── ...
 *     │     └── A-child-29   (depth 2, empty)
 *     └── B                  (depth 1)
 *           ├── B-child-00   (depth 2, empty)
 *           ├── ...
 *           └── B-child-29   (depth 2, empty)
 *
 * WHY expandDepth=3 AND NOT THE DEFAULT 2: the depth-cap invariant
 * (LayoutShell.tsx, the `computeDepthFromRoot(...) >= expandDepth` effect)
 * strips any expanded path at or beyond the cap.  At depth 2 the 60
 * children would be evicted by that invariant BEFORE the count cap ever
 * ran, so the count cap would see only {A, B} and never fire.  Selecting
 * depth 3 puts both levels strictly inside the cap (1 < 3 and 2 < 3),
 * which is what lets the count cap arbitrate between them.
 *
 * Expected trim: 62 dirs > MAX_OPEN_DIRS=50, so 12 are shed.
 * `trimExpandedByCount` sorts depth-ascending with a path tiebreaker and
 * keeps the first 50:
 *   keep  = A, B (depth 1) + A-child-00..29 + B-child-00..17  = 2 + 48
 *   drop  = B-child-18..29                                    = 12
 * Both depth-1 parents survive; every dropped entry is at depth 2.
 * Invert the comparator to `b.depth - a.depth` and this test goes red.
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
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
// 2. IPC mock — deterministic two-level, 62-dir tree
// -------------------------------------------------------------------------
const listDirectoryCalls: string[] = []

type Entry = { name: string; path: string; type: 'file' | 'directory'; size?: number; isSymlink: boolean }

const PARENTS = ['A', 'B'] as const
const CHILDREN_PER_PARENT = 30

function dirEntry(name: string, path: string): Entry {
  return { name, path, type: 'directory', size: 0, isSymlink: false }
}

function buildTree(): Record<string, Entry[]> {
  const tree: Record<string, Entry[]> = { '/test/wd': [] }

  for (const parent of PARENTS) {
    const parentPath = `/test/wd/${parent}`
    tree['/test/wd'].push(dirEntry(parent, parentPath))
    tree[parentPath] = []

    for (let i = 0; i < CHILDREN_PER_PARENT; i++) {
      const childName = `${parent}-child-${String(i).padStart(2, '0')}`
      const childPath = `${parentPath}/${childName}`
      tree[parentPath].push(dirEntry(childName, childPath))
      tree[childPath] = []
    }
  }

  return tree
}

const tree = buildTree()

const { doc, api } = setupTestEnvironment({ tree })

const listDirectoryFiles = mock(async (dirPath: string) => {
  listDirectoryCalls.push(dirPath)
  const entries = tree[dirPath]
  if (!entries) throw new Error(`ENOENT: ${dirPath}`)
  return { entries }
})

const getGitBranch = mock(async () => 'main')
const getGitStatus = mock(async () => ({ files: [] }))

api.listDirectoryFiles = listDirectoryFiles
api.getGitBranch = getGitBranch
api.getGitStatus = getGitStatus

// -------------------------------------------------------------------------
// 3. Dynamic imports — ALL modules that could trigger pdfjs-dist loads
//    come AFTER the mocks above.
// -------------------------------------------------------------------------
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { Provider, createStore } = await import('jotai')
const { activeSessionIdAtom } = await import('../../atoms/sessions')
const { TooltipProvider } = await import('@archstudio/ui')

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
  sessionName: 'Count-Cap Depth-Order Test',
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
    (root as any).render(
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

  await act(async () => {
    await new Promise(r => setTimeout(r, 50))
    await flush()
    await flush()
  })

  return { container, root, store }
}

function findCountCapChip(container: HTMLElement): Element | null {
  const candidates = container.querySelectorAll('.wd-files-capped-badge')
  for (const c of Array.from(candidates)) {
    if (c.textContent?.includes('open limit')) return c
  }
  return null
}

function getRowName(btn: Element): string {
  const nameEl = btn.querySelector('.wd-files-item__name')
  return (nameEl?.textContent ?? btn.textContent ?? '').trim()
}

/**
 * Drive the depth selector.  The popover trigger and its options are
 * matched on stable hooks (`.wd-depth-popover__trigger` and the
 * `data-depth-value` attribute) rather than on rendered label text, so a
 * copy change to the menu doesn't silently turn this into a no-op.
 */
async function pickDepth(container: HTMLElement, value: number): Promise<void> {
  const trigger = container.querySelector('.wd-depth-popover__trigger') as HTMLElement | null
  if (!trigger) throw new Error('depth popover trigger not found')
  await act(async () => {
    trigger.click()
    await flush()
  })

  const option = container.querySelector(
    `.wd-depth-popover__item[data-depth-value="${value}"]`,
  ) as HTMLElement | null
  if (!option) throw new Error(`depth option ${value} not found`)
  await act(async () => {
    option.click()
    await flush()
  })
}

// -------------------------------------------------------------------------
// 5. Test
// -------------------------------------------------------------------------
describe('LayoutShell count-cap trim sheds the deepest dirs first', () => {
  let lastContainer: HTMLElement | null = null
  let lastRoot: { unmount: () => void } | null = null

  beforeEach(() => {
    listDirectoryCalls.length = 0
    listDirectoryFiles.mockClear()
    getGitBranch.mockClear()
    getGitStatus.mockClear()
    while (doc.body.firstChild) {
      doc.body.removeChild(doc.body.firstChild)
    }
  })

  afterEach(() => {
    if (lastRoot) {
      lastRoot.unmount()
      lastRoot = null
    }
    if (lastContainer && lastContainer.parentNode) {
      lastContainer.parentNode.removeChild(lastContainer)
      lastContainer = null
    }
  })

  it('keeps both depth-1 parents and drops only depth-2 children', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    expect(listDirectoryCalls).toContain('/test/wd')

    // Growing the depth runs a BFS union internally (handleDepthPick's
    // GROW branch), so this single interaction both raises the cap and
    // performs the expansion — no separate "Expand all" click needed.
    await pickDepth(container, 3)

    // runDepthBFS is fire-and-forget, so poll the post-trim artifact (the
    // chip) rather than guessing a fixed timeout.
    let chip: Element | null = null
    for (let attempt = 0; attempt < 80; attempt++) {
      await act(async () => { await flush() })
      chip = findCountCapChip(container)
      if (chip) break
    }

    // 1. The count cap fired: 62 discovered > 50 limit.
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toContain('50 open limit')

    const openBtns = Array.from(
      container.querySelectorAll('.wd-files-item[aria-expanded="true"]'),
    ) as HTMLElement[]
    const closedBtns = Array.from(
      container.querySelectorAll('.wd-files-item[aria-expanded="false"]'),
    ) as HTMLElement[]

    // 2. Exactly 50 stay expanded, 12 were shed.
    expect(openBtns.length).toBe(50)
    expect(closedBtns.length).toBe(12)

    const openNames = openBtns.map(getRowName)
    const closedNames = closedBtns.map(getRowName)

    // 3. THE POINT OF THIS FILE: both depth-1 parents survive.  Under an
    //    inverted depth comparator the shallow parents would be shed
    //    first and the user's top-level folders would snap shut.
    expect(openNames).toContain('A')
    expect(openNames).toContain('B')
    expect(closedNames).not.toContain('A')
    expect(closedNames).not.toContain('B')

    // 4. Every shed entry is a depth-2 child, and specifically the
    //    alphabetically-last 12 of them (B-child-18..29).
    for (const name of closedNames) {
      expect(name.startsWith('A-child-') || name.startsWith('B-child-')).toBe(true)
    }
    expect(closedNames.sort()).toEqual([
      'B-child-18', 'B-child-19', 'B-child-20', 'B-child-21', 'B-child-22',
      'B-child-23', 'B-child-24', 'B-child-25', 'B-child-26', 'B-child-27',
      'B-child-28', 'B-child-29',
    ])

    // 5. The whole A subtree is untouched — the trim cut from one end of
    //    the depth-2 band, it did not thin both parents evenly.
    for (let i = 0; i < CHILDREN_PER_PARENT; i++) {
      expect(openNames).toContain(`A-child-${String(i).padStart(2, '0')}`)
    }
  })
})
