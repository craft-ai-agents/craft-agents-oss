import { describe, it, expect } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StoredAttachment } from '@archstudio/core'

// ---------------------------------------------------------------------------
// Module-level mocks — must run before any import that resolves these
// specifiers, or the real modules get cached and mock.module has no effect.
// pdfjs-dist / react-i18next mocks are defined in the shared test-utils
// so all chat-component tests use the same stub.
// ---------------------------------------------------------------------------
import { setupModuleMocks } from '../../../__tests__/test-utils'
setupModuleMocks()

// Dynamic import — must use await import() instead of static import so
// mock.module is processed by Bun before the module graph resolves.
// (?url specifiers are an exception where static imports don't respect
// the mock from the same file.)
const { UserMessageBubble } = await import('../UserMessageBubble')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderBubble(attachments: StoredAttachment[]): string {
  return renderToStaticMarkup(
    React.createElement(UserMessageBubble, {
      content: 'Look at this',
      attachments,
    }),
  )
}

/** Base64-encoded 1x1 transparent PNG (minimal valid PNG, 67 bytes). */
const DUMMY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function imageWithThumbnail(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: 'img-thumb',
    type: 'image',
    name: 'screenshot.png',
    mimeType: 'image/png',
    size: 1024,
    storedPath: '/tmp/screenshot.png',
    thumbnailBase64: DUMMY_PNG_BASE64,
    ...overrides,
  }
}

function imageWithoutThumbnail(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    id: 'img-no-thumb',
    type: 'image',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    storedPath: '/tmp/photo.jpg',
    ...overrides,
    // explicitly no thumbnailBase64 or resizedBase64
  }
}

function documentAttachment(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserMessageBubble attachments', () => {
  // -- Thumbnail presence ----------------------------------------------------

  it('renders an <img> for an image attachment with thumbnailBase64', () => {
    const html = renderBubble([imageWithThumbnail()])
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).toContain(DUMMY_PNG_BASE64.slice(0, 30)) // partial match
  })

  it('renders an <img> for an image attachment with resizedBase64 (no thumbnailBase64)', () => {
    // The component uses `resizedBase64 ?? thumbnailBase64` — verify both
    // branches produce an img tag independently.
    const html = renderBubble([
      imageWithoutThumbnail({ resizedBase64: DUMMY_PNG_BASE64 }),
    ])
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/jpeg;base64,')
  })

  it('does NOT render an <img> for an image attachment without any base64 data', () => {
    const html = renderBubble([imageWithoutThumbnail()])
    // The attachment wrapper is still present but no <img> — the FileTypeIcon
    // inline SVG renders instead.  The only SVGs in a minimal-bubble render
    // are the icon fallback paths, so a positive SVG assertion is reliable here.
    expect(html).not.toContain('<img')
    expect(html).toContain('<svg') // FileTypeIcon renders inline SVGs
  })

  // -- Image sizing ----------------------------------------------------------

  it('applies single-image sizing classes when there is exactly one image', () => {
    const html = renderBubble([imageWithThumbnail()])
    // Single image → media-tile layout
    expect(html).toContain('max-h-[240px]')
    expect(html).toContain('max-w-[240px]')
  })

  it('applies grid sizing classes for two or more images', () => {
    const html = renderBubble([
      imageWithThumbnail({ id: 'img-1', name: 'a.png', storedPath: '/tmp/a.png' }),
      imageWithThumbnail({ id: 'img-2', name: 'b.png', storedPath: '/tmp/b.png' }),
    ])
    // Multi-image → fixed 96×96 grid
    expect(html).toContain('h-24 w-24')
    // Should NOT contain the single-image sizing
    expect(html).not.toContain('max-h-[240px]')
  })

  // -- Documents -------------------------------------------------------------

  it('renders document attachments in the bubble layout (not the image layout)', () => {
    const html = renderBubble([documentAttachment()])
    // Document bubble uses a rounded pill with the file name
    expect(html).toContain('report.pdf')
  })

  it('renders a document with thumbnailBase64 as an img inside the document bubble', () => {
    const html = renderBubble([
      documentAttachment({ thumbnailBase64: DUMMY_PNG_BASE64 }),
    ])
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,')
  })

  // -- Mixed attachments -----------------------------------------------------

  it('handles a mix of image and document attachments in one message', () => {
    const html = renderBubble([
      imageWithThumbnail({ id: 'img-1', name: 'screenshot.png', storedPath: '/tmp/screenshot.png' }),
      documentAttachment({ id: 'doc-1', name: 'report.pdf', storedPath: '/tmp/report.pdf' }),
    ])
    // Both should appear in the output
    expect(html).toContain('screenshot.png')
    expect(html).toContain('report.pdf')
    // The image gets the single-image sizing (since only 1 image)
    expect(html).toContain('max-h-[240px]')
  })
})
