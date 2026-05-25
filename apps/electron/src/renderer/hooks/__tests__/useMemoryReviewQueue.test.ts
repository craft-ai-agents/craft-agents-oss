import { describe, expect, mock, test } from 'bun:test'
import { applyMemoryReviewItem, type MemoryReviewApi } from '../useMemoryReviewQueue'
import type { MemoryReviewItem } from '@craft-agent/shared/memory/types'

describe('applyMemoryReviewItem', () => {
  test('does not mark stale update proposals as applied', async () => {
    const resolveMemoryReview = mock(async () => null)
    const api: MemoryReviewApi = {
      updateMemory: mock(async () => null),
      resolveMemoryReview,
    }

    await expect(applyMemoryReviewItem(api, reviewItem({
      action: 'update',
      body: 'Updated body',
      type: 'feedback',
    }))).rejects.toThrow(/Memory not found: stale preference/)
    expect(resolveMemoryReview).not.toHaveBeenCalled()
  })

  test('does not mark stale forget proposals as applied', async () => {
    const resolveMemoryReview = mock(async () => null)
    const api: MemoryReviewApi = {
      deleteMemory: mock(async () => false),
      resolveMemoryReview,
    }

    await expect(applyMemoryReviewItem(api, reviewItem({
      action: 'forget',
    }))).rejects.toThrow(/Memory not found: stale preference/)
    expect(resolveMemoryReview).not.toHaveBeenCalled()
  })

  test('marks successful proposals as applied', async () => {
    const resolveMemoryReview = mock(async () => null)
    const api: MemoryReviewApi = {
      saveMemory: mock(async () => ({
        name: 'stale preference',
        type: 'feedback' as const,
        body: 'Saved body',
        created: '2026-05-24',
      })),
      resolveMemoryReview,
    }

    await applyMemoryReviewItem(api, reviewItem({
      action: 'save',
      body: 'Saved body',
      type: 'feedback',
    }))
    expect(resolveMemoryReview).toHaveBeenCalledWith({ id: 'review_1', status: 'applied' })
  })
})

function reviewItem(overrides: Partial<MemoryReviewItem>): MemoryReviewItem {
  return {
    id: 'review_1',
    status: 'pending',
    action: 'save',
    scope: 'user',
    name: 'stale preference',
    confidence: 0.9,
    source: 'sidecar',
    createdAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  }
}
