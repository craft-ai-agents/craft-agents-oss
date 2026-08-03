;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

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

const memory = {
  id: 'memory-1',
  class: 'semantic',
  title: 'Release convention',
  content: 'Use pending release notes for feature commits.',
  scope: 'workspace',
  confidence: 0.9,
  sensitivity: 'internal',
  source: {},
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
  tags: ['release', 'workflow'],
  archived: false,
  supersedesIds: [],
  category: 'convention',
  explicit: true,
}

const listMemories = mock(async () => [memory])
const searchMemories = mock(async (query: unknown) => [{ memory, score: 0.95, snippet: '<mark>Release</mark> convention', query }])
const getMemoryGraph = mock(async () => ({ memories: [memory], edges: [] }))
const getMemoryStats = mock(async () => ({
  classDistribution: { semantic: 1 },
  totalActive: 1,
  totalArchived: 0,
  ftsHealth: { memoriesRows: 1, ftsRows: 1, healthy: true },
  vault: { root: 'D:/vault', filesOnDisk: 1, lastImportAt: null },
  graph: { edgeCount: 0, edgeTypeDistribution: {} },
}))
const getVaultWatcherStatus = mock(async () => ({ active: true }))
const getMemoryEdges = mock(async () => [])

;(win as any).electronAPI = {
  listMemories,
  searchMemories,
  getMemoryGraph,
  getMemoryStats,
  getVaultWatcherStatus,
  getMemoryEdges,
  getVaultInfo: mock(async () => ({ path: 'D:/vault', isCustom: true, exists: true })),
  setVaultPath: mock(async () => ({ path: 'D:/vault', isCustom: true, exists: true })),
  openVaultFolder: mock(async () => undefined),
  syncVault: mock(async () => ({ imported: 0, exported: 0, errors: [] })),
  importMemoriesFromVault: mock(async () => ({ read: 0, imported: 0, skipped: 0, errors: [] })),
  createMemoryEdge: mock(async () => undefined),
  deleteMemoryEdge: mock(async () => undefined),
}

mock.module('../MemoryGraph', () => ({
  MemoryGraph: ({ memories }: { memories: unknown[] }) => React.createElement('div', { 'data-testid': 'memory-graph' }, `${memories.length} graph memories`),
}))

const { MemoryPanel } = await import('../MemoryPanel')

function flush(ms = 0) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function renderPanel(onSelectMemory = mock((_memory: unknown) => {})) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(MemoryPanel as any, { onSelectMemory }))
    await flush()
    await flush()
  })
  return { container, root, onSelectMemory }
}

describe('Memory panel', () => {
  let root: Root | null = null
  let container: any = null

  beforeEach(() => {
    listMemories.mockClear()
    searchMemories.mockClear()
    getMemoryGraph.mockClear()
    getMemoryStats.mockClear()
    getVaultWatcherStatus.mockClear()
    getMemoryEdges.mockClear()
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('loads and selects repository memories with search controls available', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    expect(listMemories).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Release convention')
    expect(container.textContent).toContain('90%')

    const item = Array.from(container.querySelectorAll('.memory-panel__item'))[0] as HTMLButtonElement
    await act(async () => {
      item.click()
      await flush()
    })
    expect(rendered.onSelectMemory).toHaveBeenCalledWith(expect.objectContaining({ id: 'memory-1' }))
    expect(getMemoryEdges).toHaveBeenCalledWith('memory-1')
    expect(container.textContent).toContain('Use pending release notes')

    const search = container.querySelector('input[placeholder="Search memories…"]') as HTMLInputElement
    const filter = container.querySelector('.memory-panel__filter-select') as HTMLSelectElement
    expect(search).not.toBeNull()
    expect(filter).not.toBeNull()
    expect(Array.from(filter.options).map((option) => option.value)).toContain('semantic')
  })

  it('loads stats and lazily fetches graph data', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    const statsButton = container.querySelector('button[title="Memory stats dashboard"]') as HTMLButtonElement
    await act(async () => {
      statsButton.click()
      await flush()
      await flush()
    })
    expect(getMemoryStats).toHaveBeenCalledTimes(1)
    expect(getVaultWatcherStatus).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('D:/vault')
    expect(container.textContent).toContain('Watcher: ● Active')

    const graphButton = container.querySelector('button[title="Graph view"]') as HTMLButtonElement
    await act(async () => {
      graphButton.click()
      await flush()
      await flush()
    })
    expect(getMemoryGraph).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="memory-graph"]')?.textContent).toBe('1 graph memories')
  })
})
