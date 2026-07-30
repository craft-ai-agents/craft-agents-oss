/**
 * Integration test for SessionFilesSection drill-mode behavior.
 *
 * Drill mode is the "click past the depth cap on a single row" affordance:
 *   • Click a gated chevron (forward expansion that would exceed the cap)
 *     → row expands + data-drilled="true" on the row's button
 *   • Click the same chevron to collapse → drill marker cleared
 *   • Click Collapse-all → both expandedPaths and drill cleared
 *
 * The data-drilled attribute is the test surface (analogous to existing
 * data-gated). Drill entry itself is ephemeral React state — we verify
 * via the DOM attribute, not by reading internal state.
 */
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// -------------------------------------------------------------------------
// 1. DOM setup — happy-dom provides browser globals on a single Window.
// -------------------------------------------------------------------------
const win = new Window({ url: 'http://localhost:5173', height: 800, width: 1280 })
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
  observe() {}
  unobserve() {}
  disconnect() {}
}
gs.IntersectionObserver = class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

// customElements stub (required by @pierre/diffs web-components).
// happy-dom doesn't provide the CustomElementRegistry API; the
// SessionFilesSection import chain transitively pulls in @pierre/diffs
// through the highlight diff components used in chat markdown blocks.
// Set on globalThis directly (the library reads `customElements` as a
// bare global, not `window.customElements`).
gs.customElements = {
  define: () => {},
  get: () => undefined,
  whenDefined: () => Promise.resolve(),
  upgrade: () => {},
}

// -------------------------------------------------------------------------
// 2. Mock pdfjs-dist worker URL + main module — same pattern as LayoutShell tests.
//    pdfjs-dist's worker file uses Vite's `?url` suffix import which bun
//    cannot resolve; the main pdfjs-dist module evaluates DOMMatrix at
//    module-load time which happy-dom doesn't provide.  Both stubs unblock
//    the SessionFilesSection import chain (which transitively pulls in
//    markdown components that import pdfjs-dist).
//
// IMPORTANT: this MUST run BEFORE the inline Tooltip primitives block
// below.  That block does `await import('@craft-agent/ui')` to capture
// the real module before mocking it; `@craft-agent/ui` transitively
// imports pdfjs-dist, so if pdfjs isn't mocked first, the import chain
// fails with "Missing 'default' export in module ... pdf.worker.min.mjs".
// -------------------------------------------------------------------------
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({}),
}))

// -------------------------------------------------------------------------
// 3. Inline Tooltip primitives — radix-portal-free.
//
// Why: SessionFilesSection wraps every gated chevron in a Radix
// `<TooltipContent forceMount>` to keep the gate-banner mounted even
// when the popover is closed (so screen readers can resolve the
// row's `aria-describedby` target).  Radix portals the content to
// `document.body` via a `useEffect`, which is *async* — happy-dom's
// microtask scheduling in bun:test makes the portal target racy
// across renders.  When a test probes the DOM immediately after a
// render, the banner is sometimes still travelling from the React
// tree to the portal target and the id-lookup returns null.
//
// Solution: replace the four tooltip primitives with inline-rendering
// shims that drop Radix's portal machinery entirely.  The banner
// stays inline inside the row's DOM tree, so:
//   • `doc.getElementById(gateBannerId)` resolves deterministically
//   • `aria-describedby → id` cross-reference is directly verifiable
//   • The implementation's contract (forceMount semantics) is
//     preserved — the banner IS mounted, just inline rather than
//     in a portal — which is exactly the contract screen readers
//     consume.
//
// Trade-off: the shim is **context-free by design**.  Real Radix
// `Tooltip` establishes an open-state context that `TooltipTrigger`
// and `TooltipContent` read for hover/focus/dismiss coordination.
// Our shims don't — `InlineTooltip` is a Fragment and
// `InlineTooltipTrigger` is a plain span.  Any future code that
// calls `useTooltipContext()` inside a Tooltip tree will silently
// get the empty default.  This is acceptable for this drill-mode
// test (we only probe forceMount semantics), but if a future test
// needs Radix's open-state behaviour it should mock Radix directly.
//
// We capture the real `@craft-agent/ui` module BEFORE registering
// the mock so we can spread its real exports (shouldGateManualExpand,
// trimExpandedByCount, cn, FileTypeIcon, markdown, etc.) into the
// mock object.  Only the four tooltip primitives are overridden;
// everything else uses the real implementation.
// -------------------------------------------------------------------------
const realUiModule = await import('@craft-agent/ui')

// Smoke-assert the capture succeeded.  This is a defensive guard: the
// inline Tooltip shim layer above depends on `realUiModule` spreading
// real exports (shouldGateManualExpand, trimExpandedByCount, cn, etc.)
// into the mocked @craft-agent/ui.  If a transitive import of
// `@craft-agent/ui` ever fails before our mocks register (e.g. a new
// markdown/highlighter dep that's not in the mock list yet), this
// fails fast with a clear hint instead of discovering the breakage
// three tests later.
if (
  typeof realUiModule.shouldGateManualExpand !== 'function' ||
  typeof realUiModule.trimExpandedByCount !== 'function'
) {
  throw new Error(
    'realUiModule capture broken — a transitive @craft-agent/ui import ' +
    'likely needs mocking before this block. The drill-mode mock layer ' +
    'spreads realUiModule.exports into @craft-agent/ui to keep ' +
    'shouldGateManualExpand/trimExpandedByCount/cn working.',
  )
}

const InlineTooltipProvider = ({
  children,
}: {
  children: React.ReactNode
}) => React.createElement(React.Fragment, null, children)

const InlineTooltip = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children)

const InlineTooltipTrigger = ({
  children,
  asChild: _asChild,
  ...rest
}: any) => React.createElement('span', rest, children)

const InlineTooltipContent = React.forwardRef<HTMLDivElement, any>(
  function InlineTooltipContent(
    { children, id, className, forceMount: _forceMount, ...rest },
    ref,
  ) {
    // Inline render — no portal.  `forceMount` is now an identity
    // (content always renders when this component is in the tree);
    // strip Radix dismiss/focus coordination handlers explicitly so
    // they don't silently no-op on the underlying div and mislead
    // readers into thinking dismiss/focus coverage exists.  Spread
    // remaining visual attributes (data-state, data-side, etc.)
    // verbatim.
    const {
      onPointerEnter: _onPointerEnter,
      onPointerLeave: _onPointerLeave,
      onPointerDown: _onPointerDown,
      onPointerDownOutside: _onPointerDownOutside,
      onPointerUpOutside: _onPointerUpOutside,
      onFocusOutside: _onFocusOutside,
      onInteractOutside: _onInteractOutside,
      onEscapeKeyDown: _onEscapeKeyDown,
      onOpenAutoFocus: _onOpenAutoFocus,
      onCloseAutoFocus: _onCloseAutoFocus,
      onKeyDown: _onKeyDown,
      avoidCollisions: _avoidCollisions,
      collisionBoundary: _collisionBoundary,
      collisionPadding: _collisionPadding,
      sticky: _sticky,
      hideWhenDetached: _hideWhenDetached,
      ...visualProps
    } = rest
    void _onPointerEnter; void _onPointerLeave; void _onPointerDown
    void _onPointerDownOutside; void _onPointerUpOutside; void _onFocusOutside
    void _onInteractOutside; void _onEscapeKeyDown; void _onOpenAutoFocus
    void _onCloseAutoFocus; void _onKeyDown; void _avoidCollisions
    void _collisionBoundary; void _collisionPadding; void _sticky
    void _hideWhenDetached
    return React.createElement(
      'div',
      { ref, id, className, ...visualProps },
      children,
    )
  },
)

mock.module('@craft-agent/ui', () => ({
  ...realUiModule,
  Tooltip: InlineTooltip,
  TooltipTrigger: InlineTooltipTrigger,
  TooltipContent: InlineTooltipContent,
  TooltipProvider: InlineTooltipProvider,
}))

// -------------------------------------------------------------------------
// 3. Mock motion/react — same as ThumbnailHoverPreview test, plus the
//    easing/animation primitives that packages/ui transitively imports
//    (e.g. ImageCardStack imports { animate, easeIn, mix, useMotionValue,
//    useTransform, wrap }).  Without these the SessionFilesSection import
//    chain fails at module-load time with "Export named 'easeIn' not found".
// -------------------------------------------------------------------------
const motionNoop = () => ({} as any)
// Factory that creates a forwardRef component rendering a plain HTML tag.
// Used for motion.div / motion.nav / etc.  Without `motion.nav` the
// FileTreeItem's staggered-children render throws "Element type is invalid"
// at module-load time.
const motionFactory = (tag: string) =>
  React.forwardRef<HTMLElement, any>((props, ref) =>
    React.createElement(tag as any, { ...props, ref }),
  )
mock.module('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: motionFactory('div'),
    nav: motionFactory('nav'),
  },
  // Easing functions used by packages/ui components (ImageCardStack, etc.)
  easeIn: motionNoop,
  easeOut: motionNoop,
  easeInOut: motionNoop,
  // Animation primitives
  animate: motionNoop,
  mix: motionNoop,
  useMotionValue: () => ({ current: 0 }),
  useTransform: () => ({ current: 0 }),
  useSpring: () => ({ current: 0 }),
  useScroll: () => ({ current: 0 }),
  useVelocity: () => ({ current: 0 }),
  useMotionTemplate: () => '',
  useAnimationFrame: () => {},
  wrap: (a: number, b: number) => (v: number) => v,
  usePresence: () => [true, null],
  LayoutGroup: ({ children }: any) => children,
}))

// -------------------------------------------------------------------------
// 3. Mock @/lib/utils — cn just joins class names.
// -------------------------------------------------------------------------
mock.module('@/lib/utils', () => ({
  cn: (...inputs: (string | undefined | null | false)[]) =>
    inputs.filter(Boolean).join(' '),
}))

// -------------------------------------------------------------------------
// 4. Mock @/lib/local-storage — no-op storage layer.
// -------------------------------------------------------------------------
mock.module('@/lib/local-storage', () => ({
  KEYS: { sessionFilesExpandedFolders: 'sessionFilesExpandedFolders' },
  getRaw: () => null,
  get: () => [],
  set: () => {},
}))

// -------------------------------------------------------------------------
// 5. Mock @/context/AppShellContext — minimal onOpenFile + openFile callback.
// -------------------------------------------------------------------------
mock.module('@/context/AppShellContext', () => ({
  useAppShellContext: () => ({
    onOpenFile: () => {},
  }),
}))

// -------------------------------------------------------------------------
// 6. Mock @/components/ui/styled-context-menu — stub render-only components.
//    Use forwardRef so Radix's asChild forwarding doesn't emit the
//    "Function components cannot be given refs" warning (which masks
//    actual test failures behind a noisy console).
// -------------------------------------------------------------------------
const passthroughRef = React.forwardRef<HTMLElement, any>((props, ref) => {
  void ref
  return props.children
})
mock.module('@/components/ui/styled-context-menu', () => ({
  ContextMenu: passthroughRef,
  ContextMenuTrigger: passthroughRef,
  StyledContextMenuContent: ({ children }: any) => children,
  StyledContextMenuItem: ({ children }: any) => children,
}))

// -------------------------------------------------------------------------
// 7. Mock @/lib/platform — file manager name for the View in Finder button.
// -------------------------------------------------------------------------
mock.module('@/lib/platform', () => ({
  getFileManagerName: () => 'Finder',
}))

// -------------------------------------------------------------------------
// 8. Mock ./session-files-watch — file watcher restoration no-op.
// -------------------------------------------------------------------------
mock.module('./session-files-watch', () => ({
  restoreSessionFileWatch: () => {},
}))

// -------------------------------------------------------------------------
// 9. Mock sonner toast — capture calls for assertions.
// -------------------------------------------------------------------------
const toastCalls: Array<{ message: string; opts?: any }> = []
mock.module('sonner', () => ({
  toast: {
    info: (message: string, opts?: any) => {
      toastCalls.push({ message, opts })
    },
  },
}))

// -------------------------------------------------------------------------
// 10. Mock react-i18next — useTranslation returns the key as the label.
// -------------------------------------------------------------------------
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: any) => {
      if (vars?.fileManager) return `${key}[${vars.fileManager}]`
      return key
    },
    i18n: { language: 'en' },
  }),
}))

// -------------------------------------------------------------------------
// 11. Mock ./ThumbnailHoverPreview — render children only.
// -------------------------------------------------------------------------
mock.module('./ThumbnailHoverPreview', () => ({
  ThumbnailHoverPreview: ({ children }: any) => children,
}))

// -------------------------------------------------------------------------
// 12. electronAPI mock — return canned file tree, no-op watchers.
// -------------------------------------------------------------------------
;(win as any).electronAPI = {
  getRuntimeEnvironment: () => 'electron',
  getSessionFiles: async () => buildTreeFixture(),
  watchSessionFiles: async () => {},
  unwatchSessionFiles: async () => {},
  onSessionFilesChanged: (_cb: any) => () => {},
  onReconnected: (_cb: any) => () => {},
  showInFolder: (_p: string) => {},
  openFile: (_p: string) => {},
  readFilePreviewDataUrl: async () => '',
}

/**
 * Build a depth-3 directory tree with UNIQUE row names so the test can
 * look up exactly the row it cares about.  Earlier version used the
 * non-unique name 'inner' for both alpha/inner and beta/inner, which
 * made the test selectors pick alphabetically first — silent fragility.
 *
 *   /test/wd                       (depth 0)
 *   /test/wd/alpha                 (depth 1)
 *   /test/wd/alpha/innerA          (depth 2, gated at cap=2)
 *   /test/wd/alpha/innerA/deep     (depth 3)
 *   /test/wd/beta                  (depth 1)
 *   /test/wd/beta/innerB           (depth 2, gated at cap=2)
 *   /test/wd/beta/innerB/deep      (depth 3)
 *   /test/wd/readme.md             (depth 1, file)
 */
function buildTreeFixture() {
  return [
    {
      path: '/test/wd',
      name: 'wd',
      type: 'directory',
      children: [
        {
          path: '/test/wd/alpha',
          name: 'alpha',
          type: 'directory',
          children: [
            {
              path: '/test/wd/alpha/innerA',
              name: 'innerA',
              type: 'directory',
              children: [
                {
                  path: '/test/wd/alpha/innerA/deep',
                  name: 'deep',
                  type: 'directory',
                  children: [],
                },
              ],
            },
          ],
        },
        {
          path: '/test/wd/beta',
          name: 'beta',
          type: 'directory',
          children: [
            {
              path: '/test/wd/beta/innerB',
              name: 'innerB',
              type: 'directory',
              children: [
                {
                  path: '/test/wd/beta/innerB/deep',
                  name: 'deep',
                  type: 'directory',
                  children: [],
                },
              ],
            },
          ],
        },
        {
          path: '/test/wd/readme.md',
          name: 'readme.md',
          type: 'file',
          size: 42,
        },
      ],
    },
  ]
}

// -------------------------------------------------------------------------
// 13. Import component (AFTER the mocks are registered).
// -------------------------------------------------------------------------
const { SessionFilesSection } = await import('../SessionFilesSection')
const { TooltipProvider } = await import('@craft-agent/ui')

// -------------------------------------------------------------------------
// 14. Helpers.
// -------------------------------------------------------------------------
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function renderComponent() {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(SessionFilesSection, {
          sessionId: 'test-session',
          sessionFolderPath: '/test/wd',
        }),
      ),
    )
  })

  // Wait for the IPC fetch + auto-expand to settle (default expandDepth=2).
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      await flush()
    })
    const rootRow = queryRowByName(container, 'wd')
    if (rootRow) break
  }

  return { container, root }
}

/** Find the row button whose name span matches exactly. */
function queryRowByName(container: HTMLElement, name: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
  for (const btn of buttons) {
    const nameSpan = btn.querySelector('span.flex-1, span[class*="flex-1"]') as HTMLElement | null
    if (nameSpan && nameSpan.textContent === name) return btn
  }
  return null
}

/** Click the chevron span inside a row button. */
function clickChevron(row: HTMLButtonElement) {
  const chevronSpan = row.querySelector('span[data-gated], span.cursor-pointer') as HTMLElement | null
  expect(chevronSpan).not.toBeNull()
  chevronSpan!.dispatchEvent(new (win as any).MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('SessionFilesSection drill-mode', () => {
  let lastRoot: Root | null = null
  let lastContainer: HTMLElement | null = null

  beforeEach(() => {
    toastCalls.length = 0
  })

  afterEach(async () => {
    if (lastRoot) {
      lastRoot.unmount()
      lastRoot = null
    }
    if (lastContainer && lastContainer.parentNode) {
      lastContainer.parentNode.removeChild(lastContainer)
      lastContainer = null
    }
  })

  // =========================================================================
  // Initial render sanity
  // =========================================================================

  it('renders depth-1 children (alpha, beta) on initial expand at depth=2', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    expect(queryRowByName(container, 'alpha')).not.toBeNull()
    expect(queryRowByName(container, 'beta')).not.toBeNull()

    // Depth-2 inner rows are NOT rendered yet — root + alpha expand,
    // but alpha's child ('innerA') is gated at cap=2, so its chevron
    // exists but clicking is a no-op (until drill).
    expect(queryRowByName(container, 'innerA')).not.toBeNull()
    expect(queryRowByName(container, 'innerB')).not.toBeNull()
  })

  // =========================================================================
  // Drill entry: gated chevron click → expand + data-drilled="true"
  // =========================================================================

  it('enters drill mode on gated chevron click + marks the row data-drilled', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    const innerRow = queryRowByName(container, 'innerA')
    expect(innerRow).not.toBeNull()
    expect(innerRow!.getAttribute('data-drilled')).toBeNull()

    // Click the chevron — gated click should enter drill mode.
    await act(async () => {
      clickChevron(innerRow!)
    })
    await act(async () => { await flush() })

    const innerRowAfter = queryRowByName(container, 'innerA')
    expect(innerRowAfter).not.toBeNull()
    expect(innerRowAfter!.getAttribute('data-drilled')).toBe('true')

    // Toast announced the drill entry.
    const drillToast = toastCalls.find((c) => c.message.includes('Drilled past depth cap'))
    expect(drillToast).toBeDefined()
  })

  // =========================================================================
  // Drill collapse: clicking the drilled chevron again clears the marker
  // =========================================================================

  it('clears drill marker when the drilled chevron is clicked again (collapse)', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    const innerRow = queryRowByName(container, 'innerA')
    expect(innerRow).not.toBeNull()

    // Drill entry.
    await act(async () => { clickChevron(innerRow!) })
    await act(async () => { await flush() })

    const innerRowAfterDrill = queryRowByName(container, 'innerA')
    expect(innerRowAfterDrill!.getAttribute('data-drilled')).toBe('true')

    // Click the chevron again — should collapse and clear drill.
    await act(async () => { clickChevron(innerRowAfterDrill!) })
    await act(async () => { await flush() })

    const innerRowAfterCollapse = queryRowByName(container, 'innerA')
    expect(innerRowAfterCollapse).not.toBeNull()
    expect(innerRowAfterCollapse!.getAttribute('data-drilled')).toBeNull()
  })

  // =========================================================================
  // Collapse-all: clears both expandedPaths and drilledPaths
  // =========================================================================

  it('clears drilledPaths when Collapse-all is clicked', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    // Drill a depth-2 row.
    const innerRow = queryRowByName(container, 'innerA')
    await act(async () => { clickChevron(innerRow!) })
    await act(async () => { await flush() })

    const innerRowAfterDrill = queryRowByName(container, 'innerA')
    expect(innerRowAfterDrill!.getAttribute('data-drilled')).toBe('true')

    // Confirm Collapse-all is visible.
    const collapseAll = container.querySelector('[data-testid="session-files-collapse-all"]') as HTMLElement | null
    expect(collapseAll).not.toBeNull()

    // Click it.
    await act(async () => {
      collapseAll!.dispatchEvent(new (win as any).MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await act(async () => { await flush() })

    // Drill markers cleared alongside expandedPaths — Collapse-all resets both.
    const innerAfter = queryRowByName(container, 'innerA')
    if (innerAfter) {
      expect(innerAfter.getAttribute('data-drilled')).toBeNull()
    }

    // Collapse-all hides itself (no expanded paths left).
    expect(container.querySelector('[data-testid="session-files-collapse-all"]')).toBeNull()
  })

  // =========================================================================
  // Drill is per-row: drilling row A doesn't affect row B
  // =========================================================================

  it('drilling row A leaves row B ungated (drill is per-row)', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    // Drill innerA.
    const innerA = queryRowByName(container, 'innerA')
    await act(async () => { clickChevron(innerA!) })
    await act(async () => { await flush() })

    expect(queryRowByName(container, 'innerA')!.getAttribute('data-drilled')).toBe('true')

    // innerB still ungated (no drill marker).
    expect(queryRowByName(container, 'innerB')!.getAttribute('data-drilled')).toBeNull()
  })

  // =========================================================================
  // Rapid-click idempotency: drilledPathsRef keeps the toast from firing
  // twice when the same gated chevron is clicked rapidly within the same
  // render cycle.
  // =========================================================================

  it('rapid clicks on the same gated chevron fire the toast only once', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    const innerRow = queryRowByName(container, 'innerA')
    expect(innerRow).not.toBeNull()

    const drillToastsBefore = toastCalls.filter((c) => c.message.includes('Drilled past depth cap')).length

    // Three rapid clicks in the same render cycle.
    // Without drilledPathsRef, each click would see the stale closure
    // and refire the toast.  With ref-sync, the second/third click
    // see the entry and skip the toast.
    await act(async () => {
      clickChevron(innerRow!)
      clickChevron(innerRow!)
      clickChevron(innerRow!)
    })
    await act(async () => { await flush() })

    const drillToastsAfter = toastCalls.filter((c) => c.message.includes('Drilled past depth cap')).length
    expect(drillToastsAfter - drillToastsBefore).toBe(1)
  })

  // =========================================================================
  // Session-switch: drill markers reset when sessionId changes.
  // =========================================================================

  it('session switch clears drill markers', async () => {
    const container = doc.createElement('div') as any
    doc.body.appendChild(container)
    const root = createRoot(container)
    lastContainer = container
    lastRoot = root

    // Initial render with session A.
    await act(async () => {
      root.render(
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(SessionFilesSection, {
            sessionId: 'session-A',
            sessionFolderPath: '/test/wd',
          }),
        ),
      )
    })
    for (let i = 0; i < 30; i++) {
      await act(async () => { await flush() })
      if (queryRowByName(container, 'innerA')) break
    }

    // Drill a row.
    const innerRow = queryRowByName(container, 'innerA')
    await act(async () => { clickChevron(innerRow!) })
    await act(async () => { await flush() })

    expect(queryRowByName(container, 'innerA')!.getAttribute('data-drilled')).toBe('true')

    // Capture the storage key for session A; the next render uses session B.
    // Switching sessionId clears drilledPaths via the session-switch useEffect.
    await act(async () => {
      root.render(
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(SessionFilesSection, {
            sessionId: 'session-B',
            sessionFolderPath: '/test/wd',
          }),
        ),
      )
    })
    for (let i = 0; i < 30; i++) {
      await act(async () => { await flush() })
    }

    // After session switch, drill markers reset.  The new session
    // starts fresh; innerA may not be visible until auto-expand fires.
    // Once it renders, data-drilled must be unset.
    const innerAfterSwitch = queryRowByName(container, 'innerA')
    if (innerAfterSwitch) {
      expect(innerAfterSwitch.getAttribute('data-drilled')).toBeNull()
    }
  })

  // =========================================================================
  // Accessibility: aria-describedby + forceMounted banner expose the gate
  // explanation to screen readers when a gated row receives focus.
  //
  // Screen readers announce an element's `aria-describedby` target when
  // the source element receives focus.  The implementation locks the
  // banner into the DOM via TooltipContent.forceMount so the announcement
  // resolves even when the popover is closed.  These tests verify the
  // DOM contract that screen readers depend on — the actual announcement
  // is the screen reader's responsibility.
  // =========================================================================

  it('gate banner is announced via aria-describedby when a gated row renders', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    // Find a gated row (depth 2 at cap=2 → isGated).
    const gatedRow = queryRowByName(container, 'innerA')
    expect(gatedRow).not.toBeNull()

    // (1) aria-describedby is set on the gated row.
    const describedById = gatedRow!.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    expect(describedById).not.toBe('')

    // (2) The banner is forceMounted into the DOM.  Because the test
    // replaces Radix TooltipContent with an inline-rendering shim
    // (see top-of-file "Inline Tooltip primitives"), the banner is a
    // sibling of the row button — `getElementById` resolves it
    // deterministically with no portal race.  Screen readers resolve
    // aria-describedby by walking the DOM tree the same way; if
    // getElementById resolves, the screen reader resolves.
    const banner = doc.getElementById(describedById!)
    expect(banner).not.toBeNull()
    expect(banner!.classList.contains('wd-files-gated-banner')).toBe(true)

    // (3) The banner's text is what the screen reader announces.  The
    // `.wd-files-gated-banner` class is exclusive to this element
    // type — no ambiguous match with other banners (useId produces a
    // unique id per row, so this lookup pins to the innerA banner
    // specifically, not e.g. innerB's banner).
    const bannerText = (banner!.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(bannerText).toContain('Capped at 2 levels')
    expect(bannerText).toContain('bump the selector to drill in')

    // (4) Focus the row button — screen readers re-read the
    // aria-describedby target on focus.  Focus must not unmount the
    // banner.
    await act(async () => {
      gatedRow!.focus()
    })
    await act(async () => { await flush() })

    // `doc.activeElement` is typed as `HTMLElement | SVGElement | null`
    // in happy-dom and `gatedRow` is `HTMLButtonElement` — the
    // intersection is non-trivial for TS, so cast to any to escape
    // the strict-overlap warning.  Runtime identity is what we need.
    expect((doc.activeElement as unknown) === (gatedRow as unknown)).toBe(true)
    const bannerAfterFocus = doc.getElementById(describedById!)
    expect(bannerAfterFocus).not.toBeNull()
    expect((bannerAfterFocus!.textContent ?? '')).toContain('Capped at 2 levels')
  })

  it('non-gated rows do NOT advertise a gate banner', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    // Depth-1 'alpha' is under cap=2 → not gated.
    const alpha = queryRowByName(container, 'alpha')
    expect(alpha).not.toBeNull()
    expect(alpha!.getAttribute('aria-describedby')).toBeNull()

    // Root 'wd' is depth 0 → not gated.
    const wd = queryRowByName(container, 'wd')
    expect(wd).not.toBeNull()
    expect(wd!.getAttribute('aria-describedby')).toBeNull()

    // 'readme.md' is a file (not a directory) → no chevron, no gate.
    const readme = queryRowByName(container, 'readme.md')
    expect(readme).not.toBeNull()
    expect(readme!.getAttribute('aria-describedby')).toBeNull()
  })

  it('drilled row drops the gate banner (isGated becomes false once isExpanded)', async () => {
    const { container, root } = await renderComponent()
    lastContainer = container
    lastRoot = root

    // innerA is gated at initial render (depth 2, cap 2, !isExpanded).
    const innerABefore = queryRowByName(container, 'innerA')
    expect(innerABefore).not.toBeNull()
    expect(innerABefore!.getAttribute('aria-describedby')).toBeTruthy()

    // Drill the row — expands it; isGated becomes false because
    // isExpanded is now true.  The gate banner is no longer relevant.
    await act(async () => { clickChevron(innerABefore!) })
    await act(async () => { await flush() })

    const innerAAfter = queryRowByName(container, 'innerA')
    expect(innerAAfter).not.toBeNull()
    expect(innerAAfter!.getAttribute('data-drilled')).toBe('true')
    // Drill-clears-gate: the row no longer advertises the gate banner.
    expect(innerAAfter!.getAttribute('aria-describedby')).toBeNull()
  })
})
