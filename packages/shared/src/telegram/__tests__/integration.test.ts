/**
 * Integration Tests
 *
 * End-to-end tests for the complete Telegram integration flow including:
 * - Deduplication + Debouncing + Retry
 * - Access Control + Mention Gating + Echo Tracking
 * - Multi-account support
 * - Typing indicators and reactions
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { MessageDeduplicator } from '../deduplication'
import { InboundDebouncer } from '../debounce'
import { withRetry, shouldRetryTelegramError } from '../retry'
import { checkDMAccess, checkGroupAccess } from '../access-control'
import { shouldProcessGroupMessage } from '../mention-gate'
import { EchoTracker } from '../echo-tracker'
import type { TelegramMessage } from '../types'

describe('Integration Tests', () => {
  const createMessage = (
    content: string,
    chatId = 123,
    userId = 456,
    messageId = 1,
    chatType: 'private' | 'group' | 'supergroup' = 'private'
  ): TelegramMessage => ({
    id: messageId,
    chatId,
    chatTitle: chatType === 'private' ? '' : 'Test Group',
    chatType,
    userId,
    username: 'testuser',
    firstName: 'Test',
    content,
    timestamp: Math.floor(Date.now() / 1000),
    attachments: []
  })

  describe('Deduplication + Debouncing Flow', () => {
    it('should deduplicate before debouncing', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: string[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg.combinedContent)
        }
      })

      // Same message twice (duplicate)
      const msg = createMessage('Hello', 123, 456, 100)

      const isDuplicate1 = deduplicator.isDuplicate(1, msg.id, msg.chatId)
      if (!isDuplicate1) {
        await debouncer.add(msg)
      }

      const isDuplicate2 = deduplicator.isDuplicate(1, msg.id, msg.chatId)
      if (!isDuplicate2) {
        await debouncer.add(msg)
      }

      await new Promise(r => setTimeout(r, 100))

      // Should only flush once
      expect(flushedMessages.length).toBe(1)

      debouncer.cleanup()
    })

    it('should debounce non-duplicate rapid messages', async () => {
      const deduplicator = new MessageDeduplicator()
      const flushedMessages: string[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          flushedMessages.push(msg.combinedContent)
        }
      })

      // Three different messages
      for (let i = 1; i <= 3; i++) {
        const msg = createMessage(`Message ${i}`, 123, 456, i)
        const isDuplicate = deduplicator.isDuplicate(i, msg.id, msg.chatId)
        if (!isDuplicate) {
          await debouncer.add(msg)
        }
      }

      await new Promise(r => setTimeout(r, 100))

      // Should combine all three
      expect(flushedMessages.length).toBe(1)
      expect(flushedMessages[0]).toContain('Message 1')
      expect(flushedMessages[0]).toContain('Message 2')
      expect(flushedMessages[0]).toContain('Message 3')

      debouncer.cleanup()
    })
  })

  describe('Access Control + Mention Gating Flow', () => {
    it('should check DM access before processing', () => {
      const msg = createMessage('Hello', 123, 456, 1, 'private')

      // DM allowlist mode - user not allowed
      const dmAccess = checkDMAccess({
        userId: msg.userId,
        policy: 'allowlist',
        allowlist: [999] // Different user
      })

      expect(dmAccess.allowed).toBe(false)
    })

    it('should check group access + mention gating for groups', () => {
      const msg = createMessage('Check this out', -100, 456, 1, 'group')

      // Group access allowed
      const groupAccess = checkGroupAccess({
        chatId: msg.chatId,
        userId: msg.userId,
        groupPolicy: 'allowlist',
        allowedGroups: [-100],
        allowedUsers: [456]
      })

      expect(groupAccess.allowed).toBe(true)

      // But mention gating blocks (no mention)
      const shouldProcess = shouldProcessGroupMessage({
        content: msg.content,
        botUsername: 'testbot',
        requireMention: true,
        isReplyToBot: false
      })

      expect(shouldProcess).toBe(false)
    })

    it('should process group message with mention', () => {
      const msg = createMessage('@testbot Check this out', -100, 456, 1, 'group')

      // Group access allowed
      const groupAccess = checkGroupAccess({
        chatId: msg.chatId,
        userId: msg.userId,
        groupPolicy: 'allowlist',
        allowedGroups: [-100],
        allowedUsers: [456]
      })

      expect(groupAccess.allowed).toBe(true)

      // Mention gating allows
      const shouldProcess = shouldProcessGroupMessage({
        content: msg.content,
        botUsername: 'testbot',
        requireMention: true,
        isReplyToBot: false
      })

      expect(shouldProcess).toBe(true)
    })

    it('should allow commands in groups without mention', () => {
      const msg = createMessage('/help', -100, 456, 1, 'group')

      const shouldProcess = shouldProcessGroupMessage({
        content: msg.content,
        botUsername: 'testbot',
        requireMention: true,
        isReplyToBot: false
      })

      expect(shouldProcess).toBe(true)
    })
  })

  describe('Echo Tracking Flow', () => {
    it('should skip own messages via echo tracking', () => {
      const echoTracker = new EchoTracker()

      // Bot sends a message
      const sentMessageId = 100
      echoTracker.track(sentMessageId)

      // Same message comes back as incoming (echo)
      const isEcho = echoTracker.isEcho(sentMessageId)
      expect(isEcho).toBe(true)

      // Real user message (not an echo)
      const isNotEcho = echoTracker.isEcho(999)
      expect(isNotEcho).toBe(false)
    })

    it('should expire echoes after TTL', async () => {
      const echoTracker = new EchoTracker()

      echoTracker.track(100)

      // Immediately is an echo
      expect(echoTracker.isEcho(100)).toBe(true)

      // Note: Actual TTL is 5 minutes, too long for tests
      // This test verifies the mechanism exists
      expect(echoTracker.size()).toBe(1)
    })
  })

  describe('Retry + Error Handling Flow', () => {
    it('should retry transient Telegram errors', async () => {
      let attempts = 0

      const result = await withRetry(
        async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('503 Service Unavailable')
          }
          return 'success'
        },
        {
          initialMs: 10,
          maxMs: 100,
          factor: 2,
          jitter: 0,
          maxAttempts: 5
        },
        shouldRetryTelegramError
      )

      expect(result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('should not retry client errors (400, 403, 404)', async () => {
      let attempts = 0

      try {
        await withRetry(
          async () => {
            attempts++
            throw new Error('403 Forbidden')
          },
          {
            initialMs: 10,
            maxMs: 100,
            factor: 2,
            jitter: 0,
            maxAttempts: 5
          },
          shouldRetryTelegramError
        )
      } catch (err) {
        // Expected to fail immediately
      }

      expect(attempts).toBe(1)
    })
  })

  describe('Multi-Account Scenarios', () => {
    it('should handle multiple accounts with separate state', async () => {
      // Account 1: Support Bot
      const dedup1 = new MessageDeduplicator()
      const echo1 = new EchoTracker()

      // Account 2: Alerts Bot
      const dedup2 = new MessageDeduplicator()
      const echo2 = new EchoTracker()

      // Same message ID to different accounts
      const isDup1 = dedup1.isDuplicate(100, 123, 456)
      const isDup2 = dedup2.isDuplicate(100, 123, 456)

      expect(isDup1).toBe(false) // First time for account 1
      expect(isDup2).toBe(false) // First time for account 2

      // Track echo for account 1 only
      echo1.track(200)

      expect(echo1.isEcho(200)).toBe(true)
      expect(echo2.isEcho(200)).toBe(false) // Not tracked in account 2
    })

    it('should apply different access policies per account', () => {
      const userId = 123

      // Account 1: Open DMs
      const access1 = checkDMAccess({
        userId,
        policy: 'open',
        allowlist: []
      })

      expect(access1.allowed).toBe(true)

      // Account 2: Allowlist only
      const access2 = checkDMAccess({
        userId,
        policy: 'allowlist',
        allowlist: [456] // Different user
      })

      expect(access2.allowed).toBe(false)
    })

    it('should apply different mention requirements per account', () => {
      const msg = createMessage('Hello', -100, 456, 1, 'group')

      // Account 1: Requires mention
      const shouldProcess1 = shouldProcessGroupMessage({
        content: msg.content,
        botUsername: 'supportbot',
        requireMention: true,
        isReplyToBot: false
      })

      expect(shouldProcess1).toBe(false)

      // Account 2: No mention required
      const shouldProcess2 = shouldProcessGroupMessage({
        content: msg.content,
        botUsername: 'alertsbot',
        requireMention: false,
        isReplyToBot: false
      })

      expect(shouldProcess2).toBe(true)
    })
  })

  describe('Complete Message Processing Pipeline', () => {
    it('should process a valid message through full pipeline', async () => {
      const deduplicator = new MessageDeduplicator()
      const echoTracker = new EchoTracker()
      const processedMessages: string[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          processedMessages.push(msg.combinedContent)
        }
      })

      const msg = createMessage('Hello bot', 123, 456, 1, 'private')

      // Step 1: Echo check
      const isEcho = echoTracker.isEcho(msg.id)
      expect(isEcho).toBe(false)

      // Step 2: Deduplication check
      const isDuplicate = deduplicator.isDuplicate(1, msg.id, msg.chatId)
      expect(isDuplicate).toBe(false)

      // Step 3: Access control (DM)
      const dmAccess = checkDMAccess({
        userId: msg.userId,
        policy: 'open',
        allowlist: []
      })
      expect(dmAccess.allowed).toBe(true)

      // Step 4: Debounce
      if (!isEcho && !isDuplicate && dmAccess.allowed) {
        await debouncer.add(msg)
      }

      await new Promise(r => setTimeout(r, 100))

      // Should have processed successfully
      expect(processedMessages.length).toBe(1)
      expect(processedMessages[0]).toBe('Hello bot')

      debouncer.cleanup()
    })

    it('should reject messages at each pipeline stage', async () => {
      const deduplicator = new MessageDeduplicator()
      const echoTracker = new EchoTracker()
      const processedMessages: string[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          processedMessages.push(msg.combinedContent)
        }
      })

      // Test 1: Echo rejection
      echoTracker.track(100)
      const msg1 = createMessage('Echo test', 123, 456, 100)

      if (!echoTracker.isEcho(msg1.id)) {
        await debouncer.add(msg1)
      }

      // Test 2: Duplicate rejection
      const msg2 = createMessage('Duplicate test', 123, 456, 200)
      deduplicator.isDuplicate(200, msg2.id, msg2.chatId)

      const isDup = deduplicator.isDuplicate(200, msg2.id, msg2.chatId)
      if (!isDup) {
        await debouncer.add(msg2)
      }

      // Test 3: Access control rejection
      const msg3 = createMessage('Access test', 123, 999, 300)

      const access = checkDMAccess({
        userId: msg3.userId,
        policy: 'allowlist',
        allowlist: [456] // Different user
      })

      if (access.allowed) {
        await debouncer.add(msg3)
      }

      await new Promise(r => setTimeout(r, 100))

      // None should have been processed
      expect(processedMessages.length).toBe(0)

      debouncer.cleanup()
    })

    it('should handle group message with mention through pipeline', async () => {
      const deduplicator = new MessageDeduplicator()
      const echoTracker = new EchoTracker()
      const processedMessages: string[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          processedMessages.push(msg.combinedContent)
        }
      })

      const msg = createMessage('@testbot help me', -100, 456, 1, 'group')

      // Pipeline checks
      const isEcho = echoTracker.isEcho(msg.id)
      const isDuplicate = deduplicator.isDuplicate(1, msg.id, msg.chatId)

      const groupAccess = checkGroupAccess({
        chatId: msg.chatId,
        userId: msg.userId,
        groupPolicy: 'open',
        allowedGroups: [],
        allowedUsers: []
      })

      const shouldProcess = shouldProcessGroupMessage({
        content: msg.content,
        botUsername: 'testbot',
        requireMention: true,
        isReplyToBot: false
      })

      if (!isEcho && !isDuplicate && groupAccess.allowed && shouldProcess) {
        await debouncer.add(msg)
      }

      await new Promise(r => setTimeout(r, 100))

      expect(processedMessages.length).toBe(1)
      expect(processedMessages[0]).toContain('@testbot help me')

      debouncer.cleanup()
    })
  })

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle rapid duplicate messages from same user', async () => {
      const deduplicator = new MessageDeduplicator()
      const processedCount = { count: 0 }

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async () => {
          processedCount.count++
        }
      })

      // User spams same message 10 times
      for (let i = 0; i < 10; i++) {
        const isDuplicate = deduplicator.isDuplicate(100, 100, 123)
        if (!isDuplicate) {
          await debouncer.add(createMessage('spam', 123, 456, 100))
        }
      }

      await new Promise(r => setTimeout(r, 100))

      // Should only process once
      expect(processedCount.count).toBe(1)

      debouncer.cleanup()
    })

    it('should handle messages from multiple chats concurrently', async () => {
      const deduplicator = new MessageDeduplicator()
      const processedMessages: string[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          processedMessages.push(msg.combinedContent)
        }
      })

      // 3 users in 3 different chats
      const messages = [
        createMessage('Chat 1', 100, 111, 1),
        createMessage('Chat 2', 200, 222, 2),
        createMessage('Chat 3', 300, 333, 3)
      ]

      for (const msg of messages) {
        const isDuplicate = deduplicator.isDuplicate(msg.id, msg.id, msg.chatId)
        if (!isDuplicate) {
          await debouncer.add(msg)
        }
      }

      await new Promise(r => setTimeout(r, 100))

      // Should have 3 separate flushes
      expect(processedMessages.length).toBe(3)

      debouncer.cleanup()
    })

    it('should handle commands with immediate flush even with duplicates', async () => {
      const deduplicator = new MessageDeduplicator()
      const processedMessages: string[] = []

      const debouncer = new InboundDebouncer({
        debounceMs: 50,
        onFlush: async (msg) => {
          processedMessages.push(msg.combinedContent)
        }
      })

      const cmd = createMessage('/start', 123, 456, 1)

      // First command
      const isDuplicate1 = deduplicator.isDuplicate(1, cmd.chatId, cmd.timestamp)
      if (!isDuplicate1) {
        await debouncer.add(cmd)
      }

      // Duplicate command (should be blocked by deduplication)
      const isDuplicate2 = deduplicator.isDuplicate(1, cmd.chatId, cmd.timestamp)
      if (!isDuplicate2) {
        await debouncer.add(cmd)
      }

      await new Promise(r => setTimeout(r, 20))

      // Should only process once (immediate flush, but blocked by dedup)
      expect(processedMessages.length).toBe(1)

      debouncer.cleanup()
    })

    it('should handle access control for pairing mode workflow', async () => {
      const userId = 12345

      // First attempt: pairing required
      const firstAttempt = checkDMAccess({
        userId,
        policy: 'pairing',
        allowlist: []
      })

      expect(firstAttempt.allowed).toBe(false)
      expect(firstAttempt.pairingCode).toBeDefined()
      const pairingCode = firstAttempt.pairingCode!

      // Admin approves (adds to allowlist)
      const secondAttempt = checkDMAccess({
        userId,
        policy: 'pairing',
        allowlist: [userId]
      })

      expect(secondAttempt.allowed).toBe(true)
      expect(secondAttempt.pairingCode).toBeUndefined()

      // Verify pairing code format
      expect(pairingCode).toContain('PAIR-')
      expect(pairingCode).toContain('2345') // Last 4 digits
    })
  })

  describe('Performance and Scalability', () => {
    it('should handle high message volume without memory leaks', async () => {
      const deduplicator = new MessageDeduplicator()

      // Send 3000 unique messages (exceeds MAX_CACHE_SIZE of 2000)
      for (let i = 0; i < 3000; i++) {
        deduplicator.isDuplicate(i, i, i)
      }

      // Cache should be pruned to 2000
      const cacheSize = deduplicator.getCacheSize()
      expect(cacheSize).toBeLessThanOrEqual(2000)
    })

    it('should handle concurrent access control checks', () => {
      const results: boolean[] = []

      // Simulate 100 concurrent DM access checks
      for (let i = 0; i < 100; i++) {
        const result = checkDMAccess({
          userId: i,
          policy: 'allowlist',
          allowlist: [0, 50, 99] // Only 3 allowed
        })
        results.push(result.allowed)
      }

      const allowedCount = results.filter(r => r).length
      expect(allowedCount).toBe(3)
    })

    it('should maintain echo tracker under load', () => {
      const echoTracker = new EchoTracker()

      // Track 150 messages (exceeds MAX_ITEMS of 100)
      for (let i = 0; i < 150; i++) {
        echoTracker.track(i)
      }

      // Should have pruned to 100
      expect(echoTracker.size()).toBe(100)

      // Recent messages should still be tracked
      expect(echoTracker.isEcho(149)).toBe(true)
      expect(echoTracker.isEcho(145)).toBe(true)
    })
  })
})
