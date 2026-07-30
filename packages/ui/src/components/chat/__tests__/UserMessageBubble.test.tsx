/**
 * UserMessageBubble — component-level contract tests.
 *
 * Covers the areas the component is responsible for:
 *   - Image sizing (single media tile vs 96×96 grid)
 *   - Lightbox open/close (click, Escape, backdrop)
 *   - Document bubble preservation (pills render, images get proper sizing)
 *   - Dimming on isPending / isQueued
 *   - No-base64 dead-affordance guard (image without data is not clickable)
 *
 * SSR tests (renderToStaticMarkup) for pure-rendering assertions.
 * Client-render tests (happy-dom + createRoot + act) for DOM interaction
 * tests that need useEffect / portals to fire.
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, describe, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StoredAttachment } from '@craft-agent/core'
import { setupModuleMocks } from '../../../__tests__/test-utils'

// ---------------------------------------------------------------------------
// 1. Module-level mocks — before any import of UserMessageBubble
// ---------------------------------------------------------------------------
setupModuleMocks()

// ---------------------------------------------------------------------------
// 2. DOM environment for client-render tests
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

// @pierre/diffs custom elements shim — needed by Markdown imports
gs.customElements = {
  get: () => undefined,
  define: () => {},
  whenDefined: () => Promise.resolve(),
  upgrade: () => {},
} as CustomElementRegistry

// pdfjs-dist DOMMatrix polyfill
if (typeof gs.DOMMatrix === 'undefined') {
  gs.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    m11 = 1; m12 = 0; m13 = 0; m14 = 0
    m21 = 0; m22 = 1; m23 = 0; m24 = 0
    m31 = 0; m32 = 0; m33 = 1; m34 = 0
    m41 = 0; m42 = 0; m43 = 0; m44 = 1
    is2D = true; isIdentity = true
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
// 3. Import component (dynamic — after mocks are registered)
// ---------------------------------------------------------------------------
const { UserMessageBubble } = await import('../UserMessageBubble')

// ---------------------------------------------------------------------------
// 4. Fixtures
// ---------------------------------------------------------------------------

/** Base64-encoded 1×1 transparent PNG (67 bytes). */
const DUMMY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function imgAtt(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: 'img',
    type: 'image',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    storedPath: '/tmp/photo.jpg',
    thumbnailBase64: DUMMY_PNG_BASE64,
    ...overrides,
  }
}

function docAtt(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: 'doc',
    type: 'pdf',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 8192,
    storedPath: '/tmp/report.pdf',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 5. SSR helper
// ---------------------------------------------------------------------------

function renderSSR(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(UserMessageBubble, { content: 'Hi', ...props }),
  )
}

// ---------------------------------------------------------------------------
// 6. Client-render helper
// ---------------------------------------------------------------------------

interface RenderResult {
  container: HTMLElement
  root: Root
}

async function renderClient(props: Record<string, unknown>): Promise<RenderResult> {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(UserMessageBubble, { content: 'Hi', ...props }),
    )
  })
  return { container, root }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ===========================================================================
// 7. TESTS
// ===========================================================================

describe('UserMessageBubble', () => {
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
    // Sweep any portal containers left over from lightbox tests
    for (const p of Array.from(doc.body.querySelectorAll('[role="dialog"]'))) {
      p.remove()
    }
  })

  // =========================================================================
  // Image sizing — 1 image vs 2+
  // =========================================================================

  describe('image sizing', () => {
    it('renders a single image at 240px media-tile size', () => {
      const html = renderSSR({ attachments: [imgAtt()] })
      expect(html).toContain('max-h-[240px]')
      expect(html).toContain('max-w-[240px]')
      // Should NOT contain grid sizing
      expect(html).not.toContain('h-24 w-24')
    })

    it('renders two images as 96×96 grid tiles', () => {
      const html = renderSSR({
        attachments: [
          imgAtt({ id: 'a', name: 'a.png', storedPath: '/tmp/a.png' }),
          imgAtt({ id: 'b', name: 'b.png', storedPath: '/tmp/b.png' }),
        ],
      })
      expect(html).toContain('h-24 w-24')
      expect(html).not.toContain('max-h-[240px]')
    })
  })

  // =========================================================================
  // Lightbox — click to open, Escape/backdrop/X to close
  // =========================================================================

  describe('lightbox', () => {
    it('opens a lightbox portal when clicking an image attachment', async () => {
      const { container, root } = await renderClient({ attachments: [imgAtt()] })
      lastContainer = container
      lastRoot = root
      await act(async () => { await flush() })

      const thumb = container.querySelector('[role="button"]') as HTMLElement
      expect(thumb).not.toBeNull()

      await act(async () => { thumb.click() })
      await act(async () => { await flush() })

      const dialog = doc.body.querySelector('[role="dialog"]')
      expect(dialog).not.toBeNull()
      expect(dialog!.getAttribute('aria-label')).toBe('photo.jpg')
    })

    it('closes the lightbox on Escape keydown', async () => {
      const { container, root } = await renderClient({ attachments: [imgAtt()] })
      lastContainer = container
      lastRoot = root
      await act(async () => { await flush() })

      // Open
      const thumb = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { thumb.click() })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).not.toBeNull()

      // Close via Escape (native document listener — works in happy-dom)
      await act(async () => {
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }))
      })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it('closes the lightbox when clicking the backdrop', async () => {
      const { container, root } = await renderClient({ attachments: [imgAtt()] })
      lastContainer = container
      lastRoot = root
      await act(async () => { await flush() })

      // Open
      const thumb = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { thumb.click() })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).not.toBeNull()

      // Click backdrop (the dialog wrapper itself — onClick handler closes)
      const dialog = doc.body.querySelector('[role="dialog"]') as HTMLElement
      await act(async () => { dialog.click() })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it('closes the lightbox when clicking the X close button', async () => {
      const { container, root } = await renderClient({ attachments: [imgAtt()] })
      lastContainer = container
      lastRoot = root
      await act(async () => { await flush() })

      // Open
      const thumb = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { thumb.click() })
      await act(async () => { await flush() })

      const closeBtn = doc.body.querySelector('[aria-label="Close"]') as HTMLElement
      expect(closeBtn).not.toBeNull()
      await act(async () => { closeBtn.click() })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).toBeNull()
    })
  })

  // =========================================================================
  // Document bubble preservation — docs render as pills, not images
  // =========================================================================

  describe('documents', () => {
    it('renders a PDF in a document pill (not an image tile)', () => {
      const html = renderSSR({ attachments: [docAtt()] })
      expect(html).toContain('report.pdf')
      // Document renders as a rounded pill with FileTypeIcon or thumbnail
      expect(html).toContain('rounded-[8px]')
    })

    it('renders a document without thumbnail using FileTypeIcon SVG', () => {
      const html = renderSSR({
        attachments: [docAtt({ thumbnailBase64: undefined })],
      })
      expect(html).toContain('report.pdf')
      // No <img> since no thumbnail — FileTypeIcon renders inline SVG instead
      expect(html).not.toContain('<img')
      expect(html).toContain('<svg')
    })

    it('preserves document pills when mixed with image attachments', () => {
      const html = renderSSR({
        attachments: [imgAtt(), docAtt()],
      })
      // Both names appear
      expect(html).toContain('report.pdf')
      expect(html).toContain('photo.jpg')
      // Single image sizing is applied (only 1 image in the mix)
      expect(html).toContain('max-h-[240px]')
    })
  })

  // =========================================================================
  // Dimming — pending and queued states dim the attachment row
  // =========================================================================

  describe('dimming', () => {
    it('applies opacity-60 when isPending is true with attachments', () => {
      const html = renderSSR({
        isPending: true,
        attachments: [imgAtt()],
      })
      expect(html).toContain('opacity-60')
    })

    it('applies opacity-60 when isQueued is true with attachments', () => {
      const html = renderSSR({
        isQueued: true,
        attachments: [imgAtt()],
      })
      expect(html).toContain('opacity-60')
    })

    it('does NOT dim when neither pending nor queued', () => {
      const html = renderSSR({ attachments: [imgAtt()] })
      expect(html).not.toContain('opacity-60')
    })
  })

  // =========================================================================
  // No-base64 dead-affordance guard — image without data is not clickable
  // =========================================================================

  describe('no-base64 guard', () => {
    it('does NOT set role="button" on an image with no base64 data', () => {
      const html = renderSSR({
        attachments: [imgAtt({ thumbnailBase64: undefined, resizedBase64: undefined })],
      })
      // The image wrapper renders but has no role="button" — no dead affordance
      expect(html).not.toContain('role="button"')
    })

    it('shows the FileTypeIcon fallback for an image with no base64 data', () => {
      const html = renderSSR({
        attachments: [imgAtt({ thumbnailBase64: undefined, resizedBase64: undefined })],
      })
      // No <img> tag renders — the inline SVG FileTypeIcon is shown instead
      expect(html).not.toContain('<img')
      expect(html).toContain('<svg')
    })

    it('renders an image with base64 data as clickable (role="button")', () => {
      const html = renderSSR({ attachments: [imgAtt()] })
      expect(html).toContain('role="button"')
    })
  })
})
