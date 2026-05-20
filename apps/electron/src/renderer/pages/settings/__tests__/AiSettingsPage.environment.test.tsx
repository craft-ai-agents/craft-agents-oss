import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { Window } from 'happy-dom'
import type { LlmConnectionWithStatus } from '@craft-agent/shared/config'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

Object.assign(globalThis, {
  DOMMatrix: class DOMMatrix {},
  ImageData: class ImageData {},
  Path2D: class Path2D {},
})

const { ConnectionRow, sortLlmConnectionsForSettings } = await import('../AiSettingsPage')

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
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
  })
  Object.assign(window, {
    SyntaxError,
    electronAPI: {
      getPiProviderBaseUrl: async () => undefined,
    },
  })
}

beforeEach(() => {
  setupDom()
})

afterEach(() => {
  cleanup()
})

function connection(overrides: Partial<LlmConnectionWithStatus>): LlmConnectionWithStatus {
  return {
    slug: 'anthropic-api',
    name: 'Anthropic',
    providerType: 'anthropic',
    authType: 'api_key',
    createdAt: 1,
    isAuthenticated: true,
    isDefault: false,
    ...overrides,
  }
}

describe('Settings AI environment connection', () => {
  it('pins environment connections before defaults and named connections', () => {
    const sorted = sortLlmConnectionsForSettings([
      connection({ slug: 'z-custom', name: 'Z Custom' }),
      connection({ slug: 'default-api', name: 'Default API', isDefault: true }),
      connection({
        slug: 'env-provider',
        name: 'Environment',
        providerType: 'pi_compat',
        authType: 'none',
        baseUrl: 'https://env.example.test/v1',
        isDefault: true,
        isEnvironmentConnection: true,
      }),
    ])

    expect(sorted.map((item) => item.slug)).toEqual(['env-provider', 'default-api', 'z-custom'])
  })

  it('renders a read-only Environment badge instead of the connection action menu', () => {
    const view = render(
      <ConnectionRow
        connection={connection({
          slug: 'env-provider',
          name: 'Environment',
          providerType: 'pi_compat',
          authType: 'none',
          baseUrl: 'https://env.example.test/v1',
          isDefault: true,
          isEnvironmentConnection: true,
        })}
        isLastConnection={false}
        onRenameClick={() => {}}
        onDelete={() => {}}
        onSetDefault={() => {}}
        onValidate={() => {}}
        onEdit={() => {}}
        onSetMidStreamBehavior={() => {}}
        validationState="idle"
      />,
    )

    expect(view.getByText((content) => content.includes('env.example.test'))).toBeTruthy()
    expect(view.getAllByText('Environment').length).toBeGreaterThanOrEqual(2)
    expect(view.queryByRole('button')).toBeNull()
  })
})
