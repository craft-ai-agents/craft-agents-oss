/**
 * WhatsAppMessageQueue Test Suite
 *
 * Comprehensive tests covering:
 * - FIFO ordering and queue operations
 * - Disk persistence across initialization
 * - App crash recovery
 * - Large batch handling
 * - Graceful shutdown
 * - Error resilience
 *
 * Test environment: Temporary filesystem with automatic cleanup
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { WhatsAppMessageQueue } from '../message-queue'
import type { WhatsAppMessage } from '../types'

/**
 * Create a test WhatsApp message with sensible defaults
 */
function createTestMessage(overrides?: Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    groupJid: '123456789-123456789@g.us',
    groupName: 'Test Group',
    senderJid: '1234567890@s.whatsapp.net',
    senderPhoneNumber: '+1234567890',
    senderName: 'Test User',
    content: 'Test message content',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('WhatsAppMessageQueue', () => {
  let testDir: string
  let mockCredentialManager: any

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `whatsapp-queue-test-${Date.now()}-${Math.random()}`)
    await mkdir(testDir, { recursive: true })

    // Mock credential manager (minimal)
    mockCredentialManager = {
      get: async () => null,
      set: async () => {},
    }
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  test('should enqueue and dequeue messages in FIFO order', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    const msg1 = createTestMessage({ content: 'First message' })
    const msg2 = createTestMessage({ content: 'Second message' })
    const msg3 = createTestMessage({ content: 'Third message' })

    await queue.enqueue(msg1)
    await queue.enqueue(msg2)
    await queue.enqueue(msg3)

    expect(await queue.getQueueSize()).toBe(3)

    const dequeued1 = await queue.dequeue()
    expect(dequeued1?.content).toBe('First message')

    const dequeued2 = await queue.dequeue()
    expect(dequeued2?.content).toBe('Second message')

    const dequeued3 = await queue.dequeue()
    expect(dequeued3?.content).toBe('Third message')

    const dequeued4 = await queue.dequeue()
    expect(dequeued4).toBeNull()

    await queue.shutdown()
  })

  test('should persist messages across initialization (app restart)', async () => {
    // First instance: enqueue messages
    const queue1 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue1.initialize()

    const msg1 = createTestMessage({ content: 'Persisted message 1' })
    const msg2 = createTestMessage({ content: 'Persisted message 2' })

    await queue1.enqueue(msg1)
    await queue1.enqueue(msg2)
    await queue1.shutdown()

    // Simulate app restart: new queue instance
    const queue2 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue2.initialize()

    const size = await queue2.getQueueSize()
    expect(size).toBe(2)

    const restored1 = await queue2.dequeue()
    expect(restored1?.content).toBe('Persisted message 1')

    const restored2 = await queue2.dequeue()
    expect(restored2?.content).toBe('Persisted message 2')

    await queue2.shutdown()
  })

  test('should survive app crash by restoring from disk', async () => {
    const queue1 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue1.initialize()

    const msg = createTestMessage({ content: 'Message before crash' })
    await queue1.enqueue(msg)

    // Trigger immediate flush by hitting 100-item threshold
    for (let i = 0; i < 99; i++) {
      await queue1.enqueue(createTestMessage({ content: `Setup msg ${i}` }))
    }

    // Wait a bit for async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Simulate crash: no shutdown, just instantiate new queue
    const queue2 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue2.initialize()

    const size = await queue2.getQueueSize()
    expect(size).toBe(100)

    const recovered = await queue2.dequeue()
    expect(recovered?.content).toBe('Message before crash')

    await queue2.shutdown()
  })

  test('should handle large batches (100+ messages)', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    // Enqueue 150 messages
    const messages: WhatsAppMessage[] = []
    for (let i = 0; i < 150; i++) {
      const msg = createTestMessage({ content: `Message ${i}` })
      messages.push(msg)
      await queue.enqueue(msg)
    }

    expect(await queue.getQueueSize()).toBe(150)

    // Dequeue and verify order
    for (let i = 0; i < 150; i++) {
      const dequeued = await queue.dequeue()
      expect(dequeued?.content).toBe(`Message ${i}`)
    }

    expect(await queue.getQueueSize()).toBe(0)
    await queue.shutdown()
  })

  test('should maintain correct size after mixed operations', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    // Enqueue 10
    for (let i = 0; i < 10; i++) {
      await queue.enqueue(createTestMessage({ content: `Msg ${i}` }))
    }
    expect(await queue.getQueueSize()).toBe(10)

    // Dequeue 5
    for (let i = 0; i < 5; i++) {
      await queue.dequeue()
    }
    expect(await queue.getQueueSize()).toBe(5)

    // Enqueue 3
    for (let i = 0; i < 3; i++) {
      await queue.enqueue(createTestMessage({ content: `New msg ${i}` }))
    }
    expect(await queue.getQueueSize()).toBe(8)

    // Dequeue all
    for (let i = 0; i < 8; i++) {
      await queue.dequeue()
    }
    expect(await queue.getQueueSize()).toBe(0)

    await queue.shutdown()
  })

  test('should peek without removing messages', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    const msg1 = createTestMessage({ content: 'First' })
    const msg2 = createTestMessage({ content: 'Second' })
    const msg3 = createTestMessage({ content: 'Third' })

    await queue.enqueue(msg1)
    await queue.enqueue(msg2)
    await queue.enqueue(msg3)

    // Peek at first 2
    const peeked = await queue.peek(2)
    expect(peeked).toHaveLength(2)
    expect(peeked[0]?.content).toBe('First')
    expect(peeked[1]?.content).toBe('Second')

    // Queue should still have 3 items
    expect(await queue.getQueueSize()).toBe(3)

    // Peek at more than available
    const peekedMore = await queue.peek(10)
    expect(peekedMore).toHaveLength(3)

    await queue.shutdown()
  })

  test('should handle dequeue on empty queue', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    const msg = await queue.dequeue()
    expect(msg).toBeNull()

    expect(await queue.getQueueSize()).toBe(0)

    await queue.shutdown()
  })

  test('should clear entire queue', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    // Enqueue 10 messages
    for (let i = 0; i < 10; i++) {
      await queue.enqueue(createTestMessage({ content: `Msg ${i}` }))
    }
    expect(await queue.getQueueSize()).toBe(10)

    // Clear
    await queue.clear()
    expect(await queue.getQueueSize()).toBe(0)

    // Verify persistence of empty state
    const msg = await queue.dequeue()
    expect(msg).toBeNull()

    await queue.shutdown()

    // Verify cleared state persists across restart
    const queue2 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue2.initialize()
    expect(await queue2.getQueueSize()).toBe(0)
    await queue2.shutdown()
  })

  test('should write JSONL format to disk', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    const msg1 = createTestMessage({
      groupJid: '111@g.us',
      content: 'First line',
    })
    const msg2 = createTestMessage({
      groupJid: '222@g.us',
      content: 'Second line',
    })

    await queue.enqueue(msg1)
    await queue.enqueue(msg2)
    await queue.shutdown()

    // Read file directly
    const queuePath = join(testDir, 'whatsapp-queue.jsonl')
    const content = await readFile(queuePath, 'utf-8')
    const lines = content.trim().split('\n')

    expect(lines).toHaveLength(2)

    // Each line should be valid JSON
    const parsed1 = JSON.parse(lines[0]!)
    const parsed2 = JSON.parse(lines[1]!)

    expect(parsed1.content).toBe('First line')
    expect(parsed2.content).toBe('Second line')
  })

  test('should be idempotent on multiple initializations', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)

    await queue.initialize()
    await queue.initialize() // Should not error
    await queue.initialize() // Should not error

    const msg = createTestMessage()
    await queue.enqueue(msg)

    expect(await queue.getQueueSize()).toBe(1)

    await queue.shutdown()
  })

  test('should be idempotent on multiple shutdowns', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    const msg = createTestMessage()
    await queue.enqueue(msg)

    await queue.shutdown()
    await queue.shutdown() // Should not error

    await queue.shutdown() // Should not error

    expect(await queue.getQueueSize()).toBe(1)
  })

  test('should handle shutdown with empty queue', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    // Enqueue and dequeue all
    await queue.enqueue(createTestMessage())
    await queue.dequeue()

    // Shutdown with empty queue
    await queue.shutdown()

    // Verify queue file is empty
    const queuePath = join(testDir, 'whatsapp-queue.jsonl')
    const content = await readFile(queuePath, 'utf-8')
    expect(content).toBe('')
  })

  test('should preserve message properties across persistence', async () => {
    const queue1 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue1.initialize()

    const original = createTestMessage({
      id: 'specific-id-123',
      groupJid: 'group-456@g.us',
      groupName: 'Special Group',
      senderJid: 'sender-789@s.whatsapp.net',
      senderPhoneNumber: '+9876543210',
      senderName: 'Special Sender',
      content: 'Special content with special chars: 你好 🎉 #test',
      timestamp: 1234567890000,
      attachments: [
        {
          fileName: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        },
      ],
    })

    await queue1.enqueue(original)
    await queue1.shutdown()

    const queue2 = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue2.initialize()

    const restored = await queue2.dequeue()

    expect(restored?.id).toBe('specific-id-123')
    expect(restored?.groupJid).toBe('group-456@g.us')
    expect(restored?.groupName).toBe('Special Group')
    expect(restored?.senderJid).toBe('sender-789@s.whatsapp.net')
    expect(restored?.senderPhoneNumber).toBe('+9876543210')
    expect(restored?.senderName).toBe('Special Sender')
    expect(restored?.content).toBe('Special content with special chars: 你好 🎉 #test')
    expect(restored?.timestamp).toBe(1234567890000)
    expect(restored?.attachments).toHaveLength(1)
    expect(restored?.attachments?.[0]?.fileName).toBe('test.pdf')

    await queue2.shutdown()
  })

  test('should recover from malformed queue file', async () => {
    // Create queue file with one valid and one malformed entry
    const queuePath = join(testDir, 'whatsapp-queue.jsonl')
    await mkdir(testDir, { recursive: true })

    const msg = createTestMessage({ content: 'Valid message' })
    const validLine = JSON.stringify(msg)
    const malformedLine = 'this is not valid json {{{ broken'

    await mkdir(testDir, { recursive: true })
    const fs = require('fs/promises')
    await fs.writeFile(queuePath, `${validLine}\n${malformedLine}\n`, 'utf-8')

    // Initialize should load valid entry and skip malformed
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    expect(await queue.getQueueSize()).toBe(1)

    const recovered = await queue.dequeue()
    expect(recovered?.content).toBe('Valid message')

    await queue.shutdown()
  })

  test('should handle concurrent enqueue operations', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    // Simulate concurrent enqueues without await (JavaScript task scheduling)
    const promises: Promise<void>[] = []

    for (let i = 0; i < 20; i++) {
      promises.push(queue.enqueue(createTestMessage({ content: `Concurrent msg ${i}` })))
    }

    await Promise.all(promises)

    expect(await queue.getQueueSize()).toBe(20)

    await queue.shutdown()
  })

  test('should flush periodically to disk', async () => {
    const queue = new WhatsAppMessageQueue(testDir, mockCredentialManager)
    await queue.initialize()

    const msg = createTestMessage({ content: 'Will be flushed periodically' })
    await queue.enqueue(msg)

    // Wait for periodic flush (10 seconds in implementation, but we trigger manually)
    // To avoid 10-second wait in tests, we trigger a size-based flush
    // by enqueueing enough messages to hit the 100-item threshold, OR
    // we just wait a bit and check the file exists and is written

    // For this test, we add just enough to trigger threshold flush OR wait for periodic
    for (let i = 0; i < 99; i++) {
      await queue.enqueue(createTestMessage({ content: `Batch msg ${i}` }))
    }

    // This should trigger the 100-item flush
    const queuePath = join(testDir, 'whatsapp-queue.jsonl')
    const content = await readFile(queuePath, 'utf-8')
    expect(content).toContain('Will be flushed periodically')
    expect(content.split('\n').filter((l) => l.length > 0)).toHaveLength(100)

    await queue.shutdown()
  })
})
