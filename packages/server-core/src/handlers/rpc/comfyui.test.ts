import { describe, expect, it } from 'bun:test'
import { safeHistoryStatus } from './comfyui'

describe('ComfyUI job status safety', () => {
  it('returns useful node errors without returning inputs or credentials', () => {
    const result = safeHistoryStatus({
      status: {
        status_str: 'error',
        messages: [
          ['execution_start', { timestamp: 100 }],
          ['execution_error', {
            timestamp: 250,
            node_type: 'AgnesVideo',
            exception_message: 'API error 429: video generation rate limit exceeded',
            current_inputs: {
              api_key: ['never-return-this'],
              prompt: ['private prompt'],
            },
          }],
        ],
      },
    }, 'prompt-1')

    expect(result).toEqual({
      promptId: 'prompt-1',
      state: 'failed',
      stage: 'failed',
      startedAt: 100,
      finishedAt: 250,
      currentNode: 'AgnesVideo',
      error: 'API error 429: video generation rate limit exceeded',
    })
    expect(JSON.stringify(result)).not.toContain('never-return-this')
    expect(JSON.stringify(result)).not.toContain('private prompt')
  })
})
