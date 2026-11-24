import { describe, expect, it } from 'bun:test'
import { hasConversationStarted } from './SessionManager.ts'

type Fields = { sdkSessionId?: string; messageCount?: number; messages?: Array<{ role: string }> }

const started = ({ messages = [], ...rest }: Fields) => hasConversationStarted({ messages, ...rest } as never)

// Coding mode (and anything else that shapes the agent's prompt/tools) can only change before this
describe('hasConversationStarted', () => {
  it('is false for a fresh session', () => {
    expect(started({})).toBe(false)
    expect(started({ messageCount: 0 })).toBe(false)
  })

  it('is true once the SDK has a session, the header counts messages, or a user message is loaded', () => {
    expect(started({ sdkSessionId: 'sdk-1' })).toBe(true)
    expect(started({ messageCount: 3 })).toBe(true)
    expect(started({ messages: [{ role: 'user' }] })).toBe(true)
  })

  it('ignores loaded non-user messages without a count (e.g. an info notice before the first send)', () => {
    expect(started({ messages: [{ role: 'info' }] })).toBe(false)
  })
})
