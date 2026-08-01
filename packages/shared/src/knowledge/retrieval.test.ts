import { describe, expect, it } from 'bun:test'
import { scoreNodesAgainstQuery } from './retrieval'
import type { WorkspaceGraph } from './types'

function graph(nodes: WorkspaceGraph['nodes']): WorkspaceGraph {
  return { nodes, edges: [], builtAt: 1 }
}

describe('knowledge retrieval', () => {
  it('treats regex metacharacters in a query as literal text', () => {
    const result = scoreNodesAgainstQuery(graph([
      {
        id: 10,
        label: 'API notes',
        type: 'session',
        group: 'workspace',
        excerpt: 'The foo[bar] endpoint is documented here.',
        metadata: { sessionId: 'session-1' },
      },
    ]), 'foo[bar]')

    expect(result.nodes.map((node) => node.id)).toEqual([10])
  })

  it('resolves scored nodes by node ID rather than array index', () => {
    const result = scoreNodesAgainstQuery(graph([
      {
        id: 42,
        label: 'Authentication',
        type: 'session',
        group: 'workspace',
        excerpt: 'Authentication flow',
        metadata: { sessionId: 'session-1' },
      },
    ]), 'authentication')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.id).toBe(42)
  })
})
