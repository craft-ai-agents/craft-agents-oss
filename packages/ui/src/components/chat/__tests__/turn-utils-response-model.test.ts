import { describe, expect, it } from 'bun:test'
import { groupMessagesByTurn } from '../turn-utils'
import type { Message } from '@craft-agent/core'

describe('groupMessagesByTurn response metadata', () => {
  it('carries response model metadata onto assistant turns', () => {
    const turns = groupMessagesByTurn([
      {
        id: 'user-1',
        role: 'user',
        content: 'hi',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'hello',
        timestamp: 2,
        responseModel: 'pi/openai/gpt-5',
        responseConnectionName: 'OpenAI',
      },
    ] as Message[])

    const assistantTurn = turns.find((turn) => turn.type === 'assistant')
    expect(assistantTurn?.type).toBe('assistant')
    if (assistantTurn?.type !== 'assistant') throw new Error('assistant turn missing')
    expect(assistantTurn.response?.responseModel).toBe('pi/openai/gpt-5')
    expect(assistantTurn.response?.responseConnectionName).toBe('OpenAI')
  })
})
