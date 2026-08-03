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
gs.Event = win.Event
gs.KeyboardEvent = win.KeyboardEvent
gs.navigator = win.navigator
gs.customElements = win.customElements
gs.localStorage = win.localStorage
gs.performance = win.performance

const connections = [
  {
    slug: 'openai-main',
    name: 'OpenAI Main',
    providerType: 'pi',
    piAuthProvider: 'openai',
    authType: 'api_key',
    isAuthenticated: true,
    isConnected: true,
    isDefault: false,
    defaultModel: 'gpt-5.4',
    models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }],
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now() - 5_000,
  },
  {
    slug: 'claude-main',
    name: 'Claude Main',
    providerType: 'anthropic',
    authType: 'oauth',
    isAuthenticated: true,
    isConnected: true,
    isDefault: true,
    defaultModel: 'claude-sonnet-4-6',
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
    createdAt: Date.now() - 20_000,
    updatedAt: Date.now() - 4_000,
  },
]

const listLlmConnectionsWithStatus = mock(async () => connections)
const getHealthHeatmapAll = mock(async () => ({
  'openai-main': [{ date: '2026-08-01', total: 3, successful: 3, avgLatencyMs: 120 }],
}))
const getLlmInferenceHistoryAll = mock(async () => ({
  'openai-main': { totalEvents: 2, successCount: 2, failureCount: 0, avgLatencyMs: 140, events: [] },
}))
const testLlmConnection = mock(async () => ({ success: true }))
const recordHealthCheck = mock(async () => undefined)
const setDefaultLlmConnection = mock(async () => ({ success: true }))
const onLlmConnectionsChanged = mock((_cb: () => void) => () => {})
const onLlmInferenceChanged = mock((_cb: () => void) => () => {})

;(win as any).electronAPI = {
  listLlmConnectionsWithStatus,
  getHealthHeatmapAll,
  getLlmInferenceHistoryAll,
  testLlmConnection,
  recordHealthCheck,
  setDefaultLlmConnection,
  deleteLlmConnection: mock(async () => ({ success: true })),
  getWindowWorkspace: mock(async () => 'workspace-1'),
  getWorkspaceSettings: mock(async () => ({ defaultLlmConnection: 'claude-main' })),
  setWorkspaceDefaultLlmConnection: mock(async () => ({ success: true })),
  onLlmConnectionsChanged,
  onLlmInferenceChanged,
  getLlmConnection: mock(async () => null),
  getCredential: mock(async () => null),
}

mock.module('@/hooks/useOnboarding', () => ({
  useOnboarding: () => ({
    state: { step: 'provider-select' },
    reset: mock(() => {}),
    handleSelectProvider: mock(() => {}),
    handleContinue: mock(() => {}),
    handleBack: mock(() => {}),
  }),
}))

const { ProvidersPanel } = await import('../ProvidersPanel')

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function renderPanel() {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()
  await act(async () => {
    root.render(
      <Provider store={store}>
        <ProvidersPanel />
      </Provider>,
    )
    await flush()
    await flush()
  })
  return { container, root }
}

describe('Providers panel', () => {
  let root: Root | null = null
  let container: any = null

  beforeEach(() => {
    win.localStorage.clear()
    listLlmConnectionsWithStatus.mockClear()
    getHealthHeatmapAll.mockClear()
    getLlmInferenceHistoryAll.mockClear()
    testLlmConnection.mockClear()
    recordHealthCheck.mockClear()
    setDefaultLlmConnection.mockClear()
    onLlmConnectionsChanged.mockClear()
    onLlmInferenceChanged.mockClear()
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('loads connections, health data, and event subscriptions', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    expect(listLlmConnectionsWithStatus).toHaveBeenCalledTimes(1)
    expect(getHealthHeatmapAll).toHaveBeenCalledTimes(1)
    expect(getLlmInferenceHistoryAll).toHaveBeenCalledTimes(1)
    expect(onLlmConnectionsChanged).toHaveBeenCalledTimes(1)
    expect(onLlmInferenceChanged).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Providers')
    expect(container.textContent).toContain('OpenAI Main')
    expect(container.textContent).toContain('Claude Main')
    expect(container.textContent).toContain('Default')
    expect(container.textContent).toContain('2 total')
  })

  it('sets a non-default connection as the app default', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    const card = Array.from(container.querySelectorAll('.providers-panel__card')).find((element: any) =>
      element.textContent?.includes('OpenAI Main'),
    ) as HTMLElement | undefined
    expect(card).toBeDefined()
    const setDefault = card?.querySelector('button[title="Set as the app default"]') as HTMLButtonElement | null
    expect(setDefault).not.toBeNull()

    await act(async () => {
      setDefault?.click()
      await flush()
      await flush()
    })
    expect(setDefaultLlmConnection).toHaveBeenCalledWith('openai-main')
    expect(listLlmConnectionsWithStatus.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
