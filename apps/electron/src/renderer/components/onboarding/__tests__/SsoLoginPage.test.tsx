import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

Object.assign(globalThis, {
  DOMMatrix: class DOMMatrix {},
  ImageData: class ImageData {},
  Path2D: class Path2D {},
})

const { SsoLoginPage } = await import('../SsoLoginPage')

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

describe('SsoLoginPage', () => {
  it('starts SSO login and opens the returned authorization URL', async () => {
    const openedUrls: string[] = []

    Object.assign(window, {
      electronAPI: {
        startSsoLogin: async () => 'https://auth.example.test/oauth?client_id=desktop',
        openUrl: async (url: string) => {
          openedUrls.push(url)
        },
      },
    })

    const view = render(<SsoLoginPage onSuccess={() => {}} />)

    expect(view.getByText('Sign in to continue')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Login' }))

    await waitFor(() => {
      expect(openedUrls).toEqual(['https://auth.example.test/oauth?client_id=desktop'])
    })
    expect(view.getByRole('button').textContent).toContain('Waiting for sign-in...')
  })

  it('shows a callback error and keeps the login button available', () => {
    const view = render(<SsoLoginPage onSuccess={() => {}} result={{ success: false, error: 'invalid_grant' }} />)

    expect(view.getByText('invalid_grant')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Login' })).toBeTruthy()
  })
})
