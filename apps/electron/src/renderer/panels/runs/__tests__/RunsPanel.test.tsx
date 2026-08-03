;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Provider, createStore } from 'jotai'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.navigator = win.navigator
gs.Blob = win.Blob
gs.URL = win.URL
gs.crypto = win.crypto

const exportSession = mock(async () => ({ version: 1, session: { id: 'run-1' } }))
;(win as any).electronAPI = {
  exportSession,
  getSessionMessages: mock(async () => ({ messages: [] })),
  searchMemories: mock(async () => []),
  createMemory: mock(async () => undefined),
}
Object.defineProperty(win.URL, 'createObjectURL', { value: () => 'blob:test', configurable: true })
Object.defineProperty(win.URL, 'revokeObjectURL', { value: () => {}, configurable: true })

const onDeleteSession = mock(async () => true)
const onArchiveSession = mock(() => {})
const onSendMessage = mock(() => {})
const onCreateSession = mock(async () => ({ id: 'new-run' }))

mock.module('../../../context/AppShellContext', () => ({
  useAppShellContext: () => ({
    onDeleteSession,
    onArchiveSession,
    onSendMessage,
    onCreateSession,
    activeWorkspaceId: 'workspace-1',
  }),
}))

const { RunsPanel } = await import('../RunsPanel')
const { sessionMetaMapAtom } = await import('../../../atoms/sessions')

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function renderPanel(onOpenSession = mock((_id: string) => {})) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()
  store.set(sessionMetaMapAtom, new Map([
    ['run-1', {
      id: 'run-1',
      workspaceId: 'workspace-1',
      name: 'Build release',
      createdAt: 1_700_000_000_000,
      lastMessageAt: 1_700_000_060_000,
      lastMessageRole: 'assistant',
      messageCount: 4,
      isProcessing: false,
      tokenUsage: { totalTokens: 1200, inputTokens: 800, outputTokens: 400, costUsd: 0.012 },
    }],
    ['run-2', {
      id: 'run-2',
      workspaceId: 'workspace-1',
      name: 'Live analysis',
      createdAt: 1_700_000_100_000,
      lastMessageAt: 1_700_000_120_000,
      messageCount: 2,
      isProcessing: true,
    }],
  ] as any))

  await act(async () => {
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(RunsPanel as any, { onOpenSession }),
      ),
    )
    await flush()
  })
  return { container, root, onOpenSession }
}

describe('Activity panel', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeEach(() => {
    exportSession.mockClear()
    onDeleteSession.mockClear()
    onArchiveSession.mockClear()
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('renders status, spend, and opens the selected session', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container
    const renderedContainer = rendered.container as HTMLElement

    expect(renderedContainer.textContent).toContain('Activity')
    expect(renderedContainer.textContent).toContain('1 active')
    expect(renderedContainer.textContent).toContain('1,200 tokens')
    expect(renderedContainer.textContent).toContain('Build release')
    expect(renderedContainer.textContent).toContain('Completed')
    expect(renderedContainer.textContent).toContain('Live analysis')
    expect(renderedContainer.textContent).toContain('Running')

    const row = Array.from(renderedContainer.querySelectorAll<HTMLElement>('[role="button"]')).find((element) =>
      element.getAttribute('title') === 'Open "Build release"',
    ) ?? null
    expect(row).not.toBeNull()
    await act(async () => row?.click())
    expect(rendered.onOpenSession).toHaveBeenCalledWith('run-1')
  })

  it('exports an activity through the preload contract', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container
    const renderedContainer = rendered.container as HTMLElement

    const save = Array.from(renderedContainer.querySelectorAll('button')).find((button) =>
      button.getAttribute('aria-label') === 'Save activity' && button.closest('.runs-panel__item')?.textContent?.includes('Build release'),
    ) as HTMLButtonElement | undefined
    expect(save).toBeDefined()

    await act(async () => {
      save?.click()
      await flush()
      await flush()
    })
    expect(exportSession).toHaveBeenCalledWith('run-1')
  })
})
