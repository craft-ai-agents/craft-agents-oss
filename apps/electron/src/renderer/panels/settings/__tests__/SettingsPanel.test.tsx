;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.navigator = win.navigator
gs.localStorage = win.localStorage

// The panel is a host: its job is to render the navigator and swap in the page
// the navigator selects. The real pages pull in i18n, update-checker hooks and
// a wide electronAPI surface — none of which this component is responsible
// for — so they are stubbed and each page's own behaviour is tested elsewhere.
const pageMountCounts: Record<string, number> = {}

function makeStubPage(id: string) {
  return function StubPage() {
    React.useEffect(() => {
      pageMountCounts[id] = (pageMountCounts[id] ?? 0) + 1
    }, [])
    return <div data-testid={`page-${id}`}>{`stub:${id}`}</div>
  }
}

mock.module('@/pages/settings/settings-pages', () => ({
  getSettingsPageComponent: (subpage: string) => makeStubPage(subpage),
}))

mock.module('@/pages/settings/SettingsNavigator', () => ({
  default: ({
    selectedSubpage,
    onSelectSubpage,
  }: {
    selectedSubpage: string | null
    onSelectSubpage: (subpage: string) => void
  }) => (
    <div>
      <span data-testid="selected">{selectedSubpage ?? 'none'}</span>
      {['app', 'appearance', 'server'].map((id) => (
        <button key={id} type="button" data-testid={`nav-${id}`} onClick={() => onSelectSubpage(id)}>
          {id}
        </button>
      ))}
    </div>
  ),
}))

const { SettingsPanel } = await import('../SettingsPanel')

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function renderPanel() {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<SettingsPanel />)
    await flush()
  })
  return { container, root }
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await flush()
  })
}

describe('Settings panel', () => {
  let root: Root | null = null
  let container: any = null

  beforeEach(() => {
    for (const key of Object.keys(pageMountCounts)) delete pageMountCounts[key]
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('renders the navigator and defaults to the app page', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('app')
    expect(container.querySelector('[data-testid="page-app"]')).not.toBeNull()
  })

  it('swaps the detail pane to the selected page', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    await click(container.querySelector('[data-testid="nav-server"]'))

    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('server')
    expect(container.querySelector('[data-testid="page-server"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="page-app"]')).toBeNull()
  })

  it('remounts the page on change so it reloads its own state', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    expect(pageMountCounts.app).toBe(1)

    await click(container.querySelector('[data-testid="nav-appearance"]'))
    await click(container.querySelector('[data-testid="nav-app"]'))

    // Returning to a page must mount it again rather than reuse a stale tree.
    expect(pageMountCounts.app).toBe(2)
    expect(pageMountCounts.appearance).toBe(1)
  })

  it('does not resurrect the removed flat toggle list', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    // These belonged to the duplicate settings system this panel replaced.
    expect(container.querySelectorAll('label.settings-row').length).toBe(0)
    expect(container.querySelectorAll('.settings-switch').length).toBe(0)
    expect(container.textContent).not.toContain('Compact UI')
    expect(container.textContent).not.toContain('Coming soon')
  })
})
