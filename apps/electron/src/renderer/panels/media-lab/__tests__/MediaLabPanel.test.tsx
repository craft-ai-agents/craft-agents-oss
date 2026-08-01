/**
 * Smoke test for MediaLabPanel.
 *
 * Validates the loading → items → next-page wiring without the real
 * `react-window` `VariableSizeGrid` (which needs layout/measurements) or
 * a real `ResizeObserver`. The grid is mocked to capture `onItemsRendered`
 * so the test can fire a "scrolled near bottom" event deterministically.
 *
 * NOTE: bun's `mock.module` is NOT hoisted like Jest's `jest.mock`, so the
 * panel must be imported via `await import(...)` AFTER the mock is
 * registered. Static imports earlier in the file are fine.
 */

// React 18 read this flag at act() call time (not at import time), so it
// is safe to set after the static imports. Without it, every `act()` call
// emits `Warning: The current testing environment is not configured to
// support act(...)`.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Provider, createStore } from 'jotai'
import type { AppShellContextType } from '../../../context/AppShellContext'

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

// ResizeObserver is not in happy-dom by default. Stub it to fire the
// callback synchronously inside `observe()` so the panel's setContainerSize
// lands in the same act scope as the render — no act warning, and the
// grid sees width:1280 / height:800 immediately.
gs.ResizeObserver = class MockResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(target: Element) {
    this.cb(
      [{ contentRect: { width: 1280, height: 800 }, target } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

// -------------------------------------------------------------------------
// 2. react-window mock — capture onItemsRendered for deterministic paging.
// -------------------------------------------------------------------------
type OnItemsRendered = (args: {
  overscanRowStopIndex: number
  overscanColumnStopIndex: number
  visibleColumnStartIndex: number
  visibleColumnStopIndex: number
  visibleRowStartIndex: number
  visibleRowStopIndex: number
}) => void

let lastOnItemsRendered: OnItemsRendered | null = null

const mockReactWindow = {
  VariableSizeGrid: React.forwardRef<unknown, any>(function MockVariableSizeGrid(props, _ref) {
    lastOnItemsRendered = props.onItemsRendered ?? null
    const cells: React.ReactNode[] = []
    const rowCount = props.rowCount ?? 0
    const columnCount = props.columnCount ?? 0
    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < columnCount; col++) {
        cells.push(
          React.createElement(props.children, {
            key: `${row}-${col}`,
            columnIndex: col,
            rowIndex: row,
            style: { position: 'absolute', left: 0, top: 0, width: 100, height: 100 },
          }),
        )
      }
    }
    return React.createElement(
      'div',
      {
        className: 'react-window-mock',
        'data-row-count': rowCount,
        'data-col-count': columnCount,
        style: { position: 'relative', width: props.width, height: props.height },
      },
      cells,
    )
  }),
}
mock.module('react-window', () => mockReactWindow)

// -------------------------------------------------------------------------
// 3. electronAPI mock — manual queue with a buffered first page.
// -------------------------------------------------------------------------
type MediaItemShape = {
  kind: 'image' | 'video' | 'audio' | 'doc'
  name: string
  path: string
  size?: number
  sessionId: string
  sessionTitle: string
  lastMessageAt: number
}
type MediaListResponse = {
  items: MediaItemShape[]
  hasMore: boolean
  nextCursor: string | null
}

const mediaListCalls: unknown[] = []
let pageQueue: MediaListResponse[] = []
let callIndex = 0
let pendingFirstPage: ((value: MediaListResponse) => void) | null = null

const mediaList = mock(
  async (_request: unknown, _signal: AbortSignal): Promise<MediaListResponse> => {
    mediaListCalls.push(_request)
    const thisIndex = callIndex
    callIndex++
    if (thisIndex === 0) {
      // First page is slow — the test resolves via `pendingFirstPage(...)`.
      return new Promise<MediaListResponse>((resolve) => {
        pendingFirstPage = resolve
      })
    }
    return pageQueue[thisIndex] ?? { items: [], hasMore: false, nextCursor: null }
  },
)

let comfyConnected = true
const comfyHealth = mock(async () => ({
  connected: comfyConnected,
  baseUrl: 'http://127.0.0.1:8188',
  version: comfyConnected ? '0.28.3' : undefined,
  device: comfyConnected ? 'NVIDIA GeForce RTX 5070 Ti' : undefined,
  error: comfyConnected ? undefined : 'ComfyUI is offline',
}))
const comfyStart = mock(async () => ({
  connected: true,
  baseUrl: 'http://127.0.0.1:8188',
  version: '0.28.3',
  device: 'NVIDIA GeForce RTX 5070 Ti',
}))
const comfyWorkflows = mock(async () => ({
  rejectedCount: 2,
  workflows: [
    {
      id: 'agnes-image',
      name: 'Agnes Image',
      kind: 'image',
      nodeClasses: ['AgnesImage', 'SaveImage'],
      parameters: [{ id: '1.prompt', label: 'Prompt', kind: 'text', value: 'Studio portrait' }],
    },
    {
      id: 'agnes-video',
      name: 'Agnes Video',
      kind: 'video',
      nodeClasses: ['AgnesVideo', 'SaveVideo'],
      parameters: [{ id: '2.prompt', label: 'Prompt', kind: 'text', value: 'Slow camera move' }],
    },
  ],
}))
const comfyRun = mock(async () => ({ promptId: 'prompt-12345678' }))
const comfyStatus = mock(async (request: { promptId: string }) => ({ promptId: request.promptId, state: 'completed' }))
const comfyCancel = mock(async () => undefined)

;(win as any).electronAPI = {
  mediaList,
  comfyArtifacts: mediaList,
  comfyHealth,
  comfyStart,
  comfyWorkflows,
  comfyRun,
  comfyStatus,
  comfyCancel,
  readFilePreviewDataUrl: async () => 'data:image/png;base64,dGVzdA==',
}

// -------------------------------------------------------------------------
// 4. Mock the AppShellContext module — the panel calls `useAppShellContext`
//    which throws outside a provider. The real module exports
//    `useAppShellContext` but not the `AppShellContext` object itself, so
//    we mock the module to wire a stubbed context that the test's Provider
//    can supply. This keeps the source unchanged.
// -------------------------------------------------------------------------
const MockAppShellContext = React.createContext<AppShellContextType | null>(null)

mock.module('../../../context/AppShellContext', () => ({
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

// 5. Import panel (AFTER the mock is registered).
const { MediaLabPanel } = await import('../MediaLabPanel')

// -------------------------------------------------------------------------
// 5. Helpers.
// -------------------------------------------------------------------------
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function renderPanel() {
  // happy-dom's HTMLDivElement doesn't structurally match lib.dom.d.ts
  // (missing accessKeyLabel, autocapitalize, isConnected, etc.), so any
  // DOM-typed API (createRoot's `Container`, querySelector, etc.) rejects
  // it. `as any` at creation is the cleanest single-boundary fix.
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()

  // The panel only destructures `onOpenFile` from the context, so a
  // minimal stub cast to the full type is safe.
  const ctx = {
    onOpenFile: () => {},
  } as unknown as AppShellContextType

  function Wrapper() {
    return React.createElement(
      MockAppShellContext.Provider,
      { value: ctx },
      React.createElement(Provider, { store }, React.createElement(MediaLabPanel)),
    )
  }

  await act(async () => {
    root.render(React.createElement(Wrapper))
  })

  return { container, root, store }
}

// -------------------------------------------------------------------------
// 6. Tests.
// -------------------------------------------------------------------------
describe('MediaLabPanel smoke test', () => {
  let lastContainer: HTMLElement | null = null
  let lastRoot: Root | null = null

  beforeEach(() => {
    mediaListCalls.length = 0
    pageQueue = []
    callIndex = 0
    pendingFirstPage = null
    lastOnItemsRendered = null
    comfyConnected = true
    comfyHealth.mockClear()
    comfyStart.mockClear()
    comfyWorkflows.mockClear()
    comfyRun.mockClear()
    comfyStatus.mockClear()
    comfyCancel.mockClear()
  })

  afterEach(async () => {
    // Resolve any pending first page so the in-flight loadPage doesn't
    // surface an unhandled rejection on unmount.
    if (pendingFirstPage) {
      pendingFirstPage({ items: [], hasMore: false, nextCursor: null })
      pendingFirstPage = null
    }
    if (lastRoot) {
      await act(async () => lastRoot?.unmount())
      lastRoot = null
    }
    if (lastContainer && lastContainer.parentNode) {
      lastContainer.parentNode.removeChild(lastContainer)
      lastContainer = null
    }
  })

  it('shows loading, renders items, then fetches next page on near-bottom scroll', async () => {
    const firstPage: MediaListResponse = {
      items: [
        { name: 'a.png', path: '/tmp/a.png', kind: 'image', sessionId: 's1', sessionTitle: 'one', lastMessageAt: 100 },
        { name: 'b.mp4', path: '/tmp/b.mp4', kind: 'video', sessionId: 's1', sessionTitle: 'one', lastMessageAt: 100 },
      ],
      hasMore: true,
      nextCursor: 'c1',
    }
    pageQueue = [
      {
        items: [
          { name: 'c.wav', path: 'D:/Comfyui/output/c.wav', kind: 'audio', sessionId: 'comfyui:output', sessionTitle: 'ComfyUI output', lastMessageAt: 50 },
        ],
        hasMore: false,
        nextCursor: null,
      },
    ]

    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    // After mount, the panel's useEffect has called mediaList (once) and is
    // awaiting the slow first page. The Create tab is visible — no spinner.
    expect(container.querySelector('.media-panel__loading')).toBeNull()
    expect(mediaListCalls.length).toBe(1)

    // Click Library tab.
    await act(async () => {
      const buttons = container.querySelectorAll('button.media-tab')
      expect(buttons.length).toBe(3)
      const libraryButton = Array.from(buttons).find(
        (button: any) => button.textContent?.includes('Library'),
      ) as HTMLButtonElement
      libraryButton.click()
    })

    // Library tab is active + initialLoading is true → spinner visible.
    expect(container.querySelector('.media-panel__loading')).toBeTruthy()

    // Resolve the slow first page.
    await act(async () => {
      pendingFirstPage!(firstPage)
      await flush()
      await flush()
    })

    // Spinner hides, items render. The grid mock captured onItemsRendered.
    expect(container.querySelector('.media-panel__loading')).toBeNull()
    const cards = container.querySelectorAll('.media-card')
    expect(cards.length).toBe(2)
    expect(lastOnItemsRendered).not.toBeNull()

    // Wait for the ResizeObserver mock to fire (it uses queueMicrotask).
    await act(async () => {
      await flush()
    })

    // Trigger next page (overscan past the bottom) — replaces the
    // previous "IntersectionObserver sentinel entry" now that the panel
    // uses react-window's `onItemsRendered` for prefetch.
    await act(async () => {
      lastOnItemsRendered!({
        overscanRowStopIndex: 999,
        overscanColumnStopIndex: 0,
        visibleColumnStartIndex: 0,
        visibleColumnStopIndex: 0,
        visibleRowStartIndex: 0,
        visibleRowStopIndex: 0,
      })
      await flush()
    })

    // Second page fetched.
    expect(mediaListCalls.length).toBe(2)
  })

  it('loads real ComfyUI workflows and submits the selected image workflow', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    await act(async () => {
      await flush()
      await flush()
    })

    expect(comfyHealth).toHaveBeenCalledTimes(1)
    expect(comfyWorkflows).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('ComfyUI 0.28.3')
    expect(container.textContent).toContain('Agnes Image')
    expect(container.textContent).toContain('Image 1')
    expect(container.textContent).toContain('Video 1')
    expect(container.textContent).not.toContain('Coming soon')

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button: any) => button.textContent?.includes('Run image workflow'),
    ) as HTMLButtonElement
    await act(async () => {
      runButton.click()
      await flush()
      await flush()
    })

    expect(comfyRun).toHaveBeenCalledWith({
      workflowId: 'agnes-image',
      parameters: { '1.prompt': 'Studio portrait' },
    })
    expect(container.textContent).toContain('prompt-1')
  })

  it('starts an offline ComfyUI service from the header and refreshes workflows', async () => {
    comfyConnected = false
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    await act(async () => {
      await flush()
      await flush()
    })

    const startButton = Array.from(container.querySelectorAll('button')).find(
      (button: any) => button.textContent?.includes('Start ComfyUI'),
    ) as HTMLButtonElement
    expect(startButton).toBeTruthy()

    await act(async () => {
      startButton.click()
      await flush()
      await flush()
    })

    expect(comfyStart).toHaveBeenCalledTimes(1)
    expect(comfyWorkflows).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('ComfyUI Online')
  })
})
