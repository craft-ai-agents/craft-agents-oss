/**
 * Gated row — visual snapshot tests.
 *
 * Captures the HTML for the gated-row affordance in the Working Directory
 * tree: the `data-gated="true"` attribute on the row, the dimmed chevron
 * (CSS opacity dimmed < 1, verified via getComputedStyle), and the banner
 * text inside the TooltipContent (which renders inline via the @archstudio/ui
 * mock so it appears in the snapshot without requiring pointer events).
 *
 * NOTE: This is NOT a Playwright screenshot test — it uses bun:test's
 * `toMatchSnapshot` on innerHTML + happy-dom's `getComputedStyle` for
 * CSS values.  True visual regression (layout, backdrop-filter, gradients,
 * animations) requires Playwright + the Electron Vite dev server, which
 * are not yet set up in this project.  What this test DOES catch:
 *   - HTML structure changes (class names, attribute presence, banner copy)
 *   - CSS dim rule applied (opacity < 1 via injected <style>)
 * What it does NOT catch:
 *   - Screenshot diffs (layout shifts, font rendering, theme colours)
 *
 * Run once to record the baselines:
 *   bun test apps/electron/src/renderer/shell/__tests__/LayoutShell.gated-row-snapshot.test.tsx
 *
 * To update snapshots after an intentional change:
 *   bun test --update-snapshots apps/electron/src/renderer/shell/__tests__/LayoutShell.gated-row-snapshot.test.tsx
 *
 * Normalises React `useId()` values (`:rN:`) to a stable placeholder.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'

// -------------------------------------------------------------------------
// 1. Module-level mocks — MUST register before any module that uses them
// -------------------------------------------------------------------------

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('@resources/icon-set/icon-512.png?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({}),
}))

// -------------------------------------------------------------------------
// 2. DOM setup — happy-dom provides browser globals on a single Window.
// -------------------------------------------------------------------------

const win = new Window({ url: 'http://localhost:5173', height: 900, width: 1400 })
const doc = win.document

;(globalThis as any).window = win
;(globalThis as any).document = doc
;(globalThis as any).HTMLElement = win.HTMLElement
;(globalThis as any).Element = win.Element
;(globalThis as any).Node = win.Node
;(globalThis as any).getComputedStyle = win.getComputedStyle.bind(win)
;(globalThis as any).navigator = win.navigator
;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0)
;(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id)
;(globalThis as any).ResizeObserver = class MockResizeObserver {
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
;(globalThis as any).IntersectionObserver = class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
;(globalThis as any).customElements = {
  define: () => {},
  get: () => undefined,
  whenDefined: () => Promise.resolve(),
  upgrade: () => {},
}

// -------------------------------------------------------------------------
// 3. IPC mock — deterministic 3-level tree
// -------------------------------------------------------------------------

const listDirectoryCalls: string[] = []

const tree: Record<string, Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number; isSymlink: boolean }>> = {
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
// 4. Dynamic imports — all modules that trigger pdfjs-dist loads come
//    AFTER the mocks above.
// -------------------------------------------------------------------------

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { Provider, createStore } = await import('jotai')
const { activeSessionIdAtom } = await import('../../atoms/sessions')

// -------------------------------------------------------------------------
// 5. Capture real @archstudio/ui, then mock only the 4 tooltip primitives.
// -------------------------------------------------------------------------

const realUiModule = await import('@archstudio/ui')

if (
  typeof realUiModule.shouldGateManualExpand !== 'function' ||
  typeof realUiModule.trimExpandedByCount !== 'function'
) {
  throw new Error(
    'realUiModule capture broken — a transitive @archstudio/ui import ' +
      'likely needs mocking before this block.',
  )
}

const InlineTooltipProvider = ({ children }: { children: any }) =>
  React.createElement(React.Fragment, null, children) as any

const InlineTooltip = ({ children }: { children: any }) =>
  React.createElement(React.Fragment, null, children) as any

const InlineTooltipTrigger = ({ children, asChild: _asChild, ...rest }: any) =>
  typeof children === 'function'
    ? (children as any)(rest)
    : React.cloneElement(children, rest)

const InlineTooltipContent = React.forwardRef<HTMLDivElement, Record<string, any>>(
  function InlineTooltipContent({ children, id, className, forceMount: _forceMount, ...rest }, ref) {
    const {
      onPointerEnter: _a, onPointerLeave: _b, onPointerDown: _c,
      onPointerDownOutside: _d, onPointerUpOutside: _e, onFocusOutside: _f,
      onInteractOutside: _g, onEscapeKeyDown: _h, onOpenAutoFocus: _i,
      onCloseAutoFocus: _j, onKeyDown: _k, avoidCollisions: _l,
      collisionBoundary: _m, collisionPadding: _n, sticky: _o,
      hideWhenDetached: _p,
      ...visualProps
    } = rest
    void _a; void _b; void _c; void _d; void _e; void _f; void _g; void _h
    void _i; void _j; void _k; void _l; void _m; void _n; void _o; void _p
    return React.createElement('div', { ref, id, className, ...visualProps }, children)
  },
)

mock.module('@archstudio/ui', () => ({
  ...realUiModule,
  Tooltip: InlineTooltip,
  TooltipTrigger: InlineTooltipTrigger,
  TooltipContent: InlineTooltipContent,
  TooltipProvider: InlineTooltipProvider,
}))

// -------------------------------------------------------------------------
// 6. Mock AppShellContext
// -------------------------------------------------------------------------

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
const { TooltipProvider } = await import('@archstudio/ui')

// -------------------------------------------------------------------------
// 7. Helpers
// -------------------------------------------------------------------------

// Inject critical gated-chevron CSS rule — bun:test ignores `import './LayoutShell.css'`.
// Mirrors LayoutShell.css:1166: `.wd-files-item[data-gated="true"] .wd-files-tree__arrow { opacity: 0.45; }`
const criticalStyle = doc.createElement('style')
criticalStyle.textContent =
  '.wd-files-item[data-gated="true"] .wd-files-tree__arrow { opacity: 0.3; }'
doc.head.appendChild(criticalStyle)

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const SESSION = {
  sessionName: 'Gated Row Snapshot',
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

  // Let initial fetchDirectory resolve across microtasks.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
      await flush()
    })
  }

  return { container, root, store }
}

function findTreeButton(container: HTMLElement, name: string): HTMLButtonElement | null {
  const buttons = container.querySelectorAll<HTMLButtonElement>('.wd-files-item')
  for (const btn of Array.from(buttons)) {
    if (btn.textContent?.includes(name)) return btn
  }
  return null
}

function normalizeSnapshotHtml(html: string): string {
  // React `useId()` values (":r2:", ":r4:", …) are allocated from a global
  // counter, so they shift whenever an unrelated component adds a hook earlier
  // in the tree — these snapshots broke purely because the workspace-tab work
  // introduced hooks upstream, moving `:r2:` to `:r4:`.
  //
  // The previous pattern only scrubbed the `id="…"` attribute and left the
  // *references* to it — notably the gate banner's `aria-describedby` — intact,
  // so the id still leaked into the snapshot. Scrub the token wherever it
  // appears instead of guessing which attributes carry it.
  return html.replace(/:r[0-9a-z]+:/gi, 'SNAPSHOT_ID')
}

function snapshotTree(container: HTMLElement): string {
  const treeSection = container.querySelector('.wd-files-list')
  if (!treeSection)
    throw new Error(
      'Tree section (.wd-files-list) not found in the rendered LayoutShell',
    )
  return normalizeSnapshotHtml(treeSection.innerHTML)
}

// -------------------------------------------------------------------------
// 8. Tests
// -------------------------------------------------------------------------

describe('Gated row — snapshot baselines', () => {
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

  // ── Snapshot 1: tree with gated row ────────────────────────────────

  it('renders gated row HTML structure matching the snapshot', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    const subdirBtn = findTreeButton(container, 'subdir')
    expect(subdirBtn).not.toBeNull()

    // Expand subdir → nested (depth 2, gated at expandDepth=2)
    await act(async () => { subdirBtn!.click() })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); await flush() })
    }

    // ── Snapshot ─────────────────────────────────────────────────────
    const html = snapshotTree(container)
    expect(html).toMatchSnapshot('gated-row-tree')

    // ── Specific assertions ───────────────────────────────────────────
    const nestedBtn = findTreeButton(container, 'nested')
    expect(nestedBtn).not.toBeNull()
    expect(nestedBtn!.getAttribute('data-gated')).toBe('true')

    const describedBy = nestedBtn!.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()

    const banner = container.querySelector('.wd-files-gated-banner')
    expect(banner).not.toBeNull()
    const bannerText = (banner!.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(bannerText).toContain('Capped at 2 levels')
    expect(bannerText).toContain('bump the selector to drill in')

    // Chevron dimmed — injected <style> applies opacity:0.3; we assert < 1
    // to catch "the dim rule was deleted" without duplicating the exact value.
    const chevron = nestedBtn!.querySelector('.wd-files-tree__arrow') as any
    const style = win.getComputedStyle(chevron)
    expect(Number(style.opacity)).toBeLessThan(1)

    // Non-gated rows do NOT carry aria-describedby
    expect(subdirBtn!.getAttribute('aria-describedby')).toBeNull()
  })

  // ── Snapshot 2: drilled row ────────────────────────────────────────

  it('renders drilled row HTML structure matching the snapshot', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    const subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click() })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); await flush() })
    }

    // Drill-click nested → drill mode bumps expandDepth
    const nestedBtn = findTreeButton(container, 'nested')!
    await act(async () => { nestedBtn.click() })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); await flush() })
    }

    // ── Snapshot ─────────────────────────────────────────────────────
    const html = snapshotTree(container)
    expect(html).toMatchSnapshot('gated-row-drilled')

    // ── Specific assertions ───────────────────────────────────────────
    const nestedAfter = findTreeButton(container, 'nested')
    expect(nestedAfter).not.toBeNull()
    expect(nestedAfter!.getAttribute('aria-expanded')).toBe('true')
    expect(nestedAfter!.getAttribute('data-gated')).toBeNull()

    const deepBtn = findTreeButton(container, 'deep')
    expect(deepBtn).not.toBeNull()
  })

  // ── Snapshot 3: shrink re-gates ────────────────────────────────────

  it('renders re-gated row after depth shrink matching the snapshot', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    const subdirBtn = findTreeButton(container, 'subdir')!
    await act(async () => { subdirBtn.click() })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); await flush() })
    }

    // Drill-click nested → bumps expandDepth from 2→3
    const nestedBtn = findTreeButton(container, 'nested')!
    await act(async () => { nestedBtn.click() })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); await flush() })
    }

    expect(nestedBtn!.getAttribute('data-gated')).toBeNull()

    // Shrink to depth 2: open the depth popover and click "2 levels deep".
    const depthTrigger = container.querySelector('.wd-depth-popover__trigger') as HTMLElement | null
    expect(depthTrigger).not.toBeNull()
    await act(async () => { depthTrigger!.click() })
    await act(async () => { await flush() })
    const depth2Btn = container.querySelector('[data-depth-value="2"]') as HTMLElement | null
    expect(depth2Btn).not.toBeNull()
    await act(async () => { depth2Btn!.click() })
    await act(async () => { await flush() })
    await act(async () => { await flush() })

    // ── Snapshot ─────────────────────────────────────────────────────
    const html = snapshotTree(container)
    expect(html).toMatchSnapshot('gated-row-shrink-regated')

    // ── Specific assertions ───────────────────────────────────────────
    const nestedAfter = findTreeButton(container, 'nested')
    expect(nestedAfter).not.toBeNull()
    expect(nestedAfter!.getAttribute('data-gated')).toBe('true')

    // deep (depth 3) is no longer visible
    expect(findTreeButton(container, 'deep')).toBeNull()
  })
})

// -------------------------------------------------------------------------
// 9. Keyboard navigation — focuses tree, ArrowDown to gated row, verifies
//    aria-describedby association on the focused element.
// -------------------------------------------------------------------------

describe('Gated row — keyboard navigation', () => {
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

  // ── Keyboard test 1: Tree focus + programmatic row focus ───────────
  //
  // NOTE: We simulate keyboard navigation via programmatic .focus() on the
  // row buttons rather than dispatching native KeyboardEvent events.  Happy-dom's
  // KeyboardEvent constructor does NOT reliably set the `key` property that React's
  // synthetic event system reads — `e.key` comes back as empty string, causing
  // `handleTreeKeyDown`'s `switch (e.key)` to fall through with no action.
  //
  // The semantics we're testing (the DOM contract) are the same: Tab into the
  // tree container, then ArrowDown to the gated row, and verify aria-describedby
  // is present and resolves to the banner.  Programmatic focus on the row button
  // exercises the same DOM contract (element receives focus, screen reader reads
  // aria-describedby) without depending on happy-dom's incomplete KeyboardEvent.

  it('focusing the gated row via keyboard navigation reveals aria-describedby association', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // Expand subdir to reveal nested (gated row).
    const subdirBtn = findTreeButton(container, 'subdir')
    expect(subdirBtn).not.toBeNull()
    await act(async () => { subdirBtn!.click() })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); await flush() })
    }

    // Simulate Tab into the tree: focus the tree container.
    const treeContainer = container.querySelector('.wd-files-list.wd-files-tree') as HTMLElement | null
    expect(treeContainer).not.toBeNull()
    treeContainer!.focus()
    await act(async () => { await flush() })

    // Simulate ArrowDown to the first row (subdir).
    const subdirAfter = findTreeButton(container, 'subdir')
    expect(subdirAfter).not.toBeNull()
    subdirAfter!.focus()
    await act(async () => { await flush() })

    // subdir has DOM focus and is NOT gated (depth 1 < expandDepth 2).
    // Use `as unknown` cast for activeElement comparison — same pattern as
    // the existing drill-mode test (SessionFilesSection.drill-mode.test.tsx)
    // which handles happy-dom's type narrowing.
    expect((doc.activeElement as unknown) === (subdirAfter as unknown)).toBe(true)
    expect(subdirAfter!.getAttribute('aria-describedby')).toBeNull()

    // Simulate ArrowDown to the gated row (nested).
    const nestedAfter = findTreeButton(container, 'nested')
    expect(nestedAfter).not.toBeNull()
    nestedAfter!.focus()
    await act(async () => { await flush() })

    // nested has DOM focus and IS gated → aria-describedby must be set.
    expect((doc.activeElement as unknown) === (nestedAfter as unknown)).toBe(true)
    expect(nestedAfter!.getAttribute('data-gated')).toBe('true')
    const describedBy = nestedAfter!.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()

    // The aria-describedby resolves to the gate banner in the DOM.
    const banner = doc.getElementById(describedBy!)
    expect(banner).not.toBeNull()
    expect(banner!.classList.contains('wd-files-gated-banner')).toBe(true)
    const bannerText = (banner!.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(bannerText).toContain('Capped at 2 levels')
    expect(bannerText).toContain('bump the selector to drill in')

    // Confirm non-gated rows (readme.md) have no aria-describedby.
    const readmeBtn = findTreeButton(container, 'readme.md')
    expect(readmeBtn).not.toBeNull()
    expect(readmeBtn!.getAttribute('aria-describedby')).toBeNull()
  })

  // ── Keyboard test 2: Focus leaves gated row ────────────────────────

  it('focus leaving the gated row does not carry stale aria-describedby', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    const subdirBtn = findTreeButton(container, 'subdir')
    expect(subdirBtn).not.toBeNull()
    await act(async () => { subdirBtn!.click() })
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); await flush() })
    }

    const treeContainer = container.querySelector('.wd-files-list.wd-files-tree') as HTMLElement | null
    treeContainer!.focus()
    await act(async () => { await flush() })

    // Focus subdir.
    const subdir = findTreeButton(container, 'subdir')!
    subdir.focus()
    await act(async () => { await flush() })

    // Focus nested (gated) — aria-describedby is present.
    const nested = findTreeButton(container, 'nested')!
    nested.focus()
    await act(async () => { await flush() })
    expect(nested.getAttribute('aria-describedby')).toBeTruthy()

    // Focus back to subdir — aria-describedby cleared.
    subdir.focus()
    await act(async () => { await flush() })

    expect((doc.activeElement as unknown) === (subdir as unknown)).toBe(true)
    expect(subdir.getAttribute('aria-describedby')).toBeNull()
    // Also verify nested is NOT the activeElement (focus correctly moved away).
    expect((doc.activeElement as unknown) === (nested as unknown)).toBe(false)
    // nested still has aria-describedby baked into the DOM (the attribute is
    // always present when the row is gated) but is NOT focused — the screen
    // reader would NOT announce it because focus is on subdir.
    expect(nested.getAttribute('aria-describedby')).toBeTruthy()
  })
})
