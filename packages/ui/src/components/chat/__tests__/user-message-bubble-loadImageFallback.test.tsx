/**
 * Client-render tests for UserMessageBubble's loadImageFallback mechanism.
 *
 * loadImageFallback is an async callback that loads an image data URL from
 * the main process via IPC when both resizedBase64 and thumbnailBase64 are
 * absent but the file type is image.  It fires inside a useEffect, so we
 * need a real DOM and client render (not renderToStaticMarkup) to test it.
 *
 * Pattern reference: apps/electron/src/renderer/panels/media-lab/__tests__/MediaLabPanel.test.tsx
 *   - happy-dom for DOM globals
 *   - createRoot + act for client render
 *   - mock.module for module-level stubs (Bun's mock.module is NOT hoisted,
 *     so imports must use `await import(...)` after the mock is registered)
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// ---------------------------------------------------------------------------
// 1. DOM setup — happy-dom provides browser globals on a single Window.
// ---------------------------------------------------------------------------
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

// @pierre/diffs registers a custom element on import. Happy-dom's Window
// has no customElements registry, so we shim it at the global level.
gs.customElements = {
  get: () => undefined,
  define: () => {},
  whenDefined: () => Promise.resolve(),
  upgrade: () => {},
} as CustomElementRegistry

// pdfjs-dist needs DOMMatrix (https://developer.mozilla.org/en-US/docs/Web/API/DOMMatrix).
// Happy-dom doesn't expose it — polyfill from the global scope.
if (typeof gs.DOMMatrix === 'undefined') {
  gs.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    m11 = 1; m12 = 0; m13 = 0; m14 = 0
    m21 = 0; m22 = 1; m23 = 0; m24 = 0
    m31 = 0; m32 = 0; m33 = 1; m34 = 0
    m41 = 0; m42 = 0; m43 = 0; m44 = 1
    is2D = true
    isIdentity = true
    constructor() {}
    multiply() { return this }
    translate() { return this }
    scale() { return this }
    rotate() { return this }
    rotateFromVector() { return this }
    rotateAxisAngle() { return this }
    skewX() { return this }
    skewY() { return this }
    flipX() { return this }
    flipY() { return this }
    inverse() { return this }
    transformPoint() { return this }
    toFloat32Array() { return new Float32Array(16) }
    toFloat64Array() { return new Float64Array(16) }
    setMatrixValue() { return this }
    toString() { return 'matrix(1,0,0,1,0,0)' }
  } as any
}

// ---------------------------------------------------------------------------
// 2. Register module mocks for transitive dependencies (react-i18next,
//    pdfjs-dist) that would fail during module linking.  Must run BEFORE
//    the `await import(...)` below because Bun mock.module is NOT hoisted.
// ---------------------------------------------------------------------------
import { setupModuleMocks } from '../../../__tests__/test-utils'
setupModuleMocks()

// ---------------------------------------------------------------------------
// 3. Import AFTER mocks are registered.
// ---------------------------------------------------------------------------
const { UserMessageBubble } = await import('../UserMessageBubble')
import type { StoredAttachment } from '@craft-agent/core'

// ---------------------------------------------------------------------------
// 4. Fixtures
// ---------------------------------------------------------------------------

/** 1×1 transparent PNG encoded as base64 (67 bytes). Reads as a valid image
 *  when decoded in a browser  */
const DUMMY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** Image attachment with NO base64 data — loadImageFallback is needed. */
function imageNeedingFallback(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: 'img-fallback',
    type: 'image',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    storedPath: '/tmp/photo.jpg',
    ...overrides,
    // explicitly no resizedBase64 or thumbnailBase64 — the fallback path
  }
}

/**
 * Render UserMessageBubble with the given attachments and loadImageFallback
 * into a detached DOM container.  Returns the container so the caller can
 * query it.
 *
 * NOTE: loadImageFallback fires inside a useEffect, so the returned promise
 * resolves AFTER React commits the initial render.  The caller should await
 * a microtask tick (`await Promise.resolve()` or `await flush()`) before
 * querying for fallback-loaded images.
 */
async function renderBubble(
  attachments: StoredAttachment[],
  loadImageFallback?: (path: string) => Promise<string | null>,
): Promise<{ container: HTMLElement; root: Root }> {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      React.createElement(UserMessageBubble, {
        content: 'Look at this',
        attachments,
        loadImageFallback,
      }),
    )
  })

  return { container, root }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// 5. Tests
// ---------------------------------------------------------------------------

describe('UserMessageBubble loadImageFallback', () => {
  let lastRoot: Root | null = null
  let lastContainer: HTMLElement | null = null

  afterEach(async () => {
    await act(async () => {
      if (lastRoot) {
        lastRoot.unmount()
        lastRoot = null
      }
      if (lastContainer && lastContainer.parentNode) {
        lastContainer.parentNode.removeChild(lastContainer)
        lastContainer = null
      }
    })
  })

  it('renders an <img> when loadImageFallback resolves with a data URL', async () => {
    const fb = mock(async (_path: string): Promise<string | null> => {
      return `data:image/jpeg;base64,${DUMMY_PNG_BASE64}`
    })

    const { container, root } = await renderBubble([imageNeedingFallback()], fb)
    lastContainer = container
    lastRoot = root

    // The mock resolves synchronously within act, so by the time the render
    // promise settles the useEffect has already fired and the img is rendered.
    // No separate "before" assertion needed — go straight to the "after" check.
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toContain('data:image/jpeg;base64,')
    expect(img!.getAttribute('src')).toContain(DUMMY_PNG_BASE64.slice(0, 30))

    // Verify the fallback was called with the correct storedPath.
    expect(fb).toHaveBeenCalledTimes(1)
    expect(fb).toHaveBeenCalledWith('/tmp/photo.jpg')
  })

  it('renders the icon fallback (no <img>) when loadImageFallback rejects', async () => {
    const fb = mock(async (_path: string): Promise<string | null> => {
      throw new Error('Network error')
    })

    const { container, root } = await renderBubble([imageNeedingFallback()], fb)
    lastContainer = container
    lastRoot = root

    // Let the useEffect fire and the mock rejection settle.
    await act(async () => {
      await flush()
    })

    // After the fallback rejects, no <img> should appear — the FileTypeIcon
    // SVG fallback renders instead (the `else` branch after `!dataUrl` &&
    // `!fallbackLoading`).
    expect(container.innerHTML).not.toContain('<img')

    // The FileTypeIcon renders an inline SVG (checking for <svg is reliable
    // because the only SVGs in a minimal-bubble render come from the icon
    // fallback; the document-bubble for non-image attachments is absent here).
    expect(container.innerHTML).toContain('<svg')

    // Verify the fallback was called.
    expect(fb).toHaveBeenCalledTimes(1)
    expect(fb).toHaveBeenCalledWith('/tmp/photo.jpg')
  })

  it('shows a spinning Loader2 icon while loadImageFallback is in flight', async () => {
    // Never resolve the promise — keep it pending.
    const fb = mock(async (_path: string): Promise<string | null> => {
      return new Promise(() => {}) // never settles
    })

    const { container, root } = await renderBubble([imageNeedingFallback()], fb)
    lastContainer = container
    lastRoot = root

    // After the initial render and a microtask tick, the fallback is in-flight
    // but not resolved.  The component should show the loading state: the
    // `fallbackLoading` branch renders a div with `animate-spin` + Loader2.
    await act(async () => {
      await flush()
    })

    // The container should have a spinning Loader2 icon (animate-spin),
    // visually distinct from the static FileTypeIcon shown on failure.
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()

    // Should NOT have an <img> yet (the promise never settled).
    expect(container.innerHTML).not.toContain('<img')

    // Verify the fallback was called.
    expect(fb).toHaveBeenCalledTimes(1)
  })

  it('omits loadImageFallback call when omitted in props — shows icon fallback directly', async () => {
    // No loadImageFallback prop — the icon fallback renders on initial render.
    const { container, root } = await renderBubble([imageNeedingFallback()])
    lastContainer = container
    lastRoot = root

    // No useEffect fires for the fallback (no callback), so no <img> appears.
    // The component renders the icon fallback immediately.
    expect(container.innerHTML).not.toContain('<img')

    // The FileTypeIcon SVG renders (the `else` branch after both `!dataUrl`
    // and `!fallbackLoading` are true because `loadImageFallback` is falsy,
    // so fallbackLoading is false).
    expect(container.innerHTML).toContain('<svg')
  })
})
