import { describe, expect, it } from 'bun:test'
import { retryStaleRankReorder } from '../collection-reorder'

describe('retryStaleRankReorder', () => {
  it('refreshes and recomputes neighbors exactly once after a stale response', async () => {
    const sent: Array<{ sessionId: string; prevId?: string; nextId?: string }> = []
    let refreshes = 0

    await retryStaleRankReorder(
      { sessionId: 'moving', prevId: 'stale-prev', nextId: 'stale-next' },
      async (request) => {
        sent.push(request)
        if (sent.length === 1) throw new Error('RANK_NEIGHBORS_STALE')
      },
      async () => {
        refreshes += 1
      },
      () => ({ sessionId: 'moving', prevId: 'fresh-prev', nextId: 'fresh-next' }),
    )

    expect(refreshes).toBe(1)
    expect(sent).toEqual([
      { sessionId: 'moving', prevId: 'stale-prev', nextId: 'stale-next' },
      { sessionId: 'moving', prevId: 'fresh-prev', nextId: 'fresh-next' },
    ])
  })

  it('does not refresh for a non-stale command failure', async () => {
    let refreshes = 0

    await expect(
      retryStaleRankReorder(
        { sessionId: 'moving' },
        async () => {
          throw new Error('NETWORK_DOWN')
        },
        async () => {
          refreshes += 1
        },
        () => ({ sessionId: 'moving' }),
      ),
    ).rejects.toThrow('NETWORK_DOWN')

    expect(refreshes).toBe(0)
  })

  it('surfaces the retry failure instead of silently succeeding', async () => {
    let calls = 0

    await expect(
      retryStaleRankReorder(
        { sessionId: 'moving' },
        async () => {
          calls += 1
          throw new Error('RANK_NEIGHBORS_STALE')
        },
        async () => {},
        () => ({ sessionId: 'moving', prevId: 'fresh-prev' }),
      ),
    ).rejects.toThrow('RANK_NEIGHBORS_STALE')

    expect(calls).toBe(2)
  })
})
