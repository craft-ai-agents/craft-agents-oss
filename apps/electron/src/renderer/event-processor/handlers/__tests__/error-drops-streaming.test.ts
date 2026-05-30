import { describe, expect, it } from 'bun:test'
import { handleError, handleTypedError } from '../session'
import type { SessionState, ErrorEvent, TypedErrorEvent } from '../../types'

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: Date.now(),
      isProcessing: true,
    } as any,
    streaming: { content: 'partial', turnId: 'turn-1' },
  }
}

describe('handleError drops in-flight streaming assistant messages (#664)', () => {
  it('removes role=assistant messages with isStreaming: true', () => {
    const state = makeState([
      { id: 'msg-final', role: 'assistant', content: 'previous answer', isStreaming: false },
      { id: 'msg-streaming', role: 'assistant', content: 'partial answ', isStreaming: true, isPending: true, turnId: 'turn-1' },
    ])

    const event: ErrorEvent = {
      type: 'error',
      sessionId: 'session-1',
      error: 'context_length_exceeded',
    }

    const next = handleError(state, event)
    const ids = next.state.session.messages.map(m => m.id)

    expect(ids).not.toContain('msg-streaming')
    expect(ids).toContain('msg-final')
  })

  it('still appends the error message and clears processing state', () => {
    const state = makeState([
      { id: 'msg-streaming', role: 'assistant', content: 'partial', isStreaming: true },
    ])

    const event: ErrorEvent = {
      type: 'error',
      sessionId: 'session-1',
      error: 'something failed',
      timestamp: 1234,
    }

    const next = handleError(state, event)
    const errorMsg = next.state.session.messages.find(m => m.role === 'error')

    expect(errorMsg).toBeDefined()
    expect(errorMsg!.content).toBe('something failed')
    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.streaming).toBeNull()
  })

  it('keeps non-streaming assistant messages untouched', () => {
    const state = makeState([
      { id: 'msg-final', role: 'assistant', content: 'final', isStreaming: false },
    ])

    const event: ErrorEvent = {
      type: 'error',
      sessionId: 'session-1',
      error: 'oops',
    }

    const next = handleError(state, event)
    expect(next.state.session.messages.find(m => m.id === 'msg-final')).toBeDefined()
  })

  it('still marks running tools as failed', () => {
    const state = makeState([
      { id: 'tool-1', role: 'tool', toolStatus: 'executing', toolResult: undefined },
      { id: 'msg-streaming', role: 'assistant', content: 'partial', isStreaming: true },
    ])

    const event: ErrorEvent = {
      type: 'error',
      sessionId: 'session-1',
      error: 'failed',
    }

    const next = handleError(state, event)
    const tool = next.state.session.messages.find(m => m.id === 'tool-1')

    expect(tool?.toolStatus).toBe('error')
    expect(tool?.isError).toBe(true)
  })
})

describe('handleTypedError drops in-flight streaming assistant messages (#664)', () => {
  it('removes role=assistant messages with isStreaming: true', () => {
    const state = makeState([
      { id: 'msg-final', role: 'assistant', content: 'previous answer', isStreaming: false },
      { id: 'msg-streaming', role: 'assistant', content: 'partial', isStreaming: true, isPending: true, turnId: 'turn-1' },
    ])

    const event: TypedErrorEvent = {
      type: 'typed_error',
      sessionId: 'session-1',
      error: {
        code: 'unknown_error',
        title: 'Context limit',
        message: 'Too long',
        actions: [],
        canRetry: false,
      },
    }

    const next = handleTypedError(state, event)
    const ids = next.state.session.messages.map(m => m.id)

    expect(ids).not.toContain('msg-streaming')
    expect(ids).toContain('msg-final')
  })

  it('still appends the typed error message and clears processing state', () => {
    const state = makeState([
      { id: 'msg-streaming', role: 'assistant', content: 'partial', isStreaming: true },
    ])

    const event: TypedErrorEvent = {
      type: 'typed_error',
      sessionId: 'session-1',
      error: {
        code: 'unknown_error',
        title: 'Context limit',
        message: 'Too long',
        actions: [],
        canRetry: false,
      },
    }

    const next = handleTypedError(state, event)
    const errorMsg = next.state.session.messages.find(m => m.role === 'error')

    expect(errorMsg).toBeDefined()
    expect(errorMsg!.errorCode).toBe('unknown_error')
    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.streaming).toBeNull()
  })
})
