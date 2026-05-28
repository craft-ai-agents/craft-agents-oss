import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { Window } from 'happy-dom'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

Object.assign(globalThis, {
  DOMMatrix: class DOMMatrix {},
  ImageData: class ImageData {},
  Path2D: class Path2D {},
})

const { ResponseCard } = await import('../TurnCard')

function setupDom() {
  const window = new Window()
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    navigator: window.navigator,
  })
  Object.assign(window, {
    SyntaxError,
  })
}

beforeEach(() => {
  setupDom()
})

afterEach(() => {
  cleanup()
})

describe('ResponseCard empty content', () => {
  it('does not render a completed response card for empty text', () => {
    const view = render(<ResponseCard text="" isStreaming={false} />)

    expect(view.container.firstChild).toBeNull()
  })

  it('does not render a completed response card for whitespace-only text', () => {
    const view = render(<ResponseCard text={'\n  \t'} isStreaming={false} />)

    expect(view.container.firstChild).toBeNull()
  })

  it('can transition from empty streaming text to visible content', () => {
    const view = render(<ResponseCard text="" isStreaming={true} streamStartTime={Date.now()} />)

    expect(view.container.firstChild).toBeNull()

    view.rerender(<ResponseCard text="Visible response text." isStreaming={false} />)

    expect(view.container.querySelector('[data-search-root="response"]')).not.toBeNull()
  })
})
