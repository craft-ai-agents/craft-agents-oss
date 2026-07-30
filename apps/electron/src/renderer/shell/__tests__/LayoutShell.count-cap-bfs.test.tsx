/**
 * Integration test for the count-cap guardrail on the BFS expand.
 *
 * Validates that `trimExpandedByCount` correctly trims a 52-dir expansion
 * down to `MAX_OPEN_DIRS=50`, dropping the leaf-most (deepest) entries,
 * and that the `openCountCapped` chip appears in the section header.
 *
 * Uses happy-dom + createRoot + act() for a full client render.
 *
 * IMPORTANT: All mock.module() calls MUST appear before any static import
 * that could transitively load the real pdfjs-dist/?url or brand-icon?url
 * modules.  We keep only bun:test and happy-dom as static imports;
 * everything else is dynamically imported AFTER the mocks register.
 *
 * Fixture design (52 dirs, all empty at depth 2 — fits in one BFS pass):
 *
 *   /test/wd
 *     ├── A                (depth 1, has 25 leaf dirs)
 *     │     ├── A-leaf-00  (depth 2, empty)
 *     │     ├── ...
 *     │     └── A-leaf-24  (depth 2, empty)
 *     └── B                (depth 1, has 25 leaf dirs)
 *           ├── B-leaf-00  (depth 2, empty)
 *           ├── ...
 *           └── B-leaf-24  (depth 2, empty)
 *
 * BFS at expandDepth=2 discovers all 52 dirs.  `trimExpandedByCount`
 * sorts shallowest-first (alphabetic tiebreaker) and keeps the first 50,
 * so the dropped set is {B-leaf-24, B-leaf-23} — both at the maximum
 * depth (leaf-most), with alphabetic ordering explaining why both happen
 * to land in the B subtree (A-leaves are alphabetically before B-leaves
 * so the trim cuts from the tail end of the sort).
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
// 3. IPC mock — deterministic 52-dir tree
// -------------------------------------------------------------------------
const listDirectoryCalls: string[] = []

function buildTree(): Record<string, { name: string; path: string; type: 'file' | 'directory'; size?: number; isSymlink: boolean }[]> {
  const tree: Record<string, { name: string; path: string; type: 'file' | 'directory'; size?: number; isSymlink: boolean }[]> = {
    '/test/wd': [],
  }

  // Two parent dirs, each with 25 empty leaf dirs at depth 2.
  for (const parent of ['A', 'B'] as const) {
    const parentPath = `/test/wd/${parent}`
    tree['/test/wd'].push({
      name: parent,
      path: parentPath,
      type: 'directory',
      size: 0,
      isSymlink: false,
    })
    tree[parentPath] = []
    for (let i = 0; i < 25; i++) {
      const id = String(i).padStart(2, '0')
      const leafName = `${parent}-leaf-${id}`
      const leafPath = `${parentPath}/${leafName}`
      tree[parentPath].push({
        name: leafName,
        path: leafPath,
        type: 'directory',
        size: 0,
        isSymlink: false,
      })
      tree[leafPath] = []
    }
  }

  return tree
}

const tree = buildTree()

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
  sessionName: 'Count-Cap BFS Test',
  connectionLabel: 'test-model',
  permissionModeLabel: 'Safe',
  thinkingLabel: 'Medium',
  sourceNames: [],
  workingDirectory: '/test/wd',
}

async function renderShell(opts?: { maxOpenDirs?: number }) {
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
            {
              initialRailTab: 'files',
              sessionContext: SESSION,
              // Tests opt into the explicit override so the cap behavior is
              // locked at the call-site rather than relying on the
              // DEFAULT_MAX_OPEN_DIRS=50 fallback. Omit to get the default.
              maxOpenDirs: opts?.maxOpenDirs,
            },
            React.createElement('div', null, 'chat'),
          ),
        ),
      ),
    )
  })

  // Let fetchDirectory resolve for the initial root listing.
  await act(async () => {
    await new Promise(r => setTimeout(r, 50))
    await flush()
    await flush()
  })

  return { container, root, store }
}

function findExpandAllButton(container: HTMLElement): HTMLButtonElement | null {
  // The Expand all button lives in the section header (see LayoutShell
  // line ~2543).  We match by className + text content together so the
  // test fails fast if the button ever moves.
  const candidates = container.querySelectorAll<HTMLButtonElement>('.arch-file-list__action')
  for (const btn of Array.from(candidates)) {
    if (btn.textContent?.includes('Expand all')) return btn
  }
  return null
}

function findCountCapChip(container: HTMLElement): Element | null {
  // The count-cap chip shares the `.wd-files-capped-badge` class with
  // the BFS expansion cap, so we filter by text content to disambiguate.
  // Matched on the cap-agnostic "open limit" suffix — hardcoding "50 open
  // limit" here meant the maxOpenDirs-override test (cap 10) could never
  // find its own chip. Callers assert the exact number themselves.
  const candidates = container.querySelectorAll('.wd-files-capped-badge')
  for (const c of Array.from(candidates)) {
    if (c.textContent?.includes('open limit')) return c
  }
  return null
}

function getRowName(btn: Element): string {
  // The tree button renders the entry name in a <strong> with a stable
  // className (`.wd-files-item__name`).  Reading that element directly
  // avoids false-matches against decorative icon text inside `.wd-files-item__icon`.
  const nameEl = btn.querySelector('.wd-files-item__name')
  return (nameEl?.textContent ?? btn.textContent ?? '').trim()
}

// -------------------------------------------------------------------------
// 6. Tests
// -------------------------------------------------------------------------
describe('LayoutShell count-cap trims BFS-expanded dirs', () => {
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

  it('expands 52 dirs via BFS, trims to 50 leaf-most-dropped, shows cap chip', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // Sanity: the initial root listing IPC happened during render.
    expect(listDirectoryCalls).toContain('/test/wd')
    const callsBeforeExpand = listDirectoryCalls.length

    // Click "Expand all" — fires the fire-and-forget runDepthBFS at the
    // default expandDepth=2.  The BFS walks root → A → B and discovers
    // all 52 leaf dirs without going deeper (depth >= targetDepth skip).
    const expandAllBtn = findExpandAllButton(container)
    expect(expandAllBtn).not.toBeNull()
    await act(async () => {
      expandAllBtn!.click()
      await flush()
    })

    // Polling pattern: runDepthBFS is fire-and-forget, so the final
    // setExpandedPaths commit can land several microtasks after the
    // click.  We poll the *post-trim* artifact (the chip) rather than
    // guessing a fixed timeout — the chip only renders once both
    // setExpandedPaths(52) AND the count-cap useEffect have fired.
    let chip: Element | null = null
    for (let attempt = 0; attempt < 50; attempt++) {
      await act(async () => { await flush() })
      chip = findCountCapChip(container)
      if (chip) break
    }

    // 1. The count-cap chip rendered.
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toContain('50 open limit')
    // The chip's title carries the warning explaining the silent collapse —
    // this is the contract documented at line 2636 of LayoutShell.tsx.
    expect(chip!.getAttribute('title')).toContain('deepest entries were silently collapsed')

    // 2. Exactly 50 directories stay expanded (the "keep" set).
    const openBtns = Array.from(
      // Scoped to tree rows: the depth-selector trigger also carries
      // `aria-expanded` (correct ARIA for a popover), so an unscoped query
      // counts it as a tree row and skews the totals by one.
      container.querySelectorAll('.wd-files-item[aria-expanded="true"]'),
    ) as HTMLElement[]
    expect(openBtns.length).toBe(50)

    // 3. Exactly 2 directories were dropped (the "dropped" set).
    const closedBtns = Array.from(
      container.querySelectorAll('.wd-files-item[aria-expanded="false"]'),
    ) as HTMLElement[]
    expect(closedBtns.length).toBe(2)

    // Extract names from the closed buttons via `.wd-files-item__name`
    // (mirrors getRowName's defensive fallback).  We deliberately don't
    // .sort() — the arrayContaining matcher accepts any order.
    const closedNames = closedBtns.map(getRowName)

    // 4. The dropped dirs are the leaf-most entries in the trim-ordering.
    // trimExpandedByCount sorts shallowest-first with an alphabetic
    // tiebreaker, keeps the first 50, and reverses the tail into
    // `dropped` (deepest-first).  In our fixture:
    //   - Sorted [depth, path-alphabetic]: A, B, A-leaf-00..24,
    //     B-leaf-00..24 → 52 entries.
    //   - Keep [0..49]: A, B, all 25 A-leaves, B-leaf-00..22 (23 B-leaves).
    //   - Drop [50..51] reversed: B-leaf-24, B-leaf-23.
    // Both B-leaf-23 and B-leaf-24 are at the maximum depth (the
    // leaf-most level), and the alphabetic tiebreaker explains why both
    // happen to fall in the B subtree (A-leaves sort before B-leaves at
    // the same depth, so the trim cuts from the tail end of the sort).
    expect(closedNames).toEqual(
      expect.arrayContaining(['B-leaf-23', 'B-leaf-24']),
    )

    // 5. Sanity: BFS fetched every uncached dir.  The IPC fires BEFORE
    // the depth-skip guard, so even leaf dirs get a listDirectoryFiles
    // call to cache their (empty) children — only the enqueue walk is
    // skipped at depth >= expandDepth (LayoutShell.tsx ~line 946).  In
    // this fixture: 1 initial root fetch + 52 BFS fetches = 53 IPCs.
    expect(listDirectoryCalls.length).toBe(callsBeforeExpand + 52)
    expect(listDirectoryCalls).toEqual(
      expect.arrayContaining(['/test/wd', '/test/wd/A', '/test/wd/B']),
    )

    // 6. Every leaf dir was fetched exactly once (no over-fetching).
    // If a future BFS regression caused duplicate fetches, this would
    // catch it cheaply.
    const leafPaths = listDirectoryCalls.filter((p) => p.startsWith('/test/wd/A/A-leaf-') || p.startsWith('/test/wd/B/B-leaf-'))
    expect(leafPaths.length).toBe(50)

    // 7. The chip is only ONE chip (not two).  This guards against the
    // regression where the BFS cap (MAX_EXPAND_DIRS=100) and the count
    // cap (MAX_OPEN_DIRS=50) chips both render — in this fixture,
    // discoverSet.size (52) is well under MAX_EXPAND_DIRS=100, so only
    // the count cap should fire.
    const allCapChips = container.querySelectorAll('.wd-files-capped-badge')
    expect(allCapChips.length).toBe(1)
  })

  // ── Collapse a single expanded dir → count drops below 50 → chip disappears ──
  //
  // The count-cap chip clears when `expandedPaths.size` drops below
  // `MAX_OPEN_DIRS` (strictly: `size < MAX_OPEN_DIRS`).  We expand all,
  // trim to 50 (chip appears), then collapse one leaf dir to reduce
  // the count to 49 — the chip should vanish.
  //
  // This exercises the `setOpenCountCapped(false)` path inside the
  // count-cap useEffect (LayoutShell.tsx `openCountCapped` state).
  // Note that this test does NOT re-expand to 50 afterwards — the strict
  // comparison (`<` not `<=`) means the trim fires again at exactly 50
  // and unconditionally calls `setOpenCountCapped(true)`, which would
  // re-add the chip.  The user's requirement is only the collapse→vanish
  // transition.

  it('collapsing one expanded dir clears the count-cap chip', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // Click "Expand all" — BFS discovers 52 dirs → trim to 50.
    const expandAllBtn = findExpandAllButton(container)
    expect(expandAllBtn).not.toBeNull()
    await act(async () => {
      expandAllBtn!.click()
      await flush()
    })

    // Poll for the chip to confirm the trim fired.
    let chip: Element | null = null
    for (let attempt = 0; attempt < 80; attempt++) {
      await act(async () => { await flush() })
      chip = findCountCapChip(container)
      if (chip) break
    }
    expect(chip).not.toBeNull()

    // Find an expanded leaf dir.
    const expandedBtns = Array.from(
      // Scoped to tree rows: the depth-selector trigger also carries
      // `aria-expanded` (correct ARIA for a popover), so an unscoped query
      // counts it as a tree row and skews the totals by one.
      container.querySelectorAll('.wd-files-item[aria-expanded="true"]'),
    ) as HTMLElement[]
    expect(expandedBtns.length).toBe(50)

    // Pick the first expanded dir starting with "A-leaf-".
    let collapseTarget: HTMLElement | null = null
    for (const btn of expandedBtns) {
      const name = getRowName(btn)
      if (name.startsWith('A-leaf-')) {
        collapseTarget = btn
        break
      }
    }
    expect(collapseTarget).not.toBeNull()

    // Click it to collapse — removes from expandedPaths (count 50 → 49).
    await act(async () => {
      collapseTarget!.click()
      await flush()
    })

    // Poll for the chip to disappear — the count-cap useEffect fires
    // when expandedPaths.size < MAX_OPEN_DIRS.
    for (let attempt = 0; attempt < 30; attempt++) {
      await act(async () => { await flush() })
      chip = findCountCapChip(container)
      if (!chip) break
    }

    // 1. The chip is gone.
    expect(chip).toBeNull()

    // 2. There are now 3 closed dirs: the 2 originally-dropped
    //    (B-leaf-23, B-leaf-24) + the one we just collapsed.
    const closedBtns = Array.from(
      container.querySelectorAll('.wd-files-item[aria-expanded="false"]'),
    ) as HTMLElement[]
    expect(closedBtns.length).toBe(3)

    // 3. Exactly 49 directories stay expanded.
    const openBtnsAfter = Array.from(
      // Scoped to tree rows: the depth-selector trigger also carries
      // `aria-expanded` (correct ARIA for a popover), so an unscoped query
      // counts it as a tree row and skews the totals by one.
      container.querySelectorAll('.wd-files-item[aria-expanded="true"]'),
    ) as HTMLElement[]
    expect(openBtnsAfter.length).toBe(49)
  })

  // ---------------------------------------------------------------------
  // maxOpenDirs prop override — locks in the promote-to-setting path
  // ---------------------------------------------------------------------
  //
  // Renders with an explicit `maxOpenDirs={10}` and verifies the chip
  // text + tooltip + open-state reflect the overridden value rather than
  // the DEFAULT_MAX_OPEN_DIRS=50 fallback.  This is the behavioural
  // contract between AppShell (loader) → LayoutShell (consumer) and the
  // Settings UI's `Max open dirs` selector.
  it('respects an explicit maxOpenDirs prop override (10 instead of 50)', async () => {
    const { container, root } = await renderShell({ maxOpenDirs: 10 })
    lastContainer = container
    lastRoot = root as any

    // Click "Expand all" — BFS discovers 52 dirs → trim to 10 (the override).
    const expandAllBtn = findExpandAllButton(container)
    expect(expandAllBtn).not.toBeNull()
    await act(async () => {
      expandAllBtn!.click()
      await flush()
    })

    // Poll for the chip.  Text should reflect the override value (10),
    // not the default (50).
    let chip: Element | null = null
    for (let attempt = 0; attempt < 80; attempt++) {
      await act(async () => { await flush() })
      chip = findCountCapChip(container)
      if (chip) break
    }
    expect(chip).not.toBeNull()

    // 1. Chip text reads "10 open limit" (the override), not "50 open limit".
    const chipText = chip!.textContent || ''
    expect(chipText).toContain('10 open limit')
    expect(chipText).not.toContain('50 open limit')

    // 2. Tooltip title also reflects the override.
    const chipTitle = chip!.getAttribute('title') || ''
    expect(chipTitle).toContain('Open dirs capped at 10')

    // 3. Exactly 10 directories stay expanded (the override, not 50).
    const openBtns = Array.from(
      // Scoped to tree rows: the depth-selector trigger also carries
      // `aria-expanded` (correct ARIA for a popover), so an unscoped query
      // counts it as a tree row and skews the totals by one.
      container.querySelectorAll('.wd-files-item[aria-expanded="true"]'),
    ) as HTMLElement[]
    expect(openBtns.length).toBe(10)

    // 4. The dropped set is large: 52 - 10 = 42 leaf-most entries.
    const closedBtns = Array.from(
      container.querySelectorAll('.wd-files-item[aria-expanded="false"]'),
    ) as HTMLElement[]
    expect(closedBtns.length).toBe(42)
  })

  // ---------------------------------------------------------------------
  // Pinned directories — exempt from count-cap eviction
  // ---------------------------------------------------------------------
  //
  // Locks in the contract between the helper (trimExpandedByCount with
  // pinnedPaths) and the LayoutShell wiring (togglePin via Cmd/Ctrl+click,
  // count-cap useEffect passing pinnedPathsRef.current).  Without the
  // pin exemption the user could lose a dir they were actively working
  // in when the cap fires on Expand-all.
  it('pinned directories survive the count-cap trim even when deepest', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    // First click "Expand all" to get a baseline tree with 52 dirs
    // trimmed to 50.
    const expandAllBtn = findExpandAllButton(container)
    expect(expandAllBtn).not.toBeNull()
    await act(async () => {
      expandAllBtn!.click()
      await flush()
    })

    // Wait for the initial trim to settle.
    let chip: Element | null = null
    for (let attempt = 0; attempt < 80; attempt++) {
      await act(async () => { await flush() })
      chip = findCountCapChip(container)
      if (chip) break
    }
    expect(chip).not.toBeNull()

    // Target one of the two dirs the trim just EVICTED (B-leaf-23/24).
    // Those are the deepest-and-alphabetically-last entries, so they are
    // precisely the ones the cap sheds first — pinning one is the sharpest
    // possible test of the exemption.
    //
    // NOTE ON FLOW: this test used to pin an already-expanded dir, collapse
    // it, then press "Expand all" again. That is unreachable — the header
    // renders "Collapse all" *instead of* "Expand all" while any dir is
    // open (`hasExpandedDirs`), and Collapse-all deliberately clears the pin
    // set. Re-expanding a pinned-but-dropped row pushes the count back over
    // the cap and re-triggers the trim with the pin in place, which exercises
    // the same contract via a path the UI actually supports.
    const droppedBtns = Array.from(
      container.querySelectorAll('.wd-files-item[aria-expanded="false"]'),
    ) as HTMLElement[]
    expect(droppedBtns.length).toBe(2)

    const pinTarget: HTMLElement | null = droppedBtns[0] ?? null
    const pinTargetName: string | null = pinTarget ? getRowName(pinTarget) : null
    expect(pinTarget).not.toBeNull()
    expect(pinTargetName).not.toBeNull()

    // Simulate Cmd/Ctrl+click — togglePin via the modifier-key branch
    // in TreeRow's onClick handler.
    await act(async () => {
      // MouseEvent is a constructor on the happy-dom *window*, not on its
      // document — `new doc.MouseEvent(...)` throws "not a constructor".
      const evt = new (win as any).MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      })
      pinTarget!.dispatchEvent(evt)
      await flush()
    })

    // After Cmd-click, the row should carry data-pinned="true".
    // Re-query (React may have re-rendered with a new node).
    let pinnedRows: NodeListOf<Element> = container.querySelectorAll('[data-pinned="true"]')
    for (let attempt = 0; attempt < 30; attempt++) {
      await act(async () => { await flush() })
      pinnedRows = container.querySelectorAll('[data-pinned="true"]')
      if (pinnedRows.length > 0) break
    }
    expect(pinnedRows.length).toBe(1)
    // The pin landed on a *dropped* row, so it is still collapsed.
    expect(pinnedRows[0].getAttribute('aria-expanded')).toBe('false')

    // Expand the pinned row. That takes the open count to 51 — over the cap —
    // so the count-cap effect trims again, this time with the pin present.
    await act(async () => {
      (pinnedRows[0] as HTMLElement).click()
      await flush()
    })

    // Wait for the re-trim to settle (the chip stays up throughout).
    for (let attempt = 0; attempt < 80; attempt++) {
      await act(async () => { await flush() })
      chip = findCountCapChip(container)
      if (chip) break
    }
    expect(chip).not.toBeNull()

    // Back at the cap, and the pinned dir is one of the survivors even
    // though it is the deepest/last entry the trim would otherwise evict.
    const openBtnsAfter = Array.from(
      container.querySelectorAll('.wd-files-item[aria-expanded="true"]'),
    ) as HTMLElement[]
    expect(openBtnsAfter.length).toBe(50)
    const pinnedNames = openBtnsAfter
      .filter(b => b.getAttribute('data-pinned') === 'true')
      .map(getRowName)
    expect(pinnedNames).toContain(pinTargetName!)
  })

  it('Cmd/Ctrl+click again unpins the directory (toggles)', async () => {
    const { container, root } = await renderShell()
    lastContainer = container
    lastRoot = root as any

    const expandAllBtn = findExpandAllButton(container)
    await act(async () => {
      expandAllBtn!.click()
      await flush()
    })

    // Wait for initial trim.
    for (let attempt = 0; attempt < 80; attempt++) {
      await act(async () => { await flush() })
      if (findCountCapChip(container)) break
    }

    // Find any expanded leaf, pin it via Cmd-click.
    const expandedBtns = Array.from(
      // Scoped to tree rows: the depth-selector trigger also carries
      // `aria-expanded` (correct ARIA for a popover), so an unscoped query
      // counts it as a tree row and skews the totals by one.
      container.querySelectorAll('.wd-files-item[aria-expanded="true"]'),
    ) as HTMLElement[]
    const target = expandedBtns.find(b => getRowName(b).startsWith('A-leaf-'))
    // Must be found — the assertion below used to read
    // `expect(target).not.toBeDefined()`, which contradicted the very next
    // line and could never pass.
    expect(target).toBeDefined()
    const targetBtn = target as HTMLElement
    expect(targetBtn).toBeTruthy()

    await act(async () => {
      // MouseEvent is a constructor on the happy-dom *window*, not on its
      // document — `new doc.MouseEvent(...)` throws "not a constructor".
      const evt = new (win as any).MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      })
      targetBtn.dispatchEvent(evt)
      await flush()
    })

    // Poll for the data-pinned attribute.
    for (let attempt = 0; attempt < 30; attempt++) {
      await act(async () => { await flush() })
      if (container.querySelectorAll('[data-pinned="true"]').length > 0) break
    }
    expect(container.querySelectorAll('[data-pinned="true"]').length).toBe(1)

    // Cmd-click again — should unpin.
    const pinnedBtn = container.querySelector('[data-pinned="true"]') as HTMLElement
    expect(pinnedBtn).toBeTruthy()
    await act(async () => {
      // MouseEvent is a constructor on the happy-dom *window*, not on its
      // document — `new doc.MouseEvent(...)` throws "not a constructor".
      const evt = new (win as any).MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      })
      pinnedBtn.dispatchEvent(evt)
      await flush()
    })

    // Poll for unpin.
    for (let attempt = 0; attempt < 30; attempt++) {
      await act(async () => { await flush() })
      if (container.querySelectorAll('[data-pinned="true"]').length === 0) break
    }
    expect(container.querySelectorAll('[data-pinned="true"]').length).toBe(0)
  })
})
