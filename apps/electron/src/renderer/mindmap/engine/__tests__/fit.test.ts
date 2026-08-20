import { describe, expect, test } from 'bun:test'
import {
  addChild,
  autoLayout,
  createEmptyGraph,
  finalizeGraph,
  layoutBounds,
} from '@craft-agent/core/mindmap'
import {
  fitMindMapViewport,
  MIND_MAP_FIT_PADDING,
} from '../fit'
import { MIND_MAP_NODE_HEIGHT, MIND_MAP_NODE_WIDTH } from '../types'

describe('fitMindMapViewport', () => {
  test('waits for a measured mount, then keeps root and child boxes visible after fit', () => {
    const graph = createEmptyGraph({ type: 'note', noteId: 'note' }, 'Root')
    addChild(graph, graph.rootId, { id: 'child', label: 'Child', kind: 'heading' })
    finalizeGraph(graph, 'note')

    const layout = autoLayout(graph, {
      hGap: 200,
      vGap: 56,
      nodeWidth: MIND_MAP_NODE_WIDTH,
      nodeHeight: MIND_MAP_NODE_HEIGHT,
    })
    const bounds = layoutBounds(
      layout,
      Math.max(MIND_MAP_NODE_WIDTH, MIND_MAP_NODE_HEIGHT) / 2 + 24,
    )

    expect(fitMindMapViewport({ width: 0, height: 480 }, bounds)).toBeNull()

    const halfWidth = MIND_MAP_NODE_WIDTH / 2
    const halfHeight = MIND_MAP_NODE_HEIGHT / 2
    for (const size of [
      { width: 800, height: 480 },
      { width: 450, height: 240 },
    ]) {
      const viewport = fitMindMapViewport(size, bounds)
      expect(viewport).not.toBeNull()
      if (!viewport) throw new Error('expected measured viewport fit')

      for (const id of [graph.rootId, 'child']) {
        const position = layout.positions[id]!
        const left = position.x * viewport.zoom + viewport.x - halfWidth
        const right = position.x * viewport.zoom + viewport.x + halfWidth
        const top = position.y * viewport.zoom + viewport.y - halfHeight
        const bottom = position.y * viewport.zoom + viewport.y + halfHeight

        expect(left).toBeGreaterThanOrEqual(MIND_MAP_FIT_PADDING - 0.001)
        expect(right).toBeLessThanOrEqual(size.width - MIND_MAP_FIT_PADDING + 0.001)
        expect(top).toBeGreaterThanOrEqual(MIND_MAP_FIT_PADDING - 0.001)
        expect(bottom).toBeLessThanOrEqual(size.height - MIND_MAP_FIT_PADDING + 0.001)
      }
    }
  })
})
