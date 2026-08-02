;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { WorkspaceGraph } from '@archstudio/shared/knowledge'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.HTMLCanvasElement = win.HTMLCanvasElement
gs.Element = win.Element
gs.Node = win.Node
gs.Event = win.Event
gs.MouseEvent = win.MouseEvent
gs.navigator = win.navigator
gs.requestAnimationFrame = mock(() => 1)
gs.cancelAnimationFrame = mock(() => undefined)

beforeAll(() => {
  win.HTMLCanvasElement.prototype.getContext = mock(() => ({
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    fillText() {},
  })) as any
})

const graph: WorkspaceGraph = {
  nodes: [
    { id: 1, type: 'session', group: 'sessions', label: 'Node A', excerpt: 'A', metadata: {} },
    { id: 2, type: 'session', group: 'sessions', label: 'Node B', excerpt: 'B', metadata: {} },
  ],
  edges: [{ source: 1, target: 2, type: 'link' }],
  builtAt: Date.now(),
}

const updatedGraph: WorkspaceGraph = {
  nodes: [
    { id: 1, type: 'session', group: 'sessions', label: 'Node A', excerpt: 'A', metadata: {} },
    { id: 2, type: 'session', group: 'sessions', label: 'Node B', excerpt: 'B', metadata: {} },
    { id: 3, type: 'note', group: 'notes', label: 'Node C', excerpt: 'C', metadata: {} },
  ],
  edges: [
    { source: 1, target: 2, type: 'link' },
    { source: 2, target: 3, type: 'co-mention' },
  ],
  builtAt: Date.now() + 1,
}

const { KnowledgeGraphViewer } = await import('../KnowledgeGraphViewer')

function flush(ms = 0) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe('KnowledgeGraphViewer', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('keeps the same canvas when selection state changes', async () => {
    const onSelectNode = mock((_id: number) => {})
    const host = doc.createElement('div') as any
    container = host
    doc.body.appendChild(host)
    root = createRoot(host as any)

    await act(async () => {
      root?.render(
        React.createElement(KnowledgeGraphViewer, {
          graph,
          selectedNodeId: null,
          highlightedNodeIds: [],
          onSelectNode,
        }),
      )
      await flush()
    })

    const firstCanvas = host.querySelector('canvas')
    expect(firstCanvas).not.toBeNull()

    await act(async () => {
      root?.render(
        React.createElement(KnowledgeGraphViewer, {
          graph,
          selectedNodeId: 1,
          highlightedNodeIds: [2],
          onSelectNode,
        }),
      )
      await flush()
    })

    const secondCanvas = host.querySelector('canvas')
    expect(secondCanvas).toBe(firstCanvas)
    expect(host.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('recreates the canvas when graph topology changes', async () => {
    const onSelectNode = mock((_id: number) => {})
    const host = doc.createElement('div') as any
    container = host
    doc.body.appendChild(host)
    root = createRoot(host as any)

    await act(async () => {
      root?.render(
        React.createElement(KnowledgeGraphViewer, {
          graph,
          selectedNodeId: null,
          highlightedNodeIds: [],
          onSelectNode,
        }),
      )
      await flush()
    })

    const firstCanvas = host.querySelector('canvas')
    expect(firstCanvas).not.toBeNull()

    await act(async () => {
      root?.render(
        React.createElement(KnowledgeGraphViewer, {
          graph: updatedGraph,
          selectedNodeId: null,
          highlightedNodeIds: [],
          onSelectNode,
        }),
      )
      await flush()
    })

    const secondCanvas = host.querySelector('canvas')
    expect(secondCanvas).not.toBe(firstCanvas)
    expect(host.querySelectorAll('canvas')).toHaveLength(1)
  })
})
