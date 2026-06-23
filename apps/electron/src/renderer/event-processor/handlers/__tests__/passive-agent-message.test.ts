import { describe, expect, it } from 'bun:test'
import { handleUserMessage } from '../session'
import type { SessionState, UserMessageEvent } from '../../types'

function makeState(): SessionState {
  return {
    session: {
      id: 'session-1',
      messages: [],
      lastMessageAt: Date.now(),
      lastMessageRole: 'assistant',
      isProcessing: true,
    } as any,
    streaming: null,
  }
}

describe('passive agent messages', () => {
  it('appends passive info notices without changing user-response state', () => {
    const state = makeState()
    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'session-1',
      status: 'accepted',
      message: {
        id: 'passive-1',
        role: 'info',
        content: 'Background agent "reviewer" started.',
        timestamp: 123,
        displayIntent: 'agent-message-passive',
        agentMessage: {
          receiptId: 'receipt-1',
          childSessionId: 'child-1',
          targetAgentSlug: 'reviewer',
          status: 'running',
        },
      },
    }

    const next = handleUserMessage(state, event)

    expect(next.state.session.messages).toHaveLength(1)
    expect(next.state.session.messages[0]?.role).toBe('info')
    expect(next.state.session.lastMessageRole).toBe('assistant')
    expect(next.state.session.isProcessing).toBe(true)
  })
})
