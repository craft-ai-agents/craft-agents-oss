/**
 * Shared test utilities for `@archstudio/ui` tests.
 *
 * The main export is `setupModuleMocks()` — a function that registers
 * `mock.module()` calls for transitive dependencies that would otherwise
 * crash during module linking under `bun test`.  Every test file that
 * imports `UserMessageBubble` (or any component that pulls in Markdown,
 * react-pdf, or react-i18next) should call `setupModuleMocks()` at the
 * top level, before its first `import` or `await import()` statement.
 *
 * Why a function instead of a preload file?
 * -----------------------------------------
 * Bun's `mock.module` in `[test] preload` files does not reliably
 * intercept imports from the `packages/ui` test context.  A regular
 * module export avoids the preload dependency entirely — each test file
 * explicitly opts in by calling the function, and the mock takes effect
 * because `mock.module` runs synchronously before any dynamic import.
 */

import { mock } from 'bun:test'
import type { ReactNode } from 'react'

export function setupModuleMocks(): void {
  // -----------------------------------------------------------------------
  // react-i18next — UserMessageBubble calls useTranslation for tooltip
  // labels (clickToOpen, queuedBadge, openInApp, closeLightbox, contextBadge).
  // renderToStaticMarkup does not provide a React context tree, so we stub
  // useTranslation with a pass-through identity function.
  // -----------------------------------------------------------------------
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
      i18n: { language: 'en' },
    }),
    Trans: ({ children }: { children: ReactNode }) => children,
  }))

  // -----------------------------------------------------------------------
  // pdfjs-dist worker — MarkdownPdfBlock imports this with a ?url suffix.
  // Bun cannot resolve pdf.worker.min.mjs?url with a default export, so
  // the import fails during module linking unless mocked.
  // -----------------------------------------------------------------------
  mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
    default: '/assets/pdf.worker.min.mjs',
  }))

  // -----------------------------------------------------------------------
  // pdfjs-dist main module — several components import from pdfjs-dist at
  // module-load time.  The real module calls `new DOMMatrix()` during init,
  // which fails in environments without the DOMMatrix API.
  // -----------------------------------------------------------------------
  mock.module('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({}),
  }))
}
