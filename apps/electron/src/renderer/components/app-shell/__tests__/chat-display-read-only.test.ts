import { describe, expect, it } from 'bun:test'
import { shouldRenderChatInputZone } from '../chat-display-read-only'

describe('ChatDisplay read-only mode', () => {
  it('suppresses the chat input zone when readOnly is true', () => {
    expect(shouldRenderChatInputZone({ readOnly: true })).toBe(false)
  })

  it('renders the chat input zone by default', () => {
    expect(shouldRenderChatInputZone()).toBe(true)
    expect(shouldRenderChatInputZone({ readOnly: false })).toBe(true)
  })
})
