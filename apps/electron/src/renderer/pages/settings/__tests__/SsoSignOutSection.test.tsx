import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import '../../../__tests__/mock-i18n'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

Object.assign(globalThis, {
  DOMMatrix: class DOMMatrix {},
  ImageData: class ImageData {},
  Path2D: class Path2D {},
})

const { SsoSignOutSection } = await import('../SsoSignOutSection')

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

describe('SsoSignOutSection', () => {
  it('shows a Sign out button that invokes the SSO logout action', async () => {
    let logoutCalls = 0

    const view = render(<SsoSignOutSection onSignOut={async () => { logoutCalls += 1 }} />)

    fireEvent.click(view.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(logoutCalls).toBe(1)
    })
  })
})
