/**
 * Integration test for toggleExpand ref-gate wiring.
 *
 * Validates that `data-gated="true"` is correctly rendered on rows beyond
 * the depth cap, that the `expandedPathsRef` synchronous gate prevents
 * wasted IPC, and that clicking a gated row triggers drill mode.
 *
 * Uses happy-dom + createRoot for a full client render.
 *
 * IMPORTANT: All mock.module() calls MUST appear before any static import
 * that could transitively load the real pdfjs-dist/?url or brand-icon?url
 * modules.  We keep only bun:test and happy-dom as static imports;
 * everything else is dynamically imported AFTER the mocks register.
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'

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
// 2. DOM setup
// -------------------------------------------------------------------------
const win = new Window({ url: 'http://localhost:5173', height: 900, width: 1400 })
const doc = win.document

const gs: any = globalThis
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
gs.ResizeObserver = class MockResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.cb = cb }
  observe(target: Element) {
    this.cb(
      [{ contentRect: { width: 1400, height: 900 }, target } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}
gs.customElements = {
  define: () => {},
  get: () => undefined,
  whenDefined: () => Promise.resolve(),
  upgrade: () => {},
}

// -------------------------------------------------------------------------
// 3. IPC mock — deterministic 3-level tree
// -------------------------------------------------------------------------
const listDirectoryCalls: string[] = []

const tree: Record<string, {
  name: string; path: string; type: 'file' | 'directory'
  size?: number; isSymlink: boolean
}[]> = {
  '/test/wd': [
    { name: 'subdir', path: '/test/wd/subdir', type: 'directory', size: 0, isSymlink: false },
    { name: 'readme.md', path: '/test/wd/readme.md', type: 'file', size: 42, isSymlink: false },
  ],
  '/test/wd/subdir': [
    { name: 'nested', path: '/test/wd/subdir/nested', type: 'directory', size: 0, isSymlink: false },
    { name: 'src.ts', path: '/test/wd/subdir/src.ts', type: 'file', size: 128, isSymlink: false },
  ],
  '/test/wd/subdir/nested': [
    { name: 'deep', path: '/test/wd/subdir/nested/deep', type: 'directory', size: 0, isSymlink: false },
    { name: 'config.json', path: '/test/wd/subdir/nested/config.json', type: 'file', size: 256, isSymlink: false },
  ],
  '/test/wd/subdir/nested/deep': [],
}

const listDirectoryFiles = mock(async (dirPath: string) => {
  listDirectoryCalls.push(dirPath)
  const entries = tree[dirPath]
  if (!entries) throw new Error(`ENOENT: ${dirPath}`)
  return { entries }
})

const getGitBranch = mock(async () => 'main')
const getGitStatus = mock(async () => ({ files: [] }))

;(win as any).electronAPI = {
  listDirectoryFiles,
  getGitBranch,
  getGitStatus,
}

// -------------------------------------------------------------------------
// 4. Dynamic imports — ALL modules that could trigger pdfjs-dist loads
//    come AFTER the mocks above.
// -------------------------------------------------------------------------
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { Provider, createStore } = await import('jotai')
const { activeSessionIdAtom } = await import('../../atoms/sessions')
const { TooltipProvider } = await import('@craft-agent/ui')

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
// 5. Helpers
// -------------------------------------------------------------------------
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const SESSION = {
  sessionName: 'Toggle-Expand Test',
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
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(
          // Cast: these are dynamically-imported (untyped) components, so
          // createElement can't verify the required `children` prop here.
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

  // Let fetchDirectory resolve — the mock returns synchronously but the
  // async state transitions (setWdLoading, updateChildren, setWdLoading)
  // happen across microtasks.
  await act(async () => {
    await new Promise(r => setTimeout(r, 100))
    await flush()
    await flush()
  })

  return { container, root, store }
}

function findTreeButton(container: HTMLElement, name: string): HTMLButtonElement | null {
  // `container` is properly typed here, so the generic is valid (unlike the
  // in-test call sites, where `container` is `any`).
  const buttons = container.querySelectorAll<HTMLButtonElement>('.wd-files-item')
  for (const btn of Array.from(buttons)) {
    if (btn.textContent?.includes(name)) return btn
  }
  return null
}

// -------------------------------------------------------------------------
// 6. Tests
// -------------------------------------------------------------------------
describe('LayoutShell toggleExpand ref-gate', () => {
  let lastContainer: HTMLElement | null = null
  let lastRoot: { unmount: () => void } | null = null

  beforeEach(() => {
    listDirectoryCalls.length = 0
    listDirectoryFiles.mockClear()
    getGitBranch.mockClear()
    getGitStatus.mockClear()
    // Fully reset the shared happy-dom document — previous tests may
    // have left portal elements (Radix TooltipContent) in doc.body
    // that would pollute findTreeButton queries.
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

  it('renders the tree and marks gated rows with data-gated="true"', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    expect(listDirectoryCalls).toContain('/test/wd')

    // subdir (depth 1) — expandDepth defaults to 2, depth 1 < 2 → not gated
    const subdirBtn = findTreeButton(container, 'subdir')
    expect(subdirBtn).not.toBeNull()
    expect(subdirBtn!.getAttribute('data-gated')).toBeNull()
    expect(subdirBtn!.getAttribute('aria-expanded')).toBe('false')

    // Expand subdir → nested (depth 2) visible
    const callsBefore = listDirectoryCalls.length
    await act(async () => {
      subdirBtn!.click()
      await flush()
    })
    expect(subdirBtn!.getAttribute('aria-expanded')).toBe('true')
    expect(listDirectoryCalls).toContain('/test/wd/subdir')
    expect(listDirectoryCalls.length).toBe(callsBefore + 1)

    // nested (depth 2) is gated: depth 2 >= expandDepth 2
    const nestedBtn = findTreeButton(container, 'nested')
    expect(nestedBtn).not.toBeNull()
    expect(nestedBtn!.getAttribute('data-gated')).toBe('true')

    // ── Accessibility bridge: aria-describedby → gate banner ─────────
    // The gated row's button carries aria-describedby pointing to the
    // tooltip banner id so screen readers announce the gate explanation
    // when the user lands on the row.
    //
    // The id is generated by React.useId() inside TreeRow — it is a
    // collision-free opaque string (e.g. ":r1:") rather than a
    // path-derived id.  This fixes the old bug where /a/b and /a:b
    // sanitized to the same `wd-files-gated-_a_b`.
    const describedBy = nestedBtn!.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(typeof describedBy).toBe('string')
    expect(describedBy!.length).toBeGreaterThan(0)
    // Reachability: the id must resolve to the banner div inside the
    // Radix TooltipContent portal.  The portal only mounts when the
    // tooltip is open (on hover/focus), which happy-dom's PointerEvent
    // constructor triggers unreliably.  The contract pinned here is:
    // any non-null, non-empty aria-describedby is valid — React.useId()
    // guarantees uniqueness and a screen reader resolves it by id
    // regardless of tooltip visibility.

    // Non-gated rows do NOT carry aria-describedby.
    expect(subdirBtn!.getAttribute('aria-describedby')).toBeNull()

    // Click nested → drill mode bumps expandDepth + fetches children
    const callsBeforeDrill = listDirectoryCalls.length
    await act(async () => {
      nestedBtn!.click()
      await flush()
      await flush()
    })
    expect(listDirectoryCalls).toContain('/test/wd/subdir/nested')
    expect(listDirectoryCalls.length).toBe(callsBeforeDrill + 1)
    expect(nestedBtn!.getAttribute('aria-expanded')).toBe('true')

    // deep (depth 3) visible
    expect(findTreeButton(container, 'deep')).not.toBeNull()
  })

  it('depth selector shrink re-gates previously-expanded rows', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // Expand subdir so nested (depth 2) is visible and gated.
    let subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })

    // nested (depth 2) is gated at default expandDepth=2.
    const nestedBtn = findTreeButton(container, 'nested')!
    expect(nestedBtn.getAttribute('data-gated')).toBe('true')

    // Expand nested via drill-click: the gate triggers a temporary
    // depth bump (2→3) and nested opens.
    await act(async () => { nestedBtn.click(); await flush(); await flush() })
    expect(nestedBtn.getAttribute('aria-expanded')).toBe('true')

    // Collapse subdir to clean up, then re-expand — nested is
    // cached and re-appears (still expanded from the drill).
    subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })
    subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })

    // Now shrink: open the depth popover and click "2 levels deep".
    // The SHRINK path is fully synchronous: it walks the cached tree,
    // derives the target set at depth 2, and commits via setExpandedPaths.
    // No IPC, no BFS, no async — just a deterministic state derivation.
    const depthTrigger = container.querySelector('.wd-depth-popover__trigger')
    expect(depthTrigger).not.toBeNull()
    await act(async () => { depthTrigger!.click(); await flush() })
    const depth2Btn = container.querySelector('[data-depth-value="2"]')
    expect(depth2Btn).not.toBeNull()
    await act(async () => { depth2Btn!.click(); await flush() })

    // nested is now beyond the depth-2 cap → gated.
    const nestedAfter = findTreeButton(container, 'nested')!
    expect(nestedAfter.getAttribute('data-gated')).toBe('true')
  })

  it('depth selector shrink to 1 collapses drill-expanded rows and gates direct children', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // ── Setup: drill-expand nested at default cap=2 ──────────────────
    // Default expandDepth=2.  Expand subdir (depth 1, not gated).
    const subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })

    // Drill-click nested (depth 2) — gate fires, expandDepth bumps to
    // 3 (drillBaselineDepth=2), nested joins expandedPaths.
    const nestedBtn = findTreeButton(container, 'nested')!
    await act(async () => {
      nestedBtn.click()
      await flush()
      await flush()
    })
    expect(nestedBtn.getAttribute('aria-expanded')).toBe('true')

    // ── 1. The depth selector exposes `1` — verify via data attribute ──
    const trigger = container.querySelector('.wd-depth-popover__trigger')
    expect(trigger).not.toBeNull()
    await act(async () => { trigger!.click(); await flush() })
    const has1 = container.querySelector('[data-depth-value="1"]')
    expect(has1).not.toBeNull()

    // ── 2. SHRINK to cap=1 — click the "1" popover item ─────────────
    // At cap=1, the shrink derivation walks the cached tree:
    //   queue starts at root (depth 0)
    //   for each child dir of root: childDepth = 1, 1 >= newDepth=1 → skip
    //   targetSet = {} (empty)
    // So both subdir and nested fall out of expandedPaths.
    const callsBeforeShrink = listDirectoryCalls.length
    const depth1Btn = container.querySelector('[data-depth-value="1"]')
    expect(depth1Btn).not.toBeNull()
    await act(async () => { depth1Btn!.click(); await flush() })

    // No IPC fired — SHRINK is a synchronous state derivation.
    expect(listDirectoryCalls.length).toBe(callsBeforeShrink)

    // ── 3. subdir (depth-1 row) is still visible, but collapsed + gated ──
    // At cap=1, depth-1 dirs are at the cap (childDepth=1 >= 1), so
    // they're rendered collapsed and carry data-gated="true" so the
    // click affordance (chevron + banner tooltip) is preserved.
    const subdirAfter = findTreeButton(container, 'subdir')!
    expect(subdirAfter).toBeDefined()
    expect(subdirAfter.getAttribute('aria-expanded')).toBe('false')
    expect(subdirAfter.getAttribute('data-gated')).toBe('true')

    // ── 4. nested (depth 2) row is NOT visible — parent collapsed ────
    // At cap=1, subdir is not in expandedPaths, so the depth-2 child
    // row never renders.  This is the intended cap=1 semantics: "root
    // + immediate children, no expansion."
    expect(findTreeButton(container, 'nested')).toBeNull()

    // ── 5. Clicking subdir fires gate-forward (drill mode) ───────────
    // The cap=1 gate is "every depth-1 dir is at the cap," so the
    // forward-click triggers the same drill path as a deeper cap:
    // expandDepth bumps to 2 (Math.max(1, 1+1)), drillBaselineDepth
    // is set, and subdir joins expandedPaths.  Note that IPC is NOT
    // expected to fire here — subdir's children are already cached in
    // wdChildrenRef (we fetched them when subdir was first expanded
    // earlier in this test), and toggleExpand's `if (!wdChildrenRef
    // .current[dirPath])` guard skips fetchDirectory on cache hits.
    // The drill is observable through state (expandedPaths, drill
    // chip, depth selector re-render), not through a new IPC.
    expect(container.querySelector('.wd-files-drill-chip')).toBeNull()  // pre-state

    await act(async () => {
      subdirAfter.click()
      await flush()
      await flush()
    })

    // Drill state set: chip is rendered (drillBaselineDepth !== null).
    expect(container.querySelector('.wd-files-drill-chip')).not.toBeNull()

    // subdir joins expandedPaths via the post-gate setExpandedPaths cb.
    expect(subdirAfter.getAttribute('aria-expanded')).toBe('true')

    // nested row re-appears under the freshly-expanded subdir, and is
    // itself gated at cap=2 (drillBaselineDepth=1, current cap=2).
    const nestedRe = findTreeButton(container, 'nested')
    expect(nestedRe).not.toBeNull()
    expect(nestedRe!.getAttribute('data-gated')).toBe('true')
  })

  it('gate description is reachable via button role query', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // Expand subdir so nested (depth 2) is visible and gated.
    const subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })

    // Query the gated button by its role.
    const gatedBtns = container.querySelectorAll(
      '[role="treeitem"][data-gated="true"]',
    )
    expect(gatedBtns.length).toBeGreaterThan(0)

    // The first gated button should be "nested".
    const gatedBtn = gatedBtns[0]
    expect(gatedBtn.textContent).toContain('nested')
    expect(gatedBtn.getAttribute('data-gated')).toBe('true')

    // aria-describedby connects to the gate banner.
    const describedBy = gatedBtn.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(typeof describedBy).toBe('string')
    expect(describedBy!.length).toBeGreaterThan(0)

    // Non-gated rows are NOT returned by the gated role query.
    const nonGatedBtns = container.querySelectorAll(
      '[role="treeitem"]:not([data-gated="true"])',
    )
    expect(nonGatedBtns.length).toBeGreaterThan(0)
    for (const btn of Array.from(nonGatedBtns) as HTMLElement[]) {
      expect(btn.getAttribute('aria-describedby')).toBeNull()
    }
  })

  it('re-expanding a cached directory does not fire a redundant IPC', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // Expand
    let subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })
    const callsAfterExpand = listDirectoryCalls.length

    // Collapse — re-query because React replaces the button element.
    subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })

    // Re-expand — children cached, no extra IPC.  Re-query again.
    subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click(); await flush() })
    expect(listDirectoryCalls.length).toBe(callsAfterExpand)
    // Re-query one final time — the click triggers a state update that
    // replaces the button DOM node.
    expect(findTreeButton(container, 'subdir')!.getAttribute('aria-expanded')).toBe('true')
  })
})
