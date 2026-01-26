/**
 * Debounce Tests
 *
 * Tests for inbound message debouncing functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { InboundDebouncer, type DebouncedMessage } from '../debounce'
import type { TelegramMessage } from '../types'

describe('InboundDebouncer', () => {
  let debouncer: InboundDebouncer
  let flushedMessages: DebouncedMessage[] = []

  beforeEach(() => {
    flushedMessages = []
    debouncer = new InboundDebouncer({
      debounceMs: 50, // Short delay for testing
      onFlush: async (msg) => {
        flushedMessages.push(msg)
      }
    })
  })

  afterEach(() => {
    debouncer.cleanup()
  })

  const createMessage = (content: string, chatId = 123, userId = 456, messageId = 1): TelegramMessage => ({
    id: messageId,
    chatId,
    chatTitle: 'Test Chat',
    chatType: 'private',
    userId,
    username: 'testuser',
    firstName: 'Test',
    content,
    timestamp: Math.floor(Date.now() / 1000),
    attachments: []
  })

  it('should flush single message after debounce window', async () => {
    await debouncer.add(createMessage('Hello'))

    // Wait for debounce window
    await new Promise(r => setTimeout(r, 100))

    expect(flushedMessages.length).toBe(1)
    expect(flushedMessages[0]!.combinedContent).toBe('Hello')
  })

  it('should combine rapid sequential messages from same user', async () => {
    await debouncer.add(createMessage('Message 1', 123, 456, 1))
    await debouncer.add(createMessage('Message 2', 123, 456, 2))
    await debouncer.add(createMessage('Message 3', 123, 456, 3))

    // Wait for debounce window
    await new Promise(r => setTimeout(r, 100))

    expect(flushedMessages.length).toBe(1)
    expect(flushedMessages[0]!.messages.length).toBe(3)
    expect(flushedMessages[0]!.combinedContent).toBe('Message 1\n\nMessage 2\n\nMessage 3')
  })

  it('should keep messages from different users separate', async () => {
    await debouncer.add(createMessage('User 1 message', 123, 456, 1))
    await debouncer.add(createMessage('User 2 message', 123, 789, 2))

    // Wait for debounce window
    await new Promise(r => setTimeout(r, 100))

    expect(flushedMessages.length).toBe(2)
    expect(flushedMessages[0]!.combinedContent).toBe('User 1 message')
    expect(flushedMessages[1]!.combinedContent).toBe('User 2 message')
  })

  it('should keep messages from different chats separate', async () => {
    await debouncer.add(createMessage('Chat 1 message', 123, 456, 1))
    await debouncer.add(createMessage('Chat 2 message', 789, 456, 2))

    // Wait for debounce window
    await new Promise(r => setTimeout(r, 100))

    expect(flushedMessages.length).toBe(2)
  })

  it('should skip debounce for commands', async () => {
    await debouncer.add(createMessage('/start'))

    // Should flush immediately without waiting
    await new Promise(r => setTimeout(r, 10))

    expect(flushedMessages.length).toBe(1)
    expect(flushedMessages[0]!.combinedContent).toBe('/start')
  })

  it('should skip debounce for messages with attachments', async () => {
    const msg = createMessage('Check this file')
    msg.attachments = [{
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      fileId: 'file123'
    }]

    await debouncer.add(msg)

    // Should flush immediately
    await new Promise(r => setTimeout(r, 10))

    expect(flushedMessages.length).toBe(1)
  })

  it('should reset timer when new message arrives within window', async () => {
    await debouncer.add(createMessage('Message 1', 123, 456, 1))

    // Wait half the debounce window
    await new Promise(r => setTimeout(r, 25))

    // Add another message, which should reset the timer
    await debouncer.add(createMessage('Message 2', 123, 456, 2))

    // Wait just past the original window but before the reset window
    await new Promise(r => setTimeout(r, 40))

    // Should not have flushed yet
    expect(flushedMessages.length).toBe(0)

    // Wait for the full reset window
    await new Promise(r => setTimeout(r, 30))

    // Now should be flushed
    expect(flushedMessages.length).toBe(1)
    expect(flushedMessages[0]!.messages.length).toBe(2)
  })

  it('should handle burst typing scenario', async () => {
    // Simulate user typing fast (5 messages in quick succession)
    for (let i = 1; i <= 5; i++) {
      await debouncer.add(createMessage(`Part ${i}`, 123, 456, i))
      await new Promise(r => setTimeout(r, 5)) // 5ms between each
    }

    // Wait for debounce window
    await new Promise(r => setTimeout(r, 100))

    expect(flushedMessages.length).toBe(1)
    expect(flushedMessages[0]!.messages.length).toBe(5)
    expect(flushedMessages[0]!.combinedContent).toContain('Part 1')
    expect(flushedMessages[0]!.combinedContent).toContain('Part 5')
  })

  it('should combine messages with double newlines', async () => {
    await debouncer.add(createMessage('First', 123, 456, 1))
    await debouncer.add(createMessage('Second', 123, 456, 2))

    await new Promise(r => setTimeout(r, 100))

    expect(flushedMessages[0]!.combinedContent).toBe('First\n\nSecond')
  })

  it('should cleanup timers on cleanup()', async () => {
    await debouncer.add(createMessage('Test', 123, 456, 1))

    // Cleanup before flush
    debouncer.cleanup()

    // Wait longer than debounce window
    await new Promise(r => setTimeout(r, 100))

    // Should not have flushed
    expect(flushedMessages.length).toBe(0)
  })

  it('should handle multiple simultaneous chats', async () => {
    // Three different users in three different chats
    await debouncer.add(createMessage('User 1, Chat 1', 100, 111, 1))
    await debouncer.add(createMessage('User 2, Chat 2', 200, 222, 2))
    await debouncer.add(createMessage('User 3, Chat 3', 300, 333, 3))

    // Each user sends another message
    await debouncer.add(createMessage('User 1, Chat 1 (2)', 100, 111, 4))
    await debouncer.add(createMessage('User 2, Chat 2 (2)', 200, 222, 5))
    await debouncer.add(createMessage('User 3, Chat 3 (2)', 300, 333, 6))

    await new Promise(r => setTimeout(r, 100))

    // Should have 3 separate flushes
    expect(flushedMessages.length).toBe(3)

    // Each should have 2 messages combined
    expect(flushedMessages[0]!.messages.length).toBe(2)
    expect(flushedMessages[1]!.messages.length).toBe(2)
    expect(flushedMessages[2]!.messages.length).toBe(2)
  })

  it('should preserve message order in combined content', async () => {
    await debouncer.add(createMessage('First', 123, 456, 1))
    await debouncer.add(createMessage('Second', 123, 456, 2))
    await debouncer.add(createMessage('Third', 123, 456, 3))

    await new Promise(r => setTimeout(r, 100))

    const combined = flushedMessages[0]!.combinedContent
    const firstIndex = combined.indexOf('First')
    const secondIndex = combined.indexOf('Second')
    const thirdIndex = combined.indexOf('Third')

    expect(firstIndex).toBeLessThan(secondIndex)
    expect(secondIndex).toBeLessThan(thirdIndex)
  })
})
