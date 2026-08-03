/**
 * Unit test for ThumbnailHoverPreview.
 *
 * Validates:
 *   - Debounced hover triggers a single readFilePreviewDataUrl IPC call
 *   - Popover renders the loaded image once the IPC resolves
 *   - Mouseleave + 60ms grace period hides the popover
 *   - LRU cache re-hits on second hover without extra IPC
 *
 * NOTE: bun's `mock.module` must be registered BEFORE the dynamic
 * `await import(...)` that loads the component.
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

// Stub ResizeObserver for motion/react.
gs.ResizeObserver = class MockResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.cb = cb }
  observe(target: Element) {
    this.cb(
      [{ contentRect: { width: 1280, height: 800 }, target } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

// Stub IntersectionObserver for motion/react.
gs.IntersectionObserver = class MockIntersectionObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

// -------------------------------------------------------------------------
// 2. Mock motion/react — render AnimatePresence + motion.div as plain divs
//    so we don't need the real animation engine.
// -------------------------------------------------------------------------
mock.module('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: React.forwardRef<HTMLDivElement, any>((props, ref) =>
      React.createElement('div', { ...props, ref }),
    ),
  },
}))

// -------------------------------------------------------------------------
// 3. Mock @/lib/utils — cn just joins class names.
// -------------------------------------------------------------------------
mock.module('@/lib/utils', () => ({
  cn: (...inputs: (string | undefined | null | false)[]) =>
    inputs.filter(Boolean).join(' '),
}))

// -------------------------------------------------------------------------
// 4. electronAPI mock — track IPC calls and return canned data.
// -------------------------------------------------------------------------
const ipcCalls: Array<{ path: string; size: number }> = []

const readFilePreviewDataUrl = mock(
  async (path: string, size: number): Promise<string> => {
    ipcCalls.push({ path, size })
    // Return a tiny base64 PNG so the popover renders an <img>
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  },
)

;(win as any).electronAPI = { readFilePreviewDataUrl }

// -------------------------------------------------------------------------
// 5. Import component (AFTER the mocks are registered).
// -------------------------------------------------------------------------
const { ThumbnailHoverPreview } = await import('../ThumbnailHoverPreview')

// -------------------------------------------------------------------------
// 6. Helpers.
// -------------------------------------------------------------------------
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function renderComponent(overrides: Record<string, unknown> = {}) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)

  const file = { path: '/tmp/test.png', name: 'test.png', ...(overrides.file as Record<string, unknown> || {}) }
  const delay = (overrides.delay as number) ?? 150

  await act(async () => {
    root.render(
      React.createElement(
        // Props are assembled from an untyped `overrides` bag, so the component
        // is widened here rather than threading a full props type through the
        // dynamic-import harness.
        ThumbnailHoverPreview as unknown as React.ComponentType<Record<string, unknown>>,
        {
          file,
          delay,
          ...overrides,
        },
        React.createElement('img', {
          src: 'data:image/png;base64,dGVzdA==',
          alt: 'thumb',
          className: 'test-thumb',
        }),
      ),
    )
  })

  return { container, root }
}

// -------------------------------------------------------------------------
// 7. Tests.
//
// NOTE on event dispatch: React 18 implements `onMouseEnter`/`onMouseLeave`
// via native `mouseover`/`mouseout` events (not `mouseenter`/`mouseleave`).
// The tests dispatch `mouseover`/`mouseout` with `relatedTarget` to trigger
// the component's hover handlers.
// -------------------------------------------------------------------------
describe('ThumbnailHoverPreview', () => {
  let lastRoot: Root | null = null
  let lastContainer: HTMLElement | null = null
  let testFileId = 0

  beforeEach(() => {
    testFileId++
    ipcCalls.length = 0
    readFilePreviewDataUrl.mockClear()
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

  // happy-dom's MouseEvent init type is narrower than lib.dom's (it rejects a
  // null `relatedTarget`, which is exactly what "entered from outside the
  // document" means). Alias to the standard constructor type for the inits.
  const MouseEventCtor = win.MouseEvent as unknown as typeof globalThis.MouseEvent

  /** Helper: simulate entering the anchor with mouseover. */
  async function hoverAnchor(anchor: HTMLElement) {
    await act(async () => {
      anchor.dispatchEvent(new MouseEventCtor('mouseover', { bubbles: true, relatedTarget: null }))
    })
  }

  /** Helper: simulate leaving the anchor with mouseout. */
  async function unhoverAnchor(anchor: HTMLElement) {
    await act(async () => {
      anchor.dispatchEvent(new MouseEventCtor('mouseout', { bubbles: true, relatedTarget: doc.body as unknown as EventTarget }))
    })
  }

  /** Advance time by N ms inside act(), flushing pending rAF + microtasks.
   *
   *  Merges setTimeout(ms), a rAF-flushing setTimeout(0) (our rAF shim:
   *  setTimeout(() => cb(Date.now()), 0)), and a microtask flush into a
   *  single act() scope so any state updates triggered by the debounce
   *  timer, the reAnchor effect's rAF callback, and the async IPC mock's
   *  .then() all land inside act() — preventing "An update to Root inside
   *  a test was not wrapped in act(...)" warnings. */
  async function advanceTime(ms: number) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms))
      // Flush rAF shim: the component may schedule requestAnimationFrame
      // (via reAnchor effect) which our shim translates to setTimeout(0).
      await new Promise((r) => setTimeout(r, 0))
      // Flush any remaining microtasks (e.g. async IPC .then() callbacks).
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  // =========================================================================
  // Hover → debounce → IPC → popover
  // =========================================================================

  it('does NOT open the popover immediately on mouseover (hover debounce)', async () => {
    const { container, root } = await renderComponent({ delay: 150 })
    lastContainer = container
    lastRoot = root

    const anchor = container.querySelector('.thumbnail-hover-preview__anchor') as HTMLElement
    expect(anchor).not.toBeNull()

    await hoverAnchor(anchor)

    // No popover yet (debounce is 150ms, we haven't waited)
    const popover = doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')
    expect(popover).toBeNull()
    expect(ipcCalls.length).toBe(0)
  })

  it('opens the popover and calls IPC after the hover debounce delay', async () => {
    const id = testFileId
    const { container, root } = await renderComponent({
      delay: 20,
      file: { path: `/tmp/test-${id}.png`, name: 'test.png' },
    })
    lastContainer = container
    lastRoot = root

    const anchor = container.querySelector('.thumbnail-hover-preview__anchor') as HTMLElement

    await hoverAnchor(anchor)
    // Wait for debounce timer (20ms) to fire, plus flush rAF + microtasks
    await advanceTime(25)

    const popover = doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')
    expect(popover).not.toBeNull()
    expect(ipcCalls.length).toBe(1)
    expect(ipcCalls[0].path).toBe(`/tmp/test-${id}.png`)
    expect(ipcCalls[0].size).toBe(1024)
  })

  it('renders the loaded image inside the popover after IPC resolves', async () => {
    const id = testFileId
    const { container, root } = await renderComponent({
      delay: 20,
      file: { path: `/tmp/test-${id}.png`, name: 'test.png' },
    })
    lastContainer = container
    lastRoot = root

    const anchor = container.querySelector('.thumbnail-hover-preview__anchor') as HTMLElement

    await hoverAnchor(anchor)
    await advanceTime(25)

    const popover = doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')
    expect(popover).not.toBeNull()

    const img = popover!.querySelector('img.thumbnail-hover-preview__img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toContain('data:image/png;base64,')
  })

  // =========================================================================
  // Mouseleave → hide (60ms grace)
  // =========================================================================

  it('hides the popover after mouseout + 60ms grace period', async () => {
    const id = testFileId
    const { container, root } = await renderComponent({
      delay: 20,
      file: { path: `/tmp/test-${id}.png`, name: 'test.png' },
    })
    lastContainer = container
    lastRoot = root

    const anchor = container.querySelector('.thumbnail-hover-preview__anchor') as HTMLElement

    // Open the popover
    await hoverAnchor(anchor)
    await advanceTime(25)
    expect(doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')).not.toBeNull()

    // Mouseout — popover should still be visible (60ms grace timer)
    await unhoverAnchor(anchor)
    expect(doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')).not.toBeNull()

    // After 65ms the grace timer fires and the popover closes
    await advanceTime(65)
    expect(doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')).toBeNull()
  })

  // =========================================================================
  // LRU cache — second hover reuses cached data, no extra IPC
  // =========================================================================

  it('reuses the LRU cache on second hover (no extra IPC)', async () => {
    const id = testFileId
    const { container, root } = await renderComponent({
      delay: 20,
      file: { path: `/tmp/test-${id}.png`, name: 'test.png' },
    })
    lastContainer = container
    lastRoot = root

    const anchor = container.querySelector('.thumbnail-hover-preview__anchor') as HTMLElement

    // First hover: open → 1 IPC call
    await hoverAnchor(anchor)
    await advanceTime(25)
    expect(ipcCalls.length).toBe(1)

    // Close
    await unhoverAnchor(anchor)
    await advanceTime(65)
    expect(doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')).toBeNull()

    // Second hover → should NOT re-call IPC (LRU cache hit)
    await hoverAnchor(anchor)
    await advanceTime(25)

    expect(doc.querySelector('[data-testid="thumbnail-hover-preview-popover"]')).not.toBeNull()
    // IPC count unchanged — cache hit
    expect(ipcCalls.length).toBe(1)
  })
})
