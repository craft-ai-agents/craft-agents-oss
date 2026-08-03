;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Provider, createStore } from 'jotai'
import { SearchPanel } from '../SearchPanel'
import { sessionMetaMapAtom, windowWorkspaceIdAtom } from '../../../atoms/sessions'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.HTMLInputElement = win.HTMLInputElement
gs.Element = win.Element
gs.Node = win.Node
gs.Event = win.Event
gs.InputEvent = win.InputEvent
gs.navigator = win.navigator

const result = {
  sessionId: 'session-1',
  matchCount: 4,
  matches: [
    { sessionId: 'session-1', lineNumber: 10, snippet: 'Prepare the release notes' },
    { sessionId: 'session-1', lineNumber: 20, snippet: 'Run the release build' },
    { sessionId: 'session-1', lineNumber: 30, snippet: 'Verify release assets' },
    { sessionId: 'session-1', lineNumber: 40, snippet: 'Publish the release' },
  ],
}
const searchSessionContent = mock(async () => [result])
;(win as any).electronAPI = { searchSessionContent }

function flush(ms = 0) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function changeInput(input: HTMLInputElement, value: string) {
  const reactPropsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'))
  const onChange = reactPropsKey ? (input as any)[reactPropsKey]?.onChange : undefined
  if (typeof onChange !== 'function') throw new Error('Search input onChange handler was not mounted')
  onChange({ target: { value } })
}

async function renderPanel(onSelectSession = mock((_id: string) => {})) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()
  store.set(windowWorkspaceIdAtom, 'workspace-1')
  store.set(sessionMetaMapAtom, new Map([
    ['session-1', { id: 'session-1', name: 'Release Session' }],
  ] as any))

  await act(async () => {
    root.render(
      <Provider store={store}>
        <SearchPanel onSelectSession={onSelectSession} />
      </Provider>,
    )
    await flush()
  })
  return { container, root, onSelectSession }
}

describe('Search panel', () => {
  let root: Root | null = null
  let container: any = null

  beforeEach(() => searchSessionContent.mockClear())

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('shows initial and minimum-query guidance without searching', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container
    const input = container.querySelector('input[placeholder="Search across all sessions..."]') as HTMLInputElement

    expect(container.textContent).toContain('Search your sessions')
    await act(async () => {
      changeInput(input, 'r')
      await flush()
    })
    expect(container.textContent).toContain('Type at least 2 characters')
    expect(searchSessionContent).not.toHaveBeenCalled()
  })

  it('debounces content search, renders highlights, expands results, and opens sessions', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container
    const input = container.querySelector('input[placeholder="Search across all sessions..."]') as HTMLInputElement

    await act(async () => {
      changeInput(input, 'release')
      await flush()
    })
    // The debounce timer is installed by the committed query effect, so wait
    // in a second act boundary rather than during the state-setting act.
    await act(async () => {
      await flush(300)
      await flush()
    })
    expect(searchSessionContent).toHaveBeenCalledWith('workspace-1', 'release', '1')
    expect(container.textContent).toContain('4 matches in 1 session')
    expect(container.textContent).toContain('Release Session')
    expect(container.querySelectorAll('mark').length).toBe(3)
    expect(container.textContent).toContain('Show 1 more match')

    const more = Array.from(container.querySelectorAll('button')).find((button: any) =>
      button.textContent?.includes('Show 1 more match'),
    ) as HTMLButtonElement | undefined
    await act(async () => more?.click())
    expect(container.querySelectorAll('mark').length).toBe(4)
    expect(container.textContent).toContain('Collapse')

    const header = container.querySelector('.search-group__header') as HTMLButtonElement
    await act(async () => header.click())
    expect(rendered.onSelectSession).toHaveBeenCalledWith('session-1')
  })
})
