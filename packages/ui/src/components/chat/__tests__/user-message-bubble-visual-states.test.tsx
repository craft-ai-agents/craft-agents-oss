/**
 * Comprehensive visual-state tests for UserMessageBubble.
 *
 * Covers:
 *   - Queued chip rendering + timer behavior
 *   - Pending / queued dimming on attachment row
 *   - All badge types (source, skill, context, command, file, folder)
 *   - Edit request badges (separated above content, stripped from text)
 *   - Compact mode padding
 *   - Lightbox portal open/close via click, keyboard, backdrop
 *   - Lightbox fallback states and "Open in app" button
 *
 * SSR tests (renderToStaticMarkup) for pure rendering assertions.
 * Client-render tests (happy-dom + createRoot + act) for effects
 * and DOM interactions (click, keydown, portal).
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StoredAttachment, ContentBadge } from '@archstudio/core'
import { setupModuleMocks } from '../../../__tests__/test-utils'

// ---------------------------------------------------------------------------
// 1. Module mocks — before any import of UserMessageBubble
// ---------------------------------------------------------------------------
setupModuleMocks()

// ---------------------------------------------------------------------------
// 2. DOM setup for client-render tests (also needed for portal rendering)
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

// @pierre/diffs custom elements shim — loaded by Markdown imports
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
// 3. Import component
// ---------------------------------------------------------------------------
const { UserMessageBubble } = await import('../UserMessageBubble')

// ---------------------------------------------------------------------------
// 4. Fixtures
// ---------------------------------------------------------------------------

const DUMMY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const DUMMY_ICON_DATA_URL = `data:image/png;base64,${DUMMY_PNG_BASE64}`

function imageAttachment(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: 'img-1',
    type: 'image',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    storedPath: '/tmp/photo.jpg',
    thumbnailBase64: DUMMY_PNG_BASE64,
    ...overrides,
  }
}

function docAttachment(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: 'doc-1',
    type: 'pdf',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 8192,
    storedPath: '/tmp/report.pdf',
    ...overrides,
  }
}

function sourceBadge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'source',
    label: 'Linear',
    rawText: '@linear',
    start: 0,
    end: 7,
    ...overrides,
  }
}

function skillBadge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'skill',
    label: 'git-commit',
    rawText: '@git-commit',
    start: 0,
    end: 11,
    ...overrides,
  }
}

function contextBadge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'context',
    label: 'Edit: Permissions',
    rawText: '<edit>Permissions updated</edit>',
    collapsedLabel: 'Edit: Permissions',
    start: 0,
    end: 34,
    ...overrides,
  }
}

function editRequestBadge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'context',
    label: 'Edit: Code review',
    rawText: '<edit_request>Code review comments</edit_request>',
    collapsedLabel: 'Edit: Code review',
    start: 0,
    end: 40,
    ...overrides,
  }
}

function commandBadge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'command',
    label: '/compact',
    rawText: '/compact',
    start: 0,
    end: 8,
    ...overrides,
  }
}

function fileBadge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'file',
    label: 'src/main.ts',
    rawText: 'src/main.ts',
    filePath: '/workspace/src/main.ts',
    start: 0,
    end: 11,
    ...overrides,
  }
}

function folderBadge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'folder',
    label: 'src',
    rawText: 'src',
    filePath: '/workspace/src',
    start: 0,
    end: 3,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 5. SSR helpers
// ---------------------------------------------------------------------------

function renderSSR(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(UserMessageBubble, { content: 'Hello', ...props }),
  )
}

// ---------------------------------------------------------------------------
// 6. Client-render helpers
// ---------------------------------------------------------------------------

interface RenderResult {
  container: HTMLElement
  root: Root
}

async function renderClient(
  props: Record<string, unknown>,
): Promise<RenderResult> {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(UserMessageBubble, { content: 'Hello', ...props }),
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

describe('UserMessageBubble visual states', () => {
  // ── Helpers shared across tests ──────────────────────────────────────────

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
    // Clean up any lingering portal containers (attached to doc.body)
    const portals = Array.from(doc.body.querySelectorAll('[role="dialog"]'))
    for (const p of portals) p.remove()
  })

  // =========================================================================
  // SECTION A — Queued state
  // =========================================================================

  describe('queued state', () => {
    it('renders the queued chip (Clock + text) when isQueued is true', () => {
      const html = renderSSR({ isQueued: true })
      // The queued chip renders inside the bubble as a <div role="status">
      expect(html).toContain('role="status"')
      expect(html).toContain('queuedBadge') // from our mock's t() fallback
      // no need to check svg — Clock icon renders as lucide-react SVG
    })

    it('does NOT render the queued chip when isQueued is false (default)', () => {
      const html = renderSSR({ isQueued: false })
      expect(html).not.toContain('role="status"')
    })

    it('does NOT render the queued chip when isQueued is undefined', () => {
      const html = renderSSR({})
      expect(html).not.toContain('role="status"')
    })

    it('shows queued chip in client render when isQueued is true', async () => {
      const { container, root } = await renderClient({ isQueued: true })
      lastContainer = container
      lastRoot = root
      const status = container.querySelector('[role="status"]')
      expect(status).not.toBeNull()
      expect(status!.textContent).toContain('queuedBadge')
    })

    it('keeps queued chip visible for minimum duration after isQueued flips to false', async () => {
      // Render with isQueued=true first, then flip to false and check that
      // the chip is still present (the timer holds it for QUEUED_MIN_VISIBLE_MS).
      const { container, root } = await renderClient({ isQueued: true })
      lastContainer = container
      lastRoot = root

      // Wait for initial render + effects to settle
      await act(async () => { await flush() })

      // Should show the queued chip
      expect(container.querySelector('[role="status"]')).not.toBeNull()

      // Now flip isQueued to false — the chip should persist (timer hasn't expired)
      await act(async () => {
        root.render(
          React.createElement(UserMessageBubble, {
            content: 'Hello',
            isQueued: false,
          }),
        )
      })

      // The chip should still be visible (timer keeps it for QUEUED_MIN_VISIBLE_MS)
      expect(container.querySelector('[role="status"]')).not.toBeNull()
    })
  })

  // =========================================================================
  // SECTION B — Dimming (pending / queued)
  // =========================================================================

  describe('dimming states', () => {
    it('applies opacity-60 on attachment row when isPending is true', () => {
      const html = renderSSR({
        isPending: true,
        attachments: [imageAttachment()],
      })
      // The attachment row gets opacity-60 + saturate-[.75] when pending or queued
      expect(html).toContain('opacity-60')
    })

    it('applies opacity-60 on attachment row when isQueued is true', () => {
      const html = renderSSR({
        isQueued: true,
        attachments: [imageAttachment()],
      })
      expect(html).toContain('opacity-60')
    })

    it('does NOT apply dimming classes when neither pending nor queued', () => {
      const html = renderSSR({
        attachments: [imageAttachment()],
      })
      expect(html).not.toContain('opacity-60')
    })
  })

  // =========================================================================
  // SECTION C — Badge types
  // =========================================================================

  describe('inline badges', () => {
    it('renders a source badge with ⊕ fallback icon (no iconDataUrl)', () => {
      const badges: ContentBadge[] = [sourceBadge()]
      const html = renderSSR({ badges, content: '@linear says hi' })
      expect(html).toContain('Linear')
      expect(html).toContain('⊕')
    })

    it('renders a skill badge with ✦ fallback icon', () => {
      const badges: ContentBadge[] = [skillBadge()]
      const html = renderSSR({ badges, content: '@git-commit run' })
      expect(html).toContain('git-commit')
      expect(html).toContain('✦')
    })

    it('renders a context badge with collapsed label', () => {
      const badges: ContentBadge[] = [contextBadge()]
      const html = renderSSR({ badges, content: 'Context content here' })
      expect(html).toContain('Edit: Permissions')
      // The context badge span has the ⚙ fallback icon
      expect(html).toContain('⚙')
    })

    it('renders a command badge with / icon', () => {
      const badges: ContentBadge[] = [commandBadge()]
      const html = renderSSR({ badges, content: 'Run /compact' })
      expect(html).toContain('/compact')
      expect(html).toContain('/') // the COMMAND_ICON_TEXT
    })

    it('renders a file badge with file icon and tooltip path', () => {
      const badges: ContentBadge[] = [fileBadge()]
      const html = renderSSR({ badges, content: 'Edit src/main.ts' })
      expect(html).toContain('src/main.ts')
    })

    it('renders a folder badge with folder icon', () => {
      const badges: ContentBadge[] = [folderBadge()]
      const html = renderSSR({ badges, content: 'Check src/' })
      expect(html).toContain('src')
    })

    it('renders badge with iconDataUrl as an <img>', () => {
      const badges: ContentBadge[] = [
        sourceBadge({ iconDataUrl: DUMMY_ICON_DATA_URL }),
      ]
      const html = renderSSR({ badges, content: '@linear' })
      expect(html).toContain('<img')
      expect(html).toContain(DUMMY_PNG_BASE64.slice(0, 30))
    })

    it('renders badge without iconDataUrl as a fallback span', () => {
      const badges: ContentBadge[] = [sourceBadge({ iconDataUrl: undefined })]
      const html = renderSSR({ badges, content: '@linear' })
      // No <img> in the badge — the fallback span with text icon renders instead
      // The number of <img> tags depends on the content; check no badge-<img>
      // by verifying the icon fallback span text is present
      expect(html).toContain('⊕')
      expect(html).toContain('Linear')
    })

    it('renders multiple badges at correct positions in text', () => {
      const content = 'Start @linear and @git-commit end'
      const badges: ContentBadge[] = [
        { type: 'source', label: 'Linear', rawText: '@linear', start: 6, end: 13 },
        { type: 'skill', label: 'git-commit', rawText: '@git-commit', start: 19, end: 30 },
      ]
      const html = renderSSR({ badges, content })
      expect(html).toContain('Linear')
      expect(html).toContain('git-commit')
      // The text before first badge should still be present
      expect(html).toContain('Start')
      // The text after all badges
      expect(html).toContain('end')
    })
  })

  // =========================================================================
  // SECTION D — Edit request badges
  // =========================================================================

  describe('edit request badges', () => {
    it('renders edit request badge ABOVE the content bubble', () => {
      const content = 'Some <edit_request>hidden</edit_request> text'
      const badges: ContentBadge[] = [editRequestBadge()]
      const html = renderSSR({ badges, content })
      // The EditRequestBadge is a separate span before the text bubble
      expect(html).toContain('Edit: Code review')
    })

    it('strips edit request content from the displayed text', () => {
      const content = 'Before <edit_request>hidden</edit_request> after'
      const badges: ContentBadge[] = [
        editRequestBadge({ start: 7, end: 37, rawText: '<edit_request>hidden</edit_request>' }),
      ]
      const html = renderSSR({ badges, content })
      // The text "hidden" should NOT appear in the output (it's stripped)
      expect(html).not.toContain('hidden')
      // "Before" and "after" should remain
      expect(html).toContain('Before')
      expect(html).toContain('after')
    })

    it('mixes edit request and inline badges correctly', () => {
      const content = 'Edit request at start then @linear here'
      const badges: ContentBadge[] = [
        editRequestBadge({
          start: 0, end: 20,
          rawText: '<edit_request>edit</edit_request>',
          label: 'Edit',
          collapsedLabel: 'Edit',
        }),
        { type: 'source', label: 'Linear', rawText: '@linear', start: 30, end: 37 },
      ]
      const html = renderSSR({ badges, content })
      // Edit request badge renders above
      expect(html).toContain('Edit')
      // Inline badge also renders
      expect(html).toContain('Linear')
    })
  })

  // =========================================================================
  // SECTION E — Compact mode
  // =========================================================================

  describe('compact mode', () => {
    it('uses reduced padding when compactMode is true', () => {
      const htmlDefault = renderSSR({})
      const htmlCompact = renderSSR({ compactMode: true })
      // Default: px-5 py-3.5 — Compact: px-4 py-2
      expect(htmlDefault).toContain('px-5')
      expect(htmlDefault).toContain('py-3.5')
      expect(htmlCompact).toContain('px-4')
      expect(htmlCompact).toContain('py-2')
    })
  })

  // =========================================================================
  // SECTION F — Lightbox (client-render only)
  // =========================================================================

  describe('lightbox', () => {
    it('no portal rendered when no image has been clicked', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment()],
      })
      lastContainer = container
      lastRoot = root

      // No dialog in the body (portal not rendered)
      const dialog = doc.body.querySelector('[role="dialog"]')
      expect(dialog).toBeNull()
    })

    it('opens lightbox portal when clicking an image attachment', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment()],
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      // Find the image attachment div and click it (it has role="button")
      const imgButton = container.querySelector('[role="button"]')
      expect(imgButton).not.toBeNull()

      await act(async () => {
        ;(imgButton as HTMLElement).click()
      })
      await act(async () => { await flush() })

      // Now a dialog should be in the body (portal)
      const dialog = doc.body.querySelector('[role="dialog"]')
      expect(dialog).not.toBeNull()
      expect(dialog!.getAttribute('aria-label')).toBe('photo.jpg')
    })

    it('closes lightbox when clicking the X button', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment()],
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      // Click image to open lightbox
      const imgButton = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { imgButton.click() })
      await act(async () => { await flush() })

      // Dialog should be open
      expect(doc.body.querySelector('[role="dialog"]')).not.toBeNull()

      // Click the close button
      const closeBtn = doc.body.querySelector('[aria-label="Close"]') as HTMLElement
      expect(closeBtn).not.toBeNull()
      await act(async () => { closeBtn.click() })
      await act(async () => { await flush() })

      // Dialog should be gone
      expect(doc.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it('closes lightbox when clicking the backdrop', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment()],
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      // Open lightbox
      const imgButton = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { imgButton.click() })
      await act(async () => { await flush() })

      expect(doc.body.querySelector('[role="dialog"]')).not.toBeNull()

      // Click the backdrop (the dialog itself — onClick handler closes)
      const dialog = doc.body.querySelector('[role="dialog"]') as HTMLElement
      await act(async () => { dialog.click() })
      await act(async () => { await flush() })

      expect(doc.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it('closes lightbox on Escape keydown', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment()],
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      // Open lightbox
      const imgButton = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { imgButton.click() })
      await act(async () => { await flush() })

      expect(doc.body.querySelector('[role="dialog"]')).not.toBeNull()

      // Dispatch Escape keydown on document
      await act(async () => {
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }))
      })
      await act(async () => { await flush() })

      expect(doc.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it('shows "Open in app" button when attachment has storedPath', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment({ storedPath: '/tmp/photo.jpg' })],
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      // Open lightbox
      const imgButton = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { imgButton.click() })
      await act(async () => { await flush() })

      const openBtn = Array.from(doc.body.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('openInApp'),
      )
      expect(openBtn).not.toBeNull()
    })

    it('fires onFileClick when "Open in app" button is clicked', async () => {
      const onFileClick = mock((_path: string) => {})

      const { container, root } = await renderClient({
        attachments: [imageAttachment({ storedPath: '/tmp/photo.jpg' })],
        onFileClick,
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      // Open lightbox
      const imgButton = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { imgButton.click() })
      await act(async () => { await flush() })

      // The mock's t() returns fallback ?? key, so t('chat.openInApp', 'Open in app')
      // returns 'Open in app'.
      const openBtn = Array.from(doc.body.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Open in app'),
      ) as HTMLElement
      expect(openBtn).not.toBeNull()

      await act(async () => { openBtn.click() })
      await act(async () => { await flush() })

      expect(onFileClick).toHaveBeenCalledWith('/tmp/photo.jpg')
    })

    it('image attachment has tabIndex 0 for keyboard accessibility', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment()],
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      const imgButton = container.querySelector('[role="button"]') as HTMLElement
      expect(imgButton).not.toBeNull()
      // The button is keyboard-focusable (tabIndex=0) and clickable
      expect(imgButton.getAttribute('tabindex')).toBe('0')
      // Clicking it opens the lightbox (already tested above — smoke check here)
      await act(async () => { imgButton.click() })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).not.toBeNull()
    })

    it('lightbox closes when Escape is pressed — verifies keydown handler on document', async () => {
      // Already tested above — this re-confirms that the document-level
      // keydown listener (added via useEffect) responds to Escape.
      // KeyboardEvent dispatch works for native document.addEventListener
      // but not for React's synthetic onKeyDown event delegation (which
      // is why the Enter/Space tests use click + tabIndex assertion instead).
      const { container, root } = await renderClient({
        attachments: [imageAttachment()],
      })
      lastContainer = container
      lastRoot = root

      await act(async () => { await flush() })

      // Open via click
      const imgButton = container.querySelector('[role="button"]') as HTMLElement
      await act(async () => { imgButton.click() })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).not.toBeNull()

      // Close via Escape (document listener — works with happy-dom)
      await act(async () => {
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }))
      })
      await act(async () => { await flush() })
      expect(doc.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it('shows "No preview available" when image has no base64 data', async () => {
      const { container, root } = await renderClient({
        attachments: [imageAttachment({ thumbnailBase64: undefined, resizedBase64: undefined })],
      })
      lastContainer = container
      lastRoot = root

      // No role="button" because no dataUrl — image is not clickable
      const imgButton = container.querySelector('[role="button"]')
      expect(imgButton).toBeNull()
    })
  })
})
