import { describe, expect, it } from 'bun:test'
import { processEvent } from '../../processor'
import type { SessionState } from '../../types'

// A reply the backend took back (Claude's refusal fallback: the model's safeguards stopped it, and a
// fallback model answers instead) leaves the transcript, whether it had finished streaming or not.

function makeState(messages: any[], streaming: SessionState['streaming'] = null): SessionState {
  return { session: { id: 'session-1', messages, lastMessageAt: 1, isProcessing: true } as any, streaming }
}

describe('messages_retracted', () => {
  it("removes the turns' text, the tool calls, and what a subagent of one of them posted", () => {
    const state = makeState([
      { id: 'user', role: 'user', content: 'Please help', timestamp: 1 },
      { id: 'kept-text', role: 'assistant', content: 'Sure, here is how to', timestamp: 2, turnId: 'msg_1' },
      { id: 'kept-tool', role: 'tool', content: '', timestamp: 3, turnId: 'msg_1', toolUseId: 'toolu_1' },
      { id: 'notice', role: 'info', content: 'stopped', infoLevel: 'warning', timestamp: 4 },
      { id: 'stopped-text', role: 'assistant', content: 'Running it', timestamp: 5, turnId: 'msg_2' },
      { id: 'stopped-tool', role: 'tool', content: '', timestamp: 6, turnId: 'msg_2', toolUseId: 'toolu_agent' },
      { id: 'subagent-text', role: 'assistant', content: 'Looking', timestamp: 7, turnId: 'sub_1', parentToolUseId: 'toolu_agent' },
      { id: 'subagent-tool', role: 'tool', content: '', timestamp: 8, turnId: 'sub_1', toolUseId: 'toolu_sub', parentToolUseId: 'toolu_agent' },
      { id: 'nested-tool', role: 'tool', content: '', timestamp: 9, turnId: 'sub_2', toolUseId: 'toolu_nested', parentToolUseId: 'toolu_sub' },
      { id: 'streaming', role: 'assistant', content: 'Sure', timestamp: 10, turnId: 'msg_2b', isStreaming: true, isPending: true },
    ], { content: 'Sure', turnId: 'msg_2b' })

    const next = processEvent(state, {
      type: 'messages_retracted', sessionId: 'session-1', turnIds: ['msg_2', 'msg_2b'], toolUseIds: ['toolu_agent'],
    }).state

    expect(next.session.messages.map(message => message.id)).toEqual(['user', 'kept-text', 'kept-tool', 'notice'])
    expect(next.streaming).toBeNull()
  })

  it('leaves the transcript and the streaming text of other turns alone', () => {
    const messages = [{ id: 'answer', role: 'assistant', content: 'Fallback answer', timestamp: 1, turnId: 'msg_3', isStreaming: true }]
    const streaming = { content: 'Fallback answer', turnId: 'msg_3' }
    const next = processEvent(makeState(messages, streaming), {
      type: 'messages_retracted', sessionId: 'session-1', turnIds: ['msg_2'], toolUseIds: [],
    }).state
    expect(next.session.messages.map(message => message.id)).toEqual(['answer'])
    expect(next.streaming).toEqual(streaming)
  })
})
