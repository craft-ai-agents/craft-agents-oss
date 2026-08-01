import { describe, expect, it } from 'bun:test'
import { buildWorkspaceGraph } from './graph-builder'

describe('buildWorkspaceGraph', () => {
  it('uses persisted message content when creating session excerpts', async () => {
    const result = await buildWorkspaceGraph([
      {
        id: 'session-1',
        title: 'Authentication work',
        createdAt: 1_700_000_000_000,
        messages: [{ content: 'Implemented OAuth callback validation.' }],
      },
    ], 'workspace')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.excerpt).toContain('Implemented OAuth callback validation.')
  })
})
